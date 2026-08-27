---
name: deliver-task
description: 当用户或上游 skill 已明确一次软件开发的交付范围、验收、约束与授权边界时使用。
disable-model-invocation: true
---

# 开发交付

## 第一原则

> **Contract authority 与 delivery workspace identity 分离；Implementer freshness 跟随 authority change，
> 不跟随 revision numbering。**

在 task-scoped isolated workspace 中完成 caller 定义的交付范围，返回一个交付结果；不接管 caller 的生命周期，也不负责把结果集成回 caller workspace。

- caller 通过目标、验收、约束和用户禁止范围定义完整交付边界；调用策略由 upstream 显式值或适用的 direct defaults 确定。`task.json` 是 deliver-task 内的 authoritative Task contract，不是 upstream authority 的授权证明；其中承载 authority 的文本必须按 [TASK-CONTRACT.md](TASK-CONTRACT.md) 从可见 upstream authority 机械摘录。`execution.json.architecturePath` 是本次实现与后续 Architecture Review 共用的 Architecture Authority binding；implementer 按其 path / null 终态消费适用输入，派生 brief 不能覆盖或弱化 Task、Execution 或适用 Architecture。
- Ticket、Spec、plan、conversation 或其它 upstream artifact 只是可选来源；来源数量、结构以及范围内是否包含多个可独立验证的改动，都不重新定义 caller 已提供的交付边界。
- 交付终态输出只是一份 `delivered / needs-upstream / blocked` 结果。Initial Repair Approval Gate
  返回 merged findings 是把控制权交还 upstream 的交互，不新增交付 result 或 lifecycle state。
- task workspace 内的 `.dev-task/` 保存合同、证据和本地执行定位；业务代码与证明状态共享同一个 isolated workspace 生命周期。不写 caller 的 plan、任务编排状态或最终 closure。
- 可以自行安排当前交付范围内的实现与验证步骤；不创建或管理正式多任务计划，也不重新裁决任务粒度。
- 目标、验收、公共契约、用户禁止范围、调用策略或用户判断需要变化时，立即返回 `needs-upstream`。直接调用时用户就是 upstream；由其它 skill 委托时只向 caller 回流，不越过 caller 直接询问用户。

## 输入与目录

使用 [TASK-CONTRACT.md](TASK-CONTRACT.md) 的 exact task contract 作为 stdin 调用契约。

- 直接调用：按合同的 source-fidelity 规则，把用户原始 authority 机械摘录成结构化合同，`caller` 固定为 `{ "kind": "direct" }`。用户明确提出的提交与验收要求先归一化为对应 policy；这两个字段已被提及但因要求冲突或把选择留给模型而无法唯一归一化时，不视为缺失且不得使用默认值，必须向用户澄清，在得到唯一值前不构造可启动合同、不调用 `start`；没有明确要求时分别固定使用 `commitPolicy=required`、`acceptancePolicy=not-required`。`rulesReviewPolicy` 是人类所有的开关：只有 direct 用户明确选择本任务不需要独立 Rules Review 时才写 `not-required`，其余情况固定为 `required`；把选择留给模型不构成关闭授权，仍使用 `required`。`initialRepairPolicy` 的 direct default 固定为 `approval-required`；只有用户明确选择首次 discovery 有 findings 后自动 repair 时才写 `auto`。不得根据任务内容、finding 数量或 priority、修改风险、时间压力、修复难度、成本、仓库状态或模型判断选择 `not-required` 或 `auto`。
- 上游委托：caller 对其实际收到的 upstream authority 负责，只传递按同一规则机械摘录的 immutable task contract，使用通用
  `{ "kind": "delegated", "name", "ref" }`；caller 不创建 task directory、不落盘 task state，
  也不填写 `execution.json`。delegated caller 必须显式提供四个 policy；缺少任一个都不继承 direct
  defaults、不调用 `start`，只回到该 caller 请求补全。`rulesReviewPolicy=not-required` 只能机械传递
  可见的人类明确选择；`initialRepairPolicy=auto` 也只能机械传递可见的人类明确选择。caller 不能自行
  按风险或效率关闭 Rules Review 或开启自动首次 repair，deliver-task 也不越过 caller 直接询问用户。
