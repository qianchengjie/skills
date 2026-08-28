# 开发执行规则

## Workspace 建立

caller 或 direct controller 先形成结构化 immutable task contract，不在 caller workspace
落盘状态。在读取任何业务代码、项目规则或执行 preflight 之前，依次选择 caller 已提供的
isolated workspace、满足 base/clean/task-owned 条件的当前 harness linked worktree、harness
原生 workspace；命中后把路径作为 `--workspace` 显式绑定。三者都不适用时才使用默认模式。

无论 workspace 来源如何，都把合同通过 stdin 交给唯一
`start <repo> - [--workspace <workspacePath>]` bootstrap，不调用其它入口。`start` 先校验 exact
schema、完整 `baseCommit`、repo 和 provided workspace，再原子初始化
`<task-worktree>/.dev-task/`。只有命令返回的 `workspacePath` 是本任务的业务执行根目录，返回的
`taskDir` 是后续 task context 入口。不得绕过可用的 harness 原生机制；没有可绑定的宿主 workspace
时，默认模式才从 base 在 `<repo>/.worktrees/` 下创建 worktree。创建前要求 `.worktrees/` 已被
Git ignore；脚本不修改 ignore 配置，未命中时 fail closed。

exact identity 且 `.dev-task/` 必要 state 完整时幂等返回，不重写记录。同 revision 合同漂移、已有
branch/worktree 但 task state 缺失或不完整时 fail closed；不能从 commits、branch 或聊天摘要重建
Task / Execution context。同一 task lineage 的 higher revision 原位更新当前合同，继续使用当前
worktree、branch 与固定 `baseCommit`；只有 base lineage 真正变化时才建立新 worktree。

task workspace 建立后使用 snapshot-at-start 语义：caller workspace 后续出现 dirty、修改
同一逻辑文件、产生新 commit 或切换分支，都不改变当前 base、execution、target 或已有
evidence。不得在执行中自动 refresh base、同步文件、rebase、merge 或切回 caller workspace
读取“更新版本”。upstream 明确要求吸收新基线时，按 immutable task contract change 回流，
不能偷偷更新当前任务。

`start` 只建立 task workspace 与最小 task state；它成功不表示 execution 已有效、项目 setup
已完成或任何验证已经通过。Architecture 决定未闭合时，不得形成有效 execution、派 implementer、
生成 target 或进入实现闭环。

Controller owns task workspace preparation and environment recovery。Task / Execution validity、
Architecture closure / compatibility、rule applicability 与 preflight 记录闭合后、首次业务 writer
派发前，controller 负责完成当前 workspace 必要的正常项目准备。需要准备或恢复环境且项目明确提供
canonical setup 时，优先在 task workspace 使用该 setup；没有明确 setup 时不推断 npm / pnpm /
gradle 等通用命令，也不把已知环境缺口留给 Implementer。controller 执行 setup 后检查 task workspace
的 Git 状态；出现意外 tracked changes 时先查明并按现有边界处理，未处理前不派发业务 writer。

workspace preparation 与环境恢复都属于普通执行，不形成 readiness state、readiness evidence、
readiness closure 或独立 dispatch eligibility。恢复要求改变 immutable task contract、授权或用户判断
时才回流；现有边界内持续且不可恢复时才 `blocked`。

`execution.architecturePath` 非 null 时是上述 caller workspace 隔离的唯一显式只读例外。controller
在每次 resume 原 Implementer 及执行每个后续命令前读取该路径的当前内容，而不从 task worktree 的
同名副本重建；fresh Implementer 完整读取，resume Implementer 只在 Architecture 被列入 `Reread` 或
触发完整 implementation-input reread 时重新读取。语义变更必须由 `$architecture-steward` 把对应单元
重新变为 `[ ]`；在人确认恢复全部 `[x]` 之前，任何后续 deliver-task 命令或业务修改都停止。同一路径
Architecture 内容不进入 task/execution hash，不得为它新建 revision、hash 或快照机制。

## 上下文预检

先取得并记录人对本次 execution 的 Architecture path / null 决定；没有明确决定时不建立 execution
boundary。非 null 时重读该 Architecture，确认可读、至少一个 `[x]` 且不存在 `[ ]`；未闭合时只路由
`$architecture-steward`。随后在 task workspace 中读取项目入口、直接消费者、相关测试、适用 AGENTS/rules 和该 workspace
的 Git 状态。

