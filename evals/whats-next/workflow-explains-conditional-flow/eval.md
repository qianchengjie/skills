# Workflow Explains Conditional Flow

## Evaluation goal

验证用户了解组合工作流时，`whats-next` 根据小修与复杂功能的不同需要，解释入口和切换条件。
本用例不要求列全 skill catalog，也不评判项目的实际交付计划。

## Subject-visible Prompt and inputs

每次使用 fresh-context `skill_eval`，只提供下面的 Prompt；`<subject-skill>` 指向待测版本的
`skills/whats-next/`。不向 subject 提供本文件的目标、判据、用例名称或历史结果。

```text
请作为独立 subject 完成下面的实际导航请求，不评审或改进 skill。读取 <subject-skill>/SKILL.md，并使用它回应用户。本次评测只提供这个文件和题面中的会话事实；不要读取其它 skill、项目文档、测试或历史记录，也不要搜索外部资料。场景项目为独立案例，不对应当前工作区；只读，不修改文件。请直接给出面向用户的回复。

用户：我准备把 Matt、Superpowers 和这个仓库的 skills 一起用。这套开发流程怎么走？我们既有当天能完成的小修，也有要做几周的功能，想知道各自从哪里开始、什么时候换下一个入口。
```

## Observable expectations

回复给出可按需要进入的常见 flow：目标、范围与验收已明确的小任务可以直接用 `execute-task`；复杂
功能需要澄清时，用 `grill-with-docs` 或适合跨会话探索的 `wayfinder`，需要整理 Spec 时用 `to-spec`，
需要生成分批交付的任务时用 `to-tickets`，已有明确任务后进入 `execute-task`。

切换依据是当前工作的需要与已有上下文，不能仅因工期长短规定必经步骤。提及 `task-steward` 时，
将其用于已有任务的拆分评审和维护；说明 Superpowers 的 `test-driven-development` 是实现阶段的方法，
与 `execute-task` 组织任务执行相衔接。

可以用段落、表格或流程箭头表达，流程箭头需有条件说明。只有名称或职责清单而没有入口与切换条件、
把所有开发事项排入同一条必经流水线，或将整体导航转交其它导航 skill 而不作解释，均不通过。

## Evaluation boundary

Evaluator 依据公开回复及工具动作判断用户能否据此选择入口和理解衔接，不要求固定结构、列全每个
skill 或复述其内部流程。单独一句“按需使用”不能抵消正文中的必经要求，应结合实际表达判断。
本例不验证 description 的自动触发、外部资料检索、下游执行或复杂功能的完整交付方案。只读约束是
评测环境边界，不用它证明被测 skill 能独立阻止写入。一次独立调用验证这一个导航主张，不读取隐藏思考过程。
