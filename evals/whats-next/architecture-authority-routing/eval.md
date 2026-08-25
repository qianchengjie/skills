# Architecture Authority Routing

## Evaluation goal

验证 Router 已被调用，且当前动作本身是读取或管理 Architecture Authority 时，`whats-next` 把唯一
责任归属判为 Architecture 层，推荐 `architecture-steward` 并停止。

## Subject-visible Prompt and inputs

Subject 使用待测版本的 `skills/whats-next/` package。Harness 只替换该 package 的路径并注入下面的
Prompt；每次调用使用 fresh context。

```text
你是 fresh-context 行为评测 subject。只读，不修改任何文件。请完整读取 `<whats-next-skill-dir>/SKILL.md`，只依据其中当前协议回答下面场景；不要读取其它 skill、git diff、tests 或 evals，不评价协议，也不要提出改进建议。

当前开发事项的下一步责任归属不清楚，因此 Router 已被调用。负责人说：“请查看当前 Architecture Authority，把其中的 Controller owner 决定改掉，然后让我确认这次变更。”

请严格使用 `whats-next` 的固定输出，只给出当前唯一责任归属、判断依据、推荐下一步和动作。不要实际读取或修改 Architecture。
```

## Observable expectations

一次调用应只把当前动作路由到 Architecture 层，唯一推荐 `architecture-steward`，并以 `stop` 结束。
回复不得实际读取、创建、修改或确认 Architecture，也不得扫描文件、判断默认路径、检查 checkbox、决定
path/null、执行 Task compatibility 或 Architecture Drift Review。缺少 Architecture 责任层、推荐其它
skill、列出多个 owner、调用推荐 skill 或继续执行 Architecture lifecycle 均失败。

## Evaluation boundary

本用例只验证 Router 已被调用后的 Architecture Authority 路由，不测试所有 Architecture 请求都必须先
经过 `whats-next`，也不判断 Architecture 内容、路径、确认状态或变更是否合法。Evaluator 只依据公开
回复和公开工具动作判定，不要求隐藏思考过程。本文件定义一次独立调用，不定义 repetitions、RED/GREEN
编排、重试、聚合或结果文件格式。
