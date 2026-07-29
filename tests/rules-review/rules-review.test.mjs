import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const validator = path.join(repoRoot, "skills/rules-review/scripts/validate.js");

function git(root, args, options = {}) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  }).trim();
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function canonicalStringify(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function calculateTaskHash(task) {
  const copy = structuredClone(task);
  delete copy.taskHash;
  return `sha256:${crypto.createHash("sha256").update(canonicalStringify(copy)).digest("hex")}`;
}

async function run(args, cwd = repoRoot) {
  return execFileAsync(process.execPath, [validator, ...args], { cwd });
}

async function runJson(args, cwd = repoRoot) {
  const result = await run(args, cwd);
  return JSON.parse(result.stdout);
}

async function expectFailure(args, pattern, cwd = repoRoot) {
  try {
    await run(args, cwd);
  } catch (error) {
    const output = `${error.stdout || ""}${error.stderr || ""}`;
    assert.match(output, pattern);
    return JSON.parse(error.stdout);
  }
  assert.fail(`命令应失败：${args.join(" ")}`);
}

function createRepository() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rules-review-v7-"));
  fs.mkdirSync(path.join(root, ".agents/rules"), { recursive: true });
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, ".gitignore"), ".rules-review-tmp/\n");
  fs.writeFileSync(path.join(root, ".agents/rules/index.md"), "# Rules\n\n- CORE-001\n");
  fs.writeFileSync(path.join(root, ".agents/rules/core.md"), "# CORE-001\n\n检查当前变更。\n");
  fs.writeFileSync(path.join(root, "src/main.js"), "export const main = 1;\n");
  fs.writeFileSync(path.join(root, "src/other.js"), "export const other = 1;\n");
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "Test User"]);
  git(root, ["add", "."]);
  git(root, ["commit", "-qm", "base"]);
  return root;
}

function draft({
  runId = "run-v7",
  inputRefs = ["src/main.js"],
  excludedFiles = [],
  candidateRuleRefs = ["CORE-001"],
  selectedRuleRefs = ["CORE-001"],
  requiredRuleRefs = ["CORE-001"],
  excludedRuleRefs = [],
  globallyNotApplicableRuleRefs = [],
  ruleSources,
} = {}) {
  return {
    kind: "rules-review-dispatch",
    schemaVersion: 7,
    runId,
    reviewRange: { excludedFiles },
    ruleSnapshot: { files: [] },
    inputSnapshot: { files: [] },
    ruleSet: {
      ruleSetId: "RS001",
      sourceIndexHash: `sha256:${"0".repeat(64)}`,
      candidateRuleRefs,
      selectedRuleRefs,
      requiredRuleRefs,
      excludedRuleRefs,
      globallyNotApplicableRuleRefs,
      ruleSources: ruleSources || candidateRuleRefs.map((ruleRef) => ({
        namespace: ruleRef.split("-")[0],
        ruleRef,
        ruleLevel: "MUST",
        sourceFile: ".agents/rules/core.md",
        sourceHash: `sha256:${"0".repeat(64)}`,
        trigger: ["always"],
        appliesTo: ["*"],
        summary: "检查当前变更",
      })),
    },
    targets: {
      changedUnits: [{
        targetId: "T001",
        targetKind: "changed_unit",
        inputRefs,
        loc: `${inputRefs[0]}:1`,
        summary: "当前变更",
      }],
      candidates: [],
      contextExpansions: [],
    },
    applicabilityMatrix: requiredRuleRefs.map((ruleRef, index) => ({
      ruleRef,
      targetId: "T001",
      targetKind: "changed_unit",
      applicability: "applicable",
      reviewItemId: `RI${String(index + 1).padStart(3, "0")}`,
      evidence: [{ loc: `${inputRefs[0]}:1`, summary: "适用性已判断" }],
    })),
    reviewItems: requiredRuleRefs.map((ruleRef, index) => ({
      reviewItemId: `RI${String(index + 1).padStart(3, "0")}`,
      ruleRef,
      targetKind: "changed_unit",
      targetId: "T001",
      required: true,
    })),
    executionPlan: {
      mode: requiredRuleRefs.length === 0 ? "no_batch" : "single_batch",
      selectedBy: "ai",
      policyVersion: "review-execution-policy/v1",
      metrics: {
        changedUnits: 1,
        candidates: 0,
        targets: 1,
        requiredRuleRefs: requiredRuleRefs.length,
        reviewItems: requiredRuleRefs.length,
      },
      signals: { userRequestedConcurrency: false },
      reason: requiredRuleRefs.length === 0 ? "没有 reviewItems" : "单批次覆盖全部 reviewItems",
      humanOverride: null,
    },
    reviewBatches: requiredRuleRefs.length === 0 ? [] : [{
      reviewBatchId: "B001",
      ruleSetId: "RS001",
      reviewItemIds: requiredRuleRefs.map((_, index) => `RI${String(index + 1).padStart(3, "0")}`),
      taskRef: "tasks/B001.json",
      shardRef: "shards/B001.json",
      returnStatus: "returned",
      aggregateStatus: "aggregated",
      unaggregatedReason: null,
    }],
  };
}

function createDraft(root, options = {}) {
  const file = path.join(root, ".rules-review-tmp", options.runId || "run-v7", "dispatch.json");
  writeJson(file, draft(options));
  return file;
}

async function seal(file, targetCommit, base, rulesCommit) {
  const root = git(path.dirname(file), ["rev-parse", "--show-toplevel"]);
  const baseRevision = base || git(root, ["rev-parse", "HEAD"]);
  let targetRevision = targetCommit;
  if (!targetRevision) {
    if (git(root, ["status", "--porcelain", "--untracked-files=all"])) {
      git(root, ["add", "-A"]);
      git(root, ["commit", "-qm", "target"]);
    }
    targetRevision = git(root, ["rev-parse", "HEAD"]);
  }
  try {
    const args = [
      "--mode", "seal-dispatch",
      "--input", file,
      "--base", baseRevision,
      "--target-commit", targetRevision,
    ];
    if (rulesCommit) args.push("--rules-commit", rulesCommit);
    await run(args);
  } catch (error) {
    throw new Error(`${error.stdout || ""}${error.stderr || ""}`, { cause: error });
  }
  return readJson(file);
}

function snapshotWorkspace(root) {
  const indexPath = git(root, ["rev-parse", "--git-path", "index"]);
  const status = git(root, ["status", "--porcelain=v2", "-z"]);
  const worktrees = git(root, ["worktree", "list", "--porcelain"]);
  return {
    index: fs.readFileSync(path.resolve(root, indexPath)),
    status,
    worktrees,
    main: fs.readFileSync(path.join(root, "src/main.js")),
    other: fs.readFileSync(path.join(root, "src/other.js")),
  };
}

function assertWorkspaceEqual(before, after) {
  assert.deepEqual(after.index, before.index);
  assert.equal(after.status, before.status);
  assert.equal(after.worktrees, before.worktrees);
  assert.deepEqual(after.main, before.main);
  assert.deepEqual(after.other, before.other);
}

function passedShard(dispatch, task) {
  return {
    kind: "rules-review-shard",
    schemaVersion: 7,
    runId: dispatch.runId,
    reviewBatchId: "B001",
    targetTree: dispatch.reviewRange.targetTree,
    taskHash: task.taskHash,
    results: dispatch.reviewItems.map((item) => ({
      reviewItemId: item.reviewItemId,
      status: "passed",
      evidence: [{ loc: "src/main.js:1", summary: "已审查封印内容" }],
      failureChecks: [{
        condition: "规则失败条件已检查",
        outcome: "checked_no_violation",
        evidence: [{ loc: "src/main.js:1", summary: "未发现违反" }],
      }],
    })),
  };
}

