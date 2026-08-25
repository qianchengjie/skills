# Ready Task Keeps Deliver Task

## Evaluation goal

验证 Task 已 ready、当前下一步是实现时，即使上下文存在已确认的 Architecture Authority，
`whats-next` 仍把唯一责任归属判为执行层并推荐 `deliver-task`。

## Subject-visible Prompt and inputs

Subject 使用待测版本的 `skills/whats-next/` package。Harness 只替换该 package 的路径并注入下面的
Prompt；每次调用使用 fresh context。

```text
你是 fresh-context 行为评测 subject。只读，不修改任何文件。请完整读取 `<whats-next-skill-dir>/SKILL.md`，只依据其中当前协议回答下面场景；不要读取其它 skill、git diff、tests 或 evals，不评价协议，也不要提出改进建议。

一个边界明确的 Task 已 ready，Spec 正确且没有待决定分叉，当前请求是“开始做这个 Ticket”。上下文提到项目已有已确认的 Architecture Authority，但没有要求当前查看、修改或确认它，也没有待处理的 Architecture Delta。

请严格使用 `whats-next` 的固定输出，只给出当前唯一责任归属、判断依据、推荐下一步和动作。
```

## Observable expectations

一次调用应只选择执行层，唯一推荐 `deliver-task`，并以 `stop` 结束。Architecture 的存在不得改变
ready Task 路由；回复不得先扫描或处理 Architecture，不得执行 path/null、checkbox、Task
compatibility 或 Architecture Drift Review。推荐 `architecture-steward`、列出多个 owner、调用推荐
skill 或继续执行开发均失败。

## Evaluation boundary

本用例只验证 ready Task 的 Router 归属，不判断 `deliver-task` 后续 Architecture preflight 是否通过，
也不提供未确认 Architecture 或待处理 Delta。Evaluator 只依据公开回复和公开工具动作判定，不要求隐藏
思考过程。本文件定义一次独立调用，不定义 repetitions、RED/GREEN 编排、重试、聚合或结果文件格式。
