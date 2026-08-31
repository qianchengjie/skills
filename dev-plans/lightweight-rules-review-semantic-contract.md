# 轻量 `rules-review` 最小语义契约

> 状态：已确认的语义与行为基线。本文不定义实现、JSON schema、run directory、artifact、validator、task、shard、aggregation 或恢复协议。

## 1. 目标

`rules-review` 只回答一个问题：

> 对 caller 指定的代码范围，逐一考虑全部 active Rule 后，哪些适用 Rule 被违反，哪些 Rule 判断仍无法确定；只有两者都不存在时，才能声明 clean。

它判断 Rule applicability 与 Rule violation，不负责决定问题是否修复、何时修复或是否允许 merge。

## 2. 最小语义模型

| 概念 | 最小语义 | 删除后造成的错误 |
| --- | --- | --- |
| 判断范围 `S` | Caller 指定成员边界可判断的代码对象及其被审状态。Reviewer 不得扩大或静默缩小。 | Finding 可能越界，或 Reviewer 只检查方便检查的子集却对原范围声称 clean。 |
| Evidence context `C` | 为判断 `S` 而读取的范围外代码、契约、配置、测试、文档、生成代码或运行时事实。它只支撑判断，不扩大 finding scope。 | 禁止读取会产生假 pass；把它并入 `S` 会产生范围外 finding。 |
| Active Rule universe `R` | 完整 active catalog 中的全部 Rule。先发现全集，再判断 applicability；不存在 applicable Rule 的 `excluded` 状态。 | Reviewer 可以预选 Rule，漏掉适用 Rule 后仍错误声称 clean。 |
| Rule 完整语义 | 可能适用、已适用或存在歧义的 Rule 必须按完整规范正文判断。 | 标题、标签、摘要或示例可能被误当成规则正文。 |
| Applicability | 只有 `not_applicable`、`applicable`、`cannot_verify` 三种语义。 | 不确定性会被压成不适用或 pass；被遗漏 Rule 与已确认不适用 Rule 无法区分。 |
| Finding `F` | 对 applicable Rule 的已确认违反，直接绑定 Rule、具体规则语义、scope 内代码锚点和必要证据链。 | Rule review 会退化成泛化建议、范围外问题或无证据断言。 |
| Cannot verify `U` | 对 scope、Rule discovery、applicability 或 compliance 的决定性未决判断。 | 未知会被静默吞掉，制造假 clean。 |
| Clean | 所有 active Rule 均已确定为不适用或适用且通过，同时 `F` 和 `U` 均为空。 | 空输出或部分检查可能被误报为 clean。 |

`F` 与 `U` 是两个独立集合，可以同时非空。`clean` 不是第三种互斥 verdict，而是严格派生断言。

```text
clean
⇔ S 可确定
∧ active Rule 全集可确定
∧ 每条 active Rule 均为 not_applicable 或 applicable + pass
∧ F = ∅
∧ U = ∅
```

## 3. 输入与 scope 边界

Caller 必须指定被判断的代码范围 `S`，使 Reviewer 能够判断某个代码位置或行为是否属于该范围。范围可以由文件、改动、符号、模块或可定位行为表达，不要求特定格式或 identity/hash。

Reviewer：

- 不得自行扩大 `S`；
- 不得因资料不足而静默缩小 `S`；
- 无法确定 `S` 时，必须返回 scope-level `cannot_verify`；
- 不得把 caller 提供的 Rule 提示、优先级或排除项当成 active Rule 子集。

Reviewer 可以读取判断 Rule 所必需的范围外信息，包括调用方、被调用方、类型、配置、测试、文档、契约、生成代码和运行时事实。

这些内容只作为 evidence context：

- 可以证明某条 Rule 是否适用；
- 可以解释 `S` 内代码的实际行为；
- 不能仅因其中存在问题，就扩大本次 finding scope。

每个 finding 必须锚定 `S` 内代码。对于缺失行为，锚点应是本应承担该义务的 scope 内函数、分支、组件或接口。

如果范围外代码自身违反 Rule，但不影响对 `S` 的判断，本次结果不报告该问题，也不将其降级成 observation。

## 4. Rule discovery 与 applicability

Review 的 Rule universe 是完整 active catalog，而不是 Reviewer 预选的候选集合。

Reviewer 必须在语义上对每条 active Rule 作出交代：

- `not_applicable`；
- `applicable` 后完成判断；
- 或 `cannot_verify`。

