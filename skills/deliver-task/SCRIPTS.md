# deliver-task 脚本

从项目 Git 根目录执行：

```bash
node <deliver-task-skill-dir>/scripts/deliver-task.mjs <command> <taskDir>
```

首次进入任务时，在 preflight 前显式建立或绑定 workspace：

```bash
node <deliver-task-skill-dir>/scripts/deliver-task.mjs prepare-workspace <taskDir>
node <deliver-task-skill-dir>/scripts/deliver-task.mjs prepare-workspace <taskDir> --workspace <workspacePath>
```

## 命令

| 命令 | 作用 |
| --- | --- |
| `validate-task` | 校验 immutable `task.json` exact schema、caller、用户禁止路径、policy 和 baseCommit |
| `task-hash` | 输出 canonical task hash |
| `prepare-workspace` | 绑定 caller/native isolated workspace、复用满足条件的当前 linked worktree，或在仓库内创建 task-scoped Git worktree，并写本地 locator |
| `init` | 初始化 claims/audits/.gitignore/artifacts；缺少 locator 时只复用当前 linked worktree 或执行仓库内手工 fallback |
| `validate-execution` | 校验 deliver-owned `execution.json`、task binding、路径和 evidence refs，并输出 canonical execution hash |
| `snapshot-target` | 从当前 execution boundary 按 commitPolicy 输出带 execution hash 的薄 target identity |
| `validate-result` | 校验 delivery schema、identity binding、acceptance、non-delivered evidence 和薄结构 |
| `close-check` | 对 delivered 重验 claims、evidence refs、review/acceptance binding 与当前 Git target |

退出码：`0` 通过，`1` 协议或门禁失败，`2` 参数/路径错误。

## prepare-workspace

- `--workspace` 绑定 caller 提供、当前 harness 已建立或 harness 原生机制新建的 isolated
  workspace。首次绑定要求 `HEAD == task.baseCommit`，且 taskDir 之外没有 tracked/untracked
  修改。
- 无 `--workspace` 时，若当前 Git root 是非 submodule 的 linked worktree，且
  `HEAD == task.baseCommit`、taskDir 外干净，则直接复用当前 workspace；否则从
  `task.baseCommit` 在 `<repo>/.worktrees/deliver-task-...` 创建 Git worktree 和 task 专用
  branch。branch 与目录名都由 task identity 确定；locator 丢失时可重新发现同一已注册
  worktree，不新建第二个执行世界。
- 手工 fallback 前要求目标 `.worktrees/` 路径已被 Git ignore。脚本不修改 ignore 规则；
  未 ignore 或 Git 因 sandbox 权限拒绝创建时 fail closed，不改用系统临时目录，也不退回
  未隔离的主 checkout。
- locator 使用 exact `deliver-task.workspace.v1`，绑定 task identity、canonical absolute
  workspace root、branch identity 和 baseCommit。后续 HEAD 必须仍从 base 向前，branch 不得变更。
- locator 不进入 task/execution/target hash，不增加 workspace revision 或 lifecycle。
- 同一 taskId 的更高 task revision 建立新 workspace；同 revision 的 task hash 漂移 fail closed。
- `prepare-workspace` 之后，`init / validate-execution / snapshot-target / validate-result /
  close-check` 的 Git 读取都定向到该 task workspace；task 合同和 evidence refs 仍从 taskDir 读取。
- 不提供清理、同步、merge、cherry-pick、rebase、push 或 publish 命令。

## snapshot-target

- `required` 有业务变化但 `HEAD == baseCommit` 时失败；提交后输出 `commit-range`。
- `allowed` 可输出 `commit-range / worktree / no-change`。
- `forbidden` 要求 `HEAD == baseCommit`，只输出 `worktree / no-change`。
- commit range 或 worktree 中的每个业务路径都必须命中 `execution.allowedPaths`，且不命中 `task.forbiddenPaths ∪ execution.forbiddenPaths`。
- taskDir 自身不进入业务 target；若被提交进业务 range，失败。
- commit-range 的 dirty/freshness 只检查绑定 task workspace；caller workspace 的 HEAD、dirty、
  index 和同名文件不参与判断。task workspace 自身仍有额外修改时失败。
- worktree hash 绑定排序后的路径、regular-file mode 和内容 hash；删除使用明确 deleted 记录。
- 三种 target 都包含当前 canonical `executionHash`；execution 变化会使旧 target 和旧 General binding 失效。

## 机器校验边界

目标类型是边界检查和流程终态门禁。机器可确定：

- JSON exact schema、枚举、task hash 和 execution hash；
- workspace locator 的 exact schema、task/base/branch 绑定、canonical Git root、初始 clean 状态和 base 祖先关系；
- 当前 Git root 是否是非 submodule 的 linked worktree，以及手工 fallback 目标是否被 Git ignore；
- Git commit identity、祖先关系、worktree snapshot hash；
- execution allowlist、两层 forbidden path 和 taskDir 写边界；
- claim 明确终态与 evidence ref 存在；
- General 的 task/execution/target 显式绑定；
- acceptance 的 task/target/status 显式绑定及 task-owned evidence ref 存在；
- non-delivered request 的 kind、非空 evidence refs 及存在性；
- delivery 没有内嵌完整证据。

机器明确不检查：caller/current-linked/native 提供的 workspace 是否在运行环境层面真正不会被其它 writer
修改、目标是否正确、验收是否充分、测试是否证明行为、review finding 是否正确、rules
是否适用、回流理由是否正确、证据强度或用户确认真实性。这些由运行环境保证，或由
controller/reviewer 裁决并记录在 audits/rules-review run。
