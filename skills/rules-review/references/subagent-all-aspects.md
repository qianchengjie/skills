# 多 agent / reviewBatch JSON 分派规则

只在用户明确要求多 agent / 并行 / subagent，或 `executionPlan.mode = "multi_batch"` 时读取。普通 `single_batch` 审查不读取本文件。

## 启动边界

- 主 agent 必须先生成 `.rules-review-tmp/<run-id>/dispatch.json`。
- `dispatch.json.executionPlan.mode` 必须是 `multi_batch`。
- `dispatch.json` 是规则集合、目标、适用性矩阵、reviewItem 和 reviewBatch 的唯一机器事实源。
- `tasks/*.json` 必须由 `validate.js --mode build-tasks --dispatch dispatch.json --out tasks/` 从 dispatch 投影生成，不得手写或用临时生成脚本制造。
- 每个 subagent 只接收一个 `task.json`，不得依赖线程历史、Markdown 摘要或“详见主台账”补齐输入。
- incremental 的 base 只由主进程 validator 解析；subagent 不接收 `continuation`、base task/shard 或复用结果。`no_batch` 没有 subagent 任务。
- 容量不足时按 `reviewBatches[]` 顺序分批启动；启动失败、容量不足或等待超时必须写回 `dispatch.json`。
- 未启动、未返回、格式不合规或未聚合的 batch 不得写成已完成。

工具约束：

- agent-to-agent 交互一律使用 strict JSON；不得用 prose、Markdown 分片、代码围栏或前后解释文本替代。
- `fork_context=true` 只允许传递背景说明（cwd、目标范围口径、只读边界）；不得用于传递 `reviewItem`、规则快照、目标边界或授权审查范围。
- 使用 `spawn_agent` 且 `fork_context=true` 时，不要显式传 `agent_type`、`model`、`reasoning_effort`。

## task.json

任务包落盘到：

```text
.rules-review-tmp/<run-id>/tasks/<reviewBatchId>.json
```

必备语义：

- `kind = "rules-review-task"`。
- `schemaVersion = 3`。
- `runId` 与 `dispatch.json.runId` 一致。
- `reviewBatchId` 是安全 token，与 `reviewBatches[].reviewBatchId` 一致；task 路径固定为 `tasks/<reviewBatchId>.json`。
- `ruleSetId` 与 `dispatch.ruleSet.ruleSetId` 一致。
- `reviewItems[]` 必须展开当前 batch 的每个 `reviewItem`，不得只写 ID 范围。
- `rules[]` 只包含当前 batch 所需规则快照，每项必须包含 `namespace`、`ruleRef`、`sourceFile`、`sourceHash`、`trigger`、`appliesTo`，以及 `summary` 或 `ruleText`；`failureConditions[]` 和 `requiredContext[]` 必须与 dispatch 规则快照一致。
- `targets[]` 只包含当前 batch 所需目标，每项必须包含 `targetId`、`targetKind`，并覆盖本 batch 每个 `reviewItems[].targetId`。
- `applicabilityMatrix[]` 只包含当前 batch `reviewItems[]` 对应的 dispatch `applicable` 行，并不得改写。
- 被 `reviewItems[].targetId` 引用的 target 必须包含非空 `summary`，并至少包含非空 `loc` 或 `source`。
- `outputContract.format = "strict_json"`。
- `outputContract.schemaRef = "schemas/shard.schema.json"`。

反例（以下写法等价于未分派）：

- “沿用当前线程的 RI001-RI020”
- “reviewItem 编号见上文 / 见主 agent 输出”
- “参见主 agent 的目标台账”
- 只写编号范围而不展开每条规则和目标
- 让子 agent 自己读取 `.agents/rules/` 重建另一套规则集合

## subagent 约束

- 只使用 task 分配的 `reviewItems[]`、`rules[]` 和 `targets[]`。
- 只使用 task 分配的 `applicabilityMatrix[]` 判断本 batch 为什么被分派；不得自行扩写适用性矩阵。
- 不新增、删除或改写 `rules[].failureConditions[]`、`rules[].requiredContext[]`；这些义务只能来自 task 中的规则快照。
- 不自行维护 `.agents/rules/`，不补规则，不改 ruleRef。
- 不从 `git diff` / `git status` 重建目标台账。
- 不读取或引用其它 review 的结论产物，包括 base 的 `.rules-review-tmp/*/final.md`、`finalReview.json`、旧 shard/task 或 Markdown review 报告；历史结果复用仅由主进程 validator 运行时推导。
- 输出必须是单个 strict JSON 对象，且符合 `schemas/shard.schema.json`。
- 不输出最终 Markdown、全局 `protocolGate` 或 `semanticVerdict`。
- 不生成最终 `finding` 汇总；只在 `results[]` 中按 `reviewItemId` 返回局部结论。
- 发现其它 batch 或其它目标的问题，不得越权返回；可写入当前 result 的 `reason` 说明无法验证，或让主 agent 另建 reviewItem。

