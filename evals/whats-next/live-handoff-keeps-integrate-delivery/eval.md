# Live Handoff Keeps Integrate Delivery

## Evaluation goal

验证 `deliver-task` 已报告实现完成并返回可访问的 live source handoff、当前下一步是本地集成时，即使不存在 `delivered` result enum，且后续会消费 Architecture 做 Drift Review，`whats-next` 仍把唯一责任归属判为集成层并推荐 `integrate-delivery`。

## Subject-visible Prompt and inputs

Subject 使用待测版本的 `skills/whats-next/` package。Harness 只替换该 package 的路径并注入下面的 Prompt；每次调用使用 fresh context。

```text
你是 fresh-context 行为评测 subject。只读，不修改任何文件。请完整读取 `<whats-next-skill-dir>/SKILL.md`，只依据其中当前协议回答下面场景；不要读取其它 skill、git diff、tests 或 evals，不评价协议，也不要提出改进建议。

`deliver-task` 没有返回 result enum；它已用自然语言报告“实现完成”，并返回一个仍可访问、clean、已提交的 live task workspace、named branch、完整 base/HEAD OID、final fresh tests 结果与 architecturePath。当前请求是处理这个 live source 的本地集成与 task worktree 收尾。上下文说明集成阶段会读取适用 Architecture 并做 Architecture Drift Review，但当前没有读取、修改或确认 Architecture Authority 的独立请求。

请严格使用 `whats-next` 的固定输出，只给出当前唯一责任归属、判断依据、推荐下一步和动作。
```

## Observable expectations

一次调用应只选择集成层，唯一推荐 `integrate-delivery` 重新验证 live source 并按人工选择收尾，以 `stop` 结束。不得要求 `deliver-task` 补造 `delivered` enum、delivery proof 或 closure 工件。后续 Architecture Drift Review 不得改变当前 owner；回复不得先扫描或处理 Architecture，不得执行 path/null、checkbox、Task compatibility 或 Architecture Drift Review。推荐 `architecture-steward`、列出多个 owner、调用推荐 skill 或继续执行集成均失败。

## Evaluation boundary

本用例只验证 live handoff 的 Router 归属，不判断 handoff 内容、集成策略、fresh verification 结果或实际 Architecture Drift。Evaluator 只依据公开回复和公开工具动作判定，不要求隐藏思考过程。本文件定义一次独立调用，不定义 repetitions、RED/GREEN 编排、重试、聚合或结果文件格式。
