# 单任务执行与保证规则

## 上下文预检

实现前读取 task、项目入口、直接消费者、相关测试、适用 AGENTS/rules 和当前 Git 状态。在 `audits.md` 明确：

- 需要理解与已读上下文；
- 允许修改、禁止修改、非目标、停止条件；
- active rule catalog、execution-time selected / not-applicable 分类及理由；
- `commitPolicy`、baseCommit、caller 和 upstream acceptance；
- 当前内容是一个交付单元，或应回流的证据。

路径和文件名只产生候选规则分类。读完必读代码并针对触发条件 focused search 后，才能闭合 execution-time 分类；无法用代码证据排除的候选归入 selected。selected rules 进入 task brief 和实现约束，但不替代最终 rules-review 的独立分类。

## 实现派发

controller 在 `artifacts/task-brief.md` 投影当前 task identity、目标、验收、约束、preflight、claims、selected rules、允许/禁止路径和本轮修复依据。随后创建默认 blocked 的 task report，再派发 implementer。

实现返回后逐项核对：

- changed files 与真实 staged/unstaged/untracked 路径一致；
- 全部业务变化属于 allowedPaths 且不命中 forbiddenPaths；
- 不修改 task durable state、caller state 或已有无关改动；
- task report 的验证结果可复验；
- claims 只按当前证据推进，不提前写下游通过。

接收门禁失败时先记录依据。实际 diff 已越界时不得回填 allowedPaths 使本轮通过；若扩边仍在原目标/验收/公共契约/授权内，可由 controller 记录并以新 task revision 重新进入；否则 `needs-upstream`。

## 验证与 target

执行 task 指定验证及由变更直接触发的 focused lint/type/test/build。每条命令、状态、摘要和证据写 `audits.md`；不得把一条 `validate passed` 当作语义正确或整体收口。

按 commitPolicy 固定 target：

- `required`：controller 只 stage task report 与真实 task-owned 业务文件精确对应的路径，确认无未暂存残余、额外 staged、rename 逃逸或基线重叠后，创建普通业务 commit；返修追加 commit，不重写旧提交。
- `allowed`：选择 commit 时执行同一边界；不提交时保留完整 worktree snapshot。
- `forbidden`：保持 `HEAD == baseCommit`，不创建 commit。
- 无业务变化不创建空 commit，使用 `no-change`。

task directory 的 durable/generated artifacts 不能混入业务 commit range。`snapshot-target` 只检查确定性的 Git identity、路径边界和内容 hash，不判断业务正确性。

## General Review

General reviewer 独立于 implementer，只消费当前 review package 和其中具名的 fixed target。协议保持现有单片语义：

1. 首次 `full` 审查 `base → current target`，给出需求符合性、任务边界/交付一致性、代码质量/AI 污染三个 verdict 和完整 open findings。
2. 有 finding 时，implementer 返修并重新验证、固定新 target；`repair` 只裁决直接前序 finding 和 repair delta 新 finding，不继承最终三个 verdict。
3. repair 后开放集合清零也不能收口；必须对最终 target 再做累计 `full`。最终三个 verdict 只来自这轮。
4. 最终 full 新发现 finding 时重新进入 repair；不得用另一个 fresh reviewer 洗掉结构合法负结论。

每轮在 `audits.md` 记录 review type、直接前序 A、task identity、target identity、package hash、verdict、finding dispositions 和完整 open set。机器只校验这些字段被显式记录和引用，不判断 reviewer 是否正确。

## Upstream acceptance

General clean 后读取 `task.upstreamAcceptance.status`：

- `not-required / passed / skipped`：按合同继续；
- `pending`：写 `needs-upstream / user-acceptance` 并停止。

直接用户拒收但不改变目标、验收、公共契约或授权时，记录反馈、递增 task revision、返修并重新执行累计 General full。反馈改变上述边界时返回对应 `needs-upstream`，不能直接修。

## 最终 rules-review

首版只迁移 owner，不改变现有单片 rules-review 适用规则、触发条件、审查深度、recommendation 或 verdict 语义：

- active catalog 真实为空时记录 `not-applicable`，不创建 run；
- catalog 非空时，在最终累计 General clean 且 upstream acceptance 满足后，使用 `rules-review` 对完整当前 target 独立分类和 full review；
- execution-time selected rules 只约束实现，不是最终审查范围；最终 reviewer 不从它们继承 selected/not-applicable；
- commit target 使用完整 `baseCommit..headCommit`，不排除文件；每个新 TARGET 默认创建 fresh run，不继承旧结果；
- `ready_for_merge` 才是 clean；`must_fix_before_merge / should_review_before_merge` 产生 finding，`manual_verification_required / review_incomplete / review_blocked` 产生 cannot-verify/blocked；
- 默认 SHOULD 整组接受与“零已知缺陷收口”继续使用当前语义，不在本 skill 重新定义风险等级或压缩审查深度。

规则 finding 只向前进入 task repair，不回写历史 preflight。新 target 先重新取得累计 General clean，再执行 fresh full；只有当前 `sliced-dev` 单片协议原本允许的“直接前序 full + 当前一跳 repair verification”条件全部成立时才可使用该组合，不能递归继承或把 verification 冒充 full run。

`rules-review` 当前只接受 commit TARGET。若 `allowed` 选择未提交或 `forbidden`，且 active catalog 非空导致必要 rules-review 无法运行，返回 `needs-upstream / authorization-change`；不擅自提交、不把规则审查标为 not-applicable。

## 返修与阻塞

每轮返修先把验证、General、upstream feedback 或 rules-review 的失败依据写入 audits，再刷新 brief/report。最多 4 次实际业务修改。以下情况停止：

- 多个独立工作单元：`needs-reslice`；
- 目标、验收、公共契约、授权或用户判断变化：`needs-upstream`；
- 现有合同内持续环境/工具失败或修复次数用尽：`blocked`。

停止不是丢弃证据。写薄 delivery result，target 可为当前已固定 target 或 `null`，evidence refs 指向现有 claims/audits/run。

## 收口门禁

`delivered` 必须同时满足：

- delivery 与当前 task revision/hash 绑定；
- target 符合 commitPolicy，且当前 Git 状态仍与 target 一致；
- 至少一个 claim，全部 `verified / waived` 且有 evidence refs；
- 验证、最终 General、适用 acceptance 和最终 rules-review 都有明确终态与引用；
- residual risks 只用 refs，不在 delivery 内复制正文；
- 没有 caller lifecycle 写入。

`close-check` 只检查机器可判定的闭包，不判断 claim 真实性、测试充分性、finding 正确性、规则适用性或用户确认真实性。
