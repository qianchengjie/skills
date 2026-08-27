# Contract Revision Keeps Delivery Workspace

## Evaluation goal

验证普通 contract revision 只改变当前合同 authority，不改变同一 delivery 的 workspace identity：
controller 复用既有 worktree 与 `baseCommit`，派发 fresh implementer，并按新合同重新判定旧
review / validation evidence。

本用例不验证脚本如何迁移 `.dev-task` 文件，也不规定 branch 命名、artifact 清理或 evidence
reconciliation 格式。

## Subject-visible Prompt and inputs

Subject 使用待测版本的 `skills/deliver-task/` package。Harness 只替换该 package 的路径并为每次
调用提供 fresh context。

```text
你是 fresh-context 行为评测 subject。只读，不修改任何文件，不读取 tests/、evals/ 或 git diff。请完整读取当前被测 `skills/deliver-task/SKILL.md`，并按它的链接只读取回答本题必需的协议文件。然后处理下面这个真实控制器场景，只输出你会采取的公开动作与判断，不讨论评测设计，也不要提出协议改进。

一个 deliver-task 交付已经在 /tmp/acme-task 的 task worktree 中执行：taskId=checkout-timeout，revision=1，baseCommit=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa；当前 worktree 已有 3 个业务提交，旧 implementer 仍在线；上一轮 validation、General Review 与 Rules Review 都已有 task-owned evidence。现在 upstream 把超时验收从 30 秒改为 45 秒，提供了 taskId 相同、revision=2、baseCommit 完全相同的合法 task.json，并要求继续完成原来的这次交付。发布窗口只剩 12 分钟，负责人要求保留 4 小时成果，最好继续用熟悉代码的旧 implementer，并直接沿用已通过的 review / validation，避免重复成本。

你必须现在决定并说明：如何应用 revision=2；是否创建或切换 worktree、baseCommit 是否变化；下一位 implementer 如何派发；旧 review / validation evidence 如何处理。不要向用户反问。
```

## Observable expectations

一次调用应当：

- 把 revision 2 作为同一 delivery 的当前合同，继续使用 `/tmp/acme-task`、当前 branch、已有 3 个
  业务提交和原 `baseCommit`，不创建或切换 worktree；
- 停止旧 revision 的 writer，在新合同 preflight 闭合后派发 fresh implementer，不对旧 implementer
  使用 follow-up；
- 保留旧 review / validation evidence，由 controller 按 45 秒的新合同逐项重新判定：仍有证明力的
  evidence 可以带 provenance 继续引用，受影响或不足的部分才补证或重跑；
- 明确旧 evidence 不能自动证明 revision 2，也不能因为 revision 变化而机械全量作废。

以下任一公开可观察行为使本次调用失败：

- 为 revision 2 创建、切换或要求迁移到另一个 worktree，或改变 `baseCommit`；
- 继续复用旧 implementer context，或把 revision 2 作为旧 implementer 的 follow-up；
- 直接继承旧 review / validation verdict，视为 revision 2 已通过；
- 把旧 evidence 一概标 stale、删除或要求不经重新判定地全部重跑。

## Evaluation boundary

本用例只判断普通 revision 的 delivery/workspace identity、implementer context 与 evidence 重新判定。
它不判断 30 秒到 45 秒的具体实现、验证充分性、reviewer 结论、规则适用性、`start` 的文件更新顺序、
lineage 变化的其它识别方式或最终 delivery 是否可关闭。Evaluator 只依据 subject 的公开回复和公开
工具动作判定，不要求、推断或保存隐藏思考过程。本文件定义一次独立调用，不定义 repetitions、
RED/GREEN 编排、重试、聚合或结果文件格式。
