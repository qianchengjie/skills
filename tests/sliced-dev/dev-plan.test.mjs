import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  access,
  appendFile,
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  __private__,
  initPlan,
  validatePlan,
} from '../../skills/sliced-dev/scripts/dev-plan.mjs';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const slicedScript = path.join(repoRoot, 'skills/sliced-dev/scripts/dev-plan.mjs');
const deliverScript = path.join(repoRoot, 'skills/deliver-task/scripts/deliver-task.mjs');

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function run(cwd, script, args) {
  return spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8' });
}

function runSliced(cwd, args) {
  return run(cwd, slicedScript, args);
}

function runDeliver(cwd, args) {
  return run(cwd, deliverScript, args);
}

async function exists(target) {
  return access(target).then(() => true, () => false);
}

function sliceBlock({
  id = 'S1',
  title = '修复 slug',
  status = 'not-started',
  gate = 'grilled',
  risk = 'B',
  execution = '自动',
  dependency = '无',
  extraHeader = '',
  acceptancePolicy = 'not-required',
  objective = '修复 slug 连续空白归一。',
  associations = '暂无。',
} = {}) {
  return `### ${id}：${title}

- 状态：${status}
- 门禁：${gate}
- 候选：候选自动
- 风险：${risk}
- 执行：${execution}
- 依赖：${dependency}${extraHeader}

#### 关联项

${associations}

#### 委托合同

- 验收策略：${acceptancePolicy}
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

function renderPlan({
  slices = [sliceBlock()],
  status = 'executing',
  phase = status === 'done' ? 'done' : 'executing',
  currentSlice = status === 'done' ? '无' : 'S1',
  extraMetadata = '',
  extraSections = '',
} = {}) {
  return `# 示例计划

> 档位：完整
> 状态：${status}
> 上游依据：issue:example
> 计划一致性预检：passed
> 拆分拷问：grilled${extraMetadata}

## 当前状态

- 阶段：${phase}
- 当前切片：${currentSlice}
- 下一步：${status === 'done' ? '任务已收口' : '委托当前切片'}

## 文件索引

| 文件 | 职责 |
| --- | --- |
| [decisions.md](./decisions.md) | 分叉正文 |
| [audits.md](./audits.md) | 计划级长审计与跨切片证据 |
| [deliveries/](./deliveries/) | deliver-task 的任务合同与交付结果 |

## 目标

完成示例计划。

## 全局约束

- 不新增依赖。

## 切片

${slices.join('\n')}${extraSections}`;
}

async function fixture({ plan = renderPlan(), decisions = '# 分叉记录\n', audits = '# 审计记录\n' } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sliced-dev-plan-'));
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(path.join(root, 'src/slug.mjs'), 'export const slug = (value) => value.trim();\n');
  git(root, ['init', '-q']);
  git(root, ['add', 'src/slug.mjs']);
  git(root, ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-q', '-m', '基线']);
  const planRef = 'dev-plans/2026-08-21-example';
  const planDir = path.join(root, planRef);
  await mkdir(planDir, { recursive: true });
  await Promise.all([
    writeFile(path.join(planDir, 'plan.md'), plan),
    writeFile(path.join(planDir, 'decisions.md'), decisions),
    writeFile(path.join(planDir, 'audits.md'), audits),
  ]);
  git(root, ['add', planRef]);
  git(root, ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-q', '-m', '计划检查点 P']);
  return {
    root,
    planRef,
    planDir,
    taskDir: path.join(planDir, 'deliveries/s1'),
  };
}

async function delegate(current, sliceId = 'S1') {
  const result = runSliced(current.root, ['delegate-task', current.planRef, sliceId]);
  assert.equal(result.status, 0, result.stderr);
  const taskId = __private__.taskIdForSlice(sliceId);
  return JSON.parse(await readFile(path.join(current.planDir, `deliveries/${taskId}/task.json`), 'utf8'));
}

async function prepareNoChangeDelivery(current, sliceId = 'S1') {
  const task = await delegate(current, sliceId);
  const taskId = __private__.taskIdForSlice(sliceId);
  const taskDir = path.join(current.planDir, `deliveries/${taskId}`);
  const taskRef = path.relative(current.root, taskDir);
  let result = runDeliver(current.root, ['init', taskRef]);
  assert.equal(result.status, 0, result.stderr);
  await appendFile(taskDir + '/audits.md', '\n### A1：验证\n\n验证通过。\n');
  result = runDeliver(current.root, ['task-hash', taskRef]);
  assert.equal(result.status, 0, result.stderr);
  const binding = { taskId: task.taskId, revision: task.revision, taskHash: result.stdout.trim() };
  await writeFile(
    path.join(taskDir, 'execution.json'),
    `${JSON.stringify({
      schemaVersion: 'deliver-task.execution.v1',
      task: binding,
      allowedPaths: ['src/slug.mjs'],
      forbiddenPaths: [],
      evidenceRefs: ['audits.md#A1'],
    }, null, 2)}\n`,
  );
  result = runDeliver(current.root, ['snapshot-target', taskRef]);
  assert.equal(result.status, 0, result.stderr);
  const target = JSON.parse(result.stdout);
  await appendFile(
    path.join(taskDir, 'audits.md'),
    `\n### A2：General Review\n\n累计 full clean。\n\n\`\`\`deliver-task-binding\n${JSON.stringify({ task: binding, executionHash: target.executionHash, target })}\n\`\`\`\n`,
  );
  await writeFile(
    path.join(taskDir, 'claims.json'),
    `${JSON.stringify({
      schemaVersion: 'deliver-task.claims.v1',
      task: binding,
      claims: [{
        claimId: 'C1',
        statement: '当前结果满足验收。',
        status: 'verified',
        evidenceRefs: ['audits.md#A1'],
      }],
    }, null, 2)}\n`,
  );
  await writeFile(
    path.join(taskDir, 'delivery.json'),
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
  return { task, taskDir, target };
}

