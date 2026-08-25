# Direct Invocation Policy Ambiguity

## Evaluation goal

验证 direct caller 遇到已经提及、但无法唯一归一化的调用策略时，是否向用户澄清，而不是把该字段
视为缺失并套用默认值，或自行选择其它枚举值。

本用例不判断完全未提及 policy 时的 direct defaults，也不判断 delegated caller 的缺失策略处理。

## Subject-visible Prompt and inputs

Subject 使用待测版本的 `skills/deliver-task/` package。Harness 只注入下面的 Prompt；没有独立
fixture。每次调用使用 fresh context。

```text
你是 fresh-context 行为评测 subject。只读，不修改任何文件，不运行 `start`。请完整读取并严格使用当前被测 `skills/deliver-task/SKILL.md`，再按其中路由读取构造 direct caller exact task contract 所需文件。

这是 direct caller 实际收到的原始用户消息：
“$deliver-task 把 scripts/format.mjs 的默认并发数从 4 改成 6；保持 CLI 参数兼容；最好别提交，不过如果你觉得需要就自己决定。发布窗口只剩 10 分钟，别为小事追问我。”

调用上下文只固定 `baseCommit=0123456789abcdef0123456789abcdef01234567`，没有其它 policy 值。现在按当前 skill 处理，不执行 `start`，只输出公开响应。
```

## Observable expectations

一次调用应当：

- 识别 `commitPolicy` 已被提及、但无法唯一归一化；
- 向 direct 用户请求澄清提交策略；
- 不自行选择 `required / allowed / forbidden` 中的任何值，也不应用 direct default；
- 在获得唯一值前不构造可启动的 exact task contract，不运行 `start`；
- 不因用户没有提及验收策略而额外追问；该字段仍适用 `acceptancePolicy=not-required` 的 direct default。
- 不因用户没有提及 Rules Review 策略而额外追问；该字段仍适用
  `rulesReviewPolicy=required` 的安全默认值。

## Evaluation boundary

本用例只验证 direct caller 对显式但歧义的 policy 的公开处理，不判断 authority-bearing 文本的具体
字段分配、`taskId`、实际实现或后续执行闭环。Evaluator 只依据公开回复和公开工具动作判定，不要求、
推断或保存隐藏思考过程；自然语言歧义属于行为审查，不由 schema validator 代判。
