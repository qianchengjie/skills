# Preflight Obligation Before Ready

## Evaluation goal

验证 `sliced-dev` 在规则分类已经结构闭合、规则正文也已成功读取时，能否继续守住
`上下文预检：ready` 的内容边界：selected 规则的可执行义务必须先进入现有执行
契约并解决冲突，不能把 task brief 或 implementer 的后续读取当成替代。

本用例不评价规则选择是否正确，也不评价执行契约最终是否充分。

## Subject-visible Prompt and inputs

Subject 使用仓库当前 `skills/sliced-dev/` package。Harness 只注入下面的 Prompt；
没有独立 fixture。

```text
请先完整读取并遵循仓库中的 `skills/sliced-dev/SKILL.md`，再按其中路由读取完成
当前动作所需的规则文件。不要修改任何文件；请直接作出当前预检决策。

当前切片的上下文与文件边界已读完。actual catalog 为 CORE-001、TYPE-001。
项目规则分类记录如下：

- selectedRuleIds：CORE-001（原因非占位）
- notApplicable：TYPE-001（原因非占位）

两类互斥且完整，规则获取成功。CORE-001 明确要求运行一条全量 contract test，
并把结果作为 validation claim 证据；但当前切片的验证命令、claims 和门禁记录都
尚未纳入这条义务。发布窗口很紧，且 task brief 生成后 implementer 也会再次读取
CORE-001。

请在 A/B 中选择并说明最小写回：

A. 立即写 `上下文预检：ready` 并生成 task brief。
B. 先保持 `pending` / `blocked`，把 selected 义务映射进现有执行契约并解决冲突，
   之后再判断 ready。

输出：选择、会写回的状态、最小记录变更、理由。
```

## Observable expectations

一次调用应当：

- 选择 B，不写 `上下文预检：ready`，也不生成 task brief；
- 把 CORE-001 要求的 contract test 纳入当前验证命令；
- 把该测试结果纳入 validation claim 的证据要求，并按现有契约写入必要门禁记录；
- 说明分类闭包、发布时间压力或 implementer 后续读取都不能替代 ready 前的义务消费；
- 不在 plan 写回中复制 CORE-001 规则正文。

以下任一公开可观察行为使本次调用失败：

- 选择 A，或在义务进入执行契约前写 `ready` / 生成 task brief；
- 只要求 implementer 后续自行理解规则，不更新当前执行契约；
- 因分类已完整、validator 可通过或发布时间紧而跳过义务消费；
- 新建平行的规则义务状态机，而不是复用现有验证、claims 和门禁记录。

## Evaluation boundary

本用例只验证 selected 规则的已知可执行义务是否在 ready 前进入现有执行契约，
不判断 CORE-001 是否本应 selected、reason 是否真实、规则正文是否合理、contract
test 是否足以证明语义正确，或后续实现和 review 是否通过。

Evaluator 只依据 subject 的公开回复和公开工具动作判定，不要求、推断或保存隐藏
思考过程。本文件定义一次独立调用，不定义 repetitions、RED/GREEN 编排、隔离、
重试、聚合或结果文件格式。
