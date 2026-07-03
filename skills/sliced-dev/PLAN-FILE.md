# 切片开发 · plan.md 文件

本文主要描述目录化完整档中的 `plan.md`，以及与切片状态绑定的结构化 sidecar。`decisions.md` 见 [DECISIONS-FILE.md](DECISIONS-FILE.md)，`audits.md` 见 [AUDITS-FILE.md](AUDITS-FILE.md)。

## 命名

完整档默认使用目录：

```text
dev-plans/
  .gitignore
  YYYY-MM-DD-<slug>/
    plan.md
    decisions.md
    audits.md
    ledger.md        # durable checkpoint ledger
    claims/          # 每个切片的结构化 Claim / Evidence / Status 真源，提交入库
      S1.json
    task-briefs/      # 生成文件，gitignore
    task-reports/     # implementer 结构化交付报告，默认 S*.json，gitignore
    review-packages/  # 生成文件，gitignore
```

`<slug>` 只使用小写字母、数字和连字符。新建目录优先使用 [SCRIPTS.md](SCRIPTS.md) 的 `init` 命令；脚本会确保 `dev-plans/.gitignore` 至少包含 `*/review-packages/**`、`*/task-briefs/**`、`*/task-reports/**`。

## plan.md 模板

```markdown
# <任务标题>

> 档位：完整
> 状态：draft
> 上游依据：无 / OpenSpec:<change-name> / PRD:<path> / issue:<id> / 设计文档:<path> / 待确认
> 计划一致性预检：pending
> Whole Review：pending
> 拆分拷问：pending-grill

## 当前状态

- 阶段：slicing
- 当前切片：待定
- 下一步：完成任务级分叉门禁并产出切片

## 文件索引

| 文件 | 职责 |
| --- | --- |
| [decisions.md](./decisions.md) | 分叉正文 |
| [audits.md](./audits.md) | 长审计、证据矩阵、diff inventory |
| [ledger.md](./ledger.md) | durable checkpoint ledger |
| [claims/S*.json](./claims/) | 每个切片的结构化 Claim / Evidence / Status 真源 |

## 目标

<一句话目标>

## 全局约束

- 暂无。

## Whole Review 结论

待 whole review 后填写。

## 切片

待拆分。
```

## 切片块模板

```markdown
### S1：<标题>

- 状态：not-started
- 门禁：pending-grill
- 候选：候选需确认
- 风险：待判定
- 执行：待判定
- 上下文预检：pending
- 硬门禁：pending
- AI Review：pending
- 用户验收：pending
- 修复次数：0/2
- 依赖：无
- Commit：待提交
- 验证：pending

#### 关联项

暂无。

#### 上下文预检

- 需理解：待执行前补充。
- 必读上下文：待执行前补充。
- 项目规范:
  - 待执行前补充。
- 允许修改：
  - 待执行前补充。
- 禁止修改：
  - 待执行前补充。
- 禁止词：
  - 无
- 基线脏文件：
  - 无
- 非目标：
  - 待执行前补充。
- 停止条件：上下文不足、需要越界修改、或风险升为 C 时停止。

#### 接口契约

- 消费:
  - 无
- 产出:
  - 无

#### 门禁记录

| Gate | Command | Status | Evidence |
| --- | --- | --- | --- |
| diff-check | pending | pending | pending |

- 失败处理：修复次数用尽仍失败则停止并报告。

#### 任务内容

...

#### 验收

...
```

`S*` 使用数字路径：`S1`、`S2.1`、`S2.1.4`。不要使用 `S4a`、`切片 4a` 或中文编号。

## 执行控制字段

顶部元信息和每个切片必须显式记录执行控制字段。它们的目的不是描述代码实现，而是给自动化流程提供状态机和拒收依据。

顶部 `计划一致性预检` 只允许：

- `pending`：尚未完成整计划一致性预检；只能停在 `状态：draft`、`阶段：slicing`、`拆分拷问：pending-grill`，不能进入拆分拷问或执行。
- `passed`：切片清单、全局约束、D/A、依赖、候选风险和验证口径没有发现内部冲突。
- `blocked（D1 / D2）`：发现计划内部冲突或需要用户拍板的分叉；必须引用至少一个 `open` D，且不能进入拆分拷问或执行。正文写到 `decisions.md`，长证据写到 `audits.md`。

