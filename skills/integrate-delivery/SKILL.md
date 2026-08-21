---
name: integrate-delivery
description: Use when `deliver-task` 已返回 `delivered`，用户或上游需要将固定交付结果 merge、cherry-pick、创建 PR/MR、保留交付分支，或安全清理 task worktree。
---

# 集成交付结果

## 第一原则

消费一个已经闭合的 `deliver-task` 结果，形成一个明确的集成或保留结果，然后完成经授权的 workspace 收尾。

- 本 skill 拥有 delivery 之后的 integration boundary，不接管任务实现、返修、规划或发布流程。
- `delivery.json` 和它引用的证据保持只读；集成结果不回写成新的 delivery identity。
- 原 delivery 只证明 `baseCommit..headCommit`。它不自动证明该范围与目标分支组合后的结果。
- 用户主 workspace 的 dirty 是合法状态；不得 stash、clean、reset、覆盖或归因这些修改。
- 不新增 `finish.json`、revision、ledger、历史链或集成状态机。完成事实直接在最终结果中返回。

## 输入与授权

接受 task directory、`delivery.json` 路径或包含等价定位信息的 `deliver-task` 返回结果。还需要确定：

- 目标仓库与目标分支；
- 期望动作：`merge / cherry-pick / PR/MR / keep`；
- 是否清理 task worktree；
- 是否删除 task branch。

用户或 caller 已明确给出某项动作时，该动作已获授权，不重复询问。只说“处理这个交付”或“收尾”而未选择动作时，先完成只读预检，再给出一个推荐动作和可选项，等待确认后才改变 Git 或远端状态。

以下授权彼此独立：

- 本地 merge 或 cherry-pick；
- push 并创建或更新 PR/MR；
- 删除 task worktree；
- 删除 task branch。

不得用“已经授权集成”推导出 push、发布、强制更新或删除权限。

## 只读预检

任何写操作前按顺序完成：

1. 定位对应 `deliver-task` skill，运行：

   ```bash
   node <deliver-task-skill-dir>/scripts/deliver-task.mjs validate-result <taskDir>
   node <deliver-task-skill-dir>/scripts/deliver-task.mjs close-check <taskDir>
   ```

2. 要求 `delivery.json.result == "delivered"`，读取 `task.json`、`delivery.json` 和 `artifacts/workspace.json`。不要只相信聊天摘要、branch 名或目录名。
3. 解析当前 target，确认所引用的 Git commit objects 仍存在，且 `headCommit` 仍以 `baseCommit` 为祖先。
4. 记录 source 的 task identity、target、workspace、branch，以及目标分支当前完整 OID `D`。
5. 检查目标仓库、目标分支、worktree dirty、上游跟踪关系、保护规则和适用的项目指令。只记录 caller workspace 的 dirty，不把它归入 task，也不据此使 delivery stale。
6. 确认 source 与 destination 属于同一 Git 历史；跨仓复制、补丁传输和 vendor 同步不属于本 skill。

从预检结束到实际移动目标分支前，目标分支必须仍指向 `D`。发生移动时重新检查和推荐，不自动 rebase、merge 新基线或假装旧决策仍有效。

## 按 target 类型路由

| delivery target | 可做动作 | 约束 |
| --- | --- | --- |
| `commit-range` | merge、cherry-pick、PR/MR、keep、经授权 cleanup | 集成只读取固定 commit objects，不读取 caller workspace 的实时文件 |
| `no-change` | keep、经授权 cleanup | 没有需要 merge 或 cherry-pick 的业务变化 |
| `worktree` | keep | 未提交 target 没有可移植的 commit identity；不得复制文件、临时打 patch 或删除唯一 workspace |

`worktree` target 需要集成时，返回 upstream：若原 `commitPolicy` 允许，由 `deliver-task` 重新形成 commit-based delivery；若禁止提交，则由用户或 caller 明确选择其它交付方式。本 skill 不擅自改变 commit policy。

## 选择集成策略

| 策略 | 适用条件 | 结果 |
| --- | --- | --- |
| `merge` | 需要保留 source range 的拓扑与 commit identity | 在候选分支合入 `headCommit`，验证后再推进目标分支 |
| `cherry-pick` | 明确只移植该 range 的线性提交 | 按拓扑顺序重放 `baseCommit..headCommit`，形成新的 commit identity |
| `PR/MR` | 需要远端审查、目标 workspace 正在使用或分支受保护 | 推送已验证候选分支，并交给对应 GitHub/GitLab workflow 创建或更新请求 |
| `keep` | 暂不集成或缺少写权限 | 保留 task branch/worktree 和固定 range，不改变目标分支 |

