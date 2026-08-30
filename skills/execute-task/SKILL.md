---
name: execute-task
description: 当一个软件开发任务的目标、范围与验收已经明确，需要组织该任务的执行时使用。
disable-model-invocation: true
---

# 任务执行

## 定位

接收一个已经明确的单个软件开发任务，组织其实现、审查与必要返修，并将执行结果返回 Caller。

不负责定义或拆分任务，也不负责后续集成。

## 角色

- **Caller**：提供已经明确的任务，并接收执行结果或需要进一步决定的问题。
- **Controller**：组织任务执行，协调 Implementer、Reviewer、复审者与返修循环。
- **Implementer**：唯一的业务代码修改者，负责实现任务和处理返修。
- **Reviewer**：在各自审查范围内判断当前代码变更；没有发现问题时返回无 findings，发现问题时返回 findings 及原因；存在具体未决疑点时，自行运行 focused validation，仍无法解决时向 Controller 报告无法判断。
  - **General Reviewer**：分别审查需求正确性和实现设计：判断任务要求的结果是否正确、完整地实现以及本次变更是否造成需求层面的回归；判断本次变更形成的实现方案是否合理。
  - **Rules Reviewer**：判断当前代码变更是否违反适用的项目 Rules；finding 必须引用具体 Rule。
- **复审者**：仅判断 Reviewer 提出的 findings 中哪些需要修改。

当前执行 `execute-task` 的 agent 承担 Controller。Controller 分别派发 Implementer subagent，以及相互独立的 General Reviewer 和 Rules Reviewer subagent；返修继续交给原 Implementer。

Implementer 不得将本任务范围外的既有修改纳入本任务提交。

Reviewer 的代码审查对象只包含已提交范围。Implementer 完成实现或返修并通过验证后提交本轮变更；一轮可包含多个 commits。无法继续时将原因返回 Controller。

参与复审的 Reviewer 指当前任务中已经完成过审查的 Reviewer。

## 主流程

1. Caller 将已经明确的任务交给 Controller。
2. Controller 记录当前 HEAD 为 BASE，将原始任务和相关上下文交给 Implementer。
3. Implementer 完成实现，将结果返回 Controller。
4. Controller 以原始任务和 BASE..HEAD 为输入，按 General Reviewer、Rules Reviewer 的顺序启动 Full Review。
5. 当前 Reviewer 没有发现问题时进入下一项审查；发现问题时进入问题复审与返修循环；无法判断时，Controller 将未决疑点和当前结果返回 Caller。恢复后，原 Reviewer 继续处理原未决疑点。两项审查均无 findings 后，Controller 将执行结果返回 Caller。

## 问题复审与返修循环

1. Reviewer 将发现的问题及原因返回 Controller；再次提出复审确定的不修改项时，还说明此前不修改原因错误在哪里。
2. Controller 将原始任务、BASE..HEAD 和 Reviewer 本轮提出的所有问题及原因交给一个 Fresh 复审者 Subagent；同一个 finding 被再次提出时，还提供此前的不修改原因，以及原 Reviewer 对该原因错误之处的说明。
3. 复审者确定修改项，并说明不修改项及原因；对于再次提出且仍判定不修改的 finding，还需要回应原 Reviewer 指出的错误之处。复审者将判断结果返回 Controller。复审者无法判断某个 finding 是否需要修改时，Controller 将该 finding 和当前结果返回 Caller；恢复后，Controller 继续处理本轮已有复审结果，不重新派发复审者。
4. 有需要修改的 findings 时，Controller 记录当前 HEAD 为 FIX_BASE，并将这些 findings 及原因交给 Implementer。
5. 发生返修时，Implementer 完成返修，将处理结果返回 Controller。
6. Controller 发起本轮复审：本轮发生修改时，将 FIX_BASE..HEAD 交给参与复审的 Reviewer；将各 finding 的复审结论及处理结果交给所属 Reviewer。本轮复审完成后仍有 findings 时继续本循环。
7. 主流程中的 Full Review 不计数。复审者完成判断后，Controller 根据复审结论继续自动推进本轮 findings 的处理与复审时，计为启动 1 次自动处理轮次，本轮所有 findings 合计 1 次；Reviewer 或复审者无法判断并停止自动推进时不计数。最多启动 3 次自动处理轮次；第 3 次结束后仍有 findings 时，Controller 将未收敛的问题和当前结果返回 Caller。

## 返回 Caller

任务完成时，Controller 向 Caller 说明：

- 完成的实现；
- 发生变化的文件；
- 执行过的验证及其结果；
- 各 Reviewer 的审查结果；
- 仍需关注的风险。

任务无法继续时，Controller 返回已经完成的部分、无法继续的原因，以及下一步需要 Caller 决定或补充的内容。

任务完成或明确无法继续时，Controller 返回 Caller 后，`execute-task` 结束。

因无法判断或达到 3 次自动处理上限返回 Caller 时，本次 `execute-task` 仅停止自动推进，等待 Caller 决定。Caller 补充决定未改变原任务的目标、范围或验收时，继续本次 `execute-task`，复用原 Controller、Implementer 和各 Reviewer，自动处理轮次从 0 重新计数；发生变化时结束当前执行，由 Caller 重新发起任务。
