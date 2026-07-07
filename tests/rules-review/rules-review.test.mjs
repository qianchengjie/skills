import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const script = path.join(repoRoot, "skills/rules-review/scripts/validate.js");
const fixtures = path.join(repoRoot, "tests/rules-review/fixtures");

async function runValidate(args) {
  return execFileAsync(process.execPath, [script, ...args], { cwd: repoRoot });
}

async function assertRunPass(fixture, expectedGate) {
  const pass = await runValidate(["--mode", "run", "--dir", path.join(fixtures, fixture)]);
  const output = JSON.parse(pass.stdout);
  assert.equal(output.ok, true);
  assert.deepEqual(output.gate, expectedGate);
}

async function assertRunFails(fixture, pattern) {
  try {
    await runValidate(["--mode", "run", "--dir", path.join(fixtures, fixture)]);
  } catch (error) {
    const output = `${error.stdout}${error.stderr}`;
    assert.match(output, pattern);
    return;
  }
  assert.fail(`Expected fixture to fail: ${fixture}`);
}

async function assertRunDirFails(runDir, pattern) {
  try {
    await runValidate(["--mode", "run", "--dir", runDir]);
  } catch (error) {
    const output = `${error.stdout}${error.stderr}`;
    assert.match(output, pattern);
    return;
  }
  assert.fail(`Expected run dir to fail: ${runDir}`);
}

async function assertShardFails(fixture, pattern) {
  try {
    await runValidate([
      "--mode",
      "shard",
      "--task",
      path.join(fixtures, fixture, "tasks/B001.json"),
      "--input",
      path.join(fixtures, fixture, "shards/B001.json"),
    ]);
  } catch (error) {
    const output = `${error.stdout}${error.stderr}`;
    assert.match(output, pattern);
    return;
  }
  assert.fail(`Expected shard fixture to fail: ${fixture}`);
}

function assertNoStandalonePassedLabel(markdown) {
  assert.doesNotMatch(markdown, /协议门禁：通过/);
  assert.doesNotMatch(markdown, /protocolGate：通过/);
  assert.doesNotMatch(markdown, /`通过`/);
}

async function renderFinalReview(finalReview) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rules-review-final-"));
  const input = path.join(dir, "finalReview.json");
  const output = path.join(dir, "final.md");
  writeJson(input, finalReview);
  await runValidate(["--mode", "render-final", "--input", input, "--output", output]);
  return fs.readFileSync(output, "utf8");
}

