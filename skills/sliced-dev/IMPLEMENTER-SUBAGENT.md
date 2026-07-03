# 切片开发 · Implementer Subagent

本文定义完整档进入 `IMPLEMENT_TASK` 后如何派发实现 subagent。轻量档没有 `task-briefs/<S-id>.md`，不得使用 implementer subagent。

## 控制器流程

控制器负责分叉、拷问、上下文预检、执行确认、生成 task brief、接收门禁、硬门禁、review-package、用户验收和提交。implementer subagent 只负责在自己的 forked workspace 实现当前切片；控制器接收结果后再集成和验证。task brief 是注意力收束视图，不是真源；若 brief 不足以判断实现、边界或验证，implementer 必须 blocked 回控制器，不得自行扩大上下文。

派发前必须满足：

- 当前切片已完成切片前分叉审查，且没有开放分叉。
- 当前切片 `上下文预检：ready`。
- `task-briefs/<S-id>.md` 已由 `task-brief` 命令生成。
- 当前片已有 `claims/<S-id>.json`，且 task brief 已渲染 Claims 概览。
- 需确认片已在当前连续流程内完成执行确认；若确认后未派发即中断，续跑时必须重新预告并重新确认。

派发时必须使用 `spawn_agent`，参数固定：

```json
{
  "agent_type": "worker",
  "fork_context": false,
  "message": "<使用下方任务包模板>"
}
```

不要设置 `model`、`reasoning_effort` 或 `service_tier`，除非用户明确要求。不得用普通新会话、自由 prompt 或当前控制器上下文模拟 subagent。

subagent 返回后，控制器先做接收门禁：

- 读取 subagent final summary。
- 读取 `task-reports/<S-id>.json`，确认 `conclusion: ready-for-review`；只有 legacy `.md` report 存在时才按旧格式兼容。
- 读取 `claimUpdates` 可解析记录；implementer 只能建议状态和证据，不能最终裁定 `verified` / `waived`。
- 检查实际改动文件落在 task brief 的 `允许修改` 范围内，且未命中 `禁止修改`。
- 确认 subagent 未报告 blocked、新分叉、风险升级、验证方式变化或越界需求。

接收门禁通过后，控制器再运行硬门禁；subagent 的验证结果只作为辅助证据，不能替代控制器硬门禁。接收门禁不通过时，不生成 review-package；控制器可补 brief、重新派发、回到分叉处理或重新预告确认。

## 任务包模板

```text
你是 sliced-dev implementer subagent，负责实现当前切片，不负责控制流程。

当前切片：<S-id>
Task brief：<dev-plans/.../task-briefs/<S-id>.md>

硬规则：
- fork_context=false，本任务包是你的唯一流程上下文。
- 你在自己的 forked workspace 修改文件；最终列出改动文件，交由控制器集成。
- 只允许读取 task brief 及 task brief 中列出的必读上下文。
- 禁止读取完整 plan.md、其他切片、未关联 D/A、与 task brief 无关的仓库区域。
- 禁止直接询问用户；任何需要用户确认的问题都 blocked 回控制器。
- 禁止修改 plan.md、decisions.md、audits.md、claims/S*.json 或切片状态。
- 禁止提交 commit。
- 不要 revert 其他人改动；如果遇到已有脏改动，按 task brief 的基线脏文件和允许范围处理。

实现前先复核：
- task brief 存在且切片号一致。
- task brief 内没有阻塞本片的 open D。
- 必读上下文足够支持实现。
- 已按 task brief 的 `项目规范` 判断本片规则；若缺失或不够判断则 blocked。
- 已理解 task brief 中的 Claims；每条 claim 都能映射到实现、验证、blocked 或风险说明。
- 预计改动不会越过 task brief 的允许修改范围，也不会命中禁止修改。
- 没有发现新分叉、风险升级或验证方式变化。

复核不通过时：
- 不实现。
- 填写 `task-reports/<S-id>.json`，`conclusion` 写 `blocked`，并在 `risks`、`reviewFocus` 或 `claimUpdates` 中说明阻塞原因。
- final summary 说明 blocked 原因、需要控制器补什么。

复核通过时：
- 只在 task brief 允许范围内做最小实现。
- 可以新增当前切片直接相关测试，但路径必须落在允许修改范围内。
- 可以运行 task brief 明确列出的 focused 验证命令。
- 可以修复自己本次实现直接造成的 lint/test 失败；需要越界或改变方案时立即 blocked。
- 不要把 claim 自行写成最终 `verified` / `waived`；只在 task report 的 `claimUpdates` 中提出 `proposed` / `implemented` / `blocked` / `failed` 等建议和证据。

输出要求：
- 必须填写 `task-reports/<S-id>.json`。
- `conclusion` 默认保持 `blocked`；只有满足进入 review 的条件时才改为 `ready-for-review`。
- `changedFiles` 必须逐项填写 `path`、`reason` 和 `claimIds`。
- `claimUpdates` 必须覆盖所有 P0/P1 claims；`conclusion: ready-for-review` 时 P0/P1 的 `proposedStatus` 必须是 `implemented`，且有 evidence 或 note。
- `proposedStatus` 只能是 `proposed` / `implemented` / `blocked` / `failed`，不能写 `verified` / `waived`。
- `validation` 必须记录已运行、失败、跳过或未运行的命令。
- final summary 只写：结论、改动文件、验证命令结果、claimUpdates 摘要、是否 blocked 及原因。
```
