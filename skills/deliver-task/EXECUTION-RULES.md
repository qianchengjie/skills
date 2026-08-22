# 单任务执行与保证规则

## Workspace 建立

caller 或 direct controller 先形成结构化 immutable task contract，不在 caller workspace
落盘状态。在读取任何业务代码、项目规则或执行 preflight 之前，依次选择 caller 已提供的
isolated workspace、满足 base/clean/task-owned 条件的当前 harness linked worktree、harness
原生 workspace；命中后把路径作为 `--workspace` 显式绑定。三者都不适用时才使用默认模式。

无论 workspace 来源如何，都把合同通过 stdin 交给唯一
`start <repo> - [--workspace <workspacePath>]` bootstrap，不调用其它入口。`start` 先校验 exact
schema、完整 `baseCommit`、repo 和 provided workspace，再原子初始化
`<task-worktree>/.dev-task/`。只有命令返回的 `workspacePath` 是本任务的业务执行根目录，返回的
`taskDir` 是后续证明状态入口。不得绕过可用的 harness 原生机制；没有可绑定的宿主 workspace
时，默认模式才从 base 在 `<repo>/.worktrees/` 下创建 worktree。创建前要求 `.worktrees/` 已被
Git ignore；脚本不修改 ignore 配置，未命中时 fail closed。

exact identity 且 `.dev-task/` 完整时幂等返回，不重写证据。同 revision 合同漂移、已有
branch/worktree 但证明缺失或不完整、provided workspace 已有旧 identity 时 fail closed；不能从
commits、branch、聊天摘要或外部 registry 恢复证明。higher revision 的默认模式从同一 base
建立新 branch/worktree。

task workspace 建立后使用 snapshot-at-start 语义：caller workspace 后续出现 dirty、修改
同一逻辑文件、产生新 commit 或切换分支，都不改变当前 base、execution、target 或已有
evidence。不得在执行中自动 refresh base、同步文件、rebase、merge 或切回 caller workspace
读取“更新版本”。upstream 明确要求吸收新基线时，按 immutable task contract change 回流，
不能偷偷更新当前任务。

## 上下文预检

在 task workspace 中读取项目入口、直接消费者、相关测试、适用 AGENTS/rules 和该 workspace
的 Git 状态。在 `audits.md` 明确：

- 需要理解与已读上下文；
- deliver-task 拟定的允许修改、执行禁止范围、task 用户禁止范围、非目标、停止条件；
- active rule catalog、execution-time selected / not-applicable 分类及理由；
- `commitPolicy`、`acceptancePolicy`、baseCommit 和 caller；
- 当前内容是一个交付单元，或应回流的证据。

路径和文件名只产生候选规则分类。读完必读代码并针对触发条件 focused search 后，才能闭合 execution-time 分类；无法用代码证据排除的候选归入 selected。selected rules 的可执行义务必须先进入现有验证、claims / evidence 要求和 task brief，冲突解决后才可结束 preflight；不能把 implementer 后续读取规则当作替代。不要为此新建平行义务状态机，也不要在 task 工件中复制规则正文。execution-time selected rules 不替代最终 rules-review 的独立分类。

preflight 依据写入 `audits.md` 后，由 controller 创建当前 `execution.json`；caller 和 implementer 都不填写。用户没有提供文件清单时，controller 仍应根据真实代码、直接消费者、相邻测试和项目规则建立最小完整 allowlist。`execution.evidenceRefs` 引用本次判断依据，并运行 `validate-execution` 后才生成 brief。

controller 同时直接阅读 `task.json` 的完整语义，判断它是否以强制复制、移植或等价方式把具名实现指定为 authoritative source。该判断属于合同解释，由 controller 结合目标、验收、约束和代码上下文负责；不得用 `must / copy / reuse` 等关键词扫描器代替。没有命中时继续普通单次派发，不能要求普通任务携带 mapping、snapshot 或 authorization。

## 实现派发