- deliver-task 在 preflight 后创建和维护 `execution.json`；`start` 不提前生成。

`deliver-task` 不能证明未随合同提供的 upstream source fidelity；把 caller 或 AI 生成的摘要写进
`task.json` 也不会使它自动获得 upstream authority。只有可见的更高层 authority 明确委托某个中间
载体承载相应决定时，caller 才能从该载体摘录。若执行中从可见 upstream evidence 发现合同本身已
弱化，停止当前 writer 并按 contract revision 回流；普通 revision 仍属于当前 delivery，不改变
workspace identity。

启动前按以下优先级选择 workspace，命中后停止：

1. caller 已提供从 `task.baseCommit` 开始、业务区干净且只属于当前任务的 isolated workspace；
2. 当前 workspace 已是 harness 建立的 linked worktree，且满足同一 base、clean、task-owned 边界；
3. 运行环境提供 native worktree 能力时，先让 harness 从 `task.baseCommit` 创建并切入 workspace；
4. 以上都不适用时，使用脚本默认模式。

前三种都只把选定路径作为 `--workspace` 传给同一个 `start`，不另建 task state，也不调用其它
bootstrap。不得为了省事绕过 harness 原生机制；脚本默认模式只是没有可用宿主 workspace 时的
fallback。

唯一 bootstrap：

```bash
generate-task-contract | node <deliver-task-skill-dir>/scripts/deliver-task.mjs start <repo> -
```

caller、当前 linked worktree 或运行环境已经提供 isolated workspace 时：

```bash
generate-task-contract | node <deliver-task-skill-dir>/scripts/deliver-task.mjs start <repo> - --workspace <workspacePath>
```

无 `--workspace` 时，脚本从 `task.baseCommit` 在 `<repo>/.worktrees/` 下创建 task-scoped Git
worktree。`.worktrees/` 必须已被 Git ignore；脚本不修改 ignore 配置，未命中时 fail closed。
`start` 固定返回 task binding、`taskDir`、`workspacePath`、`kind`、`branch` 和 `baseCommit`；
其中 `taskDir == <workspacePath>/.dev-task`，`workspacePath` 是后续 preflight、实现、验证、提交、
review 和收口的唯一业务工作目录。不得继续从 caller workspace 读取业务代码。

`start` 成功只表示 task workspace 与 task proof bootstrap 已建立，不表示 execution 已有效、项目
setup 已完成或任何验证已经通过。Architecture 决定未闭合时，不得形成有效 execution、派
implementer、生成 target 或进入实现、验证、review、delivery 闭环。

exact identity 且 `.dev-task/` 完整时 `start` 幂等返回，不重写证据。同 revision 合同漂移，或
已有 task branch/worktree 但 `.dev-task/` 缺失、不完整时 fail closed；不得根据 commits、branch、
聊天摘要或重建 locator 推断历史证明。同一 delivery 的普通 higher revision 继续使用当前
worktree、branch 与固定 `baseCommit`。projection / serialization correction 应优先修正派生载体而不
产生 contract revision；revision / metadata 变化本身也不是派发 fresh Implementer 的充分条件。只有
目标、验收、约束、non-goals、禁止范围、公共契约、调用策略等 Task authority 实质变化时，才停止旧
writer，并在新合同 preflight 闭合后派发 fresh implementer。旧 review / validation evidence 不自动
证明新 revision，也不自动全量作废；controller 按新合同重新判定哪些 evidence 可继续引用，只对未闭合
部分补证或重跑。只有 delivery lineage 真正变化时才建立新 worktree。任何 caller 状态变化都由 caller
在收到结果后决定。

## 开始前判断

按以下顺序做一次公开、可审计的判断：

