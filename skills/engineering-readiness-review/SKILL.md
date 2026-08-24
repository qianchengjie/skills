---
name: engineering-readiness-review
description: 当研发需求、Spec、方案或任务准备标记 ready-for-agent、进入 to-tickets / deliver-task，或需要判断场景边界与重大 HOW 是否已经收敛时使用。尤其适用于 concurrency、retry、race、timeout、refresh、late callback、测试补充语义、独立事件混合，或数据 owner、迁移、故障模型等分叉；不要用于替上游作需求决定、普通代码 review 或实现。
---

# 研发可执行性审查

## 核心契约

在正式拆票或执行前，只读挑战候选需求：所有可观察 WHAT 与会实质约束后续执行的重大 engineering decision，必须已有 authority，或能由既有 authority 唯一推出；剩余自由度只能是合同内的 implementation freedom。

测试、fixture、并发压测、实现和绿灯结果可以暴露缺口，不能获得需求 authority。Reviewer 只发现并路由问题，不修改 Spec、不替 owner 选择答案，也不把自己的修复建议提升成新合同。

优先由未参与候选内容编写或实现的 fresh reviewer 执行。当前 reviewer 已参与时，使用 fresh context 复核。

## 输入与材料覆盖

读取候选需求 / Spec / plan / task、它准备进入的下一阶段，以及当前可见的：

- 用户或 owner 已确认的决定、正式 Spec、ADR、公共契约和既有行为规则；
- 相关代码、直接消费者与测试，用于确认合同的实际适用边界；代码和测试本身不自动成为需求 authority；
- 候选内容的来源与形成过程，尤其是 AI 总结、拆分、测试设计和 review 建议。

先声明已读与未覆盖材料。缺少会改变结论的 authority 时返回 `cannot-verify`，不能猜 `ready`。

## 审查方法

只检查会影响 ready 的关键 claim，并把它们分成：

| 分类 | 判定 | 动作 |
| --- | --- | --- |
| 明确 authority | 已确认来源直接规定 | 保留 |
| 唯一推导 | 能给出 `source → 状态 / 顺序 → 结果` 的单一推导链 | 保留推导依据 |
| implementation freedom | 不改变可观察行为、公共契约、数据语义或重大工程边界 | 留给 implementer |
| 未决语义 / 重大分叉 | 多个结果仍合理，或必须新增业务、失败恢复、交互或工程决定 | finding，回既有 owner 后 stop |

### 场景边界

对 concurrency、retry、duplicate、race、timeout、refresh、late callback 等构造场景：

1. 拆出用户动作、系统事件、状态变化和事件间交互；时间交错不自动把多个事件变成一个，也不自动证明它们相互独立。
2. 逐项追溯已有合同，并检查当前状态或顺序是否真的改变其适用条件。
3. 已有 authority 唯一推出结果时，要求候选内容对齐；不需要 owner 再决定。
4. 无法唯一推出时，只记录准确分叉并回 owner；不得补一个“折中”结果。

禁止用排队、延后、缓冲、去抖、自动重试、fallback 或“行业常规”调和冲突，除非这些行为本身已有 authority。它们可能是合理方案，但合理不等于已授权。

### 重大 HOW 分叉

不同 HOW 若会改变公共接口、数据语义 / owner、事务与并发边界、失败 / retry / recovery、迁移、安全权限、部署或运维责任，就不是可直接下放的局部实现选择。没有既有约束能收敛时返回 owner。

多个内部结构若在上述边界上等价，允许 implementer 按正确性、可验证性、最小必要改动、可维护性和项目惯例选择；不要为了“只有一个 HOW”制造无意义决策。

## 输出

只返回审查，不编辑任何真源：

```markdown
- 结论：ready | findings | cannot-verify
- 材料覆盖：<已读 authority、候选 artifact、未覆盖材料>
- 剩余自由度：<为什么只剩 implementation freedom，或仍有哪些分叉>
- Findings：
  - 候选 claim：<会约束执行的内容>
  - 分类：<未授权扩张 | authority 冲突 | 未决语义 | 重大 HOW 分叉>
  - 依据：<source 与推导 / 冲突链>
  - Owner 与动作：<现有 owner；修正 artifact 或作出决定后 stop>
```

`ready` 只在所有关键 claim 都属于前三类时使用。`findings` 只报告真正阻止执行的缺口，不顺手扩写需求或架构。

## 例子

已确认规则分别是“createTrade-only response 本身不续触发 AI”和“独立员工消息保存成功后触发 AI”；QA 为并发测试补了“订单保存期间员工消息不触发”。Reviewer 应认定 QA 期望无 authority，并要求 Spec owner 对齐既有员工消息规则。不得自行增加“订单完成后再排队触发”，因为这又创造了第三种时序语义。

## 常见绕过

| 说法 | 处理 |
| --- | --- |
| “测试都绿，先按测试定义行为” | 绿灯只证明实现符合期望，不证明期望获授权 |
| “为了避免并发，延后或排队即可” | 触发时机也是业务语义；没有 authority 就是新的 contract expansion |
| “这都是 HOW，让实现自己选” | 先检查是否改变 owner、迁移、失败恢复或运维边界 |
| “任何边界都问 owner 最安全” | 既有 authority 能唯一推出时直接对齐，不制造伪分叉 |

出现“测试需要一个 expected value”“先给合理默认值”“实现已经完成”“只差补边界”时，先重新检查 source / derived 边界；这些都不能授予新语义。
