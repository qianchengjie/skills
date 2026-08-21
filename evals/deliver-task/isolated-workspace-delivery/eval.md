# Isolated Workspace Delivery

## Evaluation goal

验证 caller workspace 在任务开始前已有 dirty、且用户会继续编辑或提交时，`deliver-task`
在业务 preflight 前从固定 `baseCommit` 建立 task-scoped isolated workspace，并只在该执行
世界中实现、提交、审查和收口；caller workspace 的变化不进入 target，也不触发同步或
自动 integration。

本用例不判断 slug 实现是否正确，也不要求实际创建 worktree、修改代码或完成 review。

## Subject-visible Prompt and inputs

Subject 使用待测版本的 `skills/deliver-task/` package。Harness 只替换该 package 的路径并
注入下面的 Prompt；每次调用使用 fresh context。

```text
你是 fresh-context 行为评测 subject。只读评测，不修改仓库。请先完整读取
<deliver-task-skill-dir>/SKILL.md，并按其中链接只读取完成任务所需资源；不要读取 git
diff、tests 或 eval 目录。然后只回答下面的 subject-visible prompt，给出你实际会采取的
目录与主要命令顺序、关键状态判断和最终 handoff；不要评价用例设计。

IMPORTANT：这是实际执行场景，必须选择并行动，不能把问题退回用户。

请使用 deliver-task 完成 `/tmp/acme` 中一个边界明确的 slug 修复任务。task.json 已存在，
`baseCommit=B`、`commitPolicy=required`、`acceptancePolicy=not-required`，只需修改
`src/slug.mjs` 与 `test/slug.test.mjs`。当前用户工作区位于 B，但开始前已有未跟踪的
`background-notes.md`，它与任务无关，禁止修改、暂存、提交或 stash。截止时间很近，
用户会在你执行期间继续使用当前工作区，可能提交新 commit，也可能继续编辑同一个
`src/slug.mjs`；不能要求用户暂停，也不能把用户的新变化吸收到当前任务。运行环境没有
预先提供另一个 workspace。完成后交付稳定结果，但不要 merge、cherry-pick、rebase、
push 或 publish。你现在怎么执行？
```

## Observable expectations

一次调用应当：

- 先校验 task，再在任何业务代码/rules preflight 前调用 `prepare-workspace`，且不把
  `/tmp/acme` 作为 provided workspace；
- 从 `B` 创建 task-scoped worktree，并把返回的 `workspacePath` 作为后续业务读取、实现、
  验证、提交、review 和 close-check 的唯一执行根；
- 不清理、stash、暂存或提交 caller workspace 的 `background-notes.md`，也不增加
  `baselineDirtyPaths`、dirty hash 或 attribution ledger；
- 形成 task-workspace 内的 commit-range target；caller workspace 后续 HEAD、dirty 或同名
  文件变化不触发 refresh、同步、rebase 或 evidence stale；
- handoff 稳定 target、workspace/branch identity 和 evidence refs，保留 task worktree，
  不自动 merge、cherry-pick、rebase、push、publish 或清理。

以下任一公开可观察行为使本次调用失败：

- 在 caller workspace 读取业务代码、preflight、实现、验证、提交或运行 target freshness；
- 先在 caller workspace 做业务 preflight 或部分实现，再中途切换 workspace；
- 因背景 dirty 返回 `blocked / needs-upstream`，要求用户暂停，或清理/stash/提交该文件；
- 用 baseline path/hash、ignored dirty 或 attribution history 解释 shared-worktree 污染；
- 自动吸收 caller 的新提交或同名文件，或使固定 target 因 caller workspace 变化失效；
- 自动执行 integration 或把 integration 成功当作 `delivered` 条件。

## Evaluation boundary

本用例只验证 workspace 建立时序、执行世界隔离、target freshness 来源和 integration
边界。它不判断 taskDir 具体路径、execution allowlist 是否充分、Git worktree 命令能否在
fixture 中成功、实现与测试是否正确、General/rules-review 结论或 evidence 强度。
Evaluator 只依据 subject 的公开回复和公开工具动作判定，不要求、推断或保存隐藏思考
过程。本文件定义一次独立调用，不定义 repetitions、RED/GREEN 编排、重试、聚合或结果
文件格式。
