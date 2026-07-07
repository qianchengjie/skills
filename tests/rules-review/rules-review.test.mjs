import assert from "node:assert/strict";
import { execFile } from "node:child_process";
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

await assertRunPass("run-pass-full-clean", {
  protocolGate: "passed",
  scopeMode: "full",
  coverageClaim: "full_complete",
  semanticVerdict: "clean",
});

await assertRunPass("run-pass-scoped-clean", {
  protocolGate: "passed",
  scopeMode: "scoped",
  coverageClaim: "scoped_complete",
  semanticVerdict: "clean",
});

await assertRunPass("run-pass-finding-evidence-key-order", {
  protocolGate: "passed",
  scopeMode: "full",
  coverageClaim: "full_complete",
  semanticVerdict: "issues",
});

await assertRunPass("run-pass-large-multi", {
  protocolGate: "passed",
  scopeMode: "full",
  coverageClaim: "full_complete",
  semanticVerdict: "clean",
});

await assertRunPass("run-pass-human-override-single", {
  protocolGate: "passed",
  scopeMode: "full",
  coverageClaim: "full_complete",
  semanticVerdict: "clean",
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
assert.match(responseOutput.response, /限定范围完成/);

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