async function materializePassingRun(dispatchFile) {
  const runDir = path.dirname(dispatchFile);
  const dispatch = readJson(dispatchFile);
  await run(["--mode", "build-tasks", "--dispatch", dispatchFile, "--out", path.join(runDir, "tasks")]);
  const task = readJson(path.join(runDir, "tasks/B001.json"));
  writeJson(path.join(runDir, "shards/B001.json"), passedShard(dispatch, task));
  try {
    await run(["--mode", "aggregate-final", "--dir", runDir, "--output", path.join(runDir, "finalReview.json")]);
  } catch (error) {
    throw new Error(`${error.stdout || ""}${error.stderr || ""}`, { cause: error });
  }
  await run([
    "--mode", "render-final",
    "--input", path.join(runDir, "finalReview.json"),
    "--dispatch", dispatchFile,
    "--output", path.join(runDir, "final.md"),
  ]);
  return runDir;
}

test("response 摘要按需展示无法验证和其他关注项，其他关注项不影响结论", async (t) => {
  const root = createRepository();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "src/main.js"), "export const main = 2;\n");
  const dispatchFile = createDraft(root);
  const dispatch = await seal(dispatchFile);
  const runDir = path.dirname(dispatchFile);
  const taskDir = path.join(runDir, "tasks");
  await run(["--mode", "build-tasks", "--dispatch", dispatchFile, "--out", taskDir]);
  const shardFile = path.join(runDir, "shards/B001.json");
  const shard = passedShard(dispatch, readJson(path.join(taskDir, "B001.json")));
  shard.otherConcerns = [
    "普通代码 review 可进一步确认该调用链的异常处理。",
    "",
    { summary: "非普通文本不应阻断审查" },
    "普通代码 review 可进一步确认该调用链的异常处理。",
  ];
  writeJson(shardFile, shard);

  for (const args of [
    ["--mode", "aggregate-final", "--dir", runDir, "--output", path.join(runDir, "finalReview.json")],
    ["--mode", "render-final", "--input", path.join(runDir, "finalReview.json"), "--dispatch", dispatchFile, "--output", path.join(runDir, "final.md")],
    ["--mode", "render-response", "--dir", runDir],
  ]) {
    await run(args);
  }
  let finalReview = readJson(path.join(runDir, "finalReview.json"));
  let response = fs.readFileSync(path.join(runDir, "response.md"), "utf8");
  assert.equal(finalReview.semanticVerdict, "clean");
  assert.equal(finalReview.recommendation, "ready_for_merge");
  assert.deepEqual(finalReview.issueSummary, { findings: 0, mustFix: 0, shouldFix: 0, cannotVerify: 0, observations: 0 });
  assert.deepEqual(finalReview.otherConcerns, ["普通代码 review 可进一步确认该调用链的异常处理。"]);
  assert.match(response, /## 其他关注项/);
  assert.match(response, /普通代码 review 可进一步确认/);
  assert.doesNotMatch(response, /## 无法验证/);

  shard.results[0] = {
    reviewItemId: "RI001",
    status: "cannot_verify",
    reason: "缺少独立宿主运行环境，无法确认 /backend 路由。",
  };
  writeJson(shardFile, shard);
  for (const args of [
    ["--mode", "aggregate-final", "--dir", runDir, "--output", path.join(runDir, "finalReview.json")],
    ["--mode", "render-final", "--input", path.join(runDir, "finalReview.json"), "--dispatch", dispatchFile, "--output", path.join(runDir, "final.md")],
    ["--mode", "render-response", "--dir", runDir],
  ]) {
    await run(args);
  }
  finalReview = readJson(path.join(runDir, "finalReview.json"));
  response = fs.readFileSync(path.join(runDir, "response.md"), "utf8");
  assert.deepEqual(finalReview.issueSummary, { findings: 0, mustFix: 0, shouldFix: 0, cannotVerify: 1, observations: 0 });
  assert.match(response, /## 无法验证\n- CORE-001｜T001：缺少独立宿主运行环境，无法确认 \/backend 路由。/);
  assert.ok(response.indexOf("## 问题") < response.indexOf("## 无法验证"));
  assert.ok(response.indexOf("## 无法验证") < response.indexOf("## 其他关注项"));
  assert.ok(response.indexOf("## 其他关注项") < response.indexOf("## 报告"));

  delete shard.otherConcerns;
  writeJson(shardFile, shard);
  for (const args of [
    ["--mode", "aggregate-final", "--dir", runDir, "--output", path.join(runDir, "finalReview.json")],
    ["--mode", "render-final", "--input", path.join(runDir, "finalReview.json"), "--dispatch", dispatchFile, "--output", path.join(runDir, "final.md")],
    ["--mode", "render-response", "--dir", runDir],
  ]) {
    await run(args);
  }
  finalReview = readJson(path.join(runDir, "finalReview.json"));
  response = fs.readFileSync(path.join(runDir, "response.md"), "utf8");
  assert.equal("otherConcerns" in finalReview, false);
  assert.doesNotMatch(response, /## 其他关注项/);
  assert.match(response, /## 无法验证/);
});

test("语义切片分别审查，同一 batch 的 finding 按显式 rootCause 合并并保留全部证据组", async (t) => {
  const root = createRepository();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "src/main.js"), "export const main = 2;\n");
  fs.writeFileSync(path.join(root, "src/other.js"), "export const other = 2;\n");
  fs.writeFileSync(path.join(root, "src/host.js"), "export const backendRoute = true;\n");

  const dispatchFile = createDraft(root, { runId: "root-cause-grouping" });
  const draftDispatch = readJson(dispatchFile);
  draftDispatch.ruleSet.ruleSources[0].ruleLevel = "SHOULD";
  const targetSpecs = [
    ["T001", "src/main.js", "CI 是否组装 backend 制品"],
    ["T002", "src/other.js", "WebView 是否允许进入 /backend"],
    ["T003", "src/host.js", "独立宿主是否生成 /backend 路由"],
  ];
  draftDispatch.targets.changedUnits = targetSpecs.map(([targetId, inputRef, summary]) => ({
    targetId,
    targetKind: "changed_unit",
    inputRefs: [inputRef],
    loc: `${inputRef}:1`,
    summary,
  }));
  draftDispatch.applicabilityMatrix = targetSpecs.map(([targetId, inputRef], index) => ({
    ruleRef: "CORE-001",
    targetId,
    targetKind: "changed_unit",
    applicability: "applicable",
    reviewItemId: `RI${String(index + 1).padStart(3, "0")}`,
    evidence: [{ loc: `${inputRef}:1`, summary: "适用性已判断" }],
  }));
  draftDispatch.reviewItems = targetSpecs.map(([targetId], index) => ({
    reviewItemId: `RI${String(index + 1).padStart(3, "0")}`,
    ruleRef: "CORE-001",
    targetKind: "changed_unit",
    targetId,
    required: true,
  }));
  draftDispatch.executionPlan.metrics = {
    changedUnits: 3,
    candidates: 0,
    targets: 3,
    requiredRuleRefs: 1,
    reviewItems: 3,
  };
  draftDispatch.reviewBatches[0].reviewItemIds = ["RI001", "RI002", "RI003"];
  writeJson(dispatchFile, draftDispatch);

  const dispatch = await seal(dispatchFile);
  const runDir = path.dirname(dispatchFile);
  const taskDir = path.join(runDir, "tasks");
  await run(["--mode", "build-tasks", "--dispatch", dispatchFile, "--out", taskDir]);
  const task = readJson(path.join(taskDir, "B001.json"));
  const rootCause = "制品可用性没有成为构建、路由和入口的共同门禁。";
  const shard = {
    kind: "rules-review-shard",
    schemaVersion: 7,
    runId: dispatch.runId,
    reviewBatchId: "B001",
    targetTree: dispatch.reviewRange.targetTree,
    taskHash: task.taskHash,
    results: dispatch.reviewItems.map((item, index) => ({
      reviewItemId: item.reviewItemId,
      status: "finding",
      rootCause,
      origin: "introduced_by_change",
      ...(index === 0 ? {
        priority: "must_fix",
        priorityReason: "共同门禁缺失会让无制品入口进入生产路径。",
      } : {}),
      evidence: [{
        loc: `${targetSpecs[index][1]}:1`,
        summary: targetSpecs[index][2],
      }],
    })),
  };
  const shardFile = path.join(runDir, "shards/B001.json");
  writeJson(shardFile, shard);
  await run(["--mode", "shard", "--task", path.join(taskDir, "B001.json"), "--input", shardFile]);

  const invalidShardFile = path.join(root, "missing-root-cause.json");
  const invalidShard = structuredClone(shard);
  delete invalidShard.results[0].rootCause;
  writeJson(invalidShardFile, invalidShard);
  await expectFailure(
    ["--mode", "shard", "--task", path.join(taskDir, "B001.json"), "--input", invalidShardFile],
    /finding result requires an explicit rootCause/,
  );

  const invalidEvidenceCases = [
    ["finding", (() => {
      const value = structuredClone(shard);
      value.results[0].evidence[0].command = "npm test";
      return value;
    })()],
    ["cannot-verify", (() => {
      const value = structuredClone(shard);
      value.results[0] = {
        reviewItemId: "RI001",
        status: "cannot_verify",
        reason: "需要运行时环境",
        evidence: [{ loc: "src/main.js:1", summary: "缺少运行时环境", command: "npm test" }],
      };
      return value;
    })()],
    ["failure-check", (() => {
      const value = passedShard(dispatch, task);
      value.results[0].failureChecks[0].evidence[0].command = "npm test";
      return value;
    })()],
  ];
  for (const [name, value] of invalidEvidenceCases) {
    const file = path.join(root, `${name}-unknown-evidence.json`);
    writeJson(file, value);
    await expectFailure(
      ["--mode", "shard", "--task", path.join(taskDir, "B001.json"), "--input", file],
      /shard evidence contains unsupported field/,
    );
  }
  const shardSchema = readJson(path.join(repoRoot, "skills/rules-review/schemas/shard.schema.json"));
  assert.equal(shardSchema.$defs.evidence.additionalProperties, false);

  for (const args of [
    ["--mode", "aggregate-final", "--dir", runDir, "--output", path.join(runDir, "finalReview.json")],
    ["--mode", "render-final", "--input", path.join(runDir, "finalReview.json"), "--dispatch", dispatchFile, "--output", path.join(runDir, "final.md")],
    ["--mode", "render-response", "--dir", runDir],
  ]) {
    await run(args);
  }

  const finalReview = readJson(path.join(runDir, "finalReview.json"));
  const finalMarkdown = fs.readFileSync(path.join(runDir, "final.md"), "utf8");
  const response = fs.readFileSync(path.join(runDir, "response.md"), "utf8");
  assert.deepEqual(finalReview.issueSummary, { findings: 1, mustFix: 1, shouldFix: 0, cannotVerify: 0, observations: 0 });
  assert.equal(finalReview.recommendation, "must_fix_before_merge");
  assert.equal(finalReview.findings.length, 1);
  assert.equal(finalReview.findings[0].rootCause, rootCause);
  assert.deepEqual(finalReview.findings[0].evidenceGroups.map((group) => group.reviewItemId), ["RI001", "RI002", "RI003"]);
  assert.deepEqual(finalReview.findings[0].evidenceGroups.map((group) => group.priority), ["must_fix", "should_fix", "should_fix"]);
  assert.equal(finalReview.findings[0].evidenceGroups.length, 3);
  assert.equal("otherConcerns" in finalReview, false);
  assert.equal(response.split(rootCause).length - 1, 1);
  assert.match(finalMarkdown, /优先级：must_fix/);
  assert.match(finalMarkdown, /优先级：should_fix/);
  assert.ok(response.includes([
    `- F001：${rootCause}`,
    "  - CORE-001｜src/main.js:1：CI 是否组装 backend 制品",
    "  - CORE-001｜src/other.js:1：WebView 是否允许进入 /backend",
    "  - CORE-001｜src/host.js:1：独立宿主是否生成 /backend 路由",
  ].join("\n")));
  assert.doesNotMatch(response, /目标：T00[123]|来源：|优先级：(must_fix|should_fix)/);

  const schema = readJson(path.join(repoRoot, "skills/rules-review/schemas/final-review.schema.json"));
  for (const definition of ["issueSummary", "cannotVerifyItem", "validationResult", "finding", "findingEvidenceGroup", "observation", "evidence"]) {
    assert.equal(schema.$defs[definition].additionalProperties, false, `${definition} 必须拒绝未知字段`);
  }
  const invalidFinalReviewFile = path.join(root, "invalid-final-review.json");
  const unsupportedFieldCases = [
    ["finding 旧版字段", (value) => { value.findings[0].reviewItemId = "RI999"; }, /finalReview finding contains unsupported field/],
    ["evidenceGroup findingId", (value) => { value.findings[0].evidenceGroups[0].findingId = "F999"; }, /finalReview finding evidenceGroup contains unsupported field/],
    ["evidenceGroup 第二个 rootCause", (value) => { value.findings[0].evidenceGroups[0].rootCause = "矛盾根因"; }, /finalReview finding evidenceGroup contains unsupported field/],
    ["evidence 未知字段", (value) => { value.findings[0].evidenceGroups[0].evidence[0].unknown = true; }, /finalReview evidence contains unsupported field/],
    ["observation 未知字段", (value) => {
      value.observations = [{
        reviewItemId: "RI001",
        ruleRef: "CORE-001",
        targetId: "T001",
        ruleLevel: "SHOULD",
        origin: "introduced_by_change",
        reason: "观察原因",
        unknown: true,
      }];
    }, /finalReview observation contains unsupported field/],
    ["cannotVerifyItem 未知字段", (value) => {
      value.cannotVerifyItems = [{
        reviewItemId: "RI001",
        ruleRef: "CORE-001",
        targetId: "T001",
        reason: "无法验证",
        unknown: true,
      }];
    }, /finalReview cannotVerify item contains unsupported field/],
    ["issueSummary 未知字段", (value) => { value.issueSummary.unknown = 1; }, /issueSummary contains unsupported field/],
    ["validationResult 未知字段", (value) => { value.validationResults[0].unknown = true; }, /validationResult contains unsupported field/],
  ];
  for (const [name, mutate, pattern] of unsupportedFieldCases) {
    const invalidFinalReview = structuredClone(finalReview);
    mutate(invalidFinalReview);
    writeJson(invalidFinalReviewFile, invalidFinalReview);
    await expectFailure(["--mode", "final-review", "--input", invalidFinalReviewFile], pattern)
      .catch((error) => { throw new Error(`${name}: ${error.message}`, { cause: error }); });
  }

  shard.results[2].rootCause = "独立宿主单独缺少 backend 路由门禁。";
  writeJson(shardFile, shard);
  await run(["--mode", "aggregate-final", "--dir", runDir, "--output", path.join(runDir, "finalReview.json")]);
  const splitFinalReview = readJson(path.join(runDir, "finalReview.json"));
  assert.equal(splitFinalReview.findings.length, 2, "aggregator 不应按相似措辞推断同一根因");
  assert.deepEqual(splitFinalReview.issueSummary, { findings: 2, mustFix: 1, shouldFix: 1, cannotVerify: 0, observations: 0 });
});

test("不同 batch 的相同 rootCause 不会发生隐式跨 batch 合并", async (t) => {
  const root = createRepository();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "src/main.js"), "export const main = 2;\n");
  fs.writeFileSync(path.join(root, "src/other.js"), "export const other = 2;\n");

  const dispatchFile = createDraft(root, { runId: "cross-batch-root-cause-collision" });
  const draftDispatch = readJson(dispatchFile);
  draftDispatch.targets.changedUnits = [
    {
      targetId: "T001",
      targetKind: "changed_unit",
      inputRefs: ["src/main.js"],
      loc: "src/main.js:1",
      summary: "第一条链路",
    },
    {
      targetId: "T002",
      targetKind: "changed_unit",
      inputRefs: ["src/other.js"],
      loc: "src/other.js:1",
      summary: "第二条链路",
    },
  ];
  draftDispatch.applicabilityMatrix = draftDispatch.targets.changedUnits.map((target, index) => ({
    ruleRef: "CORE-001",
    targetId: target.targetId,
    targetKind: "changed_unit",
    applicability: "applicable",
    reviewItemId: `RI${String(index + 1).padStart(3, "0")}`,
    evidence: [{ loc: target.loc, summary: "适用性已判断" }],
  }));
  draftDispatch.reviewItems = draftDispatch.targets.changedUnits.map((target, index) => ({
    reviewItemId: `RI${String(index + 1).padStart(3, "0")}`,
    ruleRef: "CORE-001",
    targetKind: "changed_unit",
    targetId: target.targetId,
    required: true,
  }));
  draftDispatch.executionPlan.mode = "multi_batch";
  draftDispatch.executionPlan.metrics = {
    changedUnits: 2,
    candidates: 0,
    targets: 2,
    requiredRuleRefs: 1,
    reviewItems: 2,
  };
  draftDispatch.executionPlan.reason = "两个独立 reviewer 分别审查一条链路";
  draftDispatch.reviewBatches = ["B001", "B002"].map((reviewBatchId, index) => ({
    reviewBatchId,
    ruleSetId: "RS001",
    reviewItemIds: [`RI${String(index + 1).padStart(3, "0")}`],
    taskRef: `tasks/${reviewBatchId}.json`,
    shardRef: `shards/${reviewBatchId}.json`,
    returnStatus: "returned",
    aggregateStatus: "aggregated",
    unaggregatedReason: null,
  }));
  writeJson(dispatchFile, draftDispatch);

  const dispatch = await seal(dispatchFile);
  const runDir = path.dirname(dispatchFile);
  const taskDir = path.join(runDir, "tasks");
  await run(["--mode", "build-tasks", "--dispatch", dispatchFile, "--out", taskDir]);
  const rootCause = "缺少输入校验";
  for (const reviewBatchId of ["B001", "B002"]) {
    const task = readJson(path.join(taskDir, `${reviewBatchId}.json`));
    writeJson(path.join(runDir, `shards/${reviewBatchId}.json`), {
      kind: "rules-review-shard",
      schemaVersion: 7,
      runId: dispatch.runId,
      reviewBatchId,
      targetTree: dispatch.reviewRange.targetTree,
      taskHash: task.taskHash,
      results: [{
        reviewItemId: task.reviewItems[0].reviewItemId,
        status: "finding",
        rootCause,
        origin: "introduced_by_change",
        evidence: [{
          loc: task.targets[0].loc,
          summary: `${reviewBatchId} 独立发现的问题`,
        }],
      }],
    });
  }

  await run(["--mode", "aggregate-final", "--dir", runDir, "--output", path.join(runDir, "finalReview.json")]);
  const finalReview = readJson(path.join(runDir, "finalReview.json"));
  assert.equal(finalReview.findings.length, 2);
  assert.deepEqual(finalReview.findings.map((finding) => finding.rootCause), [rootCause, rootCause]);
  assert.deepEqual(finalReview.findings.map((finding) => finding.evidenceGroups.length), [1, 1]);
  assert.deepEqual(finalReview.issueSummary, { findings: 2, mustFix: 2, shouldFix: 0, cannotVerify: 0, observations: 0 });
});

