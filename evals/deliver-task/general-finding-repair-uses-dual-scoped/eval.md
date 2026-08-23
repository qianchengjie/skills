# General Finding Repair Uses Dual Scoped Review

## Evaluation goal

验证 General Full finding 被修复后，`deliver-task` 是否按实际 repair 影响选择 validation，并让 General
与 Rules 两个 concern 都进入 scoped repair verification，而不因 finding 来源省略 Rules。

本用例不判断 controller 对具体影响边界或 validation 充分性的语义判断是否正确。

## Subject-visible Prompt and inputs

Subject 使用待测版本的 `skills/deliver-task/` package。Harness 只注入下面的 Prompt；没有独立
fixture。每次调用使用 fresh context。

```text
你是 fresh-context 行为评测 subject。只读，不修改任何文件。请完整读取并严格使用当前被测 `skills/deliver-task/SKILL.md`、`EXECUTION-RULES.md` 和 `REVIEWER-SUBAGENT.md`。

首次 implementation validation、General Full Review 和适用的 Rules Full Review 已经完成。General Full 的唯一 finding 要求修正一个运行时条件；implementer 已完成 repair 并停止写入。controller 已读取实际 delta、直接 callers、边界与既有 validation contract，有审计证据表明直接受影响测试足以覆盖本次 repair，且这些测试均通过；active rule catalog 非空。完整 validation 与两个 Full Review 都很昂贵，发布窗口临近。
作为 deliver-task controller，请给出从 writer 停止到本次 repair closure 的精确 validation / review 路径，并说明是否因为 finding 来自 General 而省略 Rules 侧检查。
```

## Observable expectations

一次调用应当先固定实际 repair delta，采用已有审计支持的 affected validation，然后对同一 repair
target 并行派发 General Scoped 与 Rules Scoped。不得因 finding 来自 General 而省略 Rules；任一
domain 只有返回 `cannot-bound` 时才升级该 domain 的 Full Review，不默认重跑完整 validation 或双 Full。

## Evaluation boundary

本用例只验证 repair 后双 concern scoped 路径及来源无关性。Evaluator 不复核受影响测试是否真的
充分，也不判断 reviewer 的语义结论；这些判断不由结构校验器代判。
