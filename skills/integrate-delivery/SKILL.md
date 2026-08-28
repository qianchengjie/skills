---
name: integrate-delivery
description: 当 deliver-task 已完成当前实现与审查，且一个仍可访问的 Git branch/worktree 需要收尾时使用。
---

# 收尾开发分支

## 原则

> 不验证旧的交付证明；重新验证当前 Git 状态。

handoff 只负责定位 live source，不是正确性证书。任何测试摘要、review 结论或 .dev-task/ 文件都不能替代本轮对当前 source 的 fresh verification。integration 动作由人选择；选择前只做只读检查和验证。

## 输入

接受 live source workspace 的绝对路径，以及可选的自然语言 handoff。handoff 至少应指出已知的 base branch/base commit、当前 branch 或 detached HEAD、完整 HEAD OID、是否有未提交业务变化，以及上一轮实际运行的验证。

不要求 delivery.json、claims、validate-result 或 close-check。.dev-task/ 存在时可读取 task.json、execution.json 和 artifacts/workspace.json 帮助定位，但它们不构成交付闭环。

## 1. 重验 live source

在提供集成选项前：

1. 确认 workspace 仍存在且属于预期 Git repository，读取 git-dir、git-common-dir、workspace root、branch/detached 状态、完整 HEAD OID 和 dirty 状态。
2. 从 handoff、当前 Task、对话或 upstream 确定 base branch；无法唯一确定时向人确认，不猜 main。
3. handoff 具名的 HEAD 或工作区状态与现场不一致时，把 handoff 标为 stale，并以当前现场继续；不能把旧结论套到新 source，也不能只因摘要过期而拒绝 closeout。当前 source 有未提交变化、base 无法确定或任务是否完成已无法判断时，才停止并返回 deliver-task。
4. 按当前项目指令运行完整测试套件。命令失败或无法确定可信的完整验证入口时停止，不提供 merge / PR 菜单。
5. execution.architecturePath 非 null 时，对当前 base → source 运行 fresh Architecture Drift Review：可以宽读以理解结构，但只阻塞与已确认 [x] Architecture 决定相冲突的 drift；非 Architecture finding 不在此路由或修复。path 无法读取、出现 [ ] 或 review 无法闭合时停止。null 分支不搜索 Architecture。

这一步验证的是当前 source，不复述或校验历史 evidence。

## 2. 让人选择动作

只提供当前状态可安全执行的动作，然后等待明确选择：

| source 状态 | 可选动作 |
| --- | --- |
| named branch，业务变化已提交且 clean | 本地合并 / push 并创建 PR 或 MR / 保留 |
| detached HEAD，业务变化已提交且 clean | push 为新分支并创建 PR 或 MR / 保留 |
| 存在未提交业务变化 | 保留；需要集成时回到 deliver-task 按现有 commitPolicy 形成可集成 commit |
| 相对 base 无业务变化 | 保留，或在明确 cleanup 授权下结束 workspace |

“收尾”“处理一下”不自动授权 merge、push、PR、删除 branch/worktree 或 discard。discard 不进入普通菜单；只有用户明确要求，并再次确认准确目标后才执行。

## 3. 执行动作

### 本地合并

仅适用于 named branch：

1. 定位 base branch 所在的主 workspace，确认其 clean；dirty 时停止，不 stash、reset 或 clean。
2. checkout base，并在有 upstream 时执行安全的 fast-forward-only 更新；无法 fast-forward 时停止。
3. merge 固定 source branch/HEAD。冲突需要新业务语义、Architecture、需求或公共契约决定时停止，不猜解法。
4. 在 merged tree 上重新运行完整测试套件；Architecture path 分支同时重新运行 Drift Review。
5. 任一检查失败时保留 merge/source 现场，不 cleanup。全部通过才进入 cleanup。

### Push 并创建 PR / MR

只有人选择后才产生远端副作用。named branch 推送当前 branch；detached HEAD 先让人确认新的远端 branch 名，再推送固定 HEAD。使用仓库对应 forge 流程创建 PR/MR，并保留 source workspace 供后续 review 修复。

### 保留

不修改 Git，不清理 source，报告 workspace、branch/detached 状态和完整 HEAD OID。

## Cleanup

只有本地合并成功，或用户明确确认 discard，才考虑 cleanup。

- 仅正常删除由当前流程或 deliver-task 默认 .worktrees/ / worktrees/ 创建且 clean 的 worktree。
- provided、external、detached 或 host-managed workspace 原样交还 owner。
- dirty/untracked worktree 不 force remove；展示 git status，等待人决定如何处理。
- branch 只用安全删除；失败就保留，禁止 git branch -D。
- PR/MR 与 keep 都保留 source。

## 最终输出

使用简短 Markdown 报告当前事实：

- source：workspace、branch/detached、完整 HEAD、base；
- fresh verification：实际命令和结果；
- Architecture Drift Review：clean / finding / not-applicable；
- action：本地合并、PR/MR 或保留，以及是否完成；
- merged destination：适用时给出 before/after OID；
- cleanup：每个 branch/worktree 的 removed/retained。

不生成第二套 result schema、delivery proof 或 lifecycle artifact。
