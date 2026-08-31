# 锁定机器校验与行为验证边界

**Label:** `wayfinder:grilling`
**Parent:** [规则使用记录可信落盘地图](../map.md)
**Blocked by:** [映射 deep-rules-review 的规则使用记录](03-rules-review-projection.md)
**Assignee:** unassigned
**Status:** open

## Question

最小验证面应如何证明 strict JSON 结构、规则仓身份规范化、完整 commit 可解析、active 规则编号与内容 hash 匹配、确定性写入、冲突与作废语义以及 `deep-rules-review` consumer 的机械投影正确，同时明确拒绝用脚本判断适用性、finding 正确性、修复归因或规则效果？