controller 在 `artifacts/task-brief.md` 只收束当前 task/execution identity、preflight、已解析路径、claims、验证、selected rules、本轮修复依据与 task-owned evidence 引用，并引用 authoritative `task.json`；不把目标、验收或约束重新摘要成可独立执行的合同副本。随后创建默认 blocked 的 task report，再派发 implementer。

每次 fresh 或 follow-up 派发都提供绝对 `taskDir` 与 `workspacePath`，要求 implementer 重新读取当前 `task.json`、`execution.json` 和 `artifacts/task-brief.md`。优先级固定为 `task.json > task-brief.md`；brief 冲突或本轮说明会遗漏合同义务时，implementer 必须在修改业务文件前 blocked 回 controller。仅 brief 投影错误时，controller 在同一 task identity 下修正并重新派发；若可见上游 authority 表明 `task.json` 已被弱化，则停止当前执行，按 `needs-upstream / contract-change` 回流，不能把它伪装成 brief 修复。

需要新增业务取舍或返修约束时，先写回现有 task / execution / claims / audits 中职责相符的真源并重新生成 brief。`followup_task.message` 只携带 task directory 定位、三个必读输入的路径和本轮 task-owned evidence 引用，不携带目标、约束、实现取舍或第二份返修说明。

### Source-authoritative 条件分支

命中具名源码强约束时，controller 必须建立真实阶段边界：

1. 固定 source identity 和完整 `source → destination` mapping，并把它们作为 Dispatch A 输入。
2. Dispatch A 只建立 source-equivalent baseline，完成即停止；不得 adaptation，也不得把 task report 标为 `ready-for-review`。controller 等唯一业务 writer 停止后，才独立复验 live source、destination、mapping 与 baseline snapshot。
3. controller 在 `audits.md` 追加 baseline A，记录当前 task/execution identity、固定 source identity、mapping、baseline snapshot identity、复验事实与 `accepted / cannot-verify`。implementer 的报告或“曾经比较一致”自述不能替代 live 复验。
4. 只有 baseline A 为 `accepted` 且 live snapshot 仍匹配时，controller 才另行追加 adaptation authorization A，绑定当前 task/execution、baseline A 及其 snapshot，并明确允许 Dispatch B 开始适配。该 A 条目是 task-owned 审计证据，不是 lifecycle state。
5. controller 刷新 brief，使其明确引用 authorization A；Dispatch B 也必须引用该 authorization，并要求 implementer 重读三个输入。缺少 baseline A、缺少 authorization A 或 Dispatch B 未引用 authorization 时，都不得开始 adaptation。
6. controller 接收 Dispatch B 结果时，在既有实现接收或验证 A 条目中引用同一 authorization；task report 的现有验证 handoff 也引用它。由此持久化 `baseline accepted → adaptation authorized → Dispatch B → implementation/validation` 的顺序，不依赖聊天消息或会被覆盖的旧 brief。

baseline snapshot identity 使用与 `commitPolicy` 相容的既有 commit/tree 或 worktree/content snapshot；不得为了 provenance 创建 commit。若 baseline snapshot identity、固定 source identity、mapping 或 execution binding 被替换、重建或失配，旧 authorization 失效，必须先重新建立 accepted baseline 与 authorization。授权后的正常 destination adaptation 不视为 baseline 变化；相同绑定下的适配和返修继续引用原 authorization。

baseline `cannot-verify` 时不创建 authorization，也不派发 Dispatch B。合同或 source identity 不足按现有 `needs-upstream` 处理；现有合同内的环境或工具故障持续且不可恢复时按 `blocked` 处理。

实现返回后逐项核对：

- changed files 与真实 staged/unstaged/untracked 路径一致；
- 全部业务变化属于 `execution.allowedPaths`，且不命中 `task.forbiddenPaths ∪ execution.forbiddenPaths`；
- 不修改 `.dev-task/` durable state、caller state 或 task workspace 之外的文件；
- task report 的验证结果可复验；
- claims 只按当前证据推进，不提前写下游通过。

