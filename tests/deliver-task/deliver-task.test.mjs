import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  access,
  appendFile,
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
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

function run(cwd, args, { input } = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd,
    encoding: 'utf8',
    input,
  });
}

async function createFixture({
  commitPolicy = 'allowed',
  caller = { kind: 'direct' },
  acceptancePolicy = 'not-required',
} = {}) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'deliver-task-test-')));
  await mkdir(path.join(root, 'src'), { recursive: true });
  await mkdir(path.join(root, 'test'), { recursive: true });
  await writeFile(path.join(root, 'src/slug.mjs'), "export const slug = (value) => value.trim().toLowerCase().replaceAll(' ', '-');\n");
  await writeFile(path.join(root, 'test/slug.test.mjs'), '// fixture\n');
  git(root, ['init', '-q']);
  git(root, ['add', 'src/slug.mjs', 'test/slug.test.mjs']);
  git(root, ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-q', '-m', '初始基线']);
  const baseCommit = git(root, ['rev-parse', 'HEAD']);
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
  return { root, taskDir: null, workspacePath: null, task, baseCommit };
}

async function createDetachedWorktree(fixture, prefix = 'deliver-task-provided-') {
  const workspacePath = await realpath(await mkdtemp(path.join(os.tmpdir(), prefix)));
  await rm(workspacePath, { recursive: true });
  git(fixture.root, ['worktree', 'add', '-q', '--detach', workspacePath, fixture.baseCommit]);
  return realpath(workspacePath);
}

function runStart(
  fixture,
  {
    task = fixture.task,
    repo = fixture.root,
    workspace,
    input = `${JSON.stringify(task)}\n`,
  } = {},
) {
  return run(
    fixture.root,
    ['start', repo, '-', ...(workspace ? ['--workspace', workspace] : [])],
    { input },
  );
}

function startTask(fixture, options = {}) {
  const result = runStart(fixture, options);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  fixture.taskDir = output.taskDir;
  fixture.workspacePath = output.workspacePath;
  return output;
}

function taskBinding(fixture, hash) {
  return {
    taskId: fixture.task.taskId,
    revision: fixture.task.revision,
    taskHash: hash,
  };
}

async function initTask(fixture) {
  const result = startTask(fixture, { workspace: fixture.root });
  await appendFile(
    path.join(fixture.taskDir, 'audits.md'),
    '\n### A1：上下文预检\n\n已读取真实代码和项目规则，并形成执行边界。\n',
  );
  return result;
}

