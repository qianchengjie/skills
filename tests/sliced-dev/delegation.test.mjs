import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  access,
  appendFile,
  mkdtemp,
  mkdir,
  readFile,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const slicedScript = path.join(repoRoot, 'skills/sliced-dev/scripts/dev-plan.mjs');
const deliverScript = path.join(repoRoot, 'skills/deliver-task/scripts/deliver-task.mjs');

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function runScript(cwd, script, args) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd,
    encoding: 'utf8',
  });
}

function runSliced(cwd, args) {
  return runScript(cwd, slicedScript, args);
}

function runDeliver(cwd, args) {
  return runScript(cwd, deliverScript, args);
}

async function pathExists(target) {
  return access(target).then(() => true, () => false);
}

function taskBinding(task, taskHash) {
  return {
    taskId: task.taskId,
    revision: task.revision,
    taskHash,
  };
}

function renderPlan({ status = 'in-progress', objective = '修复 slug 连续空白归一。' } = {}) {
  const planStatus = status === 'done' ? 'done' : 'executing';
  const phase = status === 'done' ? 'done' : 'executing';
  const currentSlice = status === 'done' ? '无' : 'S1';
  const nextStep = status === 'done' ? '任务已收口' : '委托 S1';
  return `# 示例计划

> 档位：完整
> 状态：${planStatus}
> 上游依据：issue:example
> 计划一致性预检：passed
> 拆分拷问：grilled

## 当前状态

- 阶段：${phase}
- 当前切片：${currentSlice}
- 下一步：${nextStep}

## 文件索引

| 文件 | 职责 |
| --- | --- |
| [decisions.md](./decisions.md) | 分叉正文 |
| [audits.md](./audits.md) | 计划级长审计与跨切片证据 |

## 目标

完成示例计划。

## 全局约束

- 不新增依赖。

## 切片

### S1：修复 slug

- 状态：${status}
- 门禁：grilled
- 候选：候选自动
- 风险：B
- 执行：自动
- 依赖：无

#### 关联项

暂无。

#### 委托合同

- 验收策略：not-required
- 约束：
  - 保持现有大小写规则。
- 非目标：
  - 不调整其它字符串工具。
- 禁止修改：
  - package-lock.json

#### 切片交接

- 输入:
  - 无
- 输出:
  - slug 连续空白统一归一为单个连字符。

#### 任务内容

${objective}

#### 验收

- 输入连续空白时只产生一个连字符。
- 原有 slug 测试继续通过。
`;
}

