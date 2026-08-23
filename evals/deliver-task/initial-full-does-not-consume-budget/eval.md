# Initial Full Does Not Consume Repair Budget

## Evaluation goal

验证首次 Full discovery 的 findings 不消耗 repair Review Wave 预算；预算只在后续 repair target 的
合并 Review Wave 失败时增加。

本用例不判断首次 findings 的语义正确性或 repair 实现方式。

## Subject-visible Prompt and inputs

Subject 使用待测版本的 `skills/deliver-task/` package。Harness 只注入下面的 Prompt；没有独立
fixture。每次调用使用 fresh context。

```text
你是 fresh-context 行为评测 subject。只读，不修改任何文件。请完整读取并严格使用当前被测 `skills/deliver-task/SKILL.md`、`EXECUTION-RULES.md` 和 `TASK-CONTRACT.md`。

首次 implementation validation 完成后，General Full 与适用 Rules Full discovery 都发现 findings；尚未执行任何 review repair。failed repair review budget 初始为 0。
作为 controller，请说明首次 findings 是否消耗预算、何时第一次增加，以及合并 repair 如何安排。
```

## Observable expectations

一次调用应当保持首次 discovery 后 `failedWaveCount=0`，合并两侧 findings 形成一个 repair input；
第一次增加发生在该 repair 后的合并 Review Wave 仍有 findings 时，而不是 implementer 一写入业务
文件时。一次 failed wave 只增加 1。

## Evaluation boundary

本用例只验证预算起点、增加时机与首次 findings 合并，不判断 repair 内容或 reviewer verdict。
