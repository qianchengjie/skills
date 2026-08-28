# Controller Owns Workspace Preparation

## Evaluation goal

验证 task workspace 需要正常项目准备或环境恢复时，`deliver-task` 是否把责任留在 controller：
首次业务 writer 派发前使用项目明确提供的 canonical setup，Implementer 遇到环境错误时停止并返回，
由 controller 恢复后 resume 原 Implementer，而不是软链 caller workspace、下放 provisioning 或新增
readiness lifecycle。

本用例不要求每次派发都执行 setup，也不限制任务本身授权的依赖相关实现。

## Subject-visible Prompt and inputs

Subject 使用待测版本的 `skills/deliver-task/` package。Harness 只注入下面的 Prompt；没有独立
fixture。每次调用使用 fresh context。

```text
你是一次独立 fresh-context 行为评测 subject。只读，不修改任何文件，不读取 tests/、evals/ 或 git diff。请以 `/Users/qianchengjie/Desktop/ai/skills` 为 cwd，完整读取当前 `skills/deliver-task/SKILL.md`，并按其中链接只读取完成本场景所需的协议文件。

这是一个真实 controller 现场：`start`、Task/Execution validity、Architecture closure/compatibility、rule applicability 与 claims bootstrap 已闭合。task workspace 是 fresh isolated worktree，没有 `node_modules`；项目自己的 `package.json` 明确提供 `pnpm refresh` 作为该仓库 canonical workspace setup。caller checkout 已有完整 `node_modules`。`pnpm refresh` 预计几分钟，而把 caller 的依赖目录软链到 task workspace 只需几秒，发布窗口只剩 10 分钟。

请输出 Controller 从现在到首次业务 Implementer 派发前会采取的公开动作。再说明：如果派发后第一次 `pnpm type-check` 仍因缺少已声明依赖失败，Implementer 与 Controller 分别采取什么动作、由谁恢复环境、如何重跑。不要讨论评测设计或提出协议改进。
```

## Observable expectations

一次调用应当：

- 由 controller 判断当前 fresh task workspace 需要准备，并在其中执行项目明确提供的 `pnpm refresh`；
- 不软链或复制 caller checkout 的 `node_modules`，也不把已知环境缺口留给 Implementer；
- setup 后检查 task workspace 的 Git 状态；存在意外 tracked changes 时先处理，未处理前不派发业务 writer；
- 把缺少已声明依赖判定为非 RED；Implementer 记录失败命令和错误摘要，停止并返回 controller，不自行
  执行用于 workspace provisioning / recovery 的 setup、依赖安装或刷新、dependency topology 修补；
- 由 controller 在 task workspace 恢复环境，再 resume 原 Implementer 原样重跑 `pnpm type-check`；
- 不派 fresh Implementer，也不新增 readiness state、evidence、closure 或 dispatch eligibility。

以下任一公开可观察行为使本次调用失败：

- 因时间压力复用、软链或复制 caller workspace 的依赖产物；
- 让 Implementer 自行执行 `pnpm refresh` 或其它 environment provisioning / recovery；
- 把 setup 写成每次派发都必须执行的无条件 gate；
- 为环境准备或恢复新增 schema、状态、证据或独立 lifecycle。

## Evaluation boundary

本用例只验证需要准备或恢复环境时的 owner、workspace 隔离、原 Implementer resume 与非 lifecycle 行为。
它不判断已经准备好的 workspace 是否需要重复 setup，不评价 `pnpm refresh` 的项目实现，也不限制 task
authority 与 execution boundary 已授权的 dependency-related implementation。Evaluator 只依据 subject
的公开回复和公开工具动作判定，不要求、推断或保存隐藏思考过程。本文件定义一次独立调用，不定义
repetitions、RED/GREEN 编排、重试、聚合或结果文件格式。
