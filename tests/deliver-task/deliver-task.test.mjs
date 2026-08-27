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

function bindingBlock(fixture, hash, target) {
  return [
    '```deliver-task-binding',
    JSON.stringify({ task: taskBinding(fixture, hash), executionHash: target.executionHash, target }),
    '```',
  ].join('\n');
}

function reviewResultBlock(fixture, hash, target, { domain, mode, result }) {
  return [
    '```deliver-task-review-result',
    JSON.stringify({
      task: taskBinding(fixture, hash),
      executionHash: target.executionHash,
      target,
      domain,
      mode,
      result,
    }),
    '```',
  ].join('\n');
}

async function appendReviewResult(
  fixture,
  target,
  {
    anchor,
    domain,
    mode,
    result,
    title = `${domain} ${mode} review`,
  },
) {
  const hash = await taskHash(fixture);
  await appendFile(
    path.join(fixture.taskDir, 'audits.md'),
    `\n### ${anchor}：${title}\n\n${reviewResultBlock(fixture, hash, target, { domain, mode, result })}\n`,
  );
  return `audits.md#${anchor}`;
}

async function appendGeneralReview(fixture, target, { anchor = 'A2' } = {}) {
  const hash = await taskHash(fixture);
  await appendFile(
    path.join(fixture.taskDir, 'audits.md'),
    `\n### ${anchor}：General Review\n\nGeneral Full clean。\n\n${bindingBlock(fixture, hash, target)}\n\n${reviewResultBlock(fixture, hash, target, { domain: 'general', mode: 'full', result: 'clean' })}\n`,
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
    verification = 'audits.md#A1',
    generalReview = 'audits.md#A2',
    acceptance = null,
    rulesReview,
    upstreamRequest = null,
  } = {},
) {
  const hash = await taskHash(fixture);
  const resolvedRulesReview = rulesReview === undefined
    ? (fixture.task.rulesReviewPolicy === 'not-required' ? null : 'not-applicable')
    : rulesReview;
  const delivery = {
    schemaVersion: 'deliver-task.delivery.v1',
    task: taskBinding(fixture, hash),
    result,
    target: target ?? null,
    evidenceRefs:
      result === 'delivered'
        ? {
            claims: 'claims.json',
            verification,
            generalReview,
            acceptance,
            rulesReview: resolvedRulesReview,
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

async function appendReviewWave(
  fixture,
  previousTarget,
  target,
  {
    anchor = 'A7',
    wave = 1,
    failedWaveCount = 0,
    repairInputRefs = ['audits.md#A2'],
    repairDiffRef = 'audits.md#A3',
    validationRefs = ['audits.md#A4'],
    general = {
      scopedRef: 'audits.md#A5',
      scopedResult: 'clean',
      fullRef: null,
      fullResult: null,
    },
    rules = {
      scopedRef: 'audits.md#A6',
      scopedResult: 'clean',
      fullRef: null,
      fullResult: null,
    },
    mergedFindingRefs = [],
    result = 'clean',
    overrides = {},
  } = {},
) {
  const hash = await taskHash(fixture);
  const reviewWave = {
    task: taskBinding(fixture, hash),
    executionHash: target.executionHash,
    wave,
    failedWaveCount,
    previousTarget,
    target,
    repairInputRefs,
    repairDiffRef,
    validationRefs,
    general,
    rules,
    mergedFindingRefs,
    result,
    ...overrides,
  };
  await appendFile(
    path.join(fixture.taskDir, 'audits.md'),
    [
      '',
      `### ${anchor}：Review Wave ${wave}`,
      '',
      bindingBlock(fixture, hash, target),
      '',
      '```deliver-task-review-wave',
      JSON.stringify(reviewWave),
      '```',
      '',
    ].join('\n'),
  );
  return { reviewWave, reference: `audits.md#${anchor}` };
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

async function prepareReviewWaveDelivery(
  fixture,
  {
    waveOptions = {},
    extraReviewResults = [],
    verification,
    rulesReview,
    deliveryResult = 'delivered',
  } = {},
) {
  await initTask(fixture);
  await writeExecution(fixture);
  const previousTarget = await snapshotTarget(fixture);
  await appendGeneralReview(fixture, previousTarget, { anchor: 'A2' });
  await writeFile(
    path.join(fixture.workspacePath, 'src/slug.mjs'),
    [
      'export const slug = (value) =>',
      "  value.trim().toLowerCase().replaceAll(' ', '-');",
      '',
    ].join('\n'),
  );
  const target = await snapshotTarget(fixture);
  const hash = await taskHash(fixture);
  const generalScopedResult = waveOptions.general?.scopedResult ?? 'clean';
  const rulesScopedResult = new Set(['not-applicable', 'not-required']).has(waveOptions.rules)
    ? null
    : (waveOptions.rules?.scopedResult ?? 'clean');
  await appendFile(
    path.join(fixture.taskDir, 'audits.md'),
    [
      '',
      '### A3：实际 repair diff',
      '',
      '已固定 directly reviewed target 到当前 target 的实际 repair delta。',
      '',
      '### A4：Affected validation',
      '',
      '直接相关测试通过。',
      '',
      '### A5：General scoped repair verification',
      '',
      '原 finding 已解决，repair 的功能影响面 clean。',
      '',
      reviewResultBlock(fixture, hash, target, {
        domain: 'general',
        mode: 'scoped',
        result: generalScopedResult,
      }),
      '',
      '### A6：Rules scoped repair verification',
      '',
      '原 finding 已解决，repair 的规则影响面 clean。',
      ...(rulesScopedResult === null
        ? []
        : [
            '',
            reviewResultBlock(fixture, hash, target, {
              domain: 'rules',
              mode: 'scoped',
              result: rulesScopedResult,
            }),
          ]),
      '',
    ].join('\n'),
  );
  for (const reviewResult of extraReviewResults) {
    await appendReviewResult(fixture, target, reviewResult);
  }
  const { reference } = await appendReviewWave(fixture, previousTarget, target, waveOptions);
  await writeVerifiedClaims(fixture, hash, [reference]);
  if (deliveryResult === 'delivered') {
    await writeDelivery(fixture, {
      target,
      verification: verification ?? 'audits.md#A4',
      generalReview: reference,
      rulesReview: rulesReview === undefined
        ? (waveOptions.rules === 'not-required'
            ? null
            : (waveOptions.rules === 'not-applicable' ? 'not-applicable' : reference))
        : rulesReview,
    });
  } else {
    await writeDelivery(fixture, {
      result: deliveryResult,
      target,
      upstreamRequest: {
        kind: 'blocker',
        summary: 'Review Wave 尚有 finding，停止交付。',
        evidenceRefs: [reference],
      },
    });
  }
  return { previousTarget, target, reference };
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
  const claims = JSON.parse(await readFile(path.join(output.taskDir, 'claims.json'), 'utf8'));
  assert.equal(claims.schemaVersion, 'deliver-task.claims.v1');
  assert.deepEqual(claims.task, output.task);
  assert.deepEqual(claims.claims, []);
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

test('相似 taskId 的 delivery branch 不会被误认成当前 delivery', async () => {
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

test('更高 revision 在同一 delivery 中复用原 worktree、branch 与 baseCommit', async () => {
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
  const previousTarget = await snapshotTarget(fixture);
  await appendGeneralReview(fixture, previousTarget, { anchor: 'A2' });
  const previousHash = await taskHash(fixture);
  await writeVerifiedClaims(fixture, previousHash);
  await writeDelivery(fixture, { target: previousTarget });
  const previousClose = run(previous.workspacePath, ['close-check', previous.taskDir]);
  assert.equal(previousClose.status, 0, previousClose.stderr);
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
  const currentClaims = JSON.parse(await readFile(path.join(current.taskDir, 'claims.json'), 'utf8'));
  assert.equal(currentClaims.task.revision, 2);
  assert.deepEqual(currentClaims.claims, []);
  const currentClose = run(current.workspacePath, ['close-check', current.taskDir]);
  assert.equal(currentClose.status, 1);
  assert.match(currentClose.stderr, /stale task binding|missing or unreadable/i);
});

test('provided workspace 的 higher revision 复用当前 delivery 且保留旧 evidence', async () => {
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

test('delivery lineage 的 baseCommit 变化时建立新的 branch 和 worktree', async () => {
  const fixture = await createFixture();
  const previous = startTask(fixture);
  await writeFile(path.join(fixture.root, 'src/slug.mjs'), "export const slug = () => 'new-base';\n");
  git(fixture.root, ['add', 'src/slug.mjs']);
  git(fixture.root, ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-q', '-m', '建立新 delivery 基线']);
  const nextBaseCommit = git(fixture.root, ['rev-parse', 'HEAD']);
  fixture.task = {
    ...fixture.task,
    revision: 2,
    objective: '基于新 delivery lineage 的目标。',
    baseCommit: nextBaseCommit,
  };

  const current = startTask(fixture);

  assert.notEqual(current.workspacePath, previous.workspacePath);
  assert.notEqual(current.branch, previous.branch);
  assert.equal(current.baseCommit, nextBaseCommit);
  assert.equal(git(current.workspacePath, ['rev-parse', 'HEAD']), nextBaseCommit);
  assert.equal(JSON.parse(await readFile(path.join(previous.taskDir, 'task.json'), 'utf8')).revision, 1);
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

  {
    const fixture = await createFixture();
    const output = startTask(fixture);
    await writeFile(path.join(output.taskDir, 'task.json'), '{broken-json\n');
    const next = { ...fixture.task, revision: 2, objective: '不得绕过损坏的旧 delivery。' };
    const beforeWorktrees = git(fixture.root, ['worktree', 'list', '--porcelain']);

    const result = runStart(fixture, { task: next });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /proof state.*incomplete|task\.json.*valid JSON/i);
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

test('Architecture binding 变化会生成新 executionHash 并使旧 General binding 失效', async () => {
  const fixture = await createFixture();
  await initTask(fixture);
  await writeExecution(fixture);
  const oldTarget = await snapshotTarget(fixture);
  const oldGeneral = await appendGeneralReview(fixture, oldTarget);
  const hash = await taskHash(fixture);
  await writeVerifiedClaims(fixture, hash);

  await appendFile(
    path.join(fixture.taskDir, 'audits.md'),
    '\n### A3：Architecture binding 调整\n\n人已确认本次执行使用现有 Architecture。\n',
  );
  await writeExecution(fixture, {
    architecturePath: fixture.architecturePath,
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

test('clean Review Wave 以当前 target、affected validation 和双域 scoped refs 闭合 delivery', async () => {
  const fixture = await createFixture();
  const { reference } = await prepareReviewWaveDelivery(fixture);

  const delivery = JSON.parse(await readFile(path.join(fixture.taskDir, 'delivery.json'), 'utf8'));
  assert.equal(delivery.evidenceRefs.verification, 'audits.md#A4');
  assert.equal(delivery.evidenceRefs.generalReview, reference);
  assert.equal(delivery.evidenceRefs.rulesReview, reference);

  let result = run(fixture.root, ['validate-result', fixture.taskDir]);
  assert.equal(result.status, 0, result.stderr);
  result = run(fixture.root, ['close-check', fixture.taskDir]);
  assert.equal(result.status, 0, result.stderr);
});

test('rulesReviewPolicy=not-required 跳过独立 Rules Review 并要求 delivery ref 为 null', async () => {
  const fixture = await createFixture({ rulesReviewPolicy: 'not-required' });
  const { target } = await prepareDelivered(fixture);
  let delivery = JSON.parse(await readFile(path.join(fixture.taskDir, 'delivery.json'), 'utf8'));
  assert.equal(delivery.evidenceRefs.rulesReview, null);

  let result = run(fixture.root, ['validate-result', fixture.taskDir]);
  assert.equal(result.status, 0, result.stderr);
  result = run(fixture.root, ['close-check', fixture.taskDir]);
  assert.equal(result.status, 0, result.stderr);

  await writeDelivery(fixture, { target, rulesReview: 'not-applicable' });
  delivery = JSON.parse(await readFile(path.join(fixture.taskDir, 'delivery.json'), 'utf8'));
  assert.equal(delivery.evidenceRefs.rulesReview, 'not-applicable');
  result = run(fixture.root, ['validate-result', fixture.taskDir]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /rulesReviewPolicy not-required.*rulesReview.*null/i);
});

test('rulesReviewPolicy=required 保留 Rules Review closure，不能用 null 表示人工关闭', async () => {
  const fixture = await createFixture();
  const { target } = await prepareDelivered(fixture);
  await writeDelivery(fixture, { target, rulesReview: null });

  const result = run(fixture.root, ['validate-result', fixture.taskDir]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /rulesReviewPolicy required.*rulesReview.*string/i);
});

test('Review Wave rules 状态必须与 rulesReviewPolicy 一致', async () => {
  {
    const fixture = await createFixture();
    await prepareReviewWaveDelivery(fixture, {
      waveOptions: { rules: 'not-applicable' },
    });
    const delivery = JSON.parse(await readFile(path.join(fixture.taskDir, 'delivery.json'), 'utf8'));
    assert.equal(delivery.evidenceRefs.rulesReview, 'not-applicable');
    const result = run(fixture.root, ['validate-result', fixture.taskDir]);
    assert.equal(result.status, 0, result.stderr);
  }

  {
    const fixture = await createFixture({ rulesReviewPolicy: 'not-required' });
    const { reference } = await prepareReviewWaveDelivery(fixture, {
      waveOptions: { rules: 'not-required' },
    });
    const delivery = JSON.parse(await readFile(path.join(fixture.taskDir, 'delivery.json'), 'utf8'));
    assert.equal(delivery.evidenceRefs.generalReview, reference);
    assert.equal(delivery.evidenceRefs.rulesReview, null);
    const result = run(fixture.root, ['validate-result', fixture.taskDir]);
    assert.equal(result.status, 0, result.stderr);
  }

  for (const testCase of [
    {
      name: 'required rejects not-required',
      rulesReviewPolicy: 'required',
      rules: 'not-required',
      deliveryRulesReview: 'not-applicable',
    },
    {
      name: 'not-required rejects not-applicable',
      rulesReviewPolicy: 'not-required',
      rules: 'not-applicable',
      deliveryRulesReview: null,
    },
    {
      name: 'not-required rejects Rules review object',
      rulesReviewPolicy: 'not-required',
      rules: {
        scopedRef: 'audits.md#A6',
        scopedResult: 'clean',
        fullRef: null,
        fullResult: null,
      },
      deliveryRulesReview: null,
    },
  ]) {
    const fixture = await createFixture({ rulesReviewPolicy: testCase.rulesReviewPolicy });
    await prepareReviewWaveDelivery(fixture, {
      waveOptions: { rules: testCase.rules },
      rulesReview: testCase.deliveryRulesReview,
    });
    const result = run(fixture.root, ['validate-result', fixture.taskDir]);
    assert.equal(result.status, 1, `${testCase.name} unexpectedly passed`);
    assert.match(result.stderr, /Review Wave.*rules.*rulesReviewPolicy/i, testCase.name);
  }
});

test('Review Wave scoped evidence 绑定 domain、mode、result 和当前 target', async () => {
  const cases = [
    {
      name: 'wrong domain',
      mutate: (record) => ({ ...record, domain: 'rules' }),
      pattern: /General.*scopedRef.*domain.*general/i,
    },
    {
      name: 'wrong mode',
      mutate: (record) => ({ ...record, mode: 'full' }),
      pattern: /General.*scopedRef.*mode.*scoped/i,
    },
    {
      name: 'wrong result',
      mutate: (record) => ({ ...record, result: 'findings' }),
      pattern: /General.*scopedRef.*result.*clean/i,
    },
    {
      name: 'stale execution',
      mutate: (record) => ({
        ...record,
        executionHash: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
      }),
      pattern: /General.*scopedRef.*stale execution/i,
    },
    {
      name: 'stale target',
      mutate: (record, prepared) => ({ ...record, target: prepared.previousTarget }),
      pattern: /General.*scopedRef.*target/i,
    },
  ];

  for (const testCase of cases) {
    const fixture = await createFixture();
    const prepared = await prepareReviewWaveDelivery(fixture);
    const auditsPath = path.join(fixture.taskDir, 'audits.md');
    const audits = await readFile(auditsPath, 'utf8');
    const blocks = [...audits.matchAll(/```deliver-task-review-result\r?\n([^\r\n]+)\r?\n```/g)];
    const match = blocks.find(({ 1: payload }) => {
      const record = JSON.parse(payload);
      return record.domain === 'general' && record.mode === 'scoped';
    });
    assert.ok(match, `${testCase.name}: missing General scoped fixture`);
    const mutated = testCase.mutate(JSON.parse(match[1]), prepared);
    await writeFile(auditsPath, audits.replace(match[1], JSON.stringify(mutated)));

    const result = run(fixture.root, ['validate-result', fixture.taskDir]);
    assert.equal(result.status, 1, `${testCase.name} unexpectedly passed`);
    assert.match(result.stderr, testCase.pattern, testCase.name);
  }
});

test('Review Wave 拒绝 self 和 future audits evidence ref', async () => {
  for (const testCase of [
    { name: 'self', reference: 'audits.md#A7' },
    { name: 'future', reference: 'audits.md#A8' },
  ]) {
    const fixture = await createFixture();
    await prepareReviewWaveDelivery(fixture);
    const auditsPath = path.join(fixture.taskDir, 'audits.md');
    if (testCase.name === 'future') {
      await appendFile(auditsPath, '\n### A8：future evidence\n\n尚未发生。\n');
    }
    const audits = await readFile(auditsPath, 'utf8');
    const block = /```deliver-task-review-wave\r?\n([^\r\n]+)\r?\n```/.exec(audits);
    const record = { ...JSON.parse(block[1]), repairDiffRef: testCase.reference };
    await writeFile(auditsPath, audits.replace(block[1], JSON.stringify(record)));

    const result = run(fixture.root, ['validate-result', fixture.taskDir]);
    assert.equal(result.status, 1, `${testCase.name} reference unexpectedly passed`);
    assert.match(result.stderr, /repairDiffRef.*earlier audits\.md A entry/i, testCase.name);
  }
});

test('历史 Review Wave 保留自身 execution identity，只有最终 wave 绑定当前 execution', async () => {
  const fixture = await createFixture();
  await initTask(fixture);
  await writeExecution(fixture);
  const initialTarget = await snapshotTarget(fixture);
  await appendGeneralReview(fixture, initialTarget, { anchor: 'A2' });

  await writeFile(path.join(fixture.workspacePath, 'src/slug.mjs'), "export const slug = () => 'wave-1';\n");
  const firstTarget = await snapshotTarget(fixture);
  await appendFile(
    path.join(fixture.taskDir, 'audits.md'),
    '\n### A3：wave 1 repair diff\n\nfixed.\n\n### A4：wave 1 validation\n\npassed.\n',
  );
  await appendReviewResult(fixture, firstTarget, {
    anchor: 'A5',
    domain: 'general',
    mode: 'scoped',
    result: 'findings',
  });
  await appendReviewResult(fixture, firstTarget, {
    anchor: 'A6',
    domain: 'rules',
    mode: 'scoped',
    result: 'clean',
  });
  const firstWave = await appendReviewWave(fixture, initialTarget, firstTarget, {
    anchor: 'A7',
    failedWaveCount: 1,
    general: {
      scopedRef: 'audits.md#A5',
      scopedResult: 'findings',
      fullRef: null,
      fullResult: null,
    },
    mergedFindingRefs: ['audits.md#A5'],
    result: 'failed',
  });

  await appendFile(
    path.join(fixture.taskDir, 'audits.md'),
    '\n### A8：执行边界调整\n\n同一 task 内补充 docs 范围。\n',
  );
  await writeExecution(fixture, {
    allowedPaths: ['src/slug.mjs', 'test/slug.test.mjs', 'docs/**'],
    evidenceRefs: ['audits.md#A8'],
  });
  await writeFile(path.join(fixture.workspacePath, 'src/slug.mjs'), "export const slug = () => 'wave-2';\n");
  const finalTarget = await snapshotTarget(fixture);
  assert.notEqual(firstTarget.executionHash, finalTarget.executionHash);
  await appendFile(
    path.join(fixture.taskDir, 'audits.md'),
    '\n### A9：wave 2 repair diff\n\nfixed.\n\n### A10：wave 2 validation\n\npassed.\n',
  );
  await appendReviewResult(fixture, finalTarget, {
    anchor: 'A11',
    domain: 'general',
    mode: 'scoped',
    result: 'clean',
  });
  await appendReviewResult(fixture, finalTarget, {
    anchor: 'A12',
    domain: 'rules',
    mode: 'scoped',
    result: 'clean',
  });
  const finalWave = await appendReviewWave(fixture, firstTarget, finalTarget, {
    anchor: 'A13',
    wave: 2,
    failedWaveCount: 1,
    repairInputRefs: [firstWave.reference],
    repairDiffRef: 'audits.md#A9',
    validationRefs: ['audits.md#A10'],
    general: {
      scopedRef: 'audits.md#A11',
      scopedResult: 'clean',
      fullRef: null,
      fullResult: null,
    },
    rules: {
      scopedRef: 'audits.md#A12',
      scopedResult: 'clean',
      fullRef: null,
      fullResult: null,
    },
  });
  const hash = await taskHash(fixture);
  await writeVerifiedClaims(fixture, hash, [finalWave.reference]);
  await writeDelivery(fixture, {
    target: finalTarget,
    verification: 'audits.md#A10',
    generalReview: finalWave.reference,
    rulesReview: finalWave.reference,
  });

  let result = run(fixture.root, ['validate-result', fixture.taskDir]);
  assert.equal(result.status, 0, result.stderr);
  result = run(fixture.root, ['close-check', fixture.taskDir]);
  assert.equal(result.status, 0, result.stderr);
});

test('最新 Review Wave 拒绝旧 execution identity', async () => {
  const fixture = await createFixture();
  const prepared = await prepareReviewWaveDelivery(fixture);
  await appendFile(
    path.join(fixture.taskDir, 'audits.md'),
    '\n### A8：执行边界调整\n\n同一 task 内补充 docs 范围。\n',
  );
  await writeExecution(fixture, {
    allowedPaths: ['src/slug.mjs', 'test/slug.test.mjs', 'docs/**'],
    evidenceRefs: ['audits.md#A8'],
  });
  const currentTarget = await snapshotTarget(fixture);
  assert.notEqual(prepared.target.executionHash, currentTarget.executionHash);
  await writeDelivery(fixture, {
    result: 'blocked',
    target: currentTarget,
    upstreamRequest: {
      kind: 'blocker',
      summary: '当前 execution 尚无 Review Wave closure。',
      evidenceRefs: [prepared.reference],
    },
  });

  const result = run(fixture.root, ['validate-result', fixture.taskDir]);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /final Review Wave.*current execution\.json/i);
});

test('Review Wave 把双域 findings 合并为一次 failed-wave 计数', async () => {
  const cases = [
    {
      name: 'Rules finding only',
      general: { scopedRef: 'audits.md#A5', scopedResult: 'clean', fullRef: null, fullResult: null },
      rules: { scopedRef: 'audits.md#A6', scopedResult: 'findings', fullRef: null, fullResult: null },
      mergedFindingRefs: ['audits.md#A6'],
    },
    {
      name: 'General and Rules findings',
      general: { scopedRef: 'audits.md#A5', scopedResult: 'findings', fullRef: null, fullResult: null },
      rules: { scopedRef: 'audits.md#A6', scopedResult: 'findings', fullRef: null, fullResult: null },
      mergedFindingRefs: ['audits.md#A5', 'audits.md#A6'],
    },
  ];

  for (const testCase of cases) {
    const fixture = await createFixture();
    await prepareReviewWaveDelivery(fixture, {
      waveOptions: {
        failedWaveCount: 1,
        general: testCase.general,
        rules: testCase.rules,
        mergedFindingRefs: testCase.mergedFindingRefs,
        result: 'failed',
      },
      deliveryResult: 'blocked',
    });
    let result = run(fixture.root, ['validate-result', fixture.taskDir]);
    assert.equal(result.status, 0, `${testCase.name}: ${result.stderr}`);

    const auditsPath = path.join(fixture.taskDir, 'audits.md');
    const audits = await readFile(auditsPath, 'utf8');
    await writeFile(auditsPath, audits.replace('"failedWaveCount":1', '"failedWaveCount":2'));
    result = run(fixture.root, ['validate-result', fixture.taskDir]);
    assert.equal(result.status, 1, `${testCase.name} accepted per-domain counting`);
    assert.match(result.stderr, /failedWaveCount.*cumulative failed Review Wave count.*1/i);
  }
});

test('cannot-bound 只接受同一 domain、当前 target 的 Full evidence', async () => {
  {
    const fixture = await createFixture();
    await prepareReviewWaveDelivery(fixture, {
      waveOptions: {
        failedWaveCount: 1,
        rules: {
          scopedRef: 'audits.md#A6',
          scopedResult: 'cannot-bound',
          fullRef: 'audits.md#A2',
          fullResult: 'findings',
        },
        mergedFindingRefs: ['audits.md#A2'],
        result: 'failed',
      },
      deliveryResult: 'blocked',
    });
    const result = run(fixture.root, ['validate-result', fixture.taskDir]);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /Rules.*fullRef.*domain.*rules/i);
  }

  {
    const fixture = await createFixture();
    await prepareReviewWaveDelivery(fixture, {
      waveOptions: {
        general: {
          scopedRef: 'audits.md#A5',
          scopedResult: 'cannot-bound',
          fullRef: 'audits.md#A2',
          fullResult: 'clean',
        },
      },
    });
    const result = run(fixture.root, ['validate-result', fixture.taskDir]);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /General.*fullRef.*target/i);
  }

  {
    const fixture = await createFixture();
    await prepareReviewWaveDelivery(fixture, {
      extraReviewResults: [
        {
          anchor: 'A7',
          domain: 'rules',
          mode: 'full',
          result: 'findings',
          title: 'Rules Full review',
        },
      ],
      waveOptions: {
        anchor: 'A8',
        failedWaveCount: 1,
        rules: {
          scopedRef: 'audits.md#A6',
          scopedResult: 'cannot-bound',
          fullRef: 'audits.md#A7',
          fullResult: 'findings',
        },
        mergedFindingRefs: ['audits.md#A7'],
        result: 'failed',
      },
      deliveryResult: 'blocked',
    });
    const result = run(fixture.root, ['validate-result', fixture.taskDir]);
    assert.equal(result.status, 0, result.stderr);
  }

  {
    const fixture = await createFixture();
    await prepareReviewWaveDelivery(fixture, {
      waveOptions: {
        general: {
          scopedRef: 'audits.md#A5',
          scopedResult: 'cannot-bound',
          fullRef: null,
          fullResult: null,
        },
      },
    });
    const result = run(fixture.root, ['validate-result', fixture.taskDir]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /General.*cannot-bound.*fullRef.*fullResult/i);
  }
});

test('Review Wave 拒绝错误 state、target、evidence 和 legacy repair closure', async () => {
  const cases = [
    {
      name: 'unchanged target',
      waveOptions: ({ target }) => ({ overrides: { previousTarget: target } }),
      pattern: /Review Wave.*requires a changed target/i,
    },
    {
      name: 'clean with findings',
      waveOptions: () => ({ mergedFindingRefs: ['audits.md#A5'] }),
      pattern: /clean.*mergedFindingRefs.*empty/i,
    },
    {
      name: 'failed without findings',
      waveOptions: () => ({ result: 'failed', failedWaveCount: 1 }),
      pattern: /failed.*mergedFindingRefs.*not be empty/i,
    },
    {
      name: 'verification ref outside wave',
      deliveryOptions: { verification: 'audits.md#A1' },
      pattern: /verification.*validationRefs/i,
    },
  ];

  for (const testCase of cases) {
    const fixture = await createFixture();
    const prepared = await prepareReviewWaveDelivery(fixture, {
      ...(testCase.deliveryOptions ?? {}),
    });
    if (testCase.waveOptions) {
      const auditsPath = path.join(fixture.taskDir, 'audits.md');
      const audits = await readFile(auditsPath, 'utf8');
      const options = testCase.waveOptions(prepared);
      const block = /```deliver-task-review-wave\r?\n([^\r\n]+)\r?\n```/.exec(audits);
      const record = { ...JSON.parse(block[1]), ...(options.overrides ?? options) };
      await writeFile(auditsPath, audits.replace(block[1], JSON.stringify(record)));
    }
    const result = run(fixture.root, ['validate-result', fixture.taskDir]);
    assert.equal(result.status, 1, `${testCase.name} unexpectedly passed`);
    assert.match(result.stderr, testCase.pattern, testCase.name);
  }

  const fixture = await createFixture();
  await initTask(fixture);
  await writeExecution(fixture);
  const previousTarget = await snapshotTarget(fixture);
  await appendGeneralReview(fixture, previousTarget, { anchor: 'A2' });
  await writeFile(path.join(fixture.workspacePath, 'src/slug.mjs'), "export const slug = () => 'legacy';\n");
  const target = await snapshotTarget(fixture);
  await appendFile(
    path.join(fixture.taskDir, 'audits.md'),
    '\n### A3：repair diff\n\nfixed.\n\n### A4：finding verification\n\naddressed.\n\n### A5：mechanical verification\n\npassed.\n',
  );
  const hash = await taskHash(fixture);
  const legacy = {
    task: taskBinding(fixture, hash),
    executionHash: target.executionHash,
    previousTarget,
    target,
    sourceReviewKind: 'general',
    findingRefs: ['audits.md#A2'],
    repairDiffRef: 'audits.md#A3',
    findingVerificationRef: 'audits.md#A4',
    mechanicalVerificationRefs: ['audits.md#A5'],
    reusedEvidenceRefs: ['audits.md#A1', 'audits.md#A2'],
    classification: 'non-semantic',
    findingDisposition: 'addressed',
    repairScope: 'finding-only',
  };
  await appendFile(
    path.join(fixture.taskDir, 'audits.md'),
    `\n### A6：Legacy closure\n\n${bindingBlock(fixture, hash, target)}\n\n\`\`\`deliver-task-repair-closure\n${JSON.stringify(legacy)}\n\`\`\`\n`,
  );
  await writeVerifiedClaims(fixture, hash, ['audits.md#A6']);
  await writeDelivery(fixture, {
    target,
    verification: 'audits.md#A6',
    generalReview: 'audits.md#A6',
  });
  const legacyResult = run(fixture.root, ['validate-result', fixture.taskDir]);
  assert.equal(legacyResult.status, 1);
  assert.match(legacyResult.stderr, /deliver-task-repair-closure.*no longer supported/i);
});

test('连续 4 个 failed Review Waves 后拒绝第 5 个自动 wave', async () => {
  const fixture = await createFixture();
  await initTask(fixture);
  await writeExecution(fixture);
  let previousTarget = await snapshotTarget(fixture);
  await appendGeneralReview(fixture, previousTarget, { anchor: 'A2' });
  let lastReference = 'audits.md#A2';
  let lastTarget = previousTarget;
  const hash = await taskHash(fixture);

  for (let wave = 1; wave <= 5; wave += 1) {
    const base = 3 + (wave - 1) * 5;
    await writeFile(
      path.join(fixture.workspacePath, 'src/slug.mjs'),
      `export const slug = () => 'wave-${wave}';\n`,
    );
    lastTarget = await snapshotTarget(fixture);
    await appendFile(
      path.join(fixture.taskDir, 'audits.md'),
      [
        '',
        `### A${base}：repair diff`,
        '',
        `wave ${wave}.`,
        '',
        `### A${base + 1}：validation`,
        '',
        'passed.',
        '',
        `### A${base + 2}：General scoped`,
        '',
        'finding.',
        '',
        reviewResultBlock(fixture, hash, lastTarget, {
          domain: 'general',
          mode: 'scoped',
          result: 'findings',
        }),
        '',
        `### A${base + 3}：Rules scoped`,
        '',
        'clean.',
        '',
        reviewResultBlock(fixture, hash, lastTarget, {
          domain: 'rules',
          mode: 'scoped',
          result: 'clean',
        }),
        '',
      ].join('\n'),
    );
    const appended = await appendReviewWave(fixture, previousTarget, lastTarget, {
      anchor: `A${base + 4}`,
      wave,
      failedWaveCount: wave,
      repairInputRefs: [lastReference],
      repairDiffRef: `audits.md#A${base}`,
      validationRefs: [`audits.md#A${base + 1}`],
      general: {
        scopedRef: `audits.md#A${base + 2}`,
        scopedResult: 'findings',
        fullRef: null,
        fullResult: null,
      },
      rules: {
        scopedRef: `audits.md#A${base + 3}`,
        scopedResult: 'clean',
        fullRef: null,
        fullResult: null,
      },
      mergedFindingRefs: [`audits.md#A${base + 2}`],
      result: 'failed',
    });
    previousTarget = lastTarget;
    lastReference = appended.reference;
  }

  await writeDelivery(fixture, {
    result: 'blocked',
    target: lastTarget,
    upstreamRequest: {
      kind: 'blocker',
      summary: 'failed Review Wave budget exhausted',
      evidenceRefs: [lastReference],
    },
  });
  const result = run(fixture.root, ['validate-result', fixture.taskDir]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /4 failed Review Waves.*stop automatic repair.*wave 5/i);
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

test('validate-result 接受两种 non-delivered 结果并约束 request kind', async () => {
  const cases = [
    ['needs-upstream', 'acceptance-change'],
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

  const invalidFixture = await createFixture();
  await initTask(invalidFixture);
  await writeDelivery(invalidFixture, {
    result: 'invalid-result',
    upstreamRequest: {
      kind: 'invalid-request',
      summary: '非法结果。',
      evidenceRefs: ['audits.md#A1'],
    },
  });
  const invalidResult = run(
    invalidFixture.root,
    ['validate-result', path.relative(invalidFixture.root, invalidFixture.taskDir)],
  );
  assert.equal(invalidResult.status, 1);
  assert.match(invalidResult.stderr, /delivery\.result must be one of delivered, needs-upstream, blocked/);
});

test('两种 non-delivered 结果都拒绝空或不存在的 upstreamRequest evidence refs', async () => {
  const cases = [
    ['needs-upstream', 'user-acceptance'],
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
