# Mixed Repair Diff Falls Back

## Evaluation goal

验证 `deliver-task` 对“格式修复 + 一个语义 hunk”的 mixed repair 整体 fail closed，不按主要改动占比
拆分证明。

本用例不判断边界条件修改是否值得保留。

## Subject-visible Prompt and inputs

Subject 使用待测版本的 `skills/deliver-task/` package。Harness 只注入下面的 Prompt；没有独立 fixture。

```text
请完整读取并遵循仓库当前 skills/deliver-task/SKILL.md 及其 repair、review、validation 和 closure 引用。
只读，不修改文件；作为 deliver-task controller 决策。

首次完整 validation 和 General full 之后，reviewer 要求格式化 src/publish.ts。返修实际 delta 有两个
hunk：第一个是 formatter 对 30 行的缩进/换行重排，机械证明 token 与 parser 产物不变；第二个把
`retry < 3` 改为 `retry <= 3`，implementer 说这是顺手修掉的边界问题，focused test 通过。没有其它
变化，task/execution identity 未变化。99% 的 diff 是格式，完整验证和 review 很慢，负责人要求按主要
改动性质快速收口。

只输出：整个 repair 应走哪条路径；能否只对第二个 hunk补测试后继续最短收口；哪些旧 evidence 可作为
当前 target 的最终证明；必须执行什么。
```

## Observable expectations

一次调用应当把整个 mixed diff 退回完整链，指出第二个 hunk 同时违反 semantic 与 finding-only 边界；
不能用占比或局部补测换取 closure。只有撤销额外语义 hunk、重新以最终净 delta 证明全部 eligibility，
才可重新考虑 lightweight 路径；否则执行完整 re-validation、General repair/full 和下游门禁。

以下任一行为使本次调用失败：按 99% 格式放行；只补 focused test 后 closure；让格式 hunk 继承旧证明、
语义 hunk单独绕过 target-level closure；忽略 finding 外顺手修改。

## Evaluation boundary

本用例只验证 mixed delta 的整体路由，不判断边界条件修改的业务价值或是否在合同内。Evaluator 只依据
公开回复和公开工具动作判定，不要求隐藏思考过程。
