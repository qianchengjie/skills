---
name: deliver-task
description: 当用户或上游 skill 已明确一次软件开发的交付范围、验收、约束与授权边界时使用。
disable-model-invocation: true
---

# 开发交付

## 第一原则

> **Contract authority 与 task workspace identity 分离；Implementer freshness 跟随 authority change，
> 不跟随 revision numbering。**

收尾以 live Git source 与 fresh verification 为准，不建立可被下游独立信任的 delivery proof。

在 task-scoped isolated workspace 中完成 caller 定义的交付范围，返回当前 source 的 live handoff；不接管 caller 的生命周期，也不负责把结果集成回 caller workspace。

- caller 通过目标、验收、约束和用户禁止范围定义完整交付边界；调用策略由 upstream 显式值或适用的 direct defaults 确定。`task.json` 是 deliver-task 内的 authoritative Task contract，不是 upstream authority 的授权证明；其中承载 authority 的文本必须按 [TASK-CONTRACT.md](TASK-CONTRACT.md) 从可见 upstream authority 机械摘录。`execution.json.architecturePath` 是本次实现与后续 Architecture Review 共用的 Architecture Authority binding；implementer 按其 path / null 终态消费适用输入，派生 brief 不能覆盖或弱化 Task、Execution 或适用 Architecture。
- Ticket、Spec、plan、conversation 或其它 upstream artifact 只是可选来源；来源数量、结构以及范围内是否包含多个可独立验证的改动，都不重新定义 caller 已提供的交付边界。
- 完成时只返回当前 source 的自然语言 handoff；需要 upstream 决定或遇到 blocker 时也直接报告事实与下一步，不落盘 result enum 或 lifecycle state。Initial Repair Approval Gate 返回 merged findings 只是把控制权交还 upstream。
- task workspace 内的 `.dev-task/` 保存 Task、Execution、Markdown 记录和本地定位；这些内容服务当前执行与恢复，不向下游证明最终 closure。不写 caller 的 plan 或任务编排状态。
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
弱化，停止当前 writer 并按 contract revision 回流；普通 revision 仍属于当前 task lineage，不改变
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

`start` 成功只表示 task workspace 与最小 task state 已建立，不表示 execution 已有效、项目
setup 已完成或任何验证已经通过。Architecture 决定未闭合时，不得形成有效 execution、派
implementer、生成 target 或进入实现、验证、review 流程。

task workspace 的必要 preparation 与环境恢复由 controller 负责；Implementer 只接收已完成当前阶段
正常项目准备的 workspace，不负责 environment provisioning / recovery。

exact identity 且 `.dev-task/` 完整时 `start` 幂等返回，不重写记录。同 revision 合同漂移，或
已有 task branch/worktree 但 `.dev-task/` 必要 state 缺失、不完整时 fail closed；不得根据 commits、branch
或聊天摘要重建 Task / Execution context。同一 task lineage 的普通 higher revision 继续使用当前
worktree、branch 与固定 `baseCommit`。projection / serialization correction 应优先修正派生载体而不
产生 contract revision；revision / metadata 变化本身也不是派发 fresh Implementer 的充分条件。只有
目标、验收、约束、non-goals、禁止范围、公共契约、调用策略等 Task authority 实质变化时，才停止旧
writer，并在新合同 preflight 闭合后派发 fresh implementer。旧 review / validation evidence 不自动
证明新 revision，也不自动全量作废；可继续引用的是 controller 按新合同重新判定过的测试输出、日志与
事实材料，不是旧 General / Rules verdict 或旧 task/execution/target identity。当前 revision 仍执行
自己的 Initial Discovery，只对事实材料的缺口补证或重跑。只有 task lineage 真正变化时才建立新
worktree。任何 caller 状态变化都由 caller 在收到结果后决定。

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
5. 把 `task.json` 整体视为 caller-defined task boundary。即使其中包含多个可独立验证、独立发布或
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

9. 在 `artifacts/task-brief.md` 直接列出验收、验证、selected rules 与当前未闭合项；不创建 claims schema，也不提前声明下游 review 已通过。

