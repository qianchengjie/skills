---
name: rules-review
description: 项目规则驱动的代码审查流程，适用于项目内 `.agents/skills/rules-review`。读取 `.agents/rules/index.md` 与适用 active 规则，把规则消费为 `ruleSet -> targets -> applicabilityMatrix -> reviewItems -> executionPlan -> reviewBatches -> results -> finalReview`，并用 validator 校验协议闭合。默认只读，不维护规则仓，不替代全量功能 QA。
disable-model-invocation: true
---

# 规范审查

`rules-review` 是项目规则驱动的规范审查 skill。它不维护 `.agents/rules/`，不发明规则分类，不替代 `AGENTS.md`、OpenSpec、共享能力文档或代码证据；它只负责消费已有 active 规则、建立目标边界、分派审查原子、回收结果并输出可校验结论。

项目规则入口是 `.agents/rules/index.md`。最小消费前提：

- 能解析 `namespace id`、`source path`、`trigger / applies-to` 和稳定 `ruleRef`。
- 每个被消费规则都有可记录的 `sourceHash`，并带有 `summary` 或 `ruleText` 作为规则快照。
- 缺失任一前提时 fail closed：记录 `blocked`，不要自行补分类、补 ruleRef 或猜规则来源。

JSON 协议中的 enum 一律使用英文；最终 Markdown 和聊天回复继续渲染中文文案。

`protocolGate = "passed"` 只表示审查协议闭合：required reviewItems 都有且只有一个合法 result，validator gate 通过。它不表示代码没有问题；代码层结论必须同时看 `semanticVerdict`、`issueSummary` 和 `recommendation`。

---

## 1. 目标边界

开始后先建立目标边界：

- `cwd`、当前分支、`git status --short`
- 用户给定范围、commit、diff、指定路径或需求说明
- 审查目标类型：commit / staged diff / unstaged diff / branch diff / 指定路径
- 只读 / 可修复边界、背景脏文件、用户明确排除项
- 需要读取的 `.agents/rules/index.md` 与 active 规则文件

默认只读审查；除非用户明确要求修复，否则不得修改业务文件、stage 或 commit。

---

## 2. 规则消费流程

本流程的事实链是：

```text
ruleSet -> targets -> applicabilityMatrix -> reviewItems -> executionPlan -> reviewBatches -> results -> finalReview
```

主 agent 必须先读取 `.agents/rules/index.md`：

1. 读取 `CORE` 指向的 active 文件。
2. 按 `trigger / applies-to` 读取其它匹配的 active namespace 文件。
3. 形成 `ruleSet.candidateRuleRefs`。
4. 形成本轮一等输入 `ruleSet.selectedRuleRefs`，作为用户 / 上游 / 主 agent 声明的本轮审查范围真源。
5. 从本轮审查范围中拆出 `requiredRuleRefs`、`excludedRuleRefs` 和 `globallyNotApplicableRuleRefs`。
6. 为每个规则来源记录 `namespace`、`ruleRef`、`sourceFile`、`sourceHash`、`trigger`、`appliesTo`，以及 `summary` 或 `ruleText`。

`candidateRuleRefs` 是可见候选池，不是覆盖声明真源；`selectedRuleRefs` 是本轮审查范围真源。用户明确只要求审查 A、B 时，C 可以留在 candidate 中但不进入 selected；最终覆盖声明只对 selected 范围负责，不表示 candidate 全量都已处理。

不要把 namespace 或 ruleRef 本身当完成门禁。完成门禁只看本轮 selected 范围内的结构协议是否闭合：每个 required rule 对每个 target 都有适用性判断；`applicable` 行都有对应 required `reviewItem`；`required: true` 的 `reviewItems` 都有且只有一个合法 `result`。

最小审查原子是：

```text
ruleRef x targetId = reviewItem
```

`targets.changedUnits[]` 和 `targets.candidates[]` 必须统一使用 `targetId` 作为唯一 ID 字段。`reviewItem.targetId` 只能引用 `changedUnits[].targetId` 或 `candidates[].targetId`，不要继续使用 `uid` / `cid` / `uId` / `candidateId` 作为主键字段。

生成 `reviewItems` 前，必须先生成 `applicabilityMatrix[]`：