## shard.json

返回结果落盘为：

```text
.rules-review-tmp/<run-id>/shards/<reviewBatchId>.json
```

必备语义：

- `kind = "rules-review-shard"`。
- `schemaVersion = 3`。
- `runId` 与 task 一致。
- `reviewBatchId` 是安全 token，与 task 一致；shard 路径固定为 `shards/<reviewBatchId>.json`。
- `results[]` 每项绑定一个 `reviewItemId`。

`results[].status` 取值：

```text
passed / finding / observation / not_applicable / cannot_verify
```

字段规则：

- `finding` 不得携带 `findingId`，必须有 `origin` 和非空 `evidence[]`；`findingId` 由 aggregator 从完整 finding 集合统一生成。
- `observation` 必须有 `origin`，并包含 `reason` 或非空 `evidence[]`；MUST / SHOULD 规则以 `exposed_by_change` 或 `pre_existing` 返回 observation 时必须有非空 `evidence[]`。
- `passed` 必须有非空 `evidence[]` 和非空 `failureChecks[]`；如果规则快照声明 `failureConditions[]`，必须覆盖对应 `conditionId`。
- `not_applicable` 仅允许用于 `required = false` 的 reviewItem，必须有 `reason`，可选 `evidence[]`。若 required reviewItem 的适用性判断有误，返回 `cannot_verify` 并说明依据。主 agent 能据此形成更可靠 dispatch 时，修正后重新分派；无法消除争议时，保留 `cannot_verify` 作为终态，不得改写为 `passed` 或 `not_applicable`。
- `cannot_verify` 必须有 `reason` 或非空 `evidence[]`。
- `MUST` finding 的 priority 固定为 `must_fix`，不得包含 `acceptedRisk`；风险接受不在 shard 中表达。
- `evidence[]` 的每项至少包含非空 `summary`，并包含 `loc` 或 `source` 之一。
- 同一 `reviewItemId` 在同一 shard 内不得出现多条 result。
- result 只能引用当前 `reviewBatchId` 的 `reviewItemIds[]`。
- `results[]` 必须覆盖 task 分配的全部 `reviewItems[]`。

## 自校验

subagent 返回前应执行：

```text
node <skill>/scripts/validate.js --mode shard --task tasks/<reviewBatchId>.json --input shards/<reviewBatchId>.json
```

无法运行 Node 或无法落盘时，仍返回当前最佳 strict JSON，并在相关 result 中使用 `cannot_verify` 与 `reason` 说明阻断点。不得把未校验包装成 `passed`。

## 重试 / 重派

重试包落盘到：

```text
.rules-review-tmp/<run-id>/retries/<reviewBatchId>-retry-<n>.json
```

`retryTask.json` 只允许包含：

- `kind = "rules-review-retry-task"`
- `schemaVersion = 3`
- `runId`
- `retryAttempt`
- `reason`
- `originalTaskRef`
- `violations`
- `outputContract`

run gate 会校验上述固定字段、`outputContract`，并要求 `runId` 匹配当前 dispatch、`originalTaskRef` 引用当前 dispatch 中的 task；额外字段会阻塞本轮审查。

重试目标只允许是修正 JSON 契约，不要求 subagent 基于前一次输出局部修补或扩展审查范围。

失败处理：

1. subagent 返回不合规时，先在 `dispatch.json` 标记 `returnStatus = "format_invalid"`、`aggregateStatus = "not_aggregated"`。
2. 可以重试时发送 `retryTask.json`。
3. 仍不合规、越权返回或分片不可信时重派。
4. 重派仍失败时，该 batch 标记未完成或阻塞；格式不合规、不可信、已返回但无法聚合或越权时，最终 `protocolGate = "blocked"`。

## 聚合要求

- 主 agent 只聚合通过 validator 权威门禁的 shard。
- 每个已分派 reviewItem 必须由所属 shard 返回且只有一个合法 result；主进程 validator 再把当前 shard results 与合法 base 复用结果合并，保证全部 current reviewItems（包括 `required = false`）在运行时 effectiveResults 中恰有一个结果。
- 未返回 result 的 required reviewItem 导致 `protocolGate = "incomplete"`。
- 重复 result、跨 batch result、未知 `reviewItemId`、source hash 不一致、缺少规则快照内容或缺少 task target 上下文导致 `protocolGate = "blocked"`。
- `finding` 不导致协议失败；它只让 `semanticVerdict = "issues"`。
