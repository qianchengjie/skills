# 单任务合同与结果

## 目录角色

```text
<taskDir>/
├── task.json          # upstream 输入合同；deliver-task 不擅自扩大
├── claims.json        # 声明、证据引用与状态真源
├── audits.md          # preflight / validation / review / repair 审计真源
├── delivery.json      # 薄结果合同
├── .gitignore         # 忽略 /artifacts/
└── artifacts/         # 可重建 brief/report/target/review package
```

业务代码继续位于项目原路径。rules-review run 继续由 `rules-review` 写入自己的协议目录。

## task.json

`schemaVersion = deliver-task.task.v1`，只接受以下字段：

```json
{
  "schemaVersion": "deliver-task.task.v1",
  "taskId": "fix-slug-whitespace",
  "revision": 1,
  "caller": {
    "kind": "direct",
    "ref": "可选；sliced-dev caller 时必填"
  },
  "objective": "一个明确交付目标",
  "acceptanceCriteria": ["可观察验收条件"],
  "constraints": ["调用方约束与已确认公共契约"],
  "nonGoals": ["明确非目标"],
  "allowedPaths": ["src/**", "test/**"],
  "forbiddenPaths": ["package-lock.json"],
  "baseCommit": "完整 Git commit OID",
  "commitPolicy": "required",
  "upstreamAcceptance": {
    "status": "not-required"
  }
}
```

约束：

- `taskId` 使用小写连字符 slug；`revision` 从 1 递增。
- `caller.kind` 只允许 `direct / sliced-dev`；`sliced-dev` 必须写 `ref`。
- `acceptanceCriteria` 和 `allowedPaths` 非空。
- 路径是规范化仓库相对路径或 glob；不接受绝对路径和 `..`。
- `commitPolicy` 只允许 `required / allowed / forbidden`。
- `upstreamAcceptance.status` 只允许 `not-required / pending / passed / skipped`；后两者必须带 `evidenceRef`。
- task hash 是完整 `task.json` 的递归 key-sort canonical JSON SHA-256，格式为 `sha256:<hex>`。

upstream 改变合同后递增 revision。旧 task identity 下的证据不会自动证明新合同；controller 必须重新判断哪些证据可引用，并在 `audits.md` 留 provenance。

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

按 `### A<正整数>：<标题>` 追加审计。每个条目记录当前 task identity、输入/target、公开结论、证据位置和未闭合项。至少分别记录：

- 上下文预检与项目 rules；
- 验证命令及公开结果；
- 每轮 General full / repair 的输入绑定、findings 和 verdict；
- 适用的 upstream acceptance；
- rules-review run 或 repair verification；
- 回流、阻塞和 residual risk。

不要在 `delivery.json` 重复这些内容。

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
    "headCommit": "..."
  },
  "evidenceRefs": {
    "claims": "claims.json",
    "verification": "audits.md#A2",
    "generalReview": "audits.md#A4",
    "rulesReview": "not-applicable"
  },
  "residualRiskRefs": [],
  "upstreamRequest": null
}
```

`target` 三种形状：

```json
{ "kind": "commit-range", "baseCommit": "...", "headCommit": "..." }
{ "kind": "worktree", "baseCommit": "...", "snapshotHash": "sha256:..." }
{ "kind": "no-change", "baseCommit": "..." }
```

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

禁止新增 `changedFiles / verification / generalReview / rulesReview / claims` 等顶层证据副本。目标、证据和风险只能通过固定 target 与 refs 表达。

## artifacts

这些文件是可重建的注意力收束视图，不进入 `delivery.json`：

- `task-brief.md`：task、preflight、claims、selected execution rules、修复输入；
- `task-report.json`：implementer 的 changed files、验证 handoff、blocked 原因；
- `target.json`：`snapshot-target` 输出；
- `review-package.md`：固定 target 的 diff/snapshot、claims、验证和审查说明；
- reviewer prompt / rule repair package。

每次派发前刷新它们；旧 subagent 记忆不是事实源。
