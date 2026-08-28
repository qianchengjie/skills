import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  access,
  appendFile,
  chmod,
  copyFile,
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
  rulesReviewPolicy = 'required',
  initialRepairPolicy = 'approval-required',
  ignoreWorktrees = true,
  architectureContent = '- [x] Controller snapshot 是核心运行状态唯一可写真源。\n',
} = {}) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'deliver-task-test-')));
  await mkdir(path.join(root, 'src'), { recursive: true });
  await mkdir(path.join(root, 'test'), { recursive: true });
  await mkdir(path.join(root, 'specs/reception'), { recursive: true });
  await writeFile(path.join(root, 'src/slug.mjs'), "export const slug = (value) => value.trim().toLowerCase().replaceAll(' ', '-');\n");
  await writeFile(path.join(root, 'test/slug.test.mjs'), '// fixture\n');
  const architecturePath = path.join(root, 'specs/reception/ARCHITECTURE.md');
  await writeFile(architecturePath, architectureContent);
  if (ignoreWorktrees) await writeFile(path.join(root, '.gitignore'), '.worktrees/\n');
  git(root, ['init', '-q']);
  git(root, [
    'add',
    ...(ignoreWorktrees ? ['.gitignore'] : []),
    'specs/reception/ARCHITECTURE.md',
    'src/slug.mjs',
    'test/slug.test.mjs',
  ]);
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
    rulesReviewPolicy,
    initialRepairPolicy,
  };
  return { root, taskDir: null, workspacePath: null, task, baseCommit, architecturePath };
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
    architecturePath = null,
    evidenceRefs = ['audits.md#A1'],
  } = {},
) {
  const hash = await taskHash(fixture);
  const execution = {
    schemaVersion: 'deliver-task.execution.v1',
    task: taskBinding(fixture, hash),
    allowedPaths,
    forbiddenPaths,
    architecturePath,
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

test('start 是唯一 bootstrap，并在 task workspace 内原子初始化固定状态', async () => {
  const fixture = await createFixture({
    caller: { kind: 'delegated', name: 'scope-planner', ref: 'delivery-scopes/slug-whitespace' },
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
  await assert.rejects(access(path.join(output.taskDir, 'claims.json')));
  await assert.rejects(access(path.join(output.taskDir, 'delivery.json')));
  assert.match(await readFile(path.join(output.taskDir, 'audits.md'), 'utf8'), /# 交付审计/);
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

test('默认 start 在 .worktrees 未被 ignore 时 fail closed 且不创建 worktree', async () => {
  const fixture = await createFixture({ ignoreWorktrees: false });
  const beforeWorktrees = git(fixture.root, ['worktree', 'list', '--porcelain']);
  const beforeBranches = git(fixture.root, [
    'for-each-ref',
    '--format=%(refname)',
    'refs/heads/deliver-task',
  ]);

  const result = runStart(fixture);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /fallback requires.*\.worktrees.*ignored/i);
  assert.equal(git(fixture.root, ['worktree', 'list', '--porcelain']), beforeWorktrees);
  assert.equal(
    git(fixture.root, ['for-each-ref', '--format=%(refname)', 'refs/heads/deliver-task']),
    beforeBranches,
  );
  await assert.rejects(access(path.join(fixture.root, '.worktrees')));
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

test('start 只接受不含 Architecture binding 的 task.v1', async () => {
  const fixture = await createFixture();
  const result = runStart(fixture, { workspace: fixture.root });
  assert.equal(result.status, 0, result.stderr);

  const v2Fixture = await createFixture();
  const v2Result = runStart(v2Fixture, {
    task: { ...v2Fixture.task, schemaVersion: 'deliver-task.task.v2' },
    workspace: v2Fixture.root,
  });
  assert.equal(v2Result.status, 1, v2Result.stderr);
  assert.match(v2Result.stderr, /task\.schemaVersion must be deliver-task\.task\.v1/i);
  await assert.rejects(access(path.join(v2Fixture.root, '.dev-task')));

  const extraFieldFixture = await createFixture();
  const extraFieldResult = runStart(extraFieldFixture, {
    task: { ...extraFieldFixture.task, architecturePath: null },
    workspace: extraFieldFixture.root,
  });
  assert.equal(extraFieldResult.status, 1, extraFieldResult.stderr);
  assert.match(extraFieldResult.stderr, /task\.json.*unsupported fields.*architecturePath/i);
  await assert.rejects(access(path.join(extraFieldFixture.root, '.dev-task')));
});

test('execution Architecture binding 必填且显式 null 不读取默认文件', async () => {
  const fixture = await createFixture();
  await initTask(fixture);
  await unlink(fixture.architecturePath);

  const execution = await writeExecution(fixture, { architecturePath: null });
  let result = run(fixture.workspacePath, ['validate-execution', fixture.taskDir]);
  assert.equal(result.status, 0, result.stderr);

  delete execution.architecturePath;
  await writeFile(path.join(fixture.taskDir, 'execution.json'), `${JSON.stringify(execution, null, 2)}\n`);
  result = run(fixture.workspacePath, ['validate-execution', fixture.taskDir]);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /execution\.json missing fields: architecturePath/i);
});

test('execution 的 path binding 校验绝对 ARCHITECTURE.md 路径与确认终态', async () => {
  const cases = [
    {
      architecturePath: 'specs/reception/ARCHITECTURE.md',
      pattern: /execution\.architecturePath.*absolute/i,
    },
    {
      architecturePath: (fixture) =>
        `${path.dirname(fixture.architecturePath)}/../reception/ARCHITECTURE.md`,
      pattern: /execution\.architecturePath.*normalized/i,
    },
    {
      architecturePath: (fixture) => path.join(path.dirname(fixture.architecturePath), 'design.md'),
      pattern: /execution\.architecturePath.*ARCHITECTURE\.md/i,
    },
    {
      architectureContent: '- [ ] Reception ownership 调整。\n',
      pattern: /Architecture.*unchecked.*\[ \]/i,
    },
    {
      architectureContent: '# Architecture\n\n尚未记录确认单元。\n',
      pattern: /Architecture.*confirmed.*\[x\]/i,
    },
  ];

  for (const testCase of cases) {
    const fixture = await createFixture({ architectureContent: testCase.architectureContent });
    await initTask(fixture);
    await writeExecution(fixture, {
      architecturePath:
        typeof testCase.architecturePath === 'function'
          ? testCase.architecturePath(fixture)
          : testCase.architecturePath ?? fixture.architecturePath,
    });
    const result = run(fixture.workspacePath, ['validate-execution', fixture.taskDir]);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, testCase.pattern);
  }

  const missingFixture = await createFixture();
  await initTask(missingFixture);
  await unlink(missingFixture.architecturePath);
  await writeExecution(missingFixture, { architecturePath: missingFixture.architecturePath });
  const missingResult = run(missingFixture.workspacePath, ['validate-execution', missingFixture.taskDir]);
  assert.equal(missingResult.status, 1, missingResult.stderr);
  assert.match(missingResult.stderr, /Architecture.*missing or unreadable/i);
});

test('Architecture 只识别 Markdown checklist 行并在执行中活读取', async () => {
  const fixture = await createFixture({
    architectureContent: '说明：`[ ]` 表示待确认，`[x]` 表示已确认。\n\n- [x] Page 是唯一 React subscriber。\n',
  });
  await initTask(fixture);
  await writeExecution(fixture, { architecturePath: fixture.architecturePath });

  let result = run(fixture.workspacePath, ['validate-execution', fixture.taskDir]);
  assert.equal(result.status, 0, result.stderr);

  await writeFile(
    fixture.architecturePath,
    '- [x] Controller snapshot 是核心运行状态唯一可写真源。\n- [ ] Reception ownership 调整。\n',
  );

  result = run(fixture.workspacePath, ['validate-execution', fixture.taskDir]);

  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /Architecture.*unchecked.*\[ \]/i);
});

test('Architecture binding 变化只改变 executionHash', async () => {
  const fixture = await createFixture();
  await initTask(fixture);
  const stableTaskHash = await taskHash(fixture);

  await writeExecution(fixture, { architecturePath: null });
  let result = run(fixture.workspacePath, ['validate-execution', fixture.taskDir]);
  assert.equal(result.status, 0, result.stderr);
  const nullHash = result.stdout.trim();

  await writeExecution(fixture, { architecturePath: fixture.architecturePath });
  result = run(fixture.workspacePath, ['validate-execution', fixture.taskDir]);
  assert.equal(result.status, 0, result.stderr);
  const firstPathHash = result.stdout.trim();

  const alternatePath = path.join(fixture.root, 'specs/alternate/ARCHITECTURE.md');
  await mkdir(path.dirname(alternatePath), { recursive: true });
  await writeFile(alternatePath, '- [x] Skin 不取得 Controller。\n');
  await writeExecution(fixture, { architecturePath: alternatePath });
  result = run(fixture.workspacePath, ['validate-execution', fixture.taskDir]);
  assert.equal(result.status, 0, result.stderr);
  const secondPathHash = result.stdout.trim();

  await writeExecution(fixture, { architecturePath: null });
  result = run(fixture.workspacePath, ['validate-execution', fixture.taskDir]);
  assert.equal(result.status, 0, result.stderr);

  assert.notEqual(firstPathHash, nullHash);
  assert.notEqual(secondPathHash, firstPathHash);
  assert.equal(result.stdout.trim(), nullHash);
  assert.equal(await taskHash(fixture), stableTaskHash);
});

test('同一路径 Architecture 正文变化不改变 executionHash', async () => {
  const fixture = await createFixture();
  await initTask(fixture);
  await writeExecution(fixture, { architecturePath: fixture.architecturePath });

  let result = run(fixture.workspacePath, ['validate-execution', fixture.taskDir]);
  assert.equal(result.status, 0, result.stderr);
  const initialHash = result.stdout.trim();

  await writeFile(fixture.architecturePath, '- [ ] Controller ownership 待确认。\n');
  result = run(fixture.workspacePath, ['validate-execution', fixture.taskDir]);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /Architecture.*unchecked.*\[ \]/i);

  await writeFile(fixture.architecturePath, '- [x] Controller ownership 由 Page 持有。\n');
  result = run(fixture.workspacePath, ['validate-execution', fixture.taskDir]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), initialHash);
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

test('provided workspace 不得绕过已有 task branch 的 task-state-loss fail closed', async () => {
  const fixture = await createFixture();
  const existing = startTask(fixture);
  const providedWorkspace = await createDetachedWorktree(fixture);
  await rm(existing.taskDir, { recursive: true });

  const result = runStart(fixture, { workspace: providedWorkspace });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /task branch.*task state.*missing|task state.*missing/i);
  await assert.rejects(access(path.join(providedWorkspace, '.dev-task')));
});

test('exact identity 的完整 .dev-task 幂等返回且不重写证据', async () => {
  const fixture = await createFixture();
  const first = startTask(fixture);
  await appendFile(path.join(fixture.taskDir, 'audits.md'), '\n### A1：保留证据\n\n不得重写。\n');
  const beforeAudits = await readFile(path.join(fixture.taskDir, 'audits.md'), 'utf8');

  const second = startTask(fixture);

  assert.deepEqual(second, first);
  assert.equal(await readFile(path.join(fixture.taskDir, 'audits.md'), 'utf8'), beforeAudits);
  await assert.rejects(access(path.join(fixture.taskDir, 'claims.json')));
  await assert.rejects(access(path.join(fixture.taskDir, 'delivery.json')));
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

test('相似 taskId 的 task branch 不会被误认成当前 task lineage', async () => {
  const fixture = await createFixture();
  const siblingWorkspace = await realpath(await mkdtemp(path.join(os.tmpdir(), 'deliver-task-sibling-')));
  await rm(siblingWorkspace, { recursive: true });
  git(fixture.root, [
    'worktree',
    'add',
    '-q',
    '-b',
    'deliver-task/slug-whitespace-rules-r1-aaaaaaaaaaaa',
    siblingWorkspace,
    fixture.baseCommit,
  ]);

  const current = startTask(fixture);

  assert.equal(current.task.taskId, 'slug-whitespace');
  assert.notEqual(current.workspacePath, siblingWorkspace);
});

test('更高 revision 在同一 task lineage 中复用原 worktree、branch 与 baseCommit', async () => {
  const fixture = await createFixture();
  const previous = startTask(fixture);
  await appendFile(
    path.join(previous.taskDir, 'audits.md'),
    '\n### A1：旧 revision 验证事实\n\n与超时阈值无关的构建事实。\n',
  );
  await writeExecution(fixture);
  await writeFile(
    path.join(previous.workspacePath, 'src/slug.mjs'),
    "export const slug = (value) => value.trim().toLowerCase().replace(/\\s+/g, '-');\n",
  );
  git(previous.workspacePath, ['add', 'src/slug.mjs']);
  git(previous.workspacePath, ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-q', '-m', '保留已有实现']);
  const previousHead = git(previous.workspacePath, ['rev-parse', 'HEAD']);
  const previousAudits = await readFile(path.join(previous.taskDir, 'audits.md'), 'utf8');
  const beforeWorktrees = git(fixture.root, ['worktree', 'list', '--porcelain']);
  const beforeBranches = git(fixture.root, ['for-each-ref', '--format=%(refname)', 'refs/heads/deliver-task']);
  fixture.task = { ...fixture.task, revision: 2, objective: '显式改变后的目标。' };

  const current = startTask(fixture);

  assert.equal(current.task.revision, 2);
  assert.equal(current.workspacePath, previous.workspacePath);
  assert.equal(current.branch, previous.branch);
  assert.equal(current.baseCommit, fixture.baseCommit);
  assert.equal(git(current.workspacePath, ['rev-parse', 'HEAD']), previousHead);
  assert.equal(git(fixture.root, ['worktree', 'list', '--porcelain']), beforeWorktrees);
  assert.equal(
    git(fixture.root, ['for-each-ref', '--format=%(refname)', 'refs/heads/deliver-task']),
    beforeBranches,
  );
  assert.equal(JSON.parse(await readFile(path.join(current.taskDir, 'task.json'), 'utf8')).revision, 2);
  assert.equal(await readFile(path.join(current.taskDir, 'audits.md'), 'utf8'), previousAudits);
  await assert.rejects(access(path.join(current.taskDir, 'claims.json')));
  await assert.rejects(access(path.join(current.taskDir, 'delivery.json')));
  const currentExecution = run(current.workspacePath, ['validate-execution', current.taskDir]);
  assert.equal(currentExecution.status, 1);
  assert.match(currentExecution.stderr, /stale task binding/i);
});

test('provided workspace 的 higher revision 复用当前 task lineage 且保留旧 evidence', async () => {
  const fixture = await createFixture();
  const previous = startTask(fixture, { workspace: fixture.root });
  await appendFile(path.join(previous.taskDir, 'audits.md'), '\n### A1：旧证据\n\n保留。\n');
  const beforeAudits = await readFile(path.join(previous.taskDir, 'audits.md'), 'utf8');
  const next = { ...fixture.task, revision: 2, objective: '新 revision。' };

  const current = startTask(fixture, { task: next, workspace: fixture.root });

  assert.equal(current.workspacePath, previous.workspacePath);
  assert.equal(current.branch, previous.branch);
  assert.equal(current.baseCommit, fixture.baseCommit);
  assert.equal(current.task.revision, 2);
  assert.equal(JSON.parse(await readFile(path.join(previous.taskDir, 'task.json'), 'utf8')).revision, 2);
  assert.equal(await readFile(path.join(previous.taskDir, 'audits.md'), 'utf8'), beforeAudits);
});

test('revision 写入任一步失败后恢复完整旧 task state', async () => {
  for (const failurePath of ['artifacts/workspace.json', 'task.json']) {
    const fixture = await createFixture();
    const previous = startTask(fixture);
    await appendFile(
      path.join(previous.taskDir, 'audits.md'),
      '\n### A1：旧 revision evidence\n\n保留。\n',
    );
    const taskPath = path.join(previous.taskDir, 'task.json');
    const workspacePath = path.join(previous.taskDir, 'artifacts/workspace.json');
    const beforeTask = await readFile(taskPath, 'utf8');
    const beforeWorkspace = await readFile(workspacePath, 'utf8');
    await chmod(path.join(previous.taskDir, failurePath), 0o400);
    const next = { ...fixture.task, revision: 2, objective: '新的 revision。' };

    const result = runStart(fixture, { task: next });

    assert.equal(result.status, 1, `${failurePath} failure unexpectedly succeeded`);
    assert.equal(await readFile(taskPath, 'utf8'), beforeTask);
    assert.equal(await readFile(workspacePath, 'utf8'), beforeWorkspace);
    await assert.rejects(access(path.join(previous.taskDir, 'claims.json')));
    await assert.rejects(access(path.join(previous.taskDir, '.revision-transaction')));
    const resumed = runStart(fixture);
    assert.equal(resumed.status, 0, resumed.stderr);
  }
});

test('start 在读取 mixed state 前恢复未完成的 revision transaction', async () => {
  const fixture = await createFixture();
  const previous = startTask(fixture);
  const taskPath = path.join(previous.taskDir, 'task.json');
  const workspacePath = path.join(previous.taskDir, 'artifacts/workspace.json');
  const beforeTask = await readFile(taskPath, 'utf8');
  const beforeWorkspace = await readFile(workspacePath, 'utf8');
  const transactionDir = path.join(previous.taskDir, '.revision-transaction');
  await mkdir(transactionDir);
  await copyFile(taskPath, path.join(transactionDir, 'old-task.json'));
  await copyFile(workspacePath, path.join(transactionDir, 'old-workspace.json'));
  const mixedBinding = {
    taskId: fixture.task.taskId,
    revision: 2,
    taskHash: `sha256:${'a'.repeat(64)}`,
  };
  const mixedWorkspace = JSON.parse(beforeWorkspace);
  mixedWorkspace.task = mixedBinding;
  await writeFile(workspacePath, `${JSON.stringify(mixedWorkspace, null, 2)}\n`);

  const result = runStart(fixture);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(await readFile(taskPath, 'utf8'), beforeTask);
  assert.equal(await readFile(workspacePath, 'utf8'), beforeWorkspace);
  await assert.rejects(access(path.join(previous.taskDir, 'claims.json')));
  await assert.rejects(access(transactionDir));
});

test('task lineage 的 baseCommit 变化时建立新的 branch 和 worktree', async () => {
  const fixture = await createFixture();
  const previous = startTask(fixture);
  await writeFile(path.join(fixture.root, 'src/slug.mjs'), "export const slug = () => 'new-base';\n");
  git(fixture.root, ['add', 'src/slug.mjs']);
  git(fixture.root, ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-q', '-m', '建立新 task 基线']);
  const nextBaseCommit = git(fixture.root, ['rev-parse', 'HEAD']);
  fixture.task = {
    ...fixture.task,
    revision: 2,
    objective: '基于新 task lineage 的目标。',
    baseCommit: nextBaseCommit,
  };

  const current = startTask(fixture);

  assert.notEqual(current.workspacePath, previous.workspacePath);
  assert.notEqual(current.branch, previous.branch);
  assert.equal(current.baseCommit, nextBaseCommit);
  assert.equal(git(current.workspacePath, ['rev-parse', 'HEAD']), nextBaseCommit);
  assert.equal(JSON.parse(await readFile(path.join(previous.taskDir, 'task.json'), 'utf8')).revision, 1);
});

test('已有 branch/worktree 但 task state 缺失或不完整时拒绝恢复', async () => {
  {
    const fixture = await createFixture();
    const output = startTask(fixture);
    await writeFile(path.join(output.workspacePath, 'src/slug.mjs'), "export const slug = () => 'kept';\n");
    git(output.workspacePath, ['add', 'src/slug.mjs']);
    git(output.workspacePath, ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-q', '-m', '保留业务成果']);
    await rm(output.taskDir, { recursive: true });

    const result = runStart(fixture);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /task state.*missing/i);
    assert.equal(git(output.workspacePath, ['rev-parse', '--abbrev-ref', 'HEAD']), output.branch.slice('refs/heads/'.length));
    await assert.rejects(access(output.taskDir));
  }

  {
    const fixture = await createFixture();
    const output = startTask(fixture);

    const result = runStart(fixture);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), output);
    await assert.rejects(access(path.join(output.taskDir, 'claims.json')));
    await assert.rejects(access(path.join(output.taskDir, 'delivery.json')));
  }

  {
    const fixture = await createFixture();
    const output = startTask(fixture);
    await writeFile(path.join(output.taskDir, 'task.json'), '{broken-json\n');
    const next = { ...fixture.task, revision: 2, objective: '不得绕过损坏的旧 task state。' };
    const beforeWorktrees = git(fixture.root, ['worktree', 'list', '--porcelain']);

    const result = runStart(fixture, { task: next });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /task state.*incomplete|task\.json.*valid JSON/i);
    assert.equal(git(fixture.root, ['worktree', 'list', '--porcelain']), beforeWorktrees);
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
  assert.match(result.stderr, /\.dev-task.*directory|task state/i);
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
      git(fixture.root, ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-q', '-m', '错误提交 task state']);
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
    { kind: 'delegated', name: 'scope-planner', ref: 'delivery-scopes/slug-whitespace' },
    { kind: 'delegated', name: 'release-pipeline', ref: 'tasks/release-1' },
  ]) {
    const fixture = await createFixture({ caller });
    const result = runStart(fixture, { workspace: fixture.root });
    assert.equal(result.status, 0, `${JSON.stringify(caller)}: ${result.stderr}`);
  }

  for (const rulesReviewPolicy of ['required', 'not-required']) {
    const fixture = await createFixture({ rulesReviewPolicy });
    const result = runStart(fixture, { workspace: fixture.root });
    assert.equal(result.status, 0, `${rulesReviewPolicy}: ${result.stderr}`);
  }

  const invalidTasks = [
    (task) => ({ ...task, allowedPaths: ['src/**'], upstreamAcceptance: { status: 'not-required' } }),
    (task) => ({ ...task, caller: { kind: 'direct', ref: 'unexpected' } }),
    (task) => ({ ...task, caller: { kind: 'delegated', ref: 'delivery-scopes/slug-whitespace' } }),
    (task) => ({ ...task, caller: { kind: 'delegated', name: 'ScopePlanner', ref: 'x' } }),
    (task) => ({ ...task, caller: { kind: 'planner', ref: 'x' } }),
    (task) => Object.fromEntries(Object.entries(task).filter(([key]) => key !== 'commitPolicy')),
    (task) => Object.fromEntries(Object.entries(task).filter(([key]) => key !== 'acceptancePolicy')),
    (task) => Object.fromEntries(Object.entries(task).filter(([key]) => key !== 'rulesReviewPolicy')),
    (task) => ({ ...task, rulesReviewPolicy: 'auto' }),
  ];
  for (const buildTask of invalidTasks) {
    const fixture = await createFixture();
    const result = runStart(fixture, { task: buildTask(fixture.task), workspace: fixture.root });
    assert.equal(result.status, 1, result.stderr);
    await assert.rejects(access(path.join(fixture.root, '.dev-task')));
  }
});

test('start 要求 initialRepairPolicy 且只接受 approval-required / auto', async () => {
  for (const initialRepairPolicy of ['approval-required', 'auto']) {
    const fixture = await createFixture();
    const task = { ...fixture.task, initialRepairPolicy };
    const result = runStart(fixture, { task, workspace: fixture.root });
    assert.equal(result.status, 0, `${initialRepairPolicy}: ${result.stderr}`);
  }

  for (const buildTask of [
    (task) => Object.fromEntries(Object.entries(task).filter(([key]) => key !== 'initialRepairPolicy')),
    (task) => ({ ...task, initialRepairPolicy: 'risk-based' }),
  ]) {
    const fixture = await createFixture();
    const result = runStart(fixture, { task: buildTask(fixture.task), workspace: fixture.root });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /initialRepairPolicy/);
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
  execution.evidenceRefs = ['missing.md'];
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


test('executionHash 只绑定执行边界，不受 evidenceRefs provenance 变化影响', async () => {
  const fixture = await createFixture();
  await initTask(fixture);
  await writeExecution(fixture, { evidenceRefs: ['audits.md#A1'] });

  let result = run(fixture.root, ['validate-execution', fixture.taskDir]);
  assert.equal(result.status, 0, result.stderr);
  const initialHash = result.stdout.trim();

  await appendFile(
    path.join(fixture.taskDir, 'audits.md'),
    '\n### A2：补充 provenance\n\n执行边界未变化，仅补充判断来源。\n',
  );
  await writeExecution(fixture, { evidenceRefs: ['audits.md#A2'] });

  result = run(fixture.root, ['validate-execution', fixture.taskDir]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), initialHash);
});

test('持久化 delivery closure 命令已移除', async () => {
  const fixture = await createFixture();
  await initTask(fixture);

  for (const command of ['validate-result', 'close-check']) {
    const result = run(fixture.root, [command, fixture.taskDir]);
    assert.equal(result.status, 2, `${command} unexpectedly remained available`);
    assert.match(result.stderr, new RegExp(`unknown command: ${command}`, 'i'));
  }
});
