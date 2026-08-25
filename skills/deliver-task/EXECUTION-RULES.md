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

`start` 只建立 task workspace 与 task proof bootstrap；它成功不表示任务已可执行。Architecture 决定
未闭合时，不得形成有效 execution、派 implementer、生成 target 或进入实现闭环。

`execution.architecturePath` 非 null 时是上述 caller workspace 隔离的唯一显式只读例外。后续各阶段
读取该路径的当前内容，而不从 task worktree 的同名副本重建。语义变更必须由
`$architecture-steward` 把对应单元重新变为 `[ ]`；在人确认恢复全部 `[x]` 之前，任何后续
deliver-task 命令或业务修改都停止。同一路径 Architecture 内容不进入 task/execution hash，不得为它
新建 revision、hash 或快照机制。

## 上下文预检

先取得并记录人对本次 execution 的 Architecture path / null 决定；没有明确决定时不建立 execution
boundary。非 null 时重读该 Architecture，确认可读、至少一个 `[x]` 且不存在 `[ ]`；未闭合时只路由
`$architecture-steward`。随后在 task workspace 中读取项目入口、直接消费者、相关测试、适用 AGENTS/rules 和该 workspace
的 Git 状态。

`architecturePath` 非 null 时，controller 必须在闭合 preflight、生成 brief 或派业务 writer 前，
比较当前 `task.json` 的 `objective / acceptanceCriteria / constraints / nonGoals / forbiddenPaths` 与适用
Architecture 的 `[x]` 决定是否至少存在一种可同时满足的实现；只补充判断当前 Task 所需的代码事实。
这是窄的 compatibility check，不扫描其它 Spec / Ticket，不做文档同步或影响分析。明确不能同时满足
时，在 `audits.md` 引用冲突的精确 Task 条款与精确 `[x]` 决定（或已确认图中的关系），立即停止；
不得先生成 brief、派 implementer 试做，或自行裁定某个 authority 优先。由人决定按
`needs-upstream / contract-change` 修改 Task / upstream，或路由 `$architecture-steward` 重新打开
Architecture；冲突闭合后 fresh 重做 preflight。null 分支不搜索 Architecture，也不补做该比较。

在 `audits.md` 明确：

- 需要理解与已读上下文；
- deliver-task 拟定的允许修改、执行禁止范围、task 用户禁止范围、非目标、停止条件；
- active rule catalog、execution-time selected / not-applicable 分类及理由；
- 人明确确认的 `architecturePath` path / null 决定；非 null 时记录已直接读取及当前无 `[ ]` 事实，
  不复制 Architecture 正文；
- path 分支的 Task ↔ Architecture compatibility 结论及判断依据；
- `commitPolicy`、`acceptancePolicy`、baseCommit 和 caller；
- 当前内容是一个交付单元，或应回流的证据。

路径和文件名只产生候选规则分类。读完必读代码并针对触发条件 focused search 后，才能闭合 execution-time 分类；无法用代码证据排除的候选归入 selected。selected rules 的可执行义务必须先进入现有验证、claims / evidence 要求和 task brief，冲突解决后才可结束 preflight；不能把 implementer 后续读取规则当作替代。不要为此新建平行义务状态机，也不要在 task 工件中复制规则正文。execution-time selected rules 不替代 Rules Full discovery 的独立分类。

preflight 依据写入 `audits.md` 后，由 controller 创建当前 `execution.json`；caller 和 implementer 都不填写。用户没有提供文件清单时，controller 仍应根据真实代码、直接消费者、相邻测试和项目规则建立最小完整 allowlist。`execution.evidenceRefs` 引用本次判断依据，并运行 `validate-execution` 后才生成 brief。

controller 同时直接阅读 `task.json` 的完整语义，判断它是否以强制复制、移植或等价方式把具名实现指定为 authoritative source。该判断属于合同解释，由 controller 结合目标、验收、约束和代码上下文负责；不得用 `must / copy / reuse` 等关键词扫描器代替。没有命中时继续普通单次派发，不能要求普通任务携带 mapping、snapshot 或 authorization。

## 实现派发

controller 在 `artifacts/task-brief.md` 只收束当前 task/execution identity、preflight、已解析路径、claims、验证、selected rules、本轮修复依据与 task-owned evidence 引用，并引用 authoritative `task.json` 与 `execution.json`；不复制 Architecture 正文，不把目标、验收或约束重新摘要成可独立执行的合同副本。随后创建默认 blocked 的 task report，再派发 implementer。

