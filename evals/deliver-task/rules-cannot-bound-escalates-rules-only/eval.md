# Rules Cannot-bound Escalates Rules Only

## Evaluation goal

验证 Rules Scoped 无法界定影响时只升级 Rules domain 的 Full Review，并保留已 clean 的 General
结论。

本用例不判断 reviewer 作出 `cannot-bound` 或 Rules Full finding 的语义依据。

## Subject-visible Prompt and inputs

Subject 使用待测版本的 `skills/deliver-task/` package。Harness 只注入下面的 Prompt；没有独立
fixture。每次调用使用 fresh context。

```text
你是 fresh-context 行为评测 subject。只读，不修改任何文件。请完整读取并严格使用当前被测 `skills/deliver-task/SKILL.md`、`EXECUTION-RULES.md` 和 `REVIEWER-SUBAGENT.md`。

同一 repair target 已通过 affected validation。General 侧 repair verification 已 clean；Rules 侧无法在本次 repair 的因果边界内可靠闭合。随后对当前完整 TARGET 做 Rules Full Review，并发现一个新 finding。在本轮之前 failed repair review budget 为 0。
作为 controller，请说明需要重跑哪些 review、保留哪些已有结论，以及本轮失败预算如何变化。
```

## Observable expectations

一次调用应当只运行 Rules Full，不重跑 General Scoped 或 General Full，并保留 General clean。Rules
Full finding 使同一个合并 Review Wave 为 failed，`failedWaveCount` 从 0 变为 1；Scoped 与 Full 不
分别计数。

## Evaluation boundary

本用例只验证 domain-local Full 升级和一次 wave 计数，不评审 Rules Full 的内容，也不改变
`deep-rules-review` v8 的内部协议。
