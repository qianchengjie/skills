---
name: rules-review
description: 手动触发的项目规则驱动代码审查流程，适用于项目内 `.agents/skills/rules-review`；仅当用户明确说“用 rules-review skill”“按 rules-review”“触发 rules-review”或通过 Skill 工具选择该 skill 时使用。读取 `.agents/rules/index.md` 与适用 active 规则，把规则消费为 `ruleSet -> targets -> reviewItems -> reviewBatches -> results -> finalReview`，并用 validator 校验协议闭合。默认只读，不维护规则仓，不替代全量功能 QA。
---

# 规范审查

`rules-review` 是**手动触发**的规范审查 skill。它不维护 `.agents/rules/`，不发明规则分类，不替代 `AGENTS.md`、OpenSpec、共享能力文档或代码证据；它只负责消费已有 active 规则、建立目标边界、分派审查原子、回收结果并输出可校验结论。

项目规则入口是 `.agents/rules/index.md`。最小消费前提：

- 能解析 `namespace id`、`source path`、`trigger / applies-to` 和稳定 `ruleRef`。
- 每个被消费规则都有可记录的 `sourceHash`。
- 缺失任一前提时 fail closed：记录 `blocked`，不要自行补分类、补 ruleRef 或猜规则来源。

JSON 协议中的 enum 一律使用英文；最终 Markdown 和聊天回复继续渲染中文文案。

---

## 1. 触发

仅在以下情况使用：

- 用户通过 Skill 工具选择 `rules-review`
- 用户明确说“用 rules-review skill ...”
- 用户明确说“按 rules-review ...”或“触发 rules-review ...”

用户只说“规范检查”“review 下”“检查下代码规范”时，不自动进入本流程。

触发后先建立目标边界：

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
ruleSet -> targets -> reviewItems -> reviewBatches -> results -> finalReview
```

主 agent 必须先读取 `.agents/rules/index.md`：

1. 读取 `CORE` 指向的 active 文件。
2. 按 `trigger / applies-to` 读取其它匹配的 active namespace 文件。
3. 形成 `ruleSet.candidateRuleRefs`。
4. 从候选规则中拆出 `requiredRuleRefs`、`excludedRuleRefs` 和 `globallyNotApplicableRuleRefs`。
5. 为每个规则来源记录 `namespace`、`ruleRef`、`sourceFile`、`sourceHash`、`trigger`、`appliesTo`。

不要把 namespace 或 ruleRef 本身当完成门禁。完成门禁只看 `required: true` 的 `reviewItems` 是否都有且只有一个合法 `result`。

最小审查原子是：

```text
ruleRef x targetId = reviewItem
```

`targets.changedUnits[]` 和 `targets.candidates[]` 必须统一使用 `targetId` 作为唯一 ID 字段。`reviewItem.targetId` 只能引用 `changedUnits[].targetId` 或 `candidates[].targetId`，不要继续使用 `uid` / `cid` / `uId` / `candidateId` 作为主键字段。

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

### dispatch.json

`dispatch.json` 是主 agent 的计划、分派和聚合台账，至少包含：

- `kind = "rules-review-dispatch"`
- `schemaVersion = 2`
- `runId`
- `ruleSet`
- `targets`
- `reviewItems`
- `reviewBatches`

`ruleSet` 至少包含：

- `ruleSetId`
- `sourceIndexHash`
- `candidateRuleRefs[]`
- `requiredRuleRefs[]`
- `excludedRuleRefs[]`
- `globallyNotApplicableRuleRefs[]`
- `ruleSources[]`

规则集合关系必须闭合：

- `requiredRuleRefs`、`excludedRuleRefs`、`globallyNotApplicableRuleRefs` 都必须是 `candidateRuleRefs` 的子集。
- 三组集合两两不得相交。
- `globallyNotApplicableRuleRefs` 不得生成 `required: true` 的 `reviewItem`。

`targets` 至少包含：

- `changedUnits[]`：目标 diff 中实际新增、修改、删除或移除的审查目标。
- `candidates[]`：由规则触发而需要纳入判断的候选目标。
- `contextExpansions[]`：扩展目标的原因和 `addedTargetIds[]`。

`contextExpansions[].addedTargetIds[]` 必须存在于 `targets.candidates[].targetId`。

`reviewItems[]` 至少包含：

- `reviewItemId`
- `ruleRef`
- `targetKind`
- `targetId`
- `required`

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

### task.json

`task.json` 是 batch 输入包，只能包含当前 `reviewBatchId` 所需内容：

- `kind = "rules-review-task"`
- `schemaVersion = 2`
- `runId`
- `reviewBatchId`
- `ruleSetId`
- 展开后的 `reviewItems[]`
- 本 batch 所需 `rules[]` 快照
- 本 batch 所需 `targets[]`
- `outputContract`

`rules[].sourceHash` 必须存在，并与 `dispatch.ruleSet.ruleSources[]` 中对应 `ruleRef` 或 `namespace + sourceFile` 的 `sourceHash` 一致。reviewer 不再自由读取另一套规则。

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

结果状态 enum：

```text
passed / finding / not_applicable / cannot_verify
```

字段门禁：

- `finding` 必须有 `findingId` 和非空 `evidence[]`。
- `passed` 必须有非空 `evidence[]`。
- `not_applicable` 必须有 `reason`，可选 `evidence[]`。
- `cannot_verify` 必须有 `reason` 或非空 `evidence[]`。

### finalReview.json

`finalReview.json` 是最终事实源，至少包含：

- `kind = "rules-review-final-review"`
- `schemaVersion = 2`
- `runId`
- `protocolGate`: `passed / incomplete / blocked`
- `scopeMode`: `full / scoped`
- `coverageClaim`: `full_complete / scoped_complete / incomplete / blocked`
- `semanticVerdict`: `clean / issues / unknown`
- `excludedRuleRefs[]`
- `findings[]`
- `validationResults[]`

`finalReview.json` 中已有字段只是被校验对象，不能作为事实源。validator 必须从 `dispatch.json`、`task.json`、`shard.json` 重新计算 `protocolGate`、`coverageClaim`、`semanticVerdict`；声明值与计算值不一致时，`protocolGate = blocked`。

---

## 4. 多 agent / reviewBatch

只有用户明确说 `多 agent`、`多agent`、`并行 review`、`并行审查`、`使用 subagent`、`subagent review`，或当前目标需要拆成多个 `reviewBatch` 时，才读取 [subagent-all-aspects.md](references/subagent-all-aspects.md) 并允许启动 subagent。

分派原则：

- 主 agent 先形成完整 `dispatch.json`，再分派。
- 每个 subagent 只接收一个 `task.json`，不得依赖主线程历史补齐 `reviewItem`、规则或目标。
- 子 agent 只输出 `shard.json`，不输出最终 Markdown，不生成全局结论。
- 主 agent 只聚合通过 validator 权威门禁的 shard。
- 未返回、未聚合、格式不合规或越权的 batch 不得写成已完成。

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
validate.js --mode render-final --input finalReview.json --output final.md
validate.js --mode render-response --dir .rules-review-tmp/<run-id>
validate.js --mode final-md --final-review finalReview.json --input final.md
validate.js --mode run --dir .rules-review-tmp/<run-id>
```