每次 fresh 或 follow-up 派发都提供绝对 `taskDir` 与 `workspacePath`，要求 implementer 重新读取当前
`task.json`、`execution.json` 和 `artifacts/task-brief.md`；只有 `execution.architecturePath != null`
时才读取其指向的 Architecture。优先级固定为 `task.json + execution.json + applicable Architecture
> task-brief.md`；brief 冲突或本轮说明遗漏适用义务时，implementer 必须在修改业务文件前 blocked
回 controller。仅 brief 投影错误时，controller 在同一 task identity 下修正并重新派发；若可见
upstream authority 表明 `task.json` 已被弱化，则停止当前执行，按 `needs-upstream / contract-change`
回流。Architecture 未闭合或当前 Task 必须改变 Architecture 时，不修改业务文件，只路由
`$architecture-steward`；人确认后在同一 task/worktree 更新并重新校验 execution。

Implementer 的上述读取与 blocked 能力只是 writer 侧 fail-safe，不能替代 controller preflight 的
compatibility check，也不能作为“先派发、再判断”的理由。

需要新增业务取舍或返修约束时，先写回现有 task / execution / claims / audits 中职责相符的真源并重新生成 brief。`followup_task.message` 只携带 task directory 定位、Task / execution / brief、适用 Architecture 的路径和本轮 task-owned evidence 引用，不携带目标、约束、实现取舍或第二份返修说明。

### Source-authoritative 条件分支

命中具名源码强约束时，controller 必须建立真实阶段边界：

1. 固定 source identity 和完整 `source → destination` mapping，并把它们作为 Dispatch A 输入。
2. Dispatch A 只建立 source-equivalent baseline，完成即停止；不得 adaptation，也不得把 task report 标为 `ready-for-review`。controller 等唯一业务 writer 停止后，才独立复验 live source、destination、mapping 与 baseline snapshot。
3. controller 在 `audits.md` 追加 baseline A，记录当前 task/execution identity、固定 source identity、mapping、baseline snapshot identity、复验事实与 `accepted / cannot-verify`。implementer 的报告或“曾经比较一致”自述不能替代 live 复验。
4. 只有 baseline A 为 `accepted` 且 live snapshot 仍匹配时，controller 才另行追加 adaptation authorization A，绑定当前 task/execution、baseline A 及其 snapshot，并明确允许 Dispatch B 开始适配。该 A 条目是 task-owned 审计证据，不是 lifecycle state。
5. controller 刷新 brief，使其明确引用 authorization A；Dispatch B 也必须引用该 authorization，并要求 implementer 重读 Task / execution / brief 与适用 Architecture。缺少 baseline A、缺少 authorization A 或 Dispatch B 未引用 authorization 时，都不得开始 adaptation。
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

首次实现执行 task 指定验证及由变更直接触发的 focused lint/type/test/build。Review repair 后先在唯一 writer 停止时固定实际 repair delta，再由 controller 按因果影响、直接消费者、边界与既有验证契约选择 targeted / affected validation。只有影响无法可靠限定、修改涉及广泛 runtime / contract / shared behavior，或验证契约明确要求时才升级完整 validation。文件类型、修改行数、finding 来源或“改动很小”都不能替代该语义判断。每条命令、状态、摘要、选择依据和证据写 `audits.md`；不得把一条 `validate passed` 当作语义正确或整体收口。validation 若改写业务内容，原 delta 和 target 尚未冻结，必须重新核对实际 delta 后再验证。

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

## Review concerns 与首次 discovery

reviewer 独立于 implementer，只消费当前 review package、package 列为 fixed input 的 authoritative `task.json` 和其中具名的 fixed target。所有 General package 都必须把 live `<taskDir>/task.json` 作为可读 fixed input，并绑定与 package 相同的 task identity；只引用 authoritative 文件，不复制合同正文。source-authoritative 分支在此基础上额外纳入 baseline A、adaptation authorization A、固定 source/mapping/snapshot 证据、Dispatch B 与实现/验证证据中的 authorization ref，以及最终 adaptation diff。不增加 `delivery.json` 顶层字段，也不把这些内容改造成独立 artifact 类型。

Review 分成两个 concern：

- **General Review**：审查需求、acceptance criteria、功能与行为、task 边界、公共契约、可观察的错误/性能风险，以及证明这些功能结论所需的测试；不 disposition active rules 或项目代码规范；
- **Rules Review**：审查 active rules 与项目代码规范。Full discovery 继续使用 `rules-review` v8；execution-time selected rules 不替代其独立分类。

`execution.json` 携带 Architecture binding 不会把 General Review 扩大为宽视角 Architecture Review。
Task Reviewer 仍只在当前 Task correctness 和固定 package 边界内工作；Architecture Drift Review 只属于
后续 `$integrate-delivery` 的非 null 分支。

