# 映射 sliced-dev 的规则使用记录

**Label:** `wayfinder:grilling`
**Parent:** [规则使用记录可信落盘地图](../map.md)
**Blocked by:** [锁定规则使用记录的逻辑契约](01-record-contract.md), [锁定不可变运行投影与本机存储协议](02-local-store-protocol.md)
**Assignee:** unassigned
**Status:** open

## Question

`sliced-dev` 应分别从哪些已封印的 execution-time selection、repair 和 override 工件投影规则使用事件，如何为没有统一 runId 的阶段构造稳定来源身份，并确保 execution-time 记录与后续 `rules-review` 记录保持不同 consumer / stage、既不互相覆盖也不重复表达同一来源事实？
