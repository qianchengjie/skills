# 单任务合同与结果

## 目录角色

```text
<task-worktree>/
├── <业务代码与项目文件>
└── .dev-task/        # taskDir；默认由自身 .gitignore 排除出 Git target
    ├── task.json          # authoritative execution contract；deliver-task 不擅自扩大或弱化
    ├── execution.json     # preflight 后由 deliver-task 创建的当前执行边界
    ├── claims.json        # 声明、证据引用与状态真源
    ├── audits.md          # preflight / validation / review / acceptance / repair 审计真源
    ├── delivery.json      # 薄结果合同
    ├── .gitignore         # 内容固定为 *
    └── artifacts/         # 当前运行定位与可重建 brief/report/target/review package
        └── workspace.json # 绑定当前 task workspace 的本地 locator
```

`taskDir` 固定为 `<task-worktree>/.dev-task`。合同、证据、locator 与业务代码共享同一个
isolated workspace 生命周期；caller workspace 不保存 task state。rules-review run 继续由
`rules-review` 写入自己的协议目录。

## task.json

`schemaVersion = deliver-task.task.v1`，只接受以下字段：

```json
{
  "schemaVersion": "deliver-task.task.v1",
  "taskId": "fix-slug-whitespace",
  "revision": 1,
  "caller": {
    "kind": "delegated",
    "name": "to-tickets",
    "ref": "tickets/ISSUE-123"
  },
  "objective": "一个明确交付目标",
  "acceptanceCriteria": ["可观察验收条件"],
  "constraints": ["调用方约束与已确认公共契约"],
  "nonGoals": ["明确非目标"],
  "forbiddenPaths": ["package-lock.json"],
  "baseCommit": "完整 Git commit OID",
  "commitPolicy": "required",
  "acceptancePolicy": "required"
}
```

约束：

- `taskId` 使用小写连字符 slug；`revision` 从 1 递增。
- `caller` 只允许 `{ "kind": "direct" }` 或
  `{ "kind": "delegated", "name": "<lower-kebab-id>", "ref": "<non-empty>" }`。
- `acceptanceCriteria` 非空；`forbiddenPaths` 只保存用户或 caller 明确禁止的范围。
- 路径是规范化仓库相对路径或 glob；不接受绝对路径和 `..`。
- `commitPolicy` 只允许 `required / allowed / forbidden`。
- `acceptancePolicy` 只允许 `required / not-required`。
- task hash 是完整 `task.json` 的递归 key-sort canonical JSON SHA-256，格式为 `sha256:<hex>`。
- bootstrap 时 caller 只把该对象写入 `start` 的 stdin；`start` 完整校验后才把它写入新建或
  首次绑定 workspace 的 `.dev-task/task.json`。

`task.json` 是 caller 提供给 `deliver-task`、且 implementer 必须直接读取的最高执行合同；它是
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
不反写成 immutable task authority。`taskId`、JSON 结构和固定调用上下文可以机械生成。两个 policy
按 caller 边界构造：

| caller | `commitPolicy / acceptancePolicy` 构造规则 |
| --- | --- |
| direct | 用户明确提出提交或验收要求时，把对应要求归一化为枚举值；某字段已被提及但无法唯一归一化时，向用户澄清，在取得唯一值前不应用 default、不构造可启动合同、不调用 `start`；完全没有明确要求的字段分别固定为 `required / not-required`，不询问用户。 |
| delegated | caller 必须显式提供两个字段；缺少任一个都不应用 direct defaults、不调用 `start`，只回到该 caller 请求补全。 |

direct defaults 只是固定调用策略，不改变 authority-bearing 文本的机械摘录规则；显式要求优先于默认值。
不得根据任务内容、仓库状态或模型判断为 direct 选择其它 policy。

这是 caller 的接口责任，不是 `deliver-task` 能凭空证明的事实。未随合同提供的上游要求不可审查时，
`deliver-task` 只保证 `task.json` 之后的派生输入不再弱化；若执行中从可见上游证据发现
`task.json` 已发生实质降级，则停止当前 lineage，按 `needs-upstream / contract-change` 回流合同修订，
不能靠修正 brief 或返修实现补救。

只有目标、验收、约束、非目标、用户禁止范围、caller、base、commit policy 或
acceptance policy 变化时才递增 revision。执行路径选择和实际验收结果不属于 immutable
task identity。旧 task identity 下的证据不会自动证明新合同；controller 必须重新判断
哪些证据可引用，并在 `audits.md` 留 provenance。

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
  可移植交付 identity，也不形成 workspace revision、历史链或状态机。
