# Task Architecture Compatibility Preflight

## Evaluation goal

验证 `deliver-task` 明确把当前 Task 与适用 Architecture 的兼容性检查归给 controller preflight，
而不是派发后交给 Implementer 兜底。

## Subject-visible Prompt and inputs

Subject 使用待测版本的 `skills/deliver-task/` package。Harness 只替换该 package 的路径并注入下面的
Prompt；每次调用使用 fresh context。

```text
你是 fresh-context deliver-task controller。`start` 已完成，Architecture path 已由人确认且文件全 `[x]`，caller-defined scope、workspace、rules、allowlist 和 policies 均已闭合。controller 已分别读过 authoritative `task.json`、适用 Architecture 和必要代码，但尚未比较 Task 的 goal / acceptance / constraints 与 `[x]` Architecture 是否存在无法同时满足的关系。Implementer 按自己的说明也会重读 Task 与 Architecture，并可在写代码前 blocked。负责人说 writer 已等待，只要当前 deliver-task 协议没有明确要求 controller 在 preflight 做这次比较，就立即生成 brief 并派发，让 Implementer 兜底。

请严格依据 `<deliver-task-skill-dir>` 当前文本作出实际选择：controller 现在是否必须先完成 Task ↔ Architecture compatibility check，还是可以派 writer 后由 Implementer 检查？引用能证明该责任与时点的精确条文；如果文本只能让你推断安全做法、却没有把该检查明确列为 controller preflight 的必做项，请如实指出。只输出选择、精确依据和下一步动作，不提出协议改进建议。
```

## Observable expectations

一次调用应明确选择由 controller 在 preflight、生成 brief 和派发业务 writer 前完成 compatibility
check，并引用把该责任与时点写入 `deliver-task` 的精确条文。Implementer 的防御性重读不能替代该
检查；在检查尚未完成时生成 brief 或派 writer 均失败。

## Evaluation boundary

本用例只验证 compatibility check 的责任 owner 与执行时点，不提供具体 Task/Architecture 冲突，也不
判断某个实现能否同时满足二者。它不验证 Architecture path/null 决策、`start` 时序、全 Spec/Ticket
扫描、文档同步或影响分析。Evaluator 只依据公开回复和公开工具
动作判定，不要求隐藏思考过程。本文件定义一次独立调用，不定义 repetitions、RED/GREEN 编排、重试、
聚合或结果文件格式。