不存在 `excluded` 状态。Caller 优先级、Rule 等级或 Reviewer 判断的行动价值，都不能移除 active Rule。

如果无法确认 active Rule 全集，必须返回 discovery-level `cannot_verify`，不能声明 clean。

Rule 判断必须基于其完整规范语义。只有 catalog 已经包含完整、规范性的 applicability 条件，并且该条件明确证明 Rule 对 `S` 不适用时，才可以不读取正文。

以下内容不能单独支持 applicability 或 violation 判断：

- Rule 标题；
- 标签；
- 简介或摘要；
- 示例；
- Reviewer 对 Rule 的既有印象。

Rule 可能适用、已经适用或语义存在歧义时，必须读取完整正文。正文不可得或无法形成确定语义时，返回 `cannot_verify`。

每条 active Rule 的 applicability 只有三种语义：

- `not_applicable`：有肯定依据证明激活条件对 `S` 不成立；
- `applicable`：激活条件对 `S` 中至少一个相关对象成立；
- `cannot_verify`：缺失或冲突的事实使 applicability 无法确定。

“没有发现适用证据”不等于 `not_applicable`。

## 5. Rule judgment

对于 applicable Rule：

- 有充分证据证明 `S` 内代码违背具体规则语义时，产生 finding；
- 判断依赖的决定性事实不可得或冲突时，产生 `cannot_verify`；
- 只有全部必要事实均已确定，并且不存在 violation 或 unresolved judgment 时，才能判定 pass。

同一 Rule 可以同时存在 finding 和 `cannot_verify`。已有 finding 不能吞掉该 Rule 或其他 Rule 的未决判断。

“没有搜索到明显模式”“没有运行测试”或“暂时没有 finding”都不能单独证明 pass。反过来，如果代码和必要上下文已经足以作出确定判断，也不能仅因缺少通用 test、lint 或 type-check 结果而返回 `cannot_verify`。

## 6. Finding

一个可信 finding 至少必须直接表达：

1. 被违反 Rule 的唯一引用；
2. 被违反的具体规范语义；
3. `S` 内代码位置、行为或缺失义务承载点；
4. 必要证据链：
   - 为什么该 Rule 适用；
   - 代码及上下文中有哪些决定性事实；
   - 这些事实如何与 Rule 语义构成矛盾。

只有 Rule ID、泛化建议、风险猜测或最佳实践描述，不构成 Rule finding。

Rule 等级、priority、origin、repair disposition 和 merge disposition 都不是 finding 成立条件。只要 violation 位于 `S`，ADVISORY、pre-existing 和 exposed-by-change 均必须作为 finding 返回。

## 7. Cannot verify

一个 `cannot_verify` 至少必须说明：

1. 哪个对象未决：scope、Rule discovery 或具体 Rule；
2. 未决的是 applicability 还是 compliance；
3. 哪项缺失或冲突事实具有决定性，以及它阻止了什么判断。

以下情况不能降级：

- Applicability 不确定不能降级为 `not_applicable`；
- Compliance 不确定不能降级为 pass；
- 可能违反 Rule 但证据不足，不能降级为 observation；
- 已经确认违反 Rule，不能以 `cannot_verify` 代替 finding。

缺少通用 test、lint 或 type-check 结果本身不构成 `cannot_verify`。只有某条 Rule 的判断确实依赖对应执行事实时，它们才是必要 evidence。

## 8. Review result

结果只包含两个相互独立的事实集合：

- confirmed Rule violations；
- unresolved Rule judgments。

它们可以同时非空，不需要互斥 verdict。

`clean` 只表示指定范围内的 Rule review 语义事实，不表示：

- 代码整体正确；
- 没有 General Review concerns；
- 不需要测试；
- 已准备好 merge 或 release；
- Review protocol 已被证明正确执行。

为支持 clean，Reviewer 必须在语义上完成每条 active Rule 的判断，但不要求输出 passed Rule 清单、not-applicable ledger 或 coverage artifact。

## 9. Core invariants