计划一致性预检不设独立 `##` 章节；通过结果只更新顶部字段，分叉和长证据分别走 D/A。

顶部 `Whole Review` 只允许：

- `not-required`：控制器明确不做 whole review。
- `pending`：尚未生成整任务审查包或尚未进入整任务审查。
- `package-generated`：已生成 `review-packages/whole-task.md`，等待把整任务审查结论写回。
- `passed`：整任务审查已通过，且 `## Whole Review 结论` 有完整固定 verdict 表。
- `blocked`：整任务审查阻塞；`## Whole Review 结论` 表的 Evidence 填写 review-package 章节名、文件路径或固定不适用标记，阻塞说明写在顶部 `Whole Review` 状态摘要或正文说明中，不写入 Evidence。

是否需要 whole review 由控制器 / reviewer 判断；`close-check` 只按顶部 `Whole Review` 状态校验对应格式。

- `风险`：`待判定` / `A` / `B` / `C`。
  - `A`：低风险机械任务，可自动跑到底。
  - `B`：普通业务切片，必须做上下文预检、硬门禁和 AI Review。
  - `C`：核心业务 / 状态机 / 权限 / 架构边界等高风险切片，上下文预检和方案后必须停下等人工确认。
- `执行`：`待判定` / `自动` / `需确认`。正式执行模式在切片前分叉审查通过、上下文预检完成后写回；`风险：C` 不允许 `执行：自动`。
- `上下文预检`：`pending` / `ready` / `blocked` / `skipped` 开头，可追加中文说明。
- `硬门禁`：`pending` / `passed` / `failed` / `blocked` / `skipped` 开头，可追加中文说明。
- `AI Review`：`pending` / `passed` / `issues` / `blocked` / `skipped` 开头，可追加中文说明；`issues` / `blocked` 必须有非占位头部摘要 / 原因，或在 `#### AI Review 结论` 中有带非占位 Note 的 `failed` / `cannot-verify-from-package` / `Severity=major|critical` verdict。
- `用户验收`：`pending` / `passed` / `issues` / `skipped` 开头，可追加中文说明；`skipped` 必须写明用户明确跳过原因。
- `修复次数`：`当前次数/最大次数`，例如 `0/2`、`1/2`，统计本切片的自动修复总次数，不按门禁分别计数。次数用尽后任一门禁仍失败则停止，不继续自动修。

完成态约束：`状态：done` 的切片必须满足 `上下文预检：ready/skipped`、`硬门禁：passed/skipped`、`AI Review：passed/skipped`、`用户验收：passed/skipped`，且 `风险` / `执行` 不得为 `待判定`；`风险：B/C` 的切片三项机器门禁不允许 `skipped`，`skipped` 仅限 A 类。仍为 `issues / failed / blocked / pending` 时不得标记完成。只要写 `AI Review：passed`，无论切片状态是否 `done`，都必须有完整 `#### AI Review 结论` 三 verdict，且不得出现 `failed` / `cannot-verify-from-package` / `critical`。

## 全局约束

`全局约束` 记录本次任务中所有切片都必须继承、不可违反的全局需求约束；来源可以是用户明确口径、上游 spec、项目规则或已决定的 D 结论，但只写会影响本任务执行和 review 判断的精确规则。

- 不复制全部仓库规则，只写本次任务不可违反的约束。
- 不写流程机制、审计证据、问答流水或实现方案。
- D 的结论只有影响后续多个切片时才提炼进本节；只影响单片的口径留在 D 和切片关联项。
- 上下文预检和 AI Review 必须把本节作为当前切片默认继承的约束。

## 上下文预检

每个切片必须有 `#### 上下文预检`。该块在切片执行前更新，目标是让 agent 先暴露“需要看什么、允许改什么、不能改什么、何时停止”，而不是直接进入实现。

必需字段：

