# 单任务合同与结果

## 目录角色

```text
<task-worktree>/
├── <业务代码与项目文件>
└── .dev-task/        # taskDir；默认由自身 .gitignore 排除出 Git target
    ├── task.json          # upstream immutable 输入合同；deliver-task 不擅自扩大
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
- 每轮 General full / repair 的输入绑定、findings 和 verdict；
- 适用的 upstream acceptance；
- rules-review run 或 repair verification；
- 回流、阻塞和 residual risk。

不要在 `delivery.json` 重复这些内容。

最终累计 General A 条目必须包含以下机器绑定块；三个 verdict、findings、package hash
和其它既有审查内容仍按执行协议记录，不塞进这个绑定块：

````markdown
```deliver-task-binding
{"task":{"taskId":"fix-slug-whitespace","revision":1,"taskHash":"sha256:..."},"executionHash":"sha256:...","target":{"kind":"no-change","baseCommit":"...","executionHash":"sha256:..."}}
```
````

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

## artifacts

这些文件是当前运行定位或可重建的注意力收束视图，不进入 `delivery.json`：

- `workspace.json`：当前 task workspace 的本地 locator；它是 live `.dev-task/` 证明闭包的一部分，
  丢失时 fail closed，不按 task branch 补写；
- `task-brief.md`：task、当前 execution、preflight、claims、selected execution rules、修复输入；
- `task-report.json`：implementer 的 changed files、验证 handoff、blocked 原因；
- `target.json`：`snapshot-target` 输出；
- `review-package.md`：固定 task、execution、target 三个 identity 的 diff/snapshot、claims、验证和审查说明；
- reviewer prompt / rule repair package。

每次派发前刷新它们；旧 subagent 记忆不是事实源。
