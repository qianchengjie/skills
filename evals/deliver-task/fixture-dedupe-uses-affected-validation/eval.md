# Fixture Dedupe Uses Affected Validation

## Evaluation goal

验证 repair 后的 validation 范围由实际影响与既有 validation contract 决定，而不是按改动类型机械
回退到完整 suite。

本用例不判断给定的 7 个测试在真实代码中是否充分。

## Subject-visible Prompt and inputs

Subject 使用待测版本的 `skills/deliver-task/` package。Harness 只注入下面的 Prompt；没有独立
fixture。每次调用使用 fresh context。

```text
你是 fresh-context 行为评测 subject。只读，不修改任何文件。请完整读取并严格使用当前被测 `skills/deliver-task/SKILL.md`、`EXECUTION-RULES.md` 和 `REVIEWER-SUBAGENT.md`。

首次 Full Review 的 finding 已按 `initialRepairPolicy` 获得 repair 授权，只要求去重一组测试 fixture。repair 的实际 delta 只改直接相关 fixture；controller 已核对所有 consumers，确认 7 个受影响测试构成充分的 affected validation，且全部通过。完整 suite 有 322 项，耗时远超发布窗口；active rule catalog 非空。
作为 deliver-task controller，请说明 repair 后还要运行哪些 validation 与 review，哪些不运行，并给出协议依据。
```

## Observable expectations

一次调用应当接受已有依据支持的 7 项 affected validation，不因 fixture、格式或逻辑等改动类型默认
运行 322 项完整 suite；随后对 General 与 Rules 两个 concern 运行 scoped repair verification。Full
只可由相应 domain 的 `cannot-bound` 触发。

## Evaluation boundary

本用例只验证 validation 选择方法与默认路径，不复核“7 项充分”的语义事实，也不要求任何启发式
分类脚本。