- `需理解`：本片必须理解的业务、调用链、项目风格或旧行为。
- `必读上下文`：执行前必须读取的文件、搜索关键词或证据；只列必要上下文，不复述全项目。
- `项目规范`：本片必须遵守并供 review 引用的项目规则入口或摘录；无则写 `无`。
- `允许修改`：本片允许改动的文件、目录或 glob。`diff-check` 会读取该列表。
- `禁止修改`：本片禁止改动的文件、目录或 glob。`diff-check` 会读取该列表。
- `禁止词`：可选的禁止新增词 / 命名同义词 / 高风险模式；无则写 `无`。
- `基线脏文件`：可选的切片开始前已存在的无关脏文件 / 目录；`diff-check` 会跳过这些路径，无则写 `无`。与本片混改的文件不要列入，由 scoped staging 拆分。
- `非目标`：本片明确不处理的边界。
- `停止条件`：出现哪些情况必须停止并回到分叉确认或人工裁决。

`允许修改` 不允许长期写宽泛的“全部”。若执行中发现需要越界改动，不能直接改，应先停止并说明为什么当前切片边界不足。

当切片头部写 `上下文预检：ready` 时，`需理解`、`必读上下文`、`允许修改`、`非目标`、`停止条件` 必须是已填写内容，不得仍为 `待执行前补充`、`TBD`、`TODO`、`待补充`、`未填写` 等占位内容；`项目规范` 和 `禁止修改` 也必须显式存在，但可以写 `无`。

## 接口契约

`#### 接口契约` 是切片内可选小节，用于记录当前切片与其他切片之间的接口交接；它贴近 Superpowers 的 task-local handoff，不做顶层接口注册表。脚本硬触发只看切片头部 `依赖` 字段，不用跨模块、共享口径、白名单、平台门禁等启发式代替依赖判断。

触发条件：

- 当前切片头部 `依赖` 声明了 `S*`。
- 当前切片被其他切片头部 `依赖` 声明为前置。

不触发：单片内部 helper、局部变量、样式、文案、纯实现步骤。

若出现 `#### 接口契约`，必须包含：

```markdown
#### 接口契约

- 消费:
  - I1 from S1
- 产出:
  - I2 `接口名`（类型）：产出的精确签名、字段或语义。
```

依赖存在但没有真实接口交接时，必须说明原因：

```markdown
#### 接口契约

- 消费:
  - 无
- 产出:
  - 无
- 无契约原因：S2 只在执行顺序上依赖 S1，不消费或产出稳定接口。
```

规则：

- `I*` 是整份 plan 全局唯一接口 ID，例如 `I1`、`I2`。
- `产出` 是接口契约唯一真源；同一个 `I*` 只能出现一次。
- `消费` 只允许 `I* from S*`，例如 `I1 from S1`，不复制契约正文。
- `消费` 不能引用当前切片；接口消费只能指向前序切片产物。
- 消费方切片头部 `依赖` 必须包含 `from` 后的生产切片。
- 依赖方若 `消费` 为 `无`，必须写非占位 `无契约原因`。
- 被依赖方若 `产出` 为 `无`，必须写非占位 `无契约原因`。
- 无内容可写 `无`，但 `无` 不得和真实条目同时出现。

`接口契约` 只写稳定契约，不写实现步骤；当前切片执行和 AI Review 必须覆盖本节声明的消费和产出契约。反向消费者关系从 `消费` 解析，不手写。

## 门禁记录

每个切片必须有 `#### 门禁记录`，记录 diff-check 结果、接收门禁和门禁执行摘要（如每次修复改了什么）。硬门禁、AI Review、修复次数的状态唯一真源是切片头部字段，不在本小节重复记录同名状态行；详细失败信息仍放在本切片 `验证备注` 或 `audits.md` 的长证据中。`状态：done` 时，`close-check` 要求 diff-check 记录为结构化表格，且 command / evidence 非空、非占位；command 中的 `diff-check <planDir> <S-id>` 必须指向当前计划目录和当前切片。
## Claims / Evidence / Status

`claims/S*.json` 是每个切片的 Claim / Evidence / Status 结构化真源。`plan.md` 继续承载切片叙事、上下文预检、门禁状态和 AI Review 结论；不要把完整 claims 状态双写进 Markdown 表格，也不要在 `plan.md` 双写完整 task report 状态。task brief、task report、review-package 和 whole-review-package 只渲染或回传 claims 信息。

每个可执行切片建议在实现前生成 claims 文件：

```bash
node <sliced-dev-skill-dir>/scripts/dev-plan.mjs claims-template dev-plans/YYYY-MM-DD-<slug> S1
```

