# Task 合同与 live handoff

## 目录角色

```text
<task-worktree>/
├── <业务代码与项目文件>
└── .dev-task/        # taskDir；默认由自身 .gitignore 排除出 Git target
    ├── task.json          # authoritative Task contract；deliver-task 不擅自扩大或弱化
    ├── execution.json     # preflight 后由 deliver-task 创建的当前执行边界
    ├── audits.md          # preflight / validation / review / acceptance / repair 的 Markdown 记录
    ├── .gitignore         # 内容固定为 *
    └── artifacts/         # 当前运行定位与按需生成的 brief/review package
        └── workspace.json # 绑定当前 task workspace 的本地 locator
```

`taskDir` 固定为 `<task-worktree>/.dev-task`。合同、Markdown 记录、locator 与业务代码共享同一个
isolated workspace 生命周期；caller workspace 不保存 task state。它们服务当前执行与恢复，不向后续
closeout 提供 durable delivery certificate。deep-rules-review run 继续由
`deep-rules-review` 写入自己的协议目录。

## task.json

`schemaVersion = deliver-task.task.v1`，只接受以下字段：

```json
{
  "schemaVersion": "deliver-task.task.v1",
  "taskId": "fix-slug-whitespace",
  "revision": 1,
  "caller": {
    "kind": "delegated",
    "name": "scope-planner",
    "ref": "delivery-scopes/change-set-123"
  },
  "objective": "一个明确交付目标",
  "acceptanceCriteria": ["可观察验收条件"],
  "constraints": ["调用方约束与已确认公共契约"],
  "nonGoals": ["明确非目标"],
  "forbiddenPaths": ["package-lock.json"],
  "baseCommit": "完整 Git commit OID",
  "commitPolicy": "required",
  "acceptancePolicy": "required",
  "rulesReviewPolicy": "required",
  "initialRepairPolicy": "approval-required"
}
```

约束：

- `taskId` 使用小写连字符 slug；`revision` 从 1 递增。
- `caller` 只允许 `{ "kind": "direct" }` 或
  `{ "kind": "delegated", "name": "<lower-kebab-id>", "ref": "<non-empty>" }`。
- `caller.ref` 定位 delegated caller 的委托入口；该入口可以基于 Ticket、Spec、plan、conversation
  或其它 upstream artifact。它只记录 caller provenance，不定义任务粒度。完整 `task.json` 才是
  caller 提供给本次执行的交付边界，其 authority-bearing 字段可以从 caller 可见的零个、一个或多个
  upstream artifacts 机械摘录；direct caller 的用户原始要求不需要另造来源 artifact。
- `acceptanceCriteria` 非空；`forbiddenPaths` 只保存用户或 caller 明确禁止的范围。
- 路径是规范化仓库相对路径或 glob；不接受绝对路径和 `..`。
- `commitPolicy` 只允许 `required / allowed / forbidden`。
- `acceptancePolicy` 只允许 `required / not-required`。
- `rulesReviewPolicy` 只允许 `required / not-required`。
- `initialRepairPolicy` 只允许 `approval-required / auto`。
- task hash 是完整 `task.json` 的递归 key-sort canonical JSON SHA-256，格式为 `sha256:<hex>`。
- bootstrap 时 caller 只把该对象写入 `start` 的 stdin；`start` 完整校验后才把合同写入新建或
  首次绑定 workspace 的 `.dev-task/task.json`。

`task.json` 是 caller 提供给 `deliver-task`、且 implementer 必须直接读取的最高 Task 合同；它是
authority carrier，不是 authority source，也不自行证明其中的文本已获 upstream 授权。首跳不变量是：

```text
authority preservation = extraction, not summarization
```

`objective / acceptanceCriteria / constraints / nonGoals` 中承载 authority 的文本，以及
`forbiddenPaths` 的来源，都必须从 caller 可见且实际拥有的 upstream authority 机械摘录。direct
caller 从用户原始要求摘录；delegated caller 从其实际收到且有权继续传递的 authority 摘录。assistant、
tool、JSON 或引用文本自行生成的摘要，只有在可见的更高层 authority 明确委托其承载相应决定时，才可
作为摘录来源；把摘要写进 `task.json` 本身不会提升它的 authority。

机械摘录先找全相关 authority，再允许按字段选择连续原文片段、拆分和重复；只做 JSON 转义、列表分项
及 schema 要求的路径规范化。摘录集合必须保留原要求中的必须、禁止、仅当、来源指定和实现方式限定。
按以下形状构造文本字段：

