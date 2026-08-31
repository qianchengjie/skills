---
name: rules-review
description: 当需要依据项目 active Rules 审查 caller 指定代码范围内的 Rule applicability 与 violation 时使用。
disable-model-invocation: true
---

# Rules Review

`rules-review` 只读判断 caller 指定范围内的代码是否违反适用 Rule。

## 判断边界

Caller 提供可定位的 code scope 及其被审状态。文件、符号、模块、行为、diff、staged/worktree 状态或 commit range 都可以定义范围。

- Code scope 是 finding 的唯一位置边界。范围无法确定时，返回 scope `cannot_verify`。
- Reviewer 可以读取调用方、被调用方、类型、配置、测试、文档、契约、生成代码或运行时事实作为 evidence context。
- Evidence context 不改变 code scope；其中代码自身的问题不进入本次 findings。
- 对缺失行为的 finding，位置是 scope 内本应承担该义务的函数、分支、组件或接口。

## 发现 Rules

默认从当前 workspace 读取 Rules；caller 指定 Rule commit 时固定该来源。通过同级 `rule-steward/scripts/get-rules.mjs` 读取 catalog 与 Rule 正文；Catalog 与后续 Rule 正文必须来自同一 source。

```text
node <rules-review-skill-dir>/../rule-steward/scripts/get-rules.mjs --root <repository> --catalog --optional-source
node <rules-review-skill-dir>/../rule-steward/scripts/get-rules.mjs --root <repository> --catalog --commit <FULL-OID>
```

先读取完整 active catalog，再判断其中每条 Rule：

- 只有 reader 成功返回 catalog，才以其 `rules` 作为完整 active catalog。
- `source.kind = absent` 仅表示项目不存在 Rule source；目录缺失本身不能证明 absent。
- 合法 workspace 或 commit source 也允许返回 `rules: []`。
- reader 失败形成 discovery `cannot_verify`。
- Catalog 已提供完整且具有约束力的 applicability 条件，并且证据确定该条件不成立时，可以直接判 `not_applicable`。
- 其余 Rule 从同一来源读取完整正文后再判断；标题、标签、摘要或既有印象不能替代正文。

## 逐条判断

每条 active Rule 的 applicability 取以下一种结果：

- 决定性证据表明激活条件不成立：`not_applicable`。
- 激活条件成立：`applicable`，继续判断 scope 内代码。
- 决定性事实缺失或冲突：`cannot_verify`。

对 applicable Rule：

- 代码与具体规则语义矛盾：finding。
- Compliance 的决定性事实缺失或冲突：`cannot_verify`。
- 必要事实完整且没有违反：pass。

继续判断全部 active Rules。Finding 与 `cannot_verify` 是可并存的事实集合，同一 Rule 也可能同时贡献两者。仅当判断依赖执行事实时，运行对应的 focused test、lint 或 type-check；静态证据足够时直接判断。

## Finding

每个 finding 包含：

1. 唯一 Rule 引用；
2. 被违反的具体规则语义；
3. Scope 内代码位置或缺失义务承载点；
4. 必要证据：Rule 适用事实、相关代码与上下文事实，以及两者为何矛盾。

Scope 内任何已确认 violation 都是 finding，其行动价值或产生时间不改变该事实。

## Cannot verify

每项 `cannot_verify` 只写：

1. 未决环节及对象：`scope`、`discovery`、`<RULE-ID> applicability` 或 `<RULE-ID> compliance`；
2. 缺失或冲突的决定性事实，以及它阻止的结论。

`cannot_verify` 保留尚未确定的判断；它不表示不适用、通过或违反。

## 输出

最终回答先写实际 code scope，再按事实输出：

- 非空 findings 使用 `## Findings`；
- 非空 unresolved judgments 使用 `## Cannot verify`；
- 两组可以同时出现；
- 两组都为空时输出 `Clean`。

`Clean` 表示 scope 与完整 active catalog 均可确定，并且每条 active Rule 都已得到 `not_applicable` 或 `applicable + pass`。空 catalog 也满足逐条判断完成条件。
