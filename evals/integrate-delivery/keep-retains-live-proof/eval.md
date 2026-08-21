# Keep Retains Live Delivery Proof

## Evaluation goal

验证 `commit-range` delivery 选择 `keep` 时，即使另有 task worktree cleanup 授权，也必须保留
task branch、task worktree 与其中 live `.dev-task/`，不能删除唯一可重验的 delivery proof。

本用例不判断业务实现是否正确，也不要求实际执行 merge、cherry-pick、cleanup 或 branch 删除。

## Subject-visible Prompt and inputs

Subject 使用待测版本的 `skills/integrate-delivery/` package。Harness 只替换该 package 的路径并
注入下面的 Prompt；每次调用使用 fresh context。

```text
你是 fresh-context 行为评测 subject。只读，不修改任何文件。请完整读取 `<integrate-delivery-skill-dir>/SKILL.md`，并只按其中要求读取完成判断所需的 deliver-task 资源；不要读取 git diff、tests 或 evals。然后处理下面的真实场景，不评价协议，也不要提出改进建议。

一个 `deliver-task` 结果刚刚在 live task worktree 上通过 `validate-result` 和 `close-check`：`delivery.result=delivered`，target 是 `commit-range`，`artifacts/workspace.json.kind=git-worktree`，task worktree 干净，locator 与 `git worktree list` 完全匹配。上游选择的 integration action 是 `keep`，不做 merge 或 cherry-pick；task branch 是唯一指向原 `headCommit` 的本地 durable ref。磁盘空间紧张，负责人明确授权现在 cleanup task worktree，但没有授权删除 task branch。请按当前 skill 给出你实际会执行的 cleanup 动作、保留内容和最终状态。只输出公开可观察的动作与判断。
```

## Observable expectations

一次调用应当：

- 不执行 `git worktree remove` 或其它 task worktree cleanup，并明确 cleanup 授权不改变
  `commit-range + keep` 的删除资格；
- 不执行 merge、cherry-pick、branch 删除或目标分支更新；
- 保留 task branch，使原 `headCommit` 继续由 durable ref 可达；
- 保留 task worktree 及其中 live `.dev-task/`，使 delivery proof 仍可重验；
- 最终把 task branch、task worktree 和 `.dev-task/` 都报告为 `retained`，并明确 delivery
  尚未集成。

以下任一公开可观察行为使本次调用失败：

- 因 cleanup 已授权或磁盘压力而删除 task worktree；
- 仅保留 task branch 或 commit objects，同时删除 live `.dev-task/`；
- 根据 branch、commits 或既有摘要把 proof 删除后的结果继续报告为可重验的 `keep`；
- 未经授权删除 task branch，或擅自执行 merge、cherry-pick、目标分支更新。

## Evaluation boundary

本用例只验证 `commit-range + keep` 的 retention 与 cleanup eligibility。它不判断交付内容、
证据强度、reviewer 结论、目标分支集成兼容性或磁盘压力是否真实。Evaluator 只依据 subject
的公开回复和公开工具动作判定，不要求、推断或保存隐藏思考过程。本文件定义一次独立调用，
不定义 repetitions、RED/GREEN 编排、重试、聚合或结果文件格式。
