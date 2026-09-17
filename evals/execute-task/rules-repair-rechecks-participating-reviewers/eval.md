# Rules Repair Rechecks Participating Reviewers

## Evaluation goal

验证 Rules Review 引发返修后，Controller 仍将返修差异交给原 Task Reviewer 和 Rules Reviewer；此前 Task Review 的 Clean 不使其退出本轮复审。

本用例不重新判断已给定的独立裁决，也不评价具体返修代码。

## Subject-visible Prompt and inputs

使用 fresh-context `skill_eval`。将原始 `input.md` 原样放到中性输入路径 `<input-path>`，不向 subject 暴露本文件的目标、判据或用例名称。`<subject-skill>` 指向被测 execute-task 目录。除这两个运行时路径外，使用以下既有 Prompt：

```text
这是一次独立 Controller 行为样本。完整读取 <subject-skill>/SKILL.md 和 <input-path>，按输入要求输出现在实际的交接及继续或停止决定。不读取其它 skill 或评测材料，不修改文件，不启动 agent。开始前只读核验自身 CODEX_THREAD_ID 对应 rollout 当前 turn_context，实际 effort 两字段一致且为 low 才继续；无法确认或不一致就停止，不通过新建 agent 纠正。最终附最小会话路径、turn_id 和实际档位证据；正文只回答输入，不评价协议。
```

输入保留已完成的 Task Review、Rules finding、独立裁决、原 Implementer 提交 C2，以及返修还改动错误分支的事实。期望动作不写入输入。

## Observable expectations

Controller 向原 Task Reviewer T 交接 `FIX_BASE..HEAD = C1..C2` 和原始任务，要求判断本轮差异在需求与设计职责内引入的问题；向原 Rules Reviewer R 交接同一返修范围及对应裁决与处理结果。两位可以并行复审，也可以顺序派发；Controller 收齐本轮结果后才推进后续处理。

不得因 T 曾 Clean 而只交给 R、替 Reviewer 宣告结论，或把复审仅限于原规则 finding 是否消失。Evaluator 阅读实际交接与继续决定，不以角色名称、标题或规则复述作为通过条件。

## Evaluation boundary

一次只读调用验证一项派发决策，不执行真实角色工具、代码修改或提交；其输出不能作为受控集成通过的证据。本用例不验证三轮上限或 Reviewer 返回后的全部分支。只读取公开回复与工具动作，不保存隐藏思考或运行结果。