1. 先取得人对本次 execution 的 Architecture 决定。已明确当前需求 Spec 时，只把
   `<Spec 所在目录>/ARCHITECTURE.md` 作为候选，不根据代码目录、changed files 或仓库扫描猜测：
   - 选择 path：展示规范化绝对路径并取得“本次执行使用该文件”的明确确认，再直接读取文件；任何
     `[ ]` 或没有有效 `[x]` 都停止并路由 `$architecture-steward`；
   - 选择 null：人必须明确确认本次执行不需要 Architecture Authority；默认文件不存在、以前未使用或
     时间紧迫都不能自动推出 null。
   direct 调用向用户确认；delegated caller 必须携带已取得的人类决定，缺失时只回该 caller。
2. 在 `audits.md` 记录 path / null 决定、来源与当前 checkbox 终态。路径确认是人的语义判断；脚本
   只校验字段、路径与显式 `[ ]` / `[x]`，不证明确认真实性或 Architecture 语义正确。
3. 只在已绑定的 task workspace 中读取必要代码上下文、Git 状态和适用项目 rules；非 null
   Architecture 是唯一显式外部只读输入。caller workspace 的 HEAD、dirty 和同名文件都不是本任务上下文。
4. `architecturePath` 非 null 时，controller 在业务 writer 启动前比较当前 `task.json` 的
   `objective / acceptanceCriteria / constraints / nonGoals / forbiddenPaths` 与适用 Architecture 的
   `[x]` 决定能否同时满足；只读取判断当前 Task 所需的代码事实。明确不能同时满足时，在
   `audits.md` 引用冲突的精确 Task 条款与精确 `[x]` 决定（或已确认图中的关系），停止 preflight，
   不生成 brief、不派 implementer，也不自行决定哪个 authority 覆盖另一个。由人决定按
   `needs-upstream / contract-change` 修改 Task / upstream，或路由 `$architecture-steward` 重新打开
   Architecture；冲突闭合后 fresh 重做本次 preflight。该检查不扫描其它 upstream artifact，不做文档
   同步或影响分析。`architecturePath == null` 时不补做 Architecture 搜索或比较。
5. 把 `task.json` 整体视为 caller-defined delivery boundary。即使其中包含多个可独立验证、独立发布或
   失败互不阻塞的改动，也只安排当前范围内的实现与验证，不要求拆分、不创建 tickets，也不返回粒度
   相关结果。只有合同本身、授权或用户判断需要变化时才按下一步回流。
6. 检查是否需要改变 immutable task contract；需要时返回 `needs-upstream`。用户未提供文件清单本身不是回流条件。
7. 在同一 preflight A 中记录允许/禁止路径、非目标、停止条件、规则读取、四个 policy 和判断依据；
   `rulesReviewPolicy=not-required` 或 `initialRepairPolicy=auto` 时还要记录作出该选择的人类 authority。
   关闭独立 Rules Review 不取消 controller / implementer 读取、选择和遵守适用项目 rules。
8. 根据上述真实上下文创建包含必填 `architecturePath` 的当前 `execution.json`，运行：

```bash
node <deliver-task-skill-dir>/scripts/deliver-task.mjs validate-execution <taskDir>
```

9. 在 `claims.json` 写当前任务要证明的 claims；不得提前声明验证、General Review、rules-review 或 close-check 已通过。

同一授权目标内需要调整执行路径或 Architecture binding 时，先取得适用的人类决定并追加审计依据，
再原地更新 `execution.json`；`null → path`、`path A → path B` 和 `path → null` 只改变 execution hash，
不递增 task revision/hash，也不新建 task/worktree。若调整命中 `task.forbiddenPaths` 或要求改变
immutable task contract，才回流 upstream。

不要在 `.dev-task/` 内新建 `plan.md`、slice、ticket、里程碑或任务状态机，也不要要求 caller 把当前交付范围改写成这些 artifact。

## commitPolicy

Git 提交是调用策略，不是 `delivered` 的普遍定义。

