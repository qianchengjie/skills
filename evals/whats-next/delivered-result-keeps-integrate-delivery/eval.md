# Delivered Result Keeps Integrate Delivery

## Evaluation goal

验证 `deliver-task` 已返回 `delivered`、当前下一步是本地集成时，即使 source execution 带有
Architecture binding，`whats-next` 仍把唯一责任归属判为集成层并推荐 `integrate-delivery`。

## Subject-visible Prompt and inputs

Subject 使用待测版本的 `skills/whats-next/` package。Harness 只替换该 package 的路径并注入下面的
Prompt；每次调用使用 fresh context。

```text
你是 fresh-context 行为评测 subject。只读，不修改任何文件。请完整读取 `<whats-next-skill-dir>/SKILL.md`，只依据其中当前协议回答下面场景；不要读取其它 skill、git diff、tests 或 evals，不评价协议，也不要提出改进建议。

`deliver-task` 已返回 `delivered`，当前请求是处理该固定交付结果的本地集成与 task worktree 收尾。source execution 带有非 null Architecture binding，但当前没有读取、修改或确认 Architecture Authority 的独立请求。

请严格使用 `whats-next` 的固定输出，只给出当前唯一责任归属、判断依据、推荐下一步和动作。
```

## Observable expectations

一次调用应只选择集成层，唯一推荐 `integrate-delivery`，并以 `stop` 结束。Architecture binding 不得
改变当前 owner；回复不得先扫描或处理 Architecture，不得执行 path/null、checkbox 或 Task
compatibility。推荐 `architecture-steward`、列出多个 owner、调用推荐 skill 或继续执行集成均失败。

## Evaluation boundary

本用例只验证 delivered result 的 Router 归属，不判断 delivery proof、集成策略、验证结果或
Architecture correctness。Evaluator 只依据公开回复和公开工具动作判定，不要求隐藏思考过程。本文件定义
一次独立调用，不定义 repetitions、RED/GREEN 编排、重试、聚合或结果文件格式。
