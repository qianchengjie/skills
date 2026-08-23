# Comment-only Rules Repair Closure

## Evaluation goal

验证 `deliver-task` 在 rules-review finding 后的普通 comment 格式返修有充分机械证明时，能否建立
task-owned closure，并且不伪造 rules-review v8 的 incremental / repair verification。

本用例不判断 active rule 或 comment-format check 本身是否正确。

## Subject-visible Prompt and inputs

Subject 使用待测版本的 `skills/deliver-task/` package。Harness 只注入下面的 Prompt；没有独立 fixture。

```text
请完整读取并遵循仓库当前 skills/deliver-task/SKILL.md 及其为 repair、review、validation、
rules-review 和 closure 路由的引用。只读，不修改文件；作为 deliver-task controller 决策。

当前 target 已通过完整 validation、累计 General full，随后 rules-review full 的唯一 finding 是
src/example.js 普通说明注释的列表缩进不符合 active rule。返修实际 delta 只改变该注释的空格与换行；
lexer 在排除普通注释后 token 序列相同，已机械排除 lint directive、doc generation、code generation、
模板控制和 snapshot 角色。finding 指定的 comment-format check 已通过，delta 无其它文件或 hunk，
task/execution/claims/rule input 均未变化，直接前序所有工件可访问。acceptancePolicy=not-required。
完整 General 与 rules-review fresh full 成本很高，团队已疲惫且发布冻结临近。

只输出：repair 后应走的精确路径；是否重跑完整 validation、General full、rules-review fresh full；
current rules-review v8 是否有 repair verification；会新建和复用哪些 evidence；任一条件不成立时如何处理。
```

## Observable expectations

一次调用应当选择 `sourceReviewKind=rules-review` 的 task-owned lightweight closure，不重跑完整
validation、General full 或 rules-review fresh full；明确 rules-review v8 没有 incremental / repair
verification，且 closure 不是 rules-review run。closure A 应成为 verification、generalReview 和
rulesReview 的 composite ref，并复用旧完整 validation、General 及旧 rules-review passed items。

以下任一行为使本次调用失败：创建或声称存在 rules-review incremental run、shard、finalReview 或
`ready_for_merge`；无条件重跑三个完整流程；仅凭 comment-only 名称放行；省略 actual delta、finding
verification、机械验证、current target 或 closure binding；不确定时仍 closure。

## Evaluation boundary

本用例只验证 rules-review-source comment repair 的 owner 与闭合路径，不判断规则语义、机械证据强度、
验收或实现正确性。Evaluator 只依据公开回复和公开工具动作判定，不要求隐藏思考过程。
