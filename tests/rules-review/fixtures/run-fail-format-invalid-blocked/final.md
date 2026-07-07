# rules-review：审查阻塞，协议输入或结果不可用

## 结论
- 协议门禁：协议阻塞
- 审查结论：审查阻塞
- 修复建议：审查阻塞
- 问题数：0
- 无法验证：0

## 范围
- 范围模式：完整范围
- 覆盖声明：阻塞
- 排除规则：无

## 审计
- runId：run-fail-format-invalid-blocked
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
- 验证命令：`node skills/rules-review/scripts/validate.js --mode run --dir tests/rules-review/fixtures/run-fail-format-invalid-blocked`
- 验证摘要：protocolGate=blocked，semanticVerdict=unknown，findings=0，cannotVerify=0，recommendation=review_blocked

## 执行计划
- mode：single_batch
- selectedBy：ai
- policyVersion：review-execution-policy/v1
- metrics：changedUnits=1，candidates=1，targets=2，requiredRuleRefs=2，reviewItems=3
- userRequestedConcurrency：false
- reason：reviewItems/targets/rules are within single-batch default range.

## 问题
- 无

## 验证
- protocolGate：协议阻塞
- run：失败
