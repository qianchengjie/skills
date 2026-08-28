# deliver-task 脚本

脚本只承担可确定、可复现的 workspace、Task、execution、Git target 与路径边界检查。实现正确性、review、acceptance 和 closeout 由 agent 在 live Git 状态上判断，不编码成 delivery schema。

## Bootstrap

从 stdin 提供完整 task contract：

~~~bash
node <deliver-task-skill-dir>/scripts/deliver-task.mjs start <repo> - < task-contract.json
~~~

已有 caller/harness isolated workspace 时显式绑定：

~~~bash
node <deliver-task-skill-dir>/scripts/deliver-task.mjs start <repo> - --workspace <workspacePath> < task-contract.json
~~~

start 在 mutation 前校验 repository、task exact schema、完整 baseCommit 和 provided workspace。成功时输出 task binding、taskDir、workspacePath、kind、branch 和 baseCommit；它不表示 execution、setup、实现或验证已经完成。

## 命令

| 命令 | 机械作用 |
| --- | --- |
| start | 创建或绑定 task workspace，并初始化最小 .dev-task state |
| task-hash | 输出 authoritative task.json 的 canonical hash |
| validate-execution | 校验 execution exact schema、Task/Architecture binding、路径和 evidence refs |
| snapshot-target | 检查当前 Git 与路径边界，输出当前 commit-range、worktree 或 no-change identity |

调用形式：

~~~bash
node <deliver-task-skill-dir>/scripts/deliver-task.mjs <command> <taskDir>
~~~

不存在 validate-result、close-check 或隐式 bootstrap。退出码 0 表示通过，1 表示门禁失败，2 表示参数或命令错误。

## start 与 workspace

- 优先绑定 caller、harness linked worktree 或 harness native workspace；都不可用时才使用默认 fallback。
- 默认 fallback 从 task.baseCommit 在 repo 的 .worktrees/ 下创建 worktree。该目录必须已被 Git ignore；脚本不修改 ignore 配置。
- .dev-task/ 只初始化 task.json、audits.md、artifacts/workspace.json 和内容固定为星号的 .gitignore。execution.json 在 preflight 后由 controller 创建。
- 不创建 claims.json、delivery.json、task-report.json 或 target.json。
- exact Task identity 且必要 state 完整时幂等返回。同 revision 合同漂移、task branch/worktree 存在但必要 state 损坏时 fail closed。
- 同一 taskId + baseCommit 的 higher revision 复用当前 workspace。事务快照只保护 task.json 与 workspace locator；audits.md 作为追加记录保留。
- provided workspace 必须属于同一 repository、HEAD 等于 baseCommit 且业务区 clean。脚本不推断其是否真实独占。
- 不提供 merge、rebase、cherry-pick、push、cleanup 或 proof recovery 命令。

## executionHash

executionHash 只覆盖执行语义边界：

- schemaVersion；
- Task binding；
- allowedPaths / forbiddenPaths；
- architecturePath。

evidenceRefs 只记录 provenance，不进入 hash。因此依据位置变化不会让相同执行边界产生新 identity；路径或 Architecture binding 变化仍会改变 hash。

## snapshot-target

- required：有业务变化时必须形成 clean commit-range。
- allowed：可输出 commit-range、worktree 或 no-change。
- forbidden：HEAD 必须保持 baseCommit，只输出 worktree 或 no-change。
- 所有业务路径必须命中 execution.allowedPaths，且不命中 task.forbiddenPaths 与 execution.forbiddenPaths。
- .dev-task/ 即使被强制加入 index 或 commit，也会被路径边界拒绝。
- commit-range 必须以 baseCommit 为祖先，并且 task workspace 没有额外业务 dirty。
- worktree snapshot hash 绑定排序后的路径、regular-file mode 与内容 hash。
- 输出包含 executionHash，供当前 review package 和自然语言 handoff 使用；脚本不把它写成 durable target artifact。

## 机器校验边界

机器检查：

- Task、execution、workspace locator 的 exact schema 与 binding；
- Git commit identity、祖先关系、branch/worktree 定位；
- provided workspace 的 base/clean 条件和 fallback ignore 条件；
- Architecture path/null 的字段终态、路径、可读性与显式 checklist 闭合；
- allowed/forbidden 路径；
- execution evidence ref 是否定位到存在的 audits.md 条目；
- commit-range 或 worktree snapshot 的确定性 identity。

机器不检查：

- Task、Architecture 或 evidence 的语义是否正确；
- 人是否真的作出 path/null 或 policy 决定；
- rules applicability、测试充分性、review finding、acceptance 或 repair 判断；
- source 是否已经满足 closeout；
- handoff 是否仍与未来的 live Git state 一致。

这些内容由 controller/reviewer 现场判断，并以简洁 Markdown 记录。后续 closeout 重新验证 live source，不读取本脚本不存在的 delivery closure。