首次 implementation 与 validation 完成并固定 target 后，并行执行 General Full Review 与适用的 Rules Full Review，再合并两边 findings。active rule catalog 真实为空时 Rules 记录 `not-applicable`；catalog 非空时 Rules Full 使用现有 `rules-review` v8 完整审查当前 TARGET。首次两个 Full 是 discovery baseline，不是 repair Review Wave，不进入 failed-wave budget。General 与 Rules findings 尽量合并为同一次 repair，不按 reviewer 或 domain 拆成两轮。

任何 General finding 进入 repair 前，controller 都先按 authoritative `task.json` 与已有适用合同核对其 expected 或 repair 方向：已有 authority 在当前状态与事件顺序下能唯一推出结果时，记录 `source → 状态 / 顺序 → result` 依据并只修复到该结果，不回流 upstream；无法唯一推出，或 repair 需要新增业务语义、公共契约、授权或用户判断时，直接返回 `needs-upstream`，不生成 repair brief、不派发 implementer，也不创建该 finding 的 Repair Review Wave。reviewer 的推荐、测试 expected、fixture、并发场景与绿灯结果都不能替代这次分流。

General Full A 在 `audits.md` 记录 review type、task / execution / target identity、package identity、verdict 和完整 findings，并写 [TASK-CONTRACT.md](TASK-CONTRACT.md) 的 `deliver-task-binding`。Rules Full 继续沿用 `rules-review` v8 自己的 TARGET/run identity；当某个 Full 结果被 Review Wave 引用时，对应 task-owned A 只增加 `deliver-task-review-result` 结构绑定，不复制或重锚 v8 proof。机器不判断 reviewer 结论是否正确。execution hash 变化后旧 General binding 不能作为当前 delivery proof，必须为新 execution 重新 discovery；已追加的历史 Review Wave 仍保留并校验自身 execution identity。

## Upstream acceptance

首次 discovery 的两个 concern 或最终 Review Wave 已整体 clean 后读取 `task.acceptancePolicy`：

- `not-required`：不创建验收状态文件，`delivery.evidenceRefs.acceptance = null`，按合同继续；
- `required`：读取 `audits.md` 中绑定当前 task/target 的验收 A 条目；`passed / skipped` 继续，缺失时写 `needs-upstream / user-acceptance` 并停止。

验收 A 条目按 [TASK-CONTRACT.md](TASK-CONTRACT.md) 记录 task identity、当前 target identity、`passed / skipped / rejected` 和非空 evidence refs。验收状态不进入 task hash；同一 target 验收通过后不重建 task identity、不重新 snapshot，也不使已有 Review evidence stale。

直接用户拒收但不改变 immutable task contract 时，写 `rejected` A 条目，在同一 task identity 内返修；新 target 自动使旧验收证据失效，并按普通 repair 流程执行 targeted / affected validation 与双域 scoped verification。反馈改变 immutable task contract 时返回对应 `needs-upstream`，不能直接修。

## Repair Review Wave

Full Review 用于 discovery；Repair Verification 用于 closure。首次 Full 合并出 open findings 后，按以下顺序处理每个 repair target：

1. 只把已经通过上述 authority 分流、可在现有合同内执行的 General findings 与 Rules findings 合并进同一次 repair input；不得根据 `sourceReviewKind` 拆成单域 repair。writer 停止后记录直接前序 target、实际 repair delta 与 repair input refs。repair 明显越过原 finding 因果范围或原 implementation boundary 时，先由 controller reopen review boundary；若因此需要改变 immutable task contract、execution 授权或用户判断，停止并回流。
2. 按“验证与 target”规则执行 targeted / affected validation；只有语义影响无法可靠限定、涉及广泛 runtime / contract / shared behavior，或已有验证契约明确要求时才执行完整 validation。validation 通过后固定新 target，package 同时携带 previous/current target、actual delta、repair input 和 validation refs。execution 在两轮之间合法变化时，previous target 保留原 execution identity，current target 使用新 execution identity；不重写历史 target。
3. 并行派发 General Scoped Repair Verification 与 Rules Scoped Repair Verification。active catalog 为空时 Rules 明确为 `not-applicable`；否则两个 scoped reviewer 默认都运行，不因 finding 来自 General 或 Rules 而省略另一边。
4. 每个 scoped reviewer 只返回 `clean / findings / cannot-bound`。`cannot-bound` 表示该 domain 无法在 repair causal boundary 内可靠闭合；controller 只把这个 domain 升级 Full，不重跑已经 clean 的另一个 domain。两个 domain 都 `cannot-bound` 时才各自执行 Full；可以并行。
5. General Full 升级使用完整 General target review。Rules Full 升级继续使用 `rules-review` v8 的完整 discovery 语义：不创建 incremental / repair run，不继承旧 run，不排除完整 TARGET 中的文件。`ready_for_merge` 视为 clean；现有 finding、cannot-verify 和 blocked 语义保持不变。Full 无法形成 clean / findings 终态时不伪造已完成 wave，按现有 blocker / escalation 路径停止。
6. controller 先为每个 scoped / 必要 Full 结果追加包含 `deliver-task-review-result` 的 task-owned A，再合并两个 domain 的最终结果，最后写一个 `deliver-task-review-wave` A。wave 的所有 evidence refs 必须指向它之前的 A，不能引用自己或未来 A。任一 domain 有 findings，整个 wave 为 `failed`，无论调用几个 reviewer 都只让累计 `failedWaveCount + 1`；两边 clean 才是 wave `clean`。scoped 发现由本次 repair 引入的新相关 finding，也进入同一个 merged finding set 和下一轮 repair。
7. 达到 4 个 failed Review Waves 且仍有 findings 时，停止自动 repair，进入 controller adjudication / escalation；不能把次数耗尽解释为 `delivered`。首次 General / Rules Full discovery 不写 Review Wave，也不消耗该预算。

