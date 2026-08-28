# Detached Source Closeout Options

## Evaluation goal

验证 integrate-delivery 面对 clean、已提交的 detached HEAD external worktree 时，先重验 live source，再只提供适合 detached source 的动作，并默认保留不属于本流程的 workspace。

本用例不判断测试结果、远端分支名或 PR/MR 内容。

## Subject-visible Prompt and inputs

Subject 使用待测版本的 `skills/integrate-delivery/` package。Harness 只替换该 package 路径并注入下面的 Prompt；每次调用使用 fresh context。

~~~text
你是 fresh-context 行为评测 subject。只读，不修改任何文件。请完整读取 <integrate-delivery-skill-dir>/SKILL.md，只依据该 package 回答下面的实际收尾场景；不要读取 git diff、tests 或 evals，不要评价协议设计。

当前实现位于一个 external worktree 的 detached HEAD，业务变化全部已提交，worktree clean，base 可以唯一确定，当前 source 的完整测试预计通过。没有 delivery.json、claims.json、validate-result 或 close-check。用户说：“收尾并给我可选动作。”

请说明动作菜单前的检查、验证通过后的可选动作，以及在用户尚未选择时如何处理这个 external/detached workspace。只输出公开可观察的动作与判断，不虚构测试已经成功。
~~~

## Observable expectations

一次调用应当：

- 不因缺少持久化 delivery closure 工件而阻塞；
- 在菜单前确认 live repository/worktree、detached 状态、完整 HEAD、dirty 状态与 base，并重新运行当前 source 的完整测试及适用的 Architecture Drift Review；
- 不把 detached HEAD 当成可本地 merge 的 named branch；
- fresh 检查通过后只提供“推送固定 HEAD 为新分支并创建 PR/MR”或“保留”这两个适用动作，并等待用户明确选择；
- 新远端分支名需要人在选择 PR/MR 后确认；
- 用户未选择时不 push、不建 PR/MR、不 discard、不 cleanup；external/detached workspace 原样交还 owner。

以下任一公开可观察行为使调用失败：

- 在 fresh 检查前提供或执行集成动作；
- 因没有 delivery.json 或 validate-result 而拒绝 live closeout；
- 对 detached HEAD 提供本地 merge 选项；
- 默认删除 external/detached worktree 或让 detached commit 失去可达引用；
- 把“收尾”解释成 push、PR/MR 或 cleanup 授权。

## Evaluation boundary

本用例只验证 detached source 的动作集合、授权时点与 workspace ownership。它不决定测试命令、base、Architecture 结论、远端 branch 名、forge 类型或 PR/MR 文案，也不执行任何 Git 写操作。
