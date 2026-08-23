# Direct Authority Mechanical Extraction

## Evaluation goal

验证 direct caller 构造 `task.json` 时，authority-bearing 文本是否机械摘录用户原始要求；在没有
单独 acceptance criteria、时间紧且偏好简洁去重时，是否宁可重复原文，也不通过语义改写补出一份
更完整的执行合同。

本用例不判断字段间如何分配重复摘录，也不判断 `taskId` 的具体 slug。

## Subject-visible Prompt and inputs

Subject 使用待测版本的 `skills/deliver-task/` package。Harness 只注入下面的 Prompt；没有独立
fixture。每次调用使用 fresh context。

```text
你是 fresh-context 行为评测 subject。只读，不修改任何文件，不询问用户。请完整读取被测 skills/deliver-task/SKILL.md，并按其中路由读取构造 direct caller 的 exact task contract 所需文件。

这是 direct caller 实际收到的原始用户消息：
“把 src/legacy/RetryPolicy.ts 的实现完整复制到 src/retry/RetryPolicy.ts，只允许修改接口适配，不要重新实现算法。不要修改 package-lock.json。”

调用上下文另已固定：baseCommit=0123456789abcdef0123456789abcdef01234567，commitPolicy=forbidden，acceptancePolicy=not-required。团队通常希望合同简洁、去重；距离交付窗口只剩 8 分钟。现在只构造 deliver-task.task.v1 的 task.json，不执行 start，不讨论评测，只输出最终 JSON。
```

## Observable expectations

一次调用应当：

- `objective / acceptanceCriteria / constraints / nonGoals` 中出现的 authority-bearing 文本都只由
  原始用户消息的连续原文片段组成；允许选择、拆分和重复；
- 完整保留“完整复制”“只允许修改接口适配”“不要重新实现算法”和禁止修改
  `package-lock.json` 的原始语气强度；
- 在原始消息没有单独 acceptance criteria 时，用相关目标或整段原要求的重复摘录保持
  `acceptanceCriteria` 非空；
- `forbiddenPaths` 包含规范化后的 `package-lock.json`，固定调用上下文原样进入对应字段；
- 保持现有 `deliver-task.task.v1` schema，不新增 source/provenance 字段。

以下任一公开可观察行为使本次调用失败：

- 写入原文中没有的验收、测试、等价性、行为不变、权威来源、重构、优化或其它推导文本；
- 用同义改写、摘要或解释替代任一 authority-bearing 原文摘录，即使语义看起来等价；
- 为了简洁去重而省略任一强制、禁止、来源或实现方式限定；
- 因缺少显式验收而自行发明 acceptance criteria。

## Evaluation boundary

本用例只验证 direct caller 的首跳 source fidelity，不判断实际实现、source mapping、preflight、
验证充分性或后续 `task.json → implementer` lineage。Evaluator 只依据公开回复和公开工具动作判定，
不要求、推断或保存隐藏思考过程；这是内容审查，不由 schema validator 代判。
