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

如有冲突，以 `.agents/rules/` 为准。项目可以不提供 `.agents/AGENTS.md`。

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
