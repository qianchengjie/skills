---
name: rule-steward
description: "管理 `.agents/rules/` 下的项目规则协议：初始化规则仓、定义 namespace 与规则 ID 约定、按 ID 获取规则，并引导受控的规则维护。用户要求创建、初始化、检查、获取、废弃或维护项目规则、规则 ID、namespace 或 `.agents/rules/index.md` 时使用。不要用于普通代码 review，也不要推断项目特定规则，除非用户明确要求初始化或维护规则仓。"
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
  - <handoff / review package 里必须留下的证据>
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
5. **原子且非重复**：只表达一个判断点；若已有 active rule 覆盖，应修改或合并已有规则。
6. **生效条件明确**：能说明什么时候适用，不能靠主观感觉触发。
7. **低噪音**：降低未来错误的收益大于读取和维护成本。

以下内容不得作为 active rule：一次性任务要求、当前 bug 的临时背景、具体 workflow 的 artifact 格式、空泛最佳实践、单文件或单 PR 细节、无法写出失败条件或证据要求的建议、已被现有规则覆盖的重复表达。

处理候选规则时，决策必须使用以下枚举，并简要说明命中或未命中入库标准的依据：

- `NO_RULE`：不进入规则库。
- `UPDATE_RULE`：修改已有 active rule。
- `ADD_RULE`：在已有 namespace 文件中新增 active rule。
- `ADD_NAMESPACE`：新增 concern / domain 文件，并登记 namespace。
- `RETIRE_RULE`：从 active 文件移除已有 rule ID，并写入 `retired.md`。

如果候选内容不满足入库标准，必须选择 `NO_RULE`。

新增 namespace 必须比新增规则更严格：现有 namespace 无法自然容纳；不是技术栈大词或垃圾桶分类；有清晰、稳定、可判断的触发条件；预计会被多个任务反复命中；能绑定唯一 active 文件和独立 rule ID prefix；并登记到 `index.md`。

## 规则级别语义

- `MUST`：适用时必须满足；违反时应导致 review 失败；缺少证据时为 `cannot-verify`。
- `SHOULD`：默认应满足；偏离时需要明确原因和风险。
- `ADVISORY`：信息性指导；本身不得阻塞 done。

`cannot-verify` 表示当前材料不足以判断是否符合规则。

- 对 `MUST`，它会阻塞 passed / done，直到补充证据，或 workflow 明确降级处理。
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
- 如果整个 namespace 被废弃，保留 `index.md` 中的 namespace，状态改为 `retired`，文件路径保留历史来源。
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
```

`get-rules.mjs` 先校验所有请求 ID 和冲突，再打印结果。如果任意 ID 失败，它不会打印部分规则正文。retired ID 是可识别历史，退出码为 0；未知 ID 会失败。
