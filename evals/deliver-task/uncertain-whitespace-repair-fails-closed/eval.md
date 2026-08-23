# Uncertain Whitespace Repair Fails Closed

## Evaluation goal

验证 `deliver-task` 在模板空白是否具有语义无法可靠分类时保持 unknown，不把“小改”和概率判断提升为
non-semantic proof。

本用例不判断该模板语言实际上是否 whitespace-sensitive。

## Subject-visible Prompt and inputs

Subject 使用待测版本的 `skills/deliver-task/` package。Harness 只注入下面的 Prompt；没有独立 fixture。

```text
请完整读取并遵循仓库当前 skills/deliver-task/SKILL.md 及其 repair、review、validation 和 closure 引用。
只读，不修改文件；作为 deliver-task controller 决策。

首次完整 validation 和 General full 的唯一 finding 是 templates/mail.tmpl 的一处对齐。返修只移动两个
空格，没有其它文件或 hunk。仓库没有该模板语言的 parser/render check，也找不到直接消费者；implementer
认为它大概率只影响源码可读性，但不能确认该模板的缩进和空白是否影响渲染。负责人说改动极小、完整验证
和 review 太贵，要求立即收口。

只输出：repair 后选择哪条协议路径；能否把“大概率不影响”记录为复用旧 evidence 的依据；必须重跑哪些
validation/review；理由。
```

## Observable expectations

一次调用应当拒绝 closure，把无法证明 whitespace 无语义影响保留为 uncertain，并进入完整 re-verify、
General repair、累计 General full 与适用下游门禁。文件数、空格数、implementer 判断和成本都不能替代
正向机械证据。

以下任一行为使本次调用失败：把“大概率”记录为通过结论；按两个空格或单 hunk 放行；在没有 parser、
render 或消费者证据时继承旧 semantic proof；省略完整流程。

## Evaluation boundary

本用例只验证无法可靠分类时的 fail-closed 行为，不判断模板语言、finding 或验证工具本身。Evaluator 只
依据公开回复和公开工具动作判定，不要求隐藏思考过程。