async function createFixture(options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sliced-dev-delegation-'));
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(path.join(root, 'src/slug.mjs'), "export const slug = (value) => value.trim().toLowerCase();\n");
  git(root, ['init', '-q']);
  git(root, ['add', 'src/slug.mjs']);
  git(root, ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-q', '-m', '初始基线']);

  const planDir = path.join(root, 'dev-plans/2026-08-21-example');
  await mkdir(planDir, { recursive: true });
  await writeFile(path.join(planDir, 'plan.md'), renderPlan(options));
  await writeFile(path.join(planDir, 'decisions.md'), '# 分叉记录\n');
  await writeFile(path.join(planDir, 'audits.md'), '# 审计记录\n');
  git(root, ['add', 'dev-plans/2026-08-21-example']);
  git(root, ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-q', '-m', '计划检查点 P']);
  return {
    root,
    planDir,
    planRef: 'dev-plans/2026-08-21-example',
    taskDir: path.join(planDir, 'deliveries/s1'),
  };
}

async function delegate(fixture) {
  const result = runSliced(fixture.root, ['delegate-task', fixture.planRef, 'S1']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(await readFile(path.join(fixture.taskDir, 'task.json'), 'utf8'));
}

async function readTaskHash(fixture) {
  const result = runDeliver(fixture.root, ['task-hash', path.relative(fixture.root, fixture.taskDir)]);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

async function prepareNoChangeDelivery(fixture) {
  const task = await delegate(fixture);
  let result = runDeliver(fixture.root, ['init', path.relative(fixture.root, fixture.taskDir)]);
  assert.equal(result.status, 0, result.stderr);
  await appendFile(
    path.join(fixture.taskDir, 'audits.md'),
    '\n### A1：上下文预检与验证\n\n已读取真实代码和项目规则；无需业务变化，验证通过。\n',
  );
  const taskHash = await readTaskHash(fixture);
  const binding = taskBinding(task, taskHash);
  await writeFile(
    path.join(fixture.taskDir, 'execution.json'),
    `${JSON.stringify({
      schemaVersion: 'deliver-task.execution.v1',
      task: binding,
      allowedPaths: ['src/slug.mjs'],
      forbiddenPaths: [],
      evidenceRefs: ['audits.md#A1'],
    }, null, 2)}\n`,
  );
  result = runDeliver(fixture.root, ['snapshot-target', path.relative(fixture.root, fixture.taskDir)]);
  assert.equal(result.status, 0, result.stderr);
  const target = JSON.parse(result.stdout);
  const reviewBinding = {
    task: binding,
    executionHash: target.executionHash,
    target,
  };
  await appendFile(
    path.join(fixture.taskDir, 'audits.md'),
    `\n### A2：General Review\n\n最终累计 full clean。\n\n\`\`\`deliver-task-binding\n${JSON.stringify(reviewBinding)}\n\`\`\`\n`,
  );
  await writeFile(
    path.join(fixture.taskDir, 'claims.json'),
    `${JSON.stringify({
      schemaVersion: 'deliver-task.claims.v1',
      task: binding,
      claims: [{
        claimId: 'C1',
        statement: '当前实现已满足任务验收。',
        status: 'verified',
        evidenceRefs: ['audits.md#A1'],
      }],
    }, null, 2)}\n`,
  );
  await writeFile(
    path.join(fixture.taskDir, 'delivery.json'),
    `${JSON.stringify({
      schemaVersion: 'deliver-task.delivery.v1',
      task: binding,
      result: 'delivered',
      target,
      evidenceRefs: {
        claims: 'claims.json',
        verification: 'audits.md#A1',
        generalReview: 'audits.md#A2',
        acceptance: null,
        rulesReview: 'not-applicable',
      },
      residualRiskRefs: [],
      upstreamRequest: null,
    }, null, 2)}\n`,
  );
  return { task, target };
}

test('validate 接受只承载拆分与委托状态的新 plan', async () => {
  const fixture = await createFixture();

  const result = runSliced(fixture.root, ['validate', fixture.planRef]);

  assert.equal(result.status, 0, result.stderr);
});

test('validate 拒绝旧的单任务执行状态与工件小节', async () => {
  const fixture = await createFixture();
  const planPath = path.join(fixture.planDir, 'plan.md');
  let plan = await readFile(planPath, 'utf8');
  plan = plan
    .replace('- 依赖：无', `- 依赖：无
- 上下文预检：ready
- 硬门禁：passed
- AI Review：passed
- 修复次数：0/4
- Commit：已提交
- baseCommit：${git(fixture.root, ['rev-parse', 'HEAD'])}
- 验证：passed`)
    .replace('#### 委托合同', `#### 上下文预检

- 允许修改：
  - src/slug.mjs

#### 委托合同`);
  await writeFile(planPath, plan);

  const result = runSliced(fixture.root, ['validate', fixture.planRef]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /unsupported delegated execution fields/);
  assert.match(result.stderr, /上下文预检/);
});

test('delegate-task 只创建 sliced-dev caller 的 immutable task contract', async () => {
  const fixture = await createFixture();
  const baseCommit = git(fixture.root, ['rev-parse', 'HEAD']);

  const task = await delegate(fixture);

  assert.deepEqual(task, {
    schemaVersion: 'deliver-task.task.v1',
    taskId: 's1',
    revision: 1,
    caller: {
      kind: 'delegated',
      name: 'sliced-dev',
      ref: `${fixture.planRef}/plan.md#S1`,
    },
    objective: '修复 slug 连续空白归一。',
    acceptanceCriteria: [
      '输入连续空白时只产生一个连字符。',
      '原有 slug 测试继续通过。',
    ],
    constraints: ['不新增依赖。', '保持现有大小写规则。'],
    nonGoals: ['不调整其它字符串工具。'],
    forbiddenPaths: ['package-lock.json'],
    baseCommit,
    commitPolicy: 'required',
    acceptancePolicy: 'not-required',
  });
  assert.equal(await pathExists(path.join(fixture.taskDir, 'execution.json')), false);
  const validation = runDeliver(fixture.root, ['validate-task', path.relative(fixture.root, fixture.taskDir)]);
  assert.equal(validation.status, 0, validation.stderr);
});

test('delegate-task 拒绝 symlink task directory 且不向 plan 外写入', async () => {
  const fixture = await createFixture();
  const outside = await mkdtemp(path.join(os.tmpdir(), 'sliced-dev-outside-'));
  await mkdir(path.dirname(fixture.taskDir), { recursive: true });
  await symlink(outside, fixture.taskDir);

  const result = runSliced(fixture.root, ['delegate-task', fixture.planRef, 'S1']);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /task directory must be a real directory/);
  assert.equal(await pathExists(path.join(outside, 'task.json')), false);
});

test('delegate-task 只在 immutable contract 变化时递增 task revision', async () => {
  const fixture = await createFixture();
  let task = await delegate(fixture);
  const firstHash = await readTaskHash(fixture);

  let plan = await readFile(path.join(fixture.planDir, 'plan.md'), 'utf8');
  plan = plan.replace('- 下一步：委托 S1', '- 下一步：继续等待 S1 交付');
  await writeFile(path.join(fixture.planDir, 'plan.md'), plan);
  task = await delegate(fixture);
  assert.equal(task.revision, 1);
  assert.equal(await readTaskHash(fixture), firstHash);

  plan = plan.replace('修复 slug 连续空白归一。', '修复 slug 连续空白与制表符归一。');
  await writeFile(path.join(fixture.planDir, 'plan.md'), plan);
  git(fixture.root, ['add', fixture.planRef]);
  git(fixture.root, ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-q', '-m', '更新 S1 合同']);
  task = await delegate(fixture);
  assert.equal(task.revision, 2);
  assert.notEqual(await readTaskHash(fixture), firstHash);
});

test('delegate-task 只有显式刷新 base 才为同一语义合同创建新 revision', async () => {
  const fixture = await createFixture();
  let task = await delegate(fixture);
  const firstBase = task.baseCommit;
  git(fixture.root, ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-q', '-m', '新的 caller 检查点']);
  const nextBase = git(fixture.root, ['rev-parse', 'HEAD']);

  task = await delegate(fixture);
  assert.equal(task.revision, 1);
  assert.equal(task.baseCommit, firstBase);

  const result = runSliced(fixture.root, ['delegate-task', fixture.planRef, 'S1', '--refresh-base']);
  assert.equal(result.status, 0, result.stderr);
  task = JSON.parse(await readFile(path.join(fixture.taskDir, 'task.json'), 'utf8'));
  assert.equal(task.revision, 2);
  assert.equal(task.baseCommit, nextBase);
});

test('slice-close-check 只消费并验证 deliver-task 的 delivered 结果', async () => {
  const fixture = await createFixture();
  await prepareNoChangeDelivery(fixture);
  await writeFile(path.join(fixture.planDir, 'plan.md'), renderPlan({ status: 'done' }));

  const result = runSliced(fixture.root, ['slice-close-check', fixture.planRef, 'S1']);

  assert.equal(result.status, 0, result.stderr);
});

test('slice-close-check 拒绝非 delivered 结果而不解释其语义理由', async () => {
  const fixture = await createFixture();
  await prepareNoChangeDelivery(fixture);
  await writeFile(path.join(fixture.planDir, 'plan.md'), renderPlan({ status: 'done' }));
  const deliveryPath = path.join(fixture.taskDir, 'delivery.json');
  const delivery = JSON.parse(await readFile(deliveryPath, 'utf8'));
  delivery.result = 'blocked';
  delivery.target = null;
  delivery.evidenceRefs = {
    claims: 'claims.json',
    verification: null,
    generalReview: null,
    acceptance: null,
    rulesReview: null,
  };
  delivery.upstreamRequest = {
    kind: 'blocker',
    summary: '环境不可用。',
    evidenceRefs: ['audits.md#A1'],
  };
  await writeFile(deliveryPath, `${JSON.stringify(delivery, null, 2)}\n`);

  const result = runSliced(fixture.root, ['slice-close-check', fixture.planRef, 'S1']);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /delivery result must be delivered/);
});

test('plan-commit-check 接受 task-owned durable state 并拒绝 deliver artifacts', async () => {
  const accepted = await createFixture();
  await prepareNoChangeDelivery(accepted);
  git(accepted.root, ['add', accepted.planRef]);

  let result = runSliced(accepted.root, ['plan-commit-check', accepted.planRef]);
  assert.equal(result.status, 0, result.stderr);

  const rejected = await createFixture();
  await prepareNoChangeDelivery(rejected);
  const artifact = path.join(rejected.taskDir, 'artifacts/review-package.md');
  await mkdir(path.dirname(artifact), { recursive: true });
  await writeFile(artifact, 'generated\n');
  git(rejected.root, ['add', rejected.planRef]);
  git(rejected.root, ['add', '-f', path.relative(rejected.root, artifact)]);

  result = runSliced(rejected.root, ['plan-commit-check', rejected.planRef]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /artifacts/);
});

test('旧单任务执行命令不再属于 sliced-dev CLI surface', async () => {
  const fixture = await createFixture();

  for (const command of [
    'diff-check',
    'claims-template',
    'task-brief',
    'task-report-template',
    'review-package',
    'rule-review-package',
    'review-prompt',
    'pre-commit-check',
    'record-commit',
  ]) {
    const result = runSliced(fixture.root, [command, fixture.planRef, 'S1']);
    assert.equal(result.status, 2, `${command}: ${result.stderr || result.stdout}`);
  }
});