| 值 | 行为 | 合法 target |
| --- | --- | --- |
| `required` | 代码变化必须先形成 caller 已授权的业务 commit；无变化不创建空 commit | `commit-range` / `no-change` |
| `allowed` | 可根据调用契约、仓库习惯和任务收口需要选择提交或保留未提交 | `commit-range` / `worktree` / `no-change` |
| `forbidden` | 禁止创建业务 commit；不得以“需要提交”污染普通成功结果 | `worktree` / `no-change` |

- `required` 表示 caller 已授权本任务创建业务 commit，不需要再次询问同一权限。
- `allowed` 未选择提交或 `forbidden` 本身不产生 `needs-upstream`。
- `rebase / merge / cherry-pick / push / publish` 和把 task branch 集成回 caller workspace 永远不属于 deliver-task。
- workspace 建立后固定 `baseCommit`；caller workspace 后续 dirty、提交或分支移动都不触发 refresh、同步或 evidence stale。只有 upstream 明确改变 task contract/base 时才建立新 task identity。
- 若适用的既有审查工具只接受 commit TARGET，而 `forbidden` 使必要审查无法执行，记录能力冲突并返回 `needs-upstream`；不得静默跳过审查或擅自改变 policy。

提交或保留工作区结果后，运行：

```bash
node <deliver-task-skill-dir>/scripts/deliver-task.mjs snapshot-target <taskDir>
```

把输出原样用作 `delivery.json.target` 和本轮 review package 的 target identity。

## rulesReviewPolicy

这是独立 Rules Review concern 的人类开关，不是由 AI 评估风险后选择的优化项。

| 值 | 行为 | `delivery.evidenceRefs.rulesReview` |
| --- | --- | --- |
| `required` | active catalog 非空时执行 Rules Full / repair Rules Scoped；catalog 真实为空时记录 `not-applicable` | 适用时为证据 ref；真实空 catalog 时为 `not-applicable` |
| `not-required` | 跳过首次 Rules Full、repair Rules Scoped 和 Rules Full 升级 | `null` |

- `not-applicable` 是 `required` 下 active catalog 真实为空的事实终态，不是人工关闭值，也不能用来规避 review。
- `not-required` 只取消独立 Rules Review concern；项目 rules 仍是实现和验证输入，General Review、任务验证与 acceptance gate 均不因此削弱。
- 修改该值就是 immutable task contract revision，不得写入或覆盖 `execution.json`。
- 已有 Rules finding 后再由人改为 `not-required` 时，旧 finding 不得被删除、改写为 clean 或 `not-applicable`；新 revision 在 `audits.md` 记录人对已知风险的明确接受，并由 `delivery.residualRiskRefs` 引用该 task-owned A。

## initialRepairPolicy

这个 policy 只控制 Initial Discovery JOIN 有 findings 后，controller 是否有权自动形成首次 repair
input；不控制 clean closure，也不用于 repair 后的 Review Wave。

| 值 | Initial Discovery JOIN 后的行为 |
| --- | --- |
| `approval-required` | clean 时直接继续 closure；有 findings 时停止自动 repair，向 upstream 返回完整 merged findings，等待明确 repair 决定 |
| `auto` | clean 时直接继续 closure；有 findings 时按现有 authority 规则 adjudicate，可执行项自动形成 repair input 并进入 repair |

- direct default 固定为 `approval-required`；`auto` 只能由人明确选择，不能由 AI 根据任务大小、finding 数量或 priority、修改风险、时间压力或修复难度推断。
- delegated caller 必须显式传入该值；缺失时只回该 caller 补全，不越过 caller 直接询问用户。
- `approval-required` 不新增 disposition、reject、accept-risk、finding ledger 或 triage artifact。upstream 明确要求修哪些 finding 后，把决定追加到现有 `audits.md` 并纳入既有 repair evidence，再按原 repair 流程执行。
- upstream 决定若改变 task contract、公共契约、授权或其它 immutable authority，仍走现有 `needs-upstream / contract-change` 路径。
- 修改 policy 本身属于 immutable task contract revision；一次具体 repair 决定不修改 policy。

## 执行闭环

完整执行规则见 [EXECUTION-RULES.md](EXECUTION-RULES.md)。固定顺序是：

