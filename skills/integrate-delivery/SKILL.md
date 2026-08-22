---
name: integrate-delivery
description: Use when `deliver-task` 已返回 `delivered`，用户或上游需要在本地处理固定 commit-range 的集成或 task worktree/branch 收尾。
---

# 集成交付结果

## 第一原则

消费一个已经闭合的 `deliver-task` 结果，形成一个明确的集成或保留结果，然后完成经授权的 workspace 收尾。

- 本 skill 只拥有 delivery 之后的本地 integration boundary，不接管任务实现、返修、规划或远端流程。
- `delivery.json` 和它引用的证据保持只读；集成结果不回写成新的 delivery identity。
- 只有 live `<task-worktree>/.dev-task/` 能提供可重验的 delivery 证明；commits、branch、聊天摘要或
  handoff 文案都不能替代它。
- 原 delivery 只证明 `baseCommit..headCommit`。它不自动证明该范围与目标分支组合后的结果。
- candidate verification 通过后仍要做一次 fresh 的宽视角 General Review；它审查当前完整
  candidate，不把 task diff 或原 Task Review 的范围当作审查边界。
- `commit-range` 选择 `keep` 时，结果包含 live task worktree 与 `.dev-task/`；只保留
  branch/commits 会丢失唯一可重验的 delivery proof，不能报告为完成的 `keep`。
- 用户主 workspace 的 dirty 是合法状态；不得 stash、clean、reset、覆盖或归因这些修改。
- 不新增 `finish.json`、revision、ledger、历史链或集成状态机。完成事实直接在最终结果中返回。

## 输入与授权

接受 live `taskDir`、其中的 `delivery.json` 路径或包含该绝对 `taskDir` 的 `deliver-task` 返回
结果。`taskDir` 必须等于 `<task-worktree>/.dev-task`；只包含等价 commits、branch 或摘要的输入
不足以开始 integration。还需要确定：

- 期望动作：`merge / cherry-pick / keep`；
- merge 或 cherry-pick 的目标仓库与目标分支；
- 是否清理 task worktree；
- 是否删除 task branch。

用户或 caller 已明确给出某项动作时，该动作已获授权，不重复询问。只说“处理这个交付”或“收尾”而未选择动作时，先完成只读预检，再给出一个推荐动作和可选项，等待确认后才改变本地 Git 状态。

以下授权彼此独立：

- 本地 merge 或 cherry-pick；
- 删除 task worktree；
- 删除 task branch。

不得用“已经授权集成”推导出 rebase、强制更新或删除权限。本 skill 不执行 push 或任何远端 side effect；需要远端入口时，在本地结果闭合后另交 provider-specific workflow。

## 只读预检

任何写操作前按顺序完成：

1. 定位对应 `deliver-task` skill，运行：

   ```bash
   node <deliver-task-skill-dir>/scripts/deliver-task.mjs validate-result <taskDir>
   node <deliver-task-skill-dir>/scripts/deliver-task.mjs close-check <taskDir>
   ```

2. 两条命令都必须直接消费 live `.dev-task/`；目录或任一必需证明丢失时停止，不根据现存
   commits、branch、旧输出或聊天摘要补写 locator、恢复证据或推断 `delivered`。
3. 要求 `delivery.json.result == "delivered"`，读取 `task.json`、`delivery.json` 和
   `artifacts/workspace.json`。不要只相信聊天摘要、branch 名或目录名。
4. 解析当前 target，确认所引用的 Git commit objects 仍存在，且 `headCommit` 仍以 `baseCommit` 为祖先。
5. 记录 source 的 task identity、target、workspace 和 branch。`commit-range` 的动作是 `keep`
   时不要求目标分支，直接返回 retained task branch/worktree；即使另有 cleanup 授权，也不删除
   承载 live proof 的 task worktree。
6. merge 或 cherry-pick 时，记录目标分支当前完整 OID `D`，检查目标仓库、目标分支、worktree dirty 和适用的项目指令。只记录 caller workspace 的 dirty，不把它归入 task，也不据此使 delivery stale。
7. merge 或 cherry-pick 时，确认 source 与 destination 属于同一 Git 历史；跨仓复制、补丁传输和 vendor 同步不属于本 skill。

从预检结束到实际移动目标分支前，目标分支必须仍指向 `D`。发生移动时重新检查和推荐，不自动 rebase、merge 新基线或假装旧决策仍有效。

## 按 target 类型路由

| delivery target | 可做动作 | 约束 |
| --- | --- | --- |
| `commit-range` | merge、cherry-pick、keep | `keep` 保留 task branch/worktree/proof；merge 或 cherry-pick 成功后才可经授权 cleanup |
| `no-change` | keep、经授权 cleanup | 没有需要 merge 或 cherry-pick 的业务变化，收口后可经授权 cleanup |
| `worktree` | keep | 未提交 target 没有可移植的 commit identity；不得复制文件、临时打 patch 或删除唯一 workspace |

`worktree` target 需要集成时，返回 upstream：若原 `commitPolicy` 允许，由 `deliver-task` 重新形成 commit-based delivery；若禁止提交，则由用户或 caller 明确选择其它交付方式。本 skill 不擅自改变 commit policy。

## 选择集成策略

| 策略 | 适用条件 | 结果 |
| --- | --- | --- |
| `merge` | 需要保留 source range 的拓扑与 commit identity | 在候选分支合入 `headCommit`，验证和宽视角 General Review 后再推进目标分支 |
| `cherry-pick` | 明确只移植该 range 的线性提交 | 按拓扑顺序重放 `baseCommit..headCommit`，形成新的 commit identity |
| `keep` | 暂不集成、目标 workspace 正在使用或缺少本地写权限 | 保留 task branch/worktree 和固定 range，不改变目标分支 |

