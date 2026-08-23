---
name: deliver-task
description: Use when 用户或上游 skill 已提供边界明确的软件开发任务，需要在 task-scoped isolated workspace 中完成实现、验证、提交、独立审查、返修和交付结果收口。
disable-model-invocation: true
---

# 单任务交付

## 第一原则

在 task-scoped isolated workspace 中完成一个任务，返回一个交付结果；不接管 caller 的生命周期，也不负责把结果集成回 caller workspace。

- 输入是一个已明确目标、验收、约束、用户禁止范围和调用策略的开发任务；`task.json` 是 deliver-task 内的 authoritative execution contract，不是 upstream authority 的授权证明；其中承载 authority 的文本必须按 [TASK-CONTRACT.md](TASK-CONTRACT.md) 从可见 upstream authority 机械摘录。implementer 必须直接读取，派生 brief 不能覆盖或弱化它；具体执行路径由本 skill 读取真实上下文后确定。
- 输出只是一份 `delivered / needs-upstream / needs-reslice / blocked` 单任务结果。
- task workspace 内的 `.dev-task/` 保存合同、证据和本地执行定位；业务代码与证明状态共享同一个 isolated workspace 生命周期。不写 caller 的 plan、任务编排状态或最终 closure。
- 可以自行安排任务内部的实现步骤；不创建或管理正式多任务计划。
- 发现多个可独立验收、独立交付的工作单元时，立即返回 `needs-reslice`，不把它们伪装成内部步骤继续执行。
- 目标、验收、公共契约、用户禁止范围、调用策略或用户判断需要变化时，立即返回 `needs-upstream`。直接调用时用户就是 upstream；由其它 skill 委托时只向 caller 回流，不越过 caller 直接询问用户。

## 输入与目录

使用 [TASK-CONTRACT.md](TASK-CONTRACT.md) 的 exact task contract 作为 stdin 调用契约。

- 直接调用：按合同的 source-fidelity 规则，把用户原始 authority 机械摘录成结构化合同，`caller` 固定为 `{ "kind": "direct" }`。
- 上游委托：caller 对其实际收到的 upstream authority 负责，只传递按同一规则机械摘录的 immutable task contract，使用通用
  `{ "kind": "delegated", "name", "ref" }`；caller 不创建 task directory、不落盘 task state，
  也不填写 `execution.json`。
- deliver-task 在 preflight 后创建和维护 `execution.json`；`start` 不提前生成。

`deliver-task` 不能证明未随合同提供的 upstream source fidelity；把 caller 或 AI 生成的摘要写进
`task.json` 也不会使它自动获得 upstream authority。只有可见的更高层 authority 明确委托某个中间
载体承载相应决定时，caller 才能从该载体摘录。若执行中从可见 upstream evidence 发现合同本身已
弱化，按 contract revision 回流，不继续当前实现 lineage。

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

exact identity 且 `.dev-task/` 完整时 `start` 幂等返回，不重写证据。同 revision 合同漂移，或
已有 task branch/worktree 但 `.dev-task/` 缺失、不完整时 fail closed；不得根据 commits、branch、
聊天摘要或重建 locator 推断历史证明。higher revision 默认建立新的 branch/worktree；provided
workspace 已含旧 identity 时拒绝覆盖。任何 caller 状态变化都由 caller 在收到结果后决定。

## 开始前判断

按以下顺序做一次公开、可审计的判断：

1. 只在已绑定的 task workspace 中读取必要代码上下文、Git 状态和适用项目 rules；caller workspace 的 HEAD、dirty 和同名文件都不是本任务上下文。
2. 区分实现步骤与独立工作单元：
   - 多个步骤共同完成同一验收结果，可在任务内部安排；
   - 任一部分可独立验收、独立发布或失败后不阻塞另一部分，返回 `needs-reslice`。
3. 检查是否需要改变 immutable task contract；需要时返回 `needs-upstream`。用户未提供文件清单本身不是回流条件。
4. 在 `audits.md` 记录上下文预检、允许/禁止路径、非目标、停止条件、规则读取和判断依据。
5. 根据上述真实上下文创建当前 `execution.json`，运行：

```bash
node <deliver-task-skill-dir>/scripts/deliver-task.mjs validate-execution <taskDir>
```

6. 在 `claims.json` 写当前任务要证明的 claims；不得提前声明验证、General Review、rules-review 或 close-check 已通过。

同一授权目标内需要调整执行路径时，先追加审计依据，再原地更新 `execution.json`；不递增 task revision/hash。若调整命中 `task.forbiddenPaths` 或要求改变 immutable task contract，才回流 upstream。

不要把 `needs-reslice` 变成新的 `plan.md`，也不要在 `.dev-task/` 内新建 slice、ticket、里程碑或任务状态机。

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

## 执行闭环

完整执行规则见 [EXECUTION-RULES.md](EXECUTION-RULES.md)。固定顺序是：