- 对每个 `requiredRuleRefs[] x (targets.changedUnits[] + targets.candidates[])` 组合记录一行。
- 每行必须标记 `applicability = applicable / not_applicable`，并给出可定位 `evidence[]`。
- `applicable` 行必须绑定一个匹配的 `required: true` `reviewItemId`；`not_applicable` 行必须写 `reason` 且不得绑定 `reviewItemId`。
- 机器只校验矩阵覆盖、引用闭合和 evidence 结构，不判断 `applicable / not_applicable` 的语义选择是否正确；语义争议由 reviewer 复核，不能靠 validator 猜。

---

## 3. JSON 工件

运行目录结构：

```text
.rules-review-tmp/<run-id>/
  dispatch.json
  tasks/<reviewBatchId>.json
  retries/<reviewBatchId>-retry-<n>.json
  shards/<reviewBatchId>.json
  validations/<artifact>.json
  finalReview.json
  final.md
```

所有 agent-to-agent 工件必须是 `JSON.parse` 可直接解析的 strict JSON；不允许 JSONC、注释、尾逗号、代码围栏或前后解释文本。

工件来源边界：

- `dispatch.json` 是主 agent 的计划判断产物，可以由主 agent 写入；它记录规则、目标、适用性、reviewItems 和 batch 计划，不得包含审查结论。
- `tasks/*.json` 是 `dispatch.json` 的机械投影，必须由 `validate.js --mode build-tasks` 生成；主 agent 不得手写或用临时脚本生成。
- `shards/*.json` 是 reviewer 的审查判断产物，是唯一产生 `passed / finding / cannot_verify` 的位置；不得由生成器根据 `dispatch.json` 批量制造。
- `finalReview.json` 是 `dispatch.json + shards/*.json` 的机械聚合，必须由 `validate.js --mode aggregate-final` 生成；主 agent 不得手写。
- `final.md` 和最终回复是展示层，必须由 `validate.js --mode render-final` / `render-response` 渲染。

只允许使用 rules-review 内置 `validate.js` 做投影、校验、聚合和渲染；不得创建或运行本次 review 专用的临时生成脚本来批量制造 `dispatch.json`、`tasks/*.json`、`shards/*.json` 或 `finalReview.json`。

### dispatch.json

`dispatch.json` 是主 agent 的计划、分派和聚合台账，至少包含：

- `kind = "rules-review-dispatch"`
- `schemaVersion = 2`
- `runId`
- `ruleSet`
- `targets`
- `applicabilityMatrix`
- `reviewItems`
- `executionPlan`
- `reviewBatches`

`ruleSet` 至少包含：

- `ruleSetId`
- `sourceIndexHash`
- `candidateRuleRefs[]`
- `selectedRuleRefs[]`
- `requiredRuleRefs[]`
- `excludedRuleRefs[]`
- `globallyNotApplicableRuleRefs[]`
- `ruleSources[]`

`ruleSources[]` 是 `.agents/rules` 的规则快照，必须包含 `ruleLevel: MUST / SHOULD / ADVISORY`。`ruleLevel` 是 finding 优先级的规则级真源；rules-review 只消费该字段，不维护 `.agents/rules`，也不兼容缺少 `ruleLevel` 的旧规则快照。

规则可选声明结构化义务：

- `failureConditions[]`：规则失败条件，包含稳定 `conditionId` 和 `summary`。存在时，`passed.failureChecks[]` 必须覆盖所有 `conditionId`。
- `requiredContext[]`：规则驱动的必查上下文，包含稳定 `contextId` 和 `summary`。存在时，`targets.contextExpansions[].requiredContextRefs[]` 必须引用并承接。

`failureConditions[]` 和 `requiredContext[]` 只能来自 `.agents/rules` 中被消费规则的规则快照；rules-review 不得在 dispatch、task 或审查过程中临时新增、改写或推断这些义务。若规则源未声明 `requiredContext[]`，agent 可以按规则自行扩展上下文目标，但不得把该扩展包装成 requiredContext obligation。这些字段只让机器校验“义务是否被记录和承接”，不让机器判断 failure condition 或必查上下文的业务解释是否充分。

规则集合关系必须闭合：