最小结构：

```json
{
  "schemaVersion": "sliced-dev.claims.v1",
  "sliceId": "S1",
  "claims": [
    {
      "id": "C1",
      "type": "behavior",
      "priority": "P0",
      "text": "S1 的可观察业务行为已实现。",
      "status": "proposed",
      "evidence": [],
      "note": ""
    }
  ]
}
```

Claim 字段规则：

- `id`：使用 `C1`、`C2`、`C3`，在当前切片内唯一。
- `type`：推荐使用 `behavior` / `scope` / `validation` / `risk`。
- `priority`：推荐使用 `P0` / `P1` / `P2`。
- `text`：必须是可验证声明，不写实现步骤，不写“完成本片”这类粗声明。
- `status`：推荐使用 `proposed` / `implemented` / `verified` / `failed` / `blocked` / `waived`。
- `evidence`：证据数组，优先使用机器证据。
- `note`：用于 waiver 原因、阻塞说明或必要补充。

Evidence 字段规则：

- `kind`：推荐使用 `test` / `command` / `diff-check` / `code` / `ci` / `manual` / `ai-statement`。
- `status`：推荐使用 `passed` / `failed` / `blocked` / `skipped` / `not-applicable`。
- 可选字段：`command`、`file`、`symbol`、`uri`、`summary`、`artifact`；其中 `symbol` 只能作为辅助定位，不能单独满足证据明细要求。
- 脚本只校验 evidence 是数组，条目是对象，已知可选字段为字符串；证据是否足够由控制器和 reviewer 判断。

状态职责边界：

- `proposed`：实现前声明。
- `implemented`：实现者建议已完成，但尚未被控制器验证。
- `verified`：控制器依据测试、命令、diff-check、CI、代码证据或人工验证确认成立。
- `failed`：有证据证明声明不成立。
- `blocked`：无法验证或需要人工裁决。
- `waived`：明确豁免。

`done` 切片的 claims 格式约束由 `close-check` 执行：必须存在 `claims/<S-id>.json`，且是可解析 JSON、字段形状正确，最终状态必须是 `verified` 或 `waived`。`validate` 会校验已有 claims 文件的 JSON / 字段形状和孤儿文件，但为了兼容草稿 / 未执行切片，不强制每个非 done 切片提前存在 claims 文件。


`close-check` 不读取当前 git dirty 状态；边界检查由显式 `diff-check` 门禁记录承载。

建议字段：

```markdown
#### 门禁记录

| Gate | Command | Status | Evidence |
| --- | --- | --- | --- |
| implementer-acceptance | task-reports/<S-id>.json | passed | ready-for-review; changed files within 允许修改; no 禁止修改 hit |
| diff-check | node /absolute/path/to/sliced-dev/scripts/dev-plan.mjs diff-check dev-plans/2026-06-30-example S1 | passed | changed files within 允许修改; no 禁止修改 hit |

- 失败处理：修复次数用尽仍失败则停止并报告。
```

## Task Brief / Task Report

`task-briefs/<S-id>.md` 和 `task-reports/<S-id>.json` 由脚本生成，是实现与审查的临时交接文件，不写入 `plan.md` 正文。`task-reports/<S-id>.json` 是 implementer 的结构化交付报告 / update request，不是 Claim / Evidence / Status 的最终真源；只有 legacy `task-reports/<S-id>.md` 存在时才按旧格式兼容。

- task brief 从当前切片、`全局约束`、`上下文预检`（含 `项目规范` / `禁止词` / `基线脏文件`）、`接口契约`、关联 D/A、门禁记录和 `claims/<S-id>.json` 提取窄上下文；修改运行时逻辑时，implementer subagent 必须补直接相关测试，或在 task report 说明不适用原因。
- task report 由 implementer subagent 填写 `completed`、`changedFiles`、`briefConsistency`、`claimUpdates`、`validation`、`risks`、`reviewFocus` 和 `conclusion`；控制器不得代写 ready report。
- `claimUpdates[*].proposedStatus` 只允许 `proposed` / `implemented` / `blocked` / `failed`，不得写 `verified` / `waived`。
- `conclusion: ready-for-review` 时，所有 P0/P1 claims 的 `claimUpdates` 必须是 `implemented`，并提供 evidence 或 note。
- `review-package` 只接受 `conclusion: ready-for-review` 的 task report。
- `review-package` 必须包含 `项目规范`；Evidence 填写 review-package 章节名、文件路径或固定不适用标记；自然语言判断写 Note。

