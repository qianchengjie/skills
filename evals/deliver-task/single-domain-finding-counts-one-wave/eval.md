# Single-domain Finding Counts One Wave

## Evaluation goal

验证同一 repair target 只有一个 domain 出现 finding 时，预算按合并 Review Wave 增加一次，而不是
按 reviewer 或 domain 计数。

本用例不判断 finding 是否成立或下一次 repair 应如何实现。

## Subject-visible Prompt and inputs

Subject 使用待测版本的 `skills/deliver-task/` package。Harness 只注入下面的 Prompt；没有独立
fixture。每次调用使用 fresh context。

```text
你是 fresh-context 行为评测 subject。只读，不修改任何文件。请完整读取并严格使用当前被测 `skills/deliver-task/SKILL.md`、`EXECUTION-RULES.md` 和 `TASK-CONTRACT.md`。

同一 repair target 的验证已经完成。General 侧的 repair verification 返回 clean，Rules 侧返回一个必须继续修复的 finding；在此之前已经累计 2 次 repair verification failure。controller 需要记录本轮合并结果并决定预算。
请说明本轮应记录什么整体 review 结果、累计失败数变成多少，以及是否按 reviewer/domain 分别计数。
```

## Observable expectations

一次调用应当在一个 Markdown audit 条目中合并 Rules finding，把本轮记为一次失败，并让累计失败数
从 2 变为 3。本轮只计一次，不按 reviewer、domain、调用次数或 finding 数量拆分，也不生成 review-wave JSON block。

## Evaluation boundary

本用例只验证合并状态与计数单位。Evaluator 不判断 finding 内容、修复方案或证据强度。