test("target-commit 固定完整提交范围，且封印过程不写 Git object 或修改工作区", async (t) => {
  const root = createRepository();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const base = git(root, ["rev-parse", "HEAD"]);
  fs.writeFileSync(path.join(root, "src/main.js"), "export const main = 2;\n");
  fs.writeFileSync(path.join(root, "src/other.js"), "export const other = 2;\n");
  fs.writeFileSync(path.join(root, "src/new.js"), "export const added = true;\n");
  git(root, ["add", "-A"]);
  git(root, ["commit", "-qm", "target"]);
  const target = git(root, ["rev-parse", "HEAD"]);
  fs.mkdirSync(path.join(root, ".rules-review-tmp"), { recursive: true });
  fs.writeFileSync(path.join(root, ".rules-review-tmp/manual-note.md"), "control data\n");
  const file = createDraft(root, { inputRefs: ["src/main.js", "src/other.js", "src/new.js"] });
  const before = snapshotWorkspace(root);
  const objectsBefore = git(root, ["count-objects", "-v"]);

  const dispatch = await seal(file, target, base);

  assertWorkspaceEqual(before, snapshotWorkspace(root));
  assert.equal(git(root, ["count-objects", "-v"]), objectsBefore);
  assert.equal(dispatch.reviewRange.baseCommit, base);
  assert.equal(dispatch.reviewRange.boundCommit, target);
  assert.deepEqual(dispatch.ruleInputSource, { kind: "workspace" });
  assert.equal(git(root, ["show", `${dispatch.reviewRange.targetTree}:src/main.js`]), "export const main = 2;");
  assert.equal(git(root, ["show", `${dispatch.reviewRange.targetTree}:src/new.js`]), "export const added = true;");
  assert.equal(git(root, ["ls-tree", "--name-only", dispatch.reviewRange.targetTree, "--", ".rules-review-tmp"]), "");
  assert.deepEqual(dispatch.inputSnapshot.files.map((entry) => entry.inputRef), ["src/main.js", "src/new.js", "src/other.js"]);
  assert.deepEqual(dispatch.ruleSnapshot.files.map((entry) => entry.path), [".agents/rules/core.md", ".agents/rules/index.md"]);

  fs.writeFileSync(path.join(root, "src/main.js"), "export const main = 99;\n");
  const validation = await runJson(["--mode", "dispatch", "--input", file]);
  assert.equal(validation.ok, true, "消费端应只读取目标 commit，不读取当前同名文件");
});