- exact identity 且 `.dev-task/` 完整时 `start` 幂等返回，不重写 locator 或其它证据。同 revision
  只改变 task hash 时拒绝，防止绕过 revision 规则静默换合同。
- higher revision 在默认模式建立新的确定性 branch/worktree；provided workspace 已含旧
  identity 时拒绝覆盖，旧状态继续归其 owner。
- branch/worktree 已存在但 `.dev-task/`、locator 或其它初始证明状态缺失、不完整时 fail
  closed；不按 branch 重新发现并补写 locator，也不根据 commits 或摘要恢复证明。
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
  "evidenceRefs": ["audits.md#A1"]
}
```

- caller 不创建或填写 `execution.json`。deliver-task 在已绑定 task workspace 中读取真实
  代码、直接消费者、相关测试、AGENTS/rules 和 Git 状态后创建，并用非空 `evidenceRefs` 指向形成边界的
  task-owned 审计证据。
- `allowedPaths` 非空；两组路径使用与 task 相同的规范化仓库相对格式。
- 有效禁止范围是 `task.forbiddenPaths ∪ execution.forbiddenPaths`；允许范围只读取
  `execution.allowedPaths`。
- 同一授权目标内调整执行范围时，先在 `audits.md` 记录依据，再原地更新
  `execution.json`；不改变 task revision/hash，也不增加 execution revision 或历史链。
- execution hash 是完整 `execution.json` 的递归 key-sort canonical JSON SHA-256。它进入
  target identity；边界变化因此会使旧 target、General binding 和 target-bound
  acceptance 自动失效。

## claims.json

`schemaVersion = deliver-task.claims.v1`：

```json
{
  "schemaVersion": "deliver-task.claims.v1",
  "task": {
    "taskId": "fix-slug-whitespace",
    "revision": 1,
    "taskHash": "sha256:..."
  },
  "claims": [
    {
      "claimId": "C1",
      "statement": "可验证声明",
      "status": "verified",
      "evidenceRefs": ["audits.md#A2"]
    }
  ]
}
```

状态只允许 `proposed / implemented / verified / blocked / waived`。`delivered` 时至少有一个 claim，且全部为 `verified / waived`；两种终态都必须有 evidence refs。机器不判断 statement 或 evidence 是否充分。

## audits.md

按 `### A<正整数>：<标题>` 追加审计。每个条目记录当前 task identity、execution/target、公开结论、证据位置和未闭合项。至少分别记录：

- 上下文预检与项目 rules；
- 验证命令及公开结果；
- 首次 General / Rules Full 的输入 identity、findings 和 verdict；
- 每轮 actual repair delta、targeted / affected validation、双域 scoped 结果、必要的单域 Full 升级和合并 Review Wave；
- 适用的 upstream acceptance；
- rules-review Full run 与 deliver-task-owned Rules Scoped Repair Verification；
- 回流、阻塞和 residual risk。

当 `task.json` 的强约束把具名实现指定为复制或移植的 authoritative source 时，复用同一
`audits.md` 追加两类 task-owned evidence，不新增状态文件或 schema：

- baseline A：当前 task/execution identity、固定 source identity、`source → destination`
  mapping、baseline snapshot identity、controller 在唯一 writer 停止时对 live baseline 的复验结果，
  以及 `accepted / cannot-verify` 结论；
- adaptation authorization A：当前 task/execution identity、baseline A 引用、同一 baseline
  snapshot identity，以及允许 Dispatch B 开始适配的明确结论。

authorization A 是审计证据，不是 task lifecycle state。Dispatch B 必须引用它；controller 接收实现
和记录验证时，也在既有 A 条目或 task report handoff 中引用同一 authorization，形成可恢复的时间链。
snapshot identity 使用与 `commitPolicy` 相容的既有 commit/tree 或 worktree/content snapshot；不得为
provenance 人为创建 commit。

不要在 `delivery.json` 重复这些内容。

首次 General Full A 与最终 clean Review Wave A 都必须包含以下机器绑定块；verdict、findings、package identity 和其它审查内容仍按执行协议记录，不塞进这个块。Rules Full 继续引用 `rules-review` v8 的 TARGET/run identity，不新增 binding / re-anchor 块：

````markdown
```deliver-task-binding
{"task":{"taskId":"fix-slug-whitespace","revision":1,"taskHash":"sha256:..."},"executionHash":"sha256:...","target":{"kind":"no-change","baseCommit":"...","executionHash":"sha256:..."}}
```
````

凡被 Review Wave 的 `general/rules.scopedRef/fullRef` 引用，task-owned A 条目都必须包含恰好一个以下机器绑定块：

