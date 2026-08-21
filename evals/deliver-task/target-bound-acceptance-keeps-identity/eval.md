# Target-bound Acceptance Keeps Identity

## Evaluation goal

验证当前 target 的 upstream acceptance 通过且 task、execution、Git target 都未变化时，
`deliver-task` 只追加 target-bound acceptance evidence，不重建 task identity，也不使
已有最终累计 General evidence stale。

本用例不判断用户是否真的作出确认、验收内容是否充分，也不执行 rules-review。

## Subject-visible Prompt and inputs

Subject 使用待测版本的 `skills/deliver-task/` package。Harness 只替换该 package 的
路径并注入下面的 Prompt；每次调用使用 fresh context。

```text
你是 fresh-context 行为评测 subject。只读，不修改任何文件，不询问用户。请完整读取
被测 skills/deliver-task/SKILL.md 及其为验收/收口要求的引用，并只依据该 package
回答。

一个 direct deliver-task 已按被测 package 的合法 schema 建立 task identity，调用
合同要求 upstream acceptance；实现与验证已完成，Git target 已固定，最终累计
General full 已 clean，controller 因当前 target 尚无验收结果返回
needs-upstream/user-acceptance。此后代码、执行路径边界、Git identity、目标、验收标准
及其它任务合同内容都没有变化。现在同一用户明确回复“验收通过”，没有提出修改或
拒收理由。

只输出：应更新的 durable evidence/state；既有 task revision/hash 是否变化；是否
需要重建 task identity、重新 snapshot target 或重跑 General；原 General evidence
是否仍可用于交付；随后能否继续 rules-review/close-check。不要提出协议改进建议，
不要讨论评测标准。
```

## Observable expectations

一次调用应当：

- 只在 `audits.md` 追加绑定当前 task/target、`status=passed` 且 evidence refs 非空的
  acceptance A 条目；
- 明确 task revision/hash 和 execution identity 不变；
- 不重建 task identity，不重新 `snapshot-target`，不重跑 General；
- 明确原最终累计 General evidence 仍绑定同一 task/execution/target，可继续使用；
- 允许继续最终 rules-review，并在其闭合后更新薄 `delivery.json`、运行
  `validate-result` 和 `close-check`。

以下任一公开可观察行为使本次调用失败：

- 把实际验收结果写回 `task.json`；
- 递增 task revision、重算 task hash 或要求 claims/General 跨新 identity 重绑定；
- 在 target 未变化时重新 snapshot 或重跑 General；
- 宣称已有 General evidence 因 acceptance 状态变化而 stale；
- 验收通过后仍返回 `needs-upstream / user-acceptance`。

## Evaluation boundary

本用例只验证验收结果的 owner、task identity 稳定性和 General binding 生命周期。它不
判断 acceptance evidence 的真实性或强度、rules-review 是否适用、其结果是否 clean，
也不代表最终 delivery 已通过。Evaluator 只依据 subject 的公开回复和公开工具动作
判定，不要求、推断或保存隐藏思考过程。本文件定义一次独立调用，不定义 repetitions、
RED/GREEN 编排、重试、聚合或结果文件格式。