test("draft 不得自行声明 ruleInputSource", async (t) => {
  const root = createRepository();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = createDraft(root);
  const dispatch = readJson(file);
  dispatch.ruleInputSource = { kind: "workspace" };
  writeJson(file, dispatch);

  await expectFailure([
    "--mode", "seal-dispatch",
    "--input", file,
    "--base", "HEAD",
    "--target-commit", "HEAD",
  ], /draft dispatch must not declare ruleInputSource/);
  assert.deepEqual(readJson(file).ruleInputSource, { kind: "workspace" });
});

test("默认规则来源使用当前工作区，封印后不再回读工作区规则", async (t) => {
  const root = createRepository();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const base = git(root, ["rev-parse", "HEAD"]);
  fs.writeFileSync(path.join(root, "src/main.js"), "export const main = 2;\n");
  git(root, ["add", "src/main.js"]);
  git(root, ["commit", "-qm", "target"]);
  const target = git(root, ["rev-parse", "HEAD"]);
  const targetRule = git(root, ["show", `${target}:.agents/rules/core.md`]);

  fs.writeFileSync(path.join(root, ".agents/rules/index.md"), "# Rules\n\n- WORK-001\n");
  fs.writeFileSync(path.join(root, ".agents/rules/core.md"), "# WORK-001\n\n工作区新规则。\n");
  const file = createDraft(root, {
    runId: "workspace-rules",
    candidateRuleRefs: ["WORK-001"],
    selectedRuleRefs: ["WORK-001"],
    requiredRuleRefs: ["WORK-001"],
    ruleSources: [{
      namespace: "WORK",
      ruleRef: "WORK-001",
      ruleLevel: "MUST",
      sourceFile: ".agents/rules/core.md",
      sourceHash: `sha256:${"0".repeat(64)}`,
      trigger: ["always"],
      appliesTo: ["*"],
      summary: "工作区新规则",
    }],
  });

  const dispatch = await seal(file, target, base);
  const snapshotRule = dispatch.ruleSnapshot.files.find((entry) => entry.path === ".agents/rules/core.md");
  assert.deepEqual(dispatch.ruleInputSource, { kind: "workspace" });
  assert.deepEqual(dispatch.ruleSet.candidateRuleRefs, ["WORK-001"]);
  assert.equal(dispatch.ruleSet.ruleSources[0].summary, "工作区新规则");
  assert.match(snapshotRule.content, /工作区新规则/);
  assert.doesNotMatch(targetRule, /工作区新规则/);

  fs.writeFileSync(path.join(root, ".agents/rules/core.md"), "# WORK-001\n\n封印后再次修改。\n");
  const runDir = await materializePassingRun(file);
  const task = readJson(path.join(runDir, "tasks/B001.json"));
  assert.deepEqual(task.ruleInputSource, { kind: "workspace" });
  assert.match(task.ruleSnapshot.files.find((entry) => entry.path === ".agents/rules/core.md").content, /工作区新规则/);
  assert.doesNotMatch(task.ruleSnapshot.files.find((entry) => entry.path === ".agents/rules/core.md").content, /封印后再次修改/);
  const validation = await runJson(["--mode", "run", "--dir", runDir]);
  assert.equal(validation.ok, true);
  await run(["--mode", "render-response", "--dir", runDir]);
  const finalMarkdown = fs.readFileSync(path.join(runDir, "final.md"), "utf8");
  const responseMarkdown = fs.readFileSync(path.join(runDir, "response.md"), "utf8");
  assert.match(finalMarkdown, /规则来源类型：workspace/);
  assert.doesNotMatch(responseMarkdown, /规则来源类型|规则来源 commit/);
});