同一授权目标内需要调整执行路径或 Architecture binding 时，先取得适用的人类决定并追加审计依据，
再原地更新 `execution.json`；`null → path`、`path A → path B` 和 `path → null` 只改变 execution hash，
不递增 task revision/hash，也不新建 task/worktree。若调整命中 `task.forbiddenPaths` 或要求改变
immutable task contract，才回流 upstream。

不要在 `.dev-task/` 内新建 `plan.md`、slice、ticket、里程碑或任务状态机，也不要要求 caller 把当前交付范围改写成这些 artifact。

## commitPolicy

Git 提交是调用策略，不是实现正确性的普遍定义。

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

把输出直接用于本轮 review package 和最终 live handoff；不复制成 target.json 或 delivery.json。

## rulesReviewPolicy

这是独立 Rules Review concern 的人类开关，不是由 AI 评估风险后选择的优化项。

| 值 | 行为 | 完成记录 |
| --- | --- | --- |
| `required` | active catalog 非空时执行 Rules Full / repair Rules Scoped；catalog 真实为空时记录 `not-applicable` | 在 `audits.md` 记录实际结论 |
| `not-required` | 跳过首次 Rules Full、repair Rules Scoped 和 Rules Full 升级 | 在 `audits.md` 记录人类选择 |

- `not-applicable` 是 `required` 下 active catalog 真实为空的事实终态，不是人工关闭值，也不能用来规避 review。
- `not-required` 只取消独立 Rules Review concern；项目 rules 仍是实现和验证输入，General Review、任务验证与 acceptance gate 均不因此削弱。
- 修改该值就是 immutable task contract revision，不得写入或覆盖 `execution.json`。
- 已有 Rules finding 后再由人改为 `not-required` 时，旧 finding 不得被删除、改写为 clean 或 `not-applicable`；新 revision 在 `audits.md` 记录人对已知风险的明确接受。

## initialRepairPolicy

这个 policy 只控制 Initial Discovery JOIN 有 findings 后，controller 是否有权自动形成首次 repair
input；不控制 clean completion，也不用于 repair 后的 Review Wave。

| 值 | Initial Discovery JOIN 后的行为 |
| --- | --- |
| `approval-required` | clean 时直接继续完成检查；有 findings 时停止自动 repair，向 upstream 返回完整 merged findings，等待明确 repair 决定 |
| `auto` | clean 时直接继续完成检查；有 findings 时按现有 authority 规则 adjudicate，可执行项自动形成 repair input 并进入 repair |

- direct default 固定为 `approval-required`；`auto` 只能由人明确选择，不能由 AI 根据任务大小、finding 数量或 priority、修改风险、时间压力或修复难度推断。
- delegated caller 必须显式传入该值；缺失时只回该 caller 补全，不越过 caller 直接询问用户。
- `approval-required` 不新增 disposition、reject、accept-risk、finding ledger 或 triage artifact。upstream 明确要求修哪些 finding 后，把决定追加到现有 `audits.md` 并纳入既有 repair evidence，再按原 repair 流程执行。
- upstream 决定若改变 task contract、公共契约、授权或其它 immutable authority，仍走现有 `needs-upstream / contract-change` 路径。
- 修改 policy 本身属于 immutable task contract revision；一次具体 repair 决定不修改 policy。

## 执行闭环

完整规则见 [EXECUTION-RULES.md](EXECUTION-RULES.md)。执行顺序：

