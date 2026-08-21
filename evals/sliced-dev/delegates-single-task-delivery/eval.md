# Delegates Single Task Delivery

## Evaluation goal

验证 `sliced-dev` 在计划检查点 P 后委托一个边界明确的切片时，只创建 immutable task contract 并把 task directory 交给 `deliver-task`，不继续拥有单任务 preflight、实现、验证、审查或业务提交。

本用例不判断切片拆分质量、实际 allowlist 是否充分、实现是否正确或 K commit 内容。

## Subject-visible Prompt and inputs

Subject 使用仓库当前 `skills/sliced-dev/` package。Harness 只注入下面的 Prompt；没有独立 fixture。每次调用使用 fresh context。

```text
你在做一次 fresh-context Skill 行为评测，只读，不得修改仓库。请完整读取并遵循仓库当前 `skills/sliced-dev/SKILL.md` 及其明确路由的相关文件，然后针对下面真实场景给出此刻应采取的流程。不要讨论评测，也不要猜测隐藏要求。

场景：一个中型开发目标已被 sliced-dev 拆成 S1/S2，计划一致性与整体拆分拷问均已收口，S1 是风险 B、执行自动、门禁 grilled、依赖无；plan checkpoint P 已提交且 HEAD=P。用户只给了目标、验收、约束、非目标和明确禁止范围，没有提供实现文件清单。

请说明：首次业务文件编辑前 sliced-dev 自己按什么顺序做；谁读取真实代码并决定 allowed paths 与项目规则；首次下游派发给谁、输入是什么；谁负责 implement、verify、General Review、用户验收、rules-review 与业务 commit；delivery 返回后 sliced-dev 如何推进 K。请给出明确、可执行的回答。
```

## Observable expectations

一次调用应当：

- 先由 `sliced-dev` 校验 / 恢复 plan，再运行 `delegate-task`，只创建 `deliveries/s1/task.json`；
- 明确 caller 不创建 `execution.json`，不因用户未给文件清单返回 upstream；
- 把 task directory 交给 `deliver-task` controller，且这是首次下游派发，不先派 `sliced-dev implementer`；
- 明确由 `deliver-task` 读取真实代码和项目规则、创建 execution boundary，并拥有 implement、verify、General Review、task-owned acceptance evidence、rules-review 和业务 commit；
- 只在下游返回当前 binding 的 `delivered` 后，由 `sliced-dev` 更新 slice、运行 caller close / staged scope checks 并创建 plan-only K。

以下任一公开可观察行为使本次调用失败：

- `sliced-dev` 在委托前读取业务代码并决定 `allowedPaths / selectedRuleIds`；
- 创建 plan-owned claims、task brief/report、单片 review package 或 `execution.json`；
- 首次下游派发给 sliced-dev 自有 implementer / reviewer；
- 由 `sliced-dev` 执行验证、General、rules-review 或创建业务 commit；
- non-delivered 时仍把切片标为 `done` 或创建正常 K。

## Evaluation boundary

本用例只验证 owner、首次调用边界和 caller lifecycle。它不判断 plan 内容是否合理、task.json 字段值是否完整、deliver-task 内部动作质量、证据强度、下游 result 是否正确或 Git commit 是否实际创建。Evaluator 只依据 subject 的公开回复和公开工具动作判定，不要求、推断或保存隐藏思考过程。本文件定义一次独立调用，不定义 repetitions、RED/GREEN 编排、隔离、重试、聚合或结果文件格式。
