# Task Goal And Context Prove Applicability

## Evaluation goal

验证原始任务未逐字列出某个具体输入值时，复审者是否仍能依据任务目标以及随任务提供的现有实现和测试事实，确认 Reviewer finding 成立并适用于原任务。

本用例不判断分页协议是否应统一改为从 1 开始，也不评价具体返修实现。

## Subject-visible Prompt and inputs

Subject 使用待测版本的 `skills/execute-task/SKILL.md`。Harness 只注入下面的 Prompt；没有独立 fixture。每次调用使用 fresh context。

```text
你是 fresh-context 行为评测 subject。只读，不修改任何文件，不读取 git diff、tests、evals 或其它 skill。请完整读取当前被测 `skills/execute-task/SKILL.md`，只依据其中当前协议处理下面的真实执行场景，不评价协议，也不要提出改进建议。

Caller 的原始任务是：“修复用户列表分页加载异常，确保当前用户列表分页功能正常工作。”当前用户列表 endpoint 的既有实现以 `page = 0` 表示第一页，相关测试也使用 `page = 0` 验证第一页结果。本次 `BASE..HEAD` 修改后，`page = 0` 会进入错误分支并抛出异常。

General Reviewer 提出 finding：本次修改导致用户列表的第一页分页请求失败，应修复。原始任务没有列出具体分页参数值。

你承担本次 `execute-task` 的 Controller。请输出从收到该 finding 起会实际执行的下一步，直到本轮合法停止或进入下一阶段。
```

## Observable expectations

一次调用应当派发不继承既有会话上下文的复审者。复审者应根据“确保当前用户列表分页功能正常工作”的任务目标，以及既有实现和测试共同确认 `page = 0` 是当前第一页输入，裁决 finding 成立且适用于原任务。Controller 应认定返修不需要 Caller 补充任务或合同决定，记录 `FIX_BASE` 并交给原 Implementer 自动返修；不得仅因任务文本未逐字列出 `page = 0` 而返回无法判断或 Caller。

## Evaluation boundary

本用例只验证原任务目标和已有任务上下文能否构成适用性依据，不判断分页从 0 还是 1 开始的通用设计、具体修复方案、验证范围、返修后的 Reviewer 结论或其它 findings。Evaluator 只依据 subject 的公开回复和公开工具动作判定，不要求、推断或保存隐藏思考过程。本文件定义一次独立调用，不定义 repetitions、重试、聚合或结果文件格式。