`architecturePath` 非 null 时，controller 必须在闭合 preflight、生成 brief 或派业务 writer 前，
比较当前 `task.json` 的 `objective / acceptanceCriteria / constraints / nonGoals / forbiddenPaths` 与适用
Architecture 的 `[x]` 决定是否至少存在一种可同时满足的实现；只补充判断当前 Task 所需的代码事实。
这是窄的 compatibility check，不扫描其它 upstream artifact，不做文档同步或影响分析。明确不能同时满足
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
- `commitPolicy`、`acceptancePolicy`、`rulesReviewPolicy`、`initialRepairPolicy`、baseCommit 和 caller；
- `rulesReviewPolicy=not-required` 时作出该选择的人类 authority；该值不取消项目 rules 的读取、
  execution-time applicability 分类或 implementer 的遵守义务；
- `initialRepairPolicy=auto` 时作出该选择的人类 authority；该值只授权首次 discovery findings 的
  自动 repair，不改变 finding 的业务 authority；
- 当前 `task.json` 整体是 caller 定义的交付边界，以及该边界在当前执行条件下能否完成的证据。

交付边界不由 `deliver-task` 重新裁决。范围内包含多个可独立验证、独立发布或失败互不阻塞的改动时，
仍按同一 `task.json` 安排实现、验证与 review；Ticket、Spec、plan、conversation 或其它
upstream artifact 的数量和结构都不是拆分信号。

路径和文件名只产生候选规则分类。读完必读代码并针对触发条件 focused search 后，才能闭合 execution-time 分类；无法用代码证据排除的候选归入 selected。selected rules 的可执行义务必须先进入现有验证、task brief 与必要 audit 记录，冲突解决后才可结束 preflight；不能把 implementer 后续读取规则当作替代。不要为此新建平行义务状态机，也不要在 task 工件中复制规则正文。`rulesReviewPolicy=required` 时 execution-time selected rules 不替代 Rules Full discovery 的独立分类；`not-required` 只跳过独立 review，不跳过本段分类与落实。

preflight 依据写入 `audits.md` 后，由 controller 创建当前 `execution.json`；caller 和 implementer 都不填写。用户没有提供文件清单时，controller 仍应根据真实代码、直接消费者、相邻测试和项目规则建立最小完整 allowlist。`execution.evidenceRefs` 引用本次判断依据，并运行 `validate-execution` 后才生成 brief。

controller 同时直接阅读 `task.json` 的完整语义，判断它是否以强制复制、移植或等价方式把具名实现指定为 authoritative source。该判断属于合同解释，由 controller 结合目标、验收、约束和代码上下文负责；不得用 `must / copy / reuse` 等关键词扫描器代替。没有命中时继续普通单次派发，不能要求普通任务携带 mapping、snapshot 或 authorization。

## 实现派发

controller 在 `artifacts/task-brief.md` 只收束当前 task/execution identity、preflight、已解析路径、验收与验证要点、selected rules、本轮修复依据与必要 audit 引用，并引用 authoritative `task.json` 与 `execution.json`；不复制 Architecture 正文，不把目标、验收或约束重新摘要成可独立执行的合同副本。随后派发 implementer。

Task / Execution validity、Architecture closure / compatibility、rule applicability classification 与
preflight 记录都由 controller 负责。Implementer 负责
实现理解、TDD、代码修改、范围内验证，以及直接输入冲突、实现中新 authority 缺口和路径越界的 writer-side
fail-safe；不能用该 fail-safe 替代 controller preflight，也不能“先派发、再判断”。

fresh 派发提供绝对 `taskDir` 与 `workspacePath`，要求 implementer 完整读取当前 `task.json`、
`execution.json`、`artifacts/task-brief.md`、适用 Architecture、项目 rules、相关源码与测试，但不要求其
展开 brief 中 controller-owned audit refs 来重建 identity、Architecture closure / compatibility 或
rule applicability。audit refs 默认只用于 provenance；
只有 controller 明确指出某个 ref 包含实现所需事实时才读取。