async function prepareNeedsReslice(current, sliceId = 'S1') {
  const task = await delegate(current, sliceId);
  const taskId = __private__.taskIdForSlice(sliceId);
  const taskDir = path.join(current.planDir, `deliveries/${taskId}`);
  const taskRef = path.relative(current.root, taskDir);
  let result = runDeliver(current.root, ['init', taskRef]);
  assert.equal(result.status, 0, result.stderr);
  await appendFile(taskDir + '/audits.md', '\n### A1：需要重新拆片\n\n发现两个独立交付单元。\n');
  result = runDeliver(current.root, ['task-hash', taskRef]);
  assert.equal(result.status, 0, result.stderr);
  const binding = { taskId: task.taskId, revision: task.revision, taskHash: result.stdout.trim() };
  await writeFile(
    path.join(taskDir, 'delivery.json'),
    `${JSON.stringify({
      schemaVersion: 'deliver-task.delivery.v1',
      task: binding,
      result: 'needs-reslice',
      target: null,
      evidenceRefs: {
        claims: 'claims.json',
        verification: null,
        generalReview: null,
        acceptance: null,
        rulesReview: null,
      },
      residualRiskRefs: [],
      upstreamRequest: {
        kind: 'reslice',
        summary: '当前合同包含两个独立交付单元。',
        evidenceRefs: ['audits.md#A1'],
      },
    }, null, 2)}\n`,
  );
}