range 含 merge commit、依赖 source 拓扑，或 cherry-pick 会改变语义时，不推荐 cherry-pick。用户未指定策略时，根据仓库规则与上述事实推荐，不根据个人偏好替用户选择。

## 隔离地产生候选结果

merge 和 cherry-pick 都先在从目标 OID `D` 创建的临时 isolated integration workspace 中形成候选结果；优先使用运行环境提供的 native workspace capability，否则使用独立 `git worktree`。不要直接在用户正在编辑的 caller workspace 中试做集成。

1. 从 `D` 创建唯一候选分支和 isolated workspace。
2. merge 时引用固定 `headCommit`，不要依赖可能移动或被删除的 source branch 名。
3. cherry-pick 时只选择 `baseCommit..headCommit` 中的 commits，并保持拓扑顺序；遇到 merge commit 或不明确的范围立即停止。
4. 集成后读取原 verification evidence 中的可复现命令，并结合目标分支项目规则运行必要验证。
5. 验证成功后，派一个 fresh General Reviewer，把 isolated integration workspace 中的完整
   candidate 交给它。以本次变更为起点，但不把 task diff、task package 或原 Task Review
   当作范围边界；允许 reviewer 自由检查周边代码和调用链、existing consumers、整体架构和模块
   职责、API / 数据 / 状态契约，以及与已有实现的重复或冲突。
6. reviewer 可以报告当前结果中任何确实存在的问题，不要求 finding 必须由 integration
   造成。发现 finding 时停止集成并直接上报用户；没有 finding 才继续：
   - 本地集成：只有目标 workspace 干净、目标分支仍为 `D` 时，才将目标分支快进到已验证候选 commit；
   - 目标 workspace dirty：不得移动其已检出分支，保留本地候选分支并返回当前事实；不要 stash、覆盖用户修改或自动切换到远端流程。

原 delivery evidence 继续只证明 source range。最终说明必须单独记录候选 commit、目标分支集成前后 OID、本次验证和宽视角 General Review 结果；旧 Task Review 不能替代这次审查。

## 冲突与验证失败

冲突意味着需要新的业务判断，不是机械收尾：

1. 在 isolated integration workspace 中停止操作；不要修改 caller workspace。
2. abort 当前 merge 或 cherry-pick，使候选 workspace 回到 `D`；若无法可靠恢复，保留现场并明确报告，不使用 `reset --hard` 或 force clean 猜测修复。
3. 返回冲突文件、source range、目标 OID 和复现动作。
4. 将冲突解决作为新的 bounded development task 交给 `$deliver-task`；新结果闭合后再重新运行本 skill。

验证失败时同样不得推进目标分支或清理 source。保留候选分支供后续诊断，或在确认它没有唯一成果后做经授权的清理。

## 清理规则

cleanup 是显式授权动作，不是成功集成的自动副作用。

cleanup 授权只表示允许删除，不会改变删除资格：`commit-range + keep` 必须保留 task branch、task
worktree 和其中的 `.dev-task/`。只有 `commit-range` 已成功 merge/cherry-pick，或 `no-change` 已
收口时，才可继续下面的 task worktree cleanup。

经授权删除脚本创建的 task worktree 时，worktree-local `.dev-task/` 会随 worktree 一起消失；
必须先在 live 状态上完成本轮 `validate-result`、`close-check` 和下述 durable ref 检查。不得先删
证明再从 commits 或最终说明倒推收口。`provided` workspace 连同 `.dev-task/` 原样交还 owner，
本 skill 不单独删除其证明目录。

清理 task worktree 前必须同时满足：

- target 是已成功完成 merge/cherry-pick 的 `commit-range`，或已收口的 `no-change`；
- `artifacts/workspace.json.kind == "git-worktree"`；`provided` workspace 交还其 owner；
- worktree 路径来自 locator，已 canonicalize，且与 `git worktree list` 完全匹配；
- worktree 干净，不需要 `--force`；
- delivery 的唯一成果已有本地 durable ref：merge 后可从目标分支到达，cherry-pick 后至少保留原 task branch 或其它指向原 `headCommit` 的 durable ref。

只删除 worktree 时保留 task branch。删除 branch 是另一项授权，并且必须先证明原 `headCommit` 仍可从目标分支或另一明确保留的本地 ref 到达。正常收尾使用安全删除，不使用 `-D`、force-remove、`git clean` 或宽泛路径。

临时 integration worktree 在候选已推进目标分支后可以清理。失败或放弃候选时，只有确认它没有唯一成果且另有清理授权才可删除；否则保留候选 branch。删除候选 branch 也需要独立授权和同样的可达性检查。

## 返回结果

最终只返回以下事实，不创建新的协议文件：

- source task identity 与 `baseCommit..headCommit`；
- 选择的动作及授权来源；
- 目标分支与集成前后完整 OID；
- 候选 commit 或 keep 原因；
- 实际运行的验证及结果；
- 宽视角 General Review 的结果及 findings；
- task/integration worktree 和 branch 分别是 retained 还是 removed；
- 未完成项、冲突或需要 upstream 决定的唯一下一步。

目标分支推进、验证通过且宽视角 General Review 没有 finding 后，才把本地集成报告为完成；如果还授权了 cleanup，必须同时按要求完成 cleanup。`keep` 的完成含义只是稳定交付结果已保留，不表示已经集成。
`commit-range + keep` 返回时 task branch、task worktree 与 live `.dev-task/` 必须都是
`retained`。
