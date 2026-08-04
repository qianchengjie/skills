---
name: rule-steward
description: "管理 `.agents/rules/` 下的项目规则协议：初始化规则仓、定义 namespace 与规则 ID 约定、生成 active 规则目录、按 ID 获取规则，并引导受控的规则维护。用户要求创建、初始化、检查、获取、废弃或维护项目规则、规则 ID、namespace 或 `.agents/rules/index.md` 时使用。不要用于普通代码 review，也不要推断项目特定规则，除非用户明确要求初始化或维护规则仓。"
---

# rule-steward

`rule-steward` 管理项目规则协议。它不是 workflow skill，不是代码 reviewer，也不是项目规则内容包。

本 skill 可以检查和编辑 `.agents/rules/`，但除非用户明确要求初始化或维护规则仓，否则不得推断项目特定规则。

## 范围

使用本 skill 来：

- 初始化 `.agents/rules/`；
- 定义和维护 `.agents/rules/index.md`；
- 新增或检查 namespace 和规则文件；
- 新增、获取或废弃带编号的规则；
- 解释 `MUST`、`SHOULD`、`ADVISORY` 和 `cannot-verify` 语义。

不要使用本 skill 来：

- 定义 plan、review-package、close-check 或其他 workflow artifact 格式；
- 自动检测某个 diff 命中哪些规则；
- 判断代码是否符合项目规则；
- 在没有明确规则维护请求时创建项目特定规则。

如果其他 workflow 消费这些规则，保持指导通用：引用规则 ID，记录为什么认为某条规则适用，并且在类似 review 的任务里不要盲目信任上游规则选择。

## 目录协议

项目规则仓位于 `.agents/rules/`。

初始结构：

```text
.agents/
  rules/
    index.md
    always/
      constraints.md
    concerns/
      README.md
    domain/
      README.md
```

active 规则只能位于：

- `always/constraints.md`；
- 已登记的 `concerns/*.md` 文件；
- 已登记的 `domain/*.md` 文件。

`concerns/README.md` 和 `domain/README.md` 是目录说明，不是规则文件。不要在 README 文件里定义可执行规则 ID。

在项目规则协议内部，namespace 注册、规则 ID 和规则正文以 `.agents/rules/` 为准；这不覆盖系统 / 开发者 / 用户指令、仓库 AGENTS.md 或任务显式范围。若冲突影响执行权限，先说明冲突并按更高优先级指令处理。项目可以不提供 `.agents/AGENTS.md`。

## Index 协议

`.agents/rules/index.md` 是 namespace 注册表和规则路由来源。

使用完全一致的表格形状：

```md
## Namespaces

| Namespace | 状态 | 文件 | 触发条件 |
| --- | --- | --- | --- |
| `CORE` | active | `always/constraints.md` | 每次任务必读 |
```

规则：

- `Namespace` 必须匹配 `^[A-Z][A-Z0-9]*$`。
- `状态` 必须是 `active` 或 `retired`。
- `文件` 相对于 `.agents/rules/`；绝对路径、`..` 和 `./` 无效。
- active namespace 文件必须存在。
- retired namespace 文件路径是历史来源，可以已经不存在。

`CORE` 保留给无条件生效的项目底线规则，必须绑定到 `always/constraints.md`。

`concerns/` 和 `domain/` 是受控扩展目录。新增文件前必须先经过 rule-steward 判断：namespace 必须稳定，不能已被现有 namespace 覆盖，不能是技术栈大词，不能是临时项，也不能是 `misc` 桶。通过后，在 `index.md` 中登记该 namespace。

## 规则 ID

可执行规则需要稳定 ID：

```text
PREFIX-001
```

ID 格式：

```regex
^[A-Z][A-Z0-9]*-[0-9]{3}$
```

规则：

- `PREFIX` 必须是已登记 namespace。
- `PREFIX` 表示规则 namespace，不表示顶层目录。
- 一个 active namespace 映射到一个 active 文件。
- 一个 active 文件使用一个 namespace。
- 新规则编号使用该 namespace 下 active 或 retired 最大编号加一。
- 新 namespace 从 `001` 开始。
- 不要重排、回填或复用规则编号。

active 规则不得声明必须加载、展开或继承另一个规则 ID。规则文本可以提及另一个规则 ID，但 `rule-steward` 不解析、不展开，也不构建依赖图。