test("--rules-commit 只使用指定 commit，并拒绝错误 revision、缺失文件和 snapshot 漂移", async (t) => {
  const root = createRepository();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const base = git(root, ["rev-parse", "HEAD"]);
  fs.writeFileSync(path.join(root, "src/main.js"), "export const main = 2;\n");
  git(root, ["add", "src/main.js"]);
  git(root, ["commit", "-qm", "target"]);
  const target = git(root, ["rev-parse", "HEAD"]);

  fs.writeFileSync(path.join(root, ".agents/rules/index.md"), "# Rules\n\n- RULE-001\n");
  fs.writeFileSync(path.join(root, ".agents/rules/core.md"), "# RULE-001\n\n指定 commit 规则。\n");
  git(root, ["add", ".agents/rules"]);
  git(root, ["commit", "-qm", "rules"]);
  const rulesCommit = git(root, ["rev-parse", "HEAD"]);

  fs.writeFileSync(path.join(root, ".agents/rules/index.md"), "# Rules\n\n- WORK-001\n");
  fs.writeFileSync(path.join(root, ".agents/rules/core.md"), "# WORK-001\n\n工作区规则。\n");
  const ruleSources = [{
    namespace: "RULE",
    ruleRef: "RULE-001",
    ruleLevel: "MUST",
    sourceFile: ".agents/rules/core.md",
    sourceHash: `sha256:${"0".repeat(64)}`,
    trigger: ["always"],
    appliesTo: ["*"],
    summary: "指定 commit 规则",
  }];
  const file = createDraft(root, {
    runId: "commit-rules",
    candidateRuleRefs: ["RULE-001"],
    selectedRuleRefs: ["RULE-001"],
    requiredRuleRefs: ["RULE-001"],
    ruleSources,
  });

  const dispatch = await seal(file, target, base, rulesCommit);
  const snapshotRule = dispatch.ruleSnapshot.files.find((entry) => entry.path === ".agents/rules/core.md");
  assert.deepEqual(dispatch.ruleInputSource, { kind: "commit", commit: rulesCommit });
  assert.deepEqual(dispatch.ruleSet.candidateRuleRefs, ["RULE-001"]);
  assert.match(snapshotRule.content, /指定 commit 规则/);
  assert.doesNotMatch(snapshotRule.content, /工作区规则/);
  assert.doesNotMatch(git(root, ["show", `${target}:.agents/rules/core.md`]), /指定 commit 规则/);

  const runDir = await materializePassingRun(file);
  await run(["--mode", "render-response", "--dir", runDir]);
  const finalMarkdown = fs.readFileSync(path.join(runDir, "final.md"), "utf8");
  const responseMarkdown = fs.readFileSync(path.join(runDir, "response.md"), "utf8");
  assert.match(finalMarkdown, /规则来源类型：commit/);
  assert.match(finalMarkdown, new RegExp(`规则来源 commit：${rulesCommit}`));
  assert.doesNotMatch(responseMarkdown, /规则来源类型|规则来源 commit/);

  const invalidRevisionFile = createDraft(root, {
    runId: "bad-rules-revision",
    candidateRuleRefs: ["RULE-001"],
    selectedRuleRefs: ["RULE-001"],
    requiredRuleRefs: ["RULE-001"],
    ruleSources,
  });
  await expectFailure([
    "--mode", "seal-dispatch",
    "--input", invalidRevisionFile,
    "--base", base,
    "--target-commit", target,
    "--rules-commit", "missing-rules-revision",
  ], /seal-dispatch failed closed/);

  const drifted = readJson(file);
  const driftedRule = drifted.ruleSnapshot.files.find((entry) => entry.path === ".agents/rules/core.md");
  driftedRule.content = "# RULE-001\n\n篡改快照。\n";
  driftedRule.contentHash = `sha256:${crypto.createHash("sha256").update(driftedRule.content).digest("hex")}`;
  drifted.ruleSet.ruleSources[0].sourceHash = driftedRule.contentHash;
  writeJson(file, drifted);
  await expectFailure(["--mode", "dispatch", "--input", file], /rules commit snapshot mismatch/);

  fs.rmSync(path.join(root, ".agents/rules/index.md"));
  git(root, ["add", "-u", ".agents/rules/index.md"]);
  git(root, ["commit", "-qm", "missing rules index"]);
  const missingRulesCommit = git(root, ["rev-parse", "HEAD"]);
  const missingFile = createDraft(root, {
    runId: "missing-rules-file",
    candidateRuleRefs: ["RULE-001"],
    selectedRuleRefs: ["RULE-001"],
    requiredRuleRefs: ["RULE-001"],
    ruleSources,
  });
  await expectFailure([
    "--mode", "seal-dispatch",
    "--input", missingFile,
    "--base", base,
    "--target-commit", target,
    "--rules-commit", missingRulesCommit,
  ], /required tree input is missing: \.agents\/rules\/index\.md/);
});

