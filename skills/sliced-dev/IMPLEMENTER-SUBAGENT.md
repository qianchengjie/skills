# 切片开发 · Implementer Subagent

本文定义完整档进入 `IMPLEMENT_TASK` 后如何派发实现 subagent。轻量档没有 `task-briefs/<S-id>.md`，不得使用 implementer subagent。

## 控制器流程

控制器负责分叉、拷问、上下文预检、执行确认、生成 task brief、接收门禁、硬门禁、review-package、用户验收和提交。implementer subagent 只负责在共享工作区实现当前切片；运行时不提供独立 workspace，改动会立即对控制器和其他 agent 可见。控制器在 implementer 运行期间不得修改业务文件；subagent 返回后，控制器直接检查当前 diff 和 task report，再运行接收门禁和验证，不做“集成”。task brief 是注意力收束视图，不是真源；局部事实缺口先按下文做 focused 只读查证，仍不足以判断实现、边界或验证，或查证后需要扩大任务范围时，implementer 才 blocked 回控制器。

同一工作区同一时间只允许一个 implementer 写业务文件。若已有其他写入型 agent 正在运行或修改范围可能重叠，控制器必须等待或停止派发。task brief 的 `允许修改` / `禁止修改` 是写入边界，`必读上下文` 是最低读取集合，不是读取 allowlist；这些仍是行为边界，不是文件权限沙盒。

派发前必须满足：

- 当前切片已完成切片前分叉审查，且没有开放分叉。
- 当前切片 `上下文预检：ready`。
- `task-briefs/<S-id>.md` 已由 `task-brief` 命令生成。
- `task-reports/<S-id>.json` 已由 `task-report-template` 命令重置为本轮默认 `blocked` 报告。
- 当前片已有 `claims/<S-id>.json`，且 task brief 已渲染 Claims 概览。
- 需确认片已在当前连续流程内完成执行确认；若确认后未派发即中断，续跑时必须重新预告并重新确认。

每轮派发顺序固定为：

1. 把本轮实现依据写回真源。首轮使用当前切片、Claims 和门禁记录；返修把失败硬门禁写入 `#### 门禁记录`，或把当前 General Review A*（含完整 `openFindings`）/ 项目规则审查 A*（含 `rulesReviewReport`）写回 `audits.md` 并关联当前切片。需要调整执行边界时，先按授权边界规则完成预检和写回。
2. 运行 `task-brief`，重新生成 `task-briefs/<S-id>.md`。
3. 运行 `task-report-template`，覆盖 `task-reports/<S-id>.json` 为默认 `blocked`、空 `changedFiles`、空 `validation` 的本轮报告。
4. 运行 `workspace-tree --seed <seedCommit>` 临时记录 `workspaceBeforeTree`。它只用于本轮 delta 隔离，不进入 rules-review dispatch，也不建立 anchor。
5. 派发 subagent。旧的 `ready-for-review` 报告不得沿用；implementer 未更新的默认 `blocked` 报告不得通过接收门禁。

### 首轮派发

首轮派发使用 `spawn_agent`，参数固定：

```json
{
  "task_name": "implement_s1_a1",
  "fork_turns": "none",
  "message": "<使用下方任务包模板>"
}
```

`task_name` 使用小写字母、数字和下划线，并包含切片号与本轮尝试号；例如 `S1` 第一次实现使用 `implement_s1_a1`。不要添加当前 `spawn_agent` schema 未定义的字段。不得用普通新会话、自由 prompt 或当前控制器上下文模拟 subagent。

### 返修派发

同一切片返修优先对原 implementer 调用 `followup_task`：

```json
{
  "target": "implement_s1_a1",
  "message": "<使用下方任务包模板；要求重新读取最新 task brief，并以其内容覆盖旧上下文>"
}
```

只有原 implementer 不可用或运行时拒绝 follow-up、接收门禁已确认原 implementer 写入越界文件或其输出与实际 diff 冲突，或用户授权边界、任务目标、Claims 契约发生实质变化时，才能 fresh fallback：使用 `spawn_agent(fork_turns: "none")` 新建 implementer。执行 allowlist 在既有授权边界内扩展，不单独触发新建 implementer。

follow-up 和 fresh fallback 必须消费同一份最新 task brief；fresh fallback 仍使用首轮任务包和固定参数。subagent 记忆不是真源，最新 task brief 覆盖旧上下文和此前读取内容。修复次数、单写者、越界归属确认和需确认片重新确认边界保持不变。

subagent 返回后，控制器先做接收门禁：

- 读取 subagent final summary。
- 读取本轮重置后由 implementer 更新的 `task-reports/<S-id>.json`，确认 `conclusion: ready-for-review` 且最小 handoff 字段已填写。
- 检查实际改动文件落在 task brief 的 `允许修改` 范围内，且未命中 `禁止修改`。
- 确认 subagent 未报告 blocked、新分叉、风险升级、验证方式变化或越界需求。
- 再次运行 `workspace-tree --seed <seedCommit>` 得到 `workspaceAfterTree`，并确认 `workspaceBeforeTree → workspaceAfterTree` 的 delta 文件集合与 task report、`允许修改`、`禁止修改` 精确一致。

