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
const sourceFixtures = path.join(repoRoot, "tests/rules-review/fixtures");
const nativeTmp = os.tmpdir();
let fixtures;

async function runValidate(args) {
  return execFileAsync(process.execPath, [script, ...args], { cwd: repoRoot });
}

async function assertValidateFails(args, pattern) {
  try {
    await runValidate(args);
  } catch (error) {
    const output = `${error.stdout}${error.stderr}`;
    assert.match(output, pattern);
    return output;
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

function markFinalReviewBlocked(finalReview) {
  Object.assign(finalReview, {
    protocolGate: "blocked",
    coverageClaim: "blocked",
    semanticVerdict: "unknown",
    findings: [],
    observations: [],
    issueSummary: issueSummary(),
    recommendation: "review_blocked",
  });
  delete finalReview.cannotVerifyItems;
  finalReview.validationResults = [runValidationResult(finalReview)];
}

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function hashBytes(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function materializeV3Fixtures() {
  const root = fs.mkdtempSync(path.join(nativeTmp, "rules-review-fixtures-"));
  const fixtureRoot = path.join(root, ".rules-review-tmp");
  fs.mkdirSync(path.join(root, ".agents", "rules"), { recursive: true });
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  const ruleFiles = ["core.md", "type.md", "ui.md"];
  fs.writeFileSync(path.join(root, ".agents", "rules", "index.md"), "# Rules\n");
  ruleFiles.forEach((file) => fs.writeFileSync(path.join(root, ".agents", "rules", file), `# ${file}\n`));
  fs.writeFileSync(path.join(root, "src", "example.ts"), "export const example = true;\n");
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "Test User"]);
  git(root, ["add", "."]);
  git(root, ["commit", "-qm", "fixture inputs"]);
  fs.cpSync(sourceFixtures, fixtureRoot, { recursive: true });

  const indexHash = hashBytes(fs.readFileSync(path.join(root, ".agents", "rules", "index.md")));
  const inputHash = hashBytes(fs.readFileSync(path.join(root, "src", "example.ts")));
  for (const entry of fs.readdirSync(fixtureRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const runDir = path.join(fixtureRoot, entry.name);
    const dispatchPath = path.join(runDir, "dispatch.json");
    const dispatch = readJson(dispatchPath);
    dispatch.schemaVersion = 3;
    dispatch.fullReason = "v3 full fixture";
    dispatch.changedFiles = [];
    dispatch.inputSnapshot = { files: [{ inputRef: "src/example.ts", state: "present", contentHash: inputHash }] };
    dispatch.ruleSet.sourceIndexHash = indexHash;
    for (const target of [...(dispatch.targets?.changedUnits || []), ...(dispatch.targets?.candidates || [])]) {
      target.inputRefs = ["src/example.ts"];
    }
    for (const source of dispatch.ruleSet.ruleSources || []) {
      if (source.sourceHash) {
        const sourcePath = path.join(root, source.sourceFile);
        if (!fs.existsSync(sourcePath)) {
          fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
          fs.writeFileSync(sourcePath, `# ${path.basename(source.sourceFile)}\n`);
        }
        source.sourceHash = hashBytes(fs.readFileSync(sourcePath));
      }
    }
    writeJson(dispatchPath, dispatch);

    for (const relativeDir of ["tasks", "shards", "retries"]) {
      const dir = path.join(runDir, relativeDir);
      if (!fs.existsSync(dir)) continue;
      for (const file of fs.readdirSync(dir).filter((name) => name.endsWith(".json"))) {
        const filePath = path.join(dir, file);
        const artifact = readJson(filePath);
        artifact.schemaVersion = 3;
        for (const target of artifact.targets || []) target.inputRefs = ["src/example.ts"];
        for (const source of artifact.rules || []) {
          if (source.sourceHash) source.sourceHash = hashBytes(fs.readFileSync(path.join(root, source.sourceFile)));
        }
        writeJson(filePath, artifact);
      }
    }
    const finalReviewPath = path.join(runDir, "finalReview.json");
    const finalReview = readJson(finalReviewPath);
    finalReview.schemaVersion = 3;
    writeJson(finalReviewPath, finalReview);
    const finalMdPath = path.join(runDir, "final.md");
    const finalMd = fs.readFileSync(finalMdPath, "utf8")
      .replace(/- sourceIndexHash：.*\n/, `- sourceIndexHash：${indexHash}\n`)
      .replace(/(- reviewBatches：.*\n)/, "$1- fullReason：v3 full fixture\n");
    fs.writeFileSync(finalMdPath, finalMd);
  }
  process.once("exit", () => fs.rmSync(root, { recursive: true, force: true }));
  return fixtureRoot;
}

function createV3RunFixture({ changedFiles, inputRefs = ["src/example.js", "src/deleted.js"], noBatch = false } = {}) {
  const root = fs.mkdtempSync(path.join(fixtures, "rules-review-v3-"));
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
  else delete dispatch.changedFiles;
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

function resultForReviewItem(reviewItemId, status = "passed") {
  const loc = reviewItemId === "RI001" ? "src/changed.ts:1" : "src/stable.ts:1";
  if (status === "passed") {
    return {
      reviewItemId,
      status,
      evidence: [{ loc, summary: `${reviewItemId} checked` }],
      failureChecks: [{
        condition: `${reviewItemId} failure condition checked`,
        outcome: "checked_no_violation",
        evidence: [{ loc, summary: `${reviewItemId} checked` }],
      }],
    };
  }
  if (status === "observation") {
    return {
      reviewItemId,
      status,
      origin: "pre_existing",
      reason: `${reviewItemId} remains observable`,
      evidence: [{ loc, summary: `${reviewItemId} observation evidence` }],
    };
  }
  if (status === "finding") {
    return {
      reviewItemId,
      status,
      origin: "introduced_by_change",
      evidence: [{ loc, summary: `${reviewItemId} finding evidence` }],
    };
  }
  if (status === "cannot_verify") return { reviewItemId, status, reason: `${reviewItemId} lacks current proof` };
  return { reviewItemId, status: "not_applicable", reason: `${reviewItemId} is optional in this fixture` };
}

function refreshDispatchInputs(dispatch, root) {
  dispatch.ruleSet.sourceIndexHash = hashBytes(fs.readFileSync(path.join(root, ".agents/rules/index.md")));
  dispatch.ruleSet.ruleSources.forEach((source) => {
    source.sourceHash = hashBytes(fs.readFileSync(path.join(root, source.sourceFile)));
  });
  const inputRefs = [...new Set([
    ...dispatch.targets.changedUnits,
    ...dispatch.targets.candidates,
  ].flatMap((target) => target.inputRefs || []))].sort();
  dispatch.inputSnapshot = {
    files: inputRefs.map((inputRef) => fs.existsSync(path.join(root, inputRef))
      ? { inputRef, state: "present", contentHash: hashBytes(fs.readFileSync(path.join(root, inputRef))) }
      : { inputRef, state: "deleted" }),
  };
}

function bindDispatchToRoot(dispatch, root) {
  dispatch.targets.changedUnits[0].inputRefs = ["src/changed.ts"];
  dispatch.targets.candidates[0].inputRefs = ["src/stable.ts"];
  refreshDispatchInputs(dispatch, root);
}

function refreshExecutionMetrics(dispatch) {
  Object.assign(dispatch.executionPlan.metrics, {
    changedUnits: dispatch.targets.changedUnits.length,
    candidates: dispatch.targets.candidates.length,
    targets: dispatch.targets.changedUnits.length + dispatch.targets.candidates.length,
    requiredRuleRefs: dispatch.ruleSet.requiredRuleRefs.length,
    reviewItems: dispatch.reviewItems.length,
  });
}

function setIncrementalBatches(dispatch, groups, { userRequestedConcurrency = false } = {}) {
  dispatch.reviewBatches = groups.map((reviewItemIds, index) => {
    const reviewBatchId = `B${dispatch.runId}${index + 1}`;
    return {
      reviewBatchId,
      ruleSetId: dispatch.ruleSet.ruleSetId,
      reviewItemIds,
      taskRef: `tasks/${reviewBatchId}.json`,
      shardRef: `shards/${reviewBatchId}.json`,
      returnStatus: "returned",
      aggregateStatus: "aggregated",
      unaggregatedReason: null,
    };
  });
  Object.assign(dispatch.executionPlan, {
    mode: groups.length === 0 ? "no_batch" : groups.length === 1 ? "single_batch" : "multi_batch",
    selectedBy: "ai",
    signals: { userRequestedConcurrency },
    reason: groups.length === 0 ? "全部 current reviewItems 可安全复用" : "派发机器下界与保守扩审项目",
    humanOverride: null,
  });
  refreshExecutionMetrics(dispatch);
}

async function finalizeIncrementalRun(runDir, dispatchPath, statuses = {}) {
  const dispatch = readJson(dispatchPath);
  if (dispatch.reviewBatches.length > 0) {
    await runValidate(["--mode", "build-tasks", "--dispatch", dispatchPath, "--out", path.join(runDir, "tasks")]);
    fs.mkdirSync(path.join(runDir, "shards"), { recursive: true });
    for (const batch of dispatch.reviewBatches) {
      writeJson(path.join(runDir, batch.shardRef), {
        kind: "rules-review-shard",
        schemaVersion: 3,
        runId: dispatch.runId,
        reviewBatchId: batch.reviewBatchId,
        results: batch.reviewItemIds.map((reviewItemId) => resultForReviewItem(reviewItemId, statuses[reviewItemId])),
      });
    }
  }
  await runValidate(["--mode", "aggregate-final", "--dir", runDir, "--output", path.join(runDir, "finalReview.json")]);
  await renderFinalInDir(runDir);
  await runValidate(["--mode", "run", "--dir", runDir]);
}

async function createNextIncrementalRun(fixture, {
  runId = "R2",
  groups = [],
  statuses = {},
  userRequestedConcurrency = false,
  mutate,
  finalize = true,
} = {}) {
  const previousDir = fixture.currentDir;
  const previousDispatch = readJson(path.join(previousDir, "dispatch.json"));
  const runDir = path.join(path.dirname(previousDir), runId);
  fs.mkdirSync(runDir);
  const dispatch = JSON.parse(JSON.stringify(previousDispatch));
  dispatch.runId = runId;
  dispatch.continuation = { baseRunId: previousDispatch.runId };
  delete dispatch.fullReason;
  if (mutate) mutate(dispatch, fixture.root);
  refreshDispatchInputs(dispatch, fixture.root);
  setIncrementalBatches(dispatch, groups, { userRequestedConcurrency });
  const dispatchPath = path.join(runDir, "dispatch.json");
  writeJson(dispatchPath, dispatch);
  if (finalize) await finalizeIncrementalRun(runDir, dispatchPath, statuses);
  return { ...fixture, previousDir, currentDir: runDir, currentDispatchPath: dispatchPath };
}

function moveTypeReviewToT001(dispatch, { keepT002 = true, removeOptionalT002 = false } = {}) {
  const typeT001 = dispatch.applicabilityMatrix.find((row) => row.ruleRef === "TYPE-001" && row.targetId === "T001");
  Object.assign(typeT001, { applicability: "applicable", reviewItemId: "RI004" });
  delete typeT001.reason;
  dispatch.reviewItems = dispatch.reviewItems.filter((item) => item.reviewItemId !== "RI002" && (!removeOptionalT002 || item.reviewItemId !== "RI003"));
  dispatch.reviewItems.push({
    reviewItemId: "RI004",
    ruleRef: "TYPE-001",
    targetKind: "changed_unit",
    targetId: "T001",
    required: true,
  });
  if (keepT002) {
    const typeT002 = dispatch.applicabilityMatrix.find((row) => row.ruleRef === "TYPE-001" && row.targetId === "T002");
    Object.assign(typeT002, { applicability: "not_applicable", reason: "TYPE-001 no longer applies to T002" });
    delete typeT002.reviewItemId;
    return;
  }
  dispatch.targets.candidates = dispatch.targets.candidates.filter((target) => target.targetId !== "T002");
  dispatch.targets.contextExpansions = dispatch.targets.contextExpansions.filter((entry) => !entry.addedTargetIds.includes("T002"));
  dispatch.applicabilityMatrix = dispatch.applicabilityMatrix.filter((row) => row.targetId !== "T002");
  dispatch.reviewItems = dispatch.reviewItems.filter((item) => item.targetId !== "T002");
}

async function createSingleStepFixture({
  baseStatuses = { RI001: "passed", RI002: "observation", RI003: "not_applicable" },
  changeTarget = false,
  recheckIds = changeTarget ? ["RI001"] : [],
  finalizeCurrent = false,
  extraStableItems = 0,
} = {}) {
  const root = fs.mkdtempSync(path.join(nativeTmp, "rules-review-incremental-"));
  const runRoot = path.join(root, ".rules-review-tmp");
  const baseDir = path.join(runRoot, "R0");
  const currentDir = path.join(runRoot, "R1");
  fs.mkdirSync(path.join(root, ".agents", "rules"), { recursive: true });
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, ".agents/rules/index.md"), "# Rules\n");
  fs.writeFileSync(path.join(root, ".agents/rules/core.md"), "# CORE-001\n");
  fs.writeFileSync(path.join(root, ".agents/rules/type.md"), "# TYPE-001\n");
  fs.writeFileSync(path.join(root, ".agents/rules/ui.md"), "# UI-001\n");
  fs.writeFileSync(path.join(root, "src/changed.ts"), "export const changed = 0;\n");
  fs.writeFileSync(path.join(root, "src/stable.ts"), "export const stable = true;\n");
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "Test User"]);
  git(root, ["add", "."]);
  git(root, ["commit", "-qm", "incremental fixture baseline"]);

  fs.cpSync(path.join(fixtures, "run-pass-full-clean"), baseDir, { recursive: true });
  const baseDispatchPath = path.join(baseDir, "dispatch.json");
  const baseDispatch = readJson(baseDispatchPath);
  baseDispatch.runId = "R0";
  baseDispatch.fullReason = "建立 v3 增量链基线";
  baseDispatch.changedFiles = [];
  for (let index = 0; index < extraStableItems; index += 1) {
    const suffix = String(index + 4).padStart(3, "0");
    const targetId = `T${suffix}`;
    const reviewItemId = `RI${suffix}`;
    baseDispatch.targets.candidates.push({
      targetId,
      targetKind: "candidate",
      loc: `src/stable.ts:${index + 2}`,
      summary: `Stable candidate ${targetId}`,
      inputRefs: ["src/stable.ts"],
    });
    baseDispatch.reviewItems.push({ reviewItemId, ruleRef: "UI-001", targetKind: "candidate", targetId, required: false });
    for (const ruleRef of baseDispatch.ruleSet.requiredRuleRefs) {
      baseDispatch.applicabilityMatrix.push({
        ruleRef,
        targetId,
        targetKind: "candidate",
        applicability: "not_applicable",
        reason: `${ruleRef} does not apply to ${targetId}`,
        evidence: [{ loc: `src/stable.ts:${index + 2}`, summary: `${ruleRef} checked for ${targetId}` }],
      });
    }
    baseDispatch.reviewBatches[0].reviewItemIds.push(reviewItemId);
  }
  Object.assign(baseDispatch.executionPlan.metrics, {
    candidates: baseDispatch.targets.candidates.length,
    targets: baseDispatch.targets.changedUnits.length + baseDispatch.targets.candidates.length,
    reviewItems: baseDispatch.reviewItems.length,
  });
  if (baseDispatch.reviewItems.length > 30) {
    baseDispatch.executionPlan.selectedBy = "human_override";
    baseDispatch.executionPlan.humanOverride = { requestedMode: "single_batch", risk: "基线 fixture 保持单 batch" };
  }
  bindDispatchToRoot(baseDispatch, root);
  writeJson(baseDispatchPath, baseDispatch);
  ["tasks", "shards", "retries"].forEach((dir) => fs.rmSync(path.join(baseDir, dir), { recursive: true, force: true }));
  ["finalReview.json", "final.md", "response.md"].forEach((file) => fs.rmSync(path.join(baseDir, file), { force: true }));
  await runValidate(["--mode", "build-tasks", "--dispatch", baseDispatchPath, "--out", path.join(baseDir, "tasks")]);
  fs.mkdirSync(path.join(baseDir, "shards"), { recursive: true });
  writeJson(path.join(baseDir, "shards/B001.json"), {
    kind: "rules-review-shard",
    schemaVersion: 3,
    runId: "R0",
    reviewBatchId: "B001",
    results: baseDispatch.reviewItems.map((item) => resultForReviewItem(item.reviewItemId, baseStatuses[item.reviewItemId])),
  });
  await runValidate(["--mode", "aggregate-final", "--dir", baseDir, "--output", path.join(baseDir, "finalReview.json")]);
  await renderFinalInDir(baseDir);

  if (changeTarget) fs.writeFileSync(path.join(root, "src/changed.ts"), "export const changed = 1;\n");
  fs.mkdirSync(currentDir);
  const currentDispatch = JSON.parse(JSON.stringify(baseDispatch));
  currentDispatch.runId = "R1";
  delete currentDispatch.fullReason;
  currentDispatch.continuation = { baseRunId: "R0" };
  currentDispatch.changedFiles = changeTarget ? ["src/changed.ts"] : [];
  bindDispatchToRoot(currentDispatch, root);
  currentDispatch.reviewBatches = recheckIds.length === 0 ? [] : [{
    reviewBatchId: "B101",
    ruleSetId: currentDispatch.ruleSet.ruleSetId,
    reviewItemIds: recheckIds,
    taskRef: "tasks/B101.json",
    shardRef: "shards/B101.json",
    returnStatus: "returned",
    aggregateStatus: "aggregated",
    unaggregatedReason: null,
  }];
  Object.assign(currentDispatch.executionPlan, {
    mode: recheckIds.length === 0 ? "no_batch" : "single_batch",
    selectedBy: "ai",
    signals: { userRequestedConcurrency: false },
    reason: recheckIds.length === 0 ? "全部 current reviewItems 可安全复用" : "派发机器下界与保守扩审项目",
    humanOverride: null,
  });
  const currentDispatchPath = path.join(currentDir, "dispatch.json");
  writeJson(currentDispatchPath, currentDispatch);

  if (finalizeCurrent) {
    if (recheckIds.length > 0) {
      await runValidate(["--mode", "build-tasks", "--dispatch", currentDispatchPath, "--out", path.join(currentDir, "tasks")]);
      fs.mkdirSync(path.join(currentDir, "shards"), { recursive: true });
      writeJson(path.join(currentDir, "shards/B101.json"), {
        kind: "rules-review-shard",
        schemaVersion: 3,
        runId: "R1",
        reviewBatchId: "B101",
        results: recheckIds.map((reviewItemId) => resultForReviewItem(reviewItemId)),
      });
    }
    await runValidate(["--mode", "aggregate-final", "--dir", currentDir, "--output", path.join(currentDir, "finalReview.json")]);
    await renderFinalInDir(currentDir);
    await runValidate(["--mode", "run", "--dir", currentDir]);
  }
  return { root, baseDir, currentDir, currentDispatchPath };
}

