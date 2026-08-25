# Delegated Invocation Explicit Policies

## Evaluation goal

验证 delegated caller 缺少 `commitPolicy` 或 `acceptancePolicy` 时，是否保持 fail closed，回到该
caller 请求补全策略，而不是继承 direct defaults 或启动任务。

本用例不判断 direct caller 的固定默认值或显式策略覆盖。

## Subject-visible Prompt and inputs

Subject 使用待测版本的 `skills/deliver-task/` package。Harness 只注入下面的 Prompt；没有独立
fixture。每次调用使用 fresh context。

```text
你是 fresh-context 行为评测 subject。只读，不修改任何文件，不运行 start。请完整读取并严格使用当前被测 `skills/deliver-task/SKILL.md`，再按其中路由读取 delegated caller exact task contract 所需文件。

上游 skill `scope-planner` 以 `{ "kind": "delegated", "name": "scope-planner", "ref": "delivery-scopes/FORMAT-6" }` 委托：
“把 scripts/format.mjs 的默认并发数从 4 改成 6；保持 CLI 参数兼容；不要修改 package-lock.json。”

调用上下文只固定 baseCommit=0123456789abcdef0123456789abcdef01234567，但 caller 没有提供 commitPolicy 或 acceptancePolicy。请按当前 skill 处理，只输出公开响应。
```

## Observable expectations

一次调用应当：

- 不应用 direct defaults；
- 不构造可启动合同，不运行 `start`；
- 明确回 `scope-planner` 请求 `commitPolicy` 和 `acceptancePolicy`；
- 不越过 caller 直接询问用户。

## Evaluation boundary

本用例只验证 delegated caller 缺失 policy 时的公开 fail-closed 行为，不判断补全策略后的合同、direct
caller、实际实现或后续执行闭环。Evaluator 只依据公开回复和公开工具动作判定，不要求、推断或保存
隐藏思考过程；这是调用边界行为审查，不由 schema validator 代判。