async function taskHash(fixture) {
  const result = run(fixture.workspacePath ?? fixture.root, ['task-hash', fixture.taskDir]);
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
  const result = run(fixture.workspacePath, ['snapshot-target', fixture.taskDir]);
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

test('start 是唯一 bootstrap，并在 task workspace 内原子初始化固定状态', async () => {
  const fixture = await createFixture({
    caller: { kind: 'delegated', name: 'to-tickets', ref: 'tickets/slug-whitespace' },
  });

  const output = startTask(fixture);

  assert.deepEqual(Object.keys(output).sort(), [
    'baseCommit',
    'branch',
    'kind',
    'task',
    'taskDir',
    'workspacePath',
  ]);
  assert.equal(output.kind, 'git-worktree');
  assert.equal(output.baseCommit, fixture.baseCommit);
  assert.equal(output.task.taskId, fixture.task.taskId);
  assert.equal(output.task.revision, 1);
  assert.match(output.task.taskHash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(output.taskDir, path.join(output.workspacePath, '.dev-task'));
  assert.match(
    output.branch,
    /^refs\/heads\/deliver-task\/slug-whitespace-r1-[0-9a-f]{12}$/,
  );
  assert.deepEqual(
    JSON.parse(await readFile(path.join(output.taskDir, 'task.json'), 'utf8')),
    fixture.task,
  );
  const claims = JSON.parse(await readFile(path.join(output.taskDir, 'claims.json'), 'utf8'));
  assert.equal(claims.schemaVersion, 'deliver-task.claims.v1');
  assert.deepEqual(claims.task, output.task);
  assert.deepEqual(claims.claims, []);
  assert.match(await readFile(path.join(output.taskDir, 'audits.md'), 'utf8'), /# 单任务审计/);
  assert.equal(await readFile(path.join(output.taskDir, '.gitignore'), 'utf8'), '*\n');
  const workspace = JSON.parse(
    await readFile(path.join(output.taskDir, 'artifacts/workspace.json'), 'utf8'),
  );
  assert.deepEqual(workspace, {
    schemaVersion: 'deliver-task.workspace.v1',
    task: output.task,
    kind: output.kind,
    workspacePath: output.workspacePath,
    branch: output.branch,
    baseCommit: output.baseCommit,
  });
  await assert.rejects(access(path.join(output.taskDir, 'execution.json')));
  assert.equal(git(output.workspacePath, ['status', '--porcelain']), '');
});

test('默认 start 不触碰 dirty caller，只从 baseCommit 建立 task workspace', async () => {
  const fixture = await createFixture({ commitPolicy: 'required' });
  await writeFile(path.join(fixture.root, 'background-notes.md'), '用户任务外修改。\n');
  await writeFile(path.join(fixture.root, 'src/slug.mjs'), "export const slug = () => 'main-only';\n");
  git(fixture.root, ['add', 'src/slug.mjs']);
  git(fixture.root, ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-q', '-m', '用户主分支提交']);

  const output = startTask(fixture);

  assert.notEqual(output.workspacePath, await realpath(fixture.root));
  assert.equal(git(output.workspacePath, ['rev-parse', 'HEAD']), fixture.baseCommit);
  assert.doesNotMatch(
    await readFile(path.join(output.workspacePath, 'src/slug.mjs'), 'utf8'),
    /main-only/,
  );
  assert.equal(await readFile(path.join(fixture.root, 'background-notes.md'), 'utf8'), '用户任务外修改。\n');
  await assert.rejects(access(path.join(fixture.root, '.dev-task')));
  await assert.rejects(access(path.join(fixture.root, 'dev-tasks')));
  assert.equal(git(fixture.root, ['status', '--porcelain']), '?? background-notes.md');
  assert.equal(output.taskDir, path.join(output.workspacePath, '.dev-task'));
});

test('start 在 mutation 前拒绝非法 repo、stdin、exact schema 和非完整 baseCommit', async () => {
  const cases = [
    { input: '{', pattern: /task contract.*valid JSON/i },
    {
      task: (task) => ({ ...task, allowedPaths: ['src/**'] }),
      pattern: /unsupported fields.*allowedPaths/,
    },
    {
      task: (task) => ({ ...task, baseCommit: 'HEAD' }),
      pattern: /task\.baseCommit.*full Git commit OID/,
    },
  ];
  for (const testCase of cases) {
    const fixture = await createFixture();
    const beforeWorktrees = git(fixture.root, ['worktree', 'list', '--porcelain']);
    const beforeBranches = git(fixture.root, ['for-each-ref', '--format=%(refname)', 'refs/heads']);
    const task = testCase.task ? testCase.task(fixture.task) : fixture.task;
    const result = runStart(fixture, { task, input: testCase.input });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, testCase.pattern);
    assert.equal(git(fixture.root, ['worktree', 'list', '--porcelain']), beforeWorktrees);
    assert.equal(git(fixture.root, ['for-each-ref', '--format=%(refname)', 'refs/heads']), beforeBranches);
    await assert.rejects(access(path.join(fixture.root, '.dev-task')));
  }

  const fixture = await createFixture();
  const missingRepo = path.join(os.tmpdir(), `missing-deliver-task-repo-${Date.now()}`);
  const result = runStart(fixture, { repo: missingRepo });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /repository directory missing/i);
  await assert.rejects(access(path.join(fixture.root, '.dev-task')));
});

test('provided workspace 首次绑定要求同仓、干净且位于 baseCommit', async () => {
  {
    const fixture = await createFixture();
    const output = startTask(fixture, { workspace: path.join(fixture.root, 'src') });
    assert.equal(output.kind, 'provided');
    assert.equal(output.workspacePath, await realpath(fixture.root));
    assert.equal(output.taskDir, path.join(await realpath(fixture.root), '.dev-task'));
    assert.equal(output.branch, 'refs/heads/master');
  }

  {
    const fixture = await createFixture();
    await writeFile(path.join(fixture.root, 'background-notes.md'), '保留。\n');
    const result = runStart(fixture, { workspace: fixture.root });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /provided workspace.*clean.*background-notes\.md/i);
    assert.equal(await readFile(path.join(fixture.root, 'background-notes.md'), 'utf8'), '保留。\n');
    await assert.rejects(access(path.join(fixture.root, '.dev-task')));
  }

  {
    const fixture = await createFixture();
    const unrelated = await createFixture();
    const result = runStart(fixture, { workspace: unrelated.root });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /same Git repository/i);
    await assert.rejects(access(path.join(unrelated.root, '.dev-task')));
  }
});

