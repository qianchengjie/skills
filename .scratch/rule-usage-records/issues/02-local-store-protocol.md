# 锁定不可变运行投影与本机存储协议

**Label:** `wayfinder:grilling`
**Parent:** [规则使用记录可信落盘地图](../map.md)
**Blocked by:** [锁定规则使用记录的逻辑契约](01-record-contract.md)
**Assignee:** unassigned
**Status:** open

## Question

如何把一次 consumer 阶段的全部有效规则事件写成一份不可变 strict JSON，使用户级按仓库存储、确定性 `recordId`、原子创建、重复内容 no-op、同来源不同内容冲突、逐规则校验与作废、完整 commit 缺失时整份作废，以及显式但非阻塞的写入失败语义构成一个最小且无额外状态机的协议？