接收门禁失败时先记录依据。实际 diff 已越界时不得事后回填 allowlist 使该轮通过。若所需扩边仍在 immutable task contract 内，controller 先记录原因、更新 `execution.json`、重新校验并重新派发；不创建新 task revision。命中 task 用户禁止范围或要求改变 immutable task contract 时才 `needs-upstream`。

## 验证与 target

执行 task 指定验证及由变更直接触发的 focused lint/type/test/build。每条命令、状态、摘要和证据写 `audits.md`；不得把一条 `validate passed` 当作语义正确或整体收口。

按 commitPolicy 固定 target：

- `required`：controller 只在 task workspace stage 与 task report 精确对应的真实业务路径，确认无未暂存残余、额外 staged 或 rename 逃逸后，创建普通业务 commit；返修追加 commit，不重写旧提交。
- `allowed`：选择 commit 时执行同一边界；不提交时保留完整 worktree snapshot。
- `forbidden`：保持 `HEAD == baseCommit`，不创建 commit。
- 无业务变化不创建空 commit，使用 `no-change`。

.dev-task/ 的 durable/generated artifacts 不能混入业务 worktree target 或 commit range；正常由
`.dev-task/.gitignore` 的 `*` 排除，被强制暂存或提交时仍必须拒绝。`snapshot-target` 只读取当前
task workspace，从当前 `execution.json` 读取 allowlist，合并 task/execution 两层 forbidden
paths，并把 canonical execution hash 写入 target identity。
commit-range target 由该 workspace 中的固定 Git objects `baseCommit..headCommit` 决定；caller
workspace 的 HEAD 和 dirty 不参与 snapshot 或 freshness。task workspace 自身在 commit 后仍有
应进入业务提交的 dirty 时继续失败。脚本只检查确定性的 workspace/task 绑定、Git identity、
路径边界和内容 hash，不判断业务正确性。

## General Review

General reviewer 独立于 implementer，只消费当前 review package 和其中具名的 fixed target。普通任务的 package 保持现有内容；source-authoritative 分支额外纳入 authoritative `task.json`、baseline A、adaptation authorization A、固定 source/mapping/snapshot 证据、Dispatch B 与实现/验证证据中的 authorization ref，以及最终 adaptation diff。不增加 `delivery.json` 顶层字段，也不把这些内容改造成独立 artifact 类型。协议保持现有单片语义：

1. 首次 `full` 审查 `base → current target`，给出需求符合性、任务边界/交付一致性、代码质量/AI 污染三个 verdict 和完整 open findings。
2. 有 finding 时，implementer 返修并重新验证、固定新 target；`repair` 只裁决直接前序 finding 和 repair delta 新 finding，不继承最终三个 verdict。
3. repair 后开放集合清零也不能收口；必须对最终 target 再做累计 `full`。最终三个 verdict 只来自这轮。
4. 最终 full 新发现 finding 时重新进入 repair；不得用另一个 fresh reviewer 洗掉结构合法负结论。

每轮在 `audits.md` 记录 review type、直接前序 A、task identity、execution identity、target identity、package hash、verdict、finding dispositions 和完整 open set。最终累计 full A 还写入 [TASK-CONTRACT.md](TASK-CONTRACT.md) 的 `deliver-task-binding` 块。机器只校验当前交付引用的绑定被显式记录且匹配，不判断 reviewer 是否正确。execution hash 变化后，旧 General binding 失效，必须为新 target 重做 General。

## Upstream acceptance

General clean 后读取 `task.acceptancePolicy`：

- `not-required`：不创建验收状态文件，`delivery.evidenceRefs.acceptance = null`，按合同继续；
- `required`：读取 `audits.md` 中绑定当前 task/target 的验收 A 条目；`passed / skipped` 继续，缺失时写 `needs-upstream / user-acceptance` 并停止。

