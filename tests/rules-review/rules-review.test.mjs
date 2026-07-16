import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import crypto from "node:crypto";
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

async function assertValidateFails(args, pattern) {
  try {
    await runValidate(args);
  } catch (error) {
    assert.match(`${error.stdout}${error.stderr}`, pattern);
    return;
  }
  assert.fail(`Expected validator command to fail: ${args.join(" ")}`);
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

function assertNextSection(markdown, current, next) {
  const start = markdown.indexOf(current);
  assert.notEqual(start, -1);
  const nextStart = markdown.indexOf("\n## ", start + current.length);
  assert.notEqual(nextStart, -1);
  assert.equal(markdown.slice(nextStart + 1, nextStart + 1 + next.length), next);
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

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function hashBytes(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function createV3RunFixture({ changedFiles, inputRefs = ["src/example.js", "src/deleted.js"], noBatch = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rules-review-v3-"));
  const runDir = path.join(root, ".rules-review-tmp", "run");
  fs.mkdirSync(path.dirname(runDir), { recursive: true });
  fs.cpSync(path.join(fixtures, "run-pass-full-clean"), runDir, { recursive: true });
  fs.mkdirSync(path.join(root, ".agents", "rules"), { recursive: true });
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, ".agents", "rules", "index.md"), "# Rules\n\n- CORE-001\n");
  fs.writeFileSync(path.join(root, ".agents", "rules", "core.md"), "# CORE-001\n\nCurrent rule bytes.\n");
  fs.writeFileSync(path.join(root, "src", "example.js"), "before\r\n");
  fs.writeFileSync(path.join(root, "src", "deleted.js"), "deleted before seal\n");

  const dispatchPath = path.join(runDir, "dispatch.json");
  const dispatch = readJson(dispatchPath);
  dispatch.schemaVersion = 3;
  if (changedFiles !== undefined) dispatch.changedFiles = changedFiles;
  dispatch.inputSnapshot = {
    files: [{ inputRef: "src/example.js", state: "present", contentHash: `sha256:${"0".repeat(64)}` }],
  };
  dispatch.ruleSet.sourceIndexHash = `sha256:${"0".repeat(64)}`;
  dispatch.ruleSet.ruleSources.forEach((source) => {
    source.sourceFile = ".agents/rules/core.md";
    source.sourceHash = `sha256:${"0".repeat(64)}`;
  });
  [...dispatch.targets.changedUnits, ...dispatch.targets.candidates].forEach((target) => {
    target.inputRefs = inputRefs;
    target.contentHash = `sha256:${"f".repeat(64)}`;
  });
  if (noBatch) {
    Object.assign(dispatch.ruleSet, {
      candidateRuleRefs: [],
      selectedRuleRefs: [],
      requiredRuleRefs: [],
      excludedRuleRefs: [],
      globallyNotApplicableRuleRefs: [],
      ruleSources: [],
    });
    dispatch.applicabilityMatrix = [];
    dispatch.reviewItems = [];
    dispatch.executionPlan = {
      mode: "no_batch",
      selectedBy: "ai",
      policyVersion: "review-execution-policy/v1",
      metrics: {
        changedUnits: dispatch.targets.changedUnits.length,
        candidates: dispatch.targets.candidates.length,
        targets: dispatch.targets.changedUnits.length + dispatch.targets.candidates.length,
        requiredRuleRefs: 0,
        reviewItems: 0,
      },
      signals: { userRequestedConcurrency: true },
      reason: "No current review items",
      humanOverride: null,
    };
    dispatch.reviewBatches = [];
    ["tasks", "retries", "shards"].forEach((dir) => fs.rmSync(path.join(runDir, dir), { recursive: true, force: true }));
    ["finalReview.json", "final.md", "response.md"].forEach((file) => fs.rmSync(path.join(runDir, file), { force: true }));
  }
  writeJson(dispatchPath, dispatch);

  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "Test User"]);
  git(root, ["add", "."]);
  git(root, ["commit", "-qm", "baseline"]);
  fs.writeFileSync(path.join(root, "src", "example.js"), "after\r\n");
  fs.rmSync(path.join(root, "src", "deleted.js"));
  return { root, runDir, dispatchPath };
}

function v3ConsumerCommands(runDir, dispatchPath) {
  return [
    ["--mode", "dispatch", "--input", dispatchPath],
    ["--mode", "build-tasks", "--dispatch", dispatchPath, "--out", path.join(runDir, "tasks")],
    ["--mode", "aggregate-final", "--dir", runDir, "--output", path.join(runDir, "finalReview.json")],
    ["--mode", "render-final", "--input", path.join(runDir, "finalReview.json"), "--dispatch", dispatchPath, "--output", path.join(runDir, "final.md")],
    ["--mode", "run", "--dir", runDir],
    ["--mode", "render-response", "--dir", runDir],
    ["--mode", "final-md", "--input", path.join(runDir, "final.md"), "--final-review", path.join(runDir, "finalReview.json"), "--dispatch", dispatchPath],
  ];
}