async function renderFinalInDir(runDir) {
  await runValidate([
    "--mode",
    "render-final",
    "--input",
    path.join(runDir, "finalReview.json"),
    "--dispatch",
    path.join(runDir, "dispatch.json"),
    "--output",
    path.join(runDir, "final.md"),
  ]);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function issueSummary(overrides = {}) {
  return {
    findings: 0,
    mustFix: 0,
    shouldFix: 0,
    cannotVerify: 0,
    observations: 0,
    ...overrides,
  };
}

function runValidationResult(finalReview) {
  return {
    mode: "run",
    ok: finalReview.protocolGate === "passed",
    protocolGate: finalReview.protocolGate,
    semanticVerdict: finalReview.semanticVerdict,
    issueSummary: finalReview.issueSummary,
    recommendation: finalReview.recommendation,
  };
}

await assertRunPass("run-pass-full-clean", {
  protocolGate: "passed",
  scopeMode: "full",
  coverageClaim: "full_complete",
  semanticVerdict: "clean",
  issueSummary: issueSummary(),
  recommendation: "ready_for_merge",
});

await assertRunPass("run-pass-scoped-clean", {
  protocolGate: "passed",
  scopeMode: "scoped",
  coverageClaim: "scoped_complete",
  semanticVerdict: "clean",
  issueSummary: issueSummary(),
  recommendation: "ready_for_merge",
});

await assertRunPass("run-pass-finding-evidence-key-order", {
  protocolGate: "passed",
  scopeMode: "full",
  coverageClaim: "full_complete",
  semanticVerdict: "issues",
  issueSummary: issueSummary({ findings: 1, mustFix: 1 }),
  recommendation: "must_fix_before_merge",
});

await assertRunPass("run-pass-large-multi", {
  protocolGate: "passed",
  scopeMode: "full",
  coverageClaim: "full_complete",
  semanticVerdict: "clean",
  issueSummary: issueSummary(),
  recommendation: "ready_for_merge",
});

await assertRunPass("run-pass-human-override-single", {
  protocolGate: "passed",
  scopeMode: "full",
  coverageClaim: "full_complete",
  semanticVerdict: "clean",
  issueSummary: issueSummary(),
  recommendation: "ready_for_merge",
});

const response = await runValidate([
  "--mode",
  "render-response",
  "--dir",
  path.join(fixtures, "run-pass-scoped-clean"),
  "--output",
  "/tmp/rules-review-response-test.md",
]);
const responseOutput = JSON.parse(response.stdout);
assert.equal(responseOutput.ok, true);
assert.match(responseOutput.response, /rules-review：协议通过，未发现问题/);
assert.match(responseOutput.response, /协议门禁：协议通过/);
assertNoStandalonePassedLabel(responseOutput.response);

const cleanFinal = fs.readFileSync(path.join(fixtures, "run-pass-full-clean", "final.md"), "utf8");
assert.match(cleanFinal, /rules-review：协议通过，未发现问题/);
assert.match(cleanFinal, /修复建议：可以合并/);
assertNoStandalonePassedLabel(cleanFinal);

const findingFinal = fs.readFileSync(path.join(fixtures, "run-pass-finding-evidence-key-order", "final.md"), "utf8");
assert.match(findingFinal, /rules-review：协议通过，发现 1 项问题/);
assert.match(findingFinal, /修复建议：合并前必须修复/);
assertNoStandalonePassedLabel(findingFinal);

const cannotVerifyDir = fs.mkdtempSync(path.join(os.tmpdir(), "rules-review-cannot-verify-"));
fs.cpSync(path.join(fixtures, "run-pass-full-clean"), cannotVerifyDir, { recursive: true });
const cannotVerifyShardPath = path.join(cannotVerifyDir, "shards/B001.json");
const cannotVerifyShard = JSON.parse(fs.readFileSync(cannotVerifyShardPath, "utf8"));
cannotVerifyShard.results[0] = {
  reviewItemId: "RI001",
  status: "cannot_verify",
  reason: "Missing runnable test command",
};
fs.writeFileSync(cannotVerifyShardPath, `${JSON.stringify(cannotVerifyShard, null, 2)}\n`);
const cannotVerifyFinalReviewPath = path.join(cannotVerifyDir, "finalReview.json");
const cannotVerifyFinalReview = JSON.parse(fs.readFileSync(cannotVerifyFinalReviewPath, "utf8"));
cannotVerifyFinalReview.semanticVerdict = "unknown";
cannotVerifyFinalReview.issueSummary = issueSummary({ cannotVerify: 1 });
cannotVerifyFinalReview.recommendation = "manual_verification_required";
cannotVerifyFinalReview.cannotVerifyItems = [
  { reviewItemId: "RI001", ruleRef: "CORE-001", targetId: "T001", reason: "Missing runnable test command" },
];
cannotVerifyFinalReview.validationResults = [runValidationResult(cannotVerifyFinalReview)];
writeJson(cannotVerifyFinalReviewPath, cannotVerifyFinalReview);
await renderFinalInDir(cannotVerifyDir);
const cannotVerifyPass = await runValidate(["--mode", "run", "--dir", cannotVerifyDir]);
const cannotVerifyOutput = JSON.parse(cannotVerifyPass.stdout);
assert.deepEqual(cannotVerifyOutput.gate.issueSummary, issueSummary({ cannotVerify: 1 }));
assert.equal(cannotVerifyOutput.gate.recommendation, "manual_verification_required");
const cannotVerifyResponse = await runValidate(["--mode", "render-response", "--dir", cannotVerifyDir]);
const cannotVerifyResponseOutput = JSON.parse(cannotVerifyResponse.stdout);
assert.match(cannotVerifyResponseOutput.response, /1 项无法验证/);
assert.match(cannotVerifyResponseOutput.response, /修复建议：需要人工验证/);
assertNoStandalonePassedLabel(cannotVerifyResponseOutput.response);

const mixedDir = fs.mkdtempSync(path.join(os.tmpdir(), "rules-review-mixed-"));
fs.cpSync(path.join(fixtures, "run-pass-finding-evidence-key-order"), mixedDir, { recursive: true });
const mixedShardPath = path.join(mixedDir, "shards/B001.json");
const mixedShard = JSON.parse(fs.readFileSync(mixedShardPath, "utf8"));
mixedShard.results[1] = {
  reviewItemId: "RI002",
  status: "cannot_verify",
  reason: "Missing runnable test command",
};
fs.writeFileSync(mixedShardPath, `${JSON.stringify(mixedShard, null, 2)}\n`);
const mixedFinalReviewPath = path.join(mixedDir, "finalReview.json");
const mixedFinalReview = JSON.parse(fs.readFileSync(mixedFinalReviewPath, "utf8"));
mixedFinalReview.issueSummary = issueSummary({ findings: 1, mustFix: 1, cannotVerify: 1 });
mixedFinalReview.recommendation = "must_fix_before_merge";
mixedFinalReview.cannotVerifyItems = [
  { reviewItemId: "RI002", ruleRef: "TYPE-001", targetId: "T002", reason: "Missing runnable test command" },
];
mixedFinalReview.validationResults = [runValidationResult(mixedFinalReview)];
writeJson(mixedFinalReviewPath, mixedFinalReview);
await renderFinalInDir(mixedDir);
const mixedPass = await runValidate(["--mode", "run", "--dir", mixedDir]);
const mixedOutput = JSON.parse(mixedPass.stdout);
assert.deepEqual(mixedOutput.gate.issueSummary, issueSummary({ findings: 1, mustFix: 1, cannotVerify: 1 }));
assert.equal(mixedOutput.gate.recommendation, "must_fix_before_merge");
const mixedResponse = await runValidate(["--mode", "render-response", "--dir", mixedDir]);
const mixedResponseOutput = JSON.parse(mixedResponse.stdout);
assert.match(mixedResponseOutput.response, /发现 1 项问题，1 项无法验证/);
assert.match(mixedResponseOutput.response, /修复建议：合并前必须修复/);
assertNoStandalonePassedLabel(mixedResponseOutput.response);

const incompleteFinal = await renderFinalReview({
  kind: "rules-review-final-review",
  schemaVersion: 2,
  runId: "render-incomplete",
  protocolGate: "incomplete",
  scopeMode: "full",
  coverageClaim: "incomplete",
  semanticVerdict: "unknown",
  excludedRuleRefs: [],
  findings: [],
  observations: [],
  issueSummary: issueSummary(),
  recommendation: "review_incomplete",
  validationResults: [
    {
      mode: "run",
      ok: false,
      protocolGate: "incomplete",
      semanticVerdict: "unknown",
      issueSummary: issueSummary(),
      recommendation: "review_incomplete",
    },
  ],
});
assert.match(incompleteFinal, /rules-review：审查未完成，协议未闭合/);
assert.match(incompleteFinal, /协议门禁：协议未完成/);
assert.match(incompleteFinal, /修复建议：审查未完成/);

const blockedFinal = await renderFinalReview({
  kind: "rules-review-final-review",
  schemaVersion: 2,
  runId: "render-blocked",
  protocolGate: "blocked",
  scopeMode: "full",
  coverageClaim: "blocked",
  semanticVerdict: "unknown",
  excludedRuleRefs: [],
  findings: [],
  observations: [],
  issueSummary: issueSummary(),
  recommendation: "review_blocked",
  validationResults: [
    {
      mode: "run",
      ok: false,
      protocolGate: "blocked",
      semanticVerdict: "unknown",
      issueSummary: issueSummary(),
      recommendation: "review_blocked",
    },
  ],
});
assert.match(blockedFinal, /rules-review：审查阻塞，协议输入或结果不可用/);
assert.match(blockedFinal, /协议门禁：协议阻塞/);
assert.match(blockedFinal, /修复建议：审查阻塞/);

const emptyValidationDir = fs.mkdtempSync(path.join(os.tmpdir(), "rules-review-empty-validation-"));
fs.cpSync(path.join(fixtures, "run-pass-full-clean"), emptyValidationDir, { recursive: true });
const emptyValidationFinalReviewPath = path.join(emptyValidationDir, "finalReview.json");
const emptyValidationFinalReview = readJson(emptyValidationFinalReviewPath);
emptyValidationFinalReview.validationResults = [];
writeJson(emptyValidationFinalReviewPath, emptyValidationFinalReview);
await assertRunDirFails(emptyValidationDir, /validationResults must include validator run summary/);

const badCannotVerifyDir = fs.mkdtempSync(path.join(os.tmpdir(), "rules-review-bad-cannot-verify-"));
fs.cpSync(cannotVerifyDir, badCannotVerifyDir, { recursive: true });
const badCannotVerifyFinalReviewPath = path.join(badCannotVerifyDir, "finalReview.json");
const badCannotVerifyFinalReview = readJson(badCannotVerifyFinalReviewPath);
badCannotVerifyFinalReview.cannotVerifyItems[0].targetId = "WRONG";
writeJson(badCannotVerifyFinalReviewPath, badCannotVerifyFinalReview);
await assertRunDirFails(badCannotVerifyDir, /cannotVerifyItems must equal validator result/);

const missingRuleLevelDir = fs.mkdtempSync(path.join(os.tmpdir(), "rules-review-missing-rule-level-"));
fs.cpSync(path.join(fixtures, "run-pass-full-clean"), missingRuleLevelDir, { recursive: true });
const missingRuleLevelDispatchPath = path.join(missingRuleLevelDir, "dispatch.json");
const missingRuleLevelDispatch = readJson(missingRuleLevelDispatchPath);
delete missingRuleLevelDispatch.ruleSet.ruleSources[0].ruleLevel;
writeJson(missingRuleLevelDispatchPath, missingRuleLevelDispatch);
await assertRunDirFails(missingRuleLevelDir, /ruleSources\[\]\.ruleLevel must be valid|required field is missing/);

const missingTaskRuleLevelDir = fs.mkdtempSync(path.join(os.tmpdir(), "rules-review-missing-task-rule-level-"));
fs.cpSync(path.join(fixtures, "run-pass-full-clean"), missingTaskRuleLevelDir, { recursive: true });
const missingTaskRuleLevelTaskPath = path.join(missingTaskRuleLevelDir, "tasks/B001.json");
const missingTaskRuleLevelTask = readJson(missingTaskRuleLevelTaskPath);
delete missingTaskRuleLevelTask.rules[0].ruleLevel;
writeJson(missingTaskRuleLevelTaskPath, missingTaskRuleLevelTask);
await assertRunDirFails(missingTaskRuleLevelDir, /task ruleLevel must be valid|required field is missing/);

const shouldFixDir = fs.mkdtempSync(path.join(os.tmpdir(), "rules-review-should-fix-"));
fs.cpSync(path.join(fixtures, "run-pass-full-clean"), shouldFixDir, { recursive: true });
const shouldFixShardPath = path.join(shouldFixDir, "shards/B001.json");
const shouldFixShard = readJson(shouldFixShardPath);
const shouldFixEvidence = [{ loc: "src/example.ts:12", summary: "TYPE-001 should finding" }];
shouldFixShard.results[1] = {
  reviewItemId: "RI002",
  status: "finding",
  findingId: "F001",
  origin: "introduced_by_change",
  evidence: shouldFixEvidence,
};
writeJson(shouldFixShardPath, shouldFixShard);
const shouldFixFinalReviewPath = path.join(shouldFixDir, "finalReview.json");
const shouldFixFinalReview = readJson(shouldFixFinalReviewPath);
shouldFixFinalReview.semanticVerdict = "issues";
shouldFixFinalReview.findings = [
  {
    findingId: "F001",
    reviewItemId: "RI002",
    ruleRef: "TYPE-001",
    targetId: "T002",
    ruleLevel: "SHOULD",
    origin: "introduced_by_change",
    priority: "should_fix",
    evidence: shouldFixEvidence,
  },
];
shouldFixFinalReview.issueSummary = issueSummary({ findings: 1, shouldFix: 1 });
shouldFixFinalReview.recommendation = "should_review_before_merge";
shouldFixFinalReview.validationResults = [runValidationResult(shouldFixFinalReview)];
writeJson(shouldFixFinalReviewPath, shouldFixFinalReview);
await renderFinalInDir(shouldFixDir);
const shouldFixPass = await runValidate(["--mode", "run", "--dir", shouldFixDir]);
const shouldFixOutput = JSON.parse(shouldFixPass.stdout);
assert.deepEqual(shouldFixOutput.gate.issueSummary, issueSummary({ findings: 1, shouldFix: 1 }));
assert.equal(shouldFixOutput.gate.recommendation, "should_review_before_merge");

const shouldPriorityOverrideDir = fs.mkdtempSync(path.join(os.tmpdir(), "rules-review-should-priority-override-"));
fs.cpSync(shouldFixDir, shouldPriorityOverrideDir, { recursive: true });
const shouldPriorityOverrideShardPath = path.join(shouldPriorityOverrideDir, "shards/B001.json");
const shouldPriorityOverrideShard = readJson(shouldPriorityOverrideShardPath);
shouldPriorityOverrideShard.results[1].priority = "must_fix";
writeJson(shouldPriorityOverrideShardPath, shouldPriorityOverrideShard);
const shouldPriorityOverrideFinalReviewPath = path.join(shouldPriorityOverrideDir, "finalReview.json");
const shouldPriorityOverrideFinalReview = readJson(shouldPriorityOverrideFinalReviewPath);
shouldPriorityOverrideFinalReview.findings[0].priority = "must_fix";
shouldPriorityOverrideFinalReview.issueSummary = issueSummary({ findings: 1, mustFix: 1 });
shouldPriorityOverrideFinalReview.recommendation = "must_fix_before_merge";
shouldPriorityOverrideFinalReview.validationResults = [runValidationResult(shouldPriorityOverrideFinalReview)];
writeJson(shouldPriorityOverrideFinalReviewPath, shouldPriorityOverrideFinalReview);
await assertRunDirFails(shouldPriorityOverrideDir, /priority override requires priorityReason/);

const advisoryObservationDir = fs.mkdtempSync(path.join(os.tmpdir(), "rules-review-advisory-observation-"));
fs.cpSync(path.join(fixtures, "run-pass-full-clean"), advisoryObservationDir, { recursive: true });
const advisoryObservationShardPath = path.join(advisoryObservationDir, "shards/B001.json");
const advisoryObservationShard = readJson(advisoryObservationShardPath);
advisoryObservationShard.results[2] = {
  reviewItemId: "RI003",
  status: "observation",
  origin: "introduced_by_change",
  reason: "ADVISORY rule recorded for human awareness.",
};
writeJson(advisoryObservationShardPath, advisoryObservationShard);
const advisoryObservationFinalReviewPath = path.join(advisoryObservationDir, "finalReview.json");
const advisoryObservationFinalReview = readJson(advisoryObservationFinalReviewPath);
advisoryObservationFinalReview.observations = [
  {
    reviewItemId: "RI003",
    ruleRef: "UI-001",
    targetId: "T002",
    ruleLevel: "ADVISORY",
    origin: "introduced_by_change",
    reason: "ADVISORY rule recorded for human awareness.",
  },
];
advisoryObservationFinalReview.issueSummary = issueSummary({ observations: 1 });
advisoryObservationFinalReview.validationResults = [runValidationResult(advisoryObservationFinalReview)];
writeJson(advisoryObservationFinalReviewPath, advisoryObservationFinalReview);
await renderFinalInDir(advisoryObservationDir);
const advisoryObservationPass = await runValidate(["--mode", "run", "--dir", advisoryObservationDir]);
const advisoryObservationOutput = JSON.parse(advisoryObservationPass.stdout);
assert.deepEqual(advisoryObservationOutput.gate.issueSummary, issueSummary({ observations: 1 }));
assert.equal(advisoryObservationOutput.gate.recommendation, "ready_for_merge");

const advisoryUpgradeDir = fs.mkdtempSync(path.join(os.tmpdir(), "rules-review-advisory-upgrade-"));
fs.cpSync(advisoryObservationDir, advisoryUpgradeDir, { recursive: true });
const advisoryUpgradeShardPath = path.join(advisoryUpgradeDir, "shards/B001.json");
const advisoryUpgradeShard = readJson(advisoryUpgradeShardPath);
const advisoryEvidence = [{ loc: "src/example.ts:12", summary: "UI-001 advisory upgraded evidence" }];
advisoryUpgradeShard.results[2] = {
  reviewItemId: "RI003",
  status: "finding",
  findingId: "F001",
  origin: "introduced_by_change",
  evidence: advisoryEvidence,
};
writeJson(advisoryUpgradeShardPath, advisoryUpgradeShard);
const advisoryUpgradeFinalReviewPath = path.join(advisoryUpgradeDir, "finalReview.json");
const advisoryUpgradeFinalReview = readJson(advisoryUpgradeFinalReviewPath);
advisoryUpgradeFinalReview.semanticVerdict = "issues";
advisoryUpgradeFinalReview.findings = [
  {
    findingId: "F001",
    reviewItemId: "RI003",
    ruleRef: "UI-001",
    targetId: "T002",
    ruleLevel: "ADVISORY",
    origin: "introduced_by_change",
    priority: "should_fix",
    evidence: advisoryEvidence,
  },
];
advisoryUpgradeFinalReview.observations = [];
advisoryUpgradeFinalReview.issueSummary = issueSummary({ findings: 1, shouldFix: 1 });
advisoryUpgradeFinalReview.recommendation = "should_review_before_merge";
advisoryUpgradeFinalReview.validationResults = [runValidationResult(advisoryUpgradeFinalReview)];
writeJson(advisoryUpgradeFinalReviewPath, advisoryUpgradeFinalReview);
await assertRunDirFails(advisoryUpgradeDir, /upgraded finding requires upgradeReason/);

const exposedObservationDir = fs.mkdtempSync(path.join(os.tmpdir(), "rules-review-exposed-observation-"));
fs.cpSync(path.join(fixtures, "run-pass-full-clean"), exposedObservationDir, { recursive: true });
const exposedObservationShardPath = path.join(exposedObservationDir, "shards/B001.json");
const exposedObservationShard = readJson(exposedObservationShardPath);
exposedObservationShard.results[1] = {
  reviewItemId: "RI002",
  status: "observation",
  origin: "exposed_by_change",
  reason: "Existing TYPE-001 concern exposed by this change.",
};
writeJson(exposedObservationShardPath, exposedObservationShard);
const exposedObservationFinalReviewPath = path.join(exposedObservationDir, "finalReview.json");
const exposedObservationFinalReview = readJson(exposedObservationFinalReviewPath);
exposedObservationFinalReview.observations = [
  {
    reviewItemId: "RI002",
    ruleRef: "TYPE-001",
    targetId: "T002",
    ruleLevel: "SHOULD",
    origin: "exposed_by_change",
    reason: "Existing TYPE-001 concern exposed by this change.",
  },
];
exposedObservationFinalReview.issueSummary = issueSummary({ observations: 1 });
exposedObservationFinalReview.validationResults = [runValidationResult(exposedObservationFinalReview)];
writeJson(exposedObservationFinalReviewPath, exposedObservationFinalReview);
await renderFinalInDir(exposedObservationDir);
const exposedObservationPass = await runValidate(["--mode", "run", "--dir", exposedObservationDir]);
const exposedObservationOutput = JSON.parse(exposedObservationPass.stdout);
assert.deepEqual(exposedObservationOutput.gate.issueSummary, issueSummary({ observations: 1 }));
assert.equal(exposedObservationOutput.gate.recommendation, "ready_for_merge");

const preExistingUpgradeDir = fs.mkdtempSync(path.join(os.tmpdir(), "rules-review-pre-existing-upgrade-"));
fs.cpSync(exposedObservationDir, preExistingUpgradeDir, { recursive: true });
const preExistingUpgradeShardPath = path.join(preExistingUpgradeDir, "shards/B001.json");
const preExistingUpgradeShard = readJson(preExistingUpgradeShardPath);
preExistingUpgradeShard.results[1] = {
  reviewItemId: "RI002",
  status: "finding",
  findingId: "F001",
  origin: "pre_existing",
  evidence: shouldFixEvidence,
};
writeJson(preExistingUpgradeShardPath, preExistingUpgradeShard);
const preExistingUpgradeFinalReviewPath = path.join(preExistingUpgradeDir, "finalReview.json");
const preExistingUpgradeFinalReview = readJson(preExistingUpgradeFinalReviewPath);
preExistingUpgradeFinalReview.semanticVerdict = "issues";
preExistingUpgradeFinalReview.findings = [
  {
    findingId: "F001",
    reviewItemId: "RI002",
    ruleRef: "TYPE-001",
    targetId: "T002",
    ruleLevel: "SHOULD",
    origin: "pre_existing",
    priority: "should_fix",
    evidence: shouldFixEvidence,
  },
];
preExistingUpgradeFinalReview.observations = [];
preExistingUpgradeFinalReview.issueSummary = issueSummary({ findings: 1, shouldFix: 1 });
preExistingUpgradeFinalReview.recommendation = "should_review_before_merge";
preExistingUpgradeFinalReview.validationResults = [runValidationResult(preExistingUpgradeFinalReview)];
writeJson(preExistingUpgradeFinalReviewPath, preExistingUpgradeFinalReview);
await assertRunDirFails(preExistingUpgradeDir, /upgraded finding requires upgradeReason/);
await assertRunDirFails(preExistingUpgradeDir, /pre_existing finding upgrade requires originReason/);

const mustDowngradeDir = fs.mkdtempSync(path.join(os.tmpdir(), "rules-review-must-downgrade-"));
fs.cpSync(path.join(fixtures, "run-pass-full-clean"), mustDowngradeDir, { recursive: true });
const mustDowngradeShardPath = path.join(mustDowngradeDir, "shards/B001.json");
const mustDowngradeShard = readJson(mustDowngradeShardPath);
const mustDowngradeEvidence = [{ loc: "src/example.ts:10", summary: "CORE-001 accepted risk evidence" }];
const acceptedRisk = {
  status: "accepted",
  acceptedBy: "human",
  scope: "RI001",
  reason: "Project owner accepted the risk for this review item.",
  followUp: "Track in the owning project backlog.",
};
mustDowngradeShard.results[0] = {
  reviewItemId: "RI001",
  status: "finding",
  findingId: "F001",
  origin: "introduced_by_change",
  priority: "should_fix",
  acceptedRisk,
  evidence: mustDowngradeEvidence,
};
writeJson(mustDowngradeShardPath, mustDowngradeShard);
const mustDowngradeFinalReviewPath = path.join(mustDowngradeDir, "finalReview.json");
const mustDowngradeFinalReview = readJson(mustDowngradeFinalReviewPath);
mustDowngradeFinalReview.semanticVerdict = "issues";
mustDowngradeFinalReview.findings = [
  {
    findingId: "F001",
    reviewItemId: "RI001",
    ruleRef: "CORE-001",
    targetId: "T001",
    ruleLevel: "MUST",
    origin: "introduced_by_change",
    priority: "should_fix",
    acceptedRisk,
    evidence: mustDowngradeEvidence,
  },
];
mustDowngradeFinalReview.issueSummary = issueSummary({ findings: 1, shouldFix: 1 });
mustDowngradeFinalReview.recommendation = "should_review_before_merge";
mustDowngradeFinalReview.validationResults = [runValidationResult(mustDowngradeFinalReview)];
writeJson(mustDowngradeFinalReviewPath, mustDowngradeFinalReview);
await renderFinalInDir(mustDowngradeDir);
const mustDowngradePass = await runValidate(["--mode", "run", "--dir", mustDowngradeDir]);
const mustDowngradeOutput = JSON.parse(mustDowngradePass.stdout);
assert.deepEqual(mustDowngradeOutput.gate.issueSummary, issueSummary({ findings: 1, shouldFix: 1 }));
assert.equal(mustDowngradeOutput.gate.recommendation, "should_review_before_merge");

const mustDowngradeNoRiskDir = fs.mkdtempSync(path.join(os.tmpdir(), "rules-review-must-downgrade-no-risk-"));
fs.cpSync(mustDowngradeDir, mustDowngradeNoRiskDir, { recursive: true });
const mustDowngradeNoRiskShardPath = path.join(mustDowngradeNoRiskDir, "shards/B001.json");
const mustDowngradeNoRiskShard = readJson(mustDowngradeNoRiskShardPath);
delete mustDowngradeNoRiskShard.results[0].acceptedRisk;
writeJson(mustDowngradeNoRiskShardPath, mustDowngradeNoRiskShard);
const mustDowngradeNoRiskFinalReviewPath = path.join(mustDowngradeNoRiskDir, "finalReview.json");
const mustDowngradeNoRiskFinalReview = readJson(mustDowngradeNoRiskFinalReviewPath);
delete mustDowngradeNoRiskFinalReview.findings[0].acceptedRisk;
mustDowngradeNoRiskFinalReview.validationResults = [runValidationResult(mustDowngradeNoRiskFinalReview)];
writeJson(mustDowngradeNoRiskFinalReviewPath, mustDowngradeNoRiskFinalReview);
await assertRunDirFails(mustDowngradeNoRiskDir, /acceptedRisk must be object for MUST downgrade/);

const shouldAndCannotVerifyDir = fs.mkdtempSync(path.join(os.tmpdir(), "rules-review-should-and-cannot-"));
fs.cpSync(shouldFixDir, shouldAndCannotVerifyDir, { recursive: true });
const shouldAndCannotVerifyShardPath = path.join(shouldAndCannotVerifyDir, "shards/B001.json");
const shouldAndCannotVerifyShard = readJson(shouldAndCannotVerifyShardPath);
shouldAndCannotVerifyShard.results[0] = {
  reviewItemId: "RI001",
  status: "cannot_verify",
  reason: "Missing runnable test command",
};
writeJson(shouldAndCannotVerifyShardPath, shouldAndCannotVerifyShard);
const shouldAndCannotVerifyFinalReviewPath = path.join(shouldAndCannotVerifyDir, "finalReview.json");
const shouldAndCannotVerifyFinalReview = readJson(shouldAndCannotVerifyFinalReviewPath);
shouldAndCannotVerifyFinalReview.cannotVerifyItems = [
  { reviewItemId: "RI001", ruleRef: "CORE-001", targetId: "T001", reason: "Missing runnable test command" },
];
shouldAndCannotVerifyFinalReview.issueSummary = issueSummary({ findings: 1, shouldFix: 1, cannotVerify: 1 });
shouldAndCannotVerifyFinalReview.recommendation = "manual_verification_required";
shouldAndCannotVerifyFinalReview.validationResults = [runValidationResult(shouldAndCannotVerifyFinalReview)];
writeJson(shouldAndCannotVerifyFinalReviewPath, shouldAndCannotVerifyFinalReview);
await renderFinalInDir(shouldAndCannotVerifyDir);
const shouldAndCannotVerifyPass = await runValidate(["--mode", "run", "--dir", shouldAndCannotVerifyDir]);
const shouldAndCannotVerifyOutput = JSON.parse(shouldAndCannotVerifyPass.stdout);
assert.deepEqual(shouldAndCannotVerifyOutput.gate.issueSummary, issueSummary({ findings: 1, shouldFix: 1, cannotVerify: 1 }));
assert.equal(shouldAndCannotVerifyOutput.gate.recommendation, "manual_verification_required");

const finalPriorityTamperDir = fs.mkdtempSync(path.join(os.tmpdir(), "rules-review-final-priority-tamper-"));
fs.cpSync(shouldFixDir, finalPriorityTamperDir, { recursive: true });
const finalPriorityTamperFinalReviewPath = path.join(finalPriorityTamperDir, "finalReview.json");
const finalPriorityTamperFinalReview = readJson(finalPriorityTamperFinalReviewPath);
finalPriorityTamperFinalReview.findings[0].priority = "must_fix";
writeJson(finalPriorityTamperFinalReviewPath, finalPriorityTamperFinalReview);
await assertRunDirFails(finalPriorityTamperDir, /finalReview findings must equal validator result/);

const finalRuleLevelTamperDir = fs.mkdtempSync(path.join(os.tmpdir(), "rules-review-final-rule-level-tamper-"));
fs.cpSync(shouldFixDir, finalRuleLevelTamperDir, { recursive: true });
const finalRuleLevelTamperFinalReviewPath = path.join(finalRuleLevelTamperDir, "finalReview.json");
const finalRuleLevelTamperFinalReview = readJson(finalRuleLevelTamperFinalReviewPath);
finalRuleLevelTamperFinalReview.findings[0].ruleLevel = "MUST";
writeJson(finalRuleLevelTamperFinalReviewPath, finalRuleLevelTamperFinalReview);
await assertRunDirFails(finalRuleLevelTamperDir, /finalReview findings must equal validator result/);

const finalOriginTamperDir = fs.mkdtempSync(path.join(os.tmpdir(), "rules-review-final-origin-tamper-"));
fs.cpSync(shouldFixDir, finalOriginTamperDir, { recursive: true });
const finalOriginTamperFinalReviewPath = path.join(finalOriginTamperDir, "finalReview.json");
const finalOriginTamperFinalReview = readJson(finalOriginTamperFinalReviewPath);
finalOriginTamperFinalReview.findings[0].origin = "worsened_by_change";
writeJson(finalOriginTamperFinalReviewPath, finalOriginTamperFinalReview);
await assertRunDirFails(finalOriginTamperDir, /finalReview findings must equal validator result/);

const finalObservationTamperDir = fs.mkdtempSync(path.join(os.tmpdir(), "rules-review-final-observation-tamper-"));
fs.cpSync(advisoryObservationDir, finalObservationTamperDir, { recursive: true });
const finalObservationTamperFinalReviewPath = path.join(finalObservationTamperDir, "finalReview.json");
const finalObservationTamperFinalReview = readJson(finalObservationTamperFinalReviewPath);
finalObservationTamperFinalReview.observations[0].origin = "pre_existing";
writeJson(finalObservationTamperFinalReviewPath, finalObservationTamperFinalReview);
await assertRunDirFails(finalObservationTamperDir, /finalReview observations must equal validator result/);

await assertRunFails("run-fail-missing-result", /required reviewItem must have exactly one result/);
await assertRunFails("run-fail-unassigned-result", /result must reference assigned reviewItemId/);
await assertRunFails("run-fail-duplicate-result", /reviewItem has duplicate results/);
await assertRunFails("run-fail-finding-no-evidence", /finding result requires findingId and evidence/);
await assertRunFails("run-fail-finding-no-evidence", /incomplete or blocked semanticVerdict must be unknown/);
await assertRunFails("run-fail-passed-no-evidence", /passed result requires evidence/);
await assertRunFails("run-fail-not-applicable-no-reason", /not_applicable result requires reason/);
await assertRunFails("run-fail-cannot-verify-no-proof", /cannot_verify result requires reason or evidence/);
await assertRunFails("run-fail-missing-source-hash", /sourceHash is required/);
await assertRunFails("run-fail-unclassified-candidate", /candidateRuleRef must be classified as required, excluded, or globallyNotApplicable/);
await assertRunFails("run-fail-large-single-no-override", /hard execution policy requires multi_batch/);
await assertRunFails("run-fail-concurrency-single-no-override", /hard execution policy requires multi_batch/);
await assertRunFails("run-fail-single-with-multiple-batches", /single_batch executionPlan requires exactly one reviewBatch/);
await assertRunFails("run-fail-multi-with-one-batch", /multi_batch executionPlan requires at least two reviewBatches/);
await assertRunFails("run-fail-metric-reviewItems-mismatch", /executionPlan metric must match dispatch facts/);
await assertRunFails("run-fail-reviewItem-unassigned", /reviewItem must be assigned to one reviewBatch/);
await assertRunFails("run-fail-reviewItem-duplicated", /reviewItemId must not be assigned to multiple reviewBatches/);
await assertRunFails("run-fail-human-override-no-risk", /humanOverride.risk must be non-empty string/);
await assertRunFails("run-fail-human-override-mode-mismatch", /humanOverride\.requestedMode must match executionPlan\.mode/);
await assertRunFails("run-fail-scoped-no-excluded", /scoped scopeMode requires excludedRuleRefs/);
await assertRunFails("run-fail-bad-context-expansion", /contextExpansions\[\]\.addedTargetIds\[\] must exist in targets\.candidates\[\]/);
await assertRunFails("run-fail-bad-review-target", /reviewItem targetId must exist/);
await assertRunFails("run-fail-thin-review-target", /reviewItem target must include summary and loc or source/);
await assertRunFails("run-fail-task-missing-target", /task\.targets\[\] must include each task reviewItem targetId/);
await assertRunFails("run-fail-required-rule-no-item", /requiredRuleRef must generate at least one required reviewItem/);
await assertShardFails("run-fail-shard-missing-assigned-result", /shard results must cover every task reviewItem/);
await assertRunFails("run-fail-duplicate-batch-assignment", /reviewItemId must not be assigned to multiple reviewBatches/);
await assertRunFails("run-fail-missing-rule-body", /rule source requires summary or ruleText/);
await assertRunFails("run-fail-empty-evidence-item", /passed result requires evidence/);
await assertRunFails("run-fail-final-finding-mismatch", /finalReview findings must equal validator result/);
await assertRunFails("run-fail-extra-final-finding", /finalReview findings must include every derived finding and no extras/);
await assertRunFails("run-fail-format-invalid-blocked", /"protocolGate": "blocked"/);
await assertRunFails("run-fail-untrusted-blocked", /"protocolGate": "blocked"/);
await assertRunFails("run-fail-returned-not-aggregated-blocked", /"protocolGate": "blocked"/);

console.log("rules-review tests passed");
