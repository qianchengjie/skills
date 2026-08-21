---
name: deliver-task
description: Use when 用户或上游 skill 已提供边界明确的软件开发任务，需要在不创建正式多任务计划的前提下完成实现、验证、独立审查、返修和交付结果收口。
disable-model-invocation: true
---

# 单任务交付

## 第一原则

完成一个任务，返回一个交付结果；不接管 caller 的生命周期。

- 输入是一个已明确目标、验收、约束、用户禁止范围和调用策略的开发任务；具体执行路径由本 skill 读取真实上下文后确定。
- 输出只是一份 `delivered / needs-upstream / needs-reslice / blocked` 单任务结果。
- 只写 task-owned directory 和任务授权的业务文件；不写 caller 的 plan、slice 状态、当前指针、P/K/F 或最终 closure。
- 可以自行安排任务内部的实现步骤；不创建或管理正式多任务计划。
- 发现多个可独立验收、独立交付的工作单元时，立即返回 `needs-reslice`，不把它们伪装成内部步骤继续执行。
- 目标、验收、公共契约、用户禁止范围、调用策略或用户判断需要变化时，立即返回 `needs-upstream`。直接调用时用户就是 upstream；由其它 skill 委托时只向 caller 回流，不越过 caller 直接询问用户。

## 输入与目录

使用 [TASK-CONTRACT.md](TASK-CONTRACT.md) 的 `task.json` 作为调用契约。

- 直接调用：默认使用 `dev-tasks/YYYY-MM-DD-<slug>/`；根据用户原始任务写入 `task.json`，`caller` 固定为 `{ "kind": "direct" }`。
- 上游委托：使用 caller 提供的 task directory；caller 写 `task.json`，使用通用 `{ "kind": "delegated", "name", "ref" }`，本 skill 不修改 caller 状态文件。
- `sliced-dev` 委托只是通用 delegated caller 的一个实例：目录固定在该 plan 的 `deliveries/<taskId>/`，`name=sliced-dev`，`commitPolicy=required`。
- caller 只提供 immutable task contract，不填写 `execution.json`。deliver-task 在 preflight 后创建和维护该文件。

开始时运行：

```bash
node <deliver-task-skill-dir>/scripts/deliver-task.mjs validate-task <taskDir>
node <deliver-task-skill-dir>/scripts/deliver-task.mjs init <taskDir>
```

`init` 只能在 task directory 内创建 `claims.json`、`audits.md`、`.gitignore` 和
`artifacts/`，不会替 caller 预填 `execution.json`。任何 caller 状态变化都由 caller 在收到结果后决定。

## 开始前判断

按以下顺序做一次公开、可审计的判断：

1. 读取 `task.json`、必要代码上下文、当前工作区状态和适用项目 rules。
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

不要把 `needs-reslice` 变成新的 `plan.md`，也不要在 task directory 内新建 slice、ticket、里程碑或任务状态机。

## commitPolicy

Git 提交是调用策略，不是 `delivered` 的普遍定义。

| 值 | 行为 | 合法 target |
| --- | --- | --- |
| `required` | 代码变化必须先形成 caller 已授权的业务 commit；无变化不创建空 commit | `commit-range` / `no-change` |
| `allowed` | 可根据调用契约、仓库习惯和任务收口需要选择提交或保留未提交 | `commit-range` / `worktree` / `no-change` |
| `forbidden` | 禁止创建业务 commit；不得以“需要提交”污染普通成功结果 | `worktree` / `no-change` |

- `required` 表示 caller 已授权本任务创建业务 commit，不需要再次询问同一权限。
- `allowed` 未选择提交或 `forbidden` 本身不产生 `needs-upstream`。
- `push / merge / publish` 永远不属于默认能力。
- 若适用的既有审查工具只接受 commit TARGET，而 `forbidden` 使必要审查无法执行，记录能力冲突并返回 `needs-upstream`；不得静默跳过审查或擅自改变 policy。

提交或保留工作区结果后，运行：

```bash
node <deliver-task-skill-dir>/scripts/deliver-task.mjs snapshot-target <taskDir>
```

把输出原样用作 `delivery.json.target` 和本轮 review package 的 target identity。

## 执行闭环

完整执行规则见 [EXECUTION-RULES.md](EXECUTION-RULES.md)。固定顺序是：

1. 生成 `artifacts/task-brief.md` 和默认 blocked 的 `artifacts/task-report.json`。
2. 按 [IMPLEMENTER-SUBAGENT.md](IMPLEMENTER-SUBAGENT.md) 派发 fresh implementer；共享工作区同时只允许一个业务文件 writer。
3. 接收后按当前 `execution.json` 及 task/execution 两层 forbidden paths 核对实际 diff、task report 和 claims，运行任务验证。
4. 按 `commitPolicy` 固定 commit range、worktree snapshot 或 no-change target。
5. 生成绑定 task、execution、target 三个 identity 的 review package，按 [REVIEWER-SUBAGENT.md](REVIEWER-SUBAGENT.md) 派发独立 General Review。
6. finding 进入有限 `repair → re-verify → review`；发生过 repair 后必须再做最终累计 full。
7. General clean 后按 `acceptancePolicy` 处理 upstream acceptance；`required` 且当前 target 没有 `passed / skipped` A 条目时返回 `needs-upstream / user-acceptance`。验收结果留在 `audits.md`，不改变 task identity，也不使同一 target 的 General evidence stale。
8. 按当前单片语义执行适用的最终 rules-review；finding 返修后重新固定 target、重做 General，随后 fresh full 或合法的一跳 repair verification。
9. 把事实证据分别写入 `claims.json`、`audits.md`、review 工件和 rules-review run；最后只在 `delivery.json` 写引用。
10. 运行 `validate-result`；仅 `delivered` 再运行 `close-check`。

## 有限返修

- General Review、验证、用户拒收或项目规则 finding 触发返修时，先把失败依据写入 `audits.md`，再刷新 brief。用户拒收但 immutable task contract 未变化时保持同一 task identity；返修形成新 target 后旧验收证据自然失效。
- 同一任务最多自动修改业务文件 4 次；只有实际修改任务范围内文件才计次。
- 安全返修优先复用原 implementer；目标、验收、公共契约、用户禁止范围、调用策略或 claims 契约实质变化时停止并回流。
- 结构合法的负审查结论不能靠重派 reviewer 洗掉。reviewer 未返回、越界写文件或结果无法绑定输入时，同一输入最多 fresh 重派一次。
- 次数用尽、工具持续不可用或现有边界内无法完成时返回 `blocked`，保留当前证据引用。

## 结果选择

| result | 使用条件 | upstreamRequest.kind |
| --- | --- | --- |
| `delivered` | 当前 task、execution、target 的目标、验证、General Review、适用 acceptance 和 rules-review 已闭合 | `null` |
| `needs-upstream` | 需要 upstream 改变 immutable task contract、授权或提供用户判断 | 对应 change / `user-acceptance` |
| `needs-reslice` | 当前合同实际含多个独立工作单元 | `reslice` |
| `blocked` | 合同不变时仍因环境、工具或不可恢复条件无法完成 | `blocker` |

`delivered` 只表示这个任务已交付，不表示 caller 的 slice done、计划完成、可 merge、可发布或整体 closure。

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

最终只向 upstream 返回：result、`delivery.json` 路径、target 摘要、关键 evidence refs 和需要 upstream 决定的下一步。不要替 upstream 写状态。