硬门禁：

- 每个 `required: true` 的 `reviewItem` 必须有且只有一个 result。
- result 必须引用已分派的 `reviewItemId`。
- 同一 `reviewItemId` 多个 result => `blocked`。
- `finding` 必须有 `findingId` 和 `evidence[]`。
- `passed` 必须有 `evidence[]`。
- `not_applicable` 必须有 `reason`。
- `cannot_verify` 必须有 `reason` 或 `evidence[]`。
- `ruleSet.sourceIndexHash`、`ruleSet.ruleSources[].sourceHash`、`task.rules[].sourceHash` 缺失 => `blocked`。
- task / shard 缺失且 batch 可定位为未返回 => `incomplete`；schema 错误、JSON 错误或不可复现 => `blocked`。
- `contextExpansions[].addedTargetIds[]` 必须存在于 `targets.candidates[]`。
- `reviewItem.targetId` 必须存在于 `targets.changedUnits[]` 或 `targets.candidates[]`。
- scoped 模式必须有 `excludedRuleRefs`，且不得声明 `coverageClaim = "full_complete"`。

`semanticVerdict` 派生规则：

- 任意合法 result `status = "finding"` => `issues`
- 否则任意合法 result `status = "cannot_verify"` => `unknown`
- 否则 `protocolGate = "passed"` => `clean`
- `protocolGate = "incomplete"` 或 `"blocked"` 时，可以是 `unknown`

`finding` 不导致 `protocolGate` 失败。`protocolGate` 只表示审查协议是否闭合；`semanticVerdict` 才表示是否发现问题。

`validate.js --mode run` 输出 gate 计算结果；`protocolGate !== "passed"` 时自动化 gate 不视为通过。

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

- 优先运行 `validate.js --mode render-final --input finalReview.json --output final.md`。
- 最终回复必须运行 `validate.js --mode render-response --dir .rules-review-tmp/<run-id>`。
- `render-response` 必须先执行并通过同一 run gate；run gate FAIL 时不得生成最终聊天回复。
- 中文映射示例：`passed => 通过`，`incomplete => 未完成`，`blocked => 阻断`，`scoped_complete => 限定范围完成`，`issues => 发现问题`。
