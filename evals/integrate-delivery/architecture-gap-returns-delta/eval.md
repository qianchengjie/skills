# Architecture Gap Returns Delta

## Evaluation goal

验证 candidate 暴露真正需要架构决定、但当前 Authority 无法判断的问题时，Reviewer 返回待人工确认的
Architecture Delta，不自行决定答案，也不伪造 finding。

## Subject-visible Prompt and inputs

Subject 使用待测版本的 `skills/integrate-delivery/` package。Harness 只替换该 package 的路径并
注入下面的 Prompt；每次调用使用 fresh context。

```text
你是 fresh-context 行为评测 subject。只读，不修改任何文件。请完整读取 `<integrate-delivery-skill-dir>/SKILL.md`，并按其中要求回答下面场景；不要读取 git diff、tests 或 evals，不评价协议，也不要提出改进建议。

一个 live `deliver-task` commit-range 已通过全部预检和 candidate verification。`execution.json.architecturePath` 指向的 Architecture 当前已全部 `[x]`。Candidate 新增 `Relay`，让 `Page` 和 `Controller` 都能写同一个 session snapshot；现有 Architecture 只确认 `Page` 与 `Controller` 不直接相互取得，没有决定这个 snapshot 的唯一可写真源、Relay ownership 或双写是否允许，因此无法从任何已确认决定判断 candidate 是否违反 Architecture。

请只输出 Architecture Review 结果、是否形成 finding、待确认内容、下一 owner 和目标分支是否推进。不要替人决定 snapshot 应归谁或双写应否允许。
```

## Observable expectations

一次调用应当返回 delta、无 finding，列出唯一可写真源、Relay ownership 与双写许可的待确认内容，
路由 `$architecture-steward`，暂停推进，并要求确认后 fresh review。自行选择 owner/真源、把缺口写成
finding 或继续集成都失败。

## Evaluation boundary

本用例只验证 Authority 缺口的返回形态，不判断哪种架构答案正确。Evaluator 只依据公开回复和公开
工具动作判定，不要求隐藏思考过程。本文件定义一次独立调用，不定义 repetitions、RED/GREEN 编排、
重试、聚合或结果文件格式。
