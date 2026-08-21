# 切片开发 · 编排规则

本文只定义拆分与多任务编排。单任务实现闭环以 `deliver-task` 为唯一 owner。

## 1. 选择入口

先判断目标是“一个任务含多个实现步骤”，还是“多个可独立验收的任务”。

- 一个目标、一个验收结果、各步骤不能独立交付：使用 `deliver-task`。
- 多个部分可独立验收、独立发布，或一个失败不阻塞另一个：使用 `sliced-dev`。
- 判断不足且存在真实产品 / 契约分叉：先形成 D 并询问；不要靠创建更多切片逃避分叉。

`sliced-dev` 没有轻量单任务执行模式。已经建立 plan 后发现只剩一个边界明确任务，不迁回旧 implementer 流程，仍把该任务委托给 `deliver-task`。

## 2. 计划一致性与整体拷问

切片草案完成后检查：

- 每片是否有独立可观察结果；
- 依赖是否单向且无环；
- 全局约束是否被各片合同继承；
- 跨片输入 / 输出是否一致；
- 是否存在未记录的需求、契约、授权或验收分叉；
- 是否把纯技术层、文件层或内部步骤误拆成任务。

有分叉时写 `open D`，顶部 `计划一致性预检：blocked`。没有结构冲突时写 `passed`，进入整体拆分拷问。

| 门禁 | 必须展示 | 有效输入 |
| --- | --- | --- |
| 拆分拷问选择 | `> 拷问对象：整体拆分方案` | `拷问 / 不拷问` |
| 切片拷问选择 | `> 拷问对象：切片 <S-id>「<切片标题>」` | `拷问 / 不拷问` |
| 拷问收口 | 同一对象 + “拷问收口候选” | `结束拷问 / 继续拷问` |

无 `open D` 不等于已完成 `pending-grill`。用户说“继续”“直接开始”“没问题”也不等于上述固定口令。只有明确口令推进当前门禁。

## 3. 切片前判断

轮到一个切片时：

1. 读取该片合同、依赖、关联 D/A 和全局约束。
2. 处理本片 `pending-grill / grilling`。
3. 依据目标和已知风险写 `风险 / 执行`；这只是 caller 的授权与交互判断，不替下游选择路径。
4. 风险 `C`、执行 `需确认` 或不可逆外部操作先发执行预告并取得确认。确认覆盖目标、验收、公共约束、非目标、用户禁止范围和外部动作，不固化文件清单或测试命令。
5. 依赖均为 `done / skipped` 后才允许委托。

执行确认不能替代分叉确认。若确认前合同变化，重新展示变化后的合同；若仅当前指针或下一步变化，不重复确认。

## 4. 生成 task contract

运行：

```bash
node <sliced-dev-skill-dir>/scripts/dev-plan.mjs delegate-task <planDir> <S-id>
```

命令把 plan 投影为 `deliver-task.task.v1`，但不会创建 `execution.json` 或其它下游文件。成功后，controller 的下一步是调用 `deliver-task` 并提供 task directory，例如：

```text
使用 deliver-task 交付 dev-plans/2026-08-21-example/deliveries/s2-1/。
```

不要同时派发自定义 implementer；不要先读取业务代码替下游推断 allowlist、rules 或 claims。`deliver-task` 的 preflight 可能发现：

- 当前目标仍是一个任务：建立 `execution.json` 并继续；
- immutable contract 需要改变：`needs-upstream`；
- 实际存在多个独立任务：`needs-reslice`；
- 环境 / 工具不可恢复：`blocked`。

task revision 只追踪 immutable caller contract。执行边界变化由 `execution.json` 和 execution hash 表达，不回写 plan，不改 task revision。

## 5. 下游期间的 owner 隔离

`deliver-task` 活跃期间：

- 它可以写 task-owned directory 和当前任务授权的业务文件。
- `sliced-dev` 不并行写业务文件，不改 `execution.json / claims.json / task audits / delivery.json`。
- caller 可以读取状态，但不把中间步骤投影为 plan 字段。
- 下游需要用户判断时先产出绑定当前 task 的 non-delivered delivery，再返回 caller；不能越过 caller 直接扩展计划。

如果用户在下游执行期间直接改变整体需求，先让下游停在可审计结果，再由 `sliced-dev` 判断影响哪些 task contract。只更新受影响任务；不因计划级措辞变化批量刷新 revision。

## 6. 结果接收与回流

先运行 `delivery-status`。机器只验证 schema、task/execution/target binding、evidence ref 存在和下游明确终态，不判断理由正确性。

### delivered

1. 阅读 target 摘要、evidence refs 和 residual risks。
2. controller 判断它是否满足当前切片语义；不能用 validator passed 代替这一步。
3. 更新切片为 `done`，移动当前指针。
4. 运行 `slice-close-check`。
5. scoped stage plan 与 task durable state，运行 `plan-commit-check` 和 `git diff --cached --check`，创建 K。