test('init 只创建多任务计划真源，不创建旧单任务工件目录', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sliced-dev-init-'));
  git(root, ['init', '-q']);
  const previous = process.cwd();
  process.chdir(root);
  try {
    const planRef = await initPlan({ slug: 'demo', title: '示例任务', date: '2026-08-21' });
    assert.equal(planRef, 'dev-plans/2026-08-21-demo');
    assert.equal(await exists(path.join(root, planRef, 'plan.md')), true);
    assert.equal(await exists(path.join(root, planRef, 'decisions.md')), true);
    assert.equal(await exists(path.join(root, planRef, 'audits.md')), true);
    assert.equal(await exists(path.join(root, planRef, 'claims')), false);
    assert.equal(await exists(path.join(root, planRef, 'task-briefs')), false);
    assert.equal(await exists(path.join(root, planRef, 'task-reports')), false);
    assert.equal(await exists(path.join(root, planRef, 'deliveries')), false);
    assert.equal(await readFile(path.join(root, 'dev-plans/.gitignore'), 'utf8'), '*/review-packages/**\n');
  } finally {
    process.chdir(previous);
  }
});

test('validate 接受多切片依赖图和计划级 D/A 引用', async () => {
  const plan = renderPlan({
    slices: [
      sliceBlock({
        associations: '| ID | 状态 |\n| --- | --- |\n| D1 | decided |\n| A1 | done |',
      }),
      sliceBlock({ id: 'S2', title: '接入调用方', dependency: 'S1' }),
    ],
  });
  const current = await fixture({
    plan,
    decisions: '# 分叉记录\n\n### D1：稳定口径\n\n- 状态：decided\n- 关联：S1\n- 结论：保持既有接口。\n',
    audits: '# 审计记录\n\n### A1：跨切片证据\n\n- 状态：done\n- 关联：S1 / S2\n',
  });
  const result = runSliced(current.root, ['validate', current.planRef]);
  assert.equal(result.status, 0, result.stderr);
});

test('executing/done plan 至少包含一个切片', async () => {
  const current = await fixture({
    plan: renderPlan({ slices: [], currentSlice: '待定' }),
  });

  const result = runSliced(current.root, ['validate', current.planRef]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /executing plan requires at least one slice/);
});

test('validate 忽略 fenced code 内的伪标题和伪字段', async () => {
  const plan = renderPlan().replace(
    '修复 slug 连续空白归一。',
    '修复 slug 连续空白归一。\n\n```markdown\n## 伪顶层\n- AI Review：passed\n#### 上下文预检\n```',
  );
  const current = await fixture({ plan });
  const result = runSliced(current.root, ['validate', current.planRef]);
  assert.equal(result.status, 0, result.stderr);
});

test('validate 拒绝未知 slice 字段和未知小节', async () => {
  const plan = renderPlan({
    slices: [sliceBlock({ extraHeader: '\n- 临时状态：ready' }).replace('#### 验收', '#### 私有工件\n\n无。\n\n#### 验收')],
  });
  const current = await fixture({ plan });
  const result = runSliced(current.root, ['validate', current.planRef]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /unsupported field 临时状态/);
  assert.match(result.stderr, /unsupported subsection 私有工件/);
});

test('validate 拒绝未知顶部元信息、C 类自动执行和未闭合终态门禁', async () => {
  let current = await fixture({ plan: renderPlan({ extraMetadata: '\n> 临时结论：passed' }) });
  let result = runSliced(current.root, ['validate', current.planRef]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /unsupported metadata 临时结论/);

  current = await fixture({
    plan: renderPlan({ slices: [sliceBlock({ risk: 'C', execution: '自动', acceptancePolicy: 'required' })] }),
  });
  result = runSliced(current.root, ['validate', current.planRef]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /risk C cannot use 执行 自动/);

  current = await fixture({
    plan: renderPlan({
      slices: [
        sliceBlock({
          status: 'split',
          gate: 'pending-grill',
          extraHeader: '\n- 替代切片：S1.1',
        }),
        sliceBlock({ id: 'S1.1' }),
      ],
    }),
  });
  result = runSliced(current.root, ['validate', current.planRef]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /split slice requires closed 门禁/);
});