## Active 规则格式

使用此标题：

```md
### <RULE-ID> <中文短标题>
```

使用此正文：

```md
- 级别：MUST | SHOULD | ADVISORY
- 生效条件：<什么时候适用>
- 规则：<一句话写清楚必须做什么 / 禁止做什么>
- 证据要求：
  - <规则适用时必须留下的证据；载体由消费 workflow 指定，可以是 final report、review package、handoff、提交说明或其他可复核记录>
- 失败条件：
  - <什么情况算违反>
- 无法验证条件：
  - <什么情况下不能判 passed，只能判 cannot-verify>
```

文件级说明可以出现在第一条规则之前。第一条规则之后，不要插入独立的非规则章节；把解释放入相关规则块内。

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

候选行为验证必须：

- 由实际消费该规则并产生相关判断或行为的 workflow、reviewer 或 agent，在彼此隔离的上下文中分别执行对照两侧；阅读规则、分析覆盖关系、列举场景或人工推演结果只属于试验设计，不是行为验证；
- 使用拟写入的完整候选规则块和精确文本；
- 构造互斥对照：除本次变更涉及的规则块外，两侧的可见输入、其他规则、环境和判断标准保持一致；`ADD_RULE` 和新 namespace 的首条 active rule 使用“不含候选 / 加载候选”，实质语义 `UPDATE_RULE` 使用 `old-only / candidate-only`，带替代规则的 `RETIRE_RULE` 使用 `old-only / replacements-only`；
- `old-only`、`candidate-only` 和 `replacements-only` 只限定本次变更涉及的规则块；候选侧不得同时加载旧规则与候选或最终替代集合；
- 至少包含一个适用场景和一个近邻非适用场景；
- 在候选发生实质语义改写后重新验证。

行为结论只能是：

- `passed`：
  - 对 `ADD_RULE`、新 namespace 的首条 active rule 和实质语义 `UPDATE_RULE`，候选在适用场景中相对 baseline 产生事先定义的可观察改善；
  - 对带替代规则的 `RETIRE_RULE`，`replacements-only` 完整保持 `old-only` 中仍然有效的事先定义行为；
  - 近邻非适用场景未过度触发；
- `failed`：候选无效或越界，不得写入；
- `cannot-verify`：当前无法得到有效、可比的行为证据；不得表述为已验证或 `passed`，并须说明剩余风险。

对 `ADD_RULE`、新 namespace 的首条 active rule 和实质语义 `UPDATE_RULE`，若 baseline 与候选侧在事先定义的观察点没有差异，按以下证据分流：

- 有效、可比的试验中，baseline 未满足目标行为且候选侧仍未满足时，行为结论为 `failed`；
- baseline 已满足目标行为时，重新检查必要性和重复覆盖；进一步证据确认已有规则或稳定行为已经覆盖该要求时，维护决策选择 `NO_RULE`，无法确认稳定覆盖时行为结论为 `cannot-verify`；
- 当前观察点、对照或材料不足以可靠判断两侧行为时，行为结论为 `cannot-verify`。

`cannot-verify` 默认阻塞写入。只有在本次维护中单独向用户说明缺失的行为证据、无法验证的原因和剩余风险，并取得明确风险接受后才可继续；只确认修改动作和对象或一般性表示“继续”不构成风险接受。`failed` 不得通过风险接受继续写入。

需要候选行为验证的维护，只在当前维护报告或最终回复中记录实际消费者、候选精确文本或最终替代集合、必要性证据、两侧精确输入与对照配置、执行引用（命令、run ID 或其他可复核标识）、事先定义的观察点、适用场景中 baseline 与候选侧的原始结果或可定位引用及其差异或覆盖关系、近邻非适用场景结果、行为结论和剩余风险；不定义固定模板，也不要求填写不适用字段。已有 finding 只有绑定本次一侧的精确规则输入和执行引用时，才能作为该侧行为结果，不得替代另一侧。

维护风险分层：

- 低风险：获取规则、解释级别语义、初始化空规则仓；可直接执行并说明结果。
- 中风险：在已有 namespace 下新增规则；需记录决策枚举、命中入库标准的依据、修改文件和验证结果。
- 高风险：新增 namespace、修改 active rule 语义、退役 rule；即使用户已明确点名维护动作和对象，也必须记录决策枚举、影响范围、判断依据、修改文件、验证结果和剩余风险。若用户没有明确点名该维护动作和对象，先给出建议和影响，等待确认后再修改。