{
  const { root, runDir, dispatchPath } = createV3RunFixture();
  const codePath = path.join(root, "src", "example.js");
  const rulePath = path.join(root, ".agents", "rules", "core.md");
  try {
    const seal = await runValidate(["--mode", "seal-dispatch", "--input", dispatchPath]);
    assert.equal(JSON.parse(seal.stdout).ok, true);
    const sealed = readJson(dispatchPath);
    assert.deepEqual(sealed.changedFiles, ["src/deleted.js", "src/example.js"]);
    assert.deepEqual(sealed.inputSnapshot.files, [
      { inputRef: "src/deleted.js", state: "deleted" },
      { inputRef: "src/example.js", state: "present", contentHash: hashBytes(Buffer.from("after\r\n")) },
    ]);
    assert.equal(sealed.ruleSet.sourceIndexHash, hashBytes(fs.readFileSync(path.join(root, ".agents", "rules", "index.md"))));
    assert(sealed.ruleSet.ruleSources.every((source) => source.sourceHash === hashBytes(fs.readFileSync(rulePath))));

    for (const command of v3ConsumerCommands(runDir, dispatchPath)) {
      const result = await runValidate(command);
      assert.equal(JSON.parse(result.stdout).ok, true, command.join(" "));
    }
    const task = readJson(path.join(runDir, "tasks", "B001.json"));
    assert.equal(task.schemaVersion, 2);
    assert.deepEqual(task.targets[0].inputRefs, ["src/example.js", "src/deleted.js"]);
    assert.equal(Object.hasOwn(task, "inputSnapshot"), false);
    assert.equal(Object.hasOwn(task, "changedFiles"), false);
    assert.equal(Object.hasOwn(task.targets[0], "contentHash"), false);

    const unrelatedV2Dispatch = JSON.parse(JSON.stringify(sealed));
    unrelatedV2Dispatch.schemaVersion = 2;
    unrelatedV2Dispatch.runId = "unrelated-v2-run";
    writeJson(dispatchPath, unrelatedV2Dispatch);
    await assertValidateFails(
      ["--mode", "render-final", "--input", path.join(runDir, "finalReview.json"), "--dispatch", dispatchPath, "--output", path.join(runDir, "final.md")],
      /dispatch runId must match finalReview runId/,
    );
    await assertValidateFails(
      ["--mode", "final-md", "--input", path.join(runDir, "final.md"), "--final-review", path.join(runDir, "finalReview.json"), "--dispatch", dispatchPath],
      /dispatch runId must match finalReview runId/,
    );
    writeJson(dispatchPath, sealed);

    fs.writeFileSync(codePath, "tampered code\n");
    for (const command of v3ConsumerCommands(runDir, dispatchPath)) {
      await assertValidateFails(command, /current Git worktree input verification failed closed/);
    }

    fs.writeFileSync(codePath, "after\r\n");
    fs.writeFileSync(rulePath, "tampered rule\n");
    for (const command of v3ConsumerCommands(runDir, dispatchPath)) {
      await assertValidateFails(command, /current Git worktree input verification failed closed/);
    }
    fs.writeFileSync(rulePath, "# CORE-001\n\nCurrent rule bytes.\n");
    fs.writeFileSync(path.join(root, ".agents", "rules", "index.md"), "# Tampered index\n");
    await assertValidateFails(["--mode", "dispatch", "--input", dispatchPath], /current rule index hash does not match/);
    fs.writeFileSync(path.join(root, ".agents", "rules", "index.md"), "# Rules\n\n- CORE-001\n");

    const forged = JSON.parse(JSON.stringify(sealed));
    forged.inputSnapshot.files.find((entry) => entry.state === "present").contentHash = `sha256:${"f".repeat(64)}`;
    writeJson(dispatchPath, forged);
    await assertValidateFails(["--mode", "dispatch", "--input", dispatchPath], /current input snapshot mismatch/);

    const escaped = JSON.parse(JSON.stringify(sealed));
    escaped.targets.changedUnits[0].inputRefs = ["../outside.js"];
    writeJson(dispatchPath, escaped);
    await assertValidateFails(["--mode", "seal-dispatch", "--input", dispatchPath], /unsafe repository path segments/);

    const missingRule = JSON.parse(JSON.stringify(sealed));
    missingRule.ruleSet.ruleSources[0].sourceFile = ".agents/rules/missing.md";
    writeJson(dispatchPath, missingRule);
    await assertValidateFails(["--mode", "seal-dispatch", "--input", dispatchPath], /required repository file is missing/);

    const uncovered = JSON.parse(JSON.stringify(sealed));
    delete uncovered.changedFiles;
    writeJson(dispatchPath, uncovered);
    fs.writeFileSync(path.join(root, "src", "uncovered.js"), "uncovered\n");
    await assertValidateFails(["--mode", "seal-dispatch", "--input", dispatchPath], /each changedFile must be covered by changedUnits\.inputRefs/);
    fs.rmSync(path.join(root, "src", "uncovered.js"));

    const symlinked = JSON.parse(JSON.stringify(sealed));
    fs.symlinkSync("example.js", path.join(root, "src", "link.js"));
    symlinked.targets.changedUnits[0].inputRefs = ["src/link.js"];
    writeJson(dispatchPath, symlinked);
    await assertValidateFails(["--mode", "seal-dispatch", "--input", dispatchPath], /symlink repository input is forbidden/);
    fs.rmSync(path.join(root, "src", "link.js"));

    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "rules-review-v3-outside-"));
    const outsideDispatch = path.join(outside, "dispatch.json");
    writeJson(outsideDispatch, sealed);
    await assertValidateFails(["--mode", "seal-dispatch", "--input", outsideDispatch], /not a git repository|Git worktree/);
    fs.rmSync(outside, { recursive: true, force: true });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

