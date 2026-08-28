---
name: execute-task
description: 当一个软件开发任务的目标、范围与验收已经明确，需要组织该任务的执行时使用。
---

# 任务执行

## 定位

接收一个已经明确的单个软件开发任务，组织其实现、审查与必要返修，并将执行结果返回 Caller。

不负责定义或拆分任务，也不负责后续集成。

## 角色

- **Caller**：提供已经明确的任务，并接收执行结果或需要进一步决定的问题。
- **Controller**：组织任务执行，协调 Implementer、Reviewer、复审者与返修循环。
- **Implementer**：唯一的业务代码修改者，负责实现任务和处理返修。
- **Reviewer**：独立于 Implementer，围绕原始任务审查当前代码变更，判断任务是否正确、完整地实现，以及是否引入与本次变更相关的问题。
- **复审者**：只复审 Reviewer 提出的问题，确定修改项，并说明不修改项及原因。

当前执行 `execute-task` 的 agent 承担 Controller。Controller 分别派发 Implementer subagent 和 Reviewer subagent；返修继续交给原 Implementer，Reviewer 不参与业务代码修改。

Reviewer 每轮提出问题后，Controller 都将本轮所有 findings 交给一个独立于 Implementer 和 Reviewer 的 Fresh 复审者 Subagent。

## 协作上下文

- Controller 向 Implementer 提供原始任务和完成实现所需的相关上下文。
- Controller 向 Reviewer 提供原始任务和当前代码变更；返修后的审查还提供复审确定的不修改项及原因。
- Implementer、Reviewer 与复审者都将结果返回 Controller，由 Controller 统一与 Caller 沟通。

## 主流程

1. Caller 将已经明确的任务交给 Controller。
2. Controller 理解任务与相关上下文，并将任务交给 Implementer。
3. Implementer 完成实现和验证，将结果返回 Controller。
4. Controller 将当前代码变更交给 Reviewer 独立审查。
5. Reviewer 没有发现问题时，Controller 将执行结果返回 Caller；发现问题时进入问题复审与返修循环。

## 问题复审与返修循环

1. Reviewer 将发现的问题及原因返回 Controller；再次提出复审确定的不修改项时，还说明此前不修改原因错误在哪里。
2. Controller 将原始任务、当前代码变更和 Reviewer 提出的问题及原因交给复审者；同一个 finding 被再次提出时，还提供此前的不修改原因，以及原 Reviewer 对该原因错误之处的说明。
3. 复审者确定修改项，并说明不修改项及原因；对于再次提出且仍判定不修改的 finding，还需要回应原 Reviewer 指出的错误之处。复审者将结果返回 Controller。
4. 有修改项时，Controller 将修改项及其 finding 原因交给 Implementer 处理；没有修改项时跳过 Implementer。
5. 有修改项时，Implementer 完成返修和相关验证，将新结果返回 Controller。
6. Controller 再次将当前代码变更、复审确定的不修改项及原因交给原 Reviewer 审查。
7. 从 Reviewer 首次返回 findings 开始，上述问题复审与返修过程每完成一轮计数 1 次，无论是否有修改项都计数，不按 finding 数量分别计数，最多执行 3 次；第 3 次结束后 Reviewer 仍有 findings 时，Controller 将未收敛的问题和当前结果返回 Caller 决定。
8. 重复以上过程，直到 Reviewer 不再发现问题；如果当前任务无法继续完成，Controller 将原因和当前结果返回 Caller。

## 返回 Caller

任务完成时，Controller 向 Caller 说明：

- 完成的实现；
- 发生变化的文件；
- 执行过的验证及其结果；
- Reviewer 的审查结果；
- 仍需关注的风险。

任务无法继续时，Controller 返回已经完成的部分、无法继续的原因，以及下一步需要 Caller 决定或补充的内容。

返回 Caller 后，`execute-task` 结束。
