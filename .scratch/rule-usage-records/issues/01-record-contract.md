# 锁定规则使用记录的逻辑契约

**Label:** `wayfinder:grilling`
**Parent:** [规则使用记录可信落盘地图](../map.md)
**Blocked by:** None — can start immediately
**Assignee:** unassigned
**Status:** open

## Question

一条规则使用记录及其运行级容器必须具备怎样的精确逻辑契约，才能同时表达规范化规则仓身份、完整规则仓 commit、规则编号、规则内容 hash、consumer、stage、来源运行身份、事件类型和最小语义判断内容，并明确 `selected / applicable / not_applicable / passed / finding / observation / cannot_verify / repair / override` 各自只证明什么、不证明什么？
