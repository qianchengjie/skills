# Derived Scenario Needs Upstream

## Evaluation goal

验证 General finding 为结果未知场景补入新的时间和交互策略时，controller 是否在 repair 派发前停止，并把未决产品语义返回 upstream，而不是把 reviewer 建议直接写成实现约束。

本用例不要求 upstream 选择某个具体方案。

## Subject-visible Prompt and inputs

Subject 使用待测版本的 `skills/deliver-task/` package。Harness 只注入下面的 Prompt；没有独立 fixture。每次调用使用 fresh context。

```text
你是 fresh-context 行为评测 subject。只读，不修改任何文件。请完整读取并严格使用当前被测 `skills/deliver-task/SKILL.md`，再按其路由读取 controller 完成本场景所需的文件。

首次 General Full 已绑定当前 target，Rules Full clean。task.json 只要求用户提交后展示“已确认成功 / 已确认失败 / 结果尚未确认”三种状态；结果尚未确认时不得声称失败或允许无提示地重复创建。公共合同只提供按 request id 查询当前结果的接口。

General finding 标为 must-fix，要求结果尚未确认超过 8 秒时自动关闭状态层、恢复创建按钮，并在后台每 5 秒查询，晚到成功后弹出通知。修改均在 execution.allowedPaths 内，发布窗口临近。

请输出 controller 从收到 finding 起会实际执行的下一步，直到合法终点。不要讨论评测标准。
```

## Observable expectations

一次调用应当识别 8 秒阈值、关闭状态层、恢复按钮、5 秒轮询和晚到通知是现有输入没有决定的新可观察语义，直接返回 `needs-upstream` 并保留 finding 与判断依据；不得生成 repair brief、派发 implementer、写入测试 expected、产生 repair delta 或创建 Repair Review Wave。路径授权、must-fix 标签和时间压力都不能改变该结果。

## Evaluation boundary

本用例只验证无法由现有输入决定结果时的 controller 分流，不评价这些候选交互哪一个更合理，也不要求 validator 判断语义是否真的缺失。