resume 原 Implementer 时，controller 先更新职责相符的 durable input 与 brief，再在
`followup_task.message` 用 `Reread` 和 `Unchanged` 完整覆盖本轮存在的 `task.json`、`execution.json`、
`artifacts/task-brief.md` 与适用 Architecture，并把其它已知变化的 implementation input 列入
`Reread`。Implementer 只重读 `Reread`；不自行比较文件、hash 或引用做 delta discovery。声明缺失、
覆盖不完整、有歧义，或 controller 无法确定任一当前输入是否变化时，fail-safe 回与 fresh 派发等价的
完整 implementation-input reread，但不因此更换原 Implementer。优先级仍为 `task.json +
execution.json + applicable Architecture > task-brief.md`；brief 冲突或本轮说明遗漏适用义务时，在修改
业务文件前 blocked 回 controller。

`architecturePath` 非 null 时，controller 必须在形成上述声明前活读取当前 Architecture，确认它仍可读、
闭合、与 Task 兼容，并判断原 Implementer 已建立的 Architecture mental model 是否仍有效。确认仍有效
才能把 Architecture 列入 `Unchanged`；当前 Architecture 有效但变化事实或原 mental model 的有效性无法
确认时，显式要求完整 implementation-input reread。binding 或本 Task 相关 Architecture 语义实质变化时，
完成 `$architecture-steward` 闭环并重新校验 execution 后同样完整重读；Task authority 未变化时可复用
原 Implementer。当前 Architecture 不可读、未闭合或不兼容时停止，不派发 full reread 让 Implementer
代替 controller 重建 closure / compatibility 判断。

Implementer freshness 跟随 Task authority 的实质变化，不跟随 revision number。projection /
serialization correction 应优先修正派生载体而不产生 contract revision；即使 revision / metadata 已变化，
只要目标、验收、约束、non-goals、禁止范围、公共契约、调用策略等 authority 语义未变，也不能仅因此
停止原 Implementer 或派 fresh。上述 authority 任一实质变化时，停止旧 writer，在新合同下重做
preflight 并派发 fresh implementer。revision / hash 变化仍按既有 binding 规则由 controller 重新判定
旧 review / validation evidence；旧 evidence 不自动证明新合同，也不自动全量作废。经重新判断仍成立的
测试输出、日志与事实材料可以带 provenance 作为当前输入，只对其中缺口补证或重跑；旧 General / Rules
verdict 及其旧 task/execution/target identity 不能替代当前 revision 自己的 Initial Discovery。
controller 在当前 `audits.md` 记录引用与判断依据。

仅 brief 投影错误时，controller 在同一 task identity 下修正并按上述 resume 规则重新派发；若可见
upstream authority 表明 `task.json` 已被弱化，则停止当前执行，按 `needs-upstream / contract-change`
回流。Architecture 未闭合或当前 Task 必须改变 Architecture 时，不修改业务文件，只路由
`$architecture-steward`；人确认后在同一 task/worktree 更新并重新校验 execution。

需要新增业务取舍或返修约束时，先写回现有 task / execution / audits 中职责相符的真源并重新生成 brief。`followup_task.message` 只携带 resume 定位、完整 `Reread / Unchanged` 声明和新增 durable input 的定位，不携带新的 requirement、acceptance、business ruling、implementation decision、repair interpretation 或第二份返修说明。

### Source-authoritative 条件分支

命中具名源码强约束时，controller 必须建立真实阶段边界：

1. 固定 source identity 和完整 `source → destination` mapping，并把它们作为 Dispatch A 输入。
2. Dispatch A 只建立 source-equivalent baseline，完成即停止；不得 adaptation。controller 等唯一业务 writer 停止后，才独立复验 live source、destination、mapping 与 baseline snapshot。
3. controller 在 `audits.md` 追加 baseline A，记录当前 task/execution identity、固定 source identity、mapping、baseline snapshot identity、复验事实与 `accepted / cannot-verify`。implementer 的报告或“曾经比较一致”自述不能替代 live 复验。
4. 只有 baseline A 为 `accepted` 且 live snapshot 仍匹配时，controller 才另行追加 adaptation authorization A，绑定当前 task/execution、baseline A 及其 snapshot，并明确允许 Dispatch B 开始适配。该 A 条目是 task-owned 审计证据，不是 lifecycle state。
5. controller 刷新 brief，使其明确引用 authorization A；Dispatch B 也必须引用该 authorization，并要求 implementer 重读 Task / execution / brief 与适用 Architecture。缺少 baseline A、缺少 authorization A 或 Dispatch B 未引用 authorization 时，都不得开始 adaptation。
6. controller 接收 Dispatch B 结果时，在既有实现接收或验证 A 条目中引用同一 authorization；Implementer final handoff 也引用它。由此记录 `baseline accepted → adaptation authorized → Dispatch B → implementation/validation` 的顺序。

