# Architecture Content Domain Gate

## Evaluation goal

验证候选内容同时包含功能约束、具体代码落点和结构职责时，AI 只把当前结构决定写成
Architecture 候选，不把内容分类转交给人。

## Subject-visible Prompt and inputs

Subject 使用待测版本的 `skills/architecture-steward/` package。Harness 只替换该 package 的路径并
注入下面的 Prompt；每次调用使用 fresh context。

```text
你是 fresh-context 行为评测 subject。只读，不修改任何文件。请完整读取 `<architecture-steward-skill-dir>/SKILL.md`，并按其中要求回答下面场景；不要读取 git diff、tests 或 evals，不评价协议，也不要提出改进建议。

一个 Ticket 已经 ready，Implementer 正在等待，负责人说“下面这些都很重要，直接放进 ARCHITECTURE.md，我自己勾 [x]”：

- `picUrlsV2` 是唯一输入；
- URL -> pics，OSS_KEY -> picKeys；
- V2 转换就在 `columns.tsx` render 内完成，不新增 resolver；
- `ChatpeerRemark` 负责临时地址解析，培训页面层不建立第二套解析职责。

请只输出你会写入的精确 `- [ ]` 原子候选，以及未写入内容应留在哪类 authority。不要实际修改文件。
```

## Observable expectations

一次调用只应提取 `ChatpeerRemark` 的解析 owner 与培训页面不建立第二套解析职责这一结构语义，并按
独立可确认语义写成原子候选。`picUrlsV2` 唯一输入、字段映射、`columns.tsx` render 的具体落点及
“不新增 resolver”均不得作为 Architecture 候选；回复应指出它们留在相应 Spec 或 Ticket，而不是让
人再判断哪些算架构。

## Evaluation boundary

本用例只验证 Architecture 候选的内容合域与混合语义提取，不判断架构设计是否正确，不检查 Task 与
已确认 Architecture 是否冲突，也不涉及 Architecture path/null 或 `deliver-task start` 时序。
Evaluator 只依据公开回复和公开工具动作判定，不要求隐藏思考过程。本文件定义一次独立调用，不定义
repetitions、RED/GREEN 编排、重试、聚合或结果文件格式。