range 含 merge commit、依赖 source 拓扑，或 cherry-pick 会改变语义时，不推荐 cherry-pick。用户未指定策略时，根据仓库规则与上述事实推荐，不根据个人偏好替用户选择。

## 隔离地产生候选结果

merge、cherry-pick 和 PR/MR 都先在从目标 OID `D` 创建的临时 isolated integration workspace 中形成候选结果；优先使用运行环境提供的 native workspace capability，否则使用独立 `git worktree`。不要直接在用户正在编辑的 caller workspace 中试做集成。

1. 从 `D` 创建唯一候选分支和 isolated workspace。
2. merge 时引用固定 `headCommit`，不要依赖可能移动或被删除的 source branch 名。
3. cherry-pick 时只选择 `baseCommit..headCommit` 中的 commits，并保持拓扑顺序；遇到 merge commit 或不明确的范围立即停止。
4. 集成后读取原 verification evidence 中的可复现命令，并结合目标分支项目规则运行必要验证。
5. 验证成功后：
   - 本地集成：只有目标 workspace 干净、目标分支仍为 `D` 时，才将目标分支快进到已验证候选 commit；
   - PR/MR：明确请求已授权为该请求推送候选分支，再使用对应 provider workflow 创建或更新 PR/MR；
   - 目标 workspace dirty：不得移动其已检出分支，保留候选分支或改走经授权的 PR/MR。

原 delivery evidence 继续只证明 source range。最终说明必须单独记录候选 commit、目标分支集成前后 OID 和本次验证结果，不能把旧 General Review 或 acceptance 描述成对组合结果的重新审查。

## 冲突与验证失败

冲突意味着需要新的业务判断，不是机械收尾：

1. 在 isolated integration workspace 中停止操作；不要修改 caller workspace。
2. abort 当前 merge 或 cherry-pick，使候选 workspace 回到 `D`；若无法可靠恢复，保留现场并明确报告，不使用 `reset --hard` 或 force clean 猜测修复。
3. 返回冲突文件、source range、目标 OID 和复现动作。
4. 将冲突解决作为新的 bounded development task 交给 `$deliver-task`；新结果闭合后再重新运行本 skill。

验证失败时同样不得推进目标分支、创建成功态 PR/MR 或清理 source。保留候选分支供后续诊断，或在确认它没有唯一成果后做经授权的清理。

## 清理规则

cleanup 是显式授权动作，不是成功集成的自动副作用。

清理 task worktree 前必须同时满足：

- target 是 `commit-range` 或 `no-change`；
- `artifacts/workspace.json.kind == "git-worktree"`；`provided` workspace 交还其 owner；
- worktree 路径来自 locator，已 canonicalize，且与 `git worktree list` 完全匹配；
- worktree 干净，不需要 `--force`；
- delivery 的唯一成果已有 durable ref：merge 后可从目标分支到达，PR/MR 后可从已推送候选分支到达，cherry-pick 后至少保留原 task branch 或其它指向原 `headCommit` 的 durable ref。

只删除 worktree 时保留 task branch。删除 branch 是另一项授权，并且必须先证明原 `headCommit` 仍可从目标分支、远端分支或另一明确保留的 ref 到达。正常收尾使用安全删除，不使用 `-D`、force-remove、`git clean` 或宽泛路径。

临时 integration worktree 在候选已推进目标分支或已推送后可以清理；PR/MR 的远端候选 branch 默认保留。不得自动 merge PR/MR、push 其它分支、发布或删除远端 branch。

## 返回结果

最终只返回以下事实，不创建新的协议文件：

- source task identity 与 `baseCommit..headCommit`；
- 选择的动作及授权来源；
- 目标分支与集成前后完整 OID；
- 候选 commit、PR/MR 链接或 keep 原因；
- 实际运行的验证及结果；
- task/integration worktree 和 branch 分别是 retained 还是 removed；
- 未完成项、冲突或需要 upstream 决定的唯一下一步。

只有目标分支推进或 PR/MR 创建成功、验证通过且经授权的 cleanup 已按要求完成，才把相应动作报告为完成。`keep` 的完成含义只是稳定交付结果已保留，不表示已经集成。