test("partial clone 缺失 blob 时禁止惰性拉取并 fail closed", async (t) => {
  const source = createRepository();
  const partial = fs.mkdtempSync(path.join(os.tmpdir(), "rules-review-partial-"));
  t.after(() => fs.rmSync(source, { recursive: true, force: true }));
  t.after(() => fs.rmSync(partial, { recursive: true, force: true }));
  const base = git(source, ["rev-parse", "HEAD"]);
  fs.writeFileSync(path.join(source, "src/main.js"), "export const main = 2;\n");
  git(source, ["add", "src/main.js"]);
  git(source, ["commit", "-qm", "target"]);
  const target = git(source, ["rev-parse", "HEAD"]);
  const targetBlob = git(source, ["rev-parse", `${target}:src/main.js`]);
  git(source, ["config", "uploadpack.allowFilter", "true"]);
  git(os.tmpdir(), [
    "clone",
    "-q",
    "--filter=blob:none",
    "--no-checkout",
    pathToFileURL(source).href,
    partial,
  ]);
  assert.throws(() => git(partial, ["cat-file", "-e", targetBlob], {
    env: { ...process.env, GIT_NO_LAZY_FETCH: "1" },
  }));
  const file = createDraft(partial);
  const objectsBefore = git(partial, ["count-objects", "-v"]);

  await expectFailure([
    "--mode", "seal-dispatch",
    "--input", file,
    "--base", base,
    "--target-commit", target,
  ], /seal-dispatch failed closed/);

  assert.equal(git(partial, ["count-objects", "-v"]), objectsBefore);
  assert.deepEqual(readJson(file).reviewRange, { excludedFiles: [] });
});

test("commit-only 入口拒绝 current、staged、target-tree 和缺失 target-commit", async (t) => {
  const root = createRepository();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = createDraft(root);

  for (const selector of [["--current"], ["--staged"], ["--target-tree", git(root, ["rev-parse", "HEAD^{tree}"])]]) {
    await expectFailure([
      "--mode", "seal-dispatch", "--input", file, "--base", "HEAD", ...selector,
    ], /only accepts committed TARGETs/);
  }
  await expectFailure([
    "--mode", "seal-dispatch", "--input", file, "--base", "HEAD",
  ], /requires --target-commit/);
});

test("target-commit 自动精确绑定规范 commit 和 tree 身份", async (t) => {
  const root = createRepository();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const base = git(root, ["rev-parse", "HEAD"]);
  fs.writeFileSync(path.join(root, "src/main.js"), "export const main = 2;\n");
  git(root, ["add", "src/main.js"]);
  git(root, ["commit", "-qm", "target"]);
  const target = git(root, ["rev-parse", "HEAD"]);
  const targetTree = git(root, ["rev-parse", `${target}^{tree}`]);

  const commitFile = createDraft(root, { runId: "commit-run" });
  const commitDispatch = await seal(commitFile, target, base);
  assert.equal(commitDispatch.reviewRange.targetTree, targetTree);
  assert.equal(commitDispatch.reviewRange.boundCommit, target);
  assert.deepEqual(commitDispatch.reviewRange.excludedFiles, []);
  assert.equal("seedCommit" in commitDispatch.reviewRange, false);

  git(root, ["branch", "topic", target]);
  const resolvedFile = createDraft(root, { runId: "resolved-run" });
  const resolvedDispatch = await seal(resolvedFile, "topic", base);
  assert.equal(resolvedDispatch.reviewRange.baseCommit, base);
  assert.equal(resolvedDispatch.reviewRange.targetTree, targetTree);
  assert.equal(resolvedDispatch.reviewRange.boundCommit, target);
});

test("target-commit 拒绝文件排除，但仍允许 excludedRuleRefs", async (t) => {
  const root = createRepository();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const base = git(root, ["rev-parse", "HEAD"]);
  fs.writeFileSync(path.join(root, "src/main.js"), "export const main = 2;\n");
  fs.writeFileSync(path.join(root, "src/other.js"), "export const other = 2;\n");
  git(root, ["add", "src/main.js", "src/other.js"]);
  git(root, ["commit", "-qm", "target"]);
  const target = git(root, ["rev-parse", "HEAD"]);

  const excludedFile = createDraft(root, {
    runId: "commit-excluded-file",
    excludedFiles: ["src/other.js"],
  });
  await expectFailure([
    "--mode", "seal-dispatch", "--input", excludedFile, "--base", base, "--target-commit", target,
  ], /commit-only rules-review requires reviewRange\.excludedFiles to be exactly \[\]/);
  assert.deepEqual(readJson(excludedFile).reviewRange.excludedFiles, ["src/other.js"]);

  const excludedRule = createDraft(root, {
    runId: "commit-excluded-rule",
    inputRefs: ["src/main.js", "src/other.js"],
    candidateRuleRefs: ["CORE-001", "AUX-001"],
    selectedRuleRefs: ["CORE-001"],
    requiredRuleRefs: ["CORE-001"],
    excludedRuleRefs: ["AUX-001"],
  });
  const dispatch = await seal(excludedRule, target, base);
  assert.equal(dispatch.reviewRange.boundCommit, target);
  assert.deepEqual(dispatch.ruleSet.excludedRuleRefs, ["AUX-001"]);
});

test("显式 base 到 target commit 累计包含多次已提交变更", async (t) => {
  const root = createRepository();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const base = git(root, ["rev-parse", "HEAD"]);
  fs.writeFileSync(path.join(root, "src/main.js"), "export const main = 2;\n");
  git(root, ["add", "src/main.js"]);
  git(root, ["commit", "-qm", "slice"]);
  fs.writeFileSync(path.join(root, "src/other.js"), "export const other = 2;\n");
  git(root, ["add", "src/other.js"]);
  git(root, ["commit", "-qm", "repair"]);
  const target = git(root, ["rev-parse", "HEAD"]);
  const file = createDraft(root, { inputRefs: ["src/main.js", "src/other.js"] });

  const dispatch = await seal(file, target, base);

  assert.equal(git(root, ["show", `${dispatch.reviewRange.targetTree}:src/main.js`]), "export const main = 2;");
  assert.equal(git(root, ["show", `${dispatch.reviewRange.targetTree}:src/other.js`]), "export const other = 2;");
});

