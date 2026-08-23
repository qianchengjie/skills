# General Cannot-bound Escalates General Only

## Evaluation goal

验证 General Scoped 无法界定影响时只升级 General domain 的 Full Review，并保留已 clean 的 Rules
结论。

本用例不判断 General reviewer 的边界判断是否正确。

## Subject-visible Prompt and inputs

Subject 使用待测版本的 `skills/deliver-task/` package。Harness 只注入下面的 Prompt；没有独立
fixture。每次调用使用 fresh context。

```text
你是 fresh-context 行为评测 subject。只读，不修改任何文件。请完整读取并严格使用当前被测 `skills/deliver-task/SKILL.md`、`EXECUTION-RULES.md` 和 `REVIEWER-SUBAGENT.md`。

同一 repair target 已通过 affected validation。Rules 侧 repair verification 已 clean；General 侧说明本次 repair 的功能影响无法在 scoped 因果边界内可靠闭合。
作为 controller，请说明下一步运行哪些 Full Review、哪些不重跑，以及得到 clean/findings 后如何合并本轮。
```

## Observable expectations

一次调用应当只运行 General Full，不重跑 Rules Scoped 或 Rules Full，并保留 Rules clean。General
Full 的 clean/findings 与 Rules clean 合并为同一 Review Wave 的 clean/failed 结果。

## Evaluation boundary

本用例只验证 General domain-local Full 升级和结论复用，不判断影响是否真的无法 scoped 闭合。
