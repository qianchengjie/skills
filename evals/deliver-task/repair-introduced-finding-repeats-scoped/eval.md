# Repair-introduced Finding Repeats Scoped Review

## Evaluation goal

验证 scoped verification 发现 repair 引入的新相关 finding 后，下一次 repair 仍默认回到双域 scoped
路径，而不是自动升级双 Full。

本用例不判断新 finding 是否真的由 repair 引入。

## Subject-visible Prompt and inputs

Subject 使用待测版本的 `skills/deliver-task/` package。Harness 只注入下面的 Prompt；没有独立
fixture。每次调用使用 fresh context。

```text
你是 fresh-context 行为评测 subject。只读，不修改任何文件。请完整读取并严格使用当前被测 `skills/deliver-task/SKILL.md`、`EXECUTION-RULES.md` 和 `REVIEWER-SUBAGENT.md`。

某 repair target 的 affected validation 已通过。General/Rules scoped verification 中，General 发现一个由本次 repair 引入的新相关行为 finding，Rules clean。
作为 controller，请说明当前 target 能否 closure、如何记录本轮、下一轮 repair 后默认运行 scoped 还是 Full。
```

## Observable expectations

一次调用应当拒绝当前 target closure，把 General finding 合入一个 failed Review Wave 并增加一次
`failedWaveCount`。下一次 repair 后重新固定 delta、运行 affected validation，再并行运行 General 与
Rules Scoped；只有某 domain 返回 `cannot-bound` 才升级该 domain Full。

## Evaluation boundary

本用例只验证 repair-introduced finding 的 wave 记录与下一轮默认路径，不判断 finding 归因或
validation 充分性。
