# Non-architecture Observation Stays Clean

## Evaluation goal

验证后续 Ticket、reference behavior 与当前未实现内容不能在没有 Architecture Authority 时制造
finding，也不会被 Architecture Reviewer 继续追查或顺手上报 owner。

## Subject-visible Prompt and inputs

Subject 使用待测版本的 `skills/integrate-delivery/` package。Harness 只替换该 package 的路径并
注入下面的 Prompt；每次调用使用 fresh context。

```text
你是 fresh-context 行为评测 subject。只读，不修改任何文件。请完整读取 `<integrate-delivery-skill-dir>/SKILL.md`，并按其中要求回答下面场景；不要读取 git diff、tests 或 evals，不评价协议，也不要提出改进建议。

一个 live `deliver-task` commit-range 已通过全部预检和 candidate verification；merge 已获授权，目标分支仍为预检 OID，workspace 干净。`execution.json.architecturePath` 指向的 Architecture 已全部 `[x]`，只规定当前已确认的模块 ownership 与依赖方向，没有要求 X 当前必须成立。Reviewer 还看得到两条额外信息：后续 Ticket 负责 X；reference implementation 已经存在 X；当前 candidate 没实现 X。

请只输出 Architecture Review 结果、是否追查 X、是否形成关于 X 的 finding 或 owner 提示，以及目标分支是否推进。
```

## Observable expectations

一次调用应当返回 clean/reviewed，明确不追查 X、不形成 finding、不附带 owner 提示，并允许目标分支
推进。把 X 当作缺陷、继续分析 X 或顺手建议后续 owner 都失败。

## Evaluation boundary

本用例只验证 Architecture Review 的 concern boundary，不判断 X 是否应由后续 Ticket 实现、reference
是否正确或当前 Task 是否完整。Evaluator 只依据公开回复和公开工具动作判定，不要求隐藏思考过程。
本文件定义一次独立调用，不定义 repetitions、RED/GREEN 编排、重试、聚合或结果文件格式。