1. Task / Execution、Architecture closure/compatibility、rule applicability 与 preflight 记录闭合后，controller 完成 task workspace 的必要项目准备。缺少 canonical setup 时不猜通用命令，也不新增 readiness lifecycle。
2. controller 生成 task-brief.md，按 [IMPLEMENTER-SUBAGENT.md](IMPLEMENTER-SUBAGENT.md) 派发唯一业务 writer。fresh Implementer 完整读取当前 Task、Execution、brief、适用 Architecture、Rules、源码与测试；resume 使用完整 Reread / Unchanged 声明。
3. source-authoritative 任务按 baseline-only Dispatch A → controller live 复验 → adaptation authorization → Dispatch B 的顺序执行；普通任务单次派发。
4. Implementer 通过 final message 返回 changed files、validation 与 blocked reason。controller 对照 live diff、允许/禁止路径和真实验证输出接收，不读取 task-report.json。
5. 按 commitPolicy 固定当前 source，并运行 snapshot-target。输出直接进入当前 review package，不写 target.json。
6. 首次 General Full 与 policy 要求的 Rules Full 组成 Initial Discovery JOIN。两个 concern 都达到合法终态前不形成 repair input。
7. JOIN 有 findings 时应用 initialRepairPolicy；可执行 repair 仍必须由已有 authority 唯一推出，新增语义、公共契约、授权或用户判断时回流 upstream。
8. repair 后运行因果范围内的 targeted/affected validation，固定新 source，派发 General Scoped 与适用 Rules Scoped；cannot-bound 只升级对应 domain 的 Full。
9. controller 用一个 Markdown audit 条目合并当前 repair wave。任一 domain 有 findings，整轮只计一次失败；连续四轮失败后停止自动 repair。不要写 review-wave JSON block。
10. review clean 后按 acceptancePolicy 处理当前 source 的 upstream acceptance。验收直接记录在 audits.md，不创建状态文件。
11. 最后一次修改与 review repair 之后，按项目指令在 live task workspace 重新运行完整测试套件，并确认 HEAD/dirty 状态未再次变化；失败就停止，不形成完成 handoff。

任何实现、验证或 Task Review 如果发现完成 Task 必须新增或修改 Architecture，立即停止业务 writer，路由 $architecture-steward。人确认后更新 execution binding、重新校验并完整重读适用输入；Task authority 未变化时可复用原 Implementer。

Task Reviewer 只审查当前 Task correctness。Architecture Drift Review 由后续 integrate-delivery 在 live source 上 fresh 执行：architecturePath 非 null 时检查 base → source 是否偏离已确认 [x] 决定；null 分支不搜索 Architecture。

## Review Wave 与有限返修

- 首次 Full discovery 不计 repair wave；只有实际 repair 后合并仍有 finding 才增加一次失败。
- 每轮记录 previous/current source、repair inputs、实际 delta、验证命令、General/Rules 结论与 merged findings。标题编号只用于阅读和引用，不是 schema。
- 同一 task revision 最多四个 failed waves。第 4 次后不再自动修改业务文件；需要改变合同、授权或用户判断时回流 upstream，否则报告 blocker。
- scoped reviewer 未返回、越界写文件或无法绑定输入时，同一输入最多 fresh 重派一次；不能靠重派洗掉负结论。
- repair 超出原 finding 因果范围时，当前 Task/Execution 内可重新界定就升级受影响 domain 的 Full；需要扩张 immutable authority 时停止。

精确的 Task、Execution、Markdown audits 与 artifacts 角色见 [TASK-CONTRACT.md](TASK-CONTRACT.md)。`deep-rules-review` v8 只负责 Rules Full；Rules Scoped Repair Verification 由 deliver-task reviewer 执行。

## 完成、回流与阻塞

不写持久化 result enum：

- 当前实现、验证、General/Rules Review、适用 acceptance 与 final fresh verification 全部闭合时，报告“实现完成”并返回 live handoff。
- 需要改变 Task、授权、公共契约或取得用户判断时，直接说明需要 upstream 决定的分叉和依据。
- 合同不变但环境、工具或四轮返修后仍无法继续时，直接说明 blocker 与保留现场。

“实现完成”只描述当下 task workspace，不表示已经 merge、push、发布或完成 caller 的计划。

## Live handoff

最终只返回：

- workspacePath 与 taskDir；
- branch 或 detached HEAD、完整 baseCommit 与 HEAD OID；
- committed clean / uncommitted / no-change；
- final fresh verification 的实际命令与结果；
- architecturePath 的 path/null；
- 未闭合风险或下一步所需决定。

不创建 claims.json、delivery.json、task-report.json、target.json，不运行 validate-result 或 close-check，也不要求下游相信 audits。需要收尾时交给 integrate-delivery；它重新验证 live source，再让人选择本地合并、PR/MR 或保留，并只在安全条件下 cleanup。