````markdown
```deliver-task-review-result
{"task":{"taskId":"fix-slug-whitespace","revision":1,"taskHash":"sha256:..."},"executionHash":"sha256:...","target":{"kind":"no-change","baseCommit":"...","executionHash":"sha256:..."},"domain":"general","mode":"scoped","result":"clean"}
```
````

- `domain` 只允许 `general / rules`，并与引用它的 Review Wave domain 相同；`mode` 只允许 `scoped / full`，并与 ref slot 相同。
- `scoped` 的 `result` 只允许 `clean / findings / cannot-bound`；`full` 只允许 `clean / findings`。该结果必须与 Review Wave 中相邻的 result 字段相同。
- task、execution 和 target 必须绑定产生该结论的当前 review package；不能拿旧 target、另一 domain 或另一 mode 的 A 代替。Rules Full A 继续引用 `rules-review` v8 的 TARGET/run identity；这个 block 只提供 task-owned 结构绑定，不复制或重锚 v8 proof。

每个 repair target 在同一 A 条目写恰好一个合并 Review Wave：

````markdown
```deliver-task-review-wave
{
  "task": {"taskId":"fix-slug-whitespace","revision":1,"taskHash":"sha256:..."},
  "executionHash": "sha256:...",
  "wave": 1,
  "failedWaveCount": 0,
  "previousTarget": {"kind":"commit-range","baseCommit":"...","headCommit":"...","executionHash":"sha256:..."},
  "target": {"kind":"commit-range","baseCommit":"...","headCommit":"...","executionHash":"sha256:..."},
  "repairInputRefs": ["audits.md#A4"],
  "repairDiffRef": "audits.md#A5",
  "validationRefs": ["audits.md#A6"],
  "general": {
    "scopedRef": "audits.md#A7",
    "scopedResult": "clean",
    "fullRef": null,
    "fullResult": null
  },
  "rules": {
    "scopedRef": "audits.md#A8",
    "scopedResult": "clean",
    "fullRef": null,
    "fullResult": null
  },
  "mergedFindingRefs": [],
  "result": "clean"
}
```
````

- `wave` 从 1 连续递增；`failedWaveCount` 是截至本 wave 的累计 failed Review Wave 数。首次 Full discovery 不写这个 block，也不进入计数。前一 wave 已累计 4 次失败时不得再出现下一自动 wave。
- `executionHash` 必须等于本 wave `target.executionHash`。`previousTarget` 是保留其原始 execution identity 的直接前序 target，`target` 是当前 repaired target，二者必须不同；从第二个 wave 起，`previousTarget` 必须完整等于前一 wave 的 `target`。execution 在两轮之间合法变化时，不重写或重锚历史 target。
- 历史 wave 按各自记录的 task、execution 和 target identity 校验；只有最新 wave 必须绑定当前 `execution.json`。因此 `audits.md` 可追加保留 E1 wave，再由 E2 wave 继续同一 task history。
- `repairInputRefs`、`repairDiffRef`、`validationRefs`、domain refs 与 `mergedFindingRefs` 都必须引用当前 Review Wave A 之前已经追加的 task-owned `audits.md#A*`；禁止引用当前 wave 自身或之后的 A。机器只检查引用顺序与结构，不判断 repair input、delta、validation 或 findings 的语义真实性。
- 每个 domain 的 `scopedResult` 只允许 `clean / findings / cannot-bound`。只有 `cannot-bound` 时才必须填写同一 domain 的 `fullRef` 与 `fullResult`；`fullResult` 只允许 `clean / findings`。Full 仍为 cannot-verify / blocked 时不写伪终态 wave，使用现有 non-delivered evidence。另一个已 clean domain 的 Full fields 保持 `null`。active catalog 为空时整个 `rules` 值写字符串 `not-applicable`。
- 两个 domain 的最终结果只要一个是 `findings`，`result` 就是 `failed`、`mergedFindingRefs` 非空，且累计失败只增加 1；两边最终 clean 时 `result=clean`、`mergedFindingRefs=[]` 且失败计数不增加。
- 最终 clean wave A 同时作为 `delivery.evidenceRefs.generalReview`；Rules applicable 时也作为 `rulesReview`，Rules 不适用时后者为 `not-applicable`。`delivery.evidenceRefs.verification` 必须引用该 wave 的 `validationRefs` 之一。该 A 记录当前 target 的直接 closure，不继承或重锚旧 Full proof。
- 旧 `deliver-task-repair-closure` block 不再受支持。

实际验收使用 A 条目，并包含：

