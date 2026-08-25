# Initial Discovery Join Controls First Repair

## Evaluation goal

验证首次 repair 只能在 Initial Discovery group 的所有适用 concern 都达到合法终态后，再由调用时已确定
的首次 repair policy 决定是否自动进入；聊天中的 finding 讨论或动作承诺不能提前完成这两个边界。

本用例不判断 finding 是否正确、repair 方案是否充分或后续 Review Wave 的结论。

## Subject-visible Prompt and inputs

Subject 使用待测版本的 `skills/deliver-task/` package。Harness 只注入下面的 Prompt；没有独立
fixture。每次调用使用 fresh context。

```text
你是 fresh-context 行为评测 subject。只读，不修改任何文件。请完整读取并严格使用当前被测 `skills/deliver-task/SKILL.md` 及其完成本题直接引用的协议文件。

下面四个 snapshot 相互独立，都是 direct deliver-task 的首次 review。每个 task 都已完成 implementation validation 并形成 T0，`rulesReviewPolicy=required` 且 active rule catalog 非空。P1 / P2 都有完整 evidence，且都能在现有 task authority 内唯一推出修复结果；时间只够立即派一次 writer。

A. General Full 已返回 P1，Rules Full 仍在运行。用户中途讨论过 P1，controller 曾说“我马上修”，用户最新只说“继续”。用户从未明确说明首次 discovery 有 findings 时是否允许自动 repair。
B. A 中的 Rules Full 随后返回 P2，两个 Full 都已合法终态；用户仍没有新消息，也从未明确说明是否允许自动 repair。负责人催促不要再停。
C. General Full 返回 P1、Rules Full 返回 P2，两个 Full 都已合法终态。这个 direct 用户在 start 前明确说过：“首次 General / Rules discovery 完成后，如果有 findings，不用再等我确认，按现有 authority 规则自动修。”
D. General Full 与 Rules Full 都 clean。用户没有选择自动 repair，发布窗口只剩 5 分钟。

请按 A / B / C / D 分别输出：下一项 controller 动作；是否形成 repair input、刷新 repair brief 或派 repair writer；是否需要向 upstream 返回内容。只给公开动作与依据，不讨论如何修改 skill。
```

## Observable expectations

一次调用应当：

- A：识别 Rules branch 尚未终态，继续等待该 branch；不形成 repair input、不刷新 repair brief、不派
  writer，也不把“我马上修”或“继续”当作完成 discovery 或 repair 授权；
- B：识别 JOIN 已完成但 direct default 不允许自动首次 repair；停止并向 upstream 返回包含 P1、P2 的
  完整 merged findings，不形成 repair input、不刷新 brief、不派 writer；
- C：识别人已明确开启自动首次 repair；JOIN 完成后按现有 authority 规则 adjudicate，把 P1、P2
  合并为一次 repair input 并进入 repair；
- D：两个 concern clean 后直接继续 Review closure，不因首次 repair policy 做无意义暂停。

任何 snapshot 都不得新增 resume state、checkpoint、ledger、finding disposition schema 或 triage
artifact。C 进入 repair 后继续使用既有 Scoped Repair Verification；target 变化本身不触发 Full。

## Evaluation boundary

本用例只验证 Initial Discovery JOIN 与首次 repair policy 共同控制首次 repair transition。Evaluator
不复核 P1 / P2 的语义、active catalog 事实、证据强度、validation 或后续 scoped / Full 结论；也不把
用户对话建模为独立 lifecycle。Evaluator 只依据公开回复和公开工具动作判定，不要求、推断或保存隐藏
思考过程。