1. Task / Execution validity、Architecture closure / compatibility、rule applicability 与 claims bootstrap
   闭合后，项目已经明确提供 setup 命令时由 controller 直接在 task workspace 执行；没有明确 setup 时
   不推断通用命令。缺少已声明依赖、test runner 暂不可用等可恢复环境问题按普通执行失败处理：使用
   项目既有机制恢复并重跑，不创建 readiness state、readiness evidence、readiness closure 或独立
   dispatch eligibility。随后生成引用 `task.json` 与 `execution.json` 的派生
   `artifacts/task-brief.md` 和默认 blocked 的 `artifacts/task-report.json`。fresh implementer 完整读取当前
   Task、Execution、brief、适用 Architecture、Rules、相关源码与测试，但不主动展开 controller-owned
   proof refs；resume 原 implementer 时，controller 用完整 `Reread / Unchanged` 声明指定刷新输入，声明
   不完整或有歧义就 fail-safe 回完整 implementation-input reread，Implementer 不自行发现 delta。
2. controller 根据 `task.json` 语义判断是否命中具名源码的强制复制/移植要求。普通任务按 [IMPLEMENTER-SUBAGENT.md](IMPLEMENTER-SUBAGENT.md) 单次派发 fresh implementer；命中时先做 baseline-only Dispatch A 并停止，controller 对 live baseline 独立复验并在 `audits.md` 记录 accepted baseline A，再追加绑定它的 adaptation authorization A，最后才派发明确引用该 authorization 的 Dispatch B。task workspace 同时只允许一个业务文件 writer。
3. 接收后按当前 `execution.json` 及 task/execution 两层 forbidden paths 核对实际 diff、task report 和 claims，运行任务验证；source-authoritative 分支的实现接收与验证证据继续引用 Dispatch B 的 authorization。
4. 按 `commitPolicy` 固定 commit range、worktree snapshot 或 no-change target。
5. 生成绑定 task、execution、target 三个 identity 的首次 review package，并把 live authoritative `task.json` 列为同 task identity 的可读 fixed input，不复制合同正文。General Full 与 policy 要求的 Rules concern 共同组成 Initial Discovery group：始终派发 General Full；`rulesReviewPolicy=required` 时，active rule catalog 非空则并行派发由 `rules-review` v8 执行的 Rules Full，catalog 真实为空则 Rules 记为 `not-applicable`；`not-required` 时 Rules 记为 `not-required`。只有 General 与 Rules 两个 branch 都达到各自合法终态，Initial Discovery JOIN 才完成。JOIN 前不得形成首次 repair input、刷新 repair brief、派发 repair writer 或进入 repair verification；单个 reviewer 提前返回 finding 只表示该 branch 完成。首次 Full 不属于 repair Review Wave，也不消耗 failed-wave budget。
6. JOIN 完成后没有 findings 时直接继续 closure，不因 `initialRepairPolicy` 暂停；有 findings 时先应用该 policy。`approval-required` 停止自动 repair 并向 upstream 返回完整 merged findings，只有明确 repair 决定已记录到现有 `audits.md` / repair evidence 后才能继续；`auto` 由 controller 立即按现有 authority 规则 adjudicate。普通提问或讨论不完成 JOIN 或 Approval Gate；JOIN 前收到“修这个 finding”的明确决定可以保留，但仍不得提前 repair。暂停或停止要求立即停止；目标、验收、policy、公共契约或其它 authority 变化走现有 contract-change 路径。
7. Gate 允许首次 repair 后，controller 先按 `task.json` 与已有适用合同分流 General finding：当前状态与事件顺序下能唯一推出结果时只修复到该结果；无法唯一推出或需要新增语义、契约、授权或用户判断时直接 `needs-upstream`，不派发 repair。把已获准且可执行的 General 与 Rules findings 合并成同一次 repair。writer 停止后固定从直接前序 target 到 live content 的实际 repair delta；controller 根据真实因果影响与既有验证契约选择 targeted / affected validation，只有无法可靠限定、涉及广泛 runtime / contract / shared behavior，或验证契约明确要求时才升级完整 validation。不得按文件类型、行数、finding 类型或“改动很小”自动分类。
8. validation 通过后固定新 target，并按 [REVIEWER-SUBAGENT.md](REVIEWER-SUBAGENT.md) 派发 repair verification。target 从 T0 变化为 T1 本身不触发 Full：General Scoped 始终运行；`rulesReviewPolicy=required` 时还并行运行 Rules Scoped，active rule catalog 真实为空则 Rules 记为 `not-applicable`；`not-required` 时不派发 Rules reviewer，Review Wave 的 `rules` 固定写 `not-required`。适用 domain 返回 `cannot-bound` 时只把该 domain 升级 Full，保留另一 domain 已完成的 clean 结论；`not-required` 禁止 Rules Full 升级。每个实际运行的 scoped / 必要 Full 结论先以绑定 task、execution、current target、domain、mode 和 result 的 task-owned A 记录。
9. controller 把两个 domain 的最终结果合并为一个 Review Wave；wave 的所有 refs 只能指向它之前已经追加的 A。任一 domain 有 findings，整个 wave 只失败一次并自动进入下一轮 repair；`initialRepairPolicy` 不在后续 wave 重复形成暂停。scoped 发现由 repair 引入的新相关 finding 也同样处理。连续累计 4 个 failed Review Waves 后停止自动 repair，由 controller adjudication / escalation；不能因预算耗尽而交付。clean wave 不增加失败计数，首次 Full discovery 也不计数。
10. Review closure clean 后按 `acceptancePolicy` 处理 upstream acceptance；`required` 且当前 target 没有 `passed / skipped` A 条目时返回 `needs-upstream / user-acceptance`。acceptance 的 `not-required` 只取消 upstream acceptance gate；Rules Review 的 `not-required` 只取消独立 Rules concern。二者都不削弱 `acceptanceCriteria`、任务 validation、General 或实现时适用的项目 rules。验收结果留在 `audits.md`，不改变 task identity。
11. 把事实证据分别写入 `claims.json`、`audits.md`、review 工件和 rules-review run；最后只在 `delivery.json` 写引用。运行 `validate-result`；仅 `delivered` 再运行 `close-check`。