test('start 显式绑定当前 harness linked worktree，不创建第二个 workspace', async () => {
  const fixture = await createFixture();
  const harnessRoot = await createDetachedWorktree(fixture, 'deliver-task-harness-');
  const before = git(fixture.root, ['worktree', 'list', '--porcelain']);

  const output = startTask(fixture, { repo: harnessRoot, workspace: harnessRoot });

  assert.equal(output.kind, 'provided');
  assert.equal(output.workspacePath, await realpath(harnessRoot));
  assert.equal(output.taskDir, path.join(output.workspacePath, '.dev-task'));
  assert.equal(output.branch, null);
  assert.equal(git(fixture.root, ['worktree', 'list', '--porcelain']), before);
  await assert.rejects(access(path.join(fixture.root, '.dev-task')));
});

test('provided workspace 首次初始化拒绝为 exact identity 创建第二个 execution world', async () => {
  const fixture = await createFixture();
  const existing = startTask(fixture);
  const providedWorkspace = await createDetachedWorktree(fixture);

  const result = runStart(fixture, { workspace: providedWorkspace });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /task identity.*already bound.*workspace/i);
  await assert.rejects(access(path.join(providedWorkspace, '.dev-task')));
  assert.deepEqual(
    JSON.parse(await readFile(path.join(existing.taskDir, 'task.json'), 'utf8')),
    fixture.task,
  );
});

test('provided workspace 首次初始化拒绝已有 execution world 的同 revision 合同漂移', async () => {
  const fixture = await createFixture();
  startTask(fixture);
  const providedWorkspace = await createDetachedWorktree(fixture);
  const drifted = { ...fixture.task, objective: '未递增 revision 的错误合同变化。' };

  const result = runStart(fixture, { task: drifted, workspace: providedWorkspace });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /same revision.*contract drift/i);
  await assert.rejects(access(path.join(providedWorkspace, '.dev-task')));
});

test('provided workspace 不得绕过已有 task branch 的 proof-loss fail closed', async () => {
  const fixture = await createFixture();
  const existing = startTask(fixture);
  const providedWorkspace = await createDetachedWorktree(fixture);
  await rm(existing.taskDir, { recursive: true });

  const result = runStart(fixture, { workspace: providedWorkspace });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /task branch.*proof.*missing|proof state.*missing/i);
  await assert.rejects(access(path.join(providedWorkspace, '.dev-task')));
});

test('exact identity 的完整 .dev-task 幂等返回且不重写证据', async () => {
  const fixture = await createFixture();
  const first = startTask(fixture);
  await appendFile(path.join(fixture.taskDir, 'audits.md'), '\n### A1：保留证据\n\n不得重写。\n');
  const claims = JSON.parse(await readFile(path.join(fixture.taskDir, 'claims.json'), 'utf8'));
  claims.claims.push({
    claimId: 'C1',
    statement: '已有声明。',
    status: 'proposed',
    evidenceRefs: [],
  });
  await writeFile(path.join(fixture.taskDir, 'claims.json'), `${JSON.stringify(claims, null, 2)}\n`);
  const beforeAudits = await readFile(path.join(fixture.taskDir, 'audits.md'), 'utf8');
  const beforeClaims = await readFile(path.join(fixture.taskDir, 'claims.json'), 'utf8');

  const second = startTask(fixture);

  assert.deepEqual(second, first);
  assert.equal(await readFile(path.join(fixture.taskDir, 'audits.md'), 'utf8'), beforeAudits);
  assert.equal(await readFile(path.join(fixture.taskDir, 'claims.json'), 'utf8'), beforeClaims);
});

test('同 revision 合同漂移 fail closed，不创建第二个 branch 或 workspace', async () => {
  const fixture = await createFixture();
  startTask(fixture);
  const beforeWorktrees = git(fixture.root, ['worktree', 'list', '--porcelain']);
  const beforeBranches = git(fixture.root, ['for-each-ref', '--format=%(refname)', 'refs/heads/deliver-task']);
  const drifted = { ...fixture.task, objective: '未递增 revision 的错误合同变化。' };

  const result = runStart(fixture, { task: drifted });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /same revision.*contract drift/i);
  assert.equal(git(fixture.root, ['worktree', 'list', '--porcelain']), beforeWorktrees);
  assert.equal(git(fixture.root, ['for-each-ref', '--format=%(refname)', 'refs/heads/deliver-task']), beforeBranches);

  const providedFixture = await createFixture();
  const providedFirst = startTask(providedFixture, { workspace: providedFixture.root });
  const providedExact = startTask(providedFixture);
  assert.deepEqual(providedExact, providedFirst);
  const providedBeforeWorktrees = git(providedFixture.root, ['worktree', 'list', '--porcelain']);
  const providedDrift = {
    ...providedFixture.task,
    objective: 'provided workspace 中未递增 revision 的错误合同变化。',
  };

  const providedResult = runStart(providedFixture, { task: providedDrift });

  assert.equal(providedResult.status, 1);
  assert.match(providedResult.stderr, /same revision.*contract drift/i);
  assert.equal(
    git(providedFixture.root, ['worktree', 'list', '--porcelain']),
    providedBeforeWorktrees,
  );
});

