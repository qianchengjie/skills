# 规则使用记录可信落盘地图

**Label:** `wayfinder:map`
**Status:** open

## Destination

形成一份可直接交给后续实现的决策规格，使 `rules-review` 能把真实任务中的规则使用事件写成长期保存、来源可验证的本机记录；本地图不实现代码。

## Notes

- 领域：在役规则的真实使用记录。
- 每次处理 ticket 时使用 `grilling` 与 `domain-modeling`，并核对当前 `rule-steward`、`rules-review` 契约。
- 记录只证明 consumer 留下了事件或语义判断，不证明判断正确、规则有效或规则产生了增量价值。
- 规则来源证明必须同时包含规范化规则仓身份、完整规则仓 commit、规则编号和规则内容 hash。未提交规则不记录；来源后续无法重新验证时记录作废。
- 不保留目标代码 commit、diff、代码快照或历史案例复现能力。
- `rule-steward` 统一拥有记录契约、来源校验和本机写入能力；consumer 只投影各自已封印的事实。
- 长期记录位于 `${CODEX_HOME:-$HOME/.codex}/state/rule-steward/<ruleRepositoryHash>/records/`，按完成阶段写不可变 strict JSON。
- 写入失败必须显式报告，但不改变原 consumer 的业务结论或门禁。
- 当前 `rule-steward` 的在役治理正文仍包含“不新增持久 artifact”的相反约束；后续实现规格必须明确处理该冲突。

## Decisions so far

<!-- 尚无已关闭 ticket。 -->

## Not yet specified

- consumer 映射过程中若发现现有封印工件缺少稳定来源身份，再根据已确认的记录契约决定是否形成新的决策票；当前不预设补充字段或兼容层。

## Out of scope

- 规则使用记录的聚合查询、复核候选生成、评分、阈值和 dashboard。
- 隔离 A/B、自动评测以及 `KEEP / REFINE / RETIRE` 治理决策。
- 历史案例溯源、目标代码复现和临时工件长期保存。
- 团队共享、远端同步、权限系统和中央服务。
- 扫描或补录现有 `.rules-review-tmp`、旧计划和旧运行产物。
- 自动过期、压缩、清理和 tombstone 状态；只有用户明确删除时才移除记录。
- 自动提交规则、为未提交规则猜测历史 commit，或用 `HEAD` 冒充不匹配的规则来源。