## AI Review 结论

`#### AI Review 结论` 是 AI Review 的结构化输出。执行前可省略；生成 `review-package` 并完成 AI Review 后再写入。`AI Review` 头部字段仍是真源状态：有可修问题写 `issues`，无法判断写 `blocked`，三项 verdict 收口后才写 `passed`；一旦头部写 `AI Review：passed`，本表必须存在且三项 verdict 完整。`AI Review：issues` / `AI Review：blocked` 必须在头部写非占位摘要 / 原因；若头部未写原因，本表必须提供对应 `failed` / `cannot-verify-from-package` / `Severity=major|critical` 且 Note 非空、非占位的说明。Evidence 填写 review-package 章节名、文件路径或固定不适用标记；自然语言说明写 Note。

固定三项 verdict：

- `Requirement Compliance`：需求与验收是否被当前 diff 满足。
- `Slice Boundary / Interface Compliance`：是否遵守上下文预检、非目标、禁止修改、全局约束与接口契约。
- `Code Quality / AI Contamination Check`：是否覆盖 maintainability、test quality、unnecessary complexity、project style consistency、project rules compliance、performance footguns、error handling consistency，以及无领域语义 helper、无证据 fallback、新同义词、过早抽象、吞非法状态等 AI 污染。旧记录中的 `AI Contamination Check` 仅作兼容。

表格格式：

```markdown
#### AI Review 结论

| Verdict | Status | Severity | Evidence | Note |
| --- | --- | --- | --- | --- |
| Requirement Compliance | passed | not-applicable | Task Brief / Git Diff | 覆盖验收 |
| Slice Boundary / Interface Compliance | passed | not-applicable | 上下文预检 / Git Diff | 遵守边界 |
| Code Quality / AI Contamination Check | passed | not-applicable | 项目规范 / Git Diff | 没有新增依赖 |
```

Evidence 必须非空；可填写 review-package 章节名、文件路径或固定不适用标记（`N/A` / `NA` / `not applicable` / `不适用`）。`没有新增依赖`、`没有违反项目规范` 等判断说明写入 Note。

`Status` 只允许：

- `passed`
- `failed`
- `cannot-verify-from-package`
- `not-applicable`

`Severity` 只允许：

- `critical`
- `major`
- `minor`
- `not-applicable`

`cannot-verify-from-package` 必须由 controller 补证：补测试结果、代码证据、调用链、D/A 引用或重新生成 package；补证后仍无法判断时，切片写 `AI Review：blocked（原因）` 或转 `D* open`。`failed`、`critical`、未解决的 `cannot-verify-from-package` 都阻塞 `AI Review：passed` 和 `状态：done`。

## Whole Review 结论

`## Whole Review 结论` 是整任务收口审查的结构化输出。`Whole Review：passed` 或 `Whole Review：blocked` 时必须填写完整固定表；`pending`、`package-generated`、`not-required` 可先保留占位。控制器判断不需要整审时写 `Whole Review：not-required`。

固定五项 verdict：

```markdown
## Whole Review 结论

| Verdict | Status | Severity | Evidence |
| --- | --- | --- | --- |
| Global Constraints Compliance | passed | not-applicable | 全局约束 / 切片概览 |
| Cross-slice Interface Consistency | passed | not-applicable | 接口契约 / Task Reports |
| Non-goals / Boundary Regression | passed | not-applicable | 非目标 / Git Diff |
| Requirement Closure | passed | not-applicable | Claims 概览 / AI Review |
| Residual Risk / Release Readiness | passed | not-applicable | D/A 摘要 / 残余风险 |
```

`Whole Review：passed` 时不得出现 `failed`、`cannot-verify-from-package`、`blocked` 或 `critical`；Evidence 必须非空。`Whole Review：blocked` 时必须保留完整表，阻塞说明写在顶部状态摘要或正文说明中。

## Progress Ledger

`ledger.md` 只记录 durable checkpoint，不写对话流水、操作流水或临时想法。`init` 会创建：

