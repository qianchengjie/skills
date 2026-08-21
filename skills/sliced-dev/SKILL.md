---
name: sliced-dev
description: 当一个中大型软件开发目标需要拆成多个可独立验收、按依赖顺序交付的任务时使用；负责澄清分叉、维护 dev-plan、委托 deliver-task 并收口跨任务结果。
disable-model-invocation: true
---

# 切片开发

## 职责边界

`sliced-dev = decomposition + multi-task orchestration`。

- 输入是一个需要拆成多个独立交付单元的软件开发目标。
- 输出是已闭合的多任务计划，或一个明确的计划级阻塞 / 上游分叉。
- `sliced-dev` 拥有切片、依赖、分叉、当前指针、P/K/F 检查点和整任务审查。
- 每个单任务的上下文预检、项目规则读取、执行范围、claims、实现、验证、业务 commit、General Review、验收证据、rules-review 和单任务结果全部由 `deliver-task` 拥有。
- `sliced-dev` 不读取业务代码来替下游确定 `allowedPaths`，不创建 `execution.json`，不派发自己的 implementer / reviewer，也不复制下游审计正文到 plan。

如果目标本身已经是一个边界明确的单任务，直接使用 `deliver-task`，不要为了调用本 skill 创建单切片计划。执行中的 `deliver-task` 返回 `needs-reslice` 时，才由本 skill 接回并拆成多个任务。

## 真值 owner

| 真值 | Owner | 载体 |
| --- | --- | --- |
| 整体目标、全局约束、切片、依赖、当前状态 | `sliced-dev` | `plan.md` |
| 需要用户拍板的稳定分叉 | `sliced-dev` | `decisions.md` |
| 跨切片或计划级长证据 | `sliced-dev` | plan 根目录 `audits.md` |
| 单任务 immutable contract | caller=`sliced-dev` | `deliveries/<taskId>/task.json` |
| 单任务执行边界与全部交付证据 | `deliver-task` | 同一 task directory |
| 单任务结果 | `deliver-task` | `delivery.json` |

`sliced-dev` 只能根据 `delivery.json` 的结构化结果推进自己的状态；不得把 plan 字段当作第二份 General、acceptance、rules-review 或 target 状态。

## 开始与续跑

1. 读取用户目标、适用的项目规则和明确上游依据。
2. 若已有 `dev-plans/YYYY-MM-DD-<slug>/`，先读取 `plan.md`、`decisions.md`、plan 根目录 `audits.md`，再运行：

   ```bash
   node <sliced-dev-skill-dir>/scripts/dev-plan.mjs validate dev-plans/YYYY-MM-DD-<slug>
   node <sliced-dev-skill-dir>/scripts/dev-plan.mjs show dev-plans/YYYY-MM-DD-<slug> current
   ```

3. 状态不闭合时从持久检查点继续；压缩前对话、旧 agent 记忆和临时 review package 都不是真源。
4. 新计划使用 `init`，按 [PLAN-FILE.md](PLAN-FILE.md) 补齐目标、全局约束和切片。

## 分叉与拷问

先清分叉，再确认执行。完整规则见 [EXECUTION-RULES.md](EXECUTION-RULES.md)。

- 决策分叉是需求、产品行为、公共契约、用户禁止范围、非目标、上游或验收口径不唯一；写入 `decisions.md`，`open` 时阻塞关联切片。
- 文件落点、执行 allowlist、测试位置、验证命令和规则适用性不是默认用户分叉；这些由下游读取真实代码后判断。
- 计划一致性预检通过后，先处理整体拆分拷问；每个候选需确认或高风险切片在委托前还要处理本片拷问。

发起整体拆分拷问时先展示：

```text
> 拷问对象：整体拆分方案
```

发起切片拷问时先展示：

```text
> 拷问对象：切片 <S-id>「<切片标题>」
```

然后要求用户只回复 `拷问` 或 `不拷问`。`继续`、`确认`、`是`、`好的` 等都不是有效口令，不能据此跳过 `pending-grill`。即使没有 `open D`，`pending-grill` 也仍是未完成的门禁。

进入 `grilling` 后逐个压实真实分叉。没有更多问题时展示同一拷问对象并发送“拷问收口候选”，要求用户回复 `结束拷问` 或 `继续拷问`；只有 `结束拷问` 将门禁写为 `grilled`。用户在门禁问题之外补充事实或提问时，先处理内容，再重问当前门禁。

## 形成切片

切片必须是可独立验收的纵向交付单元，而不是按文件层、技术层或 agent 数量拆分。

- 一个切片只有一个明确目标和一组可观察验收条件。
- 切片之间用 `依赖` 和 `切片交接` 表达顺序与稳定输入 / 输出。
- 所有切片继承顶层 `全局约束`；单片约束、非目标和用户禁止范围写在 `委托合同`。
- 多个实现步骤共同完成同一验收结果时仍是一个切片；能独立验收、独立发布或失败后不阻塞其它部分时才拆开。
- 脚本只检查结构、依赖和明确状态，不判断拆分质量；拆分质量由 controller 在计划一致性预检与拷问中负责。

## 委托单任务

切片门禁闭合、风险 / 执行模式明确且依赖已 `done / skipped` 后：

1. 如风险为 `C`、执行为 `需确认` 或新增不可逆外部操作，先向用户展示目标、验收、约束、非目标和禁止范围，取得本片执行确认。普通 `自动` 片无需重复确认。
2. 运行：

   ```bash
   node <sliced-dev-skill-dir>/scripts/dev-plan.mjs delegate-task <planDir> <S-id>
   ```

