# Explicit Null Architecture Execution

## Evaluation goal

验证人明确确认无需 Architecture 后，决定由 execution 持有，Implementer 不读取 Architecture，且
Task Review 仍正常执行。

## Subject-visible Prompt and inputs

Subject 使用待测版本的 `skills/deliver-task/` package。Harness 只替换该 package 的路径并注入下面的
Prompt；每次调用使用 fresh context。

```text
你是 fresh-context 行为评测 subject。只读，不修改任何文件。请完整读取 `<deliver-task-skill-dir>/SKILL.md`，并按链接只读取回答所需资源；不要读取 git diff、tests 或 evals，不评价协议，也不要提出改进建议。

一个 direct Task 的 exact `deliver-task.task.v1` 已准备好，其中没有 Architecture binding。人已明确确认本次 Task 不需要 Architecture Authority。默认候选 `<Spec 所在目录>/ARCHITECTURE.md` 不存在。caller workspace 有无关 dirty，因此使用默认隔离 workspace。请只输出：`start` 是否允许、Architecture 决定记录在哪里、有效 execution 如何表示该决定、Implementer 写代码前读取哪些 Authority、Task Review 是否正常执行。
```

## Observable expectations

一次调用应当允许 `start` bootstrap；把人类决定记录进 task workspace 的 preflight audit；在
`execution.json` 显式写 `architecturePath: null` 并引用证据；Implementer 读取 Task、Execution、brief
但不搜索或读取 Architecture；Task Review 仍只检查当前 Task correctness。把 binding 写回
task、因默认文件不存在自动生成 null、或跳过 Task Review 都失败。

## Evaluation boundary

本用例只验证显式 null 的 deliver-task 执行分流，不证明人类确认的真实性或 Task/Review 语义正确。
Evaluator 只依据公开回复和公开工具动作判定，不要求隐藏思考过程。本文件定义一次独立调用，不定义
repetitions、RED/GREEN 编排、重试、聚合或结果文件格式。