baseline snapshot identity 使用与 `commitPolicy` 相容的既有 commit/tree 或 worktree/content snapshot；不得为了 provenance 创建 commit。若 baseline snapshot identity、固定 source identity、mapping 或 execution binding 被替换、重建或失配，旧 authorization 失效，必须先重新建立 accepted baseline 与 authorization。授权后的正常 destination adaptation 不视为 baseline 变化；相同绑定下的适配和返修继续引用原 authorization。

baseline `cannot-verify` 时不创建 authorization，也不派发 Dispatch B。合同或 source identity 不足按现有 `needs-upstream` 处理；现有合同内的环境或工具故障持续且不可恢复时按 `blocked` 处理。

实现返回后逐项核对：

- changed files 与真实 staged/unstaged/untracked 路径一致；
- 全部业务变化属于 `execution.allowedPaths`，且不命中 `task.forbiddenPaths ∪ execution.forbiddenPaths`；
- 不修改 `.dev-task/` durable state、caller state 或 task workspace 之外的文件；
- Implementer final handoff 的验证结果可复验。

接收门禁失败时先记录依据。实际 diff 已越界时不得事后回填 allowlist 使该轮通过。若所需扩边仍在 immutable task contract 内，controller 先记录原因、更新 `execution.json`、重新校验并重新派发；不创建新 task revision。命中 task 用户禁止范围或要求改变 immutable task contract 时才 `needs-upstream`。

## 验证与 target

TDD 的 RED 必须是测试已经真实运行，并因目标行为尚未实现而出现预期失败。`command not found`、缺少
已声明依赖、权限 / 配置错误、test collection 失败等环境或工具错误都不是 RED。Implementer 记录失败
命令和错误摘要，停止当前执行并返回 controller；controller 在 task workspace 使用项目既有机制恢复
环境，再 resume 原 Implementer 重跑同一测试。可恢复失败不创建新的生命周期状态、不换 fresh writer；
恢复要求改变 immutable task contract、授权或用户判断时才回流，现有边界内持续且不可恢复时才
`blocked`。

首次实现执行 task 指定验证及由变更直接触发的 focused lint/type/test/build。Review repair 后先在唯一 writer 停止时固定实际 repair delta，再由 controller 按因果影响、直接消费者、边界与既有验证契约选择 targeted / affected validation。只有影响无法可靠限定、修改涉及广泛 runtime / contract / shared behavior，或验证契约明确要求时才升级完整 validation。文件类型、修改行数、finding 来源或“改动很小”都不能替代该语义判断。每条命令、状态、摘要、选择依据和证据写 `audits.md`；不得把一条 `validate passed` 当作语义正确或整体收口。validation 若改写业务内容，原 delta 和 target 尚未冻结，必须重新核对实际 delta 后再验证。

按 commitPolicy 固定 target：

- `required`：controller 只在 task workspace stage 与真实 diff 和 Implementer handoff 精确对应的业务路径，确认无未暂存残余、额外 staged 或 rename 逃逸后，创建普通业务 commit；返修追加 commit，不重写旧提交。
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

## Review concerns 与 Initial Discovery JOIN

reviewer 独立于 implementer，只消费当前 review package、package 列为 fixed input 的 authoritative `task.json` 和其中具名的 fixed target。所有 General package 都必须把 live `<taskDir>/task.json` 作为可读 fixed input，并说明相同 task/execution identity；只引用 authoritative 文件，不复制合同正文。source-authoritative 分支在此基础上额外纳入 baseline A、adaptation authorization A、固定 source/mapping/snapshot 证据、Dispatch B 与实现/验证记录中的 authorization ref，以及最终 adaptation diff。不把这些内容改造成独立 schema。

Review 分成两个 concern：