{
  const { root, dispatchPath } = createV3RunFixture({
    changedFiles: ["src/example.js"],
    inputRefs: ["src/example.js"],
  });
  try {
    await runValidate(["--mode", "seal-dispatch", "--input", dispatchPath]);
    const sealed = readJson(dispatchPath);
    assert.deepEqual(sealed.changedFiles, ["src/example.js"]);
    assert.deepEqual(sealed.inputSnapshot.files, [
      { inputRef: "src/example.js", state: "present", contentHash: hashBytes(Buffer.from("after\r\n")) },
    ]);
    fs.writeFileSync(path.join(root, "src", "unrelated.js"), "new unrelated change\n");
    const verified = await runValidate(["--mode", "dispatch", "--input", dispatchPath]);
    assert.equal(JSON.parse(verified.stdout).ok, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

{
  const { root, dispatchPath } = createV3RunFixture({ changedFiles: ["src/not-in-inventory.js"] });
  try {
    await assertValidateFails(
      ["--mode", "seal-dispatch", "--input", dispatchPath],
      /changedFile does not belong to current Git inventory/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

{
  const { root, runDir, dispatchPath } = createV3RunFixture();
  try {
    fs.writeFileSync(path.join(root, "src", "example.js"), "before\r\n");
    fs.writeFileSync(path.join(root, "src", "deleted.js"), "deleted before seal\n");
    fs.writeFileSync(path.join(runDir, "protocol-note.txt"), "excluded protocol artifact\n");
    await runValidate(["--mode", "seal-dispatch", "--input", dispatchPath]);
    assert.deepEqual(readJson(dispatchPath).changedFiles, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

{
  const { root, runDir, dispatchPath } = createV3RunFixture({ noBatch: true });
  const codePath = path.join(root, "src", "example.js");
  try {
    await runValidate(["--mode", "seal-dispatch", "--input", dispatchPath]);
    const sealed = readJson(dispatchPath);
    assert.equal(sealed.schemaVersion, 3);
    assert.equal(sealed.executionPlan.mode, "no_batch");
    assert.equal(sealed.executionPlan.selectedBy, "ai");
    assert.equal(sealed.executionPlan.policyVersion, "review-execution-policy/v1");
    assert.equal(sealed.executionPlan.signals.userRequestedConcurrency, true);
    assert.equal(sealed.executionPlan.humanOverride, null);
    assert.deepEqual(sealed.reviewItems, []);
    assert.deepEqual(sealed.reviewBatches, []);

    const invalidDispatches = [
      {
        pattern: /executionPlan\.mode must be valid/,
        mutate: (dispatch) => { dispatch.schemaVersion = 2; },
      },
      {
        pattern: /single_batch executionPlan requires exactly one reviewBatch/,
        mutate: (dispatch) => { dispatch.executionPlan.mode = "single_batch"; },
      },
      {
        pattern: /multi_batch executionPlan requires at least two reviewBatches/,
        mutate: (dispatch) => { dispatch.executionPlan.mode = "multi_batch"; },
      },
      {
        pattern: /no_batch must be selected by ai/,
        mutate: (dispatch) => {
          dispatch.executionPlan.selectedBy = "human_override";
          dispatch.executionPlan.humanOverride = { requestedMode: "single_batch", risk: "Manual override" };
        },
      },
      {
        pattern: /humanOverride\.requestedMode must be valid/,
        mutate: (dispatch) => {
          dispatch.executionPlan.selectedBy = "human_override";
          dispatch.executionPlan.humanOverride = { requestedMode: "no_batch", risk: "Manual override" };
        },
      },
      {
        pattern: /no_batch forbids human override/,
        mutate: (dispatch) => {
          dispatch.executionPlan.humanOverride = { requestedMode: "single_batch", risk: "Manual override" };
        },
      },
      {
        pattern: /internal no_batch dispatch must be full and forbid continuation/,
        mutate: (dispatch) => { dispatch.continuation = { baseRunId: "R001" }; },
      },
    ];
    for (const { mutate, pattern } of invalidDispatches) {
      const invalid = JSON.parse(JSON.stringify(sealed));
      mutate(invalid);
      writeJson(dispatchPath, invalid);
      await assertValidateFails(["--mode", "dispatch", "--input", dispatchPath], pattern);
    }
    writeJson(dispatchPath, sealed);

    const dispatchResult = await runValidate(["--mode", "dispatch", "--input", dispatchPath]);
    assert.equal(JSON.parse(dispatchResult.stdout).ok, true);

    const tasksDir = path.join(runDir, "tasks");
    const builtTasks = await runValidate(["--mode", "build-tasks", "--dispatch", dispatchPath, "--out", tasksDir]);
    assert.deepEqual(JSON.parse(builtTasks.stdout).rendered, []);
    assert.deepEqual(fs.readdirSync(tasksDir), []);

    const staleTaskPath = path.join(tasksDir, "stale.json");
    writeJson(staleTaskPath, {});
    await assertValidateFails(
      ["--mode", "build-tasks", "--dispatch", dispatchPath, "--out", tasksDir],
      /no_batch build-tasks requires an empty JSON output directory/,
    );
    assert.equal(fs.existsSync(staleTaskPath), true);
    fs.rmSync(staleTaskPath);

    const finalReviewPath = path.join(runDir, "finalReview.json");
    const aggregate = await runValidate(["--mode", "aggregate-final", "--dir", runDir, "--output", finalReviewPath]);
    assert.equal(JSON.parse(aggregate.stdout).ok, true);
    const finalReview = readJson(finalReviewPath);
    assert.equal(finalReview.protocolGate, "passed");
    assert.equal(finalReview.semanticVerdict, "clean");
    assert.equal(finalReview.recommendation, "ready_for_merge");
    assert.deepEqual(finalReview.findings, []);
    assert.deepEqual(finalReview.observations, []);
    assert.deepEqual(finalReview.issueSummary, issueSummary());

    await renderFinalInDir(runDir);
    const runResult = await runValidate(["--mode", "run", "--dir", runDir]);
    assert.equal(JSON.parse(runResult.stdout).ok, true);
    const responseResult = await runValidate(["--mode", "render-response", "--dir", runDir]);
    assert.equal(JSON.parse(responseResult.stdout).ok, true);
    const finalMarkdownResult = await runValidate([
      "--mode", "final-md",
      "--input", path.join(runDir, "final.md"),
      "--final-review", finalReviewPath,
      "--dispatch", dispatchPath,
    ]);
    assert.equal(JSON.parse(finalMarkdownResult.stdout).ok, true);
    assert.match(fs.readFileSync(path.join(runDir, "final.md"), "utf8"), /mode：no_batch/);

    for (const dir of ["tasks", "retries", "shards"]) {
      const orphanPath = path.join(runDir, dir, "orphan.json");
      fs.mkdirSync(path.dirname(orphanPath), { recursive: true });
      writeJson(orphanPath, {});
      await assertValidateFails(
        ["--mode", "aggregate-final", "--dir", runDir, "--output", finalReviewPath],
        /no_batch run must not contain reviewer JSON artifacts/,
      );
      await assertValidateFails(["--mode", "run", "--dir", runDir], /no_batch run must not contain reviewer JSON artifacts/);
      await assertValidateFails(["--mode", "render-response", "--dir", runDir], /no_batch run must not contain reviewer JSON artifacts/);
      fs.rmSync(orphanPath);
      await runValidate(["--mode", "aggregate-final", "--dir", runDir, "--output", finalReviewPath]);
      await renderFinalInDir(runDir);
    }

    fs.writeFileSync(codePath, "tampered code\n");
    for (const command of v3ConsumerCommands(runDir, dispatchPath)) {
      await assertValidateFails(command, /current Git worktree input verification failed closed/);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

{
  const { root, dispatchPath } = createV3RunFixture();
  try {
    await runValidate(["--mode", "seal-dispatch", "--input", dispatchPath]);
    const sealed = readJson(dispatchPath);

    const nonEmptyNoBatch = JSON.parse(JSON.stringify(sealed));
    nonEmptyNoBatch.executionPlan.mode = "no_batch";
    nonEmptyNoBatch.reviewBatches = [];
    writeJson(dispatchPath, nonEmptyNoBatch);
    await assertValidateFails(["--mode", "dispatch", "--input", dispatchPath], /no_batch requires empty current reviewItems/);

    const nonZeroNoBatch = JSON.parse(JSON.stringify(sealed));
    nonZeroNoBatch.executionPlan.mode = "no_batch";
    writeJson(dispatchPath, nonZeroNoBatch);
    await assertValidateFails(["--mode", "dispatch", "--input", dispatchPath], /no_batch executionPlan requires zero reviewBatches/);

    const multiNoBatch = JSON.parse(JSON.stringify(sealed));
    const [firstItemId, ...remainingItemIds] = multiNoBatch.reviewBatches[0].reviewItemIds;
    multiNoBatch.executionPlan.mode = "no_batch";
    multiNoBatch.reviewBatches = [
      { ...multiNoBatch.reviewBatches[0], reviewItemIds: [firstItemId] },
      { ...multiNoBatch.reviewBatches[0], reviewBatchId: "B002", reviewItemIds: remainingItemIds, taskRef: "tasks/B002.json" },
    ];
    writeJson(dispatchPath, multiNoBatch);
    await assertValidateFails(["--mode", "dispatch", "--input", dispatchPath], /no_batch executionPlan requires zero reviewBatches/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
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

const builtTasksDir = fs.mkdtempSync(path.join(os.tmpdir(), "rules-review-built-tasks-"));
const builtTasks = await runValidate([
  "--mode",
  "build-tasks",
  "--dispatch",
  path.join(fixtures, "run-pass-large-multi", "dispatch.json"),
  "--out",
  builtTasksDir,
]);
const builtTasksOutput = JSON.parse(builtTasks.stdout);
assert.equal(builtTasksOutput.ok, true);
assert.deepEqual(readJson(path.join(builtTasksDir, "B001.json")), readJson(path.join(fixtures, "run-pass-large-multi", "tasks/B001.json")));
assert.deepEqual(readJson(path.join(builtTasksDir, "B002.json")), readJson(path.join(fixtures, "run-pass-large-multi", "tasks/B002.json")));

const aggregatedFinalPath = path.join(os.tmpdir(), `rules-review-aggregate-${Date.now()}.json`);
const aggregatedFinal = await runValidate([
  "--mode",
  "aggregate-final",
  "--dir",
  path.join(fixtures, "run-pass-finding-evidence-key-order"),
  "--output",
  aggregatedFinalPath,
]);
const aggregatedFinalOutput = JSON.parse(aggregatedFinal.stdout);
assert.equal(aggregatedFinalOutput.ok, true);
const expectedAggregatedFinal = readJson(path.join(fixtures, "run-pass-finding-evidence-key-order", "finalReview.json"));
delete expectedAggregatedFinal.summary;
assert.deepEqual(readJson(aggregatedFinalPath), expectedAggregatedFinal);

const unsortedFindingsDir = fs.mkdtempSync(path.join(os.tmpdir(), "rules-review-unsorted-findings-"));
fs.cpSync(path.join(fixtures, "run-pass-full-clean"), unsortedFindingsDir, { recursive: true });
const unsortedFindingsShardPath = path.join(unsortedFindingsDir, "shards/B001.json");
const unsortedFindingsShard = readJson(unsortedFindingsShardPath);
unsortedFindingsShard.results[0] = {
  reviewItemId: "RI002",
  status: "finding",
  origin: "introduced_by_change",
  priority: "must_fix",
  priorityReason: "同组排序测试",
  evidence: [{ loc: "src/example.ts:12", summary: "TYPE-001 finding evidence" }],
};
unsortedFindingsShard.results[1] = {
  reviewItemId: "RI001",
  status: "finding",
  origin: "introduced_by_change",
  evidence: [{ loc: "src/example.ts:10", summary: "CORE-001 finding evidence" }],
};
writeJson(unsortedFindingsShardPath, unsortedFindingsShard);
const sortedFindingsFinalPath = path.join(os.tmpdir(), `rules-review-sorted-findings-${Date.now()}.json`);
const sortedFindingsFinal = await runValidate([
  "--mode",
  "aggregate-final",
  "--dir",
  unsortedFindingsDir,
  "--output",
  sortedFindingsFinalPath,
]);
const sortedFindingsOutput = JSON.parse(sortedFindingsFinal.stdout);
assert.equal(sortedFindingsOutput.ok, true);
const sortedFindings = readJson(sortedFindingsFinalPath).findings;
assert.deepEqual(sortedFindings.map((finding) => finding.findingId), ["F001", "F002"]);

assert.equal(readJson(path.join(repoRoot, "skills/rules-review/schemas/shard.schema.json")).$defs.result.properties.findingId, false);
for (const resultIndex of [0, 1]) {
  const shardFindingIdDir = fs.mkdtempSync(path.join(os.tmpdir(), "rules-review-shard-finding-id-"));
  fs.cpSync(path.join(fixtures, "run-pass-finding-evidence-key-order"), shardFindingIdDir, { recursive: true });
  const shardPath = path.join(shardFindingIdDir, "shards/B001.json");
  const shard = readJson(shardPath);
  shard.results[resultIndex].findingId = "F999";
  writeJson(shardPath, shard);
  await assertValidateFails([
    "--mode",
    "shard",
    "--task",
    path.join(shardFindingIdDir, "tasks/B001.json"),
    "--input",
    shardPath,
  ], /shard result must not contain findingId/);
}

const reversedFindingsDir = fs.mkdtempSync(path.join(os.tmpdir(), "rules-review-reversed-findings-"));
fs.cpSync(unsortedFindingsDir, reversedFindingsDir, { recursive: true });
const reversedFindingsShardPath = path.join(reversedFindingsDir, "shards/B001.json");
const reversedFindingsShard = readJson(reversedFindingsShardPath);
reversedFindingsShard.results.reverse();
writeJson(reversedFindingsShardPath, reversedFindingsShard);
const reversedFindingsFinalPath = path.join(reversedFindingsDir, "finalReview.json");
await runValidate(["--mode", "aggregate-final", "--dir", reversedFindingsDir, "--output", reversedFindingsFinalPath]);
assert.deepEqual(readJson(reversedFindingsFinalPath).findings, sortedFindings);

writeJson(path.join(unsortedFindingsDir, "finalReview.json"), readJson(sortedFindingsFinalPath));
await renderFinalInDir(unsortedFindingsDir);
const sharedIdResponse = await runValidate(["--mode", "render-response", "--dir", unsortedFindingsDir]);
const expectedFindingIds = sortedFindings.map((finding) => finding.findingId);
assert.deepEqual([...new Set(fs.readFileSync(path.join(unsortedFindingsDir, "final.md"), "utf8").match(/\bF\d{3,}\b/g))], expectedFindingIds);
assert.deepEqual([...new Set(JSON.parse(sharedIdResponse.stdout).response.match(/\bF\d{3,}\b/g))], expectedFindingIds);

for (const [name, mutate, pattern] of [
  ["missing", (finalReview) => finalReview.findings.pop(), /finalReview findings must include every derived finding and no extras/],
  ["duplicate", (finalReview) => { finalReview.findings[1].findingId = finalReview.findings[0].findingId; }, /finalReview findings must equal validator result/],
  ["renumbered", (finalReview) => { finalReview.findings[1].findingId = "F003"; }, /finalReview findings must equal validator result/],
  ["reordered", (finalReview) => finalReview.findings.reverse(), /finalReview findings must equal validator result/],
  ["bad-shape", (finalReview) => { finalReview.findings[0].findingId = "F01"; }, /final findingId must match F followed by at least three digits/],
]) {
  const tamperedDir = fs.mkdtempSync(path.join(os.tmpdir(), `rules-review-final-${name}-`));
  fs.cpSync(unsortedFindingsDir, tamperedDir, { recursive: true });
  const finalReviewPath = path.join(tamperedDir, "finalReview.json");
  const finalReview = readJson(finalReviewPath);
  mutate(finalReview);
  writeJson(finalReviewPath, finalReview);
  await assertRunDirFails(tamperedDir, pattern);
}

const thousandFindingsDir = fs.mkdtempSync(path.join(os.tmpdir(), "rules-review-thousand-findings-"));
fs.cpSync(path.join(fixtures, "run-pass-full-clean"), thousandFindingsDir, { recursive: true });
const thousandDispatchPath = path.join(thousandFindingsDir, "dispatch.json");
const thousandDispatch = readJson(thousandDispatchPath);
const coreRule = thousandDispatch.ruleSet.ruleSources.find((rule) => rule.ruleRef === "CORE-001");
const thousandItems = Array.from({ length: 1000 }, (_, index) => {
  const suffix = String(index).padStart(3, "0");
  return {
    reviewItemId: `RI${suffix}`,
    targetId: `T${suffix}`,
    loc: `src/example.ts:${index + 1}`,
  };
});
Object.assign(thousandDispatch.ruleSet, {
  candidateRuleRefs: ["CORE-001"],
  selectedRuleRefs: ["CORE-001"],
  requiredRuleRefs: ["CORE-001"],
  excludedRuleRefs: [],
  globallyNotApplicableRuleRefs: [],
  ruleSources: [coreRule],
});
thousandDispatch.targets = {
  changedUnits: thousandItems.map((item) => ({
    targetId: item.targetId,
    targetKind: "changed_unit",
    loc: item.loc,
    summary: `Finding target ${item.targetId}`,
  })),
  candidates: [],
  contextExpansions: [],
};
thousandDispatch.reviewItems = thousandItems.map((item) => ({
  reviewItemId: item.reviewItemId,
  ruleRef: "CORE-001",
  targetKind: "changed_unit",
  targetId: item.targetId,
  required: true,
}));
thousandDispatch.applicabilityMatrix = thousandItems.map((item) => ({
  ruleRef: "CORE-001",
  targetId: item.targetId,
  targetKind: "changed_unit",
  applicability: "applicable",
  reviewItemId: item.reviewItemId,
  evidence: [{ summary: `CORE-001 applies to ${item.targetId}`, loc: item.loc }],
}));
thousandDispatch.reviewBatches = [thousandItems.slice(0, 500), thousandItems.slice(500)].map((items, index) => {
  const reviewBatchId = `B00${index + 1}`;
  return {
    reviewBatchId,
    ruleSetId: thousandDispatch.ruleSet.ruleSetId,
    reviewItemIds: items.map((item) => item.reviewItemId),
    taskRef: `tasks/${reviewBatchId}.json`,
    shardRef: `shards/${reviewBatchId}.json`,
    returnStatus: "returned",
    aggregateStatus: "aggregated",
    unaggregatedReason: null,
  };
});
thousandDispatch.executionPlan = {
  mode: "multi_batch",
  selectedBy: "ai",
  policyVersion: "review-execution-policy/v1",
  metrics: { changedUnits: 1000, candidates: 0, targets: 1000, requiredRuleRefs: 1, reviewItems: 1000 },
  signals: { userRequestedConcurrency: false },
  reason: "F1000 aggregation regression",
  humanOverride: null,
};
writeJson(thousandDispatchPath, thousandDispatch);
fs.rmSync(path.join(thousandFindingsDir, "tasks"), { recursive: true, force: true });
fs.rmSync(path.join(thousandFindingsDir, "shards"), { recursive: true, force: true });
await runValidate(["--mode", "build-tasks", "--dispatch", thousandDispatchPath, "--out", path.join(thousandFindingsDir, "tasks")]);
fs.mkdirSync(path.join(thousandFindingsDir, "shards"), { recursive: true });
for (const batch of thousandDispatch.reviewBatches) {
  writeJson(path.join(thousandFindingsDir, batch.shardRef), {
    kind: "rules-review-shard",
    schemaVersion: 2,
    runId: thousandDispatch.runId,
    reviewBatchId: batch.reviewBatchId,
    results: [...batch.reviewItemIds].reverse().map((reviewItemId) => ({
      reviewItemId,
      status: "finding",
      origin: "introduced_by_change",
      evidence: [{ summary: `Finding evidence ${reviewItemId}`, source: "generated regression" }],
    })),
  });
}
const thousandFinalPath = path.join(thousandFindingsDir, "finalReview.json");
await runValidate(["--mode", "aggregate-final", "--dir", thousandFindingsDir, "--output", thousandFinalPath]);
const thousandFindings = readJson(thousandFinalPath).findings;
assert.equal(thousandFindings.length, 1000);
assert.equal(thousandFindings[0].findingId, "F001");
assert.equal(thousandFindings.at(-1).findingId, "F1000");

const responsePath = "/tmp/rules-review-response-test.md";
const response = await runValidate([
  "--mode",
  "render-response",
  "--dir",
  path.join(fixtures, "run-pass-scoped-clean"),
  "--output",
  responsePath,
]);
const responseOutput = JSON.parse(response.stdout);
assert.equal(responseOutput.ok, true);
assert.equal(fs.readFileSync(responsePath, "utf8"), responseOutput.response);
assert.match(responseOutput.response, /rules-review：未发现问题/);
assert.doesNotMatch(responseOutput.response.split("\n")[0], /协议通过/);
assert.match(responseOutput.response, /协议门禁：协议通过/);
assertNoStandalonePassedLabel(responseOutput.response);
assertNextSection(responseOutput.response, "## 结论", "## 问题");
assertNextSection(responseOutput.response, "## 问题", "## 报告");
assert.doesNotMatch(responseOutput.response, /## 执行计划/);
assert.doesNotMatch(responseOutput.response, /## 验证/);

const cleanFinal = fs.readFileSync(path.join(fixtures, "run-pass-full-clean", "final.md"), "utf8");
assert.match(cleanFinal, /rules-review：协议通过，未发现问题/);
assert.match(cleanFinal, /修复建议：可以合并/);
assert.match(cleanFinal, /覆盖声明：本轮范围协议覆盖完整/);
assert.match(cleanFinal, /selectedRuleRefs：3/);
assertNoStandalonePassedLabel(cleanFinal);

const scopedFinal = fs.readFileSync(path.join(fixtures, "run-pass-scoped-clean", "final.md"), "utf8");
assert.match(scopedFinal, /覆盖声明：本轮限定范围协议覆盖完整/);

const findingFinal = fs.readFileSync(path.join(fixtures, "run-pass-finding-evidence-key-order", "final.md"), "utf8");
assert.match(findingFinal, /rules-review：协议通过，发现 1 项问题/);
assert.match(findingFinal, /修复建议：合并前必须修复/);
assertNoStandalonePassedLabel(findingFinal);
const findingResponse = await runValidate([
  "--mode",
  "render-response",
  "--dir",
  path.join(fixtures, "run-pass-finding-evidence-key-order"),
  "--output",
  "/tmp/rules-review-finding-response-test.md",
]);
const findingResponseOutput = JSON.parse(findingResponse.stdout);
assert.match(findingResponseOutput.response, /- F001：CORE-001 finding evidence/);
assert.match(findingResponseOutput.response, /  规则：CORE-001；目标：T001；来源：本次引入/);
assert.doesNotMatch(findingResponseOutput.response, /RI001/);
const renderedFindingFinal = await renderFinalReview(readJson(path.join(fixtures, "run-pass-finding-evidence-key-order", "finalReview.json")));
assertNextSection(renderedFindingFinal, "## 结论", "## 问题");
assertNextSection(renderedFindingFinal, "## 问题", "## 范围");

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
assert.match(cannotVerifyResponseOutput.response, /rules-review：未发现明确问题，但 1 项无法验证/);
assert.match(cannotVerifyResponseOutput.response, /1 项无法验证/);
assert.match(cannotVerifyResponseOutput.response, /修复建议：需要人工验证/);
assert.doesNotMatch(cannotVerifyResponseOutput.response.split("\n")[0], /协议通过/);
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
assert.match(mixedResponseOutput.response, /rules-review：发现 1 项问题，1 项无法验证/);
assert.match(mixedResponseOutput.response, /发现 1 项问题，1 项无法验证/);
assert.match(mixedResponseOutput.response, /修复建议：合并前必须修复/);
assert.doesNotMatch(mixedResponseOutput.response.split("\n")[0], /协议通过/);
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

const requiredOutsideSelectedDir = fs.mkdtempSync(path.join(os.tmpdir(), "rules-review-required-outside-selected-"));
fs.cpSync(path.join(fixtures, "run-pass-full-clean"), requiredOutsideSelectedDir, { recursive: true });
const requiredOutsideSelectedDispatchPath = path.join(requiredOutsideSelectedDir, "dispatch.json");
const requiredOutsideSelectedDispatch = readJson(requiredOutsideSelectedDispatchPath);
requiredOutsideSelectedDispatch.ruleSet.selectedRuleRefs = ["CORE-001", "UI-001"];
writeJson(requiredOutsideSelectedDispatchPath, requiredOutsideSelectedDispatch);
await assertRunDirFails(requiredOutsideSelectedDir, /requiredRuleRefs must be subset of selectedRuleRefs/);

const missingApplicabilityDir = fs.mkdtempSync(path.join(os.tmpdir(), "rules-review-missing-applicability-"));
fs.cpSync(path.join(fixtures, "run-pass-full-clean"), missingApplicabilityDir, { recursive: true });
const missingApplicabilityDispatchPath = path.join(missingApplicabilityDir, "dispatch.json");
const missingApplicabilityDispatch = readJson(missingApplicabilityDispatchPath);
missingApplicabilityDispatch.applicabilityMatrix.pop();
writeJson(missingApplicabilityDispatchPath, missingApplicabilityDispatch);
await assertRunDirFails(missingApplicabilityDir, /applicabilityMatrix must cover every requiredRuleRef x target pair/);

const taskApplicabilityMismatchDir = fs.mkdtempSync(path.join(os.tmpdir(), "rules-review-task-applicability-"));
fs.cpSync(path.join(fixtures, "run-pass-full-clean"), taskApplicabilityMismatchDir, { recursive: true });
const taskApplicabilityMismatchTaskPath = path.join(taskApplicabilityMismatchDir, "tasks/B001.json");
const taskApplicabilityMismatchTask = readJson(taskApplicabilityMismatchTaskPath);
taskApplicabilityMismatchTask.applicabilityMatrix = [];
writeJson(taskApplicabilityMismatchTaskPath, taskApplicabilityMismatchTask);
await assertRunDirFails(taskApplicabilityMismatchDir, /task applicabilityMatrix must include each dispatch applicable row/);

const requiredNotApplicableDir = fs.mkdtempSync(path.join(os.tmpdir(), "rules-review-required-not-applicable-"));
fs.cpSync(path.join(fixtures, "run-pass-full-clean"), requiredNotApplicableDir, { recursive: true });
const requiredNotApplicableShardPath = path.join(requiredNotApplicableDir, "shards/B001.json");
const requiredNotApplicableShard = readJson(requiredNotApplicableShardPath);
requiredNotApplicableShard.results[0] = {
  reviewItemId: "RI001",
  status: "not_applicable",
  reason: "Reviewer disputes the dispatch applicability decision.",
};
writeJson(requiredNotApplicableShardPath, requiredNotApplicableShard);
await assertRunDirFails(requiredNotApplicableDir, /required reviewItem cannot return not_applicable/);

const missingContextReasonDir = fs.mkdtempSync(path.join(os.tmpdir(), "rules-review-missing-context-reason-"));
fs.cpSync(path.join(fixtures, "run-pass-full-clean"), missingContextReasonDir, { recursive: true });
const missingContextReasonDispatchPath = path.join(missingContextReasonDir, "dispatch.json");
const missingContextReasonDispatch = readJson(missingContextReasonDispatchPath);
delete missingContextReasonDispatch.targets.contextExpansions[0].reason;
writeJson(missingContextReasonDispatchPath, missingContextReasonDispatch);
await assertRunDirFails(missingContextReasonDir, /contextExpansion reason must be non-empty string/);

const passedNoFailureChecksDir = fs.mkdtempSync(path.join(os.tmpdir(), "rules-review-passed-no-failure-checks-"));
fs.cpSync(path.join(fixtures, "run-pass-full-clean"), passedNoFailureChecksDir, { recursive: true });
const passedNoFailureChecksShardPath = path.join(passedNoFailureChecksDir, "shards/B001.json");
const passedNoFailureChecksShard = readJson(passedNoFailureChecksShardPath);
delete passedNoFailureChecksShard.results[0].failureChecks;
writeJson(passedNoFailureChecksShardPath, passedNoFailureChecksShard);
await assertRunDirFails(passedNoFailureChecksDir, /passed result requires failureChecks/);

const taskMissingFailureConditionsDir = fs.mkdtempSync(path.join(os.tmpdir(), "rules-review-task-missing-failure-conditions-"));
fs.cpSync(path.join(fixtures, "run-pass-full-clean"), taskMissingFailureConditionsDir, { recursive: true });
const taskMissingFailureConditionsDispatchPath = path.join(taskMissingFailureConditionsDir, "dispatch.json");
const taskMissingFailureConditionsDispatch = readJson(taskMissingFailureConditionsDispatchPath);
taskMissingFailureConditionsDispatch.ruleSet.ruleSources[0].failureConditions = [
  { conditionId: "CORE-001-FC001", summary: "CORE-001 must not regress the changed request parameter." },
];
writeJson(taskMissingFailureConditionsDispatchPath, taskMissingFailureConditionsDispatch);
await assertRunDirFails(taskMissingFailureConditionsDir, /task\.rules\[\]\.failureConditions must match dispatch ruleSources\[\]\.failureConditions/);

const emptyRequiredContextExpansionDir = fs.mkdtempSync(path.join(os.tmpdir(), "rules-review-empty-required-context-"));
fs.cpSync(path.join(fixtures, "run-pass-full-clean"), emptyRequiredContextExpansionDir, { recursive: true });
const emptyRequiredContextExpansionDispatchPath = path.join(emptyRequiredContextExpansionDir, "dispatch.json");
const emptyRequiredContextExpansionDispatch = readJson(emptyRequiredContextExpansionDispatchPath);
emptyRequiredContextExpansionDispatch.ruleSet.ruleSources[0].requiredContext = [
  { contextId: "CORE-001-RC001", summary: "CORE-001 requires a consumer context check." },
];
emptyRequiredContextExpansionDispatch.targets.contextExpansions.push({
  expansionId: "E999",
  reason: "Declared required context without adding a target.",
  addedTargetIds: [],
  requiredContextRefs: ["CORE-001-RC001"],
});
writeJson(emptyRequiredContextExpansionDispatchPath, emptyRequiredContextExpansionDispatch);
await assertRunDirFails(emptyRequiredContextExpansionDir, /contextExpansions with requiredContextRefs must add candidate targets/);

const retryValidationDir = fs.mkdtempSync(path.join(os.tmpdir(), "rules-review-retry-validation-"));
fs.cpSync(path.join(fixtures, "run-pass-full-clean"), retryValidationDir, { recursive: true });
const retryValidationPath = path.join(retryValidationDir, "retries/B001-retry-1.json");
fs.mkdirSync(path.dirname(retryValidationPath), { recursive: true });
const retryTask = {
  kind: "rules-review-retry-task",
  schemaVersion: 2,
  runId: "run-pass-full-clean",
  retryAttempt: 1,
  reason: "Repair invalid JSON.",
  originalTaskRef: "tasks/B001.json",
  violations: [],
  outputContract: { format: "strict_json", schemaRef: "schemas/shard.schema.json" },
};
writeJson(retryValidationPath, retryTask);
const validRetryPass = await runValidate(["--mode", "run", "--dir", retryValidationDir]);
assert.equal(JSON.parse(validRetryPass.stdout).ok, true);
retryTask.expandScope = ["RI999"];
writeJson(retryValidationPath, retryTask);
await assertRunDirFails(retryValidationDir, /retryTask contains unsupported field/);

const unboundRetryDir = fs.mkdtempSync(path.join(os.tmpdir(), "rules-review-unbound-retry-"));
fs.cpSync(path.join(fixtures, "run-pass-full-clean"), unboundRetryDir, { recursive: true });
const unboundRetryPath = path.join(unboundRetryDir, "retries/B001-retry-1.json");
fs.mkdirSync(path.dirname(unboundRetryPath), { recursive: true });
writeJson(unboundRetryPath, {
  kind: "rules-review-retry-task",
  schemaVersion: 2,
  runId: "wrong-run",
  retryAttempt: 1,
  reason: "Repair invalid JSON.",
  originalTaskRef: "tasks/unknown.json",
  violations: [],
  outputContract: { format: "markdown", schemaRef: "other.json" },
});
await assertRunDirFails(unboundRetryDir, /retry output format must be strict_json/);
await assertRunDirFails(unboundRetryDir, /retry runId must match dispatch runId/);
await assertRunDirFails(unboundRetryDir, /retry originalTaskRef must reference a dispatch task/);

const forbiddenPriorReviewDir = fs.mkdtempSync(path.join(os.tmpdir(), "rules-review-forbidden-prior-"));
fs.cpSync(path.join(fixtures, "run-pass-full-clean"), forbiddenPriorReviewDir, { recursive: true });
const forbiddenPriorReviewDispatchPath = path.join(forbiddenPriorReviewDir, "dispatch.json");
const forbiddenPriorReviewDispatch = readJson(forbiddenPriorReviewDispatchPath);
forbiddenPriorReviewDispatch.priorReviewCheck = {
  status: "none_found",
  reason: "Legacy field should not be accepted.",
  evidence: [{ source: "manual", summary: "legacy" }],
  priorReviewRefs: [],
  discrepancies: [],
};
writeJson(forbiddenPriorReviewDispatchPath, forbiddenPriorReviewDispatch);
await assertRunDirFails(forbiddenPriorReviewDir, /priorReviewCheck is forbidden/);

const forbiddenPriorArtifactDir = fs.mkdtempSync(path.join(os.tmpdir(), "rules-review-forbidden-prior-artifact-"));
fs.cpSync(path.join(fixtures, "run-pass-full-clean"), forbiddenPriorArtifactDir, { recursive: true });
const forbiddenPriorArtifactDispatchPath = path.join(forbiddenPriorArtifactDir, "dispatch.json");
const forbiddenPriorArtifactDispatch = readJson(forbiddenPriorArtifactDispatchPath);
forbiddenPriorArtifactDispatch.targets.changedUnits[0].source = ".rules-review-tmp/old/final.md";
writeJson(forbiddenPriorArtifactDispatchPath, forbiddenPriorArtifactDispatch);
await assertRunDirFails(forbiddenPriorArtifactDir, /dispatch must not reference prior review artifacts/);

const forbiddenRunScriptDir = fs.mkdtempSync(path.join(os.tmpdir(), "rules-review-forbidden-run-script-"));
fs.cpSync(path.join(fixtures, "run-pass-full-clean"), forbiddenRunScriptDir, { recursive: true });
fs.writeFileSync(path.join(forbiddenRunScriptDir, "generate.mjs"), "export {};\n");
await assertRunDirFails(forbiddenRunScriptDir, /run directory must only contain rules-review protocol artifacts/);

const symlinkedRunTarget = fs.mkdtempSync(path.join(os.tmpdir(), "rules-review-symlinked-run-target-"));
fs.cpSync(path.join(fixtures, "run-pass-full-clean"), symlinkedRunTarget, { recursive: true });
const symlinkedRunDir = `${symlinkedRunTarget}-link`;
fs.symlinkSync(symlinkedRunTarget, symlinkedRunDir, "dir");
await assertRunDirFails(symlinkedRunDir, /run directory must not be a symbolic link/);

const symlinkedShardDir = fs.mkdtempSync(path.join(os.tmpdir(), "rules-review-symlinked-shard-"));
fs.cpSync(path.join(fixtures, "run-pass-full-clean"), symlinkedShardDir, { recursive: true });
const symlinkedShardTarget = path.join(path.dirname(symlinkedShardDir), `${path.basename(symlinkedShardDir)}-B001.json`);
fs.writeFileSync(symlinkedShardTarget, "not JSON\n");
fs.rmSync(path.join(symlinkedShardDir, "shards/B001.json"));
fs.symlinkSync(symlinkedShardTarget, path.join(symlinkedShardDir, "shards/B001.json"), "file");
await assertRunDirFails(symlinkedShardDir, /run tree must not contain symbolic links|symbolic link is forbidden/);

const symlinkedArtifactsDir = fs.mkdtempSync(path.join(os.tmpdir(), "rules-review-symlinked-artifacts-"));
fs.cpSync(path.join(fixtures, "run-pass-full-clean"), symlinkedArtifactsDir, { recursive: true });
const realShardsDir = `${symlinkedArtifactsDir}-shards`;
fs.renameSync(path.join(symlinkedArtifactsDir, "shards"), realShardsDir);
fs.symlinkSync(realShardsDir, path.join(symlinkedArtifactsDir, "shards"), "dir");
await assertRunDirFails(symlinkedArtifactsDir, /run tree must not contain symbolic links|symbolic link is forbidden/);

const shouldFixDir = fs.mkdtempSync(path.join(os.tmpdir(), "rules-review-should-fix-"));
fs.cpSync(path.join(fixtures, "run-pass-full-clean"), shouldFixDir, { recursive: true });
const shouldFixShardPath = path.join(shouldFixDir, "shards/B001.json");
const shouldFixShard = readJson(shouldFixShardPath);
const shouldFixEvidence = [{ loc: "src/example.ts:12", summary: "TYPE-001 should finding" }];
shouldFixShard.results[1] = {
  reviewItemId: "RI002",
  status: "finding",
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
const expectedShouldSetHash = hashBytes(Buffer.from(JSON.stringify([{
  evidence: [{ loc: "src/example.ts:12", summary: "TYPE-001 should finding" }],
  findingId: "F001",
  origin: "introduced_by_change",
  priority: "should_fix",
  reviewItemId: "RI002",
  ruleLevel: "SHOULD",
  ruleRef: "TYPE-001",
  targetId: "T002",
}])));
assert.equal(shouldFixOutput.gate.shouldSetHash, expectedShouldSetHash);

const reorderedShouldFixDir = fs.mkdtempSync(path.join(os.tmpdir(), "rules-review-should-fix-reordered-"));
fs.cpSync(shouldFixDir, reorderedShouldFixDir, { recursive: true });
const reorderedShouldFixPath = path.join(reorderedShouldFixDir, "finalReview.json");
const reorderedShouldFix = readJson(reorderedShouldFixPath);
reorderedShouldFix.findings[0] = {
  targetId: "T002",
  ruleRef: "TYPE-001",
  evidence: [{ summary: "TYPE-001 should finding", loc: "src/example.ts:12" }],
  priority: "should_fix",
  origin: "introduced_by_change",
  ruleLevel: "SHOULD",
  reviewItemId: "RI002",
  findingId: "F001",
};
writeJson(reorderedShouldFixPath, reorderedShouldFix);
const reorderedShouldFixOutput = JSON.parse((await runValidate([
  "--mode",
  "run",
  "--dir",
  reorderedShouldFixDir,
])).stdout);
assert.equal(reorderedShouldFixOutput.gate.shouldSetHash, expectedShouldSetHash);

const multipleShouldFixDir = fs.mkdtempSync(path.join(os.tmpdir(), "rules-review-multiple-should-fix-"));
fs.cpSync(shouldFixDir, multipleShouldFixDir, { recursive: true });
const multipleShouldFixShardPath = path.join(multipleShouldFixDir, "shards/B001.json");
const multipleShouldFixShard = readJson(multipleShouldFixShardPath);
multipleShouldFixShard.results[2] = {
  reviewItemId: "RI003",
  status: "finding",
  origin: "introduced_by_change",
  evidence: [{ loc: "src/example.ts:14", summary: "UI-001 second should finding" }],
  upgradeReason: "UI regression is actionable in the current scope.",
};
writeJson(multipleShouldFixShardPath, multipleShouldFixShard);
await runValidate([
  "--mode",
  "aggregate-final",
  "--dir",
  multipleShouldFixDir,
  "--output",
  path.join(multipleShouldFixDir, "finalReview.json"),
]);
await renderFinalInDir(multipleShouldFixDir);
const multipleShouldFixOutput = JSON.parse((await runValidate([
  "--mode",
  "run",
  "--dir",
  multipleShouldFixDir,
])).stdout);
const expectedMultipleShouldSetHash = hashBytes(Buffer.from(JSON.stringify([
  {
    evidence: [{ loc: "src/example.ts:12", summary: "TYPE-001 should finding" }],
    findingId: "F001",
    origin: "introduced_by_change",
    priority: "should_fix",
    reviewItemId: "RI002",
    ruleLevel: "SHOULD",
    ruleRef: "TYPE-001",
    targetId: "T002",
  },
  {
    evidence: [{ loc: "src/example.ts:14", summary: "UI-001 second should finding" }],
    findingId: "F002",
    origin: "introduced_by_change",
    priority: "should_fix",
    reviewItemId: "RI003",
    ruleLevel: "ADVISORY",
    ruleRef: "UI-001",
    targetId: "T002",
    upgradeReason: "UI regression is actionable in the current scope.",
  },
])));
assert.equal(multipleShouldFixOutput.gate.issueSummary.shouldFix, 2);
assert.equal(multipleShouldFixOutput.gate.shouldSetHash, expectedMultipleShouldSetHash);

multipleShouldFixShard.results[1].evidence[0].summary = "TYPE-001 changed should finding content";
writeJson(multipleShouldFixShardPath, multipleShouldFixShard);
await runValidate([
  "--mode",
  "aggregate-final",
  "--dir",
  multipleShouldFixDir,
  "--output",
  path.join(multipleShouldFixDir, "finalReview.json"),
]);
await renderFinalInDir(multipleShouldFixDir);
const changedMultipleShouldFixOutput = JSON.parse((await runValidate([
  "--mode",
  "run",
  "--dir",
  multipleShouldFixDir,
])).stdout);
assert.equal(changedMultipleShouldFixOutput.gate.issueSummary.shouldFix, 2);
assert.notEqual(changedMultipleShouldFixOutput.gate.shouldSetHash, expectedMultipleShouldSetHash);

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
await assertRunDirFails(exposedObservationDir, /non-ADVISORY observation with exposed_by_change or pre_existing requires evidence/);
const exposedObservationEvidence = [{ loc: "src/example.ts:12", summary: "TYPE-001 concern existed before this change" }];
exposedObservationShard.results[1].evidence = exposedObservationEvidence;
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
    evidence: exposedObservationEvidence,
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

const finalObservationNoEvidenceDir = fs.mkdtempSync(path.join(os.tmpdir(), "rules-review-final-observation-no-evidence-"));
fs.cpSync(exposedObservationDir, finalObservationNoEvidenceDir, { recursive: true });
const finalObservationNoEvidencePath = path.join(finalObservationNoEvidenceDir, "finalReview.json");
const finalObservationNoEvidence = readJson(finalObservationNoEvidencePath);
delete finalObservationNoEvidence.observations[0].evidence;
writeJson(finalObservationNoEvidencePath, finalObservationNoEvidence);
await assertRunDirFails(finalObservationNoEvidenceDir, /non-ADVISORY observation with exposed_by_change or pre_existing requires evidence/);

const preExistingUpgradeDir = fs.mkdtempSync(path.join(os.tmpdir(), "rules-review-pre-existing-upgrade-"));
fs.cpSync(exposedObservationDir, preExistingUpgradeDir, { recursive: true });
const preExistingUpgradeShardPath = path.join(preExistingUpgradeDir, "shards/B001.json");
const preExistingUpgradeShard = readJson(preExistingUpgradeShardPath);
preExistingUpgradeShard.results[1] = {
  reviewItemId: "RI002",
  status: "finding",
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
  origin: "introduced_by_change",
  priority: "should_fix",
  acceptedRisk,
  evidence: mustDowngradeEvidence,
};
writeJson(mustDowngradeShardPath, mustDowngradeShard);
await assertRunDirFails(mustDowngradeDir, /MUST finding priority must be must_fix/);
await assertRunDirFails(mustDowngradeDir, /acceptedRisk is not supported in rules-review results/);

const finalAcceptedRiskDir = fs.mkdtempSync(path.join(os.tmpdir(), "rules-review-final-accepted-risk-"));
fs.cpSync(path.join(fixtures, "run-pass-finding-evidence-key-order"), finalAcceptedRiskDir, { recursive: true });
const finalAcceptedRiskPath = path.join(finalAcceptedRiskDir, "finalReview.json");
const finalAcceptedRisk = readJson(finalAcceptedRiskPath);
finalAcceptedRisk.findings[0].acceptedRisk = acceptedRisk;
writeJson(finalAcceptedRiskPath, finalAcceptedRisk);
await assertRunDirFails(finalAcceptedRiskDir, /finalReview finding must not contain acceptedRisk/);

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
await assertRunFails("run-fail-finding-no-evidence", /finding result requires evidence/);
await assertRunFails("run-fail-finding-no-evidence", /incomplete or blocked semanticVerdict must be unknown/);
await assertRunFails("run-fail-passed-no-evidence", /passed result requires evidence/);
await assertRunFails("run-fail-not-applicable-no-reason", /not_applicable result requires reason/);
await assertRunFails("run-fail-cannot-verify-no-proof", /cannot_verify result requires reason or evidence/);
await assertRunFails("run-fail-missing-source-hash", /sourceHash is required/);
await assertRunFails("run-fail-unclassified-candidate", /selectedRuleRef must be classified as required, excluded, or globallyNotApplicable/);
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