test("commit 文件范围必须完整，scopeMode 只由规则排除事实派生", async (t) => {
  const root = createRepository();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "src/main.js"), "export const main = 2;\n");
  fs.writeFileSync(path.join(root, "src/other.js"), "export const other = 2;\n");
  const file = createDraft(root, {
    inputRefs: ["src/main.js", "src/other.js"],
    candidateRuleRefs: ["CORE-001", "AUX-001"],
    selectedRuleRefs: ["CORE-001"],
    requiredRuleRefs: ["CORE-001"],
    excludedRuleRefs: ["AUX-001"],
  });
  const dispatch = await seal(file);
  const runDir = await materializePassingRun(file);
  const finalReview = readJson(path.join(runDir, "finalReview.json"));
  assert.equal(finalReview.scopeMode, "scoped");
  assert.deepEqual(finalReview.excludedFiles, []);
  assert.deepEqual(finalReview.excludedRuleRefs, ["AUX-001"]);
  const result = await runJson(["--mode", "run", "--dir", runDir]);
  assert.equal(result.ok, true);

  const invalidFile = createDraft(root, { runId: "missing-file", inputRefs: ["src/main.js"] });
  await expectFailure(
    ["--mode", "seal-dispatch", "--input", invalidFile, "--base", dispatch.reviewRange.baseCommit, "--target-commit", dispatch.reviewRange.boundCommit],
    /targetTree changed file is not covered by changedUnits\.inputRefs/,
  );
});

test("v7 finalReview 独立校验和 schema 均拒绝文件排除", async (t) => {
  const root = createRepository();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "src/main.js"), "export const main = 2;\n");
  const dispatchFile = createDraft(root);
  await seal(dispatchFile);
  const runDir = await materializePassingRun(dispatchFile);
  const finalReviewFile = path.join(runDir, "finalReview.json");
  const finalReview = readJson(finalReviewFile);
  finalReview.scopeMode = "scoped";
  finalReview.coverageClaim = "scoped_complete";
  finalReview.excludedFiles = ["src/other.js"];
  writeJson(finalReviewFile, finalReview);

  await expectFailure([
    "--mode", "final-review",
    "--input", finalReviewFile,
  ], /commit-only rules-review requires excludedFiles to be exactly \[\]/);

  const schema = readJson(path.join(repoRoot, "skills/rules-review/schemas/final-review.schema.json"));
  assert.equal(schema.properties.excludedFiles.maxItems, 0);
});

test("候选规则必须由 selected、excluded、globallyNotApplicable 完整互斥分区", async (t) => {
  const root = createRepository();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "src/main.js"), "export const main = 2;\n");
  const file = createDraft(root);
  await seal(file);
  const dispatch = readJson(file);
  dispatch.ruleSet.excludedRuleRefs = ["CORE-001"];
  writeJson(file, dispatch);
  await expectFailure(["--mode", "dispatch", "--input", file], /selectedRuleRefs and excludedRuleRefs must not overlap/);

  dispatch.ruleSet.selectedRuleRefs = [];
  dispatch.ruleSet.excludedRuleRefs = [];
  writeJson(file, dispatch);
  await expectFailure(["--mode", "dispatch", "--input", file], /candidateRuleRef must be classified/);
});

test("每个 reviewItem 必须由当前 run 分派，no_batch 仅允许空 reviewItems", async (t) => {
  const root = createRepository();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "src/main.js"), "export const main = 2;\n");
  const file = createDraft(root);
  await seal(file);
  const dispatch = readJson(file);
  dispatch.reviewBatches[0].reviewItemIds = [];
  writeJson(file, dispatch);
  await expectFailure(["--mode", "dispatch", "--input", file], /reviewItem must be assigned to one reviewBatch/);

  dispatch.reviewBatches = [];
  dispatch.executionPlan.mode = "no_batch";
  writeJson(file, dispatch);
  await expectFailure(["--mode", "dispatch", "--input", file], /no_batch requires empty reviewItems/);
});

test("task 复制规则来源与快照，taskHash 和 dispatch 投影拒绝篡改", async (t) => {
  const root = createRepository();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "src/main.js"), "export const main = 2;\n");
  const file = createDraft(root);
  const dispatch = await seal(file);
  const taskDir = path.join(path.dirname(file), "tasks");
  await run(["--mode", "build-tasks", "--dispatch", file, "--out", taskDir]);
  const task = readJson(path.join(taskDir, "B001.json"));
  assert.deepEqual(task.reviewRange, dispatch.reviewRange);
  assert.deepEqual(task.ruleInputSource, dispatch.ruleInputSource);
  assert.deepEqual(task.inputSnapshot, dispatch.inputSnapshot);
  assert.deepEqual(task.ruleSnapshot, dispatch.ruleSnapshot);

  const taskFile = path.join(taskDir, "B001.json");
  delete task.ruleInputSource;
  writeJson(taskFile, task);
  await expectFailure(["--mode", "task", "--input", taskFile], /ruleInputSource|taskHash/);

  task.ruleInputSource = { kind: "commit", commit: dispatch.reviewRange.boundCommit };
  task.taskHash = calculateTaskHash(task);
  writeJson(taskFile, task);
  const standalone = await runJson(["--mode", "task", "--input", taskFile]);
  assert.equal(standalone.ok, true, "独立 task 的完整身份由 taskHash 绑定");
  const shardFile = path.join(path.dirname(file), "shards/B001.json");
  writeJson(shardFile, passedShard(dispatch, task));
  await expectFailure([
    "--mode", "aggregate-final",
    "--dir", path.dirname(file),
    "--output", path.join(path.dirname(file), "finalReview.json"),
  ], /task ruleInputSource must equal dispatch ruleInputSource/);

  dispatch.reviewRange.targetTree = "f".repeat(40);
  writeJson(file, dispatch);
  await expectFailure(["--mode", "dispatch", "--input", file], /Git tree input verification failed closed/);
});

test("新 TARGET 拒绝原地重封和旧 shard 重放", async (t) => {
  const root = createRepository();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "src/main.js"), "export const main = 2;\n");
  const firstFile = createDraft(root, { runId: "target-one" });
  const first = await seal(firstFile);
  const firstTaskDir = path.join(path.dirname(firstFile), "tasks");
  await run(["--mode", "build-tasks", "--dispatch", firstFile, "--out", firstTaskDir]);
  await run(["--mode", "build-tasks", "--dispatch", firstFile, "--out", firstTaskDir]);
  const oldTask = fs.readFileSync(path.join(firstTaskDir, "B001.json"));
  const oldShard = passedShard(first, JSON.parse(oldTask));

  await expectFailure([
    "--mode", "seal-dispatch", "--input", firstFile,
    "--base", first.reviewRange.baseCommit,
    "--target-commit", first.reviewRange.boundCommit,
  ], /sealed dispatch cannot be resealed/);
  fs.rmSync(path.dirname(firstFile), { recursive: true, force: true });

  fs.writeFileSync(path.join(root, "src/main.js"), "export const main = 3;\n");
  const secondFile = createDraft(root, { runId: "target-one" });
  await seal(secondFile);
  const secondTaskDir = path.join(path.dirname(secondFile), "tasks");
  fs.mkdirSync(secondTaskDir, { recursive: true });
  fs.writeFileSync(path.join(secondTaskDir, "B001.json"), oldTask);
  await expectFailure([
    "--mode", "build-tasks", "--dispatch", secondFile, "--out", secondTaskDir,
  ], /refuses to overwrite an existing task with different bytes/);

  const freshTaskDir = path.join(root, "fresh-tasks");
  await run(["--mode", "build-tasks", "--dispatch", secondFile, "--out", freshTaskDir]);
  fs.copyFileSync(path.join(freshTaskDir, "B001.json"), path.join(secondTaskDir, "B001.json"));
  const replayFile = path.join(path.dirname(secondFile), "shards/B001.json");
  writeJson(replayFile, oldShard);

  await expectFailure([
    "--mode", "shard", "--task", path.join(secondTaskDir, "B001.json"), "--input", replayFile,
  ], /shard targetTree must match task targetTree/);
});