fixtures = materializeV3Fixtures();

{
  const dir = fs.mkdtempSync(path.join(fixtures, "rules-review-safe-ids-"));
  const sourceDispatchPath = path.join(fixtures, "run-pass-full-clean/dispatch.json");
  const sourceTaskPath = path.join(fixtures, "run-pass-full-clean/tasks/B001.json");
  const sourceShardPath = path.join(fixtures, "run-pass-full-clean/shards/B001.json");
  const sourceFinalPath = path.join(fixtures, "run-pass-full-clean/finalReview.json");

  const safeTokenTypeCases = [
    ["dispatch-runId", "dispatch", () => readJson(sourceDispatchPath), (artifact, value) => { artifact.runId = value; }, /runId must be a safe token/],
    ["dispatch-baseRunId", "dispatch", () => {
      const artifact = readJson(sourceDispatchPath);
      delete artifact.fullReason;
      artifact.continuation = { baseRunId: "R0" };
      return artifact;
    }, (artifact, value) => { artifact.continuation.baseRunId = value; }, /baseRunId must be a safe token/],
    ["dispatch-reviewBatchId", "dispatch", () => readJson(sourceDispatchPath), (artifact, value) => { artifact.reviewBatches[0].reviewBatchId = value; }, /reviewBatchId must be a safe token/],
    ["task-runId", "task", () => readJson(sourceTaskPath), (artifact, value) => { artifact.runId = value; }, /task runId must be a safe token/],
    ["task-reviewBatchId", "task", () => readJson(sourceTaskPath), (artifact, value) => { artifact.reviewBatchId = value; }, /task reviewBatchId must be a safe token/],
    ["retry-runId", "retry-task", () => ({
      kind: "rules-review-retry-task",
      schemaVersion: 3,
      runId: "run-pass-full-clean",
      retryAttempt: 1,
      reason: "Repair invalid JSON.",
      originalTaskRef: "tasks/B001.json",
      violations: [],
      outputContract: { format: "strict_json", schemaRef: "schemas/shard.schema.json" },
    }), (artifact, value) => { artifact.runId = value; }, /retry runId must be a safe token/],
    ["shard-runId", "shard", () => readJson(sourceShardPath), (artifact, value) => { artifact.runId = value; }, /shard runId must be a safe token/],
    ["shard-reviewBatchId", "shard", () => readJson(sourceShardPath), (artifact, value) => { artifact.reviewBatchId = value; }, /shard reviewBatchId must be a safe token/],
    ["final-runId", "final-review", () => readJson(sourceFinalPath), (artifact, value) => { artifact.runId = value; }, /finalReview runId must be a safe token/],
  ];
  for (const [caseName, mode, createArtifact, setValue, pattern] of safeTokenTypeCases) {
    for (const value of [1, true]) {
      const inputPath = path.join(dir, `${caseName}-${typeof value}.json`);
      const artifact = createArtifact();
      setValue(artifact, value);
      writeJson(inputPath, artifact);
      const args = ["--mode", mode, "--input", inputPath];
      if (mode === "shard") args.push("--task", sourceTaskPath);
      await assertValidateFails(args, pattern);
    }
  }

  const unsafeRunTaskPath = path.join(dir, "unsafe-run-task.json");
  const unsafeRunTask = readJson(sourceTaskPath);
  unsafeRunTask.runId = "../run";
  writeJson(unsafeRunTaskPath, unsafeRunTask);
  await assertValidateFails(["--mode", "task", "--input", unsafeRunTaskPath], /task runId must be a safe token/);

  const unsafeBatchTaskPath = path.join(dir, "unsafe-batch-task.json");
  const unsafeBatchTask = readJson(sourceTaskPath);
  unsafeBatchTask.reviewBatchId = "../B001";
  writeJson(unsafeBatchTaskPath, unsafeBatchTask);
  await assertValidateFails(["--mode", "task", "--input", unsafeBatchTaskPath], /task reviewBatchId must be a safe token/);

  const unsafeTargetTaskPath = path.join(dir, "unsafe-target-task.json");
  const unsafeTargetTask = readJson(sourceTaskPath);
  const originalTargetId = unsafeTargetTask.reviewItems[0].targetId;
  unsafeTargetTask.reviewItems[0].targetId = "../T001";
  unsafeTargetTask.targets.find((target) => target.targetId === originalTargetId).targetId = "../T001";
  unsafeTargetTask.applicabilityMatrix.find((entry) => entry.targetId === originalTargetId).targetId = "../T001";
  writeJson(unsafeTargetTaskPath, unsafeTargetTask);
  await assertValidateFails(["--mode", "task", "--input", unsafeTargetTaskPath], /task reviewItem targetId must match/);
  await assertValidateFails(["--mode", "task", "--input", unsafeTargetTaskPath], /task targetId must match/);
  await assertValidateFails(["--mode", "task", "--input", unsafeTargetTaskPath], /task applicability targetId must match/);

  const unsafeRetryPath = path.join(dir, "unsafe-retry.json");
  writeJson(unsafeRetryPath, {
    kind: "rules-review-retry-task",
    schemaVersion: 3,
    runId: "../run",
    retryAttempt: 1,
    reason: "Repair invalid JSON.",
    originalTaskRef: "tasks/B001.json",
    violations: [],
    outputContract: { format: "strict_json", schemaRef: "schemas/shard.schema.json" },
  });
  await assertValidateFails(["--mode", "retry-task", "--input", unsafeRetryPath], /retry runId must be a safe token/);

  const unsafeShardPath = path.join(dir, "unsafe-shard.json");
  const unsafeShard = readJson(sourceShardPath);
  unsafeShard.runId = "../run";
  writeJson(unsafeShardPath, unsafeShard);
  await assertValidateFails(
    ["--mode", "shard", "--task", sourceTaskPath, "--input", unsafeShardPath],
    /shard runId must be a safe token/,
  );

  const unsafeBatchShardPath = path.join(dir, "unsafe-batch-shard.json");
  const unsafeBatchShard = readJson(sourceShardPath);
  unsafeBatchShard.reviewBatchId = "../B001";
  writeJson(unsafeBatchShardPath, unsafeBatchShard);
  await assertValidateFails(
    ["--mode", "shard", "--task", sourceTaskPath, "--input", unsafeBatchShardPath],
    /shard reviewBatchId must be a safe token/,
  );

  const invalidArtifactRefs = [
    ["taskRef", "../outside-task.json", /taskRef must equal tasks\/<reviewBatchId>\.json/],
    ["taskRef", path.join(dir, "outside-task.json"), /taskRef must equal tasks\/<reviewBatchId>\.json/],
    ["taskRef", "./tasks/B001.json", /taskRef must equal tasks\/<reviewBatchId>\.json/],
    ["taskRef", "tasks\\B001.json", /taskRef must equal tasks\/<reviewBatchId>\.json/],
    ["taskRef", "shards/B001.json", /taskRef must equal tasks\/<reviewBatchId>\.json/],
    ["taskRef", "tasks/B999.json", /taskRef must equal tasks\/<reviewBatchId>\.json/],
    ["shardRef", "../outside-shard.json", /shardRef must be null or equal shards\/<reviewBatchId>\.json/],
    ["shardRef", path.join(dir, "outside-shard.json"), /shardRef must be null or equal shards\/<reviewBatchId>\.json/],
    ["shardRef", "./shards/B001.json", /shardRef must be null or equal shards\/<reviewBatchId>\.json/],
    ["shardRef", "shards\\B001.json", /shardRef must be null or equal shards\/<reviewBatchId>\.json/],
    ["shardRef", "tasks/B001.json", /shardRef must be null or equal shards\/<reviewBatchId>\.json/],
    ["shardRef", "shards/B999.json", /shardRef must be null or equal shards\/<reviewBatchId>\.json/],
  ];
  for (const [index, [field, invalidRef, pattern]] of invalidArtifactRefs.entries()) {
    const invalidDispatchPath = path.join(dir, `invalid-${field}-${index}.json`);
    const invalidDispatch = readJson(sourceDispatchPath);
    invalidDispatch.reviewBatches[0][field] = invalidRef;
    writeJson(invalidDispatchPath, invalidDispatch);
    await assertValidateFails(["--mode", "dispatch", "--input", invalidDispatchPath], pattern);
  }

  const pendingDispatchPath = path.join(dir, "pending-null-shard.json");
  const pendingDispatch = readJson(sourceDispatchPath);
  Object.assign(pendingDispatch.reviewBatches[0], {
    shardRef: null,
    returnStatus: "not_started",
    aggregateStatus: "not_aggregated",
  });
  writeJson(pendingDispatchPath, pendingDispatch);
  assert.equal(JSON.parse((await runValidate(["--mode", "dispatch", "--input", pendingDispatchPath])).stdout).ok, true);

  pendingDispatch.reviewBatches[0].returnStatus = "returned";
  writeJson(pendingDispatchPath, pendingDispatch);
  await assertValidateFails(
    ["--mode", "dispatch", "--input", pendingDispatchPath],
    /returned reviewBatch shardRef must equal shards\/<reviewBatchId>\.json/,
  );

  const unsafeFinalPath = path.join(dir, "unsafe-final.json");
  const unsafeFinal = readJson(path.join(fixtures, "run-pass-finding-evidence-key-order/finalReview.json"));
  unsafeFinal.runId = "../run";
  unsafeFinal.findings[0].reviewItemId = "../RI001";
  unsafeFinal.findings[0].targetId = "../T001";
  unsafeFinal.observations = [{
    reviewItemId: "RI002",
    ruleRef: "TYPE-001",
    targetId: "../T002",
    ruleLevel: "SHOULD",
    origin: "pre_existing",
    reason: "shape-only unsafe ID regression",
    evidence: [{ loc: "src/example.ts:12", summary: "unsafe targetId" }],
  }];
  unsafeFinal.cannotVerifyItems = [{
    reviewItemId: "RI003",
    ruleRef: "UI-001",
    targetId: "../T002",
    reason: "shape-only unsafe ID regression",
  }];
  writeJson(unsafeFinalPath, unsafeFinal);
  for (const pattern of [
    /finalReview runId must be a safe token/,
    /final finding reviewItemId must match/,
    /final finding targetId must match/,
    /observation targetId must match/,
    /cannotVerify item targetId must match/,
  ]) {
    await assertValidateFails(["--mode", "final-review", "--input", unsafeFinalPath], pattern);
  }

  const overrideDispatchPath = path.join(dir, "override-dispatch.json");
  const overrideDispatch = readJson(path.join(fixtures, "run-pass-full-clean/dispatch.json"));
  overrideDispatch.executionPlan.selectedBy = "human_override";
  overrideDispatch.executionPlan.humanOverride = { requestedMode: "single_batch" };
  writeJson(overrideDispatchPath, overrideDispatch);
  await assertValidateFails(["--mode", "dispatch", "--input", overrideDispatchPath], /humanOverride.risk must be non-empty string/);
  overrideDispatch.executionPlan.humanOverride = { requestedMode: "multi_batch", risk: "forced mismatch" };
  writeJson(overrideDispatchPath, overrideDispatch);
  await assertValidateFails(["--mode", "dispatch", "--input", overrideDispatchPath], /humanOverride\.requestedMode must match executionPlan\.mode/);
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
    assert.equal(task.schemaVersion, 3);
    assert.deepEqual(task.targets[0].inputRefs, ["src/example.js", "src/deleted.js"]);
    assert.equal(Object.hasOwn(task, "inputSnapshot"), false);
    assert.equal(Object.hasOwn(task, "changedFiles"), false);
    assert.equal(Object.hasOwn(task.targets[0], "contentHash"), false);

    const unrelatedDispatch = JSON.parse(JSON.stringify(sealed));
    unrelatedDispatch.runId = "unrelated-run";
    writeJson(dispatchPath, unrelatedDispatch);
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

    const outside = fs.mkdtempSync(path.join(nativeTmp, "rules-review-v3-outside-"));
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
        pattern: /dispatch schemaVersion must match rules-review protocol/,
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
        pattern: /incremental dispatch forbids fullReason/,
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
    await assertValidateFails(["--mode", "dispatch", "--input", dispatchPath], /full no_batch requires empty current reviewItems/);

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

const builtTasksDir = fs.mkdtempSync(path.join(fixtures, "rules-review-built-tasks-"));
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

const unsortedFindingsDir = fs.mkdtempSync(path.join(fixtures, "rules-review-unsorted-findings-"));
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
  const shardFindingIdDir = fs.mkdtempSync(path.join(fixtures, "rules-review-shard-finding-id-"));
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

const reversedFindingsDir = fs.mkdtempSync(path.join(fixtures, "rules-review-reversed-findings-"));
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
  const tamperedDir = fs.mkdtempSync(path.join(fixtures, `rules-review-final-${name}-`));
  fs.cpSync(unsortedFindingsDir, tamperedDir, { recursive: true });
  const finalReviewPath = path.join(tamperedDir, "finalReview.json");
  const finalReview = readJson(finalReviewPath);
  mutate(finalReview);
  writeJson(finalReviewPath, finalReview);
  await assertRunDirFails(tamperedDir, pattern);
}

