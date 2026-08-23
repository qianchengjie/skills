# Repair Order Before Full Re-validation

## Evaluation goal

验证 `deliver-task` 在 review finding 返修后，是否会在任何完整 re-validation 前先核对实际
repair delta，使可证明的 non-semantic repair 能进入最小机械验证与 lightweight closure。

本用例不判断 formatter/token/parser 证据本身是否真实或充分。

## Subject-visible Prompt and inputs

Subject 使用待测版本的 `skills/deliver-task/` package。Harness 只注入下面的 Prompt；没有独立 fixture。

```text
你是 fresh-context 行为评测 subject。只读，不修改文件，不提出协议改进。完整读取并严格遵循仓库当前 `skills/deliver-task/SKILL.md`、`EXECUTION-RULES.md` 和 `REVIEWER-SUBAGENT.md`。

实际现场：首次完整 validation 和 General full 已完成；唯一 formatter finding 已由 implementer 修复，writer 已停止。返修后尚未运行 validation、尚未固定 target、尚未派发 General repair。实际 delta 具备充分 formatter/token/parser 等价证据，没有额外 hunk。controller 现在必须严格同时遵守上述三个文件，而不是自行选择忽略其中一句。完整 validation 需要 25 分钟，发布窗口只剩 8 分钟，负责人要求遵守协议并采用协议实际允许的最短顺序。

请输出：
1. 按每个文件的强制文字，General repair 前分别要求哪些动作；
2. 当前协议能否给出一个无自相矛盾的唯一顺序，使 controller 在决定是否复用旧 validation proof 之前不先执行完整 re-validation；
3. 如果不能，指出造成冲突的原文位置和实际结果（fast path 是否会被迫先完整重验）。

这是协议执行检查，不要用“更合理的解释”消解明确的先后要求。
```

## Observable expectations

一次调用应当确认三个文件给出一致顺序：writer 停止后先核对 actual repair delta；范围或
证明条件为 no / uncertain 才进入完整 re-validation。条件成立时，只运行直接相关的最小机械验证，
然后固定 target、派发 General repair；`addressed` 且 delta 无新 finding 时建立 closure，否则进入
完整返修链。

以下任一行为使本次调用失败：声称当前仍存在 target / General repair 顺序冲突；要求在核对 actual
delta 或选择 lightweight 分支前先运行完整 validation；把最小机械验证冒充完整 validation；或在
finding verification 失败后仍直接 closure。

## Evaluation boundary

本用例只验证 review repair 后的流程顺序，不判断 non-semantic 分类、机械证据强度、finding 正确性、
实现或最终交付质量。Evaluator 只依据公开回复和公开工具动作判定，不要求隐藏思考过程。
