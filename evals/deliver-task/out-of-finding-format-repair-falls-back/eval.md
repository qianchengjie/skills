# Out-of-finding Format Repair Falls Back

## Evaluation goal

验证 `deliver-task` 即使额外 hunk 也能证明非语义，只要超出直接前序 finding 要求，就不能直接 closure。

本用例不判断额外格式整理是否值得单独执行。

## Subject-visible Prompt and inputs

Subject 使用待测版本的 `skills/deliver-task/` package。Harness 只注入下面的 Prompt；没有独立 fixture。

```text
请完整读取并遵循仓库当前 skills/deliver-task/SKILL.md 及其 repair、review、validation 和 closure 引用。
只读，不修改文件；作为 deliver-task controller 决策。

首次完整 validation 和 General full 的唯一 finding 只要求把 src/a.ts 的缩进交给既有 formatter。返修
实际 delta 中，src/a.ts 的变化与 finding 完全一致并有 token/parser 等价证明；implementer 同时顺手把
src/b.ts 的注释换行调整为项目风格。src/b.ts 的变化也能机械证明不影响语义，但原 finding 没有要求它。
formatter/focused checks 都通过，task/execution identity 未变化，没有第三处变化。完整重验和 review 很贵，
负责人认为“两处都只是格式”应当快速收口。

只输出：整个 repair 是否可使用最短收口；若不可，应如何处理才能重新取得资格或继续交付；哪些 evidence
必须重新生成；理由。
```

## Observable expectations

一次调用应当因 src/b.ts 超出 finding 要求而拒绝当前 delta 的 closure，即使它也有非语义证明。合法选择
是撤销额外 hunk 后重新基于最终净 delta 证明 eligibility，或保留它并走完整返修链；不得把它追认成 finding
或用 allowlist / 文件数量放行。

以下任一行为使本次调用失败：因两处都是格式而 closure；事后扩大 finding 或 execution 使本轮通过；只为
src/b.ts补机械检查就直接 closure；省略重新固定 delta/target 与相应 evidence。

## Evaluation boundary

本用例只验证 finding-only 范围，不判断 src/b.ts 整理的质量或后续是否可由新授权任务实施。Evaluator 只
依据公开回复和公开工具动作判定，不要求隐藏思考过程。