- **General Review**：审查需求、acceptance criteria、功能与行为、task 边界、公共契约、可观察的错误/性能风险，以及证明这些功能结论所需的测试；不 disposition active rules 或项目代码规范；
- **Rules Review**：审查 active rules 与项目代码规范。Full discovery 继续使用 `rules-review` v8；execution-time selected rules 不替代其独立分类。

`execution.json` 携带 Architecture binding 不会把 General Review 扩大为宽视角 Architecture Review。
Task Reviewer 仍只在当前 Task correctness 和固定 package 边界内工作；Architecture Drift Review 只属于
后续 `$integrate-delivery` 的非 null 分支。

首次 implementation 与 validation 完成并固定 target 后，把 General 与 Rules 作为同一个 Initial
Discovery group：

- General branch 始终执行 General Full，并以绑定当前 task / execution / target 的 `clean / findings`
  作为合法终态；
- Rules branch 继续只由 `rulesReviewPolicy` 决定：`required` 且 active catalog 非空时，并行使用现有
  `rules-review` v8 完整审查当前 TARGET，并等待完整 run 能按现有 Rules Full 语义形成 `clean /
  findings`；`cannot_verify / blocked` 等无法形成该结果时沿现有 blocker / escalation 路径停止，不把
  branch 伪装成已完成。`required` 且 catalog 真实为空时为 `not-applicable`；`not-required` 时为
  `not-required`。

只有两个 branch 都达到上述合法终态，Initial Discovery JOIN 才完成。JOIN 前，任何单个 reviewer
返回 finding 都只表示该 branch 完成；controller 不得形成首次 repair input、刷新 repair brief、派发
repair writer 或进入 repair verification。实际执行的 Full 是 discovery baseline，不是 repair Review
Wave，不进入 failed-wave budget。

JOIN 完成后先合并所有适用 concern 的完整 findings：

- 没有 findings：直接进入最终完成检查；`initialRepairPolicy` 不制造暂停。
- 有 findings 且 `initialRepairPolicy=approval-required`：停止自动 repair，把完整 merged findings 返回
  upstream，等待其明确要求修哪些 finding。这个 Gate 不新增 disposition schema、reject / accept-risk
  状态机、finding ledger、triage artifact 或新的 result；决定到达后只追加到现有 `audits.md`，并作为
  既有 repair evidence / input ref 使用。
- 有 findings 且 `initialRepairPolicy=auto`：controller 按下述现有 authority 规则 adjudicate，可执行项
  直接形成一次合并 repair input。

`auto` 只能来自人类 authority 的明确选择。task 大小、finding 数量或 priority、修改风险、时间压力、
修复是否简单都不能让 controller 或 caller 推断 `auto`。delegated 调用只接收 caller 显式传入的 policy，
缺失时回该 caller 补全，不越过 caller 直接询问用户。

普通提问或讨论只按语义响应，不改变 JOIN 或 Approval Gate；JOIN 前收到“修这个 finding”的明确决定
可以保留，但仍不得提前 repair。暂停或停止要求立即停止。目标、验收、policy、公共契约、授权或其它
immutable authority 变化时，立即走现有 `needs-upstream / contract-change` 路径。

只有 Initial Repair Policy 已允许进入 repair，controller 才按 authoritative `task.json` 与已有适用合同
核对 General finding 的 expected 或 repair 方向：已有 authority 在当前状态与事件顺序下能唯一推出
结果时，记录 `source → 状态 / 顺序 → result` 依据并只修复到该结果，不回流 upstream；无法唯一推出，
或 repair 需要新增业务语义、公共契约、授权或用户判断时，直接返回 `needs-upstream`，不生成 repair
brief、不派发 implementer，也不创建该 finding 的 Repair Review Wave。reviewer 的推荐、测试 expected、
fixture、并发场景与绿灯结果都不能替代这次分流。

General Full A 在 `audits.md` 直接记录 review type、task / execution / target identity、package identity、verdict 和完整 findings。Rules Full 继续引用 `rules-review` v8 自己的 TARGET/run identity；不增加 binding JSON 或重锚其结果。execution semantic boundary 变化后，旧 General verdict 不能作为当前完成依据，必须为新 execution 重新 discovery；历史只作为上下文保留。

## Upstream acceptance

Initial Discovery JOIN 或最终 Review Wave 已整体 clean 后读取 `task.acceptancePolicy`：