test('更高 revision 默认建立新的确定性 branch 和 worktree', async () => {
  const fixture = await createFixture();
  const previous = startTask(fixture);
  fixture.task = { ...fixture.task, revision: 2, objective: '显式改变后的目标。' };

  const current = startTask(fixture);

  assert.equal(current.task.revision, 2);
  assert.notEqual(current.workspacePath, previous.workspacePath);
  assert.notEqual(current.branch, previous.branch);
  assert.match(current.branch, /^refs\/heads\/deliver-task\/slug-whitespace-r2-[0-9a-f]{12}$/);
  assert.equal(git(current.workspacePath, ['rev-parse', 'HEAD']), fixture.baseCommit);
  assert.equal(JSON.parse(await readFile(path.join(previous.taskDir, 'task.json'), 'utf8')).revision, 1);
});

test('provided workspace 已含旧 identity 时拒绝 higher revision 且不覆盖旧状态', async () => {
  const fixture = await createFixture();
  const previous = startTask(fixture, { workspace: fixture.root });
  await appendFile(path.join(previous.taskDir, 'audits.md'), '\n### A1：旧证据\n\n保留。\n');
  const beforeTask = await readFile(path.join(previous.taskDir, 'task.json'), 'utf8');
  const beforeAudits = await readFile(path.join(previous.taskDir, 'audits.md'), 'utf8');
  const next = { ...fixture.task, revision: 2, objective: '新 revision。' };

  const result = runStart(fixture, { task: next, workspace: fixture.root });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /provided workspace.*existing task identity/i);
  assert.equal(await readFile(path.join(previous.taskDir, 'task.json'), 'utf8'), beforeTask);
  assert.equal(await readFile(path.join(previous.taskDir, 'audits.md'), 'utf8'), beforeAudits);
});

test('已有 branch/worktree 但证明缺失或不完整时拒绝恢复', async () => {
  {
    const fixture = await createFixture();
    const output = startTask(fixture);
    await writeFile(path.join(output.workspacePath, 'src/slug.mjs'), "export const slug = () => 'kept';\n");
    git(output.workspacePath, ['add', 'src/slug.mjs']);
    git(output.workspacePath, ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-q', '-m', '保留业务成果']);
    await rm(output.taskDir, { recursive: true });

    const result = runStart(fixture);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /proof state.*missing/i);
    assert.equal(git(output.workspacePath, ['rev-parse', '--abbrev-ref', 'HEAD']), output.branch.slice('refs/heads/'.length));
    await assert.rejects(access(output.taskDir));
  }

  {
    const fixture = await createFixture();
    const output = startTask(fixture);
    await unlink(path.join(output.taskDir, 'claims.json'));

    const result = runStart(fixture);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /proof state.*incomplete|claims\.json.*missing/i);
    await assert.rejects(access(path.join(output.taskDir, 'claims.json')));
  }
});

test('默认 workspace 初始化失败时回滚本次新建 worktree 和 branch', async () => {
  const fixture = await createFixture();
  await writeFile(path.join(fixture.root, '.dev-task'), '仓库原有冲突文件。\n');
  git(fixture.root, ['add', '-f', '.dev-task']);
  git(fixture.root, ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-q', '-m', '加入冲突路径']);
  fixture.baseCommit = git(fixture.root, ['rev-parse', 'HEAD']);
  fixture.task = { ...fixture.task, baseCommit: fixture.baseCommit };
  const beforeWorktrees = git(fixture.root, ['worktree', 'list', '--porcelain']);
  const beforeBranches = git(fixture.root, ['for-each-ref', '--format=%(refname)', 'refs/heads/deliver-task']);

  const result = runStart(fixture);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /\.dev-task.*directory|proof state/i);
  assert.equal(git(fixture.root, ['worktree', 'list', '--porcelain']), beforeWorktrees);
  assert.equal(git(fixture.root, ['for-each-ref', '--format=%(refname)', 'refs/heads/deliver-task']), beforeBranches);
  assert.equal(await readFile(path.join(fixture.root, '.dev-task'), 'utf8'), '仓库原有冲突文件。\n');
});