维护验证必须区分三层：

- 内容审查：由 agent 或 reviewer 核对规则格式、入库标准、语义影响和证据要求，并记录判断依据。
- 行为验证：适用时判断候选精确文本是否在互斥对照中相对 baseline 产生预期改善，或最终替代集合是否保持旧规则仍然有效的行为，且未在近邻非适用场景中过度触发。
- 结构验证：写入后确认 `index.md` 登记、受影响 rule ID 的路由和预期状态正确，且没有 active / retired 冲突。

`get-rules.mjs` 和现有脚本成功只证明结构闭合，不证明规则内容正确、适合入库或行为有效。

新增 namespace 必须比新增规则更严格：现有 namespace 无法自然容纳；不是技术栈大词或垃圾桶分类；有清晰、稳定、可判断的触发条件；预计会被多个任务反复命中；能绑定唯一 active 文件和独立 rule ID prefix；并登记到 `index.md`。

## 规则级别语义

- `MUST`：适用时必须满足；违反时应导致 review 失败；缺少证据时为 `cannot-verify`。
- `SHOULD`：默认应满足；偏离时需要明确原因和风险。
- `ADVISORY`：信息性指导；本身不得阻塞 done。

`cannot-verify` 表示当前材料不足以判断是否符合规则。

- 对 `MUST`，它会阻塞 passed / done，直到补充证据；如消费 workflow 支持降级，必须用显式 waiver / accepted-risk 状态记录授权来源、适用范围、原因和剩余风险，且不得把 `cannot-verify` 静默改写为 `passed`。
- 对 `SHOULD`，把它记录为风险；由消费它的 workflow 或 reviewer 判断是否阻塞。
- 对 `ADVISORY`，它本身不阻塞。

## Retired 规则

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

`retired.md` 不是 active 规则来源，也不作为普通规则文件登记。retired ID 仍必须使用 `index.md` 中已登记的 namespace；完全废弃的 namespace 仍保留在 `index.md` 中，状态为 `retired`，文件路径为历史路径。

当 `get-rules.mjs` 返回 retired ID 时，必须合成 `DEPRECATED` 提示：

```md
### REQ-003 DEPRECATED

- 原标题：请求层不承载 UI 语义
- 替代：REQ-007, STA-002
- 原因：拆分为请求契约和状态归属规则
```

## 脚本

初始化规则仓：

```bash
node skills/rule-steward/scripts/init-rules.mjs
node skills/rule-steward/scripts/init-rules.mjs --root /path/to/repo
```

如果 `index.md` 或它将创建的任何文件已经存在，`init-rules.mjs` 会失败。它永不覆盖，也没有 `--force`。

获取规则：

```bash
node skills/rule-steward/scripts/get-rules.mjs REQ-001 CORE-001
node skills/rule-steward/scripts/get-rules.mjs --root /path/to/repo REQ-001
node skills/rule-steward/scripts/get-rules.mjs --commit <FULL-OID> REQ-001

node skills/rule-steward/scripts/get-rules.mjs --catalog
node skills/rule-steward/scripts/get-rules.mjs --root /path/to/repo --catalog
node skills/rule-steward/scripts/get-rules.mjs --catalog --commit <FULL-OID>
```

`--catalog` 与规则 ID 互斥。catalog 只投影 active 规则的标题、级别、namespace
触发条件、生效条件和来源文件，并携带规则来源身份；它用于完整发现，不替代完整
规则正文。`source.files` 包含全部 active 文件，包括空文件，不包含
`retired.md`。所有路径均为 `.agents/rules/...` 仓库相对路径。

`--commit` 只接受 Git 返回的相同 40/64 位完整规范 commit OID；短 OID、tree、
blob 均失败，且不回退 workspace。`get-rules.mjs` 在所有校验成功后才写 stdout，
诊断只写 stderr。按 ID 模式仍先校验所有请求 ID 和冲突，再打印 Markdown；如果
任意 ID 失败，它不会打印部分规则正文。retired ID 是可识别历史，退出码为 0；
未知 ID 会失败。
