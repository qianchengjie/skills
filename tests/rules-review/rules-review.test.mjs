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
  fs.writeFileSync(input, `${JSON.stringify(finalReview, null, 2)}\n`);
  await runValidate(["--mode", "render-final", "--input", input, "--output", output]);
  return fs.readFileSync(output, "utf8");
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
  issueSummary: { findings: 0, cannotVerify: 0 },
  recommendation: "ready_for_merge",
});

await assertRunPass("run-pass-scoped-clean", {
  protocolGate: "passed",
  scopeMode: "scoped",
  coverageClaim: "scoped_complete",
  semanticVerdict: "clean",
  issueSummary: { findings: 0, cannotVerify: 0 },
  recommendation: "ready_for_merge",
});

await assertRunPass("run-pass-finding-evidence-key-order", {
  protocolGate: "passed",
  scopeMode: "full",
  coverageClaim: "full_complete",
  semanticVerdict: "issues",
  issueSummary: { findings: 1, cannotVerify: 0 },
  recommendation: "must_fix_before_merge",
});

await assertRunPass("run-pass-large-multi", {
  protocolGate: "passed",
  scopeMode: "full",
  coverageClaim: "full_complete",
  semanticVerdict: "clean",
  issueSummary: { findings: 0, cannotVerify: 0 },
  recommendation: "ready_for_merge",
});

await assertRunPass("run-pass-human-override-single", {
  protocolGate: "passed",
  scopeMode: "full",
  coverageClaim: "full_complete",
  semanticVerdict: "clean",
  issueSummary: { findings: 0, cannotVerify: 0 },
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
cannotVerifyFinalReview.issueSummary = { findings: 0, cannotVerify: 1 };
cannotVerifyFinalReview.recommendation = "manual_verification_required";
cannotVerifyFinalReview.cannotVerifyItems = [
  { reviewItemId: "RI001", ruleRef: "CORE-001", targetId: "T001", reason: "Missing runnable test command" },
];
cannotVerifyFinalReview.validationResults = [runValidationResult(cannotVerifyFinalReview)];
fs.writeFileSync(cannotVerifyFinalReviewPath, `${JSON.stringify(cannotVerifyFinalReview, null, 2)}\n`);
await runValidate([
  "--mode",
  "render-final",
  "--input",
  cannotVerifyFinalReviewPath,
  "--dispatch",
  path.join(cannotVerifyDir, "dispatch.json"),
  "--output",
  path.join(cannotVerifyDir, "final.md"),
]);
const cannotVerifyPass = await runValidate(["--mode", "run", "--dir", cannotVerifyDir]);
const cannotVerifyOutput = JSON.parse(cannotVerifyPass.stdout);
assert.deepEqual(cannotVerifyOutput.gate.issueSummary, { findings: 0, cannotVerify: 1 });
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
mixedFinalReview.issueSummary = { findings: 1, cannotVerify: 1 };
mixedFinalReview.recommendation = "must_fix_before_merge";
mixedFinalReview.cannotVerifyItems = [
  { reviewItemId: "RI002", ruleRef: "TYPE-001", targetId: "T002", reason: "Missing runnable test command" },
];
mixedFinalReview.validationResults = [runValidationResult(mixedFinalReview)];
fs.writeFileSync(mixedFinalReviewPath, `${JSON.stringify(mixedFinalReview, null, 2)}\n`);
await runValidate([
  "--mode",
  "render-final",
  "--input",
  mixedFinalReviewPath,
  "--dispatch",
  path.join(mixedDir, "dispatch.json"),
  "--output",
  path.join(mixedDir, "final.md"),
]);
const mixedPass = await runValidate(["--mode", "run", "--dir", mixedDir]);
const mixedOutput = JSON.parse(mixedPass.stdout);
assert.deepEqual(mixedOutput.gate.issueSummary, { findings: 1, cannotVerify: 1 });
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
  issueSummary: { findings: 0, cannotVerify: 0 },
  recommendation: "review_incomplete",
  validationResults: [
    {
      mode: "run",
      ok: false,
      protocolGate: "incomplete",
      semanticVerdict: "unknown",
      issueSummary: { findings: 0, cannotVerify: 0 },
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
  issueSummary: { findings: 0, cannotVerify: 0 },
  recommendation: "review_blocked",
  validationResults: [
    {
      mode: "run",
      ok: false,
      protocolGate: "blocked",
      semanticVerdict: "unknown",
      issueSummary: { findings: 0, cannotVerify: 0 },
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
const emptyValidationFinalReview = JSON.parse(fs.readFileSync(emptyValidationFinalReviewPath, "utf8"));
emptyValidationFinalReview.validationResults = [];
fs.writeFileSync(emptyValidationFinalReviewPath, `${JSON.stringify(emptyValidationFinalReview, null, 2)}\n`);
await assertRunDirFails(emptyValidationDir, /validationResults must include validator run summary/);

const badCannotVerifyDir = fs.mkdtempSync(path.join(os.tmpdir(), "rules-review-bad-cannot-verify-"));
fs.cpSync(cannotVerifyDir, badCannotVerifyDir, { recursive: true });
const badCannotVerifyFinalReviewPath = path.join(badCannotVerifyDir, "finalReview.json");
const badCannotVerifyFinalReview = JSON.parse(fs.readFileSync(badCannotVerifyFinalReviewPath, "utf8"));
badCannotVerifyFinalReview.cannotVerifyItems[0].targetId = "WRONG";
fs.writeFileSync(badCannotVerifyFinalReviewPath, `${JSON.stringify(badCannotVerifyFinalReview, null, 2)}\n`);
await assertRunDirFails(badCannotVerifyDir, /cannotVerifyItems must equal validator result/);

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
await assertRunFails("run-fail-final-finding-mismatch", /final finding ruleRef must match dispatch reviewItem/);
await assertRunFails("run-fail-extra-final-finding", /finalReview finding must come from shard finding result/);
await assertRunFails("run-fail-format-invalid-blocked", /"protocolGate": "blocked"/);
await assertRunFails("run-fail-untrusted-blocked", /"protocolGate": "blocked"/);
await assertRunFails("run-fail-returned-not-aggregated-blocked", /"protocolGate": "blocked"/);

console.log("rules-review tests passed");