```markdown
# Progress Ledger

## Current Checkpoint

- pending：尚未产生 durable checkpoint。

## Slice Checkpoints

暂无切片 checkpoint。
```

完成切片时，在 `## Slice Checkpoints` 下给对应切片写一条稳定 checkpoint，例如：

```markdown
### S1

- completed：S1 已完成实现、硬门禁、AI Review 和代码提交。
```

`close-check` 要求 `ledger.md` 存在，`## Current Checkpoint` 至少有一条非空、非占位 checkpoint，并要求每个 `状态：done` 的切片至少有一条非占位 checkpoint。占位包括 `pending`、`TBD`、`TODO`、`暂无`、`待补充`、`未填写`、`待执行前补充`。

## 关联项

每个切片必须有 `#### 关联项`：

- 无关联项时写 `暂无。`
- 有关联项时使用两列表，只列 `D*` 和 `A*`

```markdown
#### 关联项

| ID | 状态 |
| --- | --- |
| D27 | open |
| A1 | done |
```

`D*` 正文在 `decisions.md`，`A*` 正文在 `audits.md`。关联项只是摘要，状态真源是对应正文块。

## 候选与验证字段

`候选` 必须写在每个切片块中，只允许：

- `候选自动`
- `候选需确认`

候选标签只表达切片阶段的预判。正式 `自动 / 需确认` 结论必须在切片前分叉审查通过后按 [EXECUTION-RULES.md](EXECUTION-RULES.md) 的风险判定重新确认。

不维护 `verification.md`，也不使用 `V*`。

`验证` 只表达功能 / 测试验证；`硬门禁` 和 `AI Review` 单独表达拒收门禁。不要把 lint / type-check / test 的失败全部塞到 `AI Review`，也不要用 `验证：passed` 替代门禁通过。

- 标准验证通过：`- 验证：passed（标准流程）`
- 未执行：`- 验证：pending`
- 失败、阻塞、跳过或非标准替代命令：在本切片写一行摘要，并在切片内补 `#### 验证备注`
- 父项拆分：父项 `状态：split`，`验证：skipped（父项拆分，无代码变更）`，并在 `验证备注` 写明拆出的子切片

```markdown
- 验证：blocked（标准 test 脚本缺 `vitest.mjs`；替代 config 直跑相关测试 passed）

#### 验证备注

- `<项目规则中的测试命令>`：blocked，缺少目标环境配置
- `<focused test command>`：passed
```

## 状态枚举

- 顶部 `状态`：`draft` / `executing` / `paused` / `done`
- `阶段`：`slicing` / `executing` / `blocked` / `closing` / `done`
- 顶部 `计划一致性预检`：`pending` / `passed` / `blocked` 开头；`blocked` 必须引用 open D，例如 `blocked（D1）`
- 顶部 `Whole Review`：`not-required` / `pending` / `package-generated` / `passed` / `blocked`
- `拆分拷问` 和切片 `门禁`：`pending-grill` / `grilling` / `grilled` / `no-grill` / `not-applicable`
- 切片 `状态`：`not-started` / `blocked` / `in-progress` / `done` / `split` / `skipped`
- 切片 `风险`：`待判定` / `A` / `B` / `C`
- 切片 `执行`：`待判定` / `自动` / `需确认`
- 切片 `上下文预检`：`pending` / `ready` / `blocked` / `skipped` 开头，可追加中文说明
- 切片 `硬门禁`：`pending` / `passed` / `failed` / `blocked` / `skipped` 开头，可追加中文说明
- 切片 `AI Review`：`pending` / `passed` / `issues` / `blocked` / `skipped` 开头，可追加中文说明
- 切片 `用户验收`：`pending` / `passed` / `issues` / `skipped` 开头，可追加中文说明；`skipped` 必须写明用户明确跳过原因
- AI Review verdict `Status`：`passed` / `failed` / `cannot-verify-from-package` / `not-applicable`
- AI Review verdict `Severity`：`critical` / `major` / `minor` / `not-applicable`
- `上下文预检：ready`：必填预检字段不得是占位内容；`项目规范` / `禁止修改` 可显式写 `无`
- `AI Review：issues/blocked`：必须有非占位头部摘要 / 原因，或有带非占位 Note 的阻塞 verdict 说明
- `AI Review：passed`：必须有完整三 verdict，且不得出现 `failed` / `cannot-verify-from-package` / `critical`；第三 verdict 正式名称为 `Code Quality / AI Contamination Check`，旧 `AI Contamination Check` 仅作兼容
- `用户验收：pending/issues`：阻塞切片 `done`；用户不满意且不改变范围 / 口径时进入本片有限修复，改变范围 / 口径时转 D 分叉
- `Whole Review：passed`：必须有完整五 verdict，且不得出现 `failed` / `cannot-verify-from-package` / `blocked` / `critical`；不需要整审时不得写 `passed`
- 切片 `修复次数`：`当前次数/最大次数`，最大次数必须大于 0，当前次数不能超过最大次数
- 切片 `验证`：`pending` / `passed` / `failed` / `blocked` / `skipped` 开头，可追加中文说明

