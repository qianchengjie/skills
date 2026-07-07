# rules-review：协议通过，未发现问题

## 结论
- 协议门禁：协议通过
- 审查结论：未发现问题
- 修复建议：可以合并
- 问题数：0
- 无法验证：0

## 范围
- 范围模式：完整范围
- 覆盖声明：协议覆盖完整
- 排除规则：无

## 审计
- runId：run-fail-single-with-multiple-batches
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
- reviewBatches：2
- 验证命令：`node skills/rules-review/scripts/validate.js --mode run --dir tests/rules-review/fixtures/run-fail-single-with-multiple-batches`
- 验证摘要：protocolGate=passed，semanticVerdict=clean，findings=0，cannotVerify=0，recommendation=ready_for_merge

## 执行计划
- mode：single_batch
- selectedBy：ai
- policyVersion：review-execution-policy/v1
- metrics：changedUnits=1，candidates=1，targets=2，requiredRuleRefs=2，reviewItems=3
- userRequestedConcurrency：false
- reason：错误地用 single_batch 搭配多个 batch。

## 问题
- 无

## 验证
- protocolGate：协议通过
- run：成功
