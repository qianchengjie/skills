# 切片开发 · audits.md 文件

本文只描述目录化完整档中的 `audits.md`。

## 职责

`audits.md` 承载长证据、审计矩阵、跨文件事实，以及每轮 General Review 和项目规则审查的结构化投影。普通过程日志不进入 A*。

## ID 与状态

- A* 使用全局顺序编号，例如 `A1`、`A27`；标题必须为 `### A27：<标题>`。
- 不在 ID 中编码 owner、切片或层级。
- 状态只允许 `pending / active / done`。
- 每个 A* 必须有 `状态` 和 `关联`；General Review 当前 A* 还必须以 `done` 进入对应切片的 `关联项`。

## General Review v4

每轮都新建 A*，物化本轮完整 `openFindings`，只通过 `previousReview` 引用直接上一轮。A* 不继承或复用更早结果。

共同字段：

```markdown
### A28：S2 General Review

- 状态：done
- 关联：S2
- reviewType：full
- previousReview：无
- baseCommit：<commit oid>
- previousHeadCommit：<本轮开始时的 commit oid>
- headCommit：<本轮结束时的 commit oid>
- reviewPackageHash：sha256:<64 位小写十六进制>
```

这些 commit 字段原样来自 Review Range v2。首次 full 使用 `baseCommit..headCommit`；repair 使用 `previousHeadCommit..headCommit`；repair 后最终 full 与直接前序 repair 保持相同 commit 三元组，通过 `reviewType` 和 `previousReview` 区分阶段。

### full

首次和最终累计审查都使用 `full`。它完整审查 `BASE → TARGET`，必须返回三个 verdict 和当前完整 `openFindings`：

```markdown
#### General Review 结论

| Verdict | Status | Severity | Evidence | Note |
| --- | --- | --- | --- | --- |
| 需求符合性 | passed | not-applicable | review-package / Claims | 需求证据充足 |
| 切片边界 / 交接一致性 | passed | not-applicable | review-package / 本轮修复索引 | 边界与交接一致 |
| 代码质量 / AI 污染检查 | passed | not-applicable | review-package / Git Diff | 未发现问题 |

#### openFindings

| Finding | Verdict | Severity | Origin | Evidence | Summary |
| --- | --- | --- | --- | --- | --- |
```

如果首次 full 没有进入 repair，它同时就是最终 full。发生过 repair 后，最终三个 verdict 只能来自 repair 之后的新累计 full；最终 full 发现问题时重新进入 repair。

### repair

repair 只审直接上一轮全部 open finding 和 `previousHeadCommit → headCommit` fix diff，不输出也不继承三个 verdict：

```markdown
#### Finding Results

| Finding | Status | Evidence |
| --- | --- | --- |
| G1 | addressed | Git Diff / focused test |
| G2 | not_addressed | 当前验证仍失败 |

#### openFindings

| Finding | Verdict | Severity | Origin | Evidence | Summary |
| --- | --- | --- | --- | --- | --- |
| G2 | 需求符合性 | major | initial | focused test | 问题仍存在 |
| G3 | 代码质量 / AI 污染检查 | minor | repair-delta | Git Diff | fix diff 新引入问题 |
```

每个直接前序 finding 必须恰好出现一次 `addressed / not_addressed`。当前 `openFindings` 必须机械等于：旧 finding 中的 `not_addressed` 加 fix diff 新引入 finding；新 finding 使用 `repair-delta`。

`G*` 在切片内稳定递增。`Verdict` 只能是三个 General Review verdict；`Severity` 只能是 `critical / major / minor`；`Origin` 只能是 `initial / repair-delta / late-discovered`。

## 项目规则审查 A*

每个 TARGET 使用全新 rules-review v4 run。A* 只投影当前 run 的 fixed summary，不保存旧 run 继承关系：

```markdown
### A29：S2 当前项目规则审查结论

- 状态：done
- 关联：S2
- selectedRuleIds: CORE-001, TEST-002
- rulesReviewRunId: <当前 TARGET 的 runId>
- validation: <rules-review validate command> => passed
- recommendation: <recommendation>
- shouldSetHash: <仅 should_review_before_merge 时存在>
- rulesReviewReport: <非 ready_for_merge 时为 .rules-review-tmp/<runId>/response.md>
- issueSummary:
  - mustFix: <非负整数>
  - shouldFix: <非负整数>
  - cannotVerify: <非负整数>
- verdict: <passed / failed / cannot-verify-from-package>
- severity: <critical / major / minor / not-applicable>
- summary: <非占位摘要>
```

## 校验边界

脚本只检查字段、枚举、直接引用、package hash、commit 父子关系、文件集合、finding 集合机械演进和终态闭合。脚本不判断 BASE 选择是否合理、finding 是否正确、证据是否充分或严重度是否恰当；这些由 controller / reviewer 负责并留下证据。

## 维护规则

- 除 General Review 快照和项目规则审查投影外，只有长证据才创建 A*。
- A* 不是操作日志；会话问答、门禁推进和普通命令时序放在切片记录或会话回复中。
- `plan.md` 当前前三个 verdict 只引用最终 full A*；repair A* 不能提供最终 verdict。