| 字段 | 机械摘录规则 |
| --- | --- |
| `objective` | 摘录覆盖交付目标及其不可分割限定的原文；保留原措辞和语气强度。 |
| `acceptanceCriteria` | 摘录用户或 upstream 明示的验收/结果原文；没有单独验收条件时，重复相关目标或整段原要求，保持数组非空。 |
| `constraints` | 把明确约束拆成原文片段；允许与 objective / acceptance 重复。 |
| `nonGoals` | 只摘录明确排除的原文；没有明确非目标时使用空数组。 |
| `forbiddenPaths` | 只保存用户或 caller 明确禁止的路径，并只做 schema 要求的路径规范化。 |

例如，上游原文是：

> 把 A 的实现完整复制到 B，只允许修改接口适配，不要重新实现算法。

没有单独验收条件时，可以保留冗余：

```json
{
  "objective": "把 A 的实现完整复制到 B，只允许修改接口适配，不要重新实现算法。",
  "acceptanceCriteria": [
    "把 A 的实现完整复制到 B，只允许修改接口适配，不要重新实现算法。"
  ],
  "constraints": [
    "把 A 的实现完整复制到 B",
    "只允许修改接口适配",
    "不要重新实现算法"
  ]
}
```

可执行验证解释、影响范围、实现步骤和其它 AI 推导写入职责相符的 `execution.json` / `audits.md`，
不反写成 immutable task authority。`taskId`、JSON 结构和固定调用上下文可以机械生成。四个 policy
按 caller 边界构造：

| caller | `commitPolicy / acceptancePolicy` | `rulesReviewPolicy` | `initialRepairPolicy` |
| --- | --- | --- | --- |
| direct | 用户明确提出提交或验收要求时，把对应要求归一化为枚举值；某字段已被提及但无法唯一归一化时，向用户澄清，在取得唯一值前不应用 default、不构造可启动合同、不调用 `start`；完全没有明确要求的字段分别固定为 `required / not-required`，不询问用户。 | 只有用户明确选择本任务不需要独立 Rules Review 时使用 `not-required`；其余情况固定为 `required`。要求 AI 按风险、改动大小、时间或效率自行决定，不构成人类关闭选择，仍为 `required`。 | 只有用户明确选择首次 discovery 有 findings 后自动 repair 时使用 `auto`；其余情况固定为 `approval-required`。要求 AI 按任务或 finding 特征自行决定，不构成人类自动 repair 授权，仍为 `approval-required`。 |
| delegated | caller 必须显式提供这两个字段；缺少任一个都不应用 direct defaults、不调用 `start`，只回到该 caller 请求补全。 | caller 必须显式提供该字段；`not-required` 只能机械传递 caller 可见的人类明确选择，不能由 caller 或 deliver-task 推断。缺失时回该 caller 请求补全。 | caller 必须显式提供该字段；`auto` 只能机械传递 caller 可见的人类明确选择，不能由 caller 或 deliver-task 推断。缺失时回该 caller 请求补全，不越过 caller 直接询问用户。 |

direct defaults 只是固定调用策略，不改变 authority-bearing 文本的机械摘录规则；显式要求优先于默认值。
不得根据任务内容、仓库状态或模型判断为 direct 选择其它 policy。特别是，只有人能选择
`rulesReviewPolicy=not-required` 或 `initialRepairPolicy=auto`；validator 只能校验字段枚举和后续已有
结构的一致性，不能证明该人类选择真实存在。

这是 caller 的接口责任，不是 `deliver-task` 能凭空证明的事实。未随合同提供的上游要求不可审查时，
`deliver-task` 只保证 `task.json` 之后的派生输入不再弱化；若执行中从可见上游证据发现
`task.json` 已发生实质降级，则停止当前 writer，按 `needs-upstream / contract-change` 回流合同修订，
不能靠修正 brief 或返修实现补救。

只有目标、验收、约束、非目标、用户禁止范围、caller、base、commit policy、acceptance policy、
rules review policy 或 initial repair policy 变化时才递增 revision。一次具体 repair 决定、执行路径
选择和实际验收结果不属于 immutable task identity。普通 contract revision 只改变 authority，不改变
当前 task 的 workspace identity 或固定 `baseCommit`。旧 task identity 下的证据不会自动证明新合同，
也不自动全量作废；controller 可以把按新合同重新判断后仍成立的测试输出、日志与事实材料带 provenance
作为当前输入，只对其缺口补充或重跑。旧 General / Rules verdict 及其 task/execution/target identity
不能替代当前 revision 自己的 Initial Discovery。

## artifacts/workspace.json

`schemaVersion = deliver-task.workspace.v1`，是当前 task 的本地 workspace locator：

