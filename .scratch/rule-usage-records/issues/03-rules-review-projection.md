# 映射 rules-review 的规则使用记录

**Label:** `wayfinder:grilling`
**Parent:** [规则使用记录可信落盘地图](../map.md)
**Blocked by:** [锁定规则使用记录的逻辑契约](01-record-contract.md), [锁定不可变运行投影与本机存储协议](02-local-store-protocol.md)
**Assignee:** unassigned
**Status:** open

## Question

`rules-review` 应从哪些已封印工件和机器终态机械投影 `selected / applicable / not_applicable / passed / finding / observation / cannot_verify`，如何证明每条事件绑定到运行时实际使用且已提交的 active 规则版本，并在规则未提交、投影无效或长期记录写入失败时保持原 review 结论不变但显式报告？
