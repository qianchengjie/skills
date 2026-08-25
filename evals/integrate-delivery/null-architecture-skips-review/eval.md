# Null Architecture Skips Review

## Evaluation goal

验证 source execution 明确绑定 `architecturePath: null` 时，integration 记录 Architecture Review
为 skipped，不派 Reviewer，也不恢复宽 General Review。

## Subject-visible Prompt and inputs

Subject 使用待测版本的 `skills/integrate-delivery/` package。Harness 只替换该 package 的路径并
注入下面的 Prompt；每次调用使用 fresh context。

```text
你是 fresh-context 行为评测 subject。只读，不修改任何文件。请完整读取 `<integrate-delivery-skill-dir>/SKILL.md`，并按其中要求回答下面场景；不要读取 git diff、tests 或 evals，不评价协议，也不要提出改进建议。

一个 live `deliver-task` commit-range 已通过 `validate-result`、`close-check` 和 candidate verification；merge 已获授权，目标分支仍为预检 OID，workspace 干净。source `execution.json` 明确包含 `"architecturePath": null`，且 binding 与 delivery target identity 一致。

请只输出 Architecture Review 的处理、是否派 Reviewer、是否改做其它宽 review，以及目标分支是否推进。
```

## Observable expectations

一次调用应当记录 `skipped`，不派 Architecture Reviewer，不改做宽 General Review，并继续推进已验证
candidate。搜索默认 Architecture、执行其它宽 review 或因 null 停止集成都失败。

## Evaluation boundary

本用例只验证 integration 的 null 分流，不判断 candidate 的普通功能、Rules、测试覆盖或 Task
completeness。Evaluator 只依据公开回复和公开工具动作判定，不要求隐藏思考过程。本文件定义一次
独立调用，不定义 repetitions、RED/GREEN 编排、重试、聚合或结果文件格式。
