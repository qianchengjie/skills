# Single Reviewer, Two Verdicts

## Evaluation goal

验证 task-review 由当前 Reviewer 自行完成需求与设计判断，分别给出两个 verdict，不再派发子 Reviewer。

本用例不评价规范合规审查是否完整，也不验证执行流程的后续裁决。

## Subject-visible Prompt and inputs

每次使用 fresh-context `skill_eval`。原始输入复用同级既有用例 `../rules-only-stays-with-rules-review/input.md`，内容保持不变；`<input-path>` 只绑定该输入的实际读取路径。不要向 subject 提供本文件的目标、判据或用例名称。

```text
你承担 Reviewer，要求实际 reasoning effort 为 high。先只定位自己 CODEX_THREAD_ID 对应的 sessions/**/rollout-*.jsonl，读取当前轮次最新 turn_context，核对 payload.effort 与 payload.collaboration_mode.settings.reasoning_effort；两者存在时须一致为 high，缺失、冲突或无法定位则停止。仅记录必要路径、轮次与档位。随后执行一次独立只读审查：完整读取 <subject-skill>/SKILL.md，再读取 <input-path>，按该 skill 完成输入要求的审查。除这两个文件和档位核验外，不读取其它文件或 skill，不修改文件。若该 skill 要求委派，使用 fresh-context skill_eval，Reviewer 档位 high；子 agent 只读取交付材料，执行前也以自己的当前 turn_context 核验实际档位。最终回复实际审查结论。
```

`<subject-skill>` 指向被测 task-review。版本对照使用修改前要求派发两个子 Reviewer 的 skill 快照；除被测 skill 路径外，Prompt、任务事实和只读边界保持一致。

## Observable expectations

公开工具动作显示，subject 读取任务和代码后直接完成审查，没有派发或向其它 agent 交接需求或设计判断。

最终回答分别给出 requirement 和 design 的 verdict。本例两个维度均为 Clean：三个输入的实现与验收相符，当前结构没有具体设计成本，DOC-04 的纯规则事项不形成需求或设计问题。

只输出一个不区分维度的总体结论，或虽有两个标题却仍委派子 Reviewer，均不通过。Evaluator 结合公开工具动作、判断依据和最终结论评估，不读取隐藏思考过程。

## Evaluation boundary

一次调用验证一个 Reviewer 完成两类判断的职责边界，不覆盖复杂缺陷的检出率、后续返修、外部执行流程或跨宿主的调度能力。工具容量或权限不足须与行为失败区分，不能用模拟描述计为通过。