- `selectedRuleRefs` 必须是 `candidateRuleRefs` 的子集。
- `selectedRuleRefs` 必须全部被分类为 `requiredRuleRefs`、`excludedRuleRefs` 或 `globallyNotApplicableRuleRefs`，该闭合只声明本轮审查范围闭合。
- `requiredRuleRefs`、`excludedRuleRefs`、`globallyNotApplicableRuleRefs` 都必须是 `selectedRuleRefs` 的子集。
- 三组集合两两不得相交。
- `globallyNotApplicableRuleRefs` 不得生成 `required: true` 的 `reviewItem`。
- 每个 `requiredRuleRefs[]` 中的规则必须至少生成一个 `required: true` 的 `reviewItem`。

`targets` 至少包含：

- `changedUnits[]`：目标 diff 中实际新增、修改、删除或移除的审查目标。
- `candidates[]`：由规则触发而需要纳入判断的候选目标。
- `contextExpansions[]`：扩展目标的原因和 `addedTargetIds[]`。

`contextExpansions[].addedTargetIds[]` 必须存在于 `targets.candidates[].targetId`。

如果规则快照声明了 `requiredContext[]`，对应扩展必须通过 `contextExpansions[].requiredContextRefs[]` 记录承接的 `contextId`。例如：

- 导出 / barrel / public API 变更：记录消费者检索上下文。
- 测试配置 / 测试文件变更：记录 `package.json`、模块测试配置或 CI 入口上下文。
- UA / session / default / runtime 变更：记录运行时消费链上下文。

带 `requiredContextRefs[]` 的 `contextExpansions[]` 必须包含非空 `addedTargetIds[]`；空扩展不得承接必查上下文。

被 `reviewItems[].targetId` 引用的 target 必须包含非空 `summary`，并且至少包含非空 `loc` 或 `source`。未被审查项引用的候选 target 不受此硬门禁约束。

`reviewItems[]` 至少包含：

- `reviewItemId`
- `ruleRef`
- `targetKind`
- `targetId`
- `required`

禁止把其它 review 的结论产物作为输入。建立目标边界、分派、审查和聚合时，不得自动读取或引用既有 `.rules-review-tmp/*/final.md`、`finalReview.json`、旧 `shards/*.json`、旧 `tasks/*.json`、其它 review 报告、MR 评论里的旧审查结论，或任何由“上一次 review 结果”派生的 finding / discrepancy。旧 review 结果不能作为 evidence、context、target、rule 解释或 cannot_verify 来源；如果用户明确粘贴旧结论，只能把它当用户陈述的线索，必须回到规则、diff 和代码证据重新验证。

`executionPlan` 必须在 `ruleSet` 已闭合、`targets`、`applicabilityMatrix` 和 `reviewItems` 已形成后生成。它只记录执行模式选择，不证明选择最优：

- `mode`: `single_batch / multi_batch`
- `selectedBy`: `ai / human_override`
- `policyVersion = "review-execution-policy/v1"`
- `metrics.changedUnits`
- `metrics.candidates`
- `metrics.targets`
- `metrics.requiredRuleRefs`
- `metrics.reviewItems`
- `signals.userRequestedConcurrency`
- `reason`
- `humanOverride`: `null`；当 `selectedBy = "human_override"` 时必须包含 `requestedMode` 和 `risk`

执行策略：

- `reviewItems <= 12`、`targets <= 8`、`requiredRuleRefs <= 4`，且用户未要求并发时，默认 `single_batch`。
- `reviewItems > 30`、`targets > 20`，或用户明确要求并发时，非人工覆盖必须 `multi_batch`。
- 中间区间由 AI 判断，但必须记录非空 `reason`。
- 用户强制 single agent 时允许 `selectedBy = "human_override"`，但必须记录 `humanOverride.risk`。
- validator 只复算指标和硬阈值，不判断 `reason` 是否语义正确，也不判断拆分是否最优。

`reviewBatches[]` 至少包含：

- `reviewBatchId`
- `ruleSetId`
- `reviewItemIds[]`
- `taskRef`
- `shardRef`
- `returnStatus`
- `aggregateStatus`

状态 enum：

```text
returnStatus: not_started / started / returned / not_returned / format_invalid / untrusted
aggregateStatus: aggregated / not_aggregated
```

每个 `reviewBatch` 必须包含至少一个 `reviewItemId`。每个 `reviewItemId` 必须且只能分派给一个 `reviewBatch`；最终完成门禁仍只看结构协议是否闭合，不证明 reviewer 的业务判断正确。

