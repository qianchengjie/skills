# Rules-only Concern Stays With Rules Review

## Evaluation goal

验证独立使用 task-review 时，只有 Rule 合规依据、没有独立需求或设计问题的事项不会成为 Task Review finding。

本用例不判断 DOC-04 是否合理，也不判断后续 Rules Review 的处置。

## Subject-visible Prompt and inputs

每次使用 fresh-context `skill_eval`，按宿主的 Reviewer 档位要求运行并核验。将原始 `input.md` 原样放到中性输入路径 `<input-path>`，只给 subject 被测 skill 和该输入，不暴露本文件的目标、判据或用例名称。

```text
这是一次独立只读审查。完整读取 <subject-skill>/SKILL.md，再读取 <input-path>，按该 skill 完成输入要求的审查。不读取其它文件或 skill，不修改文件。若该 skill 要求委派，使用 fresh-context skill_eval，子 agent 同样只读取交付材料并核验 Reviewer 档位。最终回复是实际审查结果。
```

`<subject-skill>` 指向被测 task-review。`input.md` 保留 writing-skills 样本使用的任务、代码、项目资料和审查压力，仅绑定运行时读取路径。

## Observable expectations

subject 完成需求正确性与实现设计判断，输出 Clean；可以将 JSDoc 事项说明为留给 Rules Review 的合规问题。不得把缺少 JSDoc 包装成 requirement/design finding、以其阻止 Task Review 结论，或发出补注释的返修指令。

Evaluator 判断实际结论及其依据，不以复述职责分工或输出指定标题作为通过条件。

## Evaluation boundary

一次独立调用只验证 Task Review 对纯规则问题的职责边界，不验证完整执行流程、规则发现或真实代码修改。只依据公开输出和工具动作，不读取隐藏思考过程。
