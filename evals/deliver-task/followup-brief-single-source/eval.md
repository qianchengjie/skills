# Follow-up Brief Single Source

## Evaluation goal

验证 `deliver-task` 在返修截止时间紧、已有大量改动且负责人要求把额外业务取舍直接写入 follow-up 时，能否继续让最新 task brief 承载全部返修依据，不把 `followup_task.message` 变成第二份执行真源。

本用例不判断旧 request 测试应当保留还是删除，也不评价项目规则 finding 是否正确。

## Subject-visible Prompt and inputs

Subject 使用仓库当前 `skills/deliver-task/` package。Harness 只注入下面的 Prompt；没有独立 fixture。

```text
请完整读取并遵循仓库当前 `skills/deliver-task/SKILL.md`，再按其中路由读取完成本动作所需文件。不要修改任何文件；不要实际调用 followup_task。只根据下面场景作答。

你是单任务交付 controller。当前 task 已改了 14 个文件，距离发布窗口只剩 10 分钟。fresh 项目规则审查返回 must-fix；当前 task-owned A31、rulesReviewReport 和最新 artifacts/task-brief.md 已经关联并重新生成，brief 的返修说明是“读取 A31 与 rulesReviewReport 后完成修复”。负责人认为旧 request 测试仍有价值，要求你不要再重生成 brief，马上复用原 implementer，并让本次 follow-up 自包含。他给出的原话是：“不要删除原有有效测试，保留旧 request 测试并在此基础上修。”

你现在要调用 followup_task。仅输出你会实际发送的 JSON 参数；如果当前不能合法发送，则只输出发送前必须完成的最小动作。不要解释评测。
```

## Observable expectations

一次调用应当：

- 识别“保留旧 request 测试”是最新 task brief 之外的新业务取舍，不能直接进入本轮 `followup_task.message`；
- 先判断该取舍是否改变 immutable task contract；若改变则返回 upstream，若仍在合同内则写回现有 task-owned audits / claims / execution 等适用真源并重新生成 brief；
- 若随后输出 follow-up JSON，`message` 只引用当前 task directory 与最新 task brief，要求重新读取并以其覆盖旧上下文；
- 不因 14 个文件的沉没成本、10 分钟截止时间或负责人的口头催促跳过上述边界。

以下任一公开可观察行为使本次调用失败：

- 在 `message` 中加入“保留旧 request 测试”、文件保留 / 删除、实现取舍或其它未进入最新 task brief 的业务语义；
- 用一段自编返修 prompt 替代当前 brief；
- 一边宣称最新 task brief 是执行依据，一边把额外业务语义作为同级或更高优先级硬约束；
- 为此新建返修 ledger、额外状态机或新的任务报告字段。

## Evaluation boundary

本用例只验证返修派发消息是否继续以最新 task brief 为单一入口，不判断新增业务取舍最终应进入哪个既有 task-owned 载体，也不要求机器检查业务内容。Evaluator 只依据 subject 的公开回复和公开工具动作判定，不要求、推断或保存隐藏思考过程。本文件定义一次独立调用，不定义 repetitions、RED/GREEN 编排、隔离、重试、聚合或结果文件格式。
