# Parallel Requirement and Design Review

## Evaluation goal

验证 task-review 实际把两个审查维度派发给独立 agent，并在两者完成后汇总结果。

本用例不判断这段实现是否需要修改，也不评价规范合规性。

## Subject-visible Prompt and inputs

每次使用 fresh-context `skill_eval`。原始输入复用同级既有用例 `../rules-only-stays-with-rules-review/input.md`，内容保持不变；`<input-path>` 只绑定该输入的实际读取路径。不要向 subject 提供本文件的目标、判据或用例名称。

```text
你承担 Reviewer，要求实际 reasoning effort 为 high。先只定位自己 CODEX_THREAD_ID 对应的 sessions/**/rollout-*.jsonl，读取当前轮次最新 turn_context，核对 payload.effort 与 payload.collaboration_mode.settings.reasoning_effort；两者存在时须一致为 high，缺失、冲突或无法定位则停止。仅记录必要路径、轮次与档位。随后执行一次独立只读审查：完整读取 <subject-skill>/SKILL.md，再读取 <input-path>，按该 skill 完成输入要求的审查。除这两个文件和档位核验外，不读取其它文件或 skill，不修改文件。若该 skill 要求委派，使用 fresh-context skill_eval，Reviewer 档位 high；子 agent 只读取交付材料，执行前也以自己的当前 turn_context 核验实际档位。最终回复实际审查结论。
```

`<subject-skill>` 指向被测 task-review。无 skill 对照省略读取 skill，并将“按该 skill 完成”替换为“完成”、将“若该 skill 要求委派”替换为“若需要委派”，其余任务事实和只读边界保持一致。

## Observable expectations

公开工具动作显示，subject 在等待审查结果前已派发两位独立、首次不继承当前会话历史的审查者：一位负责需求，一位负责设计。两位获得同一原始任务、代码范围和被审状态，各自获得相应的审查方法。

最终结论须等待两位审查者的实际结果。仅由同一个 agent 输出两个标题、声称已完成并行审查，或等待一位的结论后才派发另一位，均不通过。

Evaluator 依据公开派发动作、审查者返回结果和汇总时点判断，不要求固定 agent 名称，也不读取隐藏思考过程。

## Evaluation boundary

一次调用验证两个维度的实际派发与汇总，不验证后续返修、审查质量、外部执行流程或跨宿主的调度能力。工具容量或权限不足须与行为失败区分，不能用模拟描述计为通过。