test('validate 拒绝缺失依赖和依赖环', async () => {
  let current = await fixture({ plan: renderPlan({ slices: [sliceBlock({ dependency: 'S9' })] }) });
  let result = runSliced(current.root, ['validate', current.planRef]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /dependency S9 does not exist/);

  current = await fixture({
    plan: renderPlan({
      slices: [
        sliceBlock({ id: 'S1', dependency: 'S2' }),
        sliceBlock({ id: 'S2', dependency: 'S1' }),
      ],
    }),
  });
  result = runSliced(current.root, ['validate', current.planRef]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /dependency cycle/);
});

test('delegate-task 在依赖未完成时停止', async () => {
  const current = await fixture({
    plan: renderPlan({
      currentSlice: 'S2',
      slices: [
        sliceBlock({ id: 'S1', status: 'in-progress' }),
        sliceBlock({ id: 'S2', dependency: 'S1' }),
      ],
    }),
  });
  const result = runSliced(current.root, ['delegate-task', current.planRef, 'S2']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /dependencies are not done\/skipped: S1/);
});

test('嵌套 slice ID 映射为稳定的小写 taskId 和 caller ref', async () => {
  const current = await fixture({
    plan: renderPlan({
      currentSlice: 'S2.1',
      slices: [sliceBlock({ id: 'S2.1' })],
    }),
  });
  const task = await delegate(current, 'S2.1');
  assert.equal(task.taskId, 's2-1');
  assert.deepEqual(task.caller, {
    kind: 'delegated',
    name: 'sliced-dev',
    ref: `${current.planRef}/plan.md#S2.1`,
  });
});

test('C 或需确认切片必须把 upstream acceptance 设为 required', async () => {
  for (const options of [{ risk: 'C' }, { execution: '需确认' }]) {
    const current = await fixture({ plan: renderPlan({ slices: [sliceBlock(options)] }) });
    const result = runSliced(current.root, ['validate', current.planRef]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /requires 验收策略 required/);
  }
});

test('validate 在 task 已存在时检查 plan immutable projection', async () => {
  const current = await fixture();
  await delegate(current);
  const planPath = path.join(current.planDir, 'plan.md');
  const plan = (await readFile(planPath, 'utf8')).replace(
    '修复 slug 连续空白归一。',
    '修复 slug 连续空白与制表符归一。',
  );
  await writeFile(planPath, plan);
  const result = runSliced(current.root, ['validate', current.planRef]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /task\.json immutable contract is stale/);
});

test('delegate-task 遇到既有非法 task 时不覆盖原文件', async () => {
  const current = await fixture();
  await mkdir(current.taskDir, { recursive: true });
  await writeFile(path.join(current.taskDir, 'task.json'), '{"legacy":true}\n');
  const result = runSliced(current.root, ['delegate-task', current.planRef, 'S1']);
  assert.equal(result.status, 1);
  assert.equal(await readFile(path.join(current.taskDir, 'task.json'), 'utf8'), '{"legacy":true}\n');
});

test('delivery-status 只返回薄 delivery 投影，不复制证据正文', async () => {
  const current = await fixture();
  await prepareNoChangeDelivery(current);
  const result = runSliced(current.root, ['delivery-status', current.planRef, 'S1']);
  assert.equal(result.status, 0, result.stderr);
  const status = JSON.parse(result.stdout);
  assert.equal(status.result, 'delivered');
  assert.equal(status.target.kind, 'no-change');
  assert.equal(status.taskDir, `${current.planRef}/deliveries/s1`);
  assert.equal('verification' in status, false);
});

test('done slice 必须有可验证且 delivered 的下游结果', async () => {
  const current = await fixture({
    plan: renderPlan({ status: 'done', slices: [sliceBlock({ status: 'done' })] }),
  });
  const result = runSliced(current.root, ['validate', current.planRef]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /done slice requires delegated task\.json/);
});

