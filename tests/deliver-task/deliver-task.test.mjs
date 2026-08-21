import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  access,
  appendFile,
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  unlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const script = path.join(repoRoot, 'skills/deliver-task/scripts/deliver-task.mjs');

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function run(cwd, args) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd,
    encoding: 'utf8',
  });
}

function prepareWorkspace(fixture, extra = []) {
  const result = run(fixture.root, [
    'prepare-workspace',
    path.relative(fixture.root, fixture.taskDir),
    ...extra,
  ]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

async function createFixture({
  commitPolicy = 'allowed',
  caller = { kind: 'direct' },
  acceptancePolicy = 'not-required',
} = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'deliver-task-test-'));
  await mkdir(path.join(root, 'src'), { recursive: true });
  await mkdir(path.join(root, 'test'), { recursive: true });
  await writeFile(path.join(root, 'src/slug.mjs'), "export const slug = (value) => value.trim().toLowerCase().replaceAll(' ', '-');\n");
  await writeFile(path.join(root, 'test/slug.test.mjs'), '// fixture\n');
  git(root, ['init', '-q']);
  git(root, ['add', 'src/slug.mjs', 'test/slug.test.mjs']);
  git(root, ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-q', '-m', '初始基线']);
  const baseCommit = git(root, ['rev-parse', 'HEAD']);
  const taskDir = path.join(root, 'dev-tasks', 'slug-whitespace');
  await mkdir(taskDir, { recursive: true });
  const task = {
    schemaVersion: 'deliver-task.task.v1',
    taskId: 'slug-whitespace',
    revision: 1,
    caller,
    objective: '连续空白归一为一个连字符。',
    acceptanceCriteria: ['slug("  Hello   World  ") 返回 "hello-world"。'],
    constraints: ['不新增依赖。'],
    nonGoals: ['不改变 slug 的大小写规则。'],
    forbiddenPaths: ['package.json'],
    baseCommit,
    commitPolicy,
    acceptancePolicy,
  };
  await writeFile(path.join(taskDir, 'task.json'), `${JSON.stringify(task, null, 2)}\n`);
  return { root, taskDir, task, baseCommit };
}

function taskBinding(fixture, hash) {
  return {
    taskId: fixture.task.taskId,
    revision: fixture.task.revision,
    taskHash: hash,
  };
}

async function initTask(fixture) {
  prepareWorkspace(fixture, ['--workspace', fixture.root]);
  const result = run(fixture.root, ['init', path.relative(fixture.root, fixture.taskDir)]);
  assert.equal(result.status, 0, result.stderr);
  await appendFile(
    path.join(fixture.taskDir, 'audits.md'),
    '\n### A1：上下文预检\n\n已读取真实代码和项目规则，并形成执行边界。\n',
  );
  return result;
}

async function taskHash(fixture) {
  const result = run(fixture.root, ['task-hash', path.relative(fixture.root, fixture.taskDir)]);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

async function writeExecution(
  fixture,
  {
    allowedPaths = ['src/slug.mjs', 'test/slug.test.mjs'],
    forbiddenPaths = [],
    evidenceRefs = ['audits.md#A1'],
  } = {},
) {
  const hash = await taskHash(fixture);
  const execution = {
    schemaVersion: 'deliver-task.execution.v1',
    task: taskBinding(fixture, hash),
    allowedPaths,
    forbiddenPaths,
    evidenceRefs,
  };
  await writeFile(path.join(fixture.taskDir, 'execution.json'), `${JSON.stringify(execution, null, 2)}\n`);
  return execution;
}

async function snapshotTarget(fixture) {
  const result = run(fixture.root, ['snapshot-target', path.relative(fixture.root, fixture.taskDir)]);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function bindingBlock(fixture, hash, target) {
  return [
    '```deliver-task-binding',
    JSON.stringify({ task: taskBinding(fixture, hash), executionHash: target.executionHash, target }),
    '```',
  ].join('\n');
}

async function appendGeneralReview(fixture, target, { anchor = 'A2' } = {}) {
  const hash = await taskHash(fixture);
  await appendFile(
    path.join(fixture.taskDir, 'audits.md'),
    `\n### ${anchor}：General Review\n\n最终累计 full clean。\n\n${bindingBlock(fixture, hash, target)}\n`,
  );
  return `audits.md#${anchor}`;
}

async function appendAcceptance(
  fixture,
  target,
  status,
  { anchor = 'A3', evidenceRefs = ['audits.md#A1'] } = {},
) {
  const hash = await taskHash(fixture);
  const record = {
    task: taskBinding(fixture, hash),
    target,
    status,
    evidenceRefs,
  };
  await appendFile(
    path.join(fixture.taskDir, 'audits.md'),
    `\n### ${anchor}：Upstream acceptance\n\n\`\`\`deliver-task-acceptance\n${JSON.stringify(record)}\n\`\`\`\n`,
  );
  return `audits.md#${anchor}`;
}

async function writeVerifiedClaims(fixture, hash, evidenceRefs = ['audits.md#A1']) {
  const claims = {
    schemaVersion: 'deliver-task.claims.v1',
    task: taskBinding(fixture, hash),
    claims: [
      {
        claimId: 'C1',
        statement: '连续空白已归一为一个连字符。',
        status: 'verified',
        evidenceRefs,
      },
    ],
  };
  await writeFile(path.join(fixture.taskDir, 'claims.json'), `${JSON.stringify(claims, null, 2)}\n`);
}

async function writeDelivery(
  fixture,
  {
    result = 'delivered',
    target,
    generalReview = 'audits.md#A2',
    acceptance = null,
    upstreamRequest = null,
  } = {},
) {
  const hash = await taskHash(fixture);
  const delivery = {
    schemaVersion: 'deliver-task.delivery.v1',
    task: taskBinding(fixture, hash),
    result,
    target: target ?? null,
    evidenceRefs:
      result === 'delivered'
        ? {
            claims: 'claims.json',
            verification: 'audits.md#A1',
            generalReview,
            acceptance,
            rulesReview: 'not-applicable',
          }
        : {
            claims: 'claims.json',
            verification: null,
            generalReview: null,
            acceptance: null,
            rulesReview: null,
          },
    residualRiskRefs: [],
    upstreamRequest,
  };
  await writeFile(path.join(fixture.taskDir, 'delivery.json'), `${JSON.stringify(delivery, null, 2)}\n`);
  return delivery;
}

async function prepareDelivered(fixture, { acceptanceStatus } = {}) {
  await initTask(fixture);
  await writeExecution(fixture);
  const target = await snapshotTarget(fixture);
  const generalReview = await appendGeneralReview(fixture, target);
  const acceptance = acceptanceStatus
    ? await appendAcceptance(fixture, target, acceptanceStatus)
    : null;
  const hash = await taskHash(fixture);
  await writeVerifiedClaims(fixture, hash);
  await writeDelivery(fixture, { target, generalReview, acceptance });
  return { target, generalReview, acceptance, hash };
}

test('init 只初始化 task-owned 状态且不替 caller 创建 execution', async () => {
  const fixture = await createFixture({
    caller: { kind: 'delegated', name: 'sliced-dev', ref: 'dev-plans/example/plan.md#S1' },
  });
  const callerPlan = path.join(fixture.root, 'dev-plans/example/plan.md');
  await mkdir(path.dirname(callerPlan), { recursive: true });
  await writeFile(callerPlan, 'S1: in-progress\ncurrent: S1\n');

  const result = run(fixture.root, ['init', path.relative(fixture.root, fixture.taskDir)]);
  assert.equal(result.status, 0, result.stderr);

  assert.equal(await readFile(callerPlan, 'utf8'), 'S1: in-progress\ncurrent: S1\n');
  assert.match(await readFile(path.join(fixture.taskDir, '.gitignore'), 'utf8'), /^\/artifacts\/$/m);
  const claims = JSON.parse(await readFile(path.join(fixture.taskDir, 'claims.json'), 'utf8'));
  assert.equal(claims.schemaVersion, 'deliver-task.claims.v1');
  assert.equal(claims.task.taskId, 'slug-whitespace');
  assert.deepEqual(claims.claims, []);
  assert.match(await readFile(path.join(fixture.taskDir, 'audits.md'), 'utf8'), /# 单任务审计/);
  await assert.rejects(access(path.join(fixture.taskDir, 'execution.json')));
});

test('init 在没有 workspace binding 时默认建立隔离 worktree', async () => {
  const fixture = await createFixture();

  const result = run(fixture.root, ['init', path.relative(fixture.root, fixture.taskDir)]);

  assert.equal(result.status, 0, result.stderr);
  const workspace = JSON.parse(
    await readFile(path.join(fixture.taskDir, 'artifacts/workspace.json'), 'utf8'),
  );
  assert.equal(workspace.kind, 'git-worktree');
  assert.notEqual(workspace.workspacePath, fixture.root);
  assert.equal(git(workspace.workspacePath, ['rev-parse', 'HEAD']), fixture.baseCommit);
});

test('prepare-workspace 从 task.baseCommit 创建隔离 worktree，不吸收主分支新提交', async () => {
  const fixture = await createFixture({ commitPolicy: 'required' });
  await writeFile(path.join(fixture.root, 'src/slug.mjs'), "export const slug = () => 'main-only';\n");
  git(fixture.root, ['add', 'src/slug.mjs']);
  git(fixture.root, ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-q', '-m', '用户主分支提交']);

  const workspace = prepareWorkspace(fixture);

  assert.equal(workspace.schemaVersion, 'deliver-task.workspace.v1');
  assert.equal(workspace.kind, 'git-worktree');
  assert.equal(workspace.baseCommit, fixture.baseCommit);
  assert.notEqual(workspace.workspacePath, fixture.root);
  assert.equal(git(workspace.workspacePath, ['rev-parse', 'HEAD']), fixture.baseCommit);
  assert.match(workspace.branch, /^refs\/heads\/deliver-task\//);
  assert.doesNotMatch(
    await readFile(path.join(workspace.workspacePath, 'src/slug.mjs'), 'utf8'),
    /main-only/,
  );

  await unlink(path.join(fixture.taskDir, 'artifacts/workspace.json'));
  assert.deepEqual(prepareWorkspace(fixture), workspace);
});

test('prepare-workspace 只接受从干净 baseCommit 开始的显式 isolated workspace', async () => {
  {
    const fixture = await createFixture();
    const workspace = prepareWorkspace(fixture, ['--workspace', path.join(fixture.root, 'src')]);

    assert.equal(workspace.kind, 'provided');
    assert.equal(workspace.workspacePath, await realpath(fixture.root));
    assert.deepEqual(
      prepareWorkspace(fixture, ['--workspace', fixture.root]),
      workspace,
    );
  }

  {
    const fixture = await createFixture();
    await writeFile(path.join(fixture.root, 'src/slug.mjs'), "export const slug = () => 'dirty';\n");

    const result = run(fixture.root, [
      'prepare-workspace',
      path.relative(fixture.root, fixture.taskDir),
      '--workspace',
      fixture.root,
    ]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /provided workspace.*clean.*src\/slug\.mjs/i);
  }
});

test('隔离 workspace 中与 taskDir 同仓库相对路径的工件不能进入业务 commit', async () => {
  const fixture = await createFixture({ commitPolicy: 'required' });
  const workspace = prepareWorkspace(fixture);
  let result = run(fixture.root, ['init', path.relative(fixture.root, fixture.taskDir)]);
  assert.equal(result.status, 0, result.stderr);
  await appendFile(
    path.join(fixture.taskDir, 'audits.md'),
    '\n### A1：上下文预检\n\n已建立隔离 workspace 与执行边界。\n',
  );
  await writeExecution(fixture, { allowedPaths: ['**'] });
  const mirroredTaskDir = path.join(workspace.workspacePath, 'dev-tasks/slug-whitespace');
  await mkdir(mirroredTaskDir, { recursive: true });
  await writeFile(path.join(mirroredTaskDir, 'rogue.md'), '不应进入业务提交。\n');
  git(workspace.workspacePath, ['add', 'dev-tasks/slug-whitespace/rogue.md']);
  git(workspace.workspacePath, ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-q', '-m', '错误提交 task 工件']);

  result = run(fixture.root, ['snapshot-target', path.relative(fixture.root, fixture.taskDir)]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /task-owned artifact path dev-tasks\/slug-whitespace\/rogue\.md/);
});

test('更高 task revision 建立新 workspace，同 revision 的 hash 漂移仍 fail closed', async () => {
  {
    const fixture = await createFixture();
    const previous = prepareWorkspace(fixture);
    fixture.task.revision = 2;
    fixture.task.objective = '显式改变后的目标。';
    await writeFile(
      path.join(fixture.taskDir, 'task.json'),
      `${JSON.stringify(fixture.task, null, 2)}\n`,
    );

    const current = prepareWorkspace(fixture);
    assert.equal(current.task.revision, 2);
    assert.notEqual(current.workspacePath, previous.workspacePath);
    assert.notEqual(current.branch, previous.branch);
  }

  {
    const fixture = await createFixture();
    prepareWorkspace(fixture);
    fixture.task.objective = '未递增 revision 的错误合同变化。';
    await writeFile(
      path.join(fixture.taskDir, 'task.json'),
      `${JSON.stringify(fixture.task, null, 2)}\n`,
    );

    const result = run(fixture.root, [
      'prepare-workspace',
      path.relative(fixture.root, fixture.taskDir),
    ]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /workspace\.task.*stale task binding/);
  }
});

test('commit-range freshness 只读取隔离 task workspace，不受主工作区 dirty 或新提交影响', async () => {
  const fixture = await createFixture({ commitPolicy: 'required' });
  await writeFile(path.join(fixture.root, 'background-notes.md'), '用户任务外修改。\n');
  const workspace = prepareWorkspace(fixture);
  let result = run(fixture.root, ['init', path.relative(fixture.root, fixture.taskDir)]);
  assert.equal(result.status, 0, result.stderr);
  await appendFile(
    path.join(fixture.taskDir, 'audits.md'),
    '\n### A1：上下文预检\n\n已在隔离 workspace 读取代码和项目规则，并形成执行边界。\n',
  );
  await writeExecution(fixture);
  await writeFile(path.join(workspace.workspacePath, 'src/slug.mjs'), "export const slug = (value) => value.trim().toLowerCase().replace(/\\s+/g, '-');\n");
  git(workspace.workspacePath, ['add', 'src/slug.mjs']);
  git(workspace.workspacePath, ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-q', '-m', '修复空白归一']);

  const target = await snapshotTarget(fixture);
  const generalReview = await appendGeneralReview(fixture, target);
  const hash = await taskHash(fixture);
  await writeVerifiedClaims(fixture, hash);
  await writeDelivery(fixture, { target, generalReview });

  await writeFile(path.join(fixture.root, 'src/slug.mjs'), "export const slug = () => 'main-new-head';\n");
  git(fixture.root, ['add', 'src/slug.mjs']);
  git(fixture.root, ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-q', '-m', '用户继续提交']);
  await writeFile(path.join(fixture.root, 'user-live-edit.md'), '用户继续编辑。\n');
  result = run(fixture.root, ['close-check', path.relative(fixture.root, fixture.taskDir)]);
  assert.equal(result.status, 0, result.stderr);

  await writeFile(path.join(workspace.workspacePath, 'test/slug.test.mjs'), '// task workspace residual\n');
  result = run(fixture.root, ['close-check', path.relative(fixture.root, fixture.taskDir)]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /committed target has additional worktree changes.*test\/slug\.test\.mjs/);
});

test('validate-task 接受新 exact schema 并拒绝旧 task-owned execution/acceptance 字段', async () => {
  for (const commitPolicy of ['required', 'allowed', 'forbidden']) {
    for (const acceptancePolicy of ['required', 'not-required']) {
      const fixture = await createFixture({ commitPolicy, acceptancePolicy });
      const result = run(fixture.root, ['validate-task', path.relative(fixture.root, fixture.taskDir)]);
      assert.equal(result.status, 0, `${commitPolicy}/${acceptancePolicy}: ${result.stderr}`);
    }
  }

  const fixture = await createFixture();
  fixture.task.allowedPaths = ['src/**'];
  fixture.task.upstreamAcceptance = { status: 'not-required' };
  await writeFile(path.join(fixture.taskDir, 'task.json'), `${JSON.stringify(fixture.task, null, 2)}\n`);
  const result = run(fixture.root, ['validate-task', path.relative(fixture.root, fixture.taskDir)]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /unsupported fields.*allowedPaths.*upstreamAcceptance/);
});

test('validate-task 要求 baseCommit 为完整 commit OID，不能用会漂移的 Git revision', async () => {
  for (const baseCommit of ['HEAD', 'deadbeef']) {
    const fixture = await createFixture();
    fixture.task.baseCommit = baseCommit;
    await writeFile(
      path.join(fixture.taskDir, 'task.json'),
      `${JSON.stringify(fixture.task, null, 2)}\n`,
    );

    const result = run(fixture.root, ['validate-task', path.relative(fixture.root, fixture.taskDir)]);
    assert.equal(result.status, 1, `${baseCommit} unexpectedly passed`);
    assert.match(result.stderr, /task\.baseCommit.*full Git commit OID/);
  }
});

test('caller 接受 direct 与通用 delegated name/ref，并拒绝旧 kind 和不完整 delegated', async () => {
  for (const caller of [
    { kind: 'direct' },
    { kind: 'delegated', name: 'sliced-dev', ref: 'dev-plans/example/plan.md#S1' },
    { kind: 'delegated', name: 'release-pipeline', ref: 'tasks/release-1' },
  ]) {
    const fixture = await createFixture({ caller });
    const result = run(fixture.root, ['validate-task', path.relative(fixture.root, fixture.taskDir)]);
    assert.equal(result.status, 0, `${JSON.stringify(caller)}: ${result.stderr}`);
  }

  for (const caller of [
    { kind: 'direct', ref: 'unexpected' },
    { kind: 'delegated', ref: 'dev-plans/example/plan.md#S1' },
    { kind: 'delegated', name: 'sliced-dev' },
    { kind: 'delegated', name: 'SlicedDev', ref: 'x' },
    { kind: 'sliced-dev', ref: 'dev-plans/example/plan.md#S1' },
    { kind: 'unknown' },
  ]) {
    const fixture = await createFixture({ caller });
    const result = run(fixture.root, ['validate-task', path.relative(fixture.root, fixture.taskDir)]);
    assert.equal(result.status, 1, `unexpected pass: ${JSON.stringify(caller)}`);
  }
});

test('task hash 对 key 顺序稳定，execution 调整不改 task identity，immutable task 变化会改 hash', async () => {
  const fixture = await createFixture();
  const first = await taskHash(fixture);
  assert.match(first, /^sha256:[0-9a-f]{64}$/);

  const reordered = Object.fromEntries(Object.entries(fixture.task).reverse());
  await writeFile(path.join(fixture.taskDir, 'task.json'), `${JSON.stringify(reordered, null, 2)}\n`);
  assert.equal(await taskHash(fixture), first);

  await initTask(fixture);
  await writeExecution(fixture);
  assert.equal(await taskHash(fixture), first);
  await writeExecution(fixture, { allowedPaths: ['src/**', 'test/**'] });
  assert.equal(await taskHash(fixture), first);

  reordered.objective = '改变后的目标。';
  await writeFile(path.join(fixture.taskDir, 'task.json'), `${JSON.stringify(reordered, null, 2)}\n`);
  assert.notEqual(await taskHash(fixture), first);
});

test('validate-execution 校验 exact schema、当前 task binding 和 task-owned evidence refs', async () => {
  const fixture = await createFixture();
  await initTask(fixture);
  const execution = await writeExecution(fixture);

  let result = run(fixture.root, ['validate-execution', path.relative(fixture.root, fixture.taskDir)]);
  assert.equal(result.status, 0, result.stderr);

  execution.plan = [];
  await writeFile(path.join(fixture.taskDir, 'execution.json'), `${JSON.stringify(execution, null, 2)}\n`);
  result = run(fixture.root, ['validate-execution', path.relative(fixture.root, fixture.taskDir)]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /execution\.json.*unsupported fields.*plan/);

  delete execution.plan;
  execution.task.taskHash = `sha256:${'0'.repeat(64)}`;
  await writeFile(path.join(fixture.taskDir, 'execution.json'), `${JSON.stringify(execution, null, 2)}\n`);
  result = run(fixture.root, ['validate-execution', path.relative(fixture.root, fixture.taskDir)]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /execution\.task.*stale task binding/);

  execution.task.taskHash = await taskHash(fixture);
  execution.evidenceRefs = ['claims.json'];
  await writeFile(path.join(fixture.taskDir, 'execution.json'), `${JSON.stringify(execution, null, 2)}\n`);
  result = run(fixture.root, ['validate-execution', path.relative(fixture.root, fixture.taskDir)]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /execution\.evidenceRefs\[0\].*audits\.md A entry/);

  execution.evidenceRefs = ['audits.md#A99'];
  await writeFile(path.join(fixture.taskDir, 'execution.json'), `${JSON.stringify(execution, null, 2)}\n`);
  result = run(fixture.root, ['validate-execution', path.relative(fixture.root, fixture.taskDir)]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /evidence ref missing anchor.*A99/);
});

test('required 策略拒绝未提交代码并接受绑定 execution 的已提交 range', async () => {
  const fixture = await createFixture({ commitPolicy: 'required' });
  await initTask(fixture);
  await writeExecution(fixture);
  await writeFile(path.join(fixture.root, 'src/slug.mjs'), "export const slug = (value) => value.trim().toLowerCase().replace(/\\s+/g, '-');\n");

  let result = run(fixture.root, ['snapshot-target', path.relative(fixture.root, fixture.taskDir)]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /commitPolicy required.*committed target/);

  git(fixture.root, ['add', 'src/slug.mjs']);
  git(fixture.root, ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-q', '-m', '修复空白归一']);
  const target = await snapshotTarget(fixture);
  assert.equal(target.kind, 'commit-range');
  assert.equal(target.baseCommit, fixture.baseCommit);
  assert.equal(target.headCommit, git(fixture.root, ['rev-parse', 'HEAD']));
  assert.match(target.executionHash, /^sha256:[0-9a-f]{64}$/);
});

test('allowed 策略可交付绑定 execution 的未提交 worktree target', async () => {
  const fixture = await createFixture({ commitPolicy: 'allowed' });
  await initTask(fixture);
  await writeExecution(fixture);
  await writeFile(path.join(fixture.root, 'src/slug.mjs'), "export const slug = (value) => value.trim().toLowerCase().replace(/\\s+/g, '-');\n");

  const target = await snapshotTarget(fixture);
  assert.equal(target.kind, 'worktree');
  assert.equal(target.baseCommit, fixture.baseCommit);
  assert.match(target.snapshotHash, /^sha256:[0-9a-f]{64}$/);
  assert.match(target.executionHash, /^sha256:[0-9a-f]{64}$/);
});

test('forbidden 策略拒绝业务 commit 并接受绑定 execution 的未提交 target', async () => {
  const fixture = await createFixture({ commitPolicy: 'forbidden' });
  await initTask(fixture);
  await writeExecution(fixture);
  await writeFile(path.join(fixture.root, 'src/slug.mjs'), "export const slug = (value) => value.trim().toLowerCase().replace(/\\s+/g, '-');\n");

  const target = await snapshotTarget(fixture);
  assert.equal(target.kind, 'worktree');
  assert.match(target.executionHash, /^sha256:[0-9a-f]{64}$/);

  git(fixture.root, ['add', 'src/slug.mjs']);
  git(fixture.root, ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-q', '-m', '不应允许的提交']);
  const result = run(fixture.root, ['snapshot-target', path.relative(fixture.root, fixture.taskDir)]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /commitPolicy forbidden.*HEAD.*baseCommit/);
});

test('snapshot-target 读取 execution allowlist 并合并 task/execution 两层 forbidden paths', async () => {
  {
    const fixture = await createFixture();
    await initTask(fixture);
    await writeExecution(fixture, { allowedPaths: ['src/**'] });
    await writeFile(path.join(fixture.root, 'test/slug.test.mjs'), '// changed\n');
    const result = run(fixture.root, ['snapshot-target', path.relative(fixture.root, fixture.taskDir)]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /test\/slug\.test\.mjs.*outside execution\.allowedPaths/);
  }

  {
    const fixture = await createFixture();
    await initTask(fixture);
    await writeExecution(fixture, { allowedPaths: ['**'] });
    await writeFile(path.join(fixture.root, 'package.json'), '{}\n');
    const result = run(fixture.root, ['snapshot-target', path.relative(fixture.root, fixture.taskDir)]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /package\.json.*task\.forbiddenPaths/);
  }

  {
    const fixture = await createFixture();
    await initTask(fixture);
    await writeExecution(fixture, {
      allowedPaths: ['src/**', 'test/**'],
      forbiddenPaths: ['test/**'],
    });
    await writeFile(path.join(fixture.root, 'test/slug.test.mjs'), '// changed\n');
    const result = run(fixture.root, ['snapshot-target', path.relative(fixture.root, fixture.taskDir)]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /test\/slug\.test\.mjs.*execution\.forbiddenPaths/);
  }
});

test('execution boundary 变化会生成新 hash 并使旧 General binding 失效', async () => {
  const fixture = await createFixture();
  await initTask(fixture);
  await writeExecution(fixture);
  const oldTarget = await snapshotTarget(fixture);
  const oldGeneral = await appendGeneralReview(fixture, oldTarget);
  const hash = await taskHash(fixture);
  await writeVerifiedClaims(fixture, hash);

  await appendFile(
    path.join(fixture.taskDir, 'audits.md'),
    '\n### A3：执行边界调整\n\n同一目标内补充 docs 范围。\n',
  );
  await writeExecution(fixture, {
    allowedPaths: ['src/slug.mjs', 'test/slug.test.mjs', 'docs/**'],
    evidenceRefs: ['audits.md#A3'],
  });
  const newTarget = await snapshotTarget(fixture);
  assert.notEqual(newTarget.executionHash, oldTarget.executionHash);
  assert.equal(await taskHash(fixture), hash);

  await writeDelivery(fixture, { target: newTarget, generalReview: oldGeneral });
  const result = run(fixture.root, ['validate-result', path.relative(fixture.root, fixture.taskDir)]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /General Review.*stale.*execution|generalReview.*binding/i);
});

test('required acceptance 的 passed/skipped 只绑定 target，不改变 task 或 General identity', async () => {
  for (const status of ['passed', 'skipped']) {
    const fixture = await createFixture({ acceptancePolicy: 'required' });
    await initTask(fixture);
    await writeExecution(fixture);
    const target = await snapshotTarget(fixture);
    const generalReview = await appendGeneralReview(fixture, target);
    const before = await taskHash(fixture);
    const acceptance = await appendAcceptance(fixture, target, status);
    assert.equal(await taskHash(fixture), before);
    await writeVerifiedClaims(fixture, before);
    await writeDelivery(fixture, { target, generalReview, acceptance });

    let result = run(fixture.root, ['validate-result', path.relative(fixture.root, fixture.taskDir)]);
    assert.equal(result.status, 0, `${status}: ${result.stderr}`);
    result = run(fixture.root, ['close-check', path.relative(fixture.root, fixture.taskDir)]);
    assert.equal(result.status, 0, `${status}: ${result.stderr}`);
  }
});

test('not-required acceptance 要求 delivery acceptance ref 为 null', async () => {
  const fixture = await createFixture();
  const { target } = await prepareDelivered(fixture);
  let result = run(fixture.root, ['validate-result', path.relative(fixture.root, fixture.taskDir)]);
  assert.equal(result.status, 0, result.stderr);

  const acceptance = await appendAcceptance(fixture, target, 'passed', { anchor: 'A3' });
  await writeDelivery(fixture, { target, acceptance });
  result = run(fixture.root, ['validate-result', path.relative(fixture.root, fixture.taskDir)]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /acceptancePolicy not-required.*acceptance.*null/);
});

test('required acceptance 缺失或绑定旧 target 时不能 delivered', async () => {
  {
    const fixture = await createFixture({ acceptancePolicy: 'required' });
    await initTask(fixture);
    await writeExecution(fixture);
    const target = await snapshotTarget(fixture);
    await appendGeneralReview(fixture, target);
    const hash = await taskHash(fixture);
    await writeVerifiedClaims(fixture, hash);
    await writeDelivery(fixture, { target });
    const result = run(fixture.root, ['validate-result', path.relative(fixture.root, fixture.taskDir)]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /acceptancePolicy required.*passed\/skipped|acceptance.*required/i);
  }

  {
    const fixture = await createFixture({ acceptancePolicy: 'required' });
    await initTask(fixture);
    await writeExecution(fixture);
    const oldTarget = await snapshotTarget(fixture);
    const staleAcceptance = await appendAcceptance(fixture, oldTarget, 'passed', { anchor: 'A2' });
    await writeFile(path.join(fixture.root, 'src/slug.mjs'), "export const slug = () => 'new-target';\n");
    const currentTarget = await snapshotTarget(fixture);
    const generalReview = await appendGeneralReview(fixture, currentTarget, { anchor: 'A3' });
    const hash = await taskHash(fixture);
    await writeVerifiedClaims(fixture, hash);
    await writeDelivery(fixture, { target: currentTarget, generalReview, acceptance: staleAcceptance });
    const result = run(fixture.root, ['validate-result', path.relative(fixture.root, fixture.taskDir)]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /acceptance.*stale target binding/i);
  }
});

test('同一 target 一旦有 rejected acceptance 就不能复用旧 passed 交付', async () => {
  const fixture = await createFixture({ acceptancePolicy: 'required' });
  await initTask(fixture);
  await writeExecution(fixture);
  const target = await snapshotTarget(fixture);
  const generalReview = await appendGeneralReview(fixture, target);
  const passed = await appendAcceptance(fixture, target, 'passed', { anchor: 'A3' });
  await appendAcceptance(fixture, target, 'rejected', { anchor: 'A4' });
  const hash = await taskHash(fixture);
  await writeVerifiedClaims(fixture, hash);
  await writeDelivery(fixture, { target, generalReview, acceptance: passed });

  const result = run(fixture.root, ['validate-result', path.relative(fixture.root, fixture.taskDir)]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /target.*rejected acceptance|acceptance.*rejected/i);
});

test('rejected acceptance 的 target identity 缺字段时 fail closed', async () => {
  const fixture = await createFixture({ acceptancePolicy: 'required' });
  await initTask(fixture);
  await writeExecution(fixture);
  const target = await snapshotTarget(fixture);
  const generalReview = await appendGeneralReview(fixture, target);
  const passed = await appendAcceptance(fixture, target, 'passed', { anchor: 'A3' });
  await appendAcceptance(
    fixture,
    { kind: target.kind, baseCommit: target.baseCommit },
    'rejected',
    { anchor: 'A4' },
  );
  const hash = await taskHash(fixture);
  await writeVerifiedClaims(fixture, hash);
  await writeDelivery(fixture, { target, generalReview, acceptance: passed });

  const result = run(fixture.root, ['validate-result', path.relative(fixture.root, fixture.taskDir)]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /acceptance.*target.*missing fields.*executionHash/i);
});

test('rejected acceptance 的 target identity 拒绝非规范 OID 和 hash', async () => {
  const cases = [
    ['baseCommit', (target) => ({ ...target, baseCommit: 'HEAD' })],
    ['headCommit', (target) => ({
      kind: 'commit-range',
      baseCommit: target.baseCommit,
      headCommit: 'HEAD',
      executionHash: target.executionHash,
    })],
    ['executionHash', (target) => ({ ...target, executionHash: 'sha256:bad' })],
  ];
  for (const [field, malformedTarget] of cases) {
    const fixture = await createFixture({ acceptancePolicy: 'required' });
    await initTask(fixture);
    await writeExecution(fixture);
    const target = await snapshotTarget(fixture);
    const generalReview = await appendGeneralReview(fixture, target);
    const passed = await appendAcceptance(fixture, target, 'passed', { anchor: 'A3' });
    await appendAcceptance(
      fixture,
      malformedTarget(target),
      'rejected',
      { anchor: 'A4' },
    );
    const hash = await taskHash(fixture);
    await writeVerifiedClaims(fixture, hash);
    await writeDelivery(fixture, { target, generalReview, acceptance: passed });

    const result = run(fixture.root, ['validate-result', path.relative(fixture.root, fixture.taskDir)]);
    assert.equal(result.status, 1, `${field} unexpectedly passed`);
    assert.match(result.stderr, new RegExp(`acceptance.*target.*${field}`, 'i'));
  }
});

test('delivery.json 保持薄结构并拒绝内嵌完整证据', async () => {
  const fixture = await createFixture();
  const { target } = await prepareDelivered(fixture);
  const delivery = JSON.parse(await readFile(path.join(fixture.taskDir, 'delivery.json'), 'utf8'));
  assert.equal(delivery.evidenceRefs.acceptance, null);
  delivery.verification = [{ command: 'npm test', status: 'passed' }];
  delivery.changedFiles = ['src/slug.mjs'];
  delivery.generalReview = { verdict: 'passed' };
  delivery.claims = [{ claimId: 'C1' }];
  await writeFile(path.join(fixture.taskDir, 'delivery.json'), `${JSON.stringify(delivery, null, 2)}\n`);

  const result = run(fixture.root, ['validate-result', path.relative(fixture.root, fixture.taskDir)]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /unsupported fields.*verification.*changedFiles.*generalReview.*claims/);
  assert.equal(target.kind, 'no-change');
});

test('validate-result 接受三种 non-delivered 结果并约束 request kind', async () => {
  const cases = [
    ['needs-upstream', 'acceptance-change'],
    ['needs-reslice', 'reslice'],
    ['blocked', 'blocker'],
  ];
  for (const [resultStatus, requestKind] of cases) {
    const fixture = await createFixture();
    await initTask(fixture);
    await writeDelivery(fixture, {
      result: resultStatus,
      upstreamRequest: {
        kind: requestKind,
        summary: `${resultStatus} 原因。`,
        evidenceRefs: ['audits.md#A1'],
      },
    });
    const result = run(fixture.root, ['validate-result', path.relative(fixture.root, fixture.taskDir)]);
    assert.equal(result.status, 0, `${resultStatus}: ${result.stderr}`);
  }

  const fixture = await createFixture();
  await initTask(fixture);
  await writeDelivery(fixture, {
    result: 'needs-reslice',
    upstreamRequest: {
      kind: 'acceptance-change',
      summary: '错误分类。',
      evidenceRefs: ['audits.md#A1'],
    },
  });
  const result = run(fixture.root, ['validate-result', path.relative(fixture.root, fixture.taskDir)]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /needs-reslice.*reslice/);
});

test('三种 non-delivered 结果都拒绝空或不存在的 upstreamRequest evidence refs', async () => {
  const cases = [
    ['needs-upstream', 'user-acceptance'],
    ['needs-reslice', 'reslice'],
    ['blocked', 'blocker'],
  ];
  for (const [resultStatus, requestKind] of cases) {
    for (const evidenceRefs of [[], ['audits.md#A99']]) {
      const fixture = await createFixture();
      await initTask(fixture);
      await writeDelivery(fixture, {
        result: resultStatus,
        upstreamRequest: {
          kind: requestKind,
          summary: `${resultStatus} 原因。`,
          evidenceRefs,
        },
      });
      const result = run(fixture.root, ['validate-result', path.relative(fixture.root, fixture.taskDir)]);
      assert.equal(result.status, 1, `${resultStatus}/${JSON.stringify(evidenceRefs)} unexpectedly passed`);
      assert.match(result.stderr, /evidenceRefs.*must not be empty|evidence ref missing anchor/);
    }
  }
});

test('close-check 接受 delivered，并检测 stale task 与 stale Git target', async () => {
  const fixture = await createFixture({ commitPolicy: 'allowed' });
  await initTask(fixture);
  await writeExecution(fixture);
  await writeFile(path.join(fixture.root, 'src/slug.mjs'), "export const slug = (value) => value.trim().toLowerCase().replace(/\\s+/g, '-');\n");
  const target = await snapshotTarget(fixture);
  await appendGeneralReview(fixture, target);
  const hash = await taskHash(fixture);
  await writeVerifiedClaims(fixture, hash);
  await writeDelivery(fixture, { target });

  let result = run(fixture.root, ['close-check', path.relative(fixture.root, fixture.taskDir)]);
  assert.equal(result.status, 0, result.stderr);

  fixture.task.revision = 2;
  await writeFile(path.join(fixture.taskDir, 'task.json'), `${JSON.stringify(fixture.task, null, 2)}\n`);
  result = run(fixture.root, ['close-check', path.relative(fixture.root, fixture.taskDir)]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /stale task binding/);

  fixture.task.revision = 1;
  await writeFile(path.join(fixture.taskDir, 'task.json'), `${JSON.stringify(fixture.task, null, 2)}\n`);
  await writeFile(path.join(fixture.root, 'src/slug.mjs'), "export const slug = () => 'stale';\n");
  result = run(fixture.root, ['close-check', path.relative(fixture.root, fixture.taskDir)]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /worktree target.*changed|snapshotHash/);
});

test('delivered 拒绝未闭合 claims 和缺失 evidence ref', async () => {
  const fixture = await createFixture();
  await initTask(fixture);
  await writeExecution(fixture);
  const target = await snapshotTarget(fixture);
  await appendGeneralReview(fixture, target);
  await writeDelivery(fixture, { target });

  let result = run(fixture.root, ['close-check', path.relative(fixture.root, fixture.taskDir)]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /delivered.*at least one claim|claims.*verified/);

  const hash = await taskHash(fixture);
  await writeVerifiedClaims(fixture, hash, ['audits.md#A99']);
  result = run(fixture.root, ['close-check', path.relative(fixture.root, fixture.taskDir)]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /evidence ref missing anchor.*audits\.md#A99/);
});
