# deliver-task 脚本

## 唯一 bootstrap

从 stdin 提供一个完整 task contract：

```bash
node <deliver-task-skill-dir>/scripts/deliver-task.mjs start <repo> - < task-contract.json
```

caller、当前 harness linked worktree 或 harness 原生机制已经提供 isolated workspace 时显式绑定：

```bash
node <deliver-task-skill-dir>/scripts/deliver-task.mjs start <repo> - --workspace <workspacePath> < task-contract.json
```

`start` 在创建任何状态前校验 repo、stdin `deliver-task.task.v1` exact schema、完整 `baseCommit` 和
provided workspace。它只建立 task workspace 与 task proof bootstrap；成功不表示 execution 已有效或
任务已可执行。成功时固定输出：

```json
{
  "task": {
    "taskId": "fix-slug-whitespace",
    "revision": 1,
    "taskHash": "sha256:..."
  },
  "taskDir": "/absolute/task-worktree/.dev-task",
  "workspacePath": "/absolute/task-worktree",
  "kind": "git-worktree",
  "branch": "refs/heads/deliver-task/fix-slug-whitespace-r1-0123456789ab",
  "baseCommit": "完整 Git commit OID"
}
```

后续命令只接受该输出中的 live `taskDir`：

```bash
node <deliver-task-skill-dir>/scripts/deliver-task.mjs <command> <taskDir>
```

## 命令

| 命令 | 作用 |
| --- | --- |
| `start` | 校验 stdin 合同，创建或绑定 isolated workspace，并原子初始化 `.dev-task/` |
| `task-hash` | 输出已有 task state 的 canonical task hash |
| `validate-execution` | 校验 deliver-owned `execution.json`、task binding、Architecture binding、路径和 evidence refs，并输出 canonical execution hash |
| `snapshot-target` | 从当前 execution boundary 按 commitPolicy 输出带 execution hash 的薄 target identity |
| `validate-result` | 校验 delivery schema、identity binding、Review Wave history/count、acceptance、non-delivered evidence 和薄结构 |
| `close-check` | 对 delivered 重验 claims、evidence refs、review-wave/acceptance binding 与当前 Git target |

退出码：`0` 通过，`1` 协议或门禁失败，`2` 参数/路径错误。

## start identity 与事务边界

- 调用方优先使用 caller 已提供、满足边界的当前 harness linked worktree 或 harness 原生机制
  建立的 workspace，并通过 `--workspace` 显式绑定；三者都不可用时才进入默认模式。
- 默认模式从 `task.baseCommit` 在 `<repo>/.worktrees/` 下创建 Git worktree；branch 固定为
  `deliver-task/<taskId>-r<revision>-<taskHash前12位>`。创建前要求 `.worktrees/` 已被 Git
  ignore；脚本不修改 ignore 配置，未命中时 fail closed。
- `.dev-task/` 与业务代码共享 task worktree 生命周期，包含 `task.json`、`claims.json`、
  `audits.md`、`artifacts/workspace.json` 和内容为 `*` 的 `.gitignore`；`execution.json`
  只在 preflight 后由 controller 创建。
- exact identity 且上述状态完整时幂等返回，不重写证据。同 revision 合同漂移，或 task
  branch/worktree 已存在但证明状态缺失、不完整时 fail closed，不从 commit、branch、摘要或
  locator 推断历史证明。
- 默认模式的 higher revision 创建新 branch/worktree。provided workspace 已存在任何其它
  task identity 时拒绝覆盖。
- 失败只回滚本次创建的 `.dev-task/`、worktree 和 branch。provided workspace 的原有内容、
  既有 worktree 和既有 branch 不删除。
- provided workspace 首次绑定必须属于同一 Git repository、`HEAD == task.baseCommit` 且业务区
  干净；它可以来自 caller、当前 harness linked worktree 或 harness 原生机制。运行环境负责保证
  它真实独占，机器不推断这一语义事实。