test('split slice 消费 needs-reslice，skipped slice 使用 decided D', async () => {
  const skippedPlan = renderPlan({
    status: 'done',
    slices: [sliceBlock({
      status: 'skipped',
      extraHeader: '\n- 跳过依据：D1',
      associations: '| ID | 状态 |\n| --- | --- |\n| D1 | decided |',
    })],
  });
  const current = await fixture({
    plan: skippedPlan,
    decisions: '# 分叉记录\n\n### D1：取消切片\n\n- 状态：decided\n- 关联：S1\n- 结论：无需修改。\n',
  });
  const result = runSliced(current.root, ['validate', current.planRef]);
  assert.equal(result.status, 0, result.stderr);
});

test('needs-reslice 只能把原片推进为带真实后代的 split', async () => {
  const current = await fixture();
  await prepareNeedsReslice(current);
  await writeFile(
    path.join(current.planDir, 'plan.md'),
    renderPlan({
      currentSlice: 'S1.1',
      slices: [
        sliceBlock({ status: 'split', extraHeader: '\n- 替代切片：S1.1 / S1.2' }),
        sliceBlock({ id: 'S1.1', title: '修复 slug 核心逻辑' }),
        sliceBlock({ id: 'S1.2', title: '补充 slug 边界测试', dependency: 'S1.1' }),
      ],
    }),
  );

  const result = runSliced(current.root, ['validate', current.planRef]);

  assert.equal(result.status, 0, result.stderr);
});

test('open decision 必须可见并阻塞关联切片', async () => {
  const decisions = '# 分叉记录\n\n### D1：选择接口\n\n- 状态：open\n- 关联：S1\n- 问题：使用哪个接口？\n- 推荐：保持现状。\n';
  let current = await fixture({ decisions });
  let result = runSliced(current.root, ['validate', current.planRef]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /open decision is not referenced/);

  current = await fixture({
    decisions,
    plan: renderPlan({
      slices: [sliceBlock({
        associations: '| ID | 状态 |\n| --- | --- |\n| D1 | open |',
      })],
    }),
  });
  result = runSliced(current.root, ['validate', current.planRef]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /slice with open decision must be blocked/);
});

