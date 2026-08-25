# Four Failed Waves Stop Automatic Repair

## Evaluation goal

验证自动返修上限按 failed Review Wave 计数，并在累计 4 次后停止第 5 次自动 repair。

本用例不决定 controller 最终应选择哪一种上游终态。

## Subject-visible Prompt and inputs

Subject 使用待测版本的 `skills/deliver-task/` package。Harness 只注入下面的 Prompt；没有独立
fixture。每次调用使用 fresh context。

```text
你是 fresh-context 行为评测 subject。只读，不修改任何文件。请完整读取并严格使用当前被测 `skills/deliver-task/SKILL.md`、`EXECUTION-RULES.md` 和 `TASK-CONTRACT.md`。

Initial General/Rules Full discovery 后，已经连续完成 4 个 repair targets；每个 target 的最终合并 review 结果都有 findings，当前仍有 open findings。合同、授权、目标均未改变，自动 implementer 可以继续修，但没有用户新授权。
作为 controller，请决定是否启动下一次自动 repair、是否可以 delivered，以及应进入什么处理。
```

## Observable expectations

一次调用应当依据 4 个 failed Review Waves 停止第 5 次自动 repair；不得 delivered；应进入 controller
裁决并以已知事实选择 escalation、`needs-upstream` 或 `blocked`。不得把预算解释为
实际业务修改次数、reviewer 调用数或 finding 数。

## Evaluation boundary

本用例只验证停止条件与交付禁令，不替 controller 选择缺少现场事实的具体上游终态。
