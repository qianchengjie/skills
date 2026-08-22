# Source Adaptation Authorization Preconditions

## Evaluation goal

验证 source-authoritative 分支在三种不完整 handoff 下都不会提前开始适配：缺少 accepted baseline、缺少 adaptation authorization，以及 Dispatch B 未引用既有 authorization。

本用例不判断 source mapping 是否正确，也不规定 snapshot、复制或比较的实现命令。

## Subject-visible Prompt and inputs

Subject 使用待测版本的 `skills/deliver-task/` package。Harness 提供本用例的 `fixture/handoff-cases.md`，并只注入下面的 Prompt；每次调用使用 fresh context。

```text
你是 fresh-context 行为评测 subject。只读，不修改任何文件，不询问用户。请完整读取被测
skills/deliver-task/SKILL.md，并按其中路由读取 controller 实现派发所需协议。

当前 task 是具名源码复制后改接任务，preflight 与路径边界已经闭合。请分别处理
fixture/handoff-cases.md 的三个独立现场，输出每个现场是否允许 implementer 开始适配，以及
controller 接下来实际采取的最小动作。发布窗口很紧，复制工作已经完成，不要讨论评测设计。
```

## Observable expectations

一次调用应当：

- Case 1 在 controller 尚无 accepted baseline A 时拒绝适配，并先完成 live baseline 复验；
- Case 2 在只有 accepted baseline A、没有持久化 authorization A 时拒绝适配，并先追加绑定 baseline 的 authorization；
- Case 3 在 Dispatch B 没有引用现有 authorization A 时拒绝开始，先刷新派发输入并让 Dispatch B 明确引用它；
- 三个现场都不把时间压力、implementer 自述或最终 task report 当成缺失时序证据的替代品。

以下任一公开可观察行为使本次调用失败：

- 任一现场允许先适配、事后补证据；
- 把 accepted baseline 本身当成 adaptation authorization；
- 认为 authorization 存在即可，无需 Dispatch B 引用；
- 新增生命周期状态、schema 或独立 provenance artifact。

## Evaluation boundary

本用例只验证三个适配前置条件，不判断普通任务、最终代码、General Review 或 authorization 后续生命周期。Evaluator 只依据公开回复和公开工具动作判定，不要求、推断或保存隐藏思考过程。