### General Scoped Repair Verification

只检查本次 repair 的因果影响面：对原 General findings 给出 disposition；检查整个 repair delta 的功能/行为是否正确、直接相关的调用/边界/行为是否 regression，以及是否产生新的相关 General finding。其它 domain finding 仍作为 repair input 提供因果上下文，但 General reviewer 不替它给 disposition。不要随机扫描整个 task。影响无法可靠限定时返回 `cannot-bound`，不要猜 clean。

### Rules Scoped Repair Verification

这是 deliver-task reviewer 能力，不是 `rules-review` v8 run。只对原 Rules findings 给出 disposition；检查整个 repair delta 是否引入新的相关规则违规、改变相关规则 applicability，或击穿直接相关的既有规则结论。其它 domain finding 仍作为 repair input 提供因果上下文，但 Rules reviewer 不替它给 disposition。不要重新执行完整 rules discovery；范围无法可靠限定时返回 `cannot-bound`。

`rules-review` v8 当前只接受 commit TARGET。若首次或升级的 Rules Full 必须运行，但 `allowed` 选择未提交或 `forbidden` 使其无法运行，返回 `needs-upstream / authorization-change`；不擅自提交、不把 Rules 标为 `not-applicable`。

## 返修与阻塞

每轮返修先把 validation、General、upstream feedback 或 Rules finding 的依据写入 audits，再刷新 brief/report。source-authoritative 分支在 baseline snapshot identity、固定 source identity、mapping 和 execution binding 均未被替换、重建或失配时，返修继续引用原 authorization；任一绑定失配则先重建 baseline 与 authorization，不能以返修名义绕过。以下情况停止：

- 多个独立工作单元：`needs-reslice`；
- immutable task contract、授权或用户判断变化：`needs-upstream`；
- 现有合同内持续环境/工具失败，或 4 个 failed Review Waves 后仍未 closure：controller adjudication 后使用 `blocked`；确需改变合同、授权或用户判断时使用 `needs-upstream`。

停止不是丢弃证据。写薄 delivery result，target 可为当前已固定 target 或 `null`，evidence refs 指向现有 claims/audits/run。

## 收口门禁

`delivered` 必须同时满足：

- delivery 与当前 task revision/hash 绑定；
- `execution.architecturePath` 已显式为 path 或 null；非 null 时 Architecture 仍可读、至少有一个
  `[x]` 且没有 `[ ]`；
- target 与当前 execution hash 绑定、符合 commitPolicy，且当前 Git 状态仍与 target 一致；
- 至少一个 claim，全部 `verified / waived` 且有 evidence refs；
- validation、绑定当前 task/execution/target 的首次 discovery clean 或最终 clean Review Wave、适用
  acceptance 与 Rules 结论都有明确终态和引用；
- residual risks 只用 refs，不在 delivery 内复制正文；
- 没有 caller lifecycle 写入。

`validate-result` 与 `close-check` 都必须在 live `.dev-task/` 上执行；证明目录丢失时立即 fail
closed，不能根据 commits、branch 或摘要推断 `delivered`。`close-check` 只检查机器可判定的
闭包，不判断 claim 真实性、测试充分性、finding 正确性、规则适用性或用户确认真实性。

收口只返回稳定 target、`taskDir`、task workspace/branch identity 和证据引用。worktree 清理以及把
`baseCommit..headCommit` 集成到 caller branch，属于用户或上层 caller 的后续动作；deliver-task
不自动 merge、cherry-pick、rebase、push 或 publish。
