# 切片开发 · audits.md 文件

本文只描述目录化完整档中的 `audits.md`。

## 职责

`audits.md` 只承载长证据、审计矩阵、diff inventory、跨文件事实清单。短证据直接写进 `decisions.md` 的 `证据` 字段，不创建 `A*`。

审计正文可以记录代码证据、调用链、对照矩阵、命令输出摘要和事实清单。若需要写“结论”，只能写会约束后续执行的稳定判断，例如“旧实现无该入口副作用，因此本片不迁移该行为”。

## ID

`A*` 只使用全局顺序编号：

```text
A1
A2
A27
```

不要在标题 ID 中写 owner，例如不要使用 `A-D27`、`A-S2.1.4` 或 `A-S4.2-HEADER`。审计与切片 / 分叉的关系只写在 `关联` 字段。

标题必须以 ID 开头：

```markdown
### A27：历史 multiShop 防御代码审计
```

除 `### A*：...` 审计块标题外，`audits.md` 不允许出现其他二级或三级标题；审计正文内部小节从四级标题开始。

## 模板

```markdown
# 审计记录

暂无长证据。
```

新增审计：

```markdown
### A27：<审计标题>

- 状态：active
- 关联：S2.1.4 / D27

<长证据、矩阵或清单>
```

项目规则审查为 `required` 时，controller 为当前最终 run 新建一个 `done` A*，不要覆盖旧 A*：

```markdown
### A28：S2 当前项目规则审查结论

- 状态：done
- 关联：S2
- selectedRuleIds: CORE-001, TEST-002
- rulesReviewRunId: <当前 plan 选择的 runId>
- validation: <rules-review validate command> => passed
- recommendation: <rules-review recommendation>
- shouldSetHash: <仅 should_review_before_merge 时存在>
- issueSummary:
  - mustFix: <非负整数>
  - shouldFix: <非负整数>
  - cannotVerify: <非负整数>
- verdict: <passed / failed / cannot-verify-from-package>
- severity: <critical / major / minor / not-applicable>
- summary: <非占位摘要>
```

`rulesReviewRunId`、recommendation、三个计数和条件性 `shouldSetHash` 必须来自同一 rule-reviewer fixed summary；A* 的 validation 只展示命令，`close-check` 不执行它，而会重验 plan 选择的真实 run。默认 SHOULD 被用户整组接受时，A* 仍保留 `failed` 和原始 severity；只改变第四 verdict。部分修复或重跑必须使用新 runId 和新 A*。

## 状态

`A*` 只允许：

- `pending`：预计需要审计，但还未完成。
- `active`：正在审计，或当前切片/分叉依赖该证据。
- `done`：审计已完成，可供引用。

## 字段规则

- 每个 A 块必须有 `状态` 和 `关联`。
- 这里的 `关联` 指 A 正文块内的人读上下文字段，只检查字段存在，不校验其中的 S/D 是否存在。`plan.md` 的切片 `关联项` 是另一字段，必须校验 ID 存在和状态一致。
- A 块不强制固定小节；可以是表格、清单、对照或文字证据。

## 维护规则

- 只有长证据才创建 `A*`。
- `plan.md` 的切片 `关联项` 可以引用与该切片直接相关的 A。
- `decisions.md` 的 `证据` 字段可以引用支撑该分叉的 A。
- A 块不是操作日志；过程流水、会话问答、门禁推进动作和普通验证时序不写入 A，必要时放切片验证摘要、门禁记录或会话回复。
- 不扫描 A 正文里的 S/D 引用，不维护反链索引。
