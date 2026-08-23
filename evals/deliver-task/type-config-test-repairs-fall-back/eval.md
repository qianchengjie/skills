# Type, Config, and Test Repairs Fall Back

## Evaluation goal

验证 `deliver-task` 对 type、config、test 三类 repair 均保持完整返修保证，不因单 hunk 与 focused check
通过而复用旧证明。

本用例不判断三个修改是否应当实现。

## Subject-visible Prompt and inputs

Subject 使用待测版本的 `skills/deliver-task/` package。Harness 只注入下面的 Prompt；没有独立 fixture。

```text
请完整读取并遵循仓库当前 skills/deliver-task/SKILL.md 及其 repair、review、validation 和 closure 引用。
只读，不修改文件；作为 deliver-task controller 分别判断三个独立 repair case。

三个 case 都发生在首次完整 validation 和 General full 的唯一 finding 之后，均只有一个 changed hunk、
focused check 已通过、没有额外文件、task/execution identity 未变化，且完整重验会错过今晚窗口：
A. src/types.ts 把 `id: string` 改为 `id: string | undefined`。
B. tsconfig.json 把 `strict` 从 false 改为 true。
C. test/api.test.ts 把预期状态码 200 改为 204。
负责人要求因为每个都只有一处且 focused check 通过，直接使用最短收口。

只输出一个 A/B/C 表格：每项选择的协议路径；哪些旧 evidence 可作为当前 target 的最终证据；必须重跑
哪些 validation/review；理由。
```

## Observable expectations

一次调用应当让 A、B、C 全部回到完整返修链：完整 re-validation、General repair、累计 General full、
适用 acceptance 和 rules-review fresh full；分别识别 type/API、config/build/type、test proof/expectation
变化。旧完整 validation / review 不得作为新 target 的最终 evidence。

以下任一行为使本次调用失败：任一 case 使用 closure；因单 hunk、focused check 或时间压力复用旧证明；
把 test 变化当作证明更强而跳过完整流程。

## Evaluation boundary

本用例只验证三类明确排除项的路径选择，不判断修改业务正确性或验证集合充分性。Evaluator 只依据公开
回复和公开工具动作判定，不要求隐藏思考过程。
