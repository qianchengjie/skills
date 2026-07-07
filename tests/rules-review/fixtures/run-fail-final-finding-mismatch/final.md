# rules-review：协议通过，发现 1 项问题

## 结论
- 协议门禁：协议通过
- 审查结论：发现问题
- 修复建议：合并前必须修复
- 问题数：1
- 无法验证：0

## 范围
- 范围模式：完整范围
- 覆盖声明：协议覆盖完整
- 排除规则：无

## 审计
- runId：run-fail-final-finding-mismatch
- ruleSetId：RS001
- sourceIndexHash：sha256-index
- candidateRuleRefs：3
- requiredRuleRefs：2
- excludedRuleRefs：0
- globallyNotApplicableRuleRefs：1
- changedUnits：1
- candidates：1
- contextExpansions：1
- reviewItems：3
- reviewBatches：1
- 验证命令：`node skills/rules-review/scripts/validate.js --mode run --dir tests/rules-review/fixtures/run-fail-final-finding-mismatch`
- 验证摘要：protocolGate=passed，semanticVerdict=issues，findings=1，cannotVerify=0，recommendation=must_fix_before_merge

## 执行计划
- mode：single_batch
- selectedBy：ai
- policyVersion：review-execution-policy/v1
- metrics：changedUnits=1，candidates=1，targets=2，requiredRuleRefs=2，reviewItems=3
- userRequestedConcurrency：false
- reason：reviewItems/targets/rules are within single-batch default range.

## 问题
- F001 | RI001 | WRONG | WRONG：fake evidence

## 验证
- protocolGate：协议通过
- run：成功
