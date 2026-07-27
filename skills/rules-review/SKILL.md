---
name: rules-review
description: 项目规则驱动的 commit 代码审查流程。读取目标 commit 中的 `.agents/rules/index.md` 与适用 active 规则，把固定 commit range 消费为 `ruleSet -> targets -> applicabilityMatrix -> reviewItems -> executionPlan -> reviewBatches -> results -> finalReview`，并用 validator 校验协议闭合。仅审查已提交内容；默认只读，不维护规则仓，不替代全量功能 QA。
disable-model-invocation: true
---

# 规范审查

`rules-review` 使用 `schemaVersion = 5`。TARGET 只能是 Git commit。每个新的 TARGET 都创建全新 run，完整审查该 TARGET 的全部当前 `reviewItems`，不继承旧结果，也不把修复轮当作增量审查。

`protocolGate = "passed"` 只表示本轮结构协议闭合，不表示代码无问题。代码结论同时看 `semanticVerdict`、`issueSummary` 和 `recommendation`。

## 1. 解析用户入口

controller 只把用户语法解析为固定的 BASE commit 与 TARGET commit，不把入口写法保存进工件：

| 用户请求 | BASE | TARGET |
| --- | --- | --- |
| `commit <rev>` | 唯一可解析的 base | commit tree |
| `commit <rev> --base <base-rev>` | 指定 commit | commit tree |

BASE、TARGET 或目标解释不唯一时立即 blocked，不任选一种解释。用户要求审查 current、staged、worktree、branch 或裸 tree 时，停止并要求先形成目标 commit；不要把这些入口静默降级为 commit 审查。

内部封印接口：

```text
node scripts/validate.js --mode seal-dispatch \
  --input <dispatch.json> \
  --base <revision> \
  --target-commit <revision>
```

`--target-commit` 是唯一 TARGET selector，成功时固定 `targetTree = targetCommit^{tree}`、`boundCommit = targetCommit`、`excludedFiles = []`。`excludedRuleRefs` 仍可形成规则范围分区。`seal-dispatch` 只解析并读取已有 commit、tree 与 blob，不创建 Git object，不修改真实 index、工作文件、staged/unstaged 状态或 worktree 列表。作为命令控制输入的 `dispatch.json` 不属于 TARGET；TARGET 只由指定 commit 决定。已经带有 `targetTree` 的 dispatch 不得原地重封；新 TARGET 必须创建新 run。

## 2. 不可变输入

封印后的范围为：

```yaml
reviewRange:
  baseCommit: <累计审查起点 commit>
  baseTree: <累计审查起点 tree>
  targetTree: <实际接受并审查的 tree>
  boundCommit: <实际接受并审查的 target commit>
  excludedFiles: []
```

`baseTree` 与 `targetTree` 分别从 `baseCommit` 与 `boundCommit` 只读派生。`boundCommit` 在封印时必须存在，且其 tree 必须等于 `targetTree`。

代码输入快照为：

```yaml
inputSnapshot:
  files:
    - inputRef: src/example.ts
      state: present
      mode: "100644"
      contentHash: sha256:...
    - inputRef: src/deleted.ts
      state: deleted
```

规则快照为：

```yaml
ruleSnapshot:
  files:
    - path: .agents/rules/index.md
      content: <封印文本>
      contentHash: sha256:...
```

封印后所有 controller、reviewer、task builder、aggregator 和 renderer 只读取 `baseTree`、`targetTree`、tree entry、blob、`inputSnapshot` 与 `ruleSnapshot`：

```text
git diff <baseTree> <targetTree>
git show <targetTree>:<path>
```

不得回读当前同名文件或 index 来补齐内容。每次消费前重新验证必需 commit/tree/blob；对象缺失时原 run 立即失效，不在原 runId 下重建，也不回退当前状态。

rules-review run 是临时运行数据，不承诺跨会话、跨环境、跨天或长期恢复。

## 3. 文件范围

审查范围固定为完整 commit range：

```text
候选变更 = git diff <baseCommit> <boundCommit>
excludedFiles = []
```

不支持文件排除。漏项、非普通 blob 或无法唯一读取的 entry 都 blocked。`excludedRuleRefs` 仍可形成规则范围分区。

`scopeMode` 只按最终范围事实派生：

```text
excludedRuleRefs 非空 => scoped
excludedRuleRefs 为空 => full
```

不保存用户是否显式输入 paths，也不接受局部文件 commit 审查。

## 4. 规则与目标

项目规则入口是 `.agents/rules/index.md`。controller 读取 CORE 与按 `trigger / applies-to` 命中的 active 规则，形成稳定 `ruleRef`、来源文件和规则正文快照。

规则集合必须是完整互斥分区：

```text
candidateRuleRefs
= selectedRuleRefs
∪ excludedRuleRefs
∪ globallyNotApplicableRuleRefs

requiredRuleRefs ⊆ selectedRuleRefs
```

- `selectedRuleRefs`：实际进入本轮适用性判断和审查的规则。
- `excludedRuleRefs`：已判定适用，但被有意跳过的规则。
- `globallyNotApplicableRuleRefs`：不适用于当前 TARGET 的规则。
- `requiredRuleRefs`：selected 中必须逐目标完成适用性判断的规则。

