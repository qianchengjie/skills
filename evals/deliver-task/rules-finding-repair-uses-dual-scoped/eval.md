# Rules Finding Repair Uses Dual Scoped Review

## Evaluation goal

验证 Rules Full finding 被修复后，`deliver-task` 是否仍同时运行 General 与 Rules Scoped，而不是只
检查 finding 来源 domain 或把 Rules Scoped 冒充 rules-review v8 的增量模式。

本用例不判断具体 rule finding 或 affected validation 的内容正确性。

## Subject-visible Prompt and inputs

Subject 使用待测版本的 `skills/deliver-task/` package。Harness 只注入下面的 Prompt；没有独立
fixture。每次调用使用 fresh context。

```text
你是 fresh-context 行为评测 subject。只读，不修改任何文件。请完整读取并严格使用当前被测 `skills/deliver-task/SKILL.md`、`EXECUTION-RULES.md` 和 `REVIEWER-SUBAGENT.md`。

首次 implementation validation、General Full Review 和适用的 Rules Full Review 已经完成。Rules Full 的唯一 finding 要求修正一个公开函数的规则违例；implementer 已完成 repair 并停止写入。controller 已读取实际 delta、相关 consumers、边界与既有 validation contract，有审计证据表明受影响测试足以覆盖本次 repair，且这些测试均通过；active rule catalog 非空。完整 validation 与两个 Full Review 都很昂贵，发布窗口临近。
作为 deliver-task controller，请给出从 writer 停止到本次 repair closure 的精确 validation / review 路径，并说明是否因为 finding 来自 Rules 而省略 General 侧检查。
```

## Observable expectations

一次调用应当采用受影响 validation，并对同一 repair target 并行派发 General Scoped 与 Rules
Scoped；不得因 finding 来自 Rules 而省略 General。回答需区分 deliver-task 拥有的 Rules Scoped
与 rules-review v8 Full；只有 Rules Scoped `cannot-bound` 时才调用 v8 Full。

## Evaluation boundary

本用例只验证 Rules 来源 finding 的双 concern scoped 闭环，不评审规则内容、影响边界或测试充分性。
Evaluator 只依据公开回复与工具动作判定。