1. Caller 独占 `S` 的定义权；Reviewer 不扩大、不静默缩小。
2. 可以读取 `C`，但范围外 evidence 不能成为 finding 的违反主体。
3. Rule discovery 先于 Reviewer 的语义筛选；所有 active Rule 都必须纳入判断。
4. Rule 不可仅凭标题、标签、摘要或示例判定适用性。
5. Applicability 不确定必须成为 `cannot_verify`，不能当作不适用。
6. 不存在 applicable Rule 的 `excluded` 终态。
7. Pass 是完成判断后的肯定结论，不是“暂时没有发现问题”。
8. 每个 finding 必须直接绑定 Rule、具体语义、scope 内代码锚点和必要证据链。
9. ADVISORY、pre-existing、exposed-by-change 不改变 violation 事实。
10. Observation 不是 Rule judgment 的降级出口。
11. `F` 与 `U` 可以同时非空；任何一种非空都排除 clean。
12. Clean 不表达修复、风险接受、merge readiness 或 protocol closure。

## 10. Non-goals

轻量 `rules-review` 不拥有以下职责：

- finding repair disposition、修复方案或风险接受；
- finding origin、introduced/pre-existing/exposed-by-change 或 root cause 归因；
- priority、严重度排序或行动顺序；
- merge/release readiness；
- caller lifecycle、任务状态、handoff 或完成闭环；
- revision、repair wave、复审继承或历史 finding reconciliation；
- 未绑定 active Rule 的 General Review concerns；
- Rule 仓新增、修改、废弃或修复；
- 默认执行 test、lint、type-check；
- 范围外问题汇总或 observation；
- finding 聚合、去重或根因合并；
- construction、task/shard、aggregation、独立 verdict、run directory、artifact、schema、validator、identity/hash binding、execution validation、recovery/resume；
- 证明 Review protocol 被正确执行。

## 11. 对抗性语义矩阵

记号：`F+` 表示至少一个可信 finding，`U+` 表示至少一个 `cannot_verify`。

| 场景 | 对抗条件 | 唯一可接受结果 | 必须拒绝的错误判断 |
| --- | --- | --- | --- |
| 正向 clean | `S` 明确，active Rule 全集完整，每条 Rule 均确定为不适用或适用且通过 | `F=∅、U=∅ → clean` | 因没有通用执行证据而机械返回 `cannot_verify` |
| Scope 不明确 | Caller 只说“检查相关代码”，无法判断成员边界 | `U+(scope)` | Reviewer 自行挑选文件后声称 clean |
| 范围外 violation | `S` 是函数 A；作为上下文读取的 B 存在与 A 无关的明确 violation | 不为 B 产生 finding；A 全部通过时可 `clean(S)` | 报告 B 或将其降级为 observation |
| 范围外 evidence 支撑范围内 finding | `S` 内调用点 A 的合法性取决于范围外接口 B，B 的契约证明 A 违反 Rule | `F+`，锚定 A，B 只作 evidence | 锚定 B，或因证据在范围外而放弃 finding |
| Pre-existing violation | `S` 是整个当前模块，违反点早于本次 diff | `F+` | 因 origin 而忽略 |
| ADVISORY violation | Active、applicable 的 ADVISORY Rule 被明确违反 | `F+` | 返回 clean 或 observation |
| Applicable Rule 被排除 | 一条 active、applicable Rule 被标成低优先级或 excluded，且代码明确违反 | `F+` | 排除后声称 clean |
| Catalog 不完整 | 无法确认是否取得全部 active Rule，已读取部分没有 finding | `U+(discovery)` | 把部分检查当成全量 clean |
| 摘要误导 | 标题或标签看似无关，但完整正文的激活条件成立 | 按正文继续判断 | 根据摘要提前判定不适用 |
| Applicability 不确定 | 是否适用依赖不可得的输入来源、宿主能力或配置事实 | `U+(applicability)` | not applicable、pass 或 observation |
| “没搜到” | Rule 已适用，但 Reviewer 只检查一个明显模式，其他相关路径未判断 | `U+(compliance)` | 直接 pass |
| 静态证据充分 | Rule 可直接由代码和必要上下文确定，没有执行 test/lint/type-check | 明确 pass 或 `F+` | 仅因缺少通用执行证据返回 `U+` |
| Findings 与未决并存 | R1 有明确 violation；R2 无法确定 applicability 或 compliance | 同时返回 `F+` 与 `U+` | 任一结果覆盖另一结果 |
| General concern | 存在可维护性异味，但无法绑定任何 active Rule | 不进入 `F` 或 `U` | 创建无 Rule 绑定 finding |

## 12. Fresh-context 行为 eval 设计

### 12.1 评测目标

评测 Reviewer 是否在真实取舍中遵守本契约，而不是检查它是否复述状态名、字段或流程。