### task.json

`task.json` 是 batch 输入包，只能由 `validate.js --mode build-tasks --dispatch dispatch.json --out tasks/` 从 `dispatch.json` 投影生成；它只能包含当前 `reviewBatchId` 所需内容：

- `kind = "rules-review-task"`
- `schemaVersion = 2`
- `runId`
- `reviewBatchId`
- `ruleSetId`
- 展开后的 `reviewItems[]`
- 本 batch 所需 `rules[]` 快照
- 本 batch 所需 `targets[]`
- 本 batch 所需 `applicabilityMatrix[]`
- `outputContract`

`rules[].sourceHash` 和 `rules[].ruleLevel` 必须存在，并与 `dispatch.ruleSet.ruleSources[]` 中对应 `ruleRef` 或 `namespace + sourceFile` 的 `sourceHash`、`ruleLevel` 一致。reviewer 不再自由读取另一套规则，也不得在 `reviewItem` 中重复存储或改写规则级别。

`rules[]` 必须保留 `dispatch.ruleSet.ruleSources[]` 中对应规则的 `summary` 或 `ruleText`；`failureConditions[]` 和 `requiredContext[]` 必须与 dispatch 中对应规则快照一致；`targets[]` 必须包含本 batch 每个 `reviewItems[].targetId`，并与 dispatch 中对应 target 的 `targetKind`、`loc`、`source`、`summary` 快照一致。

`task.applicabilityMatrix[]` 只能包含本 batch `reviewItems[]` 对应的 `applicable` 行，并必须与 dispatch 中同一行完全一致。reviewer 不得自行补、删或改适用性矩阵。

`outputContract` 固定为：

```json
{
  "format": "strict_json",
  "schemaRef": "schemas/shard.schema.json"
}
```

### shard.json

`shard.json` 是 reviewer 返回结果：

- `kind = "rules-review-shard"`
- `schemaVersion = 2`
- `runId`
- `reviewBatchId`
- `results[]`

`results[]` 每条结果必须绑定 `reviewItemId`，且只能返回该 `reviewBatchId` 对应 `reviewBatches[].reviewItemIds` 内的项目。跨 batch 返回 `reviewItemId` 是越权返回，`protocolGate = blocked`。

`results[]` 必须覆盖 task 分配的全部 `reviewItems[]`；空 shard 或漏回任一 assigned item 都不是合法完成。

结果状态 enum：

```text
passed / finding / observation / not_applicable / cannot_verify
```

字段门禁：

- `finding` 必须有 `findingId`、`origin` 和非空 `evidence[]`。
- `observation` 必须有 `origin`，并包含 `reason` 或非空 `evidence[]`；MUST / SHOULD 规则以 `exposed_by_change` 或 `pre_existing` 返回 observation 时必须有非空 `evidence[]`。不再增加第二套 observation status/result。
- `passed` 必须有非空 `evidence[]` 和非空 `failureChecks[]`。
- `not_applicable` 仅允许用于 `required = false` 的 reviewItem，必须有 `reason`，可选 `evidence[]`。若 reviewer 认为 required reviewItem 的适用性判断有误，必须返回 `cannot_verify` 并说明依据。主 agent 能据此形成更可靠 dispatch 时，修正后重新生成 task；无法消除争议时，保留 `cannot_verify` 作为终态并按现有 `recommendation` 派生规则收口，不得改写为 `passed` 或 `not_applicable`。
- `cannot_verify` 必须有 `reason` 或非空 `evidence[]`。

`evidence[]` 不是任意非空数组。每个 evidence item 至少包含非空 `summary`，并包含 `loc` 或 `source` 之一，保证后续可定位复核；validator 不判断证据内容是否充分。

`failureChecks[]` 是 `passed` 的失败条件回答，每项至少包含：

- `condition`：本次回答的失败条件。
- `outcome`: `checked_no_violation / not_triggered`
- `evidence[]`
- 可选 `conditionId`：当规则快照声明了 `failureConditions[]` 时必须覆盖对应 ID。

validator 只检查 `failureChecks[]` 是否存在、结构是否闭合、是否覆盖已声明的 `conditionId`；不判断自然语言回答是否真的充分。