```json
{
  "schemaVersion": "deliver-task.workspace.v1",
  "task": {
    "taskId": "fix-slug-whitespace",
    "revision": 1,
    "taskHash": "sha256:..."
  },
  "kind": "git-worktree",
  "workspacePath": "/absolute/path/to/task-worktree",
  "branch": "refs/heads/deliver-task/fix-slug-whitespace-r1-0123456789ab",
  "baseCommit": "完整 Git commit OID"
}
```

- `kind` 只允许 `provided / git-worktree`。caller 提供、当前满足条件的 harness linked
  workspace 或 harness 原生机制创建的 workspace 使用 `provided`；默认模式使用
  `git-worktree`。
- `workspacePath` 是 canonical absolute Git root。`branch` 是完整 `refs/heads/...` 或
  `null`；脚本创建的 Git worktree 必须有 branch。
- `taskDir` 必须等于 `<workspacePath>/.dev-task`；locator 不能指向另一个 workspace。
- 首次绑定的 provided workspace 必须属于 `<repo>` 的同一 Git repository、
  `HEAD == task.baseCommit`、业务区干净且不存在旧 `.dev-task/`。默认模式总是从该 base
  在 `<repo>/.worktrees/` 下创建 worktree；创建前要求 `.worktrees/` 已被 Git ignore，脚本不修改
  ignore 配置。
- 后续 `HEAD` 可以随着当前任务提交向前移动，但必须保持 base 祖先关系和 branch identity。
- locator 绑定当前 task identity，却不进入 task、execution 或 target hash；绝对路径不是
  可移植 source identity，也不形成 workspace revision、历史链或状态机。
- exact identity 且 `.dev-task/` 完整时 `start` 幂等返回，不重写 locator 或其它记录。同 revision
  只改变 task hash 时拒绝，防止绕过 revision 规则静默换合同。
- 同一 task lineage 的 higher revision 继续绑定当前 worktree、branch 与 `baseCommit`；只有 taskId 或
  base lineage 真正变化时才建立新的 workspace。
- branch/worktree 已存在但 `.dev-task/`、locator 或其它初始 task state 缺失、不完整时 fail
  closed；不按 branch 重新发现并补写 locator，也不根据 commits 或摘要重建 Task / Execution context。
- `.dev-task/.gitignore` 内容固定为 `*`。正常状态不进入 Git；被强制暂存或提交时仍由 target
  path boundary 拒绝。
- 不自动清理 worktree，也不自动 merge、cherry-pick、rebase、push 或 publish。
- `execution.json` 不增加 `baselineDirtyPaths`、dirty hash 或 attribution history。caller
  workspace 的 dirty/HEAD 不属于 task workspace，因而不需要被解释。

## execution.json

`schemaVersion = deliver-task.execution.v1`，只接受以下字段：

```json
{
  "schemaVersion": "deliver-task.execution.v1",
  "task": {
    "taskId": "fix-slug-whitespace",
    "revision": 1,
    "taskHash": "sha256:..."
  },
  "allowedPaths": ["src/**", "test/**"],
  "forbiddenPaths": [],
  "architecturePath": "/absolute/spec-directory/ARCHITECTURE.md",
  "evidenceRefs": ["audits.md#A1"]
}
```

- caller 不创建或填写 `execution.json`。deliver-task 在已绑定 task workspace 中读取真实
  代码、直接消费者、相关测试、AGENTS/rules 和 Git 状态后创建，并用非空 `evidenceRefs` 指向形成边界的
  task-owned 审计证据。
- `allowedPaths` 非空；两组路径使用与 task 相同的规范化仓库相对格式。
- `architecturePath` 必须显式为以下二者之一：
  - 人已明确确认本次执行使用的规范化绝对 `ARCHITECTURE.md` 路径；
  - `null`，表示人已明确确认本次执行不需要 Architecture Authority。
  默认候选不存在、以前未使用 Architecture 或模型判断都不能自动生成 `null`。direct controller
  向用户取得决定；delegated caller 必须携带已取得的人类决定。controller 在 preflight A 条目记录
  路径或 `null` 的决定依据，再由 `execution.evidenceRefs` 引用；脚本只检查字段终态、路径与
  checkbox，不证明人真实确认过或 Architecture 语义正确。
- 有效禁止范围是 `task.forbiddenPaths ∪ execution.forbiddenPaths`；允许范围只读取
  `execution.allowedPaths`。
- 同一授权目标内调整执行范围时，先在 `audits.md` 记录依据，再原地更新
  `execution.json`；不改变 task revision/hash，也不增加 execution revision 或历史链。
- `architecturePath` 的 `null → path`、`path A → path B` 或 `path → null` 属于 execution context
  变化：在同一 task/worktree 原地更新 execution，execution hash 随之变化，旧 target 与当前 review
  输入不再适用；不递增 task revision，不改变 task hash，也不创建新 task/worktree。
