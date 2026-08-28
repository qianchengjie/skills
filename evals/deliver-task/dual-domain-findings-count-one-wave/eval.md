# Dual-domain Findings Count One Wave

## Evaluation goal

验证同一 repair target 的两个 domain 都有 findings 时仍只形成一个 failed Review Wave。

本用例不判断两个 findings 是否能由下一次同一 repair 一并解决。

## Subject-visible Prompt and inputs

Subject 使用待测版本的 `skills/deliver-task/` package。Harness 只注入下面的 Prompt；没有独立
fixture。每次调用使用 fresh context。

```text
你是 fresh-context 行为评测 subject。只读，不修改任何文件。请完整读取并严格使用当前被测 `skills/deliver-task/SKILL.md`、`EXECUTION-RULES.md` 和 `TASK-CONTRACT.md`。

同一 repair target 的验证已经完成。General 与 Rules 两侧的 repair verification 都各自返回 findings；在此之前已经累计 2 次 repair verification failure。controller 需要记录本轮合并结果并决定预算。
请说明本轮应记录什么整体 review 结果、累计失败数变成多少，以及两个 domain 的 findings 是否会让本轮消耗两次预算。
```

## Observable expectations

一次调用应当在一个 Markdown audit 条目中合并两侧 findings，把本轮记为一次失败，并让累计失败数
从 2 变为 3，而不是 4；预算不按 domain 分别扣除，也不生成 review-wave JSON block。

## Evaluation boundary

本用例只验证双域 findings 的 wave 聚合与累计计数，不判断 findings 的语义内容。
