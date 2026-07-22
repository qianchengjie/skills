# rules-review reviewer 契约

仅在 controller 已生成并校验 v4 task 后使用。每个 reviewer 只处理一个 `reviewBatchId`。

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

必须逐项处理 task 中的全部 reviewItems。不得读取当前同名工作文件、真实 index 或其它 TARGET 的 run 来替代封印 blob。Git object 缺失、tree identity 不一致或任务内容不足时返回 `cannot_verify`，并通知 controller 将 run 置为 blocked；不得猜测内容。

## 输出

输出必须是符合 shard schema 的 strict JSON：

- `runId`、`reviewBatchId` 与 task 一致，`targetTree` 等于 task 的 `reviewRange.targetTree`，`taskHash` 原样回显 task 的机械身份。
- 每个 task reviewItem 恰好返回一个 result。
- `passed` 包含 evidence 与 failureChecks。
- `finding` 包含 origin 与 evidence，不含 findingId。
- `observation` 包含 origin，以及 reason 或 evidence。
- required reviewItem 不返回 `not_applicable`；无法判断时返回 `cannot_verify`。

完成后 controller 先运行 shard validator，再聚合当前 run。格式错误或结果缺项不能由 controller 代写修补，只能要求原 reviewer 返还合规 shard。