接收门禁通过后运行 `seal-target`。首轮把 delta patch 应用到 `seedCommit^{tree}`；修复轮应用到上一 `targetTree`。脚本随后把 `previousTargetTree → workspaceBeforeTree` 的残余基线 patch 应用到新 target，并要求结果精确等于 `workspaceAfterTree`。同路径非重叠 hunk 可以隔离；patch 不唯一、hunk 重叠、必须带入基线内容或组合 identity 不一致时立即阻塞，禁止降级为整文件覆盖。hunk 的业务归属由 controller 判断，脚本只验证 patch、路径和 tree identity。

接收门禁通过后，控制器再运行硬门禁；subagent 的验证结果只作为辅助证据，不能替代控制器硬门禁。接收门禁不通过时，不生成 review-package；写入前 `blocked` 报告的清单不足由控制器按拟扩范围重跑受影响的上下文预检，确认无需新的执行确认后才能补 brief 并重新派发。实际 diff 已越过旧 brief 时先判接收门禁失败并由控制器确认归属，只有确认由本轮 subagent 写入越界文件时才记录接收违约，不得回填清单使本轮通过；派发前脏文件漏记时不得事后补入 `基线脏文件`。

## 任务包模板

```text
你是 sliced-dev implementer subagent，负责实现当前切片，不负责控制流程。

当前切片：<S-id>
Task brief：<dev-plans/.../task-briefs/<S-id>.md>

硬规则：
- fork_turns="none"，本任务包是你的唯一流程上下文。
- 每次被派发都重新读取路径指向的最新 task brief；最新 task brief 覆盖旧上下文和此前读取内容，不依赖上轮记忆继续实现。
- 你在与控制器共享的工作区修改文件，改动会立即可见；最终列出改动文件，交由控制器检查。
- 不要为本流程创建 Git worktree；若任务必须依赖 workspace 隔离，blocked 回控制器。
- task brief 和其中的必读上下文是默认注意力入口。只为核对当前 Claims、追踪直接调用链或定位 focused 验证失败时，才可做最小的 focused Read / `rg`。
- focused 只读查证不得扩大任务目标或写入范围；禁止读取完整 plan.md、其他切片、未关联 D/A、与当前切片无关的仓库区域。
- 禁止直接询问用户；任何需要用户确认的问题都 blocked 回控制器。
- 禁止修改 plan.md、decisions.md、audits.md、claims/S*.json 或切片状态。
- 禁止提交 commit。
- 不要 revert 其他人改动；如果遇到已有脏改动，按 task brief 的基线脏文件和允许范围处理。

实现前先复核：
- task brief 存在且切片号一致。
- task brief 内没有阻塞本片的 open D。
- 已读取必读上下文；若仍有局部事实缺口，只需按硬规则做 focused 只读查证即可解决。
- 已按 task brief 的 `项目规则审查` 中 selectedRuleIds 和 `规则获取` 命令理解本片规则；若命令失败、规则冲突或无法满足则 blocked。不要运行 `rules-review`，也不要判断最终规则审查是否 passed。
- `关联 Audits` 含 `rulesReviewReport` 时，已读取该报告；只处理其中属于当前切片、当前规则 run 和允许修改范围的 finding，无法定位时 blocked。
- 已理解 task brief 中的 Claims；每条 claim 都能映射到实现、验证、blocked 或风险说明。
- 预计改动不会越过 task brief 的允许修改范围，也不会命中禁止修改。
- 没有发现新分叉、风险升级或验证方式变化。

复核不通过时：
- 不实现。
- 填写 `task-reports/<S-id>.json`，`conclusion` 写 `blocked`，并在 `blockedReason` 中说明阻塞原因。
- final summary 说明 blocked 原因、需要控制器补什么。

复核通过时：
- 只在 task brief 允许范围内做最小实现。
- 可以新增当前切片直接相关测试，但路径必须落在允许修改范围内。
- 可以运行 task brief 明确列出的 focused 验证命令。
- 可以修复自己本次实现直接造成的 lint/test 失败；需要越界或改变方案时，必须在修改越界文件前立即 blocked。
- 不要修改 `claims/S*.json`，也不要在 task report 中提出 claim 状态建议；claim 状态和证据由控制器写回。

输出要求：
- 必须填写 `task-reports/<S-id>.json`。
- `conclusion` 默认保持 `blocked`；只有满足进入 review 的条件时才改为 `ready-for-review`。
- `changedFiles` 必须逐项填写 `path` 和 `reason`。
- `validation` 必须记录已运行、失败、跳过或未运行的命令 / 检查，包含 `status` 和非占位 `summary`。
- `blockedReason` 在 `blocked` 时必须填写；`ready-for-review` 时必须为空。
- final summary 只写：结论、改动文件、验证命令结果、是否 blocked 及原因。
```