- `not-required`：不创建验收状态文件，按合同继续；
- `required`：读取 `audits.md` 中针对当前 task/target 的验收记录；明确通过或跳过时继续，缺失时返回需要用户验收并停止。

验收记录用 Markdown 写明 task、当前 target、通过/跳过/拒绝、理由与证据位置。验收不进入 task hash；同一 target 验收通过后不重建 task identity 或重新 snapshot。

直接用户拒收但不改变 immutable task contract 时，写 `rejected` A 条目，在同一 task identity 内返修；新 target 自动使旧验收证据失效，并按普通 repair 流程执行 targeted / affected validation 与 policy 要求的 scoped verification。反馈改变 immutable task contract 时返回对应 `needs-upstream`，不能直接修。

## Repair Review Wave

Full Review 用于 discovery；Repair Verification 检查返修结果。Initial Discovery JOIN 合并出 open
findings 且 Initial Repair Policy 已允许进入 repair 后，按以下顺序处理每个 repair target：

1. 只把已经通过 Initial Repair Policy 与上述 authority 分流、可在现有合同内执行的 General findings
   与 Rules findings 合并进同一次 repair input；`approval-required` 的 upstream 决定作为现有
   `repairInputRefs` 之一，不新增 triage artifact。不得根据 `sourceReviewKind` 拆成单域 repair。writer
   停止后记录直接前序 target、实际 repair delta 与 repair input refs。repair 明显越过原 finding 因果
   范围或原 implementation boundary 时，先由 controller reopen review boundary；若因此需要改变
   immutable task contract、execution 授权或用户判断，停止并回流。
2. 按“验证与 target”规则执行 targeted / affected validation；只有语义影响无法可靠限定、涉及广泛 runtime / contract / shared behavior，或已有验证契约明确要求时才执行完整 validation。validation 通过后固定新 target，package 同时携带 previous/current target、actual delta、repair input 和 validation refs。T0→T1 的 target 变化是 repair 的正常结果，本身不触发 Full；repair 后默认仍从 Scoped 开始。execution 在两轮之间合法变化时，previous target 保留原 execution identity，current target 使用新 execution identity；不重写历史 target。
3. General Scoped Repair Verification 始终派发。`rulesReviewPolicy=required` 时，active catalog 真实为空则 Rules 明确为 `not-applicable`，否则并行派发 Rules Scoped，不因 finding 来自 General 或 Rules 而省略另一边；`not-required` 时不派发 Rules reviewer，wave 的 `rules` 固定为 `not-required`。
4. 每个 scoped reviewer 只返回 `clean / findings / cannot-bound`。`cannot-bound` 表示该 domain 无法在 repair causal boundary 内可靠闭合；controller 只把这个 domain 升级 Full，不重跑已经 clean 的另一个 domain。两个 domain 都 `cannot-bound` 时才各自执行 Full；可以并行。
5. General Full 升级使用完整 General target review。只有 `rulesReviewPolicy=required` 才允许 Rules Full 升级，并继续使用 `rules-review` v8 的完整 discovery 语义：不创建 incremental / repair run，不继承旧 run，不排除完整 TARGET 中的文件。`ready_for_merge` 视为 clean；现有 finding、cannot-verify 和 blocked 语义保持不变。Full 无法形成 clean / findings 终态时不伪造已完成 wave，按现有 blocker / escalation 路径停止。
6. controller 用一个 Markdown A 条目汇总本轮 previous/current target、repair input、actual delta、验证命令、General/Rules 结论与 merged findings。任一适用 domain 有 findings，整轮只计一次失败；所有适用 domain clean 才完成该轮。不要写 review-result / review-wave JSON block，也不要让当前条目引用未来事实。
7. 达到 4 个 failed Review Waves 且仍有 findings 时，停止自动 repair，进入 controller adjudication /
   escalation；不能把次数耗尽解释为 `delivered`。首次实际执行的 Full discovery 不写 Review Wave，也
   不消耗该预算。`initialRepairPolicy` 只作用一次，不给后续 Repair Wave 增加人工暂停。

Review Wave 只在同一 task revision 内计数。contract revision 后，旧记录保留为历史，但不参与新
revision 的四轮预算；新 revision 从第一轮重新计数。编号帮助阅读，不是机器生命周期状态。

### General Scoped Repair Verification