`slice-close-check` 不重算单任务 target。`deliver-task` 已在返回前运行自己的 `close-check`；caller 更新 plan 后出现的 plan diff 不属于该 target。

### needs-upstream

阅读 `upstreamRequest.kind / summary / evidenceRefs`：

- `user-acceptance`：展示当前 target 的验收内容，取得用户 `passed / skipped / rejected`，把原始回复交回同一 `deliver-task` 记录 task-owned acceptance evidence。
- `contract-change / authorization-change / acceptance-change`：确认新口径，更新 plan 合同，再运行 `delegate-task` 形成新 revision。
- `target-change`：由 caller 决定是否授权新的 base / target；需要把同一语义合同移到当前 HEAD 时运行 `delegate-task <planDir> <S-id> --refresh-base`，以新 revision 表达 immutable base 变化。

若用户拒收但目标、验收、约束、非目标、禁止范围和调用策略都未变，不创建 revision。让同一 `deliver-task` 在同一 identity 内返修；新 target 使旧 acceptance 自动失效。新增 acceptance 记录本身不改变 task hash，也不使同一 target 的 General binding stale。

### needs-reslice

1. 阅读下游引用的 task-owned evidence。
2. 把原片写为 `split`，填写真实后代 `替代切片`。
3. 为新后代补目标、验收、依赖、交接和合同。
4. 重新运行计划一致性预检和必要的整体 / 切片拷问。
5. 各后代分别创建新的 task identity；不得复用父片 delivery 作为子片交付证明。

### blocked

把切片与计划写为 `blocked`，在 plan 根目录 A 中只记录跨切片影响或恢复条件；单任务失败正文留在 task-owned audits。环境恢复后让同一 task 继续，除非 immutable contract 已变化。

## 7. P / C / K / F 时序

```text
plan ready
  → P（plan-only）
  → delegate task 1
  → C1（deliver-task 业务 commit/range）
  → delivery 1
  → K1（plan + task durable state）
  → delegate task 2，以 K1 为新任务 base
  → C2
  → K2
  …
  → Kn
  → optional whole review
  → optional F
```

- P/K/F 必须是 scoped plan commit；C 必须由对应 `deliver-task` 根据 task `baseCommit` 创建。
- task directory 的持久文件随 K/F 提交，不进入 C。
- K 后的下一个 task 初次委托使用当前 HEAD 作为 base。
- 同一 task 的返修仍由 deliver-task 维护其 target；caller 不为每轮 repair 创建 plan 状态提交。
- `no-change` delivery 不创建空 C，但仍可创建 K 记录任务结果。
- `split / skipped` 没有业务 C；它们引起的 durable plan 变化并入下一合法 K 或最终 F。

## 8. 整任务审查

默认依靠每个 task 自己的 General Review。以下情况才启用整任务审查：

- 用户明确要求整体验收、跨切片审查或发布就绪度；
- 全局约束或跨切片交接无法由任何单任务 reviewer 独立覆盖；
- 多个 delivery 的 residual risks 组合后产生新的计划级风险。

生成的 `whole-task.md` 聚合 plan、D/A、每个 task/delivery 和固定 target diff。整任务 reviewer 只返回五项计划级 verdict。结论写回 `plan.md`，绑定 package hash；package 内容变化后旧结论失效。

有整任务审查时，先创建最后一个任务的 Kn，再生成 package、完成审查、运行完整 `close-check`，最后创建 F。未启用且 Kn 后无其它 durable 变化时，最终 Kn 可兼任 F。

## 9. 恢复

跨 context 恢复只读取持久真源：

1. `validate` plan；
2. `show current`；
3. 若当前 slice 已有 task，运行 `delivery-status`；没有 delivery 或结果仍在处理中时继续调用同一 `deliver-task`；
4. 若 slice 为 `pending-grill / grilling`，停在对应固定口令门禁；
5. 若 slice 已 `done` 但 K 未提交，重新运行 slice / plan commit checks；
6. 临时 package 丢失时重建，不从旧 agent 记忆补写结果。

不要根据“上一位 agent 已经做了很久”“时间紧”或用户一句普通“继续”跨过任何持久门禁。

## 10. 校验边界

脚本适合检查：

- Markdown / JSON exact shape 与枚举；
- 依赖存在、无环、终态映射；
- task immutable projection 与 caller identity；
- delivery 结构、binding 和 ref 存在；
- staged plan commit 路径；
- whole review 明确 verdict 与 package hash。

脚本不检查：拆分是否合理、目标与验收是否充分、代码是否正确、证据强度、reviewer 判断、用户是否真正理解风险或回流理由是否成立。这些由 controller / reviewer 作语义判断并留下对应 owner 的证据。
