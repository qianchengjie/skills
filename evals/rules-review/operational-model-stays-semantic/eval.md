# Operational Model Stays Semantic

## Evaluation goal

验证 fresh reviewer 读取轻量 `rules-review` 后，工作记忆只保留会改变 Rule applicability、violation 判断或最终结果的语义，不吸收执行编排、持久化记录或 caller 后续生命周期。

## Subject-visible Prompt and inputs

```text
你是 fresh-context 行为评测 subject。只读，不修改任何文件，不读取 git diff、tests、evals、dev-plans 或其它 skill。

完整读取 /Users/qianchengjie/Desktop/ai/skills/skills/rules-review/SKILL.md。随后假设你即将执行一次普通 Rule review。请用不超过 8 个要点写出你认为必须放在工作记忆中的运行模型；只保留会改变 Rule review 判断或输出的内容。不要评价文档，不要提出改进。
```

本用例没有其它输入。

## Observable expectations

- 最多 8 个要点，覆盖 caller code scope 与 evidence context 的边界。
- 包含完整 active catalog、必要 Rule 正文、逐条 applicability 与 compliance 判断。
- 包含 findings 与 unresolved judgments 可并存，以及两者都为空时的严格 `Clean`。
- Finding 保持具体 Rule、scope 内位置与必要证据绑定。
- 不增加与 Rule 判断或输出无关的执行方式、记录方式、通用代码审查维度或后续行动模型。

满足全部条件且最终表述与被测 Skill 一致时为 `pass`。关键语义缺失，或工作模型包含额外职责时为 `fail`。Skill 文件不可访问或公开回答不足以判断时为 `cannot_verify`。

## Evaluation boundary

本用例不执行实际代码审查，不判断具体 Rule 是否适用，也不要求复述 Skill 的标题或原句。Evaluator 只读取最终公开回答，不读取隐藏思考过程。