任何实现、验证或 Task Review 环节如果发现完成当前 Task 必须新增或改变 Architecture，立即停止业务 writer；不以临时实现、repair finding 或扩大 allowlist 绕过。只把具体缺口或候选 Delta 路由 `$architecture-steward`，等待人确认后更新适用 binding、重新校验 execution，并 fresh 重读 Task + Execution + applicable Architecture + Rules + Codebase 再继续。binding 变化只使 execution/target/review stale；同路径 Architecture 正文变化不进入 task 或 execution hash。Task Review 仍只审查当前 Task correctness，不在 deliver-task 内新增宽视角 Architecture Review。

## Review Wave 与有限返修

- 首次 discovery finding 先通过 Initial Discovery JOIN 与 `initialRepairPolicy`；获准进入 repair 后，以及后续 General Review、验证、用户拒收或项目规则 finding 触发返修时，先把失败依据写入 `audits.md`，再刷新 brief。用户拒收但 immutable task contract 未变化时保持同一 task identity；返修形成新 target 后旧验收证据自然失效。
- 每个 repair target 只形成一个合并 Review Wave；General / Rules scoped、某个 domain 的 Full 升级、reviewer 调用或 finding 数量都不单独计次。wave 只有合并后仍有 finding 时才让 `failedWaveCount + 1`。
- Review Wave history 可跨合法的 execution 更新追加：历史 wave 保留并校验自身 execution/target identity，下一 wave 的 `previousTarget` 完整等于前一 wave 的 `target`，只有最新 wave 绑定当前 `execution.json`。不得为了当前 execution 重写旧 wave 或 target。
- `repairInputRefs`、repair diff、validation、scoped / Full 结果和 merged findings 都必须在 wave A 之前存在；禁止当前 wave 自证或引用未来 A。scoped / Full ref 还必须匹配同一 current target、domain、mode 和 result。
- 最多允许 4 个 failed Review Waves。第 4 次失败后不再自动修改业务文件；controller 根据现有 result taxonomy 选择 `blocked`，或在确需改变合同、授权、边界或用户判断时选择 `needs-upstream`，并保留当前证据引用。
- 安全返修优先复用原 implementer；controller 先刷新职责相符的 durable repair inputs / brief，再用完整
  `Reread / Unchanged` 声明恢复原 implementer。声明缺失、不完整或有歧义时 full reread，不让
  Implementer 自行发现 delta。只有目标、验收、约束、non-goals、禁止范围、公共契约、调用策略等 Task
  authority 实质变化时才停止旧 writer、回流并在新合同下派发 fresh implementer；revision / metadata
  变化本身不是 fresh 的充分条件。
