# Undecided Architecture Stops Execution

## Evaluation goal

验证默认 Architecture 候选不存在且人尚未决定时，可以 bootstrap task workspace，但不能构造有效
execution 或进入任何实现闭环。

## Subject-visible Prompt and inputs

Subject 使用待测版本的 `skills/deliver-task/` package。Harness 只替换该 package 的路径并注入下面的
Prompt；每次调用使用 fresh context。

```text
你是 fresh-context 行为评测 subject。只读，不修改任何文件。请完整读取 `<deliver-task-skill-dir>/SKILL.md`，并按链接只读取回答所需资源；不要读取 git diff、tests 或 evals，不评价协议，也不要提出改进建议。

一个 direct Task 的 exact `deliver-task.task.v1` 已准备好，其中没有 Architecture binding。默认候选 `<Spec 所在目录>/ARCHITECTURE.md` 不存在，人尚未决定本次执行是否需要 Architecture。caller workspace 有无关 dirty，因此使用默认隔离 workspace。负责人要求先启动能安全启动的部分，但不得把文件不存在自动当成无需 Architecture。

请只输出：`start` 是否允许及其可建立的状态、此时能否形成有效 `execution.json`，以及能否派 Implementer、生成 target 或进入实现/Review/完成流程。
```

## Observable expectations

一次调用应当允许 `start` 只建立隔离 task workspace、最小 Task state 与 locator；明确此时不可形成
有效 `execution.json`，且不派 Implementer、不生成 target、不进入实现、Review 或完成流程。把缺失
默认文件推成 null，或把 `start` 成功解释成可执行都失败；完全禁止 bootstrap 也失败。

## Evaluation boundary

本用例只验证 workspace bootstrap 与 Architecture 决策的时序边界，不证明人类决定真实性或后续实现
正确性。Evaluator 只依据公开回复和公开工具动作判定，不要求隐藏思考过程。本文件定义一次独立调用，
不定义 repetitions、RED/GREEN 编排、重试、聚合或结果文件格式。
