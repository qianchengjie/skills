# Repartition Uses Plan Source

## Evaluation goal

验证重新划分时，`ticket-steward` 交给 `to-tickets` 的来源是已确认的新票方案，原票追溯与真正的执行前置引用各有归属。

本用例使用受控的票据输入，只判断新票生成的交接边界；题面中的 #19 分工不代表真实项目当前票据状态。

## Subject-visible Prompt and inputs

Subject 使用待测版本的 `skills/ticket-steward/SKILL.md`，每次调用使用 fresh context。独立输入为 [inputs/repartition-handoff.md](inputs/repartition-handoff.md)，保持原文传入。

下游输入沿用实际使用的外部 `to-tickets/SKILL.md`，从安装位置 `~/.agents/skills/to-tickets/SKILL.md` 读取；本用例的内容身份为 SHA-256 `5c9fba69845c2519b9b35b9af42ae5142c21f8ca15ac2123dc2722002c8058ae`。运行方提供同内容文件；无法取得该输入时记为 `cannot_verify`，不以其它版本替代。

Harness 只绑定下述三个路径并注入 Prompt，不向 subject 提供 Evaluation goal、Observable expectations 或 Evaluation boundary。

```text
这是一次隔离的 skill_eval 调用。完整读取被测 skill <subject-skill>，读取下游 <to-tickets-skill>，然后按 <input-file> 执行当前边界的动作。只根据给定 skill 与输入行事，不读取其它 skill、git、tests、evals 或会话，不评价或改进协议。全程只读，最终回复即场景要求的实际交接内容，不附带评测报告。不调用其他 agent。你不是开发流程中的 Implementer 或 Reviewer。
```

## Observable expectations

一次调用产出可以直接交给 `to-tickets` 的新票生成输入：

- source 的内容和身份是已确认的新票方案；#19 的 ID 与替代追溯由 steward 维护，没有被交作 issue source 或 Parent。
- #23 仍作为 #27、#30 的真实执行前置，#28、#29 仍等待 #27 的实际交付。#18 的既有组合验收职责不被转换为新票父项。
- 新票的范围、验收与依赖保真；生成阶段返回实际新票引用，由 steward 接续维护票据集合。

Evaluator 根据实际交接内容判断来源身份和引用用途。只写“省略 Parent”不足以通过，仍把 #19 作为 issue source 的交接不符合上述边界；缺失真实依赖、把原票维护交给新票生成方或因未生成新票而宣称拆分完成，同样不通过。

## Evaluation boundary

本用例不判断真实 #19 的剩余工作，不选择旧票删除策略，不执行 tracker 写入，也不证明任何平台能够增删 native relation。是否保留父项的事实由本用例完整题面给出，观察对象是据此形成的交接输入。

Evaluator 只使用公开回复与公开工具动作，不要求、推断或保存隐藏思考过程。本文件定义一次独立调用，不定义 repetitions、RED/GREEN 编排、聚合或运行结果格式。
