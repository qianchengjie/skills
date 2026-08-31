---
name: whats-next
description: 开发事项中不确定下一步做什么、该由哪个 skill 或责任层继续，或执行中发现代码、任务、验证、Spec、需求、契约、项目规则问题时使用。
---

# 下一步做什么

## 核心契约

当前开发事项的下一步或责任归属不清楚，或执行中发现跨层问题时，只判断现在该归哪个 owner，给出依据和下一步，然后停止。Router 不保存状态，不修改任何 artifact，也不调用推荐的 skill。已有明确下一步且对应的具体 skill 直接适用时，不额外经过 Router。

固定输出：

```markdown
- 责任归属：<执行层 | 规划层 | Architecture 层 | Spec 层 | 探索层 | 规则层>
- 判断依据：<当前状态需要哪一层继续，或哪一层的真源 / 执行结果有问题>
- 推荐下一步：<具体 skill 和必要的后续顺序>
- 动作：stop
```

一次只给一个责任归属。同一 owner 可以因问题形态不同而推荐不同 skill，这不构成多个 owner。

## 路由表

| 当前情况 | 唯一责任归属 | 推荐下一步 |
| --- | --- | --- |
| 需求或契约仍有待决定的分叉 | 探索层 | 当前会话可澄清时用 `grill-with-docs`；需要跨会话逐步决策时用 `wayfinder`；决定明确后用 `to-spec`，再进入 `execute-task` |
| 需求已经明确，但尚未形成可执行 Spec，或当前 Spec 写错 | Spec 层 | 用 `to-spec` 形成或修正 Spec；完成后进入 `execute-task` |
| 当前下一步本身是读取或管理 Architecture Authority，包括创建、新增、修改、删除、确认或重新打开 | Architecture 层 | 用 `architecture-steward` 读取或管理 Architecture Authority |
| Spec 已明确且正确，下一步是实现或验证 | 执行层 | 用 `execute-task` 组织这个目标、范围与验收已经明确的软件开发任务 |
| 代码、任务或验证有问题 | 执行层 | 明确修复任务的目标、范围与验收后，用 `execute-task` 组织执行 |
| 代码违反当前有效规则 | 执行层 | 明确修复任务的目标、范围与验收后，用 `execute-task` 组织执行与审查 |
| 规则定义本身错误 | 规则层 | 用 `rule-steward` 修正规则；完成后进入 `execute-task` |

按当前需要推进或修正的真源判断，不按所处阶段或提问措辞判断。只有仍需在多个可接受的需求或契约结果中做决定，才算重新出现分叉；用户或正式真源已经选定结果，而当前情况只是尚未核验历史记录、Spec 或其它 upstream artifacts 应如何对齐时，不要因此重开探索。若判断归属依赖某个现有 artifact 的内容或适用范围，先只读该 artifact；核验后仍有多个结果待决定，才归探索层。

只有当前动作本身是读取或管理 Architecture Authority，才归 Architecture 层。Architecture 的存在不改变 ready Task 的既有归属。

路由表只直接支持其中写明的责任归属、推荐 skill 和后续顺序。回答若要进一步断言某个 skill 会如何写入或回写 artifact、历史 artifact 是否需要修改，或哪些下游 artifact 必须同步，先读取该 skill 的当前协议和相关 artifact；未核验时不作这些断言，只保留已有证据支持的 owner 路由。读取协议和 artifact 是取证，不是调用推荐 skill；输出后仍然 stop。

## 停止边界

输出路由后立即停止，即使用户要求“顺手修掉”“先兼容”“直接继续”或“自动调用下一步”。不得：

- 创建、修改、确认或重新解释 Architecture Authority；
- 修改 Spec、代码、规则或 review 结论；
- 自动调用推荐的 skill 或自动重入下游；
- 用局部兼容迁就错误上游；
- 新增 revision、baseline hash、invalidation ledger、状态机、影响图、版本关系或受影响切片计算。

上游 owner 修正后，如果下一步是目标、范围与验收已经明确的软件开发任务，交给 `execute-task`。任务边界由 Caller 提供；Router 和 `execute-task` 都不负责定义或拆分任务。

## 其他导航和辅助 skill 不拥有当前真值

- `ask-matt` 适合浏览整个 skill 集合或了解常见 flow；当前开发事项需要唯一责任归属时，由本 Router 判断。
- `checkpoint` 只保存或恢复尚未结束的讨论状态；正式 Spec、plan、issue 或规则仍是各自真源。
- `tell-me-first` 只提供通用执行预告与确认，不拥有开发任务的真值。
- `bounded-agency-review` 只在设计或修改本流程、skill 或规则时做元审查。

四者都不能替代责任归属，也不能成为路由结果中的 owner。

## 常见绕过

| 说法 | 处理 |
| --- | --- |
| “用户已经要求一起修” | 授权不改变问题归属；仍推荐对应 owner 并 stop |
| “补记录、重跑门禁就合规了” | 记录和门禁不能授予 Router 修改上游的责任 |
| “先做一个可逆兼容” | 局部兼容会掩盖错误真源；返流后 stop |
| “checkpoint 已经保存了决定” | checkpoint 不拥有业务真值；按正式载体和当前分叉路由 |

出现以下任一行为，立即回到固定输出：准备编辑任一 artifact、准备自动调用 skill、列出多个 owner、把辅助 skill 当 owner，或设计新的治理状态。

## 示例

需求决策已经明确，正式 Spec 与决定一致，但尚未建立开发计划或开始实现：

```markdown
- 责任归属：执行层
- 判断依据：需求和 Spec 已经闭合且一致，当前没有待修正的上游真源
- 推荐下一步：用 `execute-task` 组织这个目标、范围与验收已经明确的软件开发任务
- 动作：stop
```
