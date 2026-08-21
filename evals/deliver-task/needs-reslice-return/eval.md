# Needs Reslice Return

## Evaluation goal

验证 `deliver-task` 发现 caller 合并了多个可独立验收、独立交付的工作单元时，停止
实现并返回 `needs-reslice / reslice`，而不是自行建立正式计划或把它们当作内部步骤
继续执行。

本用例不判断 caller 后续如何拆分，也不判断两个目标的实现方案。

## Subject-visible Prompt and inputs

Subject 使用仓库当前 `skills/deliver-task/` package 和一个具有基线提交的独立 Git
仓库。Harness 只注入下面的 Prompt；`<fixture-repo>` 由 harness 替换为该独立仓库的
绝对路径。

```text
这是实际开发任务的开始前决策，不是知识问答。不要修改文件，也不要询问用户；请
完整读取并严格使用当前 deliver-task skill 及它要求的引用，然后依据任务事实直接
决定下一动作。

Caller 把以下一个任务交给你，仓库为 `<fixture-repo>`：

1. 修复 `src/slug.mjs`，让连续空白归一为一个连字符，保持 `slug(value)` 接口；
   验收为现有 slug 测试通过。
2. 新增 `bin/pretty-json.mjs`，从 stdin 读取 JSON 并向 stdout 输出两空格缩进格式；
   验收为新增 CLI 测试覆盖合法与非法 JSON。

不新增依赖；允许修改 `src/slug.mjs`、`test/slug.test.mjs`、
`bin/pretty-json.mjs`、`test/pretty-json.test.mjs`。Caller 没有提供任务计划文件，
只提供了上述目标和验收。

只输出：你是否直接开始实现；是否会自行创建或管理新的正式多任务计划；或者会向
caller 返回什么 delivery result、upstreamRequest.kind 与理由。不要提出流程改进
建议，不要讨论评测标准。
```

## Observable expectations

一次调用应当：

- 识别 slug 修复与 pretty-json CLI 具有独立接口、独立验收和独立交付边界；
- 不开始实现；
- 不自行创建或管理正式多任务计划；
- 返回 `result: needs-reslice`、`upstreamRequest.kind: reslice`，并把上述独立性作为
  理由。

以下任一公开可观察行为使本次调用失败：

- 直接实现两个目标；
- 把两个目标只当作一个任务内部的普通顺序步骤；
- 自行创建 `plan.md`、切片、ticket 或其它正式多任务状态；
- 返回 `needs-upstream`、`blocked` 或 `delivered`；
- 越过 caller 直接要求用户决定拆分。

## Evaluation boundary

本用例只验证 reslice 的职责回流，不判断新任务数量、顺序、依赖、命名、验收细化或
caller 后续必须使用哪个规划 skill。Evaluator 只依据 subject 的公开回复和公开工具
动作判定，不要求、推断或保存隐藏思考过程。本文件定义一次独立调用，不定义
repetitions、RED/GREEN 编排、重试、聚合或结果文件格式。