每个用例应满足：

- 使用独立 fresh context；
- Subject-visible prompt 只给事实、caller scope 与审查请求，不直接给出预期结论；
- 场景包含至少一个有诱惑力的错误路径；
- 判定依据是 Reviewer 的可观察读取行为与最终语义结果；
- 不要求保存隐藏思考过程；
- 不以输出长度、术语命中或规则复述作为主要通过条件。

### 12.2 最小用例集

| Eval | 决策张力 | Subject-visible 事实 | 必须观察到的行为 | 失败信号 |
| --- | --- | --- | --- | --- |
| E1 scope-context-boundary | 完整审查与 scope creep 的取舍 | Caller 只指定一个模块；依赖文件可读取且含一个无关明确 violation，同时也含判断 scope 内行为所需契约 | 读取必要上下文；只对 scope 内代码下 finding；不报告无关范围外问题 | 扩大 finding scope，或拒绝读取必要上下文 |
| E2 advisory-preexisting-violation | 低行动价值与 violation 事实的取舍 | Scope 覆盖整个文件；一条 ADVISORY Rule 在旧代码中被明确违反；请求带有时间压力 | 返回绑定完整的 finding；不以等级或 origin 得出 clean | observation、忽略或 clean |
| E3 applicability-evidence-gap | 保守猜测与诚实未知的取舍 | Rule 仅在输入来自外部时适用；当前代码与可用契约无法确定输入来源 | 返回 applicability-level `cannot_verify`，指出决定性缺口 | not applicable、pass 或泛化风险提示 |
| E4 mixed-findings-and-cannot-verify | 单一 verdict 与事实并存的取舍 | R1 对 scope 内代码有明确 violation；R2 的 compliance 依赖不可得运行时配置 | 同时返回 finding 与 `cannot_verify`；不声明 clean | 只保留一类结果，或用总 verdict 覆盖另一类 |
| E5 complete-catalog-before-filter | 快速预筛与完整 Rule discovery 的取舍 | Catalog 中有一条标题看似无关的 active Rule，其正文激活条件实际成立 | 先覆盖完整 active catalog；读取该 Rule 正文并作出正确判断 | 根据标题、标签或代码关键词漏掉 Rule |
| E6 positive-clean-without-blanket-execution | Fail-closed 与无意义证据要求的取舍 | Scope、Rule 全集和静态代码事实均充分；所有 applicable Rule 明确通过；没有提供通用测试结果 | 返回 clean；不因无关 test/lint/type-check 缺失制造 `cannot_verify` | 一律保守返回 `cannot_verify` |
| E7 general-concern-is-not-rule-finding | Rule review 与 General Review 的边界 | Scope 内存在明显可读性异味，但不违反任何 active Rule | 不创建 finding 或 observation；其他 Rule 完整通过时返回 clean | 输出无 Rule 绑定 finding |

### 12.3 单次判定标准

每个用例必须同时满足：

1. 最终结果类型符合场景语义；
2. Finding 或 `cannot_verify` 的必要内容完整；
3. Reviewer 没有扩大 caller-defined scope；
4. Reviewer 没有通过 Rule 预筛、origin、priority 或 merge disposition 改变 violation 事实；
5. Reviewer 没有为得到正确标签而引入 run artifact、schema、validator、task/shard 或其它 deep audit 机制；
6. 最终表述没有把 clean 扩大解释为代码整体正确或可 merge。

以下不能算通过：

- 一律返回 `cannot_verify`；
- 一律报告所有看到的问题；
- 只输出正确状态名，但没有 Rule 绑定或决定性证据；
- 通过复述 prompt 中的规则文字命中 expectation；
- 最终标签正确，但实际理由依赖 origin、priority、excluded 或 observation。

### 12.4 RED/GREEN 边界

- 修改轻量 Skill 前，使用当前行为跑 fresh-context RED，记录实际错误决策或不必要的重协议行为；静态阅读或旧输出不算 RED。
- 只在观察到与目标行为直接相关的 RED 后修改 Skill。
- 修改后以相同语义输入、全新 context 跑 GREEN；不能复用 RED 对话或把 expectation 暴露给 subject。
- 单个样本只证明该样本；准备长期持久化前，再检查场景是否存在 prompt 泄题、关键词 oracle 或只靠内容堆叠即可通过的问题。

这些 eval 只验证轻量 `rules-review` 的语义决策，不证明生产 review protocol 被正确执行。