`origin` enum 固定为：

```text
introduced_by_change / worsened_by_change / exposed_by_change / pre_existing
```

默认 result 映射固定为：

```text
MUST 或 SHOULD + introduced_by_change / worsened_by_change => finding
MUST 或 SHOULD + exposed_by_change / pre_existing => observation
ADVISORY + 任意 origin => observation
```

从默认 `observation` 升级为 `finding` 时，必须提供 `upgradeReason`；`origin = pre_existing` 的升级还必须提供 `originReason`。从默认 `finding` 降级为 `observation` 不允许。MUST / SHOULD 规则使用 `exposed_by_change` 或 `pre_existing` 维持 observation 时，必须用 `evidence[]` 支撑来源判断。

finding priority 由 `ruleLevel` 派生：

```text
MUST => must_fix
SHOULD / ADVISORY => should_fix
```

`MUST` finding 的 priority 固定为 `must_fix`，rules-review 内不接受 `acceptedRisk` 或其它 waiver。风险接受由用户在本轮 review 之外单独决定，不改写本轮 finding priority。

非 `MUST` finding 覆盖默认 priority 时必须提供 `priorityReason`；validator 只检查字段存在，不判断理由是否充分。

### finalReview.json

`finalReview.json` 是最终聚合产物，只能由 `validate.js --mode aggregate-final --dir .rules-review-tmp/<run-id> --output finalReview.json` 从 `dispatch.json + shards/*.json` 生成；其 gate 字段必须由 validator 重新计算并校验后才可信。它至少包含：

- `kind = "rules-review-final-review"`
- `schemaVersion = 2`
- `runId`
- `protocolGate`: `passed / incomplete / blocked`
- `scopeMode`: `full / scoped`
- `coverageClaim`: `full_complete / scoped_complete / incomplete / blocked`
- `semanticVerdict`: `clean / issues / unknown`
- `excludedRuleRefs[]`
- `findings[]`
- `observations[]`
- `issueSummary`
- `recommendation`
- `validationResults[]`

`findings[]` 必须按 `priority` 稳定排序：`must_fix` 在前，`should_fix` 在后；同一 `priority` 内按 `findingId` 升序。

`coverageClaim` 只表示本轮 selected 范围内的协议覆盖：required reviewItems 是否都有合法 result，以及 scoped/full 范围声明是否闭合。它不表示 candidateRuleRefs 全量都已审查，也不表示所有结果都可实质验证；实质验证缺口必须通过 `issueSummary.cannotVerify` 和 `cannotVerifyItems[]` 展示。

`issueSummary` 至少包含：

- `findings`: result 中 `status = "finding"` 的数量。
- `mustFix`: finding 中 `priority = "must_fix"` 的数量。
- `shouldFix`: finding 中 `priority = "should_fix"` 的数量。
- `cannotVerify`: result 中 `status = "cannot_verify"` 的数量。
- `observations`: result 中 `status = "observation"` 的数量。

当 `cannotVerify > 0` 时，`cannotVerifyItems[]` 必须包含每个 `status = "cannot_verify"` result 的派生明细：

- `reviewItemId`
- `ruleRef`
- `targetId`
- `reason`

`recommendation` enum：

```text
ready_for_merge / must_fix_before_merge / should_review_before_merge / manual_verification_required / review_incomplete / review_blocked
```

推荐派生规则：

- `protocolGate = "blocked"` => `review_blocked`
- `protocolGate = "incomplete"` => `review_incomplete`
- `protocolGate = "passed"` 且 `issueSummary.mustFix > 0` => `must_fix_before_merge`
- `protocolGate = "passed"` 且 `issueSummary.cannotVerify > 0` => `manual_verification_required`
- `protocolGate = "passed"` 且 `issueSummary.shouldFix > 0` => `should_review_before_merge`
- `protocolGate = "passed"` 且无 finding、无 cannot_verify => `ready_for_merge`

`validationResults[]` 不是人工自述，至少必须包含 `mode = "run"` 的 validator 摘要：

- `ok`
- `protocolGate`
- `semanticVerdict`
- `issueSummary`
- `recommendation`

validator 必须复算并校验 `validationResults[mode=run]` 与当前 run 结果一致；不一致时进入 `blocked`。

