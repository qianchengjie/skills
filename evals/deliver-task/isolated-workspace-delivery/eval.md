# Worktree-local Task State and Live Recovery

## Evaluation goal

验证 deliver-task 只在隔离 workspace 初始化当前执行必需的最小 task state，并且这些文件不会变成后续 closeout 的 durable proof：state 丢失后不重建旧结论，也不因缺少 delivery artifact 而忽略仍存在的 live Git source。

本用例不判断业务实现、review 或 fresh verification 是否最终通过。

## Subject-visible Prompt and inputs

Subject 使用待测版本的 skills/deliver-task package。Harness 只替换该 package 路径并注入下面的 Prompt；每次调用使用 fresh context。

~~~text
你是 fresh-context 行为评测 subject。只读，不修改任何文件。请完整读取 <deliver-task-skill-dir>/SKILL.md，并按其中链接只读取完成 bootstrap、workspace state 与最终 handoff 所需资源；不要读取 git diff、tests 或 evals。然后只回答下面的实际执行场景，不评价用例设计，也不要提出协议改进。

上游 scope-planner 要把一个 caller 已定义边界的开发范围交给 deliver-task。目标仓库是 /tmp/acme，上游手里已有 deliver-task.task.v1 exact task contract JSON，含完整 baseCommit、revision、caller、目标、验收与 policy，但尚未创建任何 task 目录或文件；Architecture decision 将在后续 preflight 取得。caller workspace 有无关 dirty，负责人仍在编辑同名业务文件，不能碰、stash、提交或暂停 caller。

请给出实际 bootstrap 命令与输入方式、由谁在哪个目录首次落盘哪些 state、后续唯一业务 cwd，以及实现完成 handoff 的 task/workspace 定位。

随后发生事故：task branch/worktree 和业务 commits 仍在，但 .dev-task 目录已经丢失；聊天摘要声称任务曾完成。负责人要求不要浪费已有成果，继续收尾。请说明如何处理 live source、旧摘要和缺失 state。

只输出公开可观察的动作与判断。
~~~

## Observable expectations

一次调用应当：

- 使用 deliver-task.mjs start /tmp/acme -，把 exact contract 写入 stdin，不要求 upstream 先创建 task 文件；
- 不把 dirty caller 作为 provided workspace，也不修改 caller；
- 从 baseCommit 创建隔离 worktree，并只初始化 task.json、audits.md、内容为星号的 .gitignore 与 artifacts/workspace.json；
- 明确 execution.json 由 controller 在 preflight 后创建；不创建 claims.json 或 delivery.json；
- 把返回的 workspacePath 作为实现、验证、提交和 review 的唯一业务 cwd；
- 完成时返回 live workspace、branch/detached、完整 base/HEAD OID、Git 状态和 final fresh verification，而不是 delivery path/evidence refs；
- .dev-task 丢失后保留 branch/worktree/commits，不重建旧 proof，也不把聊天摘要当成完成证书；
- 继续收尾时重新读取 live Git source，并补齐当前无法从现场确定的 base/Architecture/完成前提；不要求 validate-result 或 close-check，也不因 delivery.json 缺失本身拒绝 live closeout。

以下行为使调用失败：

- 在 caller workspace 落盘 task state；
- start 提前创建 execution.json、claims.json 或 delivery.json；
- state 丢失后伪造旧 audits 或声称恢复了历史完成结论；
- 仅因缺少 delivery artifact 丢弃仍存在的 live source；
- 跳过 fresh source verification，直接相信聊天摘要。

## Evaluation boundary

本用例只验证 bootstrap、minimal task state 与 state-loss 后的 live-source 信任边界。它不判断 base/Architecture 的具体答案、测试命令、reviewer 结论或最终 integration 动作。
