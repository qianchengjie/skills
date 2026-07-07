# rules-review：审查阻塞，协议输入或结果不可用

## 结论
- 协议门禁：协议阻塞
- 审查结论：审查阻塞
- 修复建议：审查阻塞
- 问题数：0
- 必须修复：0
- 建议修复：0
- 无法验证：0
- 观察项：0

## 范围
- 范围模式：完整范围
- 覆盖声明：阻塞
- 排除规则：无

## 审计
- runId：run-fail-returned-not-aggregated-blocked
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
- 验证命令：`node skills/rules-review/scripts/validate.js --mode run --dir tests/rules-review/fixtures/run-fail-returned-not-aggregated-blocked`
- 验证摘要：protocolGate=blocked，semanticVerdict=unknown，findings=0，mustFix=0，shouldFix=0，cannotVerify=0，observations=0，recommendation=review_blocked

## 执行计划
- 未记录

## 问题
- 无

## 验证
- protocolGate：协议阻塞
- run：失败
