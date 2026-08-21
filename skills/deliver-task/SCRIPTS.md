# deliver-task 脚本

从项目 Git 根目录执行：

```bash
node <deliver-task-skill-dir>/scripts/deliver-task.mjs <command> <taskDir>
```

## 命令

| 命令 | 作用 |
| --- | --- |
| `validate-task` | 校验 immutable `task.json` exact schema、caller、用户禁止路径、policy 和 baseCommit |
| `task-hash` | 输出 canonical task hash |
| `init` | 仅在 taskDir 内初始化 claims/audits/.gitignore/artifacts |
| `validate-execution` | 校验 deliver-owned `execution.json`、task binding、路径和 evidence refs，并输出 canonical execution hash |
| `snapshot-target` | 从当前 execution boundary 按 commitPolicy 输出带 execution hash 的薄 target identity |
| `validate-result` | 校验 delivery schema、identity binding、acceptance、non-delivered evidence 和薄结构 |
| `close-check` | 对 delivered 重验 claims、evidence refs、review/acceptance binding 与当前 Git target |

退出码：`0` 通过，`1` 协议或门禁失败，`2` 参数/路径错误。

## snapshot-target

- `required` 有业务变化但 `HEAD == baseCommit` 时失败；提交后输出 `commit-range`。
- `allowed` 可输出 `commit-range / worktree / no-change`。
- `forbidden` 要求 `HEAD == baseCommit`，只输出 `worktree / no-change`。
- commit range 或 worktree 中的每个业务路径都必须命中 `execution.allowedPaths`，且不命中 `task.forbiddenPaths ∪ execution.forbiddenPaths`。
- taskDir 自身不进入业务 target；若被提交进业务 range，失败。
- worktree hash 绑定排序后的路径、regular-file mode 和内容 hash；删除使用明确 deleted 记录。
- 三种 target 都包含当前 canonical `executionHash`；execution 变化会使旧 target 和旧 General binding 失效。

## 机器校验边界

目标类型是边界检查和流程终态门禁。机器可确定：

- JSON exact schema、枚举、task hash 和 execution hash；
- Git commit identity、祖先关系、worktree snapshot hash；
- execution allowlist、两层 forbidden path 和 taskDir 写边界；
- claim 明确终态与 evidence ref 存在；
- General 的 task/execution/target 显式绑定；
- acceptance 的 task/target/status 显式绑定及 task-owned evidence ref 存在；
- non-delivered request 的 kind、非空 evidence refs 及存在性；
- delivery 没有内嵌完整证据。

机器明确不检查：目标是否正确、验收是否充分、测试是否证明行为、review finding 是否正确、rules 是否适用、回流理由是否正确、证据强度或用户确认真实性。这些由 controller/reviewer 裁决并记录在 audits/rules-review run。