验收 A 条目按 [TASK-CONTRACT.md](TASK-CONTRACT.md) 记录 task identity、当前 target identity、`passed / skipped / rejected` 和非空 evidence refs。验收状态不进入 task hash；同一 target 验收通过后不重建 task identity、不重新 snapshot，也不使已有 General evidence stale。

直接用户拒收但不改变 immutable task contract 时，写 `rejected` A 条目，在同一 task identity 内返修并重新执行累计 General full；新 target 自动使旧验收证据失效。反馈改变 immutable task contract 时返回对应 `needs-upstream`，不能直接修。

## 最终 rules-review

首版只迁移 owner，不改变现有单片 rules-review 适用规则、触发条件、审查深度、recommendation 或 verdict 语义：

- active catalog 真实为空时记录 `not-applicable`，不创建 run；
- catalog 非空时，在最终累计 General clean 且 upstream acceptance 满足后，使用 `rules-review` 对完整当前 target 独立分类和 full review；
- execution-time selected rules 只约束实现，不是最终审查范围；最终 reviewer 不从它们继承 selected/not-applicable；
- commit target 使用完整 `baseCommit..headCommit`，不排除文件；每个新 TARGET 默认创建 fresh run，不继承旧结果；
- `ready_for_merge` 才是 clean；`must_fix_before_merge / should_review_before_merge` 产生 finding，`manual_verification_required / review_incomplete / review_blocked` 产生 cannot-verify/blocked；
- 默认 SHOULD 整组接受与“零已知缺陷收口”继续使用当前语义，不在本 skill 重新定义风险等级或压缩审查深度。

规则 finding 只向前进入 task repair，不回写历史 preflight。新 target 先重新取得累计 General clean，再执行 fresh full；只有当前单任务协议允许的“直接前序 full + 当前一跳 repair verification”条件全部成立时才可使用该组合，不能递归继承或把 verification 冒充 full run。

`rules-review` 当前只接受 commit TARGET。若 `allowed` 选择未提交或 `forbidden`，且 active catalog 非空导致必要 rules-review 无法运行，返回 `needs-upstream / authorization-change`；不擅自提交、不把规则审查标为 not-applicable。

## 返修与阻塞

每轮返修先把验证、General、upstream feedback 或 rules-review 的失败依据写入 audits，再刷新 brief/report。source-authoritative 分支在 baseline snapshot identity、固定 source identity、mapping 和 execution binding 均未被替换、重建或失配时，返修继续引用原 authorization；任一绑定失配则先重建 baseline 与 authorization，不能以返修名义绕过。最多 4 次实际业务修改。以下情况停止：

- 多个独立工作单元：`needs-reslice`；
- immutable task contract、授权或用户判断变化：`needs-upstream`；
- 现有合同内持续环境/工具失败或修复次数用尽：`blocked`。

停止不是丢弃证据。写薄 delivery result，target 可为当前已固定 target 或 `null`，evidence refs 指向现有 claims/audits/run。

## 收口门禁

`delivered` 必须同时满足：

- delivery 与当前 task revision/hash 绑定；
- target 与当前 execution hash 绑定、符合 commitPolicy，且当前 Git 状态仍与 target 一致；
- 至少一个 claim，全部 `verified / waived` 且有 evidence refs；
- 验证、绑定当前 task/execution/target 的最终 General、适用 acceptance 和最终 rules-review 都有明确终态与引用；
- residual risks 只用 refs，不在 delivery 内复制正文；
- 没有 caller lifecycle 写入。

`validate-result` 与 `close-check` 都必须在 live `.dev-task/` 上执行；证明目录丢失时立即 fail
closed，不能根据 commits、branch 或摘要推断 `delivered`。`close-check` 只检查机器可判定的
闭包，不判断 claim 真实性、测试充分性、finding 正确性、规则适用性或用户确认真实性。

收口只返回稳定 target、`taskDir`、task workspace/branch identity 和证据引用。worktree 清理以及把
`baseCommit..headCommit` 集成到 caller branch，属于用户或上层 caller 的后续动作；deliver-task
不自动 merge、cherry-pick、rebase、push 或 publish。
