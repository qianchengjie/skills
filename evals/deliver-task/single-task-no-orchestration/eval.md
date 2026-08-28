# Caller-defined Scope Without Orchestration

## Evaluation goal

验证 `deliver-task` 接受 caller 已定义目标、验收和授权边界的开发范围时，只建立
task-owned directory 和交付执行工件，不创建或管理正式多任务计划，也不引入
拆分拷问或执行确认门禁。

本用例不判断实现是否正确、task 工件内容是否充分，也不要求实际修改代码。

## Subject-visible Prompt and inputs

Subject 使用仓库当前 `skills/deliver-task/` package 和一个具有基线提交的独立 Git
仓库。Harness 只注入下面的 Prompt；`<fixture-repo>` 由 harness 替换为该独立仓库的
绝对路径，仓库包含 `src/slug.mjs`、`test/slug.test.mjs` 和可运行的 `npm test`。

```text
这是实际开发任务的 go/no-go 决策，不是流程知识问答。不要修改任何文件，也不要
询问用户；你必须依据当前 skill 直接报告在首次源代码编辑前已经强制发生或仍必须
发生的公开动作。

请完整读取并严格使用当前 deliver-task skill，以及它为本动作要求的引用。任务仓库
是 `<fixture-repo>`。

任务：修复 `src/slug.mjs`，让任意连续空白字符归一为一个连字符；保持现有
`slug(value)` 接口；不新增依赖；只允许改 `src/slug.mjs` 和
`test/slug.test.mjs`；验收为 `npm test`。需求、验收、授权边界均明确，没有产品
决策待确认。这个明确开发任务直接交给当前 deliver-task 处理，commitPolicy 为
allowed。

只输出：在允许首次编辑 `src/slug.mjs` 前，deliver-task 要求创建或更新的正式/临时
工件、必须经过的用户交互门禁、是否创建或管理正式多任务计划，以及此刻能否进入
实现。不要提出改进建议，不要讨论评测标准。
```

## Observable expectations

一次调用应当：

- 只通过 `start <fixture-repo> -` 从 stdin 接收合同，并只使用返回的
  `<workspacePath>/.dev-task/` 下的 `task.json / audits.md / artifacts` 等
  task-owned 工件；
- 明确不创建或管理 `plan.md`、slice、ticket、里程碑或其它正式多任务状态机；
- 不要求拆分拷问、执行确认或其它用户交互门禁；
- 允许在合同校验、上下文预检、brief 和 implementer 派发完成后进入实现。

以下任一公开可观察行为使本次调用失败：

- 创建或要求创建 `dev-plans`、正式切片、P/K/F 或多任务计划状态；
- 因为显式调用 skill 而要求用户选择拷问、批准拆分或确认执行；
- 把 `commitPolicy: allowed` 解释为必须先取得新的 commit 授权；
- 在合同已明确时仍把任务退回 upstream。

## Evaluation boundary

本用例只验证 caller-defined scope 入口没有携带多片 orchestration。它不判断 task contract、preflight、
brief、验证或 review 的语义质量，不要求执行代码，也不验证最终 live handoff。

Evaluator 只依据 subject 的公开回复和公开工具动作判定，不要求、推断或保存隐藏
思考过程。本文件定义一次独立调用，不定义 repetitions、RED/GREEN 编排、重试、
聚合或结果文件格式。
