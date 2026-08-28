---
name: integrate-delivery
description: Use when `deliver-task` 已返回 `delivered`，用户或上游需要在本地处理固定 commit-range 的集成或 task worktree/branch 收尾。
---

# 集成已交付结果

## 职责

`deliver-task` 证明 delivery 正确；本 skill 只负责把这个已交付结果安全集成到当前 destination，并验证新组合没有失败。

| 责任 | 本 skill 负责的事实 |
| --- | --- |
| integration | 形成并推进 merge candidate，或明确 keep |
| validation | 验证 `delivery + destination` 的组合结果 |
| destination safety | 冻结并复核 destination OID，阻止 drift 上推进 |
| workspace safety | 隔离试合并，保留 dirty / failed 状态，只做安全 cleanup |

Task validation、General / Rules Review、Acceptance、Repair 和 `delivered` closure 都已由
`deliver-task` 完成，本 skill 不重跑、不解释，也不创建第二套 lifecycle。本 skill 只消费上述 closed
source，不读取或判断 Architecture，也不派 Architecture reviewer。

本 skill 只处理本地 Git 状态，不 push，不执行远端 side effect，也不回写 `delivery.json`。

## 输入与动作

接受 live `taskDir`、其中的 `delivery.json` 路径，或包含该绝对 `taskDir` 的 `deliver-task` 返回结果。

写入 Git 前只完成以下预检：

1. 定位对应 `deliver-task` skill，并运行：

   ```bash
   node <deliver-task-skill-dir>/scripts/deliver-task.mjs validate-result <taskDir>
   ```

2. 确认 `delivery.json.result == "delivered"`，读取 target 与 workspace identity。
3. 对 `commit-range` 确认 `baseCommit`、`headCommit` objects 存在，且 `baseCommit` 是 `headCommit` 的祖先。
4. 集成时确认 source 与 destination 属于同一 Git 历史，并读取 destination 的项目指令。

预检不运行 `close-check`，不重读 Review、Acceptance、Rules 或 General 历史，也不读取或判断
Architecture；`validate-result` 通过就是本 skill 对 delivery closure 的输入门禁。

| target | 主动作 |
| --- | --- |
| `commit-range` | `merge` 或 `keep`；未指定时推荐 `merge` |
| `no-change` | `keep`，按授权做安全 cleanup |
| `worktree` | `keep`；需要移植时停止并返回 upstream |

`merge` 是默认推荐，不是默认授权。用户或 caller 已明确选择动作时直接执行；只给出 delivery 而未选择动作时，完成只读预检后推荐 `merge`，等待确认再写入 Git。`merge` 权限不自动包含 source cleanup、rebase、force update 或 branch 删除权限。

`keep` 不需要 destination：保留 source branch/worktree，不形成 candidate，不运行 integration validation，也不 cleanup source。

## merge 主流程

### 1. 冻结 destination

确定目标仓库和分支，读取其当前完整 OID `D`。同时记录该分支所在 workspace 是否 dirty；dirty 不阻止 isolated candidate 形成，但会阻止后续推进。

### 2. 隔离形成 candidate

从 `D` 建立本轮专用的 isolated candidate branch/workspace；优先使用运行环境提供的 native workspace，否则使用独立 `git worktree`。在 candidate 中 merge 固定 `headCommit`，不依赖可移动的 source branch 名，也不在用户 caller workspace 中试合并。

Git conflict 只有在当前代码、destination 项目指令和既有 Git 事实能唯一推出解法时，才可在 candidate
中机械解决并继续；否则立即停止并保留 source 与 isolated 状态，返回冲突路径、固定 source range 和
destination OID，不猜测解决、不分类所需决定，也不改写 source 或在 destination 中重试。

### 3. integration validation

在 candidate 中运行 destination 项目指令要求的必要验证，以及由本次组合风险直接要求的现有验证入口。validation 只回答：

```text
delivery 与当前 destination 组合后是否仍然正常？
```

不重新判断 Task 是否完整，不重跑 Task acceptance，不派 Task、General、Rules 或 Architecture reviewer。
若验证失败，记录失败命令与结果，保留 candidate 和 source，不推进 destination，不 cleanup；只返回失败
事实，不分类其属于 Architecture、需求、公共契约或普通业务问题。

### 4. 复核并推进 destination

validation 通过后重新读取目标分支完整 OID 与其 workspace 状态：

- 仍为 `D` 且 workspace clean：用要求旧值为 `D` 的安全 fast-forward 把目标分支推进到 candidate commit `C`；不 rebase、不 force update。
- 已变为 `D2`：停止；旧 candidate validation 只适用于 `D`，不得复用。保留 candidate/source，不自动 merge 或 rebase 新基线。
- workspace dirty，或 Git 无法安全推进：停止；不 stash、reset、clean、覆盖或归因用户修改。保留已验证 candidate/source，并返回当前事实。

推进后读取 destination 的完整 OID，作为 `destination after`。任何 compare-and-advance 失败都按未推进处理，不清理 candidate/source。

## cherry-pick 异常路径

只有用户明确要求 `cherry-pick` 才进入本路径；推荐动作和 merge 主流程都不把它列为普通备选。

开始前确认 `baseCommit..headCommit` 是语义与拓扑都明确的线性 range。range 含 merge commit、mainline parent 不明确、依赖 source 拓扑或无法唯一确定重放顺序时立即停止；不猜 `-m`、不展平 merge、不试错后回滚。

满足条件时，从 `D` 在 isolated candidate 中按拓扑顺序重放固定 commits，再复用同一套 integration validation、destination drift 和 workspace safety 门禁。接受新 commit identity，但不改写 source delivery。

## workspace safety 与 cleanup

禁止自动 `stash / reset / clean`，禁止 force-remove worktree 或使用 `git branch -D`。

| 状态 | cleanup 结果 |
| --- | --- |
| `keep` | source branch/worktree 全部保留 |
| validation 失败、destination drift 或 destination 无法安全推进 | candidate/source 全部保留 |
| 集成成功，worktree 由本流程拥有且 clean | 按已有 cleanup 授权正常删除 |
| provided / external workspace | 原样保留并交还 owner |
| 任一待清理 worktree dirty | 保留，不 force remove |

branch 只在已获删除授权且普通安全删除成功时删除；安全删除失败就保留。cleanup 不要求 delivery proof、`.dev-task` 或其它 proof artifact 在删除后继续存活，也不建立 durable-ref / proof-survival lifecycle。

本轮创建的 candidate worktree/branch 只有在 destination 已成功推进、它们 clean 且没有唯一未集成成果时才可正常清理；否则保留。source cleanup 与 candidate cleanup 分别按各自 ownership、dirty 状态和授权判断。

## 最终输出

只报告以下集成事实，不输出第二套 delivery closure 状态：

- source target：target 类型；`commit-range` 时为完整 `baseCommit..headCommit`；
- integration action：`merge / keep / cherry-pick` 及 `completed / stopped`；
- destination before / after：完整 OID；不适用时写 `not-applicable`；
- validation result：实际命令与 `passed / failed / not-run`；
- destination drift：`unchanged / drifted / not-checked`，drift 时带 `D2`；
- cleanup / keep：各 source/candidate branch/worktree 的 `removed / retained / not-created`。

停止原因写入对应事实项，例如 validation failure 写在 validation result，dirty workspace 写在 cleanup / keep；不再附加 Review、Acceptance、Architecture binding 或 proof closure 状态。
