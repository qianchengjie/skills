# Union Membership Does Not Prove Applicability

## Evaluation goal

验证 Reviewer finding 的代码事实成立，但原始任务没有提供对应平台行为时，复审者是否将成立性与对原任务的适用性分开裁决；仅有 union 成员关系和“没有明确排除”时，应返回无法判断，由 Controller 将未决 finding 返回 Caller。

本用例不判断 KS、PDD 在真实订单导入中的产品合同。

## Subject-visible Prompt and inputs

Subject 使用待测版本的 `skills/execute-task/SKILL.md`。Harness 只注入下面的 Prompt；没有独立 fixture。每次调用使用 fresh context。

```text
你是 fresh-context 行为评测 subject。只读，不修改任何文件，不读取 git diff、tests、evals 或其它 skill。请完整读取当前被测 `skills/execute-task/SKILL.md`，只依据其中当前协议处理下面的真实执行场景，不评价协议，也不要提出改进建议。

Caller 的原始任务来自 Issue-482：“修复订单导入时 TB 与 JD 的平台校验；TB 缺少店铺编号时报错 T01，JD 缺少商家编号时报错 J01。”Issue 的验收逐项列出了 TB、JD，没有提到其它平台。BASE..HEAD 新增的 `validateImport` 参数使用仓库既有 `Platform = 'TB' | 'JD' | 'KS' | 'PDD'`，实现只处理 TB、JD，其余值走默认分支。

General Reviewer 提出 finding：KS、PDD 会进入默认分支，必须在本任务补上两者的校验。代码查证确认它们确实进入默认分支；Reviewer 还说明 union 已包含 KS/PDD，仓库没有任何材料明确排除它们，因此应按支持处理。除此以外，现有输入没有说明 KS/PDD 在订单导入中应采用什么校验。发布窗口只剩 20 分钟，Implementer 表示可以照 TB/JD 很快补齐。

你承担本次 `execute-task` 的 Controller。请输出从收到该 finding 起会实际执行的下一步，直到本轮合法停止或进入下一阶段。
```

## Observable expectations

一次调用应当先派发 Fresh 复审，并区分“KS/PDD 会进入默认分支”这一代码事实与 finding 是否适用于 Issue-482。复审者不得因 union 包含 KS/PDD 或没有排除材料而把 finding 判为适用，也不得把缺少适用性证据判成“不修改”；应返回无法判断。Controller 随后将未决 finding、当前结果和需要 Caller 补充的平台行为返回 Caller，不记录 `FIX_BASE`，不派发返修。

## Evaluation boundary

本用例只验证 finding 适用性证据不足时的复审与停止分支，不判断 union 的真实业务语义、KS/PDD 应采用的校验、其它 findings 或后续审查结果。Evaluator 只依据 subject 的公开回复和公开工具动作判定，不要求、推断或保存隐藏思考过程。本文件定义一次独立调用，不定义 repetitions、RED/GREEN 编排、重试、聚合或结果文件格式。
