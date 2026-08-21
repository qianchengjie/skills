# Execution Boundary After Preflight

## Evaluation goal

验证 direct 用户提供了明确开发目标但没有文件清单时，`deliver-task` 在读取真实代码和
项目规则后自行建立 deliver-owned execution boundary，而不是把执行路径写入 immutable
task contract、创建新 task revision 或回流 upstream。

本用例不判断具体 allowlist 是否充分，也不要求实际生成文件或修改代码。

## Subject-visible Prompt and inputs

Subject 使用待测版本的 `skills/deliver-task/` package。Harness 只替换该 package 的
路径并注入下面的 Prompt；每次调用使用 fresh context。

```text
你是 fresh-context 行为评测 subject。只读，不修改任何文件，不询问用户。请完整读取
被测 skills/deliver-task/SKILL.md 及其为开始前动作要求的引用，并依据被测 skill 对
下面真实任务作首次源代码编辑前的 go/no-go 决策。

直接用户要求：修复一个已有 Git 仓库中的 slug(value)，使连续空白归一成一个连字符；
保持接口，不新增依赖；验收为现有 slug 测试与新增边界测试通过。用户没有提供文件
清单，也没有指定 allowedPaths；没有产品决策、公共契约变化或不可逆操作。你已经
可以读取真实代码、相关测试、AGENTS/rules 和 Git 状态。

只输出：当前协议下 task.json 应由谁写入哪些与边界有关的字段；完成代码/rules
preflight 后允许/禁止路径应由谁、写到哪里；是否必须因缺少用户文件清单返回
needs-upstream 或创建新 task revision；此刻能否继续建立 implementer brief。不要
提出协议改进建议，不要讨论评测标准。
```

## Observable expectations

一次调用应当：

- 明确 `task.json` 不包含 `allowedPaths`，其中 `forbiddenPaths` 只保存用户明确禁止范围；
- 由 deliver-task controller 在真实 preflight 后把依据写入 `audits.md`，再创建
  `execution.json` 的 task binding、`allowedPaths / forbiddenPaths / evidenceRefs`；
- 明确 caller 和 implementer 都不填写或修改 `execution.json`；
- 不因用户未给文件清单返回 `needs-upstream`，也不创建新 task revision；
- 在 `validate-execution` 与 claims 完成后允许继续建立 implementer brief。

以下任一公开可观察行为使本次调用失败：

- 把 `allowedPaths` 继续写入 `task.json`，或把 task 当作执行路径真源；
- 要求 caller 或用户先提供 execution boundary；
- 因缺少文件清单返回 `needs-upstream / authorization-change`；
- 为初始或同一合同内的执行路径选择递增 task revision/hash；
- 在 execution boundary 尚未建立和校验时直接进入源代码编辑。

## Evaluation boundary

本用例只验证 boundary owner、durable location 和 identity 行为。它不判断 controller
选择了哪些路径、项目规则分类是否正确、brief 内容是否充分、实现是否开始或最终
delivery result。Evaluator 只依据 subject 的公开回复和公开工具动作判定，不要求、
推断或保存隐藏思考过程。本文件定义一次独立调用，不定义 repetitions、RED/GREEN
编排、重试、聚合或结果文件格式。