`finalReview.json` 中已有字段只是被校验对象，不能作为事实源。validator 必须从 `dispatch.json`、`task.json`、`shard.json` 重新计算 `protocolGate`、`coverageClaim`、`semanticVerdict`、`issueSummary`、`recommendation`、`cannotVerifyItems[]` 和 `validationResults[mode=run]`；声明值与计算值不一致时，`protocolGate = blocked`。`finalReview.findings[]` 必须与 shard result 和 dispatch reviewItem 派生事实一致：`findingId`、`reviewItemId`、`ruleRef`、`targetId`、`ruleLevel`、`origin`、`priority` 和 `evidence` 不得伪造、改写或额外添加；`finalReview.observations[]` 必须与 `status = "observation"` 的 result 派生事实一致；`evidence` 按 `summary`、`loc`、`source` 结构比较，不依赖 JSON key 顺序。

---

## 4. 多 agent / reviewBatch

只有用户明确说 `多 agent`、`多agent`、`并行 review`、`并行审查`、`使用 subagent`、`subagent review`，或当前目标需要拆成多个 `reviewBatch` 时，才读取 [subagent-all-aspects.md](references/subagent-all-aspects.md) 并允许启动 subagent。

分派原则：

- 主 agent 先形成完整 `dispatch.json`，再分派。
- 每个 subagent 只接收一个 `task.json`，不得依赖主线程历史补齐 `reviewItem`、规则或目标。
- 子 agent 只输出 `shard.json`，不输出最终 Markdown，不生成全局结论。
- 主 agent 只聚合通过 validator 权威门禁的 shard。
- 未返回的 batch 不得写成已完成；格式不合规、不可信、已返回但无法聚合或越权的 batch 必须进入 `blocked`。

---

## 5. validator 门禁

脚本路径：

```text
scripts/validate.js
```

支持模式：

```text
validate.js --mode dispatch --input dispatch.json
validate.js --mode task --input tasks/<reviewBatchId>.json
validate.js --mode retry-task --input retries/<reviewBatchId>-retry-<n>.json
validate.js --mode shard --task tasks/<reviewBatchId>.json --input shards/<reviewBatchId>.json
validate.js --mode final-review --input finalReview.json
validate.js --mode build-tasks --dispatch dispatch.json --out tasks/
validate.js --mode aggregate-final --dir .rules-review-tmp/<run-id> --output finalReview.json
validate.js --mode render-final --input finalReview.json --dispatch dispatch.json --output final.md
validate.js --mode render-response --dir .rules-review-tmp/<run-id>
validate.js --mode final-md --final-review finalReview.json --dispatch dispatch.json --input final.md
validate.js --mode run --dir .rules-review-tmp/<run-id>
```

硬门禁：

