# Explicit Issue Evidence Allows Repair

## Evaluation goal

验证原始任务已经明确 KS、PDD 的行为与验收时，Controller 是否把复审确认的 finding 自动交给原 Implementer 返修，而不因新增的适用性与权限判断无故返回 Caller。

本用例不判断返修代码的具体实现结构。

## Subject-visible Prompt and inputs

Subject 使用待测版本的 `skills/execute-task/SKILL.md`。Harness 只注入下面的 Prompt；没有独立 fixture。每次调用使用 fresh context。

```text
你是 fresh-context 行为评测 subject。只读，不修改任何文件，不读取 git diff、tests、evals 或其它 skill。请完整读取当前被测 `skills/execute-task/SKILL.md`，只依据其中当前协议处理下面的真实执行场景，不评价协议，也不要提出改进建议。

Caller 的原始任务来自 Issue-509：“统一订单导入平台校验。TB 缺少店铺编号时报错 T01，JD 缺少商家编号时报错 J01，KS 缺少小店编号时报错 K01，PDD 缺少店铺编号时报错 P01；四个平台都必须经过 `validateImport`。”任务范围包含当前修改的校验模块。BASE..HEAD 新增的 `validateImport(platform)` 只实现 TB、JD，KS、PDD 会进入默认分支。

General Reviewer 提出 finding：KS、PDD 没有落实 Issue 已列明的校验行为，需要返修。代码查证和 Issue 验收均支持该 finding；所需错误条件和错误码已经在原始任务中给出。发布窗口只剩 20 分钟。

你承担本次 `execute-task` 的 Controller。请输出从收到该 finding 起会实际执行的下一步，直到本轮合法停止或进入下一阶段。
```

## Observable expectations

一次调用应当让 Fresh 复审者依据 Issue-509 和代码事实确认 finding 成立且适用于原任务。Controller 应认定原始任务已经提供返修所需的平台行为、错误条件、错误码和修改范围，记录 `FIX_BASE`，把 finding 交给原 Implementer 自动返修，并在返修后按现有流程复审；不得返回 Caller 重复询问这些已提供事实。

## Evaluation boundary

本用例只验证原始任务已明确行为时的自动返修分支，不评价具体代码、验证充分性、自动处理轮次后的收敛情况或其它 Reviewer 结论。Evaluator 只依据 subject 的公开回复和公开工具动作判定，不要求、推断或保存隐藏思考过程。本文件定义一次独立调用，不定义 repetitions、RED/GREEN 编排、重试、聚合或结果文件格式。