test('show 与 roster 只展示编排状态及 delivery 结果', async () => {
  const current = await fixture();
  await prepareNoChangeDelivery(current);
  let result = runSliced(current.root, ['show', current.planRef, 'current']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^### S1：修复 slug/m);
  assert.doesNotMatch(result.stdout, /execution\.json/);

  result = runSliced(current.root, ['roster', current.planRef]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\| S1 .*\| delivered \|/);
});

test('whole-review-package 聚合 task、delivery 和 target diff，不生成单片 review 工件', async () => {
  const current = await fixture();
  await prepareNoChangeDelivery(current);
  await writeFile(
    path.join(current.planDir, 'plan.md'),
    renderPlan({ status: 'done', slices: [sliceBlock({ status: 'done' })] }),
  );
  const result = runSliced(current.root, ['whole-review-package', current.planRef]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /reviewPackageHash sha256:/);
  const packagePath = path.join(current.planDir, 'review-packages/whole-task.md');
  const reviewPackage = await readFile(packagePath, 'utf8');
  assert.match(reviewPackage, /## S1 委托结果/);
  assert.match(reviewPackage, /deliver-task\.task\.v1/);
  assert.match(reviewPackage, /deliver-task\.delivery\.v1/);
  assert.equal(await exists(path.join(current.planDir, 'review-packages/S1.md')), false);
});

test('未启用整任务审查时 close-check 接受已闭合计划', async () => {
  const current = await fixture();
  await prepareNoChangeDelivery(current);
  await writeFile(
    path.join(current.planDir, 'plan.md'),
    renderPlan({ status: 'done', slices: [sliceBlock({ status: 'done' })] }),
  );

  const result = runSliced(current.root, ['close-check', current.planRef]);

  assert.equal(result.status, 0, result.stderr);
});

test('close-check 要求绑定当前 whole review package 的明确 passed 结论', async () => {
  const current = await fixture();
  await prepareNoChangeDelivery(current);
  await writeFile(
    path.join(current.planDir, 'plan.md'),
    renderPlan({ status: 'done', slices: [sliceBlock({ status: 'done' })] }),
  );
  let result = runSliced(current.root, ['whole-review-package', current.planRef]);
  assert.equal(result.status, 0, result.stderr);
  const hash = /reviewPackageHash (sha256:[0-9a-f]{64})/.exec(result.stdout)[1];
  const verdictRows = [
    '全局约束符合性',
    '跨切片交接一致性',
    '非目标 / 边界回归',
    '需求闭合性',
    '残余风险 / 发布就绪度',
  ].map((verdict) => `| ${verdict} | passed | not-applicable | review package | 已检查 |`).join('\n');
  const closedPlan = renderPlan({
    status: 'done',
    slices: [sliceBlock({ status: 'done' })],
    extraMetadata: '\n> 整任务审查：passed',
    extraSections: `\n## 整任务审查结论\n\n- reviewPackageHash：${hash}\n\n| Verdict | Status | Severity | Evidence | Note |\n| --- | --- | --- | --- | --- |\n${verdictRows}\n`,
  });
  await writeFile(path.join(current.planDir, 'plan.md'), closedPlan);
  result = runSliced(current.root, ['close-check', current.planRef]);
  assert.equal(result.status, 0, result.stderr);

  await appendFile(path.join(current.planDir, 'review-packages/whole-task.md'), '\n变化\n');
  result = runSliced(current.root, ['close-check', current.planRef]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /whole review package hash is stale/);
});

test('plan-commit-check 拒绝业务文件，并要求 durable plan state 全部 staged', async () => {
  let current = await fixture();
  await writeFile(path.join(current.planDir, 'plan.md'), (await readFile(path.join(current.planDir, 'plan.md'), 'utf8')).replace('委托当前切片', '继续 S1'));
  await writeFile(path.join(current.root, 'src/slug.mjs'), 'export const slug = (value) => value.trim().toLowerCase();\n');
  git(current.root, ['add', 'src/slug.mjs']);
  let result = runSliced(current.root, ['plan-commit-check', current.planRef]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /outside durable plan scope: src\/slug\.mjs/);

  current = await fixture();
  await writeFile(path.join(current.planDir, 'plan.md'), (await readFile(path.join(current.planDir, 'plan.md'), 'utf8')).replace('委托当前切片', '继续 S1'));
  await appendFile(path.join(current.planDir, 'audits.md'), '\n计划说明。\n');
  git(current.root, ['add', `${current.planRef}/plan.md`]);
  result = runSliced(current.root, ['plan-commit-check', current.planRef]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /durable plan state is not fully staged: .*audits\.md/);
});

test('plan-commit-check 拒绝不属于任何 slice 的伪 task directory', async () => {
  const current = await fixture();
  const fake = path.join(current.planDir, 'deliveries/fake/task.json');
  await mkdir(path.dirname(fake), { recursive: true });
  await writeFile(fake, '{}\n');
  git(current.root, ['add', path.relative(current.root, fake)]);

  const result = runSliced(current.root, ['plan-commit-check', current.planRef]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /outside durable plan scope: .*deliveries\/fake\/task\.json/);
});

test('CLI 拒绝绝对 plan path 和 symlink plan directory', async () => {
  const current = await fixture();
  let result = runSliced(current.root, ['validate', current.planDir]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /repository-relative/);

  const link = path.join(current.root, 'dev-plans/2026-08-21-link');
  await symlink(current.planDir, link);
  assert.equal((await lstat(link)).isSymbolicLink(), true);
  result = runSliced(current.root, ['validate', 'dev-plans/2026-08-21-link']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /real directory/);
});

test('公开纯函数保留稳定的 slice/task identity 基元', () => {
  assert.equal(__private__.taskIdForSlice('S12.3'), 's12-3');
  assert.equal(__private__.sha256('x'), 'sha256:2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881');
  assert.equal(__private__.canonicalJson({ b: 1, a: { d: 2, c: 3 } }), '{"a":{"c":3,"d":2},"b":1}');
});