- 每个 `required: true` 的 `reviewItem` 必须有且只有一个 result。
- `selectedRuleRefs[]` 必须是 `candidateRuleRefs[]` 的子集。
- 每个 `selectedRuleRefs[]` 中的规则必须分类到 `requiredRuleRefs[]`、`excludedRuleRefs[]` 或 `globallyNotApplicableRuleRefs[]`。
- `selectedRuleRefs = requiredRuleRefs ∪ excludedRuleRefs ∪ globallyNotApplicableRuleRefs`，三组分类不闭合时不得进入可信执行计划。
- 每个 `requiredRuleRefs[]` 中的规则必须至少生成一个 `required: true` 的 `reviewItem`。
- `applicabilityMatrix[]` 必须覆盖每个 `requiredRuleRefs[] x (changedUnits[] + candidates[])` 组合。
- `applicability = applicable` 的矩阵行必须绑定匹配的 required `reviewItemId`；`not_applicable` 行必须有 `reason` 且不得绑定 `reviewItemId`。
- `task.applicabilityMatrix[]` 必须等于本 batch `reviewItems[]` 对应的 dispatch 矩阵行。
- `contextExpansions[].reason` 必须是非空字符串。
- 规则快照声明 `requiredContext[]` 时，`contextExpansions[].requiredContextRefs[]` 必须承接对应 `contextId`。
- 带 `requiredContextRefs[]` 的 `contextExpansions[]` 必须包含非空 `addedTargetIds[]`。
- `dispatch.json` 不得包含 `priorReviewCheck`，也不得引用既有 `.rules-review-tmp/` review 产物；出现即 `blocked`。
- result 必须引用已分派的 `reviewItemId`。
- 同一 `reviewItemId` 多个 result => `blocked`。
- 同一 `reviewItemId` 不得跨 `reviewBatch` 重复分派。
- 每个 `reviewItemId` 必须且只能被分派到一个 `reviewBatch`。
- `executionPlan` 必须存在，且 `metrics` 必须等于 `dispatch` 中的可复算事实。
- `mode = "single_batch"` 时 `reviewBatches.length` 必须等于 1；`mode = "multi_batch"` 时 `reviewBatches.length` 必须大于等于 2。
- `reviewItems > 30`、`targets > 20` 或 `signals.userRequestedConcurrency = true` 时，非 `human_override` 必须选择 `multi_batch`。
- `selectedBy = "human_override"` 时必须记录 `humanOverride.requestedMode` 和 `humanOverride.risk`。
- `ruleSet.ruleSources[].ruleLevel` 和 `task.rules[].ruleLevel` 必须存在，且 task 中的值必须匹配 dispatch 快照。
- `finding` 必须有 `findingId`、`origin` 和 `evidence[]`。
- `observation` 必须有 `origin`，并包含 `reason` 或 `evidence[]`。
- `finding / observation` 的 `status` 必须符合 `ruleLevel + origin` 默认映射；默认 `observation` 升级为 `finding` 必须有 `upgradeReason`，`pre_existing` 升级还必须有 `originReason`；MUST / SHOULD 的 `exposed_by_change` / `pre_existing` observation 必须有 `evidence[]`。
- `MUST` finding 必须是 `must_fix`，且不得包含 `acceptedRisk`；`SHOULD / ADVISORY` finding 默认是 `should_fix`，覆盖 priority 必须有 `priorityReason`。
- `passed` 必须有 `evidence[]` 和 `failureChecks[]`；规则快照声明 `failureConditions[]` 时，`failureChecks[].conditionId` 必须覆盖对应 ID。
- `not_applicable` 仅允许用于 `required = false` 的 reviewItem，且必须有 `reason`；required reviewItem 的适用性争议必须返回 `cannot_verify` 并说明依据。主 agent 能形成更可靠 dispatch 时重新分派，无法消除争议时保留 `cannot_verify` 作为终态。
- `cannot_verify` 必须有 `reason` 或 `evidence[]`。
- `ruleSet.sourceIndexHash`、`ruleSet.ruleSources[].sourceHash`、`task.rules[].sourceHash` 缺失 => `blocked`。
- `ruleSet.ruleSources[]` 与 `task.rules[]` 缺少 `summary` / `ruleText` => `blocked`。
- `task.rules[].failureConditions` 和 `task.rules[].requiredContext` 必须匹配 dispatch 规则快照。
- `task.targets[]` 未覆盖本 task 的 `reviewItems[].targetId` => `blocked`。
- 被 `reviewItem` 引用的 target 缺少非空 `summary`，或同时缺少 `loc` / `source` => `blocked`。
- `shard.results[]` 未覆盖本 task 的 `reviewItems[]` => `blocked`。
- `evidence[]` 必须由可复核 evidence item 组成：非空 `summary` + `loc` 或 `source`。
- task / shard 缺失且 batch 可定位为未返回 => `incomplete`；schema 错误、JSON 错误、格式不合规、不可信、已返回但无法聚合或不可复现 => `blocked`。
- `contextExpansions[].addedTargetIds[]` 必须存在于 `targets.candidates[]`。
- `reviewItem.targetId` 必须存在于 `targets.changedUnits[]` 或 `targets.candidates[]`。
- `finalReview.findings[]` 必须匹配 result + dispatch 派生事实，且不得包含 shard `results[]` 中不存在的 finding。
- `finalReview.observations[]` 必须匹配 `observation` result + dispatch reviewItem 派生事实。
- `finalReview.cannotVerifyItems[]` 必须匹配 `cannot_verify` result + dispatch reviewItem 派生事实。
- `finalReview.validationResults[mode=run]` 必须匹配本次 validator 复算结果。
- scoped 模式必须有 `excludedRuleRefs`，且不得声明 `coverageClaim = "full_complete"`。
- `.rules-review-tmp/<run-id>/` 只能包含协议工件：`dispatch.json`、`finalReview.json`、`final.md`、`response.md`，以及 `tasks/`、`retries/`、`shards/`、`validations/` 下的一层 JSON 文件；出现临时脚本或其它非协议文件 => `blocked`。
- `retries/*.json` 必须只包含 retry schema 的固定字段，通过 `retry-task` 校验，并且 `runId`、`originalTaskRef` 分别匹配当前 dispatch 和其中一个 task。

