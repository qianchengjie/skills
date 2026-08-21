# 切片开发 · plan.md 文件

本文定义 `sliced-dev` 的计划真源。单任务合同和交付状态见 `deliver-task` 的 `TASK-CONTRACT.md`，不在 plan 中复制。

## 目录

```text
dev-plans/
  .gitignore                         # */review-packages/**
  YYYY-MM-DD-<slug>/
    plan.md                          # 多任务状态、切片、依赖与当前指针
    decisions.md                     # 需要用户拍板的稳定分叉
    audits.md                        # 计划级 / 跨切片长证据
    deliveries/
      <taskId>/
        task.json                    # sliced-dev 写；immutable caller contract
        execution.json               # deliver-task 写
        claims.json                  # deliver-task 写
        audits.md                    # deliver-task 写；单任务证据与验收
        delivery.json                # deliver-task 写；薄结果
        .gitignore                   # deliver-task 写；忽略 /artifacts/
        artifacts/                   # 可重建，不提交
    review-packages/
      whole-task.md                  # 可重建，不提交
```

`<slug>` 和 task directory 使用小写字母、数字、连字符。`S1` 映射为 `s1`，`S2.1` 映射为 `s2-1`。

## 计划模板

```markdown
# <任务标题>

> 档位：完整
> 状态：draft
> 上游依据：无 / OpenSpec:<change-name> / PRD:<path> / issue:<id> / 设计文档:<path>
> 计划一致性预检：pending
> 拆分拷问：pending-grill

## 当前状态

- 阶段：slicing
- 当前切片：待定
- 下一步：完成任务级分叉门禁并产出切片

## 文件索引

| 文件 | 职责 |
| --- | --- |
| [decisions.md](./decisions.md) | 分叉正文 |
| [audits.md](./audits.md) | 计划级长审计与跨切片证据 |
| [deliveries/](./deliveries/) | deliver-task 的任务合同与交付结果 |

## 目标

<一句话整体目标>

## 全局约束

- 暂无。

## 切片

待拆分。
```

顶部字段：

- `状态`：`draft / executing / paused / done`。
- `计划一致性预检`：`pending / passed / blocked`。
- `拆分拷问`：`pending-grill / grilling / grilled / no-grill`。
- `阶段`：`slicing / executing / blocked / closing / done`。
- `当前切片`：`待定 / 无 / 当前存在的 S-id`。

进入 `executing / done` 前，计划一致性预检必须为 `passed`，拆分拷问必须为 `grilled / no-grill`，且至少存在一个切片。`状态：done` 要求 `阶段：done`、`当前切片：无`，且所有切片都是 `done / split / skipped`。

## 切片模板

```markdown
### S1：<切片标题>

- 状态：not-started
- 门禁：pending-grill
- 候选：候选需确认
- 风险：待判定
- 执行：待判定
- 依赖：无

#### 关联项

暂无。

#### 委托合同

- 验收策略：not-required
- 约束：
  - 无
- 非目标：
  - 无
- 禁止修改：
  - 无

#### 切片交接

- 输入:
  - 无
- 输出:
  - <留给后续切片的稳定结果>

#### 任务内容

<一个明确的单任务目标>

#### 验收

- <可观察验收条件>
```

只允许以上六个常规头部字段、`split / skipped` 各自的条件字段和五个四级小节。`上下文预检 / 硬门禁 / AI Review / 用户验收 / 修复次数 / Commit / baseCommit / headCommit / 验证` 以及旧 `Claims / 门禁记录 / AI Review 结论` 都是已迁出的单任务执行状态，plan exact schema 会拒绝它们。

### ID 与状态

`S*` 使用数字路径：`S1`、`S2.1`、`S2.1.4`。

- `状态`：`not-started / blocked / in-progress / done / split / skipped`。
- `门禁`：`pending-grill / grilling / grilled / no-grill / not-applicable`。
- `候选`：`候选自动 / 候选需确认`；只是切片阶段预测，不替代正式执行模式。
- `风险`：`待判定 / A / B / C`；`C` 不允许 `执行：自动`。
- `执行`：`待判定 / 自动 / 需确认`。
- `依赖`：`无` 或 `/` 分隔的已有 S-id。形成环时 validator 拒绝。

`in-progress` 以及 `done / split / skipped` 终态必须有闭合门禁。`done` 的风险和执行不得为 `待判定`。只有依赖片均为 `done / skipped` 时才能委托当前片；`split` 片不算依赖完成，后续任务应依赖实际后代片。

### 委托合同

本节是生成 `task.json` 的 plan 投影：

