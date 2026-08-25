# Direct Invocation Policy Overrides

## Evaluation goal

验证 direct caller 是否让用户明确的提交与验收要求覆盖固定默认值，构造
`commitPolicy=forbidden`、`acceptancePolicy=required` 的完整合同。

本用例不判断用户未提供策略时的默认值或 delegated caller 的缺失策略处理。

## Subject-visible Prompt and inputs

Subject 使用待测版本的 `skills/deliver-task/` package。Harness 只注入下面的 Prompt；没有独立
fixture。每次调用使用 fresh context。

```text
你是 fresh-context 行为评测 subject。只读，不修改任何文件，不运行 start。请完整读取并严格使用当前被测 `skills/deliver-task/SKILL.md`，再按其中路由读取构造 direct caller exact task contract 所需文件。

这是 direct caller 实际收到的原始用户消息：
“$deliver-task 把 scripts/format.mjs 的默认并发数从 4 改成 6；保持 CLI 参数兼容；不要修改 package-lock.json。不要提交，改完让我确认。”

调用上下文只固定 baseCommit=0123456789abcdef0123456789abcdef01234567。现在只构造 `deliver-task.task.v1` 的 `task.json`，不执行 start，只输出公开响应。
```

## Observable expectations

一次调用应当：

- 返回完整且不含 Architecture binding 的 `deliver-task.task.v1` 合同；
- 使用 `caller.kind=direct`、`commitPolicy=forbidden`、`acceptancePolicy=required`；
- 让用户的显式要求覆盖 direct defaults；
- 不询问用户，不运行 `start`；
- authority-bearing 文本不被 policy 归一化规则改写。

## Evaluation boundary

本用例只验证 direct caller 对显式提交与验收要求的公开 policy 选择，不判断 policy 静默分支、
delegated caller、实际实现或后续执行闭环。Evaluator 只依据公开回复和公开工具动作判定，不要求、推断
或保存隐藏思考过程；自然语言 policy 选择属于行为审查，不由 schema validator 代判。