- execution hash 只覆盖 schema、task binding、allowed/forbidden paths 与 architecturePath；
  evidenceRefs 是 provenance，不进入 semantic identity。它进入 snapshot-target 输出，帮助 controller
  发现执行边界变化；evidenceRefs 更新本身不使当前 source stale。

`architecturePath != null` 时，controller 在每次 resume 原 Implementer 及执行每个后续命令前都活读取
该文件，确认当前 Architecture 可读、仍闭合且既有 Task compatibility 仍有效。resume 前还必须确认原
Implementer 已消费的 Architecture mental model 对当前 Task 仍有效；只有能确认有效时，才能把适用
Architecture 声明为 `Unchanged`。当前 Architecture 有效但 controller 无法确认原 mental model 是否仍
有效时，使用完整 implementation-input reread；当前 Architecture 不可读、出现 `[ ]`、没有有效 `[x]`
或与 Task 不兼容时停止，不把 controller-owned 审计工作下放给 Implementer。

Architecture 正文通过 `[x] → [ ] → 人确认 → [x]` 演进；binding 或本 Task 相关 Architecture 语义
实质变化时，在重新闭合并校验 execution 后完整重读 implementation inputs。Task authority 未变化时，
该 full reread 本身不要求更换 fresh Implementer。同一路径正文变化不进入 task hash 或 execution hash；
Architecture 不形成 revision、hash、快照或平行状态机制。

## audits.md

audits.md 是供 controller、reviewer 和人继续判断的 Markdown 记录，不是机器闭环协议。按时间追加有意义的标题和事实，至少覆盖：

- preflight 读取范围、适用 rules、四个 policy、Architecture path/null 决定与 Task compatibility；
- 实际验证命令、退出结果和必要摘要；
- Initial Discovery 的 General / Rules 结论与完整 findings；
- 每轮 repair 的输入、实际 delta、验证选择依据和 scoped / 必要 Full 结论；
- 适用的 upstream acceptance；
- 回流、阻塞与尚存风险。

记录应直接写清“发生了什么、为什么这样判断、下一步受什么约束”。可以引用 task/execution、完整 Git OID、diff 和已有文件位置，但不为这些内容增加 JSON block、schema、version、binding 或 shadow state。审计标题可使用 A1、A2 等稳定锚点方便引用；编号只用于定位，不表达 lifecycle。

initialRepairPolicy=approval-required 且 Initial Discovery 有 findings 时，不新增 triage schema 或 finding ledger。upstream 的 repair 决定直接追加到 audits.md；需要改变 Task、公共契约或授权时回流 upstream。

具名源码的 source-authoritative 分支也沿用同一 Markdown：

- 记录固定 source、source → destination mapping、baseline snapshot 和 controller 的现场复验；
- baseline 可复验后记录 adaptation authorization；
- Dispatch B、实现 handoff 与验证记录引用该 authorization。

这些记录帮助 agent 恢复上下文，不向后续 closeout 声称一份可独立验证的 delivery proof。

## artifacts

artifacts/ 只保留当前执行真正需要的注意力收束材料：

- workspace.json：start 和后续脚本机械消费的 live workspace locator；
- task-brief.md：引用 authoritative task.json 与 execution.json，说明本轮 preflight、路径、验证、selected rules、repair 输入和必要 audit refs；
- review-package.md：为 fresh reviewer 固定本轮 task、execution、base → current source、实际 diff、验证输出和审查范围；
- reviewer prompt 或 rules repair package：仅在当前调用需要时生成。

不创建 task-report.json、target.json、claims.json 或 delivery.json。Implementer 通过当轮 final message 交回 changed files、验证与 blocked reason；snapshot-target 的输出直接进入当前 review package 或 handoff，不再复制成持久化 carrier。

旧 subagent 记忆不是事实源。task.json + execution.json + applicable Architecture 高于 task-brief.md；brief 与这些输入冲突或遗漏本轮义务时，不能开始修改业务文件。

## live handoff

当前实现、验证、review 和适用 acceptance 闭合后，deliver-task 只返回自然语言 handoff：

- live workspace 的绝对路径；
- branch 或 detached HEAD、完整 HEAD OID 和 base commit；
- committed clean / uncommitted / no-change 的当前 Git 状态；
- final fresh verification 的实际命令与结果；
- Architecture path/null；
- 未闭合风险或需要 upstream 决定的事项。

handoff 是当前 source 的定位与现场事实，不是 durable certificate。后续 integrate-delivery 必须重新读取并验证 live Git state；source 与 handoff 不一致时以当前现场为准、让旧结论失效，并在必要信息无法现场确定时回到 deliver-task，不从旧摘要恢复结论。