3. 该命令只创建或更新 `deliveries/<taskId>/task.json`：
   - `caller.kind=delegated`
   - `caller.name=sliced-dev`
   - `caller.ref=<planDir>/plan.md#<S-id>`
   - `commitPolicy=required`
   - `acceptancePolicy` 原样来自切片合同
4. 立即把该 task directory 交给 `deliver-task` controller。第一位下游执行者必须是 `deliver-task`，不是 `sliced-dev implementer`。
5. caller 不创建 `execution.json`，也不预填允许路径、selected rules、claims 或审查包。用户没有给文件清单不是回流条件；`deliver-task` 会在 preflight 后自行建立执行边界。

计划层普通措辞、当前指针或编排状态变化不会改变 task identity。目标、验收、约束、非目标、禁止范围、caller、commit policy 或 acceptance policy 变化时，重新运行 `delegate-task` 创建新 revision；明确需要把同一语义合同移到当前 HEAD 时使用 `--refresh-base`，base 变化同样创建新 revision。旧 task evidence 不自动证明新 revision。

## 消费 delivery

下游返回后先运行：

```bash
node <sliced-dev-skill-dir>/scripts/dev-plan.mjs delivery-status <planDir> <S-id>
```

只按当前 task binding 下的 `result` 推进：

| result | sliced-dev 动作 |
| --- | --- |
| `delivered` | 将切片更新为 `done`，运行 `slice-close-check`，再创建 plan checkpoint K |
| `needs-upstream` | 保持未完成；根据 `upstreamRequest.kind` 取得 caller / 用户判断，之后让 `deliver-task` 在同一任务继续，或合同变化时新建 revision |
| `needs-reslice` | 将原片更新为 `split`，新增后代切片并重新走计划一致性与拷问；不得把原片写成 `done` |
| `blocked` | 将切片和计划置为 `blocked`，公开 task-owned evidence refs 与可恢复条件 |

`upstreamRequest.evidenceRefs` 是定位入口，不是理由正确性的机器证明。controller 必须阅读引用证据后再作语义判断。

需要用户验收时，`deliver-task` 先返回 `needs-upstream / user-acceptance`。`sliced-dev` 负责把绑定当前 target 的验收内容呈现给用户，并把回复交回同一 `deliver-task`；由 `deliver-task` 在 task-owned `audits.md` 写 acceptance A 条目并重新产出 delivery。验收状态不进入 task identity；同一 target 的 General evidence 不因新增验收记录而 stale。用户拒收但 immutable contract 未变时保持同一 revision 返修，形成新 target 后旧验收自动失效。

`slice-close-check` 只验证当前 plan 的 `done` 与下游 `delivered` 结构 / identity 闭合，不重做下游 review，也不解释证据内容。单任务 `close-check` 应由 `deliver-task` 在返回前完成；caller 随后的 plan 修改不属于单任务 target。

## P / C / K / F

完整链路是：

```text
P → C1 → K1 → C2 → K2 … → Cn → Kn → [F]
```

- `P`：首个委托前的 plan-only 检查点。
- `C`：`deliver-task` 按 `commitPolicy=required` 创建的业务 commit 或 commit range；无变化任务不创建空 commit。
- `K`：caller 消费本片 delivery 后的 plan-only 检查点，包含当前 plan 真源和 task-owned durable state。
- `F`：需要整任务审查或 Kn 后仍有计划级变化时的最终 plan-only 检查点；否则最终 Kn 可兼任 F。

每次 plan commit 前 scoped stage 持久文件，再运行：

```bash
node <sliced-dev-skill-dir>/scripts/dev-plan.mjs plan-commit-check <planDir>
git diff --cached --check
```

不得把业务文件、`deliveries/*/artifacts/` 或 `review-packages/` 放进 P/K/F。提交消息服从当前仓库规则；本 skill 不另造 type / scope 规范。

## 整任务收口

单任务 General Review 已由各自 `deliver-task` 完成。只有用户明确要求整体验收 / 跨切片审查 / 发布就绪度，或跨切片约束无法由单片 review 覆盖时，才生成整任务包：

```bash
node <sliced-dev-skill-dir>/scripts/dev-plan.mjs whole-review-package <planDir>
```

整任务 reviewer 只检查全局约束、跨切片交接、非目标回归、需求闭合和残余风险，不重做单任务 General 或 rules-review。把 package hash 和五项 verdict 写回 `plan.md` 后运行 `close-check`。`close-check` 只接受明确 `passed` 且绑定当前 package 的结论；不根据文本强度猜测通过。

## 文件路由

| 当前动作 | 必读 |
| --- | --- |
| 新建 / 修改 / 续跑 plan | [PLAN-FILE.md](PLAN-FILE.md) |
| 新建 / 修改 / 确认 D | [DECISIONS-FILE.md](DECISIONS-FILE.md) |
| 新建 / 引用计划级 A | [AUDITS-FILE.md](AUDITS-FILE.md) |
| 拷问、委托、结果回流、P/C/K/F、整任务收口 | [EXECUTION-RULES.md](EXECUTION-RULES.md) |
| CLI 命令与机器门禁 | [SCRIPTS.md](SCRIPTS.md) |

涉及单任务内部动作时切换到 `deliver-task` 并遵循它自己的文档；不要把 `deliver-task` 的内部规则复制回本目录。