1. 生成引用 `task.json` 的派生 `artifacts/task-brief.md` 和默认 blocked 的 `artifacts/task-report.json`；每次 implementer 派发都要求重读 `task.json`、`execution.json` 与 brief。
2. controller 根据 `task.json` 语义判断是否命中具名源码的强制复制/移植要求。普通任务按 [IMPLEMENTER-SUBAGENT.md](IMPLEMENTER-SUBAGENT.md) 单次派发 fresh implementer；命中时先做 baseline-only Dispatch A 并停止，controller 对 live baseline 独立复验并在 `audits.md` 记录 accepted baseline A，再追加绑定它的 adaptation authorization A，最后才派发明确引用该 authorization 的 Dispatch B。task workspace 同时只允许一个业务文件 writer。
3. 接收后按当前 `execution.json` 及 task/execution 两层 forbidden paths 核对实际 diff、task report 和 claims，运行任务验证；source-authoritative 分支的实现接收与验证证据继续引用 Dispatch B 的 authorization。
4. 按 `commitPolicy` 固定 commit range、worktree snapshot 或 no-change target。
5. 生成绑定 task、execution、target 三个 identity 的 review package，按 [REVIEWER-SUBAGENT.md](REVIEWER-SUBAGENT.md) 派发独立 General Review。
6. finding 进入有限 repair。repair 返回后先按 [EXECUTION-RULES.md](EXECUTION-RULES.md)
   核对实际 repair delta：只有严格满足 non-semantic invariant 时进入单跳 lightweight repair
   closure；其余情况继续既有 `repair → 完整 re-verify → review → 最终累计 full`。
7. General clean 后按 `acceptancePolicy` 处理 upstream acceptance；`required` 且当前 target 没有 `passed / skipped` A 条目时返回 `needs-upstream / user-acceptance`。验收结果留在 `audits.md`，不改变 task identity，也不使同一 target 的 General evidence stale。
8. 按当前单片语义执行适用的最终 rules-review；finding 返修默认重新固定 target、重做
   General 和 rules-review fresh full。只有实际 delta 通过同一个 non-semantic invariant 时，才由
   deliver-task 写 lightweight closure；这不是 rules-review incremental run。
9. 把事实证据分别写入 `claims.json`、`audits.md`、review 工件和 rules-review run；最后只在 `delivery.json` 写引用。
10. 运行 `validate-result`；仅 `delivered` 再运行 `close-check`。

## 有限返修

- General Review、验证、用户拒收或项目规则 finding 触发返修时，先把失败依据写入 `audits.md`，再刷新 brief。用户拒收但 immutable task contract 未变化时保持同一 task identity；返修形成新 target 后旧验收证据自然失效。
- 同一任务最多自动修改业务文件 4 次；只有实际修改任务范围内文件才计次。
- 安全返修优先复用原 implementer；目标、验收、公共契约、用户禁止范围、调用策略或 claims 契约实质变化时停止并回流。
- 结构合法的负审查结论不能靠重派 reviewer 洗掉。reviewer 未返回、越界写文件或结果无法绑定输入时，同一输入最多 fresh 重派一次。
- 次数用尽、工具持续不可用或现有边界内无法完成时返回 `blocked`，保留当前证据引用。

### Review 后的 non-semantic repair

该路径只处理 General 或 rules-review finding 的直接返修，不适用于首次实现、验证失败、用户拒收或
任意局部语义修改。controller 必须审查实际 repair delta，而不是 finding 文案、计划、文件数或修改
行数；以下条件全部有正向证据时才 eligible：

- task / execution identity 与公共契约未变，直接前序 reviewed target 及其完整 evidence 可访问；
- 每个 changed hunk 都只为直接前序 open finding 所要求，全部 finding 已 addressed，且没有额外修改；
- 每个 hunk 都有适合当前语言或工件的机械证据，明确证明程序语义及 API / type / schema / 数据、
  配置、build、test、依赖、字符串协议、序列化、共享 helper / consumer 关系未变；
- 新运行的直接 finding verification 与最小机械验证均通过。

formatter-only、whitespace / indentation / wrapping、惰性 comment 格式和明确 typo / 展示格式修正可以
成为候选，但类别名本身不是证明；例如语义相关缩进、directive comment、协议字符串或测试 snapshot
仍不 eligible。除已证明不承担程序或协议语义、且被 finding 精确指定的 typo / 展示文本修正外，
runtime behavior、expression / condition / control flow、API / type / schema / 数据结构、dependency /
config / build / test、可能影响程序引用或协议的 rename、mixed diff、额外修改或任何不确定情况，
都进入原完整返修链。

eligible closure 只能从一个直接前序非 closure review 单跳建立，不递归继承另一个 closure。它复用
返修前仍成立的 validation / General / rules-review evidence，只新建 repair delta、finding
verification、直接机械验证、当前 target 与 closure A；required acceptance 仍按新 target 重新取得，
尚未执行的下游 review 仍正常执行。精确记录和 binding 见 [TASK-CONTRACT.md](TASK-CONTRACT.md)。

## 结果选择

| result | 使用条件 | upstreamRequest.kind |
| --- | --- | --- |
| `delivered` | 当前 task、execution、target 的目标、验证、General Review、适用 acceptance 和 rules-review 已闭合 | `null` |
| `needs-upstream` | 需要 upstream 改变 immutable task contract、授权或提供用户判断 | 对应 change / `user-acceptance` |
| `needs-reslice` | 当前合同实际含多个独立工作单元 | `reslice` |
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

其中 `delivery.evidenceRefs.acceptance` 在 `acceptancePolicy=not-required` 时为 `null`，否则引用绑定当前 target 的验收 A 条目。非 `delivered` 的 `upstreamRequest.evidenceRefs` 至少一项，且都引用存在的 task-owned evidence。

机器只检查 schema、task/execution/target binding、Git target、路径边界、引用存在和明确终态；不判断实现正确性、证据强度、reviewer 判断、验收理由或规则语义。命令细节见 [SCRIPTS.md](SCRIPTS.md)。

最终只向 upstream 返回：result、`delivery.json` 路径、target 摘要、task workspace 路径与 branch identity、关键 evidence refs 和需要 upstream 决定的下一步。不要替 upstream 写状态，也不要自动清理或集成 task worktree；需要处理已交付结果时，交给 `$integrate-delivery`。
