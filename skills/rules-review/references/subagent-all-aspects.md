# rules-review reviewer 契约

仅在 controller 已生成并校验 v8 task 后使用。每个 reviewer 只处理一个 `reviewBatchId`。

## 分派

- `spawn_agent` 固定使用 `fork_turns: "none"`。
- reviewer 只接收 task JSON、对应规则封印内容和当前 run 的输出路径。
- 不传旧 run 结论，不要求 reviewer读取主线程历史，不允许继承旧 result。
- reviewer 只写 `shards/<reviewBatchId>.json`，不生成全局结论或 Markdown。

## 固定输入

审查范围来自 task 的 `reviewRange`：

```text
git diff <baseTree> <targetTree>
git show <targetTree>:<path>
```

必须逐项处理 task 中的全部 reviewItems，发现一个问题后也继续检查剩余项。语义相连的 targets 仍分别返回 result。规则只读取 task 的 `ruleSnapshot`，即使 `ruleInputSource.kind = workspace` 也不得回读当前同名规则文件。不得读取当前同名代码文件、真实 index 或其它 TARGET 的 run 来替代封印 blob。Git object 缺失、tree identity 不一致或任务内容不足时返回 `cannot_verify`，并通知 controller 将 run 置为 blocked；不得猜测内容。

按 `ruleRef` 从 `ruleSnapshot` 读取完整规则块。`规则` 是语义真源，全部 `通过条件` 必须忠实覆盖正文，`失败条件` 只是非穷尽反证。`passed` 的 evidence 必须证明全部通过条件，failureChecks 不能替代正向证明；finding 可在现有 `rootCause` 或 evidence 文本中用对应条件描述尚未达到的可观察修复终点。通过条件缺失、遗漏、扩大或改变规则正文时停止当前 run，并通知 controller 将 run 置为 blocked、报告规则定义缺陷和请求用户明确授权；授权前任何 agent 都不得修改 `.agents/rules/`，也不得归责于被审查对象。获批后由 controller 按 `rule-steward` 维护规则并为同一 TARGET 创建 fresh run。通过条件不得扩大 `生效条件`；规则级别只影响处置，不改变是否满足的事实。

## 输出

输出必须是符合 shard schema 的 strict JSON：

- `runId`、`reviewBatchId` 与 task 一致，`targetTree` 等于 task 的 `reviewRange.targetTree`，`taskHash` 原样回显 task 的机械身份。
- 每个 task reviewItem 恰好返回一个 result。
- `passed` 包含能证明全部通过条件的 evidence 与 failureChecks。
- `finding` 包含 origin、evidence 与非空 `rootCause`，不含 findingId。
- `observation` 包含 origin，以及 reason 或 evidence。
- 无法判断时返回 `cannot_verify`；shard result 不支持 `not_applicable`。
- 能确认 reviewItem 实际不适用时，不得用任何现有 result status 代替 `not_applicable`。停止当前 batch、不写合法 shard，并通知 controller 作废当前 run；controller 针对同一 TARGET 以修正后的适用性输入创建 fresh run，旧 run 不聚合、不用于门禁。
- 本 batch 内多个 finding results 属于同一根因时，分别保留 result，并填写字节完全相同的 `rootCause`；aggregator 会合并展示并保留各自 evidence。不同根因不得复用同一文本；不同 batch 不做根因合并。
- 规则外事项不得放进 result。仅当审查中自然注意到且值得提醒时，可在 shard 顶层写 `otherConcerns: string[]`；不要求 evidence，不为此额外阅读、测试或重试，没有则省略。明确违反 task 规则的事项不得放入 `otherConcerns`。字段中的非字符串、空字符串和重复项由 aggregator 忽略。

完成后 controller 先运行 shard validator，再聚合当前 run。格式错误或结果缺项不能由 controller 代写修补，也不创建 retry 工件；只能要求原 reviewer 在同一路径返还完整合规 shard。