`semanticVerdict` 派生规则：

- 任意合法 result `status = "finding"` => `issues`
- 否则任意合法 result `status = "cannot_verify"` => `unknown`
- 否则 `protocolGate = "passed"` => `clean`
- `protocolGate = "incomplete"` 或 `"blocked"` 时必须是 `unknown`

`finding` 不导致 `protocolGate` 失败。`protocolGate` 只表示审查协议是否闭合；`semanticVerdict` 才表示是否发现问题。人类输出不得把 `protocolGate = "passed"` 单独写成“通过”，必须写成“协议通过”，并同时展示审查结论、问题数、无法验证数量和修复建议。

`validate.js --mode run` 输出 gate 计算结果；`protocolGate !== "passed"` 时自动化 gate 不视为通过。JSON 输出保留英文 enum，并在 `gate.issueSummary` 与 `gate.recommendation` 中给出派生结论。human-readable 摘要必须使用“协议门禁通过；审查结论：...；问题数：...；必须修复：...；建议修复：...；无法验证：...”这类组合表达，不得把 passed 简化为“通过”。

退出码：

```text
0：ok=true
1：ok=false，有校验违规
2：用法 / IO / JSON parse / schema 文件缺失等执行错误
```

stdout 一律输出 strict JSON。

---

## 6. 输出

最终用户可见报告由 `finalReview.json` 渲染，Markdown 不作为事实源。

渲染规则：

- 先运行 `validate.js --mode aggregate-final --dir .rules-review-tmp/<run-id> --output finalReview.json` 生成聚合产物。
- 优先运行 `validate.js --mode render-final --input finalReview.json --dispatch dispatch.json --output final.md`。
- 最终回复必须运行 `validate.js --mode render-response --dir .rules-review-tmp/<run-id>`，并直接复用生成的 `response.md` 内容；不得由 agent 自行改写、重排、摘要或新增另一套章节。
- `render-response` 必须先执行并通过同一 run gate；run gate FAIL 时不得生成最终聊天回复。
- 协议门禁中文映射：`passed => 协议通过`，`incomplete => 协议未完成`，`blocked => 协议阻塞`。
- 其它 enum 中文映射示例：`full_complete => 本轮范围协议覆盖完整`，`scoped_complete => 本轮限定范围协议覆盖完整`，`issues => 发现问题`。
- `final.md` 第一屏必须使用包含协议状态的组合标题，例如：
  - `rules-review：协议通过，发现 X 项问题，Y 项无法验证`
  - `rules-review：协议通过，发现 X 项问题`
  - `rules-review：协议通过，未发现明确问题，但 Y 项无法验证`
  - `rules-review：协议通过，未发现问题`
  - `rules-review：审查未完成，协议未闭合`
  - `rules-review：审查阻塞，协议输入或结果不可用`
- `response.md` 是最终用户界面摘要，只保留标题、结论、问题和报告四块；当协议通过时标题不得写“协议通过”，例如：
  - `rules-review：发现 X 项问题，Y 项无法验证`
  - `rules-review：发现 X 项问题`
  - `rules-review：未发现明确问题，但 Y 项无法验证`
  - `rules-review：未发现问题`
  - `rules-review：审查未完成`
  - `rules-review：审查阻塞`
- `response.md` 的问题列表使用两行版：第一行展示 `findingId` 和问题证据摘要，第二行展示规则、目标和来源；不要把内部 `reviewItemId` 放进用户摘要。
- `final.md` 顶部必须包含固定结论区：协议门禁、审查结论、修复建议、问题数、必须修复、建议修复、无法验证、观察项。
- `final.md` 必须包含审计区，展示 `runId`、`ruleSetId`、`sourceIndexHash`、规则/目标/reviewItem/reviewBatch 计数、context expansion 数量、验证命令和 validator run 摘要。
