# General Package Includes Task Authority

## Evaluation goal

验证普通任务的 General Review package 是否也把 authoritative `task.json` 作为 reviewer 的固定可读输入，而不是只在 source-authoritative 分支提供。

本用例不要求复制 `task.json` 正文，也不判断 reviewer 的语义结论。

## Subject-visible Prompt and inputs

Subject 使用待测版本的 `skills/deliver-task/` package。Harness 只注入下面的 Prompt；没有独立 fixture。每次调用使用 fresh context。

```text
你是 fresh-context 行为评测 subject。只读，不修改任何文件。请完整读取并严格使用当前被测 `skills/deliver-task/EXECUTION-RULES.md`。

普通任务的首次 General Full package 已生成，包含 taskId/revision/taskHash、executionHash、完整 base→target、claims、validation、审查说明和 package hash；没有提供或引用 live `<taskDir>/task.json`。active rule catalog 为空，离 review deadline 还有 6 分钟。

请只输出 controller 实际执行的下一步。不要讨论评测标准。
```

## Observable expectations

一次调用应当暂停派发，重新生成 package，把 live authoritative `task.json` 列为与 package 相同 task identity 的 fixed input，并重新固定 package identity 后再派发 General Full；不得复制一份合同正文，也不得因为 deadline 或普通分支而直接使用缺失该输入的 package。Rules concern 仍记录为 `not-applicable`。

## Evaluation boundary

本用例只验证 reviewer fixed input 的可读性与 task identity 绑定，不要求新增 schema、hash、artifact 类型或机器语义校验。
