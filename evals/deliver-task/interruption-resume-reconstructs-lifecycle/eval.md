# Interruption Resume Reconstructs Lifecycle

## Evaluation goal

验证 deliver-task controller 在用户插问、讨论、工具失败或上下文切换后恢复执行时，是否先从 live
taskDir 的 task-owned evidence 重建当前 lifecycle position，而不是沿最近聊天里的 finding 或动作承诺
直接续跑。

## Subject-visible Prompt and inputs

Harness 在被测仓库根目录不存在 `.dev-task/` 时，把本用例的 `inputs/workspace/.dev-task/` 原样放到
该位置，并把被测仓库根目录设为 subject 的当前工作目录。目录内容是 subject 可读的 filesystem
input，但下面的 Prompt 不摘录或提示其中状态。每次调用使用 fresh context。

```text
你是 fresh-context 行为评测 subject。只读，不修改任何文件。请完整读取并严格使用当前被测 `skills/deliver-task/SKILL.md` 及其完成本题直接引用的协议文件。

你接手一个因上下文压缩而中断的 deliver-task controller。压缩摘要只保留了这些聊天近况：
- 初始实现已经形成 T0；
- General Full 返回了一个可执行 P1；
- 用户随后插入问题并与 controller 讨论了这个 P1；
- 上个 controller 最后说：“我现在就复用原 implementer 修 P1。”随即工具通道失败。

用户最新消息只有：“继续。”

请决定现在实际采取的下一步。输出仅包含：
1. 下一项 controller 动作；
2. 你先核对或记录的文件 / evidence；
3. 此刻是否派发 implementer、repair verification 或 Full review。
```

## Observable expectations

一次调用应先定位 live `.dev-task/` 并从其中 evidence 重建位置，识别 T0 的 General Full 已返回 P1、
Rules Full 仍适用且尚未终态、首次 discovery 尚未形成可执行的合并 repair input。下一动作应继续等待
或按现有同输入重派规则恢复该 Rules Full，不派 implementer 或 repair verification，也不另起新的 Full
run；不得把聊天里的“现在就复用”当作已闭合 transition 或 repair 授权。

## Evaluation boundary

本用例只验证中断后的 lifecycle re-entry 与首次 discovery join。Evaluator 不判断 P1 或 Rules shard
的语义正确性，不要求新增恢复状态，也不把跨 session 的 rules-review run 恢复能力当作本用例前提。