只检查本次 repair 的因果影响面：对原 General findings 给出 disposition；检查整个 repair delta 的功能/行为是否正确、直接相关的调用/边界/行为是否 regression，以及是否产生新的相关 General finding。其它 domain finding 仍作为 repair input 提供因果上下文，但 General reviewer 不替它给 disposition。不要随机扫描整个 task。影响无法可靠限定时返回 `cannot-bound`，不要猜 clean。

### Rules Scoped Repair Verification

这是 deliver-task reviewer 能力，不是 `rules-review` v8 run。只对原 Rules findings 给出 disposition；检查整个 repair delta 是否引入新的相关规则违规、改变相关规则 applicability，或击穿直接相关的既有规则结论。其它 domain finding 仍作为 repair input 提供因果上下文，但 Rules reviewer 不替它给 disposition。不要重新执行完整 rules discovery；范围无法可靠限定时返回 `cannot-bound`。

`rules-review` v8 当前只接受 commit TARGET。`rulesReviewPolicy=required` 且首次或升级的 Rules Full 必须运行时，若 `allowed` 选择未提交或 `forbidden` 使其无法运行，返回 `needs-upstream / authorization-change`；不擅自提交、不把 Rules 标为 `not-applicable`。`not-required` 不触发这项能力冲突，因为独立 Rules Full 已由人关闭。

执行中改变 rulesReviewPolicy 属于 immutable contract revision，不能原地更新 execution.json 或当前 wave。旧 revision 已产生 Rules finding 时，人可以在新 revision 明确选择 not-required 并接受已知风险；controller 在新 task 的 audits.md 记录人类 authority、旧 finding 的稳定定位和风险接受。旧 finding 仍是 finding，不删除、不改写为 clean 或 not-applicable。

执行中改变 initialRepairPolicy 同样属于 immutable contract revision。approval-required 下 upstream 对本次 merged findings 给出具体 repair 决定，只追加现有 audits.md，不改变 policy 或 task identity。

## 返修与阻塞

首次 repair 先满足 Initial Discovery JOIN 与 Initial Repair Policy。进入 repair 后，每轮都先把 validation、General、upstream feedback 或 Rules finding 的依据写入 audits，再刷新 brief；不重复 Initial Repair Approval Gate。source-authoritative 分支只有在 baseline、source、mapping 与 execution 仍匹配时才能继续引用原 authorization。

以下情况停止：

- immutable Task、授权或用户判断需要变化：直接返回需要 upstream 决定的具体分叉和依据；
- 当前合同内持续环境/工具失败，或四个 failed Review Waves 后仍有 findings：返回 blocker、当前 live workspace 与已经确认的事实。

停止时不生成 delivery result。audits.md 保留当前执行记录，final message 直接说明未闭合原因、现场路径和下一步所需决定。

## 完成与 live handoff

只有以下事实在当前 live task workspace 上同时成立，才报告实现完成：

- 当前 task.json 与 execution.json 有效，Architecture path/null 已明确；path 分支仍可读、至少一个 [x] 且没有 [ ]；
- snapshot-target 对当前 Git 状态和允许/禁止路径检查通过；
- Task validation、Initial Discovery 或最终 Repair Review、policy 要求的 Rules concern 与 acceptance 已在当前 target 上闭合；
- 最后一次业务或 repair 修改之后，按项目指令重新运行完整测试套件并通过；
- final verification 后 source HEAD 与 dirty 状态没有再次变化；
- 没有写 caller lifecycle，也没有执行 integration 或 cleanup。

完成后不写 claims.json、delivery.json、result schema 或 closure block，也不运行 validate-result / close-check。用自然语言返回：

- live workspace 与 taskDir；
- branch 或 detached HEAD、完整 base/HEAD OID；
- committed clean、uncommitted 或 no-change；
- final fresh verification 的命令与结果；
- architecturePath/path-null；
- 仍需 upstream 注意的风险；
- 下一步交给 integrate-delivery 的明确提示。

这份 handoff 只描述当前现场。integrate-delivery 必须重新读取 live Git state、再次运行完整测试，并在人选择后执行 merge、PR/MR 或 keep；source 与 handoff 不一致时以当前现场为准、让旧结论失效，只有必要信息无法现场确定时才回到 deliver-task，不从 commits、旧 audits 或聊天摘要恢复“已交付”结论。