- 不提供证明恢复、旧 taskDir 迁移、清理、同步、merge、cherry-pick、rebase、push 或 publish
  命令。
- task 只使用 `deliver-task.task.v1`；当前第一版上线前不保留中间 task v2 或 legacy binding 兼容。
- `execution.json` 必须显式包含 `architecturePath`。`null` 不访问 Architecture；非 null 时要求规范化
  绝对路径、文件名为 `ARCHITECTURE.md`、文件可读、至少有一个 `[x]` 且没有 `[ ]`。后续命令
  重新检查同一 live 文件；不复制正文，不建立 Architecture hash/version。

## snapshot-target

- `required` 有业务变化但 `HEAD == baseCommit` 时失败；提交后输出 `commit-range`。
- `allowed` 可输出 `commit-range / worktree / no-change`。
- `forbidden` 要求 `HEAD == baseCommit`，只输出 `worktree / no-change`。
- commit range 或 worktree 中的每个业务路径都必须命中 `execution.allowedPaths`，且不命中
  `task.forbiddenPaths ∪ execution.forbiddenPaths`。
- `.dev-task/` 默认被自身 `.gitignore` 忽略；若被强制加入 index、worktree target 或 commit
  range，路径边界仍拒绝。
- commit-range 的 dirty/freshness 只检查绑定 task workspace；caller workspace 的 HEAD、dirty、
  index 和同名文件不参与判断。task workspace 自身仍有额外修改时失败。
- worktree hash 绑定排序后的路径、regular-file mode 和内容 hash；删除使用明确 deleted 记录。
- 三种 live target 都包含当前 canonical `executionHash`；execution 变化会使旧 target 和旧 review
  binding 不能作为当前 delivery proof。已追加的 Review Wave history 保留旧 target 的自身 identity，
  由最新 wave 重新绑定当前 execution。

## 机器校验边界

目标类型是结构格式校验、流程状态门禁、Git identity 和路径边界检查。机器可确定：

- JSON exact schema、枚举、task hash 和 execution hash；
- `execution.architecturePath` 字段存在且为 `null` 或合规绝对路径；非 null 时检查文件名、可读性，
  以及文本中显式 `[x]` 存在与 `[ ]` 缺失；
- workspace locator 的 exact schema、task/base/branch 绑定、canonical Git root、初始 clean 状态和
  base 祖先关系；
- 默认 fallback 的 `.worktrees/` 是否已被 Git ignore；
- Git commit identity、祖先关系、worktree snapshot hash；
- execution allowlist、两层 forbidden path 和 `.dev-task/` 写边界；
- claim 明确终态与 evidence ref 存在；
- General 的 task/execution/target 显式绑定；
- Review Wave 的 exact block、连续 wave 编号、跨 execution 的直接前序/当前 target chain、历史自身
  identity 与最新 current execution binding；
- scoped / Full A 的 task/execution/target/domain/mode/result exact binding、所有 wave refs 的先于
  wave 顺序、merged result、累计 failed-wave 计数与 4 次停止边界；
- acceptance 的 task/target/status 显式绑定及 task-owned evidence ref 存在；
- non-delivered request 的 kind、非空 evidence refs 及存在性；
- delivery 没有内嵌完整证据。

机器明确不检查：人是否真实确认过 `execution.architecturePath` 的 path / null 决定、Architecture 内容是否正确/完整/属于架构域、checkbox 的人工确认是否真实，provided workspace 是否真实独占、目标是否正确、验收是否充分、targeted / affected
validation 是否足以覆盖实际 repair delta、影响面是否可可靠限定、scoped reviewer 是否应返回
`clean / findings / cannot-bound`、Full 升级是否语义上必要、review finding 是否正确、rules 是否适用、
回流理由是否正确、证据强度或用户确认真实性。这些由运行环境保证，或由 controller/reviewer 裁决并
记录在 audits/rules-review run。