| task.json 字段 | 来源 |
| --- | --- |
| `taskId` | S-id 小写并把 `.` 替换为 `-` |
| `caller` | 固定 delegated / sliced-dev / `<plan>/plan.md#<S-id>` |
| `objective` | `#### 任务内容` |
| `acceptanceCriteria` | `#### 验收` 的列表 |
| `constraints` | 顶层 `全局约束` + 本片 `约束` |
| `nonGoals` | 本片 `非目标` |
| `forbiddenPaths` | 本片 `禁止修改` |
| `baseCommit` | 初次委托或合同变化时的当前 HEAD |
| `commitPolicy` | 固定 `required` |
| `acceptancePolicy` | 本片 `验收策略` |

`验收策略` 只允许 `required / not-required`。风险 `C`、执行 `需确认` 或用户明确要求逐片验收时使用 `required`；前两种情况不得写 `not-required`。

caller 只写用户 / 上游禁止范围，不写执行 allowlist。deliver-task 读取真实代码和项目 rules 后自行生成 `execution.json`。禁止范围的语义是硬边界，不能通过下游扩大 `allowedPaths` 绕过。

`delegate-task` 比较除 `revision / baseCommit` 外的 immutable 投影：

- 投影未变：保留原 `task.json`、revision、base 和 task hash。
- 投影变化：revision 加一，base 更新为当前 HEAD，完整新结构形成新 task hash。
- 同一语义合同只有在 caller 明确运行 `delegate-task ... --refresh-base` 时才更新 base，并创建新 revision；普通重跑不会因为 HEAD 前进而改变 identity。
- 当前指针、下一步、状态、风险标签或其它编排文本变化不会单独改 task identity。

脚本只检查投影与 identity 是否一致，不判断目标、验收或约束内容是否合理。

### 切片交接

`输入 / 输出` 都必须显式存在，可写 `无`。它只记录跨切片消费的稳定语义，不写改动文件、实现步骤、命令、General 结果或 review package。

### 关联项

本节只引用 plan 根目录的 `D* / A*`，并与正文状态一致：

```markdown
| ID | 状态 |
| --- | --- |
| D1 | decided |
| A1 | done |
```

单任务 `audits.md#A*` 不加入这里；它通过 `delivery.json.evidenceRefs` 定位。

## result 与 slice 状态

| delivery result | 合法 plan 状态 | 说明 |
| --- | --- | --- |
| `delivered` | `done` | 当前 task binding 已由 deliver-task validator 接受 |
| `needs-upstream` | `blocked / in-progress` | caller 取得判断后继续同一 task 或更新合同 |
| `needs-reslice` | `split` | 必须填写真实后代 `替代切片` |
| `blocked` | `blocked` | 保留 evidence refs 与恢复条件 |

`split` 额外写：

```markdown
- 替代切片：S1.1 / S1.2
```

后代必须真实存在并以父 ID 开头。validator 检查 ID 和 `needs-reslice` 绑定，不判断后代是否完整覆盖原任务。

`skipped` 不需要 task/delivery，但额外写一个已决定分叉：

```markdown
- 跳过依据：D3
```

该 D 必须为 `decided` 并出现在本片 `关联项`。跳过理由是否充分由 controller / reviewer 判断。

## 整任务审查

默认不写。启用后增加：

```markdown
> 整任务审查：package-generated

## 整任务审查结论

- reviewPackageHash：sha256:<whole-task.md hash>

| Verdict | Status | Severity | Evidence | Note |
| --- | --- | --- | --- | --- |
| 全局约束符合性 | passed | not-applicable | review package | ... |
| 跨切片交接一致性 | passed | not-applicable | review package | ... |
| 非目标 / 边界回归 | passed | not-applicable | review package | ... |
| 需求闭合性 | passed | not-applicable | review package | ... |
| 残余风险 / 发布就绪度 | passed | not-applicable | review package | ... |
```

顶部状态只允许 `package-generated / passed / blocked`。`passed` 时五项必须明确为 `passed`；脚本检查字段、hash 和终态，不判断证据强度或 reviewer 结论正确性。

## 持久与临时边界

P/K/F 允许提交：

- 当前 plan 的 `plan.md / decisions.md / audits.md`；
- `deliveries/<taskId>/` 下 `task.json / execution.json / claims.json / audits.md / delivery.json / .gitignore`；
- 确有变化的 `dev-plans/.gitignore`。

`deliveries/*/artifacts/**` 和 `review-packages/**` 是可重建工件，禁止提交。业务文件只进入下游 C，不进入 plan commit。
