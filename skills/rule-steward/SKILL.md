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
- 通过条件：
  - <规则满足时必须达到的可观察、实现无关结果>
- 证据要求：
  - <规则适用时必须留下的证据；载体由消费 workflow 指定，可以是 final report、review package、handoff、提交说明或其他可复核记录>
- 失败条件：
  - <什么情况算违反>
- 无法验证条件：
  - <什么情况下不能判 passed，只能判 cannot-verify>
```

`规则` 是规则语义真源。`通过条件` 必须忠实、完整地覆盖 `规则` 正文，只描述规则满足时可观察的结果，不引入新要求，也不额外限定实现；规则正文已经明确指定机制时，按原约束忠实投影。`失败条件` 是非穷尽反证，不是通过条件的取反清单。`证据要求` 必须能证明全部通过条件；规则级别只影响违反后的处置，不改变规则是否满足的事实。

文件级说明可以出现在第一条规则之前。第一条规则之后，不要插入独立的非规则章节；把解释放入相关规则块内。

## 维护路由

只读获取、级别解释和初始化空规则仓直接使用本文件。

新增、修改、废弃规则或 namespace，以及处理候选规则时，必须先读取 [references/maintenance.md](references/maintenance.md)。该文件会在需要候选行为验证时继续路由到 [references/behavioral-validation.md](references/behavioral-validation.md)。

## 规则级别语义

- `MUST`：适用时必须满足；违反时应导致 review 失败；缺少证据时为 `cannot-verify`。
- `SHOULD`：默认应满足；偏离时需要明确原因和风险。
- `ADVISORY`：信息性指导；本身不得阻塞 done。

`cannot-verify` 表示当前材料不足以判断是否符合规则。

- 对 `MUST`，它会阻塞 passed / done，直到补充证据；如消费 workflow 支持降级，必须用显式 waiver / accepted-risk 状态记录授权来源、适用范围、原因和剩余风险，且不得把 `cannot-verify` 静默改写为 `passed`。
- 对 `SHOULD`，把它记录为风险；由消费它的 workflow 或 reviewer 判断是否阻塞。
- 对 `ADVISORY`，它本身不阻塞。

## Retired 规则

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
node skills/rule-steward/scripts/get-rules.mjs --root /path/to/repo --catalog --optional-source
```

`--catalog` 与规则 ID 互斥。catalog 只投影 active 规则的标题、级别、namespace
触发条件、生效条件和来源文件，并携带规则来源身份；它用于完整发现，不替代完整
规则正文。`source.files` 包含全部 active 文件，包括空文件，不包含
`retired.md`。所有路径均为 `.agents/rules/...` 仓库相对路径。

`--optional-source` 只允许与 workspace `--catalog` 一起使用，不能配合 `--commit`。当项目从未存在 `.agents/rules/` 来源时，它成功返回 `source.kind = absent` 与空 `rules`；合法但零 active 规则的规则仓仍返回真实 workspace source 与空 `rules`。只要工作区、Git index 或 `HEAD` 表明规则来源应存在，缺失 index、缺失 active 文件、残缺格式、损坏内容或重复 ID 都继续 fail closed。普通 `--catalog` 的 strict 语义不变。

`--commit` 只接受 Git 返回的相同 40/64 位完整规范 commit OID；短 OID、tree、
blob 均失败，且不回退 workspace。`get-rules.mjs` 在所有校验成功后才写 stdout，
诊断只写 stderr。按 ID 模式仍先校验所有请求 ID 和冲突，再打印 Markdown；如果
任意 ID 失败，它不会打印部分规则正文。retired ID 是可识别历史，退出码为 0；
未知 ID 会失败。active rule 缺少非空、两空格缩进的 `通过条件` 列表时 fail closed，
不兼容旧格式规则来源。
