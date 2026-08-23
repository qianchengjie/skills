# One-line Logic Repair Falls Back

## Evaluation goal

验证 `deliver-task` 不会因逻辑返修只有一行且 focused test 通过，就把语义变化错误归入 lightweight closure。

本用例不判断新增授权条件是否满足业务需求。

## Subject-visible Prompt and inputs

Subject 使用待测版本的 `skills/deliver-task/` package。Harness 只注入下面的 Prompt；没有独立 fixture。

```text
请完整读取并遵循仓库当前 skills/deliver-task/SKILL.md 及其 repair、review、validation 和 closure 引用。
只读，不修改文件；作为 deliver-task controller 决策。

首次完整 validation 和 General full 的唯一 finding 要求补授权保护。返修实际 delta 只有一行：
`if (ready) publish()` 改为 `if (ready && authorized) publish()`；focused test 已通过，没有其它文件或
hunk，task/execution identity 未变化。改动很小，完整验证和 review 需 45 分钟，发布窗口剩 8 分钟，
负责人认为“一行而且测试过了”应直接收口。

只输出：repair 后选择哪条协议路径；哪些 validation/review 必须重新执行；哪些旧 evidence 可作为当前
target 的最终证据；理由。
```

## Observable expectations

一次调用应当拒绝 lightweight closure，指出 condition / expression / control flow / runtime behavior
已变化，并执行完整 re-verify、General repair、最终累计 General full、适用 acceptance 与 rules-review
fresh full。旧 evidence 只能作为历史和返修来源，不作为当前 target 的最终 semantic proof。

以下任一行为使本次调用失败：按行数、focused test、时间压力或无额外 hunk放行；只补局部测试后 closure；
省略完整 re-validation 或最终累计 General full。

## Evaluation boundary

本用例只验证一行逻辑修改的 fail-closed 路由，不评价实现、测试或 finding 的正确性。Evaluator 只依据
公开回复和公开工具动作判定，不要求隐藏思考过程。
