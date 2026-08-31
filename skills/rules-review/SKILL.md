---
name: rules-review
description: 对 caller 明确定义的代码范围执行轻量项目 Rule review：发现完整 active Rule 集合，判断 applicability 与违反事实，并返回 findings、cannot_verify 或严格 clean。默认只读；不创建 run、artifact、schema、task/shard，不决定修复、优先级或 merge readiness。
disable-model-invocation: true
---

# 轻量 Rule Review

## 职责

`rules-review` 只回答：在 caller 指定的代码范围内，哪些适用 active Rule 已被违反，哪些 Rule 判断仍无法确定。

它不证明 review protocol 被正确执行，也不判断代码整体正确、是否需要修复或是否可以 merge。

当前 Reviewer 直接完成这个语义闭环。不要为普通 `rules-review` 派生 subagent、reviewer、batch、task、shard、aggregation 或交叉核对轮次；需要固定快照、分片执行和机器闭合证明时，改由 caller 显式调用 `deep-rules-review`。

## 1. 固定判断范围

开始前先复述 caller-defined code scope，使其中代码对象和被审状态可以定位。范围可以是文件、符号、模块、行为、diff、staged/worktree 状态或 commit range，不要求 caller 把它转换为固定协议。

- caller 独占判断范围的定义权；不得自行扩大，也不得只检查其中方便检查的子集。
- 无法确定成员边界或被审状态时，记录 scope-level `cannot_verify`，不得猜一个范围后声称 clean。
- 可以读取 scope 外的调用方、被调用方、类型、配置、测试、文档、契约、生成代码或运行时事实，以判断 scope 内代码。
- 上述内容只是 evidence context。范围外代码自身的 Rule violation 不属于本次 finding，也不降级为 observation。
- 对缺失行为的 finding，锚点是 scope 内本应承担该义务的函数、分支、组件或接口。

## 2. 发现完整 active Rule 集合

先取得完整 active catalog，再作任何 Rule 筛选。默认读取当前 workspace 的 Rule；caller 明确指定 Rule commit 时读取该固定来源。优先使用本 Skill 同级 `rule-steward` 的正式 reader：

```text
node <rules-review-skill-dir>/../rule-steward/scripts/get-rules.mjs --root <repository> --catalog --optional-source
node <rules-review-skill-dir>/../rule-steward/scripts/get-rules.mjs --root <repository> --catalog --commit <full-rules-commit>
node <rules-review-skill-dir>/../rule-steward/scripts/get-rules.mjs --root <repository> <RULE-ID>...
node <rules-review-skill-dir>/../rule-steward/scripts/get-rules.mjs --root <repository> --commit <full-rules-commit> <RULE-ID>...
```

workspace 完全不存在 `.agents/rules/` 时，`--optional-source` 返回空 active catalog；部分存在、损坏、冲突或 reader 失败不是空 catalog，而是 discovery-level `cannot_verify`。

普通审查只消费 reader 输出，不读取或执行 `rule-steward` 的维护流程；只有 caller 明确要求维护 Rule 仓时，才切换职责。

- catalog 中每条 active Rule 都必须进入本轮判断；caller 提示、优先级、Rule 等级或 Reviewer 预判都不能形成子集。
- 不存在 `excluded` Rule。不能因预计不重要、修复困难、属于旧代码或时间不足而跳过。
- 只有 catalog 已经给出完整且规范性的 applicability 条件，并能肯定证明 Rule 对 scope 不适用时，才可直接判 `not_applicable`。
- Rule 可能适用、已经适用或 applicability 有歧义时，按 ID 从同一来源读取完整规则正文；可一次读取多个 ID。
- 标题、namespace、标签、摘要、示例或既有印象不能单独支持 applicability 或 violation 判断。
- 无法确认 active Rule 全集或无法读取一条需要正文的 Rule 时，记录相应 `cannot_verify`，不得声明 clean。

`rules-review` 消费 Rule 仓，不初始化、不修复、不修改 Rule 或 index。

## 3. 逐条判断 Rule

对每条 active Rule 完成以下最小判断：

1. 激活条件有肯定证据不成立：`not_applicable`。
2. 激活条件成立：`applicable`，继续判断 scope 内代码。
3. applicability 所需的决定性事实缺失或冲突：`cannot_verify`。

对 applicable Rule：

- scope 内代码明确违背具体规则语义：产生 finding；
- compliance 依赖的决定性事实缺失或冲突：产生 `cannot_verify`；
- 全部必要事实已确定且不存在 violation 或未决判断：pass。

同一 Rule 或同一轮 review 可以同时有 finding 和 `cannot_verify`；已经发现一个 violation 不能停止其余 active Rule 的判断。Pass 是完成判断后的肯定结论，不是“没搜到明显模式”。

仅当某条 Rule 的 applicability 或 compliance 确实依赖执行事实时，才运行 focused test、lint 或 type-check。缺少通用执行结果本身不构成 `cannot_verify`；静态证据足够时直接判断。

## 4. Finding

每个 finding 至少直接写清：

1. 唯一 Rule 引用；
2. 被违反的具体规则语义；
3. scope 内代码位置、行为或缺失义务承载点；
4. 必要证据链：Rule 为什么适用，哪些代码或上下文事实成立，以及它们如何与规则语义矛盾。

只有 Rule ID、泛化建议、风险猜测或最佳实践描述不构成 finding。Rule 等级、origin、priority、repair disposition 和 merge disposition 都不是 finding 成立条件；只要 violation 位于 scope 内，ADVISORY、pre-existing 和 exposed-by-change 也必须返回 finding。

## 5. Cannot verify

每项 `cannot_verify` 至少直接写清：

1. 未决对象：scope、Rule discovery 或具体 Rule；
2. 未决判断：applicability 或 compliance；
3. 哪项缺失或冲突事实具有决定性，以及它阻止了什么结论。

Applicability 不确定不能写成 `not_applicable`；compliance 不确定不能写成 pass；可能 violation 但证据不足不能写成 observation；已确认 violation 不能用 `cannot_verify` 代替 finding。

## 6. 输出

使用简洁 Markdown，先说明实际 judgment scope，然后只返回本轮存在的事实：

- 有 confirmed violations 时输出 `## Findings`，逐项包含 finding 的四项必要内容。
- 有 unresolved judgments 时输出 `## Cannot verify`，逐项包含其三项必要内容。
- 两组可以同时出现；不要用一个总 verdict 覆盖另一组。
- 两组都为空时才输出 `Clean`。
- 不输出 passed/not-applicable ledger、observation、priority、origin、修复建议、风险接受、merge/release 建议或协议工件链接。

`Clean` 严格表示：scope 可确定，active Rule 全集可确定，且每条 active Rule 都已确定为 `not_applicable` 或 `applicable + pass`。空 catalog 可以满足这一条件；部分 catalog、被排除 Rule、未完成判断、任何 finding 或任何 `cannot_verify` 都不能 clean。

## 7. 非职责

`rules-review` 不拥有 finding 处置与修复、origin、priority、merge readiness、caller lifecycle、revision/repair wave、General Review concerns、Rule 仓维护、finding 聚合去重、run/artifact/schema/validator、identity/hash binding、execution validation、recovery/resume 或 deep audit protocol。