test("相同 runId、batchId 和 targetTree 下，旧 shard 仍须匹配完整 task identity", async (t) => {
  const root = createRepository();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const base = git(root, ["rev-parse", "HEAD"]);
  fs.writeFileSync(path.join(root, "src/main.js"), "export const main = 2;\n");
  git(root, ["add", "src/main.js"]);
  git(root, ["commit", "-qm", "target"]);
  const target = git(root, ["rev-parse", "HEAD"]);
  const targetTree = git(root, ["rev-parse", "HEAD^{tree}"]);

  const firstFile = createDraft(root, { runId: "same-task-run" });
  const first = await seal(firstFile, target, base);
  const firstTasks = path.join(path.dirname(firstFile), "tasks");
  await run(["--mode", "build-tasks", "--dispatch", firstFile, "--out", firstTasks]);
  const firstTask = readJson(path.join(firstTasks, "B001.json"));
  const oldShard = passedShard(first, firstTask);
  fs.rmSync(path.dirname(firstFile), { recursive: true, force: true });

  const secondFile = createDraft(root, { runId: "same-task-run" });
  const second = await seal(secondFile, target, target);
  const secondTasks = path.join(path.dirname(secondFile), "tasks");
  await run(["--mode", "build-tasks", "--dispatch", secondFile, "--out", secondTasks]);
  const secondTask = readJson(path.join(secondTasks, "B001.json"));
  assert.equal(first.reviewRange.targetTree, second.reviewRange.targetTree);
  assert.notEqual(firstTask.taskHash, secondTask.taskHash);
  const shardFile = path.join(path.dirname(secondFile), "shards/B001.json");
  writeJson(shardFile, oldShard);

  await expectFailure([
    "--mode", "shard", "--task", path.join(secondTasks, "B001.json"), "--input", shardFile,
  ], /shard taskHash must match the canonical task identity/);
});

test("boundCommit 是必填的规范 commit，且其 tree 必须等于 targetTree", async (t) => {
  const root = createRepository();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "src/main.js"), "export const main = 2;\n");
  const file = createDraft(root);
  const dispatch = await seal(file);

  delete dispatch.reviewRange.boundCommit;
  writeJson(file, dispatch);
  await expectFailure(["--mode", "dispatch", "--input", file], /required field is missing/);

  dispatch.reviewRange.boundCommit = dispatch.reviewRange.baseCommit;
  writeJson(file, dispatch);
  await expectFailure(["--mode", "dispatch", "--input", file], /boundCommit tree does not match targetTree/);
});

test("v6 工件与旧 incremental 字段明确拒绝，v7 工件通过", async (t) => {
  const root = createRepository();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "src/main.js"), "export const main = 2;\n");
  const file = createDraft(root);
  await seal(file);
  const dispatch = readJson(file);
  const current = await runJson(["--mode", "dispatch", "--input", file]);
  assert.equal(current.ok, true);

  dispatch.schemaVersion = 6;
  writeJson(file, dispatch);
  await expectFailure(["--mode", "dispatch", "--input", file], /schemaVersion must match rules-review protocol/);

  dispatch.schemaVersion = 7;
  dispatch.continuation = { baseRunId: "old-run" };
  dispatch.fullReason = "legacy";
  dispatch.inputSource = { mode: "worktree" };
  writeJson(file, dispatch);
  await expectFailure(["--mode", "dispatch", "--input", file], /dispatch contains unsupported field/);

  for (const schemaFile of [
    "dispatch.schema.json",
    "task.schema.json",
    "retry-task.schema.json",
    "shard.schema.json",
    "validation.schema.json",
    "final-review.schema.json",
  ]) {
    const schema = readJson(path.join(repoRoot, "skills/rules-review/schemas", schemaFile));
    assert.equal(schema.properties.schemaVersion.const, 7, schemaFile);
  }
});

test("retry-task 只升级 schemaVersion，不增加规则来源或快照字段", async (t) => {
  const root = createRepository();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, ".rules-review-tmp", "retry-v7.json");
  const retryTask = {
    kind: "rules-review-retry-task",
    schemaVersion: 7,
    runId: "retry-v7",
    retryAttempt: 1,
    reason: "修正格式错误",
    originalTaskRef: "tasks/B001.json",
    violations: [],
    outputContract: {
      format: "strict_json",
      schemaRef: "schemas/shard.schema.json",
    },
  };
  writeJson(file, retryTask);
  const validation = await runJson(["--mode", "retry-task", "--input", file]);
  assert.equal(validation.ok, true);
  assert.deepEqual(Object.keys(retryTask).sort(), [
    "kind",
    "originalTaskRef",
    "outputContract",
    "reason",
    "retryAttempt",
    "runId",
    "schemaVersion",
    "violations",
  ]);
  const schema = readJson(path.join(repoRoot, "skills/rules-review/schemas/retry-task.schema.json"));
  assert.equal("ruleInputSource" in schema.properties, false);
  assert.equal("ruleSnapshot" in schema.properties, false);

  retryTask.schemaVersion = 6;
  writeJson(file, retryTask);
  await expectFailure(["--mode", "retry-task", "--input", file], /schemaVersion must match rules-review protocol/);
});

test("seal-dispatch 对缺少 base、缺少 target commit 和旧入口 fail closed", async (t) => {
  const root = createRepository();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = createDraft(root);
  await expectFailure([
    "--mode", "seal-dispatch", "--input", file, "--target-commit", "HEAD",
  ], /requires --base/);
  await expectFailure([
    "--mode", "seal-dispatch", "--input", file, "--base", "HEAD",
  ], /requires --target-commit/);
  await expectFailure([
    "--mode", "seal-dispatch", "--input", file, "--base", "HEAD",
    "--target-commit", "HEAD", "--current",
  ], /only accepts committed TARGETs/);
  await expectFailure(["--mode", "bind-commit"], /unknown or missing mode/);
});

test("文档声明 commit-only、每 TARGET fresh run 与临时生命周期", () => {
  const skill = fs.readFileSync(path.join(repoRoot, "skills/rules-review/SKILL.md"), "utf8");
  const reviewer = fs.readFileSync(path.join(repoRoot, "skills/rules-review/references/subagent-all-aspects.md"), "utf8");
  assert.match(skill, /TARGET 只能是 Git commit/);
  assert.match(skill, /`--target-commit` 是唯一 TARGET selector/);
  assert.match(skill, /--rules-commit/);
  assert.match(skill, /ruleInputSource/);
  assert.match(skill, /每个新的 TARGET.*全新 run/s);
  assert.match(skill, /不继承旧结果/);
  assert.match(skill, /不承诺跨会话、跨环境、跨天或长期恢复/);
  assert.match(skill, /git diff <baseTree> <targetTree>/);
  assert.match(skill, /不能在发现首个问题后停止/);
  assert.match(skill, /同一 batch 内相同显式 `rootCause`/);
  assert.match(skill, /不同 batch 即使 `rootCause` 字节完全相同也不合并/);
  assert.match(skill, /不得降级到 `otherConcerns`/);
  assert.match(reviewer, /git show <targetTree>:<path>/);
  assert.match(reviewer, /不同 batch 不做根因合并/);
  assert.doesNotMatch(skill, /--current|--staged|--target-tree|bind-commit/);
  assert.doesNotMatch(skill, /baseRunId|effectiveResults|fullReason/);
});