test('.dev-task 默认 self-ignore，强制进入 index 或 commit 时 target boundary 拒绝', async () => {
  for (const commitState of ['staged', 'committed']) {
    const fixture = await createFixture();
    await initTask(fixture);
    await writeExecution(fixture, { allowedPaths: ['**'] });
    assert.equal(git(fixture.root, ['status', '--porcelain']), '');
    git(fixture.root, ['add', '-f', '.dev-task/task.json']);
    if (commitState === 'committed') {
      git(fixture.root, ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-q', '-m', '错误提交证明状态']);
    }

    const result = run(fixture.root, ['snapshot-target', fixture.taskDir]);
    assert.equal(result.status, 1, `${commitState} unexpectedly passed`);
    assert.match(result.stderr, /task-owned artifact path \.dev-task\/task\.json/);
  }
});

test('旧 bootstrap 命令和其它命令的隐式 bootstrap 均被拒绝', async () => {
  const fixture = await createFixture();
  for (const command of ['validate-task', 'prepare-workspace', 'init']) {
    const result = run(fixture.root, [command, fixture.root]);
    assert.equal(result.status, 2, `${command} unexpectedly passed`);
    assert.match(result.stderr, /unknown command/i);
  }
  for (const command of ['task-hash', 'validate-execution', 'snapshot-target', 'validate-result', 'close-check']) {
    const result = run(fixture.root, [command, path.join(fixture.root, '.dev-task')]);
    assert.notEqual(result.status, 0, `${command} unexpectedly bootstrapped`);
  }
  await assert.rejects(access(path.join(fixture.root, '.dev-task')));
  assert.equal(git(fixture.root, ['for-each-ref', '--format=%(refname)', 'refs/heads/deliver-task']), '');
});

test('start 接受 exact task schema 与通用 caller，并拒绝旧字段或非法 caller', async () => {
  for (const caller of [
    { kind: 'direct' },
    { kind: 'delegated', name: 'to-tickets', ref: 'tickets/slug-whitespace' },
    { kind: 'delegated', name: 'release-pipeline', ref: 'tasks/release-1' },
  ]) {
    const fixture = await createFixture({ caller });
    const result = runStart(fixture, { workspace: fixture.root });
    assert.equal(result.status, 0, `${JSON.stringify(caller)}: ${result.stderr}`);
  }

  const invalidTasks = [
    (task) => ({ ...task, allowedPaths: ['src/**'], upstreamAcceptance: { status: 'not-required' } }),
    (task) => ({ ...task, caller: { kind: 'direct', ref: 'unexpected' } }),
    (task) => ({ ...task, caller: { kind: 'delegated', ref: 'tickets/slug-whitespace' } }),
    (task) => ({ ...task, caller: { kind: 'delegated', name: 'ToTickets', ref: 'x' } }),
    (task) => ({ ...task, caller: { kind: 'planner', ref: 'x' } }),
  ];
  for (const buildTask of invalidTasks) {
    const fixture = await createFixture();
    const result = runStart(fixture, { task: buildTask(fixture.task), workspace: fixture.root });
    assert.equal(result.status, 1, result.stderr);
    await assert.rejects(access(path.join(fixture.root, '.dev-task')));
  }
});

test('task hash 对 key 顺序稳定，execution 调整不改 identity，原地合同漂移被拒绝', async () => {
  const fixture = await createFixture();
  await initTask(fixture);
  const first = await taskHash(fixture);
  assert.match(first, /^sha256:[0-9a-f]{64}$/);

  const reordered = Object.fromEntries(Object.entries(fixture.task).reverse());
  await writeFile(path.join(fixture.taskDir, 'task.json'), `${JSON.stringify(reordered, null, 2)}\n`);
  assert.equal(await taskHash(fixture), first);

  await writeExecution(fixture);
  assert.equal(await taskHash(fixture), first);
  await writeExecution(fixture, { allowedPaths: ['src/**', 'test/**'] });
  assert.equal(await taskHash(fixture), first);

  reordered.objective = '改变后的目标。';
  await writeFile(path.join(fixture.taskDir, 'task.json'), `${JSON.stringify(reordered, null, 2)}\n`);
  const result = run(fixture.root, ['task-hash', fixture.taskDir]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /workspace\.task.*stale task binding/);
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
