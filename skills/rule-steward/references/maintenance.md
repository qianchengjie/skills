# 规则维护

进入规则或 namespace 维护时读取本文件。规则仓 Authority、Active 规则格式、规则级别语义和脚本入口以 [SKILL.md](../SKILL.md) 为准。

## 规则入库标准

默认不新增规则。候选内容只有同时满足以下条件，才允许成为 active rule：

1. **长期且可重复**：不是一次性任务说明、临时背景或单个 PR 细节。
2. **AI 易错**：对应 AI 容易忽略、误判、绕过或反复犯错的场景。
3. **可执行**：能指导 agent 做明确动作，不能只是口号或价值观。
4. **可审查、可留证**：reviewer 能根据当前材料判断 `pass / failed / cannot-verify`，并能写出最小证据要求。
5. **原子且非重复**：只表达一个可独立判定的判断点；如果要求可以独立触发、独立失败或独立修复，应拆分或分别归入已有规则，不得仅因共享上位目标而合并。若已有 active rule 覆盖，应修改或合并已有规则。
6. **生效条件明确**：能说明什么时候适用，不能靠主观感觉触发。
7. **低噪音**：降低未来错误的收益大于读取和维护成本。

以下内容不得作为 active rule：一次性任务要求、当前 bug 的临时背景、具体 workflow 的 artifact 格式、空泛最佳实践、单文件或单 PR 细节、无法写出失败条件或证据要求的建议、已被现有规则覆盖的重复表达。

处理候选规则时，决策必须使用以下枚举，并简要说明命中或未命中入库标准的依据：

- `NO_RULE`：不进入规则库。
- `UPDATE_RULE`：修改已有 active rule。
- `ADD_RULE`：在已有 namespace 文件中新增 active rule。
- `ADD_NAMESPACE`：新增 concern / domain 文件，并登记 namespace。
- `RETIRE_RULE`：从 active 文件移除已有 rule ID，并写入 `retired.md`。

维护动作与入库结论必须分开判断。选择 `UPDATE_RULE`、`ADD_RULE` 或 `ADD_NAMESPACE` 只表示拟采用的维护路径，不证明拟落地文本已经通过入库审查。决策依据必须说明拟落地规则的单一判断点，以及是否存在可独立触发、独立失败或独立修复的要求。

执行写入前，必须对拟落地文本重新核对全部入库标准；每次实质改写都产生一个新候选，必须重新决策。当前候选未全部满足时必须选择 `NO_RULE`，不得将其写入 active rule。

候选要求本身必须有可靠依据支撑其正确性，并用历史事故、finding 或重复失败说明入库必要性。正确性或必要性不成立时直接选择 `NO_RULE`；历史事故和 finding 只能证明必要性，不能替代候选规则的行为验证。

维护判断按以下顺序进行：

```text
正确性依据
→ 必要性证据
→ 内容入库审查
→ 适用时进行候选行为验证
→ 写入
→ 结构验证
```

内容入库标准不满足时继续使用 `NO_RULE` 硬门禁。以下维护需要候选行为验证：

- `ADD_RULE`；
- 新 namespace 的首条 active rule；
- 实质语义 `UPDATE_RULE`；
- 声称 replacement rules 覆盖旧规则的 `RETIRE_RULE`。

查询、初始化、编号、路由和纯格式编辑不适用候选行为验证。

命中以上维护动作时，写入前必须读取并遵循 [behavioral-validation.md](behavioral-validation.md)。

## Namespace admission

`concerns/` 和 `domain/` 是受控扩展目录。新增文件前必须先经过 rule-steward 判断：namespace 必须稳定，不能已被现有 namespace 覆盖，不能是技术栈大词，不能是临时项，也不能是 `misc` 桶。通过后，在 `index.md` 中登记该 namespace。

新增 namespace 必须比新增规则更严格：现有 namespace 无法自然容纳；不是技术栈大词或垃圾桶分类；有清晰、稳定、可判断的触发条件；预计会被多个任务反复命中；能绑定唯一 active 文件和独立 rule ID prefix；并登记到 `index.md`。

## 维护风险与验证

维护风险分层：

- 低风险：获取规则、解释级别语义、初始化空规则仓；可直接执行并说明结果。
- 中风险：在已有 namespace 下新增规则；需记录决策枚举、命中入库标准的依据、修改文件和验证结果。
- 高风险：新增 namespace、修改 active rule 语义、退役 rule；即使用户已明确点名维护动作和对象，也必须记录决策枚举、影响范围、判断依据、修改文件、验证结果和剩余风险。若用户没有明确点名该维护动作和对象，先给出建议和影响，等待确认后再修改。

维护验证必须区分三层：

- 内容审查：由 agent 或 reviewer 核对规则格式、入库标准、语义影响和证据要求，并记录判断依据。
- 行为验证：适用时判断候选精确文本是否在互斥对照中相对 baseline 产生预期改善，或最终替代集合是否保持旧规则仍然有效的行为，且未在近邻非适用场景中过度触发。
- 结构验证：写入后确认 `index.md` 登记、受影响 rule ID 的路由和预期状态正确，且没有 active / retired 冲突。

`get-rules.mjs` 和现有脚本成功只证明结构闭合，不证明规则内容正确、适合入库或行为有效。

## Retire lifecycle

初始化时不要创建 `.agents/rules/retired.md`。只有在第一条规则被废弃时才创建。

retired 记录格式：

```md
### REQ-003 请求层不承载 UI 语义

- 替代：REQ-007, STA-002
- 原因：拆分为请求契约和状态归属规则
```

没有替代规则时使用 `替代：无`。

执行 `RETIRE_RULE` 时必须一次完成：

- 从 active 规则文件移除对应规则块；同一 ID 不得同时出现在 active 文件和 `retired.md`。
- 在 `retired.md` 追加退役记录，写明替代规则和原因；无替代时使用 `替代：无`。
- `替代` 不是 `无` 时，退役前必须确认每个替代 rule ID 当前可获取且为 active；未知或已 retired 的替代 ID 阻塞完成。
- `替代` 不是 `无` 时，使用最终替代集合验证仍然有效的旧规则语义已被覆盖；行为结论为 `failed` 时不得退役。`替代：无` 时，必须用权威依据证明原约束已取消或不再适用。
- 退役审查旧规则的去留和替代覆盖，不要求已经不存在的 active 候选重新满足七项入库标准。
- 只有该 namespace 的全部 active rule ID 都已迁入 `retired.md`，并逐个验证返回 `DEPRECATED` 后，才能把 `index.md` 中的 namespace 状态改为 `retired`；仅退役部分规则时，namespace 保持 `active`，整个 namespace 退役后文件路径保留历史来源。
- 完成后运行 `node skills/rule-steward/scripts/get-rules.mjs <RULE-ID>`；必须返回 `DEPRECATED`。如果仍返回 active 或 `Rule ID is both active and retired`，不得声明退役完成。
