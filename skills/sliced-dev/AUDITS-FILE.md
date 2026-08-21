# 切片开发 · audits.md 文件

本文只描述 plan 根目录的 `audits.md`。每个 delivery task 另有自己的 `audits.md`，两者 owner 不同。

## 职责

plan 根目录 A* 只保存：

- 计划一致性或拆分依据的长矩阵；
- 跨切片调用链、交接和约束证据；
- 某个下游结果对其它切片造成的计划级影响；
- 整任务审查的计划级补充证据；
- plan blocked 的恢复条件。

以下内容属于 `deliver-task`，不得复制到 plan 根目录 A*：

- 单任务上下文预检、允许路径和 selected rules；
- claims 与验证命令结果；
- General full / repair、finding 和 target binding；
- upstream acceptance 记录；
- rules-review run / repair verification；
- 单任务 residual risk 正文。

plan 通过 `delivery.json.evidenceRefs` 定位这些证据。只有它们产生跨切片影响时，才在 plan A* 记录影响结论并引用 task-owned ref，不复制正文。

## ID 与结构

A* 使用全局顺序编号：

```markdown
### A1：跨切片调用链核对

- 状态：done
- 关联：S1 / S2

<计划级证据正文>
```

- 标题必须为 `### A<正整数>：<标题>`。
- `状态` 只允许 `pending / active / done`。
- `关联` 必须显式存在，可关联多个 slice 或写 `整体计划`。
- 同一文件内 ID 不重复。
- slice 的 `关联项` 引用 A 时，摘要状态必须与正文一致。

## 下游回流引用

当 non-delivered result 影响计划时，可写：

```markdown
### A3：S2 需要重新拆片

- 状态：done
- 关联：S2 / S2.1 / S2.2
- 下游结果：needs-reslice
- taskEvidence：deliveries/s2/audits.md#A4

该结果使原 S2 无法作为一个独立交付单元；新增两个后代切片。
```

脚本只检查 A 的基本结构和 slice 关联表状态，不解析 `taskEvidence`，也不判断重新拆片是否合理。controller 必须先阅读真实 task evidence。

## 整任务审查

整任务 reviewer 的固定五项 verdict 写回 `plan.md` 的 `## 整任务审查结论`，不再在 A* 建第二份 verdict 真源。A* 只在需要保留跨切片长证据或阻塞恢复条件时使用，并从 plan 结论的 Evidence 列引用。

## 维护规则

- 普通过程日志、命令时序、用户寒暄和 agent 动作不建 A。
- 能用一行稳定约束表达的结论放 `plan.md`；真正需要用户拍板的分叉放 `decisions.md`。
- A* 一旦被引用不重写历史含义；新事实创建新 A。
- 机器只检查 ID、字段、状态和直接引用闭合，不判断证据充分性、内容真实性或语义结论。