- repair 明显越过原 finding 的因果范围或原 implementation boundary 时，不能用连续 scoped review 掩盖扩边：在当前 task / execution 内能够重新界定时升级受影响 domain 的 Full；需要扩大 immutable contract 或授权时回流 upstream。
- 结构合法的负审查结论不能靠重派 reviewer 洗掉。reviewer 未返回、越界写文件或结果无法绑定输入时，同一输入最多 fresh 重派一次；这类调用故障不是 failed Review Wave。

精确记录和 binding 见 [TASK-CONTRACT.md](TASK-CONTRACT.md)。`rulesReviewPolicy=required` 时，`rules-review` v8 继续只负责完整 Rules discovery / Full 升级；Rules Scoped Repair Verification 是 deliver-task 自己的 reviewer 能力，不生成或伪装 v8 run。`not-required` 时两者都不派发。

## 结果选择

| result | 使用条件 | upstreamRequest.kind |
| --- | --- | --- |
| `delivered` | 当前 task、execution、target 的目标、验证、General Review、适用 acceptance 和 rules-review 已闭合 | `null` |
| `needs-upstream` | 需要 upstream 改变 immutable task contract、授权或提供用户判断 | 对应 change / `user-acceptance` |
| `blocked` | 合同不变时仍因环境、工具或不可恢复条件无法完成 | `blocker` |

`delivered` 只表示这个任务在固定 `baseCommit` 与 task workspace 中已交付，不表示 caller 的计划完成、已集成、可 merge、可发布或整体 closure。

## 收口

按 [TASK-CONTRACT.md](TASK-CONTRACT.md) 写薄 `delivery.json`：

- task identity；
- result；
- target/range；
- evidence refs；
- residual risk refs；
- 非 delivered 时的 upstream request。

禁止在 `delivery.json` 内嵌 changed files、验证日志、General Review 正文、rules-review 结果或 claims 全文。先运行：

```bash
node <deliver-task-skill-dir>/scripts/deliver-task.mjs validate-result <taskDir>
```

`delivered` 再运行：

```bash
node <deliver-task-skill-dir>/scripts/deliver-task.mjs close-check <taskDir>
```

其中 `delivery.evidenceRefs.acceptance` 在 `acceptancePolicy=not-required` 时为 `null`，否则引用绑定当前 target 的验收 A 条目。`delivery.evidenceRefs.rulesReview` 在 `rulesReviewPolicy=not-required` 时为 `null`；policy 为 `required` 时，适用 Rules 引用证据，active catalog 真实为空才写 `not-applicable`。非 `delivered` 的 `upstreamRequest.evidenceRefs` 至少一项，且都引用存在的 task-owned evidence。

机器只检查 schema、task/execution/target binding、Git target、路径边界、引用存在和明确终态；不判断实现正确性、证据强度、reviewer 判断、验收理由或规则语义。命令细节见 [SCRIPTS.md](SCRIPTS.md)。

最终交付时只向 upstream 返回：result、`delivery.json` 路径、target 摘要、task workspace 路径与 branch identity、关键 evidence refs 和需要 upstream 决定的下一步。不要替 upstream 写状态，也不要自动清理或集成 task worktree；需要处理已交付结果时，交给 `$integrate-delivery`。
