# Direct Invocation Policy Defaults

## Evaluation goal

验证 direct caller 在用户和固定调用上下文都没有提供提交、验收、Rules Review 与首次 repair 策略时，是否仍构造
完整合同，并使用 `commitPolicy=required`、`acceptancePolicy=not-required`、
`rulesReviewPolicy=required`、`initialRepairPolicy=approval-required` 四个固定默认值而不询问用户。

本用例不判断显式策略覆盖或 delegated caller 的缺失策略处理。

## Subject-visible Prompt and inputs

Subject 使用待测版本的 `skills/deliver-task/` package。Harness 只注入下面的 Prompt；没有独立
fixture。每次调用使用 fresh context。

```text
你是 fresh-context 行为评测 subject。只读，不修改任何文件，不运行 start。请完整读取并严格使用当前被测 `skills/deliver-task/SKILL.md`，再按其中路由读取构造 direct caller exact task contract 所需文件。

这是 direct caller 实际收到的原始用户消息：
“$deliver-task 把 scripts/format.mjs 的默认并发数从 4 改成 6；保持 CLI 参数兼容；不要修改 package-lock.json。”

调用上下文只固定 baseCommit=0123456789abcdef0123456789abcdef01234567，没有提供 commitPolicy、acceptancePolicy、rulesReviewPolicy 或 initialRepairPolicy。现在只构造 `deliver-task.task.v1` 的 `task.json`，不执行 start，只输出公开响应。
```

## Observable expectations

一次调用应当：

- 返回完整且不含 Architecture binding 的 `deliver-task.task.v1` JSON；
- 使用 `caller.kind=direct`、`commitPolicy=required`、`acceptancePolicy=not-required`、
  `rulesReviewPolicy=required`、`initialRepairPolicy=approval-required`；
- 不询问或要求补充 policy；
- authority-bearing 文本继续按现有 source-fidelity 规则构造；
- 不运行 `start`。

## Evaluation boundary

本用例只验证 direct caller 在 policy 静默时的公开合同构造行为，不判断 task 文本字段的具体分配、
实际实现或后续执行闭环。Evaluator 只依据公开回复和公开工具动作判定，不要求、推断或保存隐藏思考
过程；自然语言 policy 选择属于行为审查，不由 schema validator 代判。
