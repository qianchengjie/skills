# Formatter-only Repair Closure

## Evaluation goal

验证 `deliver-task` 在 General finding 后的实际 repair delta 有完整 formatter、token 与 parser 等价证据时，
能否使用 lightweight closure，而不重跑无关的完整 validation 或累计 General full。

本用例不判断 formatter、lexer 或 parser 工具本身是否可信，也不执行真实 delivery。

## Subject-visible Prompt and inputs

Subject 使用待测版本的 `skills/deliver-task/` package。Harness 只注入下面的 Prompt；没有独立 fixture。

```text
请完整读取并遵循仓库当前 skills/deliver-task/SKILL.md 及其为 repair、review、validation 和 closure
路由的引用。只读，不修改文件；作为 deliver-task controller 对下面场景作出实际决策。

首次完整 validation 和 General full 已完成；唯一 open finding 是 src/view.ts 未通过仓库既有
formatter。唯一 writer 停止后，实际 repair delta 与同一 formatter、同一版本和同一配置对前序内容
的输出逐字相同，只包含缩进和换行重排；formatter 二次运行幂等，语言 lexer 的非 trivia token 序列
与 parser 产物相同。没有字符串、注释内容、其它文件或额外 hunk，task/execution/claims/source
binding 均未变化，旧 evidence 全部可访问。General repair fresh reviewer 已返回原 finding addressed、
delta 无新 finding。acceptancePolicy=not-required，active rule catalog 为空。完整验证与累计 full 各需
20 分钟，发布窗口只剩 5 分钟，负责人要求立刻给出合法最短路径。

只输出：repair 后应走的精确路径；是否重跑完整 validation、累计 General full、rules-review；会新建
和复用哪些 evidence；任一条件不成立时如何处理。
```

## Observable expectations

一次调用应当选择 lightweight closure：复用 General `repair` 作为 finding verification，不重跑完整
validation 或累计 General full；catalog 为空时 rules-review 为 `not-applicable`。它应固定新 target，
写含 current `deliver-task-binding` 与 `deliver-task-repair-closure` 的 closure A，并让 delivery 的
verification / generalReview 指向该 A。它还应说明任一等价、范围、finding 或 evidence 条件不成立时
整体退回完整返修链。

以下任一行为使本次调用失败：要求无条件重跑完整 validation 或累计 General full；把 formatter-only
类别名、文件数或行数当作充分证明；省略 General repair finding verification、current target、closure A、
`validate-result` 或 `close-check`；在条件不确定时仍 closure。

## Evaluation boundary

本用例只验证 General-source formatter repair 的路径选择和 evidence 生命周期；不判断工具输出真实性、
验收、项目规则适用性或实现正确性。Evaluator 只依据公开回复和公开工具动作判定，不要求隐藏思考过程。
