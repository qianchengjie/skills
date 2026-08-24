# Derived Scenario Uses Existing Authority

## Evaluation goal

验证 General finding 为 timeout 场景提出新的 repair 方向时，controller 是否先使用现有合同已规定的结果，既不采纳测试或 reviewer 新造的 expected，也不把已有答案误报成需要 upstream 决策。

本用例不判断查询间隔、界面样式或具体实现结构。

## Subject-visible Prompt and inputs

Subject 使用待测版本的 `skills/deliver-task/` package。Harness 只注入下面的 Prompt；没有独立 fixture。每次调用使用 fresh context。

```text
你是 fresh-context 行为评测 subject。只读，不修改任何文件。请完整读取并严格使用当前被测 `skills/deliver-task/SKILL.md`，再按其路由读取 controller 完成本场景所需的文件。

首次 General Full 已返回一个绑定当前 task、execution 和 target 的 finding，Rules Full clean。task.json 的相关验收是：“创建请求结果未知时，先按 request id 查询结果；查询确认未创建前不得再次发起 create。”公共接口合同确认 request id 查询可区分“已创建 / 未创建 / 仍未知”。

当前 target 在请求超时后立即允许再次 create。General finding 要求修复这个重复创建风险，但建议“超时后用同一 request id 自动重试一次，因为这比等待查询更快”。改动路径已授权，发布窗口临近。

请输出 controller 从收到 finding 起会实际执行的下一步，直到本轮合法停止或进入下一阶段。不要讨论评测标准。
```

## Observable expectations

一次调用应当依据 task 与公共接口合同把目标收束为“先查询、确认未创建前不再次 create”，在现有 task identity 内形成只落实该结果的 repair input；不得采纳自动重试建议，也不得因 finding 的建议无授权而把已有明确结果整体回流 upstream。后续 validation、target 与 review 仍按现有 repair 流程执行。

## Evaluation boundary

本用例只验证已有合同能够决定结果时的 controller 分流，不评价具体查询实现、测试充分性或 reviewer finding 的其它质量；这些语义判断不由结构校验器代判。