validator 校验声明集合的完整、互斥和引用闭合；候选发现与适用性结论由 controller/reviewer 负责。

目标统一使用 `targetId`。最小审查原子为：

```text
ruleRef x targetId = reviewItem
```

对每个 `requiredRuleRefs x targets` 组合先生成一行 `applicabilityMatrix`：

- `applicable` 必须绑定匹配的 `required: true` reviewItem。
- `not_applicable` 必须写 reason，不得绑定 reviewItem。
- evidence 必须可定位。

`reviewItems` 只能引用 selected 规则。每个当前 reviewItem 必须恰好进入一个当前 batch，并由当前 run 的 shard 返回恰好一个 result。`no_batch` 只允许 `reviewItems` 为空。

## 5. 工件与职责

```text
.rules-review-tmp/<run-id>/
  dispatch.json
  tasks/<reviewBatchId>.json
  retries/<reviewBatchId>-retry-<n>.json
  shards/<reviewBatchId>.json
  validations/<artifact>.json
  finalReview.json
  final.md
  response.md
```

所有 agent 间工件必须是 strict JSON。

- `dispatch.json`：controller 的规则、目标、适用性、固定 range 和分派计划；不得含审查结论。
- `tasks/*.json`：由 `build-tasks` 从 dispatch 机械投影，携带相同 `reviewRange`、`inputSnapshot`，以及规则索引和本批规则的 `ruleSnapshot`；`taskHash` 是删除自身字段后整份 task 的 canonical JSON SHA-256。
- `shards/*.json`：reviewer 对本 batch 的当前结果，必须回显 task 的 `targetTree` 与 `taskHash`；是产生 `passed / finding / observation / not_applicable / cannot_verify` 的唯一位置。
- `finalReview.json`：由 `aggregate-final` 仅从当前 run 的 shards 聚合。
- `final.md`、`response.md`：展示层，不是事实源。

不允许从旧 run 复制 result，不允许扫描目录猜测前序 run，不允许在 dispatch 中引用旧 review 工件。

## 6. reviewer 执行

reviewer 必须按 task 中的全部 reviewItems 返回结果，不能依赖主线程历史补齐规则或目标。审查代码只能使用固定 tree diff/blob；规则正文以 task 与 `ruleSnapshot` 的封印内容为准。

结果要求：

- `passed`：包含 evidence 与 failureChecks。
- `finding`：包含 origin、evidence；MUST finding 为 must_fix。
- `observation`：包含 origin，以及 reason 或 evidence。
- `not_applicable`：只允许非 required reviewItem，包含 reason。
- `cannot_verify`：包含 reason 或 evidence。

机器只验证结构、引用和结果闭合，不根据内容猜测结果是否正确。

需要多 batch 或用户明确要求并行审查时，读取 [references/subagent-all-aspects.md](references/subagent-all-aspects.md)。

## 7. 命令顺序

```text
seal-dispatch
dispatch
build-tasks
task
shard
aggregate-final
render-final
run
render-response
```

主要命令：

```text
node scripts/validate.js --mode dispatch --input dispatch.json
node scripts/validate.js --mode build-tasks --dispatch dispatch.json --out tasks/
node scripts/validate.js --mode task --input tasks/<reviewBatchId>.json
node scripts/validate.js --mode shard --task tasks/<reviewBatchId>.json --input shards/<reviewBatchId>.json
node scripts/validate.js --mode aggregate-final --dir .rules-review-tmp/<run-id> --output finalReview.json
node scripts/validate.js --mode render-final --input finalReview.json --dispatch dispatch.json --output final.md
node scripts/validate.js --mode run --dir .rules-review-tmp/<run-id>
node scripts/validate.js --mode render-response --dir .rules-review-tmp/<run-id>
```

任何阶段的 Git identity、hash、mode、范围、引用或状态不闭合都 fail closed。不得静默生成替代 tree、降级成当前文件或把不完整结果写成通过。

## 8. 机器边界

validator 检查：

- schemaVersion、固定字段、路径与 strict JSON。
- commit/tree/blob 存在，baseCommit/tree、boundCommit/tree 身份一致，且 `excludedFiles = []`。
- 完整 commit 文件范围和规则声明分区闭合。
- input/rule snapshot 的 mode、hash、内容与 targetTree 一致。
- task 投影、batch 引用和当前结果唯一覆盖。
- finalReview、Markdown 与当前结果的机械派生一致。

validator 明确不检查：

- BASE 选择是否符合业务意图。
- 候选规则发现、适用性结论和 finding 是否语义正确。
- evidence 强度或可信度。
- target、inputRefs 与 hunk 的业务归属。
- review 是否足够深入。

这些判断由 controller/reviewer 记录依据并承担责任，不能写成关键词启发式或规模阈值冒充语义审查。

## 9. 输出

最终回复直接复用 `render-response` 生成的 `response.md`。第一眼同时展示审查结论、问题数、无法验证数量与修复建议；不得把 `protocolGate = "passed"` 简写成“代码通过”。
