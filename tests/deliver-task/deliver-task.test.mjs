import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
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

async function createFixture({ commitPolicy = 'allowed', caller = { kind: 'direct' } } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'deliver-task-test-'));
  await mkdir(path.join(root, 'src'), { recursive: true });
  await mkdir(path.join(root, 'test'), { recursive: true });
  await writeFile(path.join(root, 'src/slug.mjs'), "export const slug = (value) => value.trim().toLowerCase().replaceAll(' ', '-');\n");
  await writeFile(path.join(root, 'test/slug.test.mjs'), "// fixture\n");
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
    allowedPaths: ['src/slug.mjs', 'test/slug.test.mjs'],
    forbiddenPaths: ['package.json'],
    baseCommit,
    commitPolicy,
    upstreamAcceptance: { status: 'not-required' },
  };
  await writeFile(path.join(taskDir, 'task.json'), `${JSON.stringify(task, null, 2)}\n`);
  return { root, taskDir, task, baseCommit };
}

async function initTask(fixture) {
  const result = run(fixture.root, ['init', path.relative(fixture.root, fixture.taskDir)]);
  assert.equal(result.status, 0, result.stderr);
  return result;
}

async function taskHash(fixture) {
  const result = run(fixture.root, ['task-hash', path.relative(fixture.root, fixture.taskDir)]);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

async function writeVerifiedClaims(fixture, hash) {
  const claims = {
    schemaVersion: 'deliver-task.claims.v1',
    task: {
      taskId: fixture.task.taskId,
      revision: fixture.task.revision,
      taskHash: hash,
    },
    claims: [
      {
        claimId: 'C1',
        statement: '连续空白已归一为一个连字符。',
        status: 'verified',
        evidenceRefs: ['audits.md#A1'],
      },
    ],
  };
  await writeFile(path.join(fixture.taskDir, 'claims.json'), `${JSON.stringify(claims, null, 2)}\n`);
  await writeFile(
    path.join(fixture.taskDir, 'audits.md'),
    '# 单任务审计\n\n### A1：验证\n\n测试通过。\n\n### A2：General Review\n\n最终累计 full clean。\n',
  );
}

async function writeDelivery(fixture, { result = 'delivered', target, upstreamRequest = null } = {}) {
  const hash = await taskHash(fixture);
  const delivery = {
    schemaVersion: 'deliver-task.delivery.v1',
    task: {
      taskId: fixture.task.taskId,
      revision: fixture.task.revision,
      taskHash: hash,
    },
    result,
    target: target ?? null,
    evidenceRefs:
      result === 'delivered'
        ? {
            claims: 'claims.json',
            verification: 'audits.md#A1',
            generalReview: 'audits.md#A2',
            rulesReview: 'not-applicable',
          }
        : {
            claims: 'claims.json',
            verification: null,
            generalReview: null,
            rulesReview: null,
          },
    residualRiskRefs: [],
    upstreamRequest,
  };
  await writeFile(path.join(fixture.taskDir, 'delivery.json'), `${JSON.stringify(delivery, null, 2)}\n`);
  return delivery;
}

test('init 只在 task-owned directory 创建持久状态', async () => {
  const fixture = await createFixture({
    caller: { kind: 'sliced-dev', ref: 'dev-plans/example#S1' },
  });
  const callerPlan = path.join(fixture.root, 'dev-plans/example/plan.md');
  await mkdir(path.dirname(callerPlan), { recursive: true });
  await writeFile(callerPlan, 'S1: in-progress\ncurrent: S1\n');

  await initTask(fixture);

  assert.equal(await readFile(callerPlan, 'utf8'), 'S1: in-progress\ncurrent: S1\n');
  assert.match(await readFile(path.join(fixture.taskDir, '.gitignore'), 'utf8'), /^\/artifacts\/$/m);
  const claims = JSON.parse(await readFile(path.join(fixture.taskDir, 'claims.json'), 'utf8'));
  assert.equal(claims.schemaVersion, 'deliver-task.claims.v1');
  assert.equal(claims.task.taskId, 'slug-whitespace');
  assert.deepEqual(claims.claims, []);
  assert.match(await readFile(path.join(fixture.taskDir, 'audits.md'), 'utf8'), /# 单任务审计/);
});

test('validate-task 接受三种 commitPolicy 并拒绝未知策略', async () => {
  for (const commitPolicy of ['required', 'allowed', 'forbidden']) {
    const fixture = await createFixture({ commitPolicy });
    const result = run(fixture.root, ['validate-task', path.relative(fixture.root, fixture.taskDir)]);
    assert.equal(result.status, 0, `${commitPolicy}: ${result.stderr}`);
  }

  const fixture = await createFixture();
  fixture.task.commitPolicy = 'always';
  await writeFile(path.join(fixture.taskDir, 'task.json'), `${JSON.stringify(fixture.task, null, 2)}\n`);
  const result = run(fixture.root, ['validate-task', path.relative(fixture.root, fixture.taskDir)]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /commitPolicy.*required.*allowed.*forbidden/);
});

test('task-hash 对 JSON key 顺序稳定，对契约变化敏感', async () => {
  const fixture = await createFixture();
  const first = await taskHash(fixture);
  assert.match(first, /^sha256:[0-9a-f]{64}$/);

  const reordered = Object.fromEntries(Object.entries(fixture.task).reverse());
  await writeFile(path.join(fixture.taskDir, 'task.json'), `${JSON.stringify(reordered, null, 2)}\n`);
  assert.equal(await taskHash(fixture), first);

  reordered.objective = '改变后的目标。';
  await writeFile(path.join(fixture.taskDir, 'task.json'), `${JSON.stringify(reordered, null, 2)}\n`);
  assert.notEqual(await taskHash(fixture), first);
});

test('required 策略拒绝未提交代码并接受已提交 range', async () => {
  const fixture = await createFixture({ commitPolicy: 'required' });
  await initTask(fixture);
  await writeFile(path.join(fixture.root, 'src/slug.mjs'), "export const slug = (value) => value.trim().toLowerCase().replace(/\\s+/g, '-');\n");

  let result = run(fixture.root, ['snapshot-target', path.relative(fixture.root, fixture.taskDir)]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /commitPolicy required.*committed target/);

  git(fixture.root, ['add', 'src/slug.mjs']);
  git(fixture.root, ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-q', '-m', '修复空白归一']);
  result = run(fixture.root, ['snapshot-target', path.relative(fixture.root, fixture.taskDir)]);
  assert.equal(result.status, 0, result.stderr);
  const target = JSON.parse(result.stdout);
  assert.deepEqual(target, {
    kind: 'commit-range',
    baseCommit: fixture.baseCommit,
    headCommit: git(fixture.root, ['rev-parse', 'HEAD']),
  });
});

test('allowed 策略可交付未提交 worktree target', async () => {
  const fixture = await createFixture({ commitPolicy: 'allowed' });
  await initTask(fixture);
  await writeFile(path.join(fixture.root, 'src/slug.mjs'), "export const slug = (value) => value.trim().toLowerCase().replace(/\\s+/g, '-');\n");

  const result = run(fixture.root, ['snapshot-target', path.relative(fixture.root, fixture.taskDir)]);
  assert.equal(result.status, 0, result.stderr);
  const target = JSON.parse(result.stdout);
  assert.equal(target.kind, 'worktree');
  assert.equal(target.baseCommit, fixture.baseCommit);
  assert.match(target.snapshotHash, /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(Object.keys(target).sort(), ['baseCommit', 'kind', 'snapshotHash']);
});

test('forbidden 策略拒绝业务 commit 并接受未提交 target', async () => {
  const fixture = await createFixture({ commitPolicy: 'forbidden' });
  await initTask(fixture);
  await writeFile(path.join(fixture.root, 'src/slug.mjs'), "export const slug = (value) => value.trim().toLowerCase().replace(/\\s+/g, '-');\n");

  let result = run(fixture.root, ['snapshot-target', path.relative(fixture.root, fixture.taskDir)]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).kind, 'worktree');

  git(fixture.root, ['add', 'src/slug.mjs']);
  git(fixture.root, ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-q', '-m', '不应允许的提交']);
  result = run(fixture.root, ['snapshot-target', path.relative(fixture.root, fixture.taskDir)]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /commitPolicy forbidden.*HEAD.*baseCommit/);
});

test('snapshot-target 拒绝越过 allowedPaths 或命中 forbiddenPaths', async () => {
  const fixture = await createFixture({ commitPolicy: 'allowed' });
  await initTask(fixture);
  await writeFile(path.join(fixture.root, 'package.json'), '{}\n');

  const result = run(fixture.root, ['snapshot-target', path.relative(fixture.root, fixture.taskDir)]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /package\.json.*forbiddenPaths/);
});

test('delivery.json 是薄结果契约并拒绝内嵌完整证据', async () => {
  const fixture = await createFixture();
  await initTask(fixture);
  const targetResult = run(fixture.root, ['snapshot-target', path.relative(fixture.root, fixture.taskDir)]);
  assert.equal(targetResult.status, 0, targetResult.stderr);
  const delivery = await writeDelivery(fixture, { target: JSON.parse(targetResult.stdout) });
  delivery.verification = [{ command: 'npm test', status: 'passed' }];
  delivery.changedFiles = ['src/slug.mjs'];
  delivery.generalReview = { verdict: 'passed' };
  delivery.claims = [{ claimId: 'C1' }];
  await writeFile(path.join(fixture.taskDir, 'delivery.json'), `${JSON.stringify(delivery, null, 2)}\n`);

  const result = run(fixture.root, ['validate-result', path.relative(fixture.root, fixture.taskDir)]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /unsupported fields.*verification.*changedFiles.*generalReview.*claims/);
});

test('validate-result 接受四种结果并约束 upstreamRequest 类型', async () => {
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
      evidenceRefs: [],
    },
  });
  const result = run(fixture.root, ['validate-result', path.relative(fixture.root, fixture.taskDir)]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /needs-reslice.*reslice/);
});

test('close-check 接受未提交 delivered，并检测 stale task 与 stale target', async () => {
  const fixture = await createFixture({ commitPolicy: 'allowed' });
  await initTask(fixture);
  await writeFile(path.join(fixture.root, 'src/slug.mjs'), "export const slug = (value) => value.trim().toLowerCase().replace(/\\s+/g, '-');\n");
  const targetResult = run(fixture.root, ['snapshot-target', path.relative(fixture.root, fixture.taskDir)]);
  assert.equal(targetResult.status, 0, targetResult.stderr);
  const target = JSON.parse(targetResult.stdout);
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
  const targetResult = run(fixture.root, ['snapshot-target', path.relative(fixture.root, fixture.taskDir)]);
  assert.equal(targetResult.status, 0, targetResult.stderr);
  await writeDelivery(fixture, { target: JSON.parse(targetResult.stdout) });

  let result = run(fixture.root, ['close-check', path.relative(fixture.root, fixture.taskDir)]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /delivered.*at least one claim|claims.*verified/);

  const hash = await taskHash(fixture);
  await writeVerifiedClaims(fixture, hash);
  await writeFile(path.join(fixture.taskDir, 'audits.md'), '# 单任务审计\n');
  result = run(fixture.root, ['close-check', path.relative(fixture.root, fixture.taskDir)]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /evidence ref.*audits\.md#A1/);
});
