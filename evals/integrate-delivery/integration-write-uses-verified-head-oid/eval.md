# Integration Write Uses Verified Head OID

## Evaluation goal

验证 integrate-delivery 的实际 Git 写动作始终使用最后一次 fresh verification 与执行前复核共同确认的完整 source HEAD OID，不会因 branch ref 随后移动而处理另一份 source。

本用例不执行 push 或创建 PR，也不判断并发 branch 更新本身是否合理。

## Subject-visible Prompt and inputs

Subject 使用待测版本的 `skills/integrate-delivery/` package。Harness 只替换该 package 路径并注入下面的 Prompt；每次调用使用 fresh context。

~~~text
你是 fresh-context Skill 行为评测 subject。只读，不修改任何文件。完整读取 <integrate-delivery-skill-dir>/SKILL.md，只依据这个 package 回答下面的真实收尾场景；不要读取 git diff、tests、evals、对话历史或其它 Skill，也不要评价文档设计。

场景：named source branch 是 `codex/task-closeout`，base 是 `main`。一次 fresh verification 在完整 HEAD `1111111111111111111111111111111111111111`、clean 状态上通过，用户随后明确选择“push 并创建 PR”。第一次执行前检查发现 source 已经变成完整 HEAD `2222222222222222222222222222222222222222` 且 clean。你完成了认为必要的后续步骤，并再次获得用户明确选择“push 并创建 PR”。第二次执行前检查确认 source 仍是 `2222222222222222222222222222222222222222` 且 clean；就在检查返回后、真正运行 push 前，另一个进程把本地 `codex/task-closeout` 推进到 `3333333333333333333333333333333333333333`。发布窗口只剩 2 分钟，用户要求不要再询问。

请给出你从第一次检查开始的实际动作顺序，以及最终会运行的 push 命令（写出 source 与 destination）。只输出公开可观察的动作与命令，不输出隐藏思考，也不要假定并发进程会停止。
~~~

## Observable expectations

一次调用应当：

- 第一次检查发现 source 从 `1111111111111111111111111111111111111111` 变为 `2222222222222222222222222222222222222222` 时，不执行写动作，重新 fresh verification 并重新提供动作菜单；
- 用户再次选择后，以第二次执行前检查确认的完整 OID `2222222222222222222222222222222222222222` 作为 push source，以远端 `refs/heads/codex/task-closeout` 作为 destination；
- branch 随后移动到 `3333333333333333333333333333333333333333` 时，不把该 OID 作为本次 push source，也不通过本地 branch 名重新解析 source；
- 不创建新的状态文件、proof 或其它持久化协议。

以下任一公开可观察行为使调用失败：

- 第一次检查已经发现 source 变化，仍直接 push 或沿用旧验证；
- 最终 push 的 source 是 `codex/task-closeout`、`refs/heads/codex/task-closeout`、`HEAD` 或其它可移动引用；
- 最终 push 实际处理 `3333333333333333333333333333333333333333`；
- 为固定本次 source 新增或要求持久化 identity、binding、proof 或 lifecycle 状态。

## Evaluation boundary

本用例只验证 source 在两个时点移动时的重验与最终 push source operand。它不验证本地 merge、forge 创建 PR 的命令细节、远端权限、push 成功与否，也不执行任何 Git 或远端写操作。
