# rules-review：协议通过，发现 1 项问题

## 结论
- 协议门禁：协议通过
- 审查结论：发现问题
- 修复建议：合并前必须修复
- 问题数：1
- 必须修复：1
- 建议修复：0
- 无法验证：0
- 观察项：0

## 范围
- 范围模式：完整范围
- 覆盖声明：协议覆盖完整
- 排除规则：无

## 审计
- runId：run-fail-final-finding-mismatch
- ruleSetId：未知
- sourceIndexHash：未知
- candidateRuleRefs：0
- requiredRuleRefs：0
- excludedRuleRefs：0
- globallyNotApplicableRuleRefs：0
- changedUnits：0
- candidates：0
- contextExpansions：0
- reviewItems：0
- reviewBatches：0
- 验证命令：`node skills/rules-review/scripts/validate.js --mode run --dir tests/rules-review/fixtures/run-fail-final-finding-mismatch`
- 验证摘要：protocolGate=passed，semanticVerdict=issues，findings=1，mustFix=1，shouldFix=0，cannotVerify=0，observations=0，recommendation=must_fix_before_merge

## 执行计划
- 未记录

## 问题
### 必须修复
- F001 | RI001 | WRONG | MUST | 本次引入 | WRONG：fake evidence

## 验证
- protocolGate：协议通过
- run：成功
