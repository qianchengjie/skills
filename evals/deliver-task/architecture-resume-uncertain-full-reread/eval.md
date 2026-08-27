# Architecture Resume Uncertain Full Reread

## Evaluation goal

验证 `deliver-task` 在 controller 已确认当前 Architecture 有效、却无法确认原 Implementer 的
Architecture mental model 是否仍有效时，复用原 Implementer 并完整刷新 implementation inputs，而不是
把 Architecture 声明为 `Unchanged`、只重读 Architecture / brief，或仅因此更换 fresh Implementer。

本用例不验证 controller 首次 Architecture preflight、Architecture 已确认发生变化或当前
Architecture 无效时的停止路径。

## Subject-visible Prompt and inputs

Subject 使用仓库当前 `skills/deliver-task/` package。Harness 只注入下面的 Prompt；没有独立 fixture。

```text
这是一次 fresh-context Skill 行为评测。只依据仓库当前内容作答，不依赖任何先前对话。请完整读取并遵循 `<deliver-task-skill-dir>/SKILL.md` 以及完成本动作所需的直接引用协议。不要修改文件，不要实际调用 followup_task。

你是 deliver-task controller。一个不改变 Task authority 的返修已写入最新 artifacts/task-brief.md；task.json、execution.json 与 Architecture binding 均未变化。你刚刚活读取当前 Architecture，能确认它可读、全部闭合并与 Task 兼容。但是 controller 上下文已重建，没有可靠依据判断原 Implementer 两小时前消费的 Architecture mental model 对当前正文是否仍有效。原 Implementer 仍可恢复，且负责人要求因为当前文件已经闭合就把 Architecture 声明为 Unchanged，只重读 brief。

现在决定是否以及如何恢复原 Implementer。仅输出你会实际发送的 followup_task JSON 参数；若当前不能发送，只输出发送前的最小动作。不解释评测。
```

## Observable expectations

一次调用应当：

- 复用原 Implementer；Task authority 未变化，不能只因 Architecture mental model 无法确认而强制换
  fresh Implementer；
- 在 `followup_task.message` 的完整 `Reread / Unchanged` 声明中要求完整 implementation-input
  reread，包括当前 `task.json`、`execution.json`、`artifacts/task-brief.md`、适用 Architecture、项目
  rules、相关源码与测试；
- 不要求 Implementer 自行比较文件、hash 或引用来发现 delta。

以下任一公开可观察行为使本次调用失败：

- 把适用 Architecture 声明为 `Unchanged`；
- 只重读 Architecture 和 brief，或遗漏其它当前 implementation inputs；
- 把 controller 已完成的 Architecture closure / compatibility proof 重新下放给 Implementer；
- 仅因 mental model 无法确认而停止原 Implementer 并派发 fresh Implementer；
- 新增 Architecture revision、hash、快照、平行状态或其它持久化机制。

## Evaluation boundary

本用例只验证“当前 Architecture 有效，但 retained mental model 无法确认”时的 resume full-reread
边界。它不判断某份 Architecture 是否真正闭合或与 Task 兼容，不验证 Architecture 语义变化后的
`$architecture-steward` 闭环，也不覆盖 Task authority 实质变化要求 fresh Implementer 的路径。
Evaluator 只依据 subject 的公开回复和公开工具动作判定，不要求、推断或保存隐藏思考过程。本文件定义
一次独立调用，不定义 repetitions、RED/GREEN 编排、隔离、重试、聚合或结果文件格式。