const thousandFindingsDir = fs.mkdtempSync(path.join(fixtures, "rules-review-thousand-findings-"));
fs.cpSync(path.join(fixtures, "run-pass-full-clean"), thousandFindingsDir, { recursive: true });
const thousandDispatchPath = path.join(thousandFindingsDir, "dispatch.json");
const thousandDispatch = readJson(thousandDispatchPath);
const coreRule = thousandDispatch.ruleSet.ruleSources.find((rule) => rule.ruleRef === "CORE-001");
const thousandItems = Array.from({ length: 1000 }, (_, index) => {
  const suffix = String(index + 1).padStart(3, "0");
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
    inputRefs: ["src/example.ts"],
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
    schemaVersion: 3,
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
assert.equal(thousandFindings.find((finding) => finding.reviewItemId === "RI999").findingId, "F999");
assert.equal(thousandFindings.find((finding) => finding.reviewItemId === "RI1000").findingId, "F1000");

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
assertNextSection(findingFinal, "## 结论", "## 问题");
assertNextSection(findingFinal, "## 问题", "## 范围");

const noDispatchRenderDir = fs.mkdtempSync(path.join(fixtures, "rules-review-no-dispatch-render-"));
const noDispatchFinalPath = path.join(noDispatchRenderDir, "finalReview.json");
const noDispatchOutputPath = path.join(noDispatchRenderDir, "final.md");
writeJson(noDispatchFinalPath, readJson(path.join(fixtures, "run-pass-finding-evidence-key-order/finalReview.json")));
await assertValidateFails(
  ["--mode", "render-final", "--input", noDispatchFinalPath, "--output", noDispatchOutputPath],
  /render-final requires a same-run dispatch/,
);
assert.equal(fs.existsSync(noDispatchOutputPath), false);

const cannotVerifyDir = fs.mkdtempSync(path.join(fixtures, "rules-review-cannot-verify-"));
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

const mixedDir = fs.mkdtempSync(path.join(fixtures, "rules-review-mixed-"));
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

const emptyValidationDir = fs.mkdtempSync(path.join(fixtures, "rules-review-empty-validation-"));
fs.cpSync(path.join(fixtures, "run-pass-full-clean"), emptyValidationDir, { recursive: true });
const emptyValidationFinalReviewPath = path.join(emptyValidationDir, "finalReview.json");
const emptyValidationFinalReview = readJson(emptyValidationFinalReviewPath);
emptyValidationFinalReview.validationResults = [];
writeJson(emptyValidationFinalReviewPath, emptyValidationFinalReview);
await assertRunDirFails(emptyValidationDir, /validationResults must include validator run summary/);

const badCannotVerifyDir = fs.mkdtempSync(path.join(fixtures, "rules-review-bad-cannot-verify-"));
fs.cpSync(cannotVerifyDir, badCannotVerifyDir, { recursive: true });
const badCannotVerifyFinalReviewPath = path.join(badCannotVerifyDir, "finalReview.json");
const badCannotVerifyFinalReview = readJson(badCannotVerifyFinalReviewPath);
badCannotVerifyFinalReview.cannotVerifyItems[0].targetId = "WRONG";
writeJson(badCannotVerifyFinalReviewPath, badCannotVerifyFinalReview);
await assertRunDirFails(badCannotVerifyDir, /cannotVerifyItems must equal validator result/);

const missingRuleLevelDir = fs.mkdtempSync(path.join(fixtures, "rules-review-missing-rule-level-"));
fs.cpSync(path.join(fixtures, "run-pass-full-clean"), missingRuleLevelDir, { recursive: true });
const missingRuleLevelDispatchPath = path.join(missingRuleLevelDir, "dispatch.json");
const missingRuleLevelDispatch = readJson(missingRuleLevelDispatchPath);
delete missingRuleLevelDispatch.ruleSet.ruleSources[0].ruleLevel;
writeJson(missingRuleLevelDispatchPath, missingRuleLevelDispatch);
await assertRunDirFails(missingRuleLevelDir, /ruleSources\[\]\.ruleLevel must be valid|required field is missing/);

const missingTaskRuleLevelDir = fs.mkdtempSync(path.join(fixtures, "rules-review-missing-task-rule-level-"));
fs.cpSync(path.join(fixtures, "run-pass-full-clean"), missingTaskRuleLevelDir, { recursive: true });
const missingTaskRuleLevelTaskPath = path.join(missingTaskRuleLevelDir, "tasks/B001.json");
const missingTaskRuleLevelTask = readJson(missingTaskRuleLevelTaskPath);
delete missingTaskRuleLevelTask.rules[0].ruleLevel;
writeJson(missingTaskRuleLevelTaskPath, missingTaskRuleLevelTask);
await assertRunDirFails(missingTaskRuleLevelDir, /task ruleLevel must be valid|required field is missing/);

const requiredOutsideSelectedDir = fs.mkdtempSync(path.join(fixtures, "rules-review-required-outside-selected-"));
fs.cpSync(path.join(fixtures, "run-pass-full-clean"), requiredOutsideSelectedDir, { recursive: true });
const requiredOutsideSelectedDispatchPath = path.join(requiredOutsideSelectedDir, "dispatch.json");
const requiredOutsideSelectedDispatch = readJson(requiredOutsideSelectedDispatchPath);
requiredOutsideSelectedDispatch.ruleSet.selectedRuleRefs = ["CORE-001", "UI-001"];
writeJson(requiredOutsideSelectedDispatchPath, requiredOutsideSelectedDispatch);
await assertRunDirFails(requiredOutsideSelectedDir, /requiredRuleRefs must be subset of selectedRuleRefs/);

const missingApplicabilityDir = fs.mkdtempSync(path.join(fixtures, "rules-review-missing-applicability-"));
fs.cpSync(path.join(fixtures, "run-pass-full-clean"), missingApplicabilityDir, { recursive: true });
const missingApplicabilityDispatchPath = path.join(missingApplicabilityDir, "dispatch.json");
const missingApplicabilityDispatch = readJson(missingApplicabilityDispatchPath);
missingApplicabilityDispatch.applicabilityMatrix.pop();
writeJson(missingApplicabilityDispatchPath, missingApplicabilityDispatch);
await assertRunDirFails(missingApplicabilityDir, /applicabilityMatrix must cover every requiredRuleRef x target pair/);

const taskApplicabilityMismatchDir = fs.mkdtempSync(path.join(fixtures, "rules-review-task-applicability-"));
fs.cpSync(path.join(fixtures, "run-pass-full-clean"), taskApplicabilityMismatchDir, { recursive: true });
const taskApplicabilityMismatchTaskPath = path.join(taskApplicabilityMismatchDir, "tasks/B001.json");
const taskApplicabilityMismatchTask = readJson(taskApplicabilityMismatchTaskPath);
taskApplicabilityMismatchTask.applicabilityMatrix = [];
writeJson(taskApplicabilityMismatchTaskPath, taskApplicabilityMismatchTask);
await assertRunDirFails(taskApplicabilityMismatchDir, /task applicabilityMatrix must include each dispatch applicable row/);

const requiredNotApplicableDir = fs.mkdtempSync(path.join(fixtures, "rules-review-required-not-applicable-"));
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

const missingContextReasonDir = fs.mkdtempSync(path.join(fixtures, "rules-review-missing-context-reason-"));
fs.cpSync(path.join(fixtures, "run-pass-full-clean"), missingContextReasonDir, { recursive: true });
const missingContextReasonDispatchPath = path.join(missingContextReasonDir, "dispatch.json");
const missingContextReasonDispatch = readJson(missingContextReasonDispatchPath);
delete missingContextReasonDispatch.targets.contextExpansions[0].reason;
writeJson(missingContextReasonDispatchPath, missingContextReasonDispatch);
await assertRunDirFails(missingContextReasonDir, /contextExpansion reason must be non-empty string/);

const passedNoFailureChecksDir = fs.mkdtempSync(path.join(fixtures, "rules-review-passed-no-failure-checks-"));
fs.cpSync(path.join(fixtures, "run-pass-full-clean"), passedNoFailureChecksDir, { recursive: true });
const passedNoFailureChecksShardPath = path.join(passedNoFailureChecksDir, "shards/B001.json");
const passedNoFailureChecksShard = readJson(passedNoFailureChecksShardPath);
delete passedNoFailureChecksShard.results[0].failureChecks;
writeJson(passedNoFailureChecksShardPath, passedNoFailureChecksShard);
await assertRunDirFails(passedNoFailureChecksDir, /passed result requires failureChecks/);

const taskMissingFailureConditionsDir = fs.mkdtempSync(path.join(fixtures, "rules-review-task-missing-failure-conditions-"));
fs.cpSync(path.join(fixtures, "run-pass-full-clean"), taskMissingFailureConditionsDir, { recursive: true });
const taskMissingFailureConditionsDispatchPath = path.join(taskMissingFailureConditionsDir, "dispatch.json");
const taskMissingFailureConditionsDispatch = readJson(taskMissingFailureConditionsDispatchPath);
taskMissingFailureConditionsDispatch.ruleSet.ruleSources[0].failureConditions = [
  { conditionId: "CORE-001-FC001", summary: "CORE-001 must not regress the changed request parameter." },
];
writeJson(taskMissingFailureConditionsDispatchPath, taskMissingFailureConditionsDispatch);
await assertRunDirFails(taskMissingFailureConditionsDir, /task\.rules\[\]\.failureConditions must match dispatch ruleSources\[\]\.failureConditions/);

const emptyRequiredContextExpansionDir = fs.mkdtempSync(path.join(fixtures, "rules-review-empty-required-context-"));
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

const retryValidationDir = fs.mkdtempSync(path.join(fixtures, "rules-review-retry-validation-"));
fs.cpSync(path.join(fixtures, "run-pass-full-clean"), retryValidationDir, { recursive: true });
const retryValidationPath = path.join(retryValidationDir, "retries/B001-retry-1.json");
fs.mkdirSync(path.dirname(retryValidationPath), { recursive: true });
const retryTask = {
  kind: "rules-review-retry-task",
  schemaVersion: 3,
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

const unboundRetryDir = fs.mkdtempSync(path.join(fixtures, "rules-review-unbound-retry-"));
fs.cpSync(path.join(fixtures, "run-pass-full-clean"), unboundRetryDir, { recursive: true });
const unboundRetryPath = path.join(unboundRetryDir, "retries/B001-retry-1.json");
fs.mkdirSync(path.dirname(unboundRetryPath), { recursive: true });
writeJson(unboundRetryPath, {
  kind: "rules-review-retry-task",
  schemaVersion: 3,
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

const forbiddenPriorReviewDir = fs.mkdtempSync(path.join(fixtures, "rules-review-forbidden-prior-"));
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

const forbiddenPriorArtifactDir = fs.mkdtempSync(path.join(fixtures, "rules-review-forbidden-prior-artifact-"));
fs.cpSync(path.join(fixtures, "run-pass-full-clean"), forbiddenPriorArtifactDir, { recursive: true });
const forbiddenPriorArtifactDispatchPath = path.join(forbiddenPriorArtifactDir, "dispatch.json");
const forbiddenPriorArtifactDispatch = readJson(forbiddenPriorArtifactDispatchPath);
forbiddenPriorArtifactDispatch.targets.changedUnits[0].source = ".rules-review-tmp/old/final.md";
writeJson(forbiddenPriorArtifactDispatchPath, forbiddenPriorArtifactDispatch);
await assertRunDirFails(forbiddenPriorArtifactDir, /dispatch must not reference prior review artifacts/);

const forbiddenRunScriptDir = fs.mkdtempSync(path.join(fixtures, "rules-review-forbidden-run-script-"));
fs.cpSync(path.join(fixtures, "run-pass-full-clean"), forbiddenRunScriptDir, { recursive: true });
fs.writeFileSync(path.join(forbiddenRunScriptDir, "generate.mjs"), "export {};\n");
await assertRunDirFails(forbiddenRunScriptDir, /run directory must only contain rules-review protocol artifacts/);

const symlinkedRunTarget = fs.mkdtempSync(path.join(fixtures, "rules-review-symlinked-run-target-"));
fs.cpSync(path.join(fixtures, "run-pass-full-clean"), symlinkedRunTarget, { recursive: true });
const symlinkedRunDir = `${symlinkedRunTarget}-link`;
fs.symlinkSync(symlinkedRunTarget, symlinkedRunDir, "dir");
await assertRunDirFails(symlinkedRunDir, /run directory must not be a symbolic link/);

const symlinkedShardDir = fs.mkdtempSync(path.join(fixtures, "rules-review-symlinked-shard-"));
fs.cpSync(path.join(fixtures, "run-pass-full-clean"), symlinkedShardDir, { recursive: true });
const symlinkedShardTarget = path.join(path.dirname(symlinkedShardDir), `${path.basename(symlinkedShardDir)}-B001.json`);
fs.writeFileSync(symlinkedShardTarget, "not JSON\n");
fs.rmSync(path.join(symlinkedShardDir, "shards/B001.json"));
fs.symlinkSync(symlinkedShardTarget, path.join(symlinkedShardDir, "shards/B001.json"), "file");
await assertRunDirFails(symlinkedShardDir, /run tree must not contain symbolic links|symbolic link is forbidden/);

const symlinkedArtifactsDir = fs.mkdtempSync(path.join(fixtures, "rules-review-symlinked-artifacts-"));
fs.cpSync(path.join(fixtures, "run-pass-full-clean"), symlinkedArtifactsDir, { recursive: true });
const realShardsDir = `${symlinkedArtifactsDir}-shards`;
fs.renameSync(path.join(symlinkedArtifactsDir, "shards"), realShardsDir);
fs.symlinkSync(realShardsDir, path.join(symlinkedArtifactsDir, "shards"), "dir");
await assertRunDirFails(symlinkedArtifactsDir, /run tree must not contain symbolic links|symbolic link is forbidden/);

const shouldFixDir = fs.mkdtempSync(path.join(fixtures, "rules-review-should-fix-"));
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

const reorderedShouldFixDir = fs.mkdtempSync(path.join(fixtures, "rules-review-should-fix-reordered-"));
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

const multipleShouldFixDir = fs.mkdtempSync(path.join(fixtures, "rules-review-multiple-should-fix-"));
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

const shouldPriorityOverrideDir = fs.mkdtempSync(path.join(fixtures, "rules-review-should-priority-override-"));
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

const advisoryObservationDir = fs.mkdtempSync(path.join(fixtures, "rules-review-advisory-observation-"));
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

const advisoryUpgradeDir = fs.mkdtempSync(path.join(fixtures, "rules-review-advisory-upgrade-"));
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

const exposedObservationDir = fs.mkdtempSync(path.join(fixtures, "rules-review-exposed-observation-"));
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

const finalObservationNoEvidenceDir = fs.mkdtempSync(path.join(fixtures, "rules-review-final-observation-no-evidence-"));
fs.cpSync(exposedObservationDir, finalObservationNoEvidenceDir, { recursive: true });
const finalObservationNoEvidencePath = path.join(finalObservationNoEvidenceDir, "finalReview.json");
const finalObservationNoEvidence = readJson(finalObservationNoEvidencePath);
delete finalObservationNoEvidence.observations[0].evidence;
writeJson(finalObservationNoEvidencePath, finalObservationNoEvidence);
await assertRunDirFails(finalObservationNoEvidenceDir, /non-ADVISORY observation with exposed_by_change or pre_existing requires evidence/);

const preExistingUpgradeDir = fs.mkdtempSync(path.join(fixtures, "rules-review-pre-existing-upgrade-"));
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

const mustDowngradeDir = fs.mkdtempSync(path.join(fixtures, "rules-review-must-downgrade-"));
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

const finalAcceptedRiskDir = fs.mkdtempSync(path.join(fixtures, "rules-review-final-accepted-risk-"));
fs.cpSync(path.join(fixtures, "run-pass-finding-evidence-key-order"), finalAcceptedRiskDir, { recursive: true });
const finalAcceptedRiskPath = path.join(finalAcceptedRiskDir, "finalReview.json");
const finalAcceptedRisk = readJson(finalAcceptedRiskPath);
finalAcceptedRisk.findings[0].acceptedRisk = acceptedRisk;
writeJson(finalAcceptedRiskPath, finalAcceptedRisk);
await assertRunDirFails(finalAcceptedRiskDir, /finalReview finding must not contain acceptedRisk/);

const shouldAndCannotVerifyDir = fs.mkdtempSync(path.join(fixtures, "rules-review-should-and-cannot-"));
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

const finalPriorityTamperDir = fs.mkdtempSync(path.join(fixtures, "rules-review-final-priority-tamper-"));
fs.cpSync(shouldFixDir, finalPriorityTamperDir, { recursive: true });
const finalPriorityTamperFinalReviewPath = path.join(finalPriorityTamperDir, "finalReview.json");
const finalPriorityTamperFinalReview = readJson(finalPriorityTamperFinalReviewPath);
finalPriorityTamperFinalReview.findings[0].priority = "must_fix";
writeJson(finalPriorityTamperFinalReviewPath, finalPriorityTamperFinalReview);
await assertRunDirFails(finalPriorityTamperDir, /finalReview findings must equal validator result/);

const finalRuleLevelTamperDir = fs.mkdtempSync(path.join(fixtures, "rules-review-final-rule-level-tamper-"));
fs.cpSync(shouldFixDir, finalRuleLevelTamperDir, { recursive: true });
const finalRuleLevelTamperFinalReviewPath = path.join(finalRuleLevelTamperDir, "finalReview.json");
const finalRuleLevelTamperFinalReview = readJson(finalRuleLevelTamperFinalReviewPath);
finalRuleLevelTamperFinalReview.findings[0].ruleLevel = "MUST";
writeJson(finalRuleLevelTamperFinalReviewPath, finalRuleLevelTamperFinalReview);
await assertRunDirFails(finalRuleLevelTamperDir, /finalReview findings must equal validator result/);

const finalOriginTamperDir = fs.mkdtempSync(path.join(fixtures, "rules-review-final-origin-tamper-"));
fs.cpSync(shouldFixDir, finalOriginTamperDir, { recursive: true });
const finalOriginTamperFinalReviewPath = path.join(finalOriginTamperDir, "finalReview.json");
const finalOriginTamperFinalReview = readJson(finalOriginTamperFinalReviewPath);
finalOriginTamperFinalReview.findings[0].origin = "worsened_by_change";
writeJson(finalOriginTamperFinalReviewPath, finalOriginTamperFinalReview);
await assertRunDirFails(finalOriginTamperDir, /finalReview findings must equal validator result/);

const finalObservationTamperDir = fs.mkdtempSync(path.join(fixtures, "rules-review-final-observation-tamper-"));
fs.cpSync(advisoryObservationDir, finalObservationTamperDir, { recursive: true });
const finalObservationTamperFinalReviewPath = path.join(finalObservationTamperDir, "finalReview.json");
const finalObservationTamperFinalReview = readJson(finalObservationTamperFinalReviewPath);
finalObservationTamperFinalReview.observations[0].origin = "pre_existing";
writeJson(finalObservationTamperFinalReviewPath, finalObservationTamperFinalReview);
await assertRunDirFails(finalObservationTamperDir, /finalReview observations must equal validator result/);

{
  const fixture = await createSingleStepFixture({ changeTarget: true, finalizeCurrent: true });
  try {
    const dispatch = readJson(fixture.currentDispatchPath);
    const finalReview = readJson(path.join(fixture.currentDir, "finalReview.json"));
    const task = readJson(path.join(fixture.currentDir, "tasks/B101.json"));
    const shard = readJson(path.join(fixture.currentDir, "shards/B101.json"));
    assert.deepEqual(dispatch.continuation, { baseRunId: "R0" });
    assert.deepEqual(task.reviewItems.map((item) => item.reviewItemId), ["RI001"]);
    assert.deepEqual(shard.results.map((item) => item.reviewItemId), ["RI001"]);
    assert.deepEqual(finalReview.issueSummary, issueSummary({ observations: 1 }));
    assert.deepEqual(finalReview.observations.map((item) => item.reviewItemId), ["RI002"]);
    assert.equal(Object.hasOwn(finalReview, "effectiveResults"), false);
    finalReview.semanticVerdict = "clean";
    finalReview.observations = [];
    finalReview.issueSummary = issueSummary();
    finalReview.validationResults = [runValidationResult(finalReview)];
    writeJson(path.join(fixture.currentDir, "finalReview.json"), finalReview);
    await assertRunDirFails(fixture.currentDir, /finalReview observations must/);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

{
  const fixture = await createSingleStepFixture({ changeTarget: true, finalizeCurrent: true });
  try {
    const dispatch = readJson(fixture.currentDispatchPath);
    const runRoot = path.dirname(fixture.currentDir);
    const taskPath = path.join(fixture.currentDir, "tasks/B101.json");
    const externalTaskPath = path.join(runRoot, "external-current-task.json");
    fs.copyFileSync(taskPath, externalTaskPath);
    fs.rmSync(taskPath);
    dispatch.reviewBatches[0].taskRef = "../external-current-task.json";
    writeJson(fixture.currentDispatchPath, dispatch);
    const taskEscapeOutput = await assertValidateFails(
      ["--mode", "run", "--dir", fixture.currentDir],
      /taskRef must equal tasks\/<reviewBatchId>\.json/,
    );
    assert.match(taskEscapeOutput, /batched reviewItem must have exactly one current shard result/);

    fs.copyFileSync(externalTaskPath, taskPath);
    fs.rmSync(externalTaskPath);
    dispatch.reviewBatches[0].taskRef = "tasks/B101.json";
    const shardPath = path.join(fixture.currentDir, "shards/B101.json");
    const externalShardPath = path.join(runRoot, "external-current-shard.json");
    fs.copyFileSync(shardPath, externalShardPath);
    fs.rmSync(shardPath);
    dispatch.reviewBatches[0].shardRef = "../external-current-shard.json";
    writeJson(fixture.currentDispatchPath, dispatch);
    const shardEscapeOutput = await assertValidateFails(
      ["--mode", "run", "--dir", fixture.currentDir],
      /shardRef must be null or equal shards\/<reviewBatchId>\.json/,
    );
    assert.match(shardEscapeOutput, /batched reviewItem must have exactly one current shard result/);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

{
  const fixture = await createSingleStepFixture({ recheckIds: ["RI001"] });
  try {
    const baseDispatchPath = path.join(fixture.baseDir, "dispatch.json");
    const baseDispatch = readJson(baseDispatchPath);
    const runRoot = path.dirname(fixture.baseDir);
    const taskPath = path.join(fixture.baseDir, "tasks/B001.json");
    const externalTaskPath = path.join(runRoot, "external-base-task.json");
    fs.copyFileSync(taskPath, externalTaskPath);
    fs.rmSync(taskPath);
    baseDispatch.reviewBatches[0].taskRef = "../external-base-task.json";
    writeJson(baseDispatchPath, baseDispatch);
    const taskEscapeOutput = await assertValidateFails(
      ["--mode", "dispatch", "--input", fixture.currentDispatchPath],
      /taskRef must equal tasks\/<reviewBatchId>\.json/,
    );
    assert.match(taskEscapeOutput, /batched reviewItem must have exactly one current shard result/);

    fs.copyFileSync(externalTaskPath, taskPath);
    fs.rmSync(externalTaskPath);
    baseDispatch.reviewBatches[0].taskRef = "tasks/B001.json";
    const shardPath = path.join(fixture.baseDir, "shards/B001.json");
    const externalShardPath = path.join(runRoot, "external-base-shard.json");
    fs.copyFileSync(shardPath, externalShardPath);
    fs.rmSync(shardPath);
    baseDispatch.reviewBatches[0].shardRef = "../external-base-shard.json";
    writeJson(baseDispatchPath, baseDispatch);
    const shardEscapeOutput = await assertValidateFails(
      ["--mode", "dispatch", "--input", fixture.currentDispatchPath],
      /shardRef must be null or equal shards\/<reviewBatchId>\.json/,
    );
    assert.match(shardEscapeOutput, /batched reviewItem must have exactly one current shard result/);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

{
  const fixture = await createSingleStepFixture({ finalizeCurrent: true });
  try {
    const dispatch = readJson(fixture.currentDispatchPath);
    const finalReview = readJson(path.join(fixture.currentDir, "finalReview.json"));
    assert.equal(dispatch.executionPlan.mode, "no_batch");
    assert.deepEqual(dispatch.reviewBatches, []);
    assert.equal(fs.existsSync(path.join(fixture.currentDir, "tasks")), false);
    assert.equal(fs.existsSync(path.join(fixture.currentDir, "shards")), false);
    assert.equal(fs.existsSync(path.join(fixture.currentDir, "retries")), false);
    assert.deepEqual(finalReview.issueSummary, issueSummary({ observations: 1 }));
    assert.deepEqual(finalReview.observations.map((item) => item.reviewItemId), ["RI002"]);
    const response = await runValidate(["--mode", "render-response", "--dir", fixture.currentDir]);
    assert.equal(JSON.parse(response.stdout).ok, true);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

{
  const runDir = fs.mkdtempSync(path.join(fixtures, "rules-review-render-missing-shard-"));
  fs.cpSync(path.join(fixtures, "run-pass-full-clean"), runDir, { recursive: true });
  const finalReviewPath = path.join(runDir, "finalReview.json");
  const outputPath = path.join(runDir, "final.md");
  fs.rmSync(outputPath);
  fs.rmSync(path.join(runDir, "shards/B001.json"));
  const finalReview = readJson(finalReviewPath);
  markFinalReviewBlocked(finalReview);
  writeJson(finalReviewPath, finalReview);
  await assertValidateFails(
    ["--mode", "render-final", "--input", finalReviewPath, "--dispatch", path.join(runDir, "dispatch.json"), "--output", outputPath],
    /input is not strict JSON or file is unreadable/,
  );
  assert.equal(fs.existsSync(outputPath), false);
}

{
  const fixture = await createSingleStepFixture({ finalizeCurrent: true });
  try {
    const finalReviewPath = path.join(fixture.currentDir, "finalReview.json");
    const outputPath = path.join(fixture.currentDir, "final.md");
    fs.rmSync(outputPath);
    fs.writeFileSync(path.join(fixture.baseDir, "finalReview.json"), "{\n");
    const finalReview = readJson(finalReviewPath);
    markFinalReviewBlocked(finalReview);
    writeJson(finalReviewPath, finalReview);
    await assertValidateFails(
      ["--mode", "render-final", "--input", finalReviewPath, "--dispatch", fixture.currentDispatchPath, "--output", outputPath],
      /input is not strict JSON or file is unreadable/,
    );
    assert.equal(fs.existsSync(outputPath), false);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

{
  const fixture = await createSingleStepFixture({ recheckIds: ["RI001"], extraStableItems: 28 });
  try {
    const dispatch = readJson(fixture.currentDispatchPath);
    assert.equal(dispatch.reviewItems.length, 31);
    assert.deepEqual(dispatch.reviewBatches.flatMap((batch) => batch.reviewItemIds), ["RI001"]);
    assert.equal(dispatch.executionPlan.mode, "single_batch");
    const validation = await runValidate(["--mode", "dispatch", "--input", fixture.currentDispatchPath]);
    assert.equal(JSON.parse(validation.stdout).ok, true);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

{
  const fixture = await createSingleStepFixture({ recheckIds: ["RI001"] });
  try {
    const baseDispatchPath = path.join(fixture.baseDir, "dispatch.json");
    const baseDispatch = readJson(baseDispatchPath);
    delete baseDispatch.fullReason;
    writeJson(baseDispatchPath, baseDispatch);
    await assertValidateFails(["--mode", "dispatch", "--input", baseDispatchPath], /full dispatch requires non-empty fullReason/);
    baseDispatch.fullReason = "完整重审";
    baseDispatch.reviewBatches[0].reviewItemIds = ["RI001"];
    writeJson(baseDispatchPath, baseDispatch);
    await assertValidateFails(["--mode", "dispatch", "--input", baseDispatchPath], /reviewItem must be assigned to one reviewBatch/);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

{
  const fixture = await createSingleStepFixture({ recheckIds: ["RI001"] });
  try {
    const dispatch = readJson(fixture.currentDispatchPath);
    dispatch.fullReason = "不能同时声明 full 与 incremental";
    writeJson(fixture.currentDispatchPath, dispatch);
    await assertValidateFails(["--mode", "dispatch", "--input", fixture.currentDispatchPath], /incremental dispatch forbids fullReason/);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

{
  const fixture = await createSingleStepFixture({ recheckIds: ["RI001"] });
  try {
    const dispatch = readJson(fixture.currentDispatchPath);
    dispatch.continuation.baseRunId = "../R0";
    writeJson(fixture.currentDispatchPath, dispatch);
    await assertValidateFails(["--mode", "dispatch", "--input", fixture.currentDispatchPath], /baseRunId must be a safe token/);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

{
  const fixture = await createSingleStepFixture({ recheckIds: ["RI001"] });
  try {
    const dispatch = readJson(fixture.currentDispatchPath);
    dispatch.continuation.baseRunId = "R1";
    writeJson(fixture.currentDispatchPath, dispatch);
    await assertValidateFails(["--mode", "dispatch", "--input", fixture.currentDispatchPath], /incremental base must not reference the current run/);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

{
  const fixture = await createSingleStepFixture({ recheckIds: ["RI001"] });
  try {
    const baseDispatchPath = path.join(fixture.baseDir, "dispatch.json");
    const baseDispatch = readJson(baseDispatchPath);
    delete baseDispatch.fullReason;
    baseDispatch.continuation = { baseRunId: "R1" };
    writeJson(baseDispatchPath, baseDispatch);
    await assertValidateFails(["--mode", "dispatch", "--input", fixture.currentDispatchPath], /continuation cycle detected/);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

{
  const fixture = await createSingleStepFixture({ recheckIds: ["RI001"] });
  try {
    const baseDispatchPath = path.join(fixture.baseDir, "dispatch.json");
    const baseDispatch = readJson(baseDispatchPath);
    baseDispatch.schemaVersion = 2;
    writeJson(baseDispatchPath, baseDispatch);
    await assertValidateFails(["--mode", "dispatch", "--input", fixture.currentDispatchPath], /incremental base must use schemaVersion 3/);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

{
  const fixture = await createSingleStepFixture({ recheckIds: ["RI001"] });
  try {
    fs.rmSync(path.join(fixture.baseDir, "finalReview.json"));
    await assertValidateFails(["--mode", "dispatch", "--input", fixture.currentDispatchPath], /input is not strict JSON or file is unreadable/);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

{
  const fixture = await createSingleStepFixture({ recheckIds: ["RI001"] });
  try {
    const dispatch = readJson(fixture.currentDispatchPath);
    dispatch.reviewBatches[0].reviewItemIds = ["RI001", "RI002", "RI003"];
    writeJson(fixture.currentDispatchPath, dispatch);
    await assertValidateFails(["--mode", "dispatch", "--input", fixture.currentDispatchPath], /incremental reviewBatches must be a true subset/);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

{
  const fixture = await createSingleStepFixture({
    baseStatuses: { RI001: "finding", RI002: "cannot_verify", RI003: "not_applicable" },
    recheckIds: ["RI003"],
  });
  try {
    await assertValidateFails(["--mode", "dispatch", "--input", fixture.currentDispatchPath], /must include every machine-mandatory recheck item/);
    await assertValidateFails(["--mode", "dispatch", "--input", fixture.currentDispatchPath], /incremental dispatch must reuse at least one base result/);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

{
  const fixture = await createSingleStepFixture({ changeTarget: true, recheckIds: ["RI002"] });
  try {
    await assertValidateFails(["--mode", "dispatch", "--input", fixture.currentDispatchPath], /must include every machine-mandatory recheck item/);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

{
  const fixture = await createSingleStepFixture({ recheckIds: ["RI001"] });
  try {
    const dispatch = readJson(fixture.currentDispatchPath);
    fs.writeFileSync(path.join(fixture.root, ".agents/rules/type.md"), "# TYPE-001 changed\n");
    const source = dispatch.ruleSet.ruleSources.find((item) => item.ruleRef === "TYPE-001");
    source.sourceHash = hashBytes(fs.readFileSync(path.join(fixture.root, source.sourceFile)));
    writeJson(fixture.currentDispatchPath, dispatch);
    await assertValidateFails(["--mode", "dispatch", "--input", fixture.currentDispatchPath], /must include every machine-mandatory recheck item/);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

{
  const fixture = await createSingleStepFixture({ recheckIds: ["RI001"] });
  try {
    const baseDispatchPath = path.join(fixture.baseDir, "dispatch.json");
    const baseDispatch = readJson(baseDispatchPath);
    baseDispatch.reviewItems[2].ruleRef = "TYPE-001";
    writeJson(baseDispatchPath, baseDispatch);
    await assertValidateFails(
      ["--mode", "dispatch", "--input", baseDispatchPath],
      /ruleRef x targetId tuple must map to exactly one reviewItemId/,
    );
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

{
  const fixture = await createSingleStepFixture({ recheckIds: ["RI001"] });
  try {
    const baseDispatchPath = path.join(fixture.baseDir, "dispatch.json");
    const baseDispatch = readJson(baseDispatchPath);
    baseDispatch.reviewItems[2].ruleRef = "TYPE-001";
    writeJson(baseDispatchPath, baseDispatch);
    await assertValidateFails(
      ["--mode", "dispatch", "--input", fixture.currentDispatchPath],
      /ruleRef x targetId tuple must map to exactly one reviewItemId/,
    );
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

{
  const fixture = await createSingleStepFixture({ recheckIds: ["RI001"] });
  try {
    const dispatch = readJson(fixture.currentDispatchPath);
    dispatch.reviewItems[2].ruleRef = "TYPE-001";
    writeJson(fixture.currentDispatchPath, dispatch);
    await assertValidateFails(
      ["--mode", "dispatch", "--input", fixture.currentDispatchPath],
      /ruleRef x targetId tuple must map to exactly one reviewItemId/,
    );
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

{
  const fixture = await createSingleStepFixture({ recheckIds: ["RI001"] });
  try {
    const dispatch = readJson(fixture.currentDispatchPath);
    const firstId = dispatch.reviewItems[0].reviewItemId;
    dispatch.reviewItems[0].reviewItemId = dispatch.reviewItems[1].reviewItemId;
    dispatch.reviewItems[1].reviewItemId = firstId;
    dispatch.applicabilityMatrix.forEach((row) => {
      if (row.reviewItemId === "RI001") row.reviewItemId = "RI002";
      else if (row.reviewItemId === "RI002") row.reviewItemId = "RI001";
    });
    writeJson(fixture.currentDispatchPath, dispatch);
    await assertValidateFails(["--mode", "dispatch", "--input", fixture.currentDispatchPath], /reviewItemId must keep the same ruleRef x targetId tuple/);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

{
  const fixture = await createSingleStepFixture({ recheckIds: ["RI001"] });
  try {
    const dispatch = readJson(fixture.currentDispatchPath);
    dispatch.reviewItems.push({
      reviewItemId: "RI000",
      ruleRef: "UI-001",
      targetKind: "changed_unit",
      targetId: "T001",
      required: false,
    });
    dispatch.executionPlan.metrics.reviewItems = 4;
    writeJson(fixture.currentDispatchPath, dispatch);
    await assertValidateFails(["--mode", "dispatch", "--input", fixture.currentDispatchPath], /new reviewItemId must be greater than every reviewItemId/);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

{
  const fixture = await createSingleStepFixture({ recheckIds: ["RI001"] });
  try {
    const dispatch = readJson(fixture.currentDispatchPath);
    dispatch.targets.candidates.push({
      targetId: "T003",
      targetKind: "candidate",
      loc: "src/stable.ts:2",
      summary: "new candidate",
      inputRefs: ["src/stable.ts"],
    });
    dispatch.reviewItems.push({
      reviewItemId: "RI004",
      ruleRef: "CORE-001",
      targetKind: "candidate",
      targetId: "T003",
      required: true,
    });
    dispatch.applicabilityMatrix.push(
      {
        ruleRef: "CORE-001",
        targetId: "T003",
        targetKind: "candidate",
        applicability: "applicable",
        reviewItemId: "RI004",
        evidence: [{ loc: "src/stable.ts:2", summary: "CORE-001 applies to T003" }],
      },
      {
        ruleRef: "TYPE-001",
        targetId: "T003",
        targetKind: "candidate",
        applicability: "not_applicable",
        reason: "TYPE-001 does not apply to T003",
        evidence: [{ loc: "src/stable.ts:2", summary: "TYPE-001 checked for T003" }],
      },
    );
    Object.assign(dispatch.executionPlan.metrics, { candidates: 2, targets: 3, reviewItems: 4 });
    writeJson(fixture.currentDispatchPath, dispatch);
    await assertValidateFails(["--mode", "dispatch", "--input", fixture.currentDispatchPath], /must include every machine-mandatory recheck item/);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

{
  const fixture = await createSingleStepFixture({ recheckIds: ["RI001"] });
  try {
    const dispatch = readJson(fixture.currentDispatchPath);
    dispatch.reviewItems = dispatch.reviewItems.filter((item) => item.reviewItemId !== "RI003");
    dispatch.executionPlan.metrics.reviewItems = 2;
    writeJson(fixture.currentDispatchPath, dispatch);
    const validation = await runValidate(["--mode", "dispatch", "--input", fixture.currentDispatchPath]);
    assert.equal(JSON.parse(validation.stdout).ok, true);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

{
  const fixture = await createSingleStepFixture({ finalizeCurrent: true });
  try {
    const chain = await createNextIncrementalRun(fixture, { userRequestedConcurrency: true });
    const dispatch = readJson(chain.currentDispatchPath);
    const finalReview = readJson(path.join(chain.currentDir, "finalReview.json"));
    assert.deepEqual(dispatch.continuation, { baseRunId: "R1" });
    assert.equal(dispatch.executionPlan.mode, "no_batch");
    assert.deepEqual(dispatch.reviewBatches, []);
    assert.equal(dispatch.reviewItems.find((item) => item.reviewItemId === "RI003").required, false);
    assert.deepEqual(finalReview.issueSummary, issueSummary({ observations: 1 }));
    assert.deepEqual(finalReview.observations.map((item) => item.reviewItemId), ["RI002"]);
    assert.equal(Object.hasOwn(finalReview, "effectiveResults"), false);
    for (const dir of ["tasks", "retries", "shards"]) assert.equal(fs.existsSync(path.join(chain.currentDir, dir)), false);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

{
  const fixture = await createSingleStepFixture({ finalizeCurrent: true });
  try {
    const chain = await createNextIncrementalRun(fixture, {
      groups: [["RI001"]],
      userRequestedConcurrency: true,
    });
    assert.equal(readJson(chain.currentDispatchPath).executionPlan.mode, "single_batch");

    const override = await createNextIncrementalRun(fixture, {
      runId: "R2override",
      groups: [["RI001"]],
      finalize: false,
    });
    const overrideDispatch = readJson(override.currentDispatchPath);
    Object.assign(overrideDispatch.executionPlan, {
      mode: "multi_batch",
      selectedBy: "human_override",
      humanOverride: { requestedMode: "multi_batch", risk: "用户要求并发" },
    });
    writeJson(override.currentDispatchPath, overrideDispatch);
    await assertValidateFails(
      ["--mode", "dispatch", "--input", override.currentDispatchPath],
      /human override cannot request multi_batch with fewer than two dispatched reviewItems/,
    );

    const multi = await createNextIncrementalRun(fixture, {
      runId: "R2multi",
      groups: [["RI001"], ["RI002"]],
      userRequestedConcurrency: true,
    });
    assert.equal(readJson(multi.currentDispatchPath).executionPlan.mode, "multi_batch");
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

{
  const fixture = await createSingleStepFixture({ finalizeCurrent: true });
  try {
    const chain = await createNextIncrementalRun(fixture, { finalize: false });
    const r0DispatchPath = path.join(fixture.baseDir, "dispatch.json");
    const r0FinalPath = path.join(fixture.baseDir, "finalReview.json");
    const r1DispatchPath = path.join(fixture.currentDir, "dispatch.json");
    const originalR0Dispatch = fs.readFileSync(r0DispatchPath, "utf8");
    const originalR0Final = fs.readFileSync(r0FinalPath, "utf8");
    const originalR1Dispatch = fs.readFileSync(r1DispatchPath, "utf8");

    const r1Missing = readJson(r1DispatchPath);
    r1Missing.continuation.baseRunId = "missing-ancestor";
    writeJson(r1DispatchPath, r1Missing);
    await assertValidateFails(["--mode", "dispatch", "--input", chain.currentDispatchPath], /incremental base resolution failed closed/);
    fs.writeFileSync(r1DispatchPath, originalR1Dispatch);

    const r1Cycle = readJson(r1DispatchPath);
    r1Cycle.continuation.baseRunId = "R2";
    writeJson(r1DispatchPath, r1Cycle);
    await assertValidateFails(["--mode", "dispatch", "--input", chain.currentDispatchPath], /continuation cycle detected/);
    fs.writeFileSync(r1DispatchPath, originalR1Dispatch);

    const r0V2 = readJson(r0DispatchPath);
    r0V2.schemaVersion = 2;
    writeJson(r0DispatchPath, r0V2);
    await assertValidateFails(["--mode", "dispatch", "--input", chain.currentDispatchPath], /incremental base must use schemaVersion 3/);
    fs.writeFileSync(r0DispatchPath, originalR0Dispatch);

    fs.writeFileSync(r0FinalPath, "{\n");
    await assertValidateFails(["--mode", "dispatch", "--input", chain.currentDispatchPath], /input is not strict JSON or file is unreadable/);
    fs.writeFileSync(r0FinalPath, originalR0Final);

    const r0InvalidFinal = readJson(r0FinalPath);
    r0InvalidFinal.issueSummary.observations = 0;
    writeJson(r0FinalPath, r0InvalidFinal);
    await assertValidateFails(["--mode", "dispatch", "--input", chain.currentDispatchPath], /finalReview issueSummary must equal validator result/);
    fs.writeFileSync(r0FinalPath, originalR0Final);

    const realBaseDir = `${fixture.baseDir}-real`;
    fs.renameSync(fixture.baseDir, realBaseDir);
    fs.symlinkSync(realBaseDir, fixture.baseDir, "dir");
    await assertValidateFails(["--mode", "dispatch", "--input", chain.currentDispatchPath], /base run must be a real sibling directory/);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

{
  const fixture = await createSingleStepFixture({ extraStableItems: 7, finalizeCurrent: true });
  try {
    const chain = await createNextIncrementalRun(fixture, {
      finalize: false,
      mutate(dispatch) {
        dispatch.targets.candidates.push({
          targetId: "T003",
          targetKind: "candidate",
          loc: "src/stable.ts:30",
          summary: "历史最大值以下的新 target",
          inputRefs: ["src/stable.ts"],
        });
        for (const ruleRef of dispatch.ruleSet.requiredRuleRefs) {
          dispatch.applicabilityMatrix.push({
            ruleRef,
            targetId: "T003",
            targetKind: "candidate",
            applicability: "not_applicable",
            reason: `${ruleRef} does not apply to T003`,
            evidence: [{ loc: "src/stable.ts:30", summary: `${ruleRef} checked for T003` }],
          });
        }
        dispatch.reviewItems.push({
          reviewItemId: "RI000",
          ruleRef: "UI-001",
          targetKind: "changed_unit",
          targetId: "T001",
          required: false,
        });
      },
    });
    const output = await assertValidateFails(
      ["--mode", "dispatch", "--input", chain.currentDispatchPath],
      /new targetId must be greater than every targetId in the base chain/,
    );
    assert.match(output, /new reviewItemId must be greater than every reviewItemId in the base chain/);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

{
  const fixture = await createSingleStepFixture();
  try {
    const r1Dispatch = readJson(fixture.currentDispatchPath);
    r1Dispatch.reviewItems = r1Dispatch.reviewItems.filter((item) => item.reviewItemId !== "RI003");
    refreshExecutionMetrics(r1Dispatch);
    writeJson(fixture.currentDispatchPath, r1Dispatch);
    await finalizeIncrementalRun(fixture.currentDir, fixture.currentDispatchPath);

    const restored = await createNextIncrementalRun(fixture, {
      groups: [["RI003"]],
      statuses: { RI003: "not_applicable" },
      mutate(dispatch) {
        dispatch.reviewItems.push({
          reviewItemId: "RI003",
          ruleRef: "UI-001",
          targetKind: "candidate",
          targetId: "T002",
          required: false,
        });
      },
    });
    assert.equal(JSON.parse((await runValidate(["--mode", "run", "--dir", restored.currentDir])).stdout).ok, true);

    const reboundTuple = await createNextIncrementalRun(fixture, {
      runId: "R2tuple",
      groups: [["RI004"]],
      finalize: false,
      mutate(dispatch) {
        dispatch.reviewItems.push({
          reviewItemId: "RI004",
          ruleRef: "UI-001",
          targetKind: "candidate",
          targetId: "T002",
          required: false,
        });
      },
    });
    await assertValidateFails(["--mode", "dispatch", "--input", reboundTuple.currentDispatchPath], /existing ruleRef x targetId tuple must keep its historical reviewItemId/);

    const reboundId = await createNextIncrementalRun(fixture, {
      runId: "R2id",
      groups: [["RI003"]],
      finalize: false,
      mutate(dispatch) {
        dispatch.reviewItems.push({
          reviewItemId: "RI003",
          ruleRef: "UI-001",
          targetKind: "changed_unit",
          targetId: "T001",
          required: false,
        });
      },
    });
    await assertValidateFails(["--mode", "dispatch", "--input", reboundId.currentDispatchPath], /reviewItemId must keep the same ruleRef x targetId tuple across the incremental chain/);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

{
  const fixture = await createSingleStepFixture({ finalizeCurrent: true });
  try {
    const fullDir = path.join(path.dirname(fixture.currentDir), "Rfull");
    fs.mkdirSync(fullDir);
    const dispatch = readJson(path.join(fixture.baseDir, "dispatch.json"));
    dispatch.runId = "Rfull";
    dispatch.fullReason = "建立独立 full 新链根";
    const dispatchPath = path.join(fullDir, "dispatch.json");
    writeJson(dispatchPath, dispatch);
    await runValidate(["--mode", "build-tasks", "--dispatch", dispatchPath, "--out", path.join(fullDir, "tasks")]);
    fs.mkdirSync(path.join(fullDir, "shards"));
    writeJson(path.join(fullDir, "shards/B001.json"), {
      kind: "rules-review-shard",
      schemaVersion: 3,
      runId: "Rfull",
      reviewBatchId: "B001",
      results: dispatch.reviewItems.map((item) => resultForReviewItem(item.reviewItemId)),
    });
    await runValidate(["--mode", "aggregate-final", "--dir", fullDir, "--output", path.join(fullDir, "finalReview.json")]);
    await renderFinalInDir(fullDir);
    assert.equal(JSON.parse((await runValidate(["--mode", "run", "--dir", fullDir])).stdout).ok, true);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

{
  const fixture = await createSingleStepFixture();
  try {
    const dispatch = readJson(fixture.currentDispatchPath);
    dispatch.ruleSet.selectedRuleRefs = dispatch.ruleSet.selectedRuleRefs.filter((ruleRef) => ruleRef !== "TYPE-001");
    dispatch.ruleSet.requiredRuleRefs = dispatch.ruleSet.requiredRuleRefs.filter((ruleRef) => ruleRef !== "TYPE-001");
    dispatch.applicabilityMatrix = dispatch.applicabilityMatrix.filter((row) => row.ruleRef !== "TYPE-001");
    dispatch.reviewItems = dispatch.reviewItems.filter((item) => item.reviewItemId !== "RI002");
    refreshExecutionMetrics(dispatch);
    writeJson(fixture.currentDispatchPath, dispatch);
    await finalizeIncrementalRun(fixture.currentDir, fixture.currentDispatchPath);
    assert.deepEqual(readJson(path.join(fixture.currentDir, "finalReview.json")).issueSummary, issueSummary());
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

{
  const fixture = await createSingleStepFixture();
  try {
    const dispatch = readJson(fixture.currentDispatchPath);
    moveTypeReviewToT001(dispatch);
    refreshDispatchInputs(dispatch, fixture.root);
    setIncrementalBatches(dispatch, [["RI004"]]);
    writeJson(fixture.currentDispatchPath, dispatch);
    await finalizeIncrementalRun(fixture.currentDir, fixture.currentDispatchPath);
    assert.deepEqual(readJson(path.join(fixture.currentDir, "finalReview.json")).issueSummary, issueSummary());
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

{
  const fixture = await createSingleStepFixture();
  try {
    fs.writeFileSync(path.join(fixture.root, "src/removed.ts"), "export const removed = true;\n");
    git(fixture.root, ["add", "src/removed.ts"]);
    git(fixture.root, ["commit", "-qm", "add removed target input"]);
    fs.rmSync(path.join(fixture.root, "src/removed.ts"));
    const dispatch = readJson(fixture.currentDispatchPath);
    moveTypeReviewToT001(dispatch, { removeOptionalT002: true });
    const deletedTarget = dispatch.targets.candidates.find((target) => target.targetId === "T002");
    dispatch.targets.candidates = dispatch.targets.candidates.filter((target) => target.targetId !== "T002");
    deletedTarget.targetKind = "changed_unit";
    deletedTarget.inputRefs = ["src/removed.ts"];
    dispatch.targets.changedUnits.push(deletedTarget);
    dispatch.targets.contextExpansions = dispatch.targets.contextExpansions.filter((entry) => !entry.addedTargetIds.includes("T002"));
    dispatch.applicabilityMatrix.filter((row) => row.targetId === "T002").forEach((row) => { row.targetKind = "changed_unit"; });
    dispatch.changedFiles = ["src/removed.ts"];
    refreshDispatchInputs(dispatch, fixture.root);
    setIncrementalBatches(dispatch, [["RI004"]]);
    writeJson(fixture.currentDispatchPath, dispatch);
    await finalizeIncrementalRun(fixture.currentDir, fixture.currentDispatchPath);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

{
  const fixture = await createSingleStepFixture();
  try {
    fs.rmSync(path.join(fixture.root, "src/stable.ts"));
    const dispatch = readJson(fixture.currentDispatchPath);
    moveTypeReviewToT001(dispatch, { removeOptionalT002: true });
    const deletedTarget = dispatch.targets.candidates.find((target) => target.targetId === "T002");
    dispatch.targets.candidates = dispatch.targets.candidates.filter((target) => target.targetId !== "T002");
    deletedTarget.targetKind = "changed_unit";
    dispatch.targets.changedUnits.push(deletedTarget);
    dispatch.targets.contextExpansions = dispatch.targets.contextExpansions.filter((entry) => !entry.addedTargetIds.includes("T002"));
    dispatch.applicabilityMatrix.filter((row) => row.targetId === "T002").forEach((row) => { row.targetKind = "changed_unit"; });
    dispatch.changedFiles = ["src/stable.ts"];
    refreshDispatchInputs(dispatch, fixture.root);
    setIncrementalBatches(dispatch, [["RI004"]]);
    writeJson(fixture.currentDispatchPath, dispatch);
    await finalizeIncrementalRun(fixture.currentDir, fixture.currentDispatchPath);
    assert.equal(readJson(fixture.currentDispatchPath).inputSnapshot.files.find((entry) => entry.inputRef === "src/stable.ts").state, "deleted");
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

{
  const fixture = await createSingleStepFixture();
  try {
    fs.rmSync(path.join(fixture.root, "src/stable.ts"));
    const dispatch = readJson(fixture.currentDispatchPath);
    const deletedTarget = dispatch.targets.candidates.find((target) => target.targetId === "T002");
    dispatch.targets.candidates = dispatch.targets.candidates.filter((target) => target.targetId !== "T002");
    deletedTarget.targetKind = "changed_unit";
    dispatch.targets.changedUnits.push(deletedTarget);
    dispatch.targets.contextExpansions = dispatch.targets.contextExpansions.filter((entry) => !entry.addedTargetIds.includes("T002"));
    dispatch.ruleSet.requiredRuleRefs = dispatch.ruleSet.requiredRuleRefs.filter((ruleRef) => ruleRef !== "TYPE-001");
    dispatch.ruleSet.excludedRuleRefs.push("TYPE-001");
    dispatch.applicabilityMatrix = dispatch.applicabilityMatrix.filter((row) => row.ruleRef !== "TYPE-001");
    dispatch.applicabilityMatrix.filter((row) => row.targetId === "T002").forEach((row) => { row.targetKind = "changed_unit"; });
    dispatch.reviewItems = dispatch.reviewItems.filter((item) => item.targetId !== "T002");
    dispatch.changedFiles = ["src/stable.ts"];
    refreshDispatchInputs(dispatch, fixture.root);
    refreshExecutionMetrics(dispatch);
    writeJson(fixture.currentDispatchPath, dispatch);
    const output = await assertValidateFails(["--mode", "dispatch", "--input", fixture.currentDispatchPath], /"code": "INC027"/);
    assert.deepEqual(JSON.parse(output).violations.map(({ code }) => code), ["INC027"]);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

{
  const fixture = await createSingleStepFixture();
  try {
    const dispatch = readJson(fixture.currentDispatchPath);
    moveTypeReviewToT001(dispatch, { keepT002: false });
    refreshDispatchInputs(dispatch, fixture.root);
    setIncrementalBatches(dispatch, [["RI004"]]);
    writeJson(fixture.currentDispatchPath, dispatch);
    await assertValidateFails(["--mode", "dispatch", "--input", fixture.currentDispatchPath], /disappeared base observation requires a machine-visible structural reason or full review/);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

for (const status of ["finding", "cannot_verify"]) {
  const fixture = await createSingleStepFixture({
    baseStatuses: { RI001: "passed", RI002: status, RI003: "not_applicable" },
  });
  try {
    const dispatch = readJson(fixture.currentDispatchPath);
    moveTypeReviewToT001(dispatch);
    refreshDispatchInputs(dispatch, fixture.root);
    setIncrementalBatches(dispatch, [["RI004"]]);
    writeJson(fixture.currentDispatchPath, dispatch);
    await assertValidateFails(["--mode", "dispatch", "--input", fixture.currentDispatchPath], /disappeared base finding\/cannot_verify requires full review/);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

for (const status of ["passed", "not_applicable"]) {
  const fixture = await createSingleStepFixture({
    baseStatuses: { RI001: "passed", RI002: "observation", RI003: status },
  });
  try {
    const dispatch = readJson(fixture.currentDispatchPath);
    dispatch.reviewItems = dispatch.reviewItems.filter((item) => item.reviewItemId !== "RI003");
    refreshExecutionMetrics(dispatch);
    writeJson(fixture.currentDispatchPath, dispatch);
    await finalizeIncrementalRun(fixture.currentDir, fixture.currentDispatchPath);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

{
  const fixture = await createSingleStepFixture({
    baseStatuses: { RI001: "passed", RI002: "passed", RI003: "not_applicable" },
  });
  try {
    const r1 = readJson(fixture.currentDispatchPath);
    r1.ruleSet.selectedRuleRefs = r1.ruleSet.selectedRuleRefs.filter((ruleRef) => ruleRef !== "TYPE-001");
    r1.ruleSet.requiredRuleRefs = r1.ruleSet.requiredRuleRefs.filter((ruleRef) => ruleRef !== "TYPE-001");
    r1.targets.candidates = [];
    r1.targets.contextExpansions = [];
    r1.applicabilityMatrix = r1.applicabilityMatrix.filter((row) => row.targetId !== "T002" && row.ruleRef !== "TYPE-001");
    r1.reviewItems = r1.reviewItems.filter((item) => item.targetId !== "T002");
    refreshDispatchInputs(r1, fixture.root);
    setIncrementalBatches(r1, []);
    writeJson(fixture.currentDispatchPath, r1);
    await finalizeIncrementalRun(fixture.currentDir, fixture.currentDispatchPath);

    const rebound = await createNextIncrementalRun(fixture, {
      finalize: false,
      mutate(dispatch) {
        dispatch.targets.candidates.push({
          targetId: "T002",
          targetKind: "candidate",
          loc: "src/stable.ts:1",
          summary: "不能复用历史已消失 targetId",
          inputRefs: ["src/stable.ts"],
        });
        dispatch.applicabilityMatrix.push({
          ruleRef: "CORE-001",
          targetId: "T002",
          targetKind: "candidate",
          applicability: "not_applicable",
          reason: "CORE-001 does not apply to rebound T002",
          evidence: [{ loc: "src/stable.ts:1", summary: "CORE-001 checked for rebound T002" }],
        });
      },
    });
    await assertValidateFails(["--mode", "dispatch", "--input", rebound.currentDispatchPath], /new targetId must be greater than every targetId in the base chain/);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

{
  const fixture = await createSingleStepFixture({ recheckIds: ["RI002"] });
  try {
    fs.writeFileSync(path.join(fixture.root, ".agents/rules/type.md"), "# TYPE-001 changed\n");
    const dispatch = readJson(fixture.currentDispatchPath);
    refreshDispatchInputs(dispatch, fixture.root);
    writeJson(fixture.currentDispatchPath, dispatch);
    await finalizeIncrementalRun(fixture.currentDir, fixture.currentDispatchPath);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

{
  const fixture = await createSingleStepFixture({ recheckIds: ["RI001", "RI002"] });
  try {
    fs.writeFileSync(path.join(fixture.root, ".agents/rules/index.md"), "# Rules changed\n");
    const dispatch = readJson(fixture.currentDispatchPath);
    refreshDispatchInputs(dispatch, fixture.root);
    writeJson(fixture.currentDispatchPath, dispatch);
    await assertValidateFails(["--mode", "dispatch", "--input", fixture.currentDispatchPath], /incremental dispatch cannot recheck every current reviewItem; use full/);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

{
  const fixture = await createSingleStepFixture({ recheckIds: ["RI001"] });
  try {
    const dispatch = readJson(fixture.currentDispatchPath);
    dispatch.ruleSet.ruleSources.find((source) => source.ruleRef === "TYPE-001").summary = "结构化规则摘要变化";
    writeJson(fixture.currentDispatchPath, dispatch);
    await assertValidateFails(["--mode", "dispatch", "--input", fixture.currentDispatchPath], /must include every machine-mandatory recheck item/);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

{
  const fixture = await createSingleStepFixture({ recheckIds: ["RI001"] });
  try {
    const dispatch = readJson(fixture.currentDispatchPath);
    dispatch.targets.changedUnits[0].inputRefs = ["src/changed.ts", "src/stable.ts"];
    refreshDispatchInputs(dispatch, fixture.root);
    writeJson(fixture.currentDispatchPath, dispatch);
    await finalizeIncrementalRun(fixture.currentDir, fixture.currentDispatchPath);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

{
  const fixture = await createSingleStepFixture({ recheckIds: ["RI001"] });
  try {
    fs.renameSync(path.join(fixture.root, "src/changed.ts"), path.join(fixture.root, "src/renamed.ts"));
    const dispatch = readJson(fixture.currentDispatchPath);
    dispatch.changedFiles = ["src/changed.ts", "src/renamed.ts"];
    dispatch.targets.changedUnits[0].inputRefs = ["src/changed.ts", "src/renamed.ts"];
    refreshDispatchInputs(dispatch, fixture.root);
    writeJson(fixture.currentDispatchPath, dispatch);
    await finalizeIncrementalRun(fixture.currentDir, fixture.currentDispatchPath);
    const snapshot = readJson(fixture.currentDispatchPath).inputSnapshot.files;
    assert.equal(snapshot.find((entry) => entry.inputRef === "src/changed.ts").state, "deleted");
    assert.equal(snapshot.find((entry) => entry.inputRef === "src/renamed.ts").state, "present");
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

{
  const fixture = await createSingleStepFixture();
  try {
    fs.writeFileSync(path.join(fixture.root, "src/new.ts"), "export const added = true;\n");
    const dispatch = readJson(fixture.currentDispatchPath);
    dispatch.changedFiles = ["src/new.ts"];
    dispatch.targets.changedUnits.push({
      targetId: "T003",
      targetKind: "changed_unit",
      loc: "src/new.ts:1",
      summary: "新增文件目标",
      inputRefs: ["src/new.ts"],
    });
    dispatch.applicabilityMatrix.push(
      {
        ruleRef: "CORE-001",
        targetId: "T003",
        targetKind: "changed_unit",
        applicability: "applicable",
        reviewItemId: "RI004",
        evidence: [{ loc: "src/new.ts:1", summary: "CORE-001 applies to T003" }],
      },
      {
        ruleRef: "TYPE-001",
        targetId: "T003",
        targetKind: "changed_unit",
        applicability: "not_applicable",
        reason: "TYPE-001 does not apply to T003",
        evidence: [{ loc: "src/new.ts:1", summary: "TYPE-001 checked for T003" }],
      },
    );
    dispatch.reviewItems.push({
      reviewItemId: "RI004",
      ruleRef: "CORE-001",
      targetKind: "changed_unit",
      targetId: "T003",
      required: true,
    });
    refreshDispatchInputs(dispatch, fixture.root);
    setIncrementalBatches(dispatch, [["RI004"]]);
    writeJson(fixture.currentDispatchPath, dispatch);
    await finalizeIncrementalRun(fixture.currentDir, fixture.currentDispatchPath);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

{
  const fixture = await createSingleStepFixture({
    baseStatuses: { RI001: "finding", RI002: "observation", RI003: "not_applicable" },
    recheckIds: ["RI001"],
    finalizeCurrent: true,
  });
  try {
    const chain = await createNextIncrementalRun(fixture);
    assert.equal(readJson(chain.currentDispatchPath).executionPlan.mode, "no_batch");
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

{
  const fixture = await createSingleStepFixture({ recheckIds: ["RI001"] });
  try {
    await finalizeIncrementalRun(fixture.currentDir, fixture.currentDispatchPath, { RI001: "finding" });
    const r1Final = readJson(path.join(fixture.currentDir, "finalReview.json"));
    assert.deepEqual(r1Final.issueSummary, issueSummary({ findings: 1, mustFix: 1, observations: 1 }));
    assert.deepEqual(r1Final.findings.map((finding) => finding.findingId), ["F001"]);
    const chain = await createNextIncrementalRun(fixture, { finalize: false });
    await assertValidateFails(["--mode", "dispatch", "--input", chain.currentDispatchPath], /must include every machine-mandatory recheck item/);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

await assertRunFails("run-fail-missing-result", /batched reviewItem must have exactly one current shard result/);
await assertRunFails("run-fail-unassigned-result", /result must reference assigned reviewItemId/);
await assertRunFails("run-fail-duplicate-result", /reviewItem has duplicate results/);
await assertRunFails("run-fail-finding-no-evidence", /finding result requires evidence/);
await assertRunFails("run-fail-finding-no-evidence", /incomplete or blocked semanticVerdict must be unknown/);
await assertRunFails("run-fail-passed-no-evidence", /passed result requires evidence/);
await assertRunFails("run-fail-not-applicable-no-reason", /not_applicable result requires reason/);
await assertRunFails("run-fail-cannot-verify-no-proof", /cannot_verify result requires reason or evidence/);
await assertRunFails("run-fail-missing-source-hash", /sourceHash is required/);
await assertRunFails("run-fail-unclassified-candidate", /selectedRuleRef must be classified as required, excluded, or globallyNotApplicable/);
await assertRunFails("run-fail-concurrency-single-no-override", /hard execution policy requires multi_batch/);
await assertRunFails("run-fail-single-with-multiple-batches", /single_batch executionPlan requires exactly one reviewBatch/);
await assertRunFails("run-fail-multi-with-one-batch", /multi_batch executionPlan requires at least two reviewBatches/);
await assertRunFails("run-fail-metric-reviewItems-mismatch", /executionPlan metric must match dispatch facts/);
await assertRunFails("run-fail-reviewItem-unassigned", /reviewItem must be assigned to one reviewBatch/);
await assertRunFails("run-fail-reviewItem-duplicated", /reviewItemId must not be assigned to multiple reviewBatches/);
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