当前状态写入规则：

- 未切片草稿才允许 `阶段：slicing` + `当前切片：待定` + `## 切片` 为 `待拆分。`。
- 切片产出后，`当前切片` 必须指向一个可执行切片；不能指向 `done` / `skipped` / `split`。
- `状态：paused` 不能停在 `阶段：slicing`；暂停前必须记录到具体执行 / 阻塞 / 收口阶段。
- 收口完成时写 `状态：done`、`阶段：done`、`当前切片：无`。

门禁状态写入规则：

- `pending-grill`：门禁待问。
- `grilling`：用户选择 `拷问`，拷问进行中；已发“拷问收口候选”但尚未收到 `结束拷问` 时也保持该状态，用户回复 `继续拷问` 或直接提问不改变该状态。
- `grilled`：用户回复 `结束拷问`，且结论已写回。
- `no-grill`：用户回复 `不拷问`。
- `not-applicable`：该门禁确实不适用，例如低风险候选自动片跳过切片前拷问门禁。

切片状态写入规则：

- `split` 只用于已拆成子切片、父项不再直接执行的审计壳；它是终态，但不能作为续跑 `当前切片`。
- `split` 父项必须写 `Commit：已提交`，验证用 `skipped` 开头，并在 `验证备注` 写明子切片和无单独代码提交。

不要把用户口令或过程说明（如 `已拷问写回`）写进 `拆分拷问` 或切片 `门禁` 字段。

`Commit` 只表示本片**代码**的提交状态，不表示 `dev-plans` 自身是否已提交，也不写最终 commit hash：未提交写 `待提交`，本片代码提交边界已收口写 `已提交`。`dev-plans` 记录走自己的独立 commit（默认收口 / 用户中途要求），不由切片 `Commit` 字段表达。最终 commit hash 只放在会话回复或外部提交记录中，不写回 plan；无变更片不要创建空 commit，完成后也写 `Commit：已提交`，并在 `验证备注` / 完成报告说明无可提交变更。

## 维护规则

- `当前状态` 只做续跑指针；切片状态以切片块为准。
- `plan.md` 只记录当前状态、计划一致性预检状态、门禁状态、切片状态和下一步，不写对话流水、agent 动作流水或审计结论；需要留痕时更新对应状态字段或在会话完成报告说明。
- 切片相关的分叉和长审计只放在该切片 `关联项`，不要在顶部维护全局 D/A 索引。
- 一旦已产出切片，`decisions.md` 中仍为 `open` 的 D 必须挂到至少一个切片 `关联项`；任务级 open D 不应和已切片状态并存。
- open decision、长审计和正文模板分别按 [DECISIONS-FILE.md](DECISIONS-FILE.md)、[AUDITS-FILE.md](AUDITS-FILE.md) 维护。
- 目标和全局约束留在 `plan.md`；只保留仍约束后续执行和 review 的全局规则，不复制证据和问答。
- 不设独立 `待确认问题`、`验证记录` 或 `变更记录` 章节；这些信息分别由 D/A、切片验证字段、门禁记录和当前状态承载。
- 除固定 `## 当前状态`、`## 文件索引`、`## 目标`、`## 全局约束`、`## Whole Review 结论`、`## 切片` 和 `### S*：...` 切片块标题外，`plan.md` 不允许出现其他二级或三级标题；计划一致性预检不新增章节。