````markdown
```deliver-task-acceptance
{"task":{"taskId":"fix-slug-whitespace","revision":1,"taskHash":"sha256:..."},"target":{"kind":"no-change","baseCommit":"...","executionHash":"sha256:..."},"status":"passed","evidenceRefs":["audits.md#A1"]}
```
````

- `status` 只允许 `passed / skipped / rejected`；每条记录的 `evidenceRefs` 非空且必须是
  已存在的 task-owned evidence refs。
- `acceptancePolicy=required` 时，只有绑定当前 task/target 的 `passed / skipped` 才能
  交付；缺失或 stale 时返回 `needs-upstream / user-acceptance`。
- `acceptancePolicy=not-required` 只取消 upstream acceptance gate，不削弱
  `acceptanceCriteria`、任务验证、General Review 或适用的 rules-review。
- `rejected` 且 immutable task contract 未变化时，保持同一 task identity 返修；该
  target 不得再交付。返修形成新 target 后，旧验收证据自动失效。
- 只有反馈改变 immutable task contract 时才创建新 task revision。

## delivery.json

`schemaVersion = deliver-task.delivery.v1`，固定薄结构：

```json
{
  "schemaVersion": "deliver-task.delivery.v1",
  "task": {
    "taskId": "fix-slug-whitespace",
    "revision": 1,
    "taskHash": "sha256:..."
  },
  "result": "delivered",
  "target": {
    "kind": "commit-range",
    "baseCommit": "...",
    "headCommit": "...",
    "executionHash": "sha256:..."
  },
  "evidenceRefs": {
    "claims": "claims.json",
    "verification": "audits.md#A2",
    "generalReview": "audits.md#A4",
    "acceptance": "audits.md#A5",
    "rulesReview": "not-applicable"
  },
  "residualRiskRefs": [],
  "upstreamRequest": null
}
```

`target` 三种形状：

```json
{ "kind": "commit-range", "baseCommit": "...", "headCommit": "...", "executionHash": "sha256:..." }
{ "kind": "worktree", "baseCommit": "...", "snapshotHash": "sha256:...", "executionHash": "sha256:..." }
{ "kind": "no-change", "baseCommit": "...", "executionHash": "sha256:..." }
```

`acceptancePolicy=not-required` 时 `delivery.evidenceRefs.acceptance` 固定为 `null`；
`required` 时引用对应的 acceptance A 条目。

非 `delivered` 仍使用同一固定顶层结构；无 target 写 `null`，尚无证据的 ref 写 `null`，并填写：

```json
{
  "kind": "reslice",
  "summary": "为什么当前合同不是一个交付单元",
  "evidenceRefs": ["audits.md#A1"]
}
```

结果与 request kind：

- `needs-upstream`：`target-change / acceptance-change / contract-change / authorization-change / user-acceptance`；
- `needs-reslice`：固定 `reslice`；
- `blocked`：固定 `blocker`；
- `delivered`：固定 `null`。

三种非 `delivered` 结果的 `upstreamRequest.evidenceRefs` 都至少包含一项，每项必须是
存在的 task-owned evidence ref。机器只检查结构、当前绑定和存在性，不判断回流理由
是否正确。

禁止新增 `changedFiles / verification / generalReview / rulesReview / claims` 等顶层证据副本。目标、证据和风险只能通过固定 target 与 refs 表达。

Review Wave 不改变 `delivery.json` schema。最终 clean wave A 直接绑定当前 target，并由既有 evidence refs 引用；required acceptance 仍必须绑定当前 target，不能从旧 target 继承。

## artifacts

这些文件是当前运行定位或可重建的注意力收束视图，不进入 `delivery.json`：

- `workspace.json`：当前 task workspace 的本地 locator；它是 live `.dev-task/` 证明闭包的一部分，
  丢失时 fail closed，不按 task branch 补写；
- `task-brief.md`：引用 authoritative `task.json` 的派生执行视图；只保存 task/execution identity、
  preflight、已解析路径、claims、验证、selected rules、修复依据和本轮 task-owned evidence 引用
  （条件分支下包括 authorization ref），不把目标、验收或约束转述成可独立覆盖合同的副本；
- `task-report.json`：implementer 的 changed files、验证 handoff、blocked 原因；
- `target.json`：`snapshot-target` 输出；
- `review-package.md`：固定 task、execution、target 三个 identity 的 diff/snapshot、claims、验证和审查说明；
- reviewer prompt / rule repair package。

每次派发前刷新它们；旧 subagent 记忆不是事实源。`task.json > task-brief.md`：brief 与合同冲突，
或其本轮说明会遗漏合同义务时，不能开始修改业务文件。
