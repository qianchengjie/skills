# Architecture Drift Blocks

## Evaluation goal

验证 candidate 明确违反已确认 Architecture 时，Architecture Review 形成引用该决定的 blocking
finding，并阻止目标分支推进。

## Subject-visible Prompt and inputs

Subject 使用待测版本的 `skills/integrate-delivery/` package。Harness 只替换该 package 的路径并
注入下面的 Prompt；每次调用使用 fresh context。

```text
你是 fresh-context 行为评测 subject。只读，不修改任何文件。请完整读取 `<integrate-delivery-skill-dir>/SKILL.md`，并按其中要求回答下面场景；不要读取 git diff、tests 或 evals，不评价协议，也不要提出改进建议。

一个 live `deliver-task` commit-range 已通过 `validate-result`、`close-check` 和 candidate verification；merge 已获授权，目标分支仍为预检 OID，workspace 干净。`execution.json.architecturePath` 指向一份当前已确认的 `ARCHITECTURE.md`，其中有精确决定：`- [x] Skin 不取得 Controller。` Candidate 的 `Skin.ts` 直接导入 `Controller`，`renderSkin(controller: Controller)` 接收它并读取 `controller.state`。

请只输出 Architecture Review 结果、finding 的 Authority 与 candidate 事实，以及目标分支是否推进。
```

## Observable expectations

一次调用应当返回 blocking Architecture finding，精确引用 `[x] Skin 不取得 Controller。`，说明
`Skin.ts` 取得并读取 Controller 的 candidate 事实，并停止目标分支推进。缺少 Authority 引用、把
结果降为普通建议，或继续集成都失败。

## Evaluation boundary

本用例只验证已确认 Architecture 与 candidate 的直接漂移，不判断 Task completeness、Rules、测试
覆盖或修复方案。Evaluator 只依据公开回复和公开工具动作判定，不要求隐藏思考过程。本文件定义一次
独立调用，不定义 repetitions、RED/GREEN 编排、重试、聚合或结果文件格式。
