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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rules-review-v5-"));
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
  runId = "run-v5",
  inputRefs = ["src/main.js"],
  excludedFiles = [],
  candidateRuleRefs = ["CORE-001"],
  selectedRuleRefs = ["CORE-001"],
  requiredRuleRefs = ["CORE-001"],
  excludedRuleRefs = [],
  globallyNotApplicableRuleRefs = [],
} = {}) {
  return {
    kind: "rules-review-dispatch",
    schemaVersion: 5,
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
      ruleSources: candidateRuleRefs.map((ruleRef) => ({
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
  const file = path.join(root, ".rules-review-tmp", options.runId || "run-v5", "dispatch.json");
  writeJson(file, draft(options));
  return file;
}

async function seal(file, targetCommit, base) {
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
    await run([
      "--mode", "seal-dispatch",
      "--input", file,
      "--base", baseRevision,
      "--target-commit", targetRevision,
    ]);
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
    schemaVersion: 5,
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
  assert.equal(git(root, ["show", `${dispatch.reviewRange.targetTree}:src/main.js`]), "export const main = 2;");
  assert.equal(git(root, ["show", `${dispatch.reviewRange.targetTree}:src/new.js`]), "export const added = true;");
  assert.equal(git(root, ["ls-tree", "--name-only", dispatch.reviewRange.targetTree, "--", ".rules-review-tmp"]), "");
  assert.deepEqual(dispatch.inputSnapshot.files.map((entry) => entry.inputRef), ["src/main.js", "src/new.js", "src/other.js"]);
  assert.deepEqual(dispatch.ruleSnapshot.files.map((entry) => entry.path), [".agents/rules/core.md", ".agents/rules/index.md"]);

  fs.writeFileSync(path.join(root, "src/main.js"), "export const main = 99;\n");
  const validation = await runJson(["--mode", "dispatch", "--input", file]);
  assert.equal(validation.ok, true, "消费端应只读取目标 commit，不读取当前同名文件");
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

test("v5 finalReview 独立校验和 schema 均拒绝文件排除", async (t) => {
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

test("task 复制固定 range、inputSnapshot 和 ruleSnapshot，消费者拒绝篡改的规则 blob 快照", async (t) => {
  const root = createRepository();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "src/main.js"), "export const main = 2;\n");
  const file = createDraft(root);
  const dispatch = await seal(file);
  const taskDir = path.join(path.dirname(file), "tasks");
  await run(["--mode", "build-tasks", "--dispatch", file, "--out", taskDir]);
  const task = readJson(path.join(taskDir, "B001.json"));
  assert.deepEqual(task.reviewRange, dispatch.reviewRange);
  assert.deepEqual(task.inputSnapshot, dispatch.inputSnapshot);
  assert.deepEqual(task.ruleSnapshot, dispatch.ruleSnapshot);

  const rule = task.ruleSnapshot.files.find((entry) => entry.path === ".agents/rules/core.md");
  rule.content = "# CORE-001\n\n篡改规则。\n";
  rule.contentHash = `sha256:${crypto.createHash("sha256").update(rule.content).digest("hex")}`;
  task.rules[0].sourceHash = rule.contentHash;
  const taskFile = path.join(taskDir, "B001.json");
  writeJson(taskFile, task);
  await expectFailure(["--mode", "task", "--input", taskFile], /task targetTree rule snapshot mismatch/);
  const shardFile = path.join(path.dirname(file), "shards/B001.json");
  writeJson(shardFile, passedShard(dispatch, task));
  await expectFailure(["--mode", "shard", "--task", taskFile, "--input", shardFile], /task targetTree rule snapshot mismatch/);

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

test("v4 与旧 incremental 字段明确拒绝", async (t) => {
  const root = createRepository();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "src/main.js"), "export const main = 2;\n");
  const file = createDraft(root);
  await seal(file);
  const dispatch = readJson(file);
  dispatch.schemaVersion = 4;
  writeJson(file, dispatch);
  await expectFailure(["--mode", "dispatch", "--input", file], /schemaVersion must match rules-review protocol/);

  dispatch.schemaVersion = 5;
  dispatch.continuation = { baseRunId: "old-run" };
  dispatch.fullReason = "legacy";
  dispatch.inputSource = { mode: "worktree" };
  writeJson(file, dispatch);
  await expectFailure(["--mode", "dispatch", "--input", file], /dispatch contains unsupported field/);
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
  assert.match(skill, /每个新的 TARGET.*全新 run/s);
  assert.match(skill, /不继承旧结果/);
  assert.match(skill, /不承诺跨会话、跨环境、跨天或长期恢复/);
  assert.match(skill, /git diff <baseTree> <targetTree>/);
  assert.match(reviewer, /git show <targetTree>:<path>/);
  assert.doesNotMatch(skill, /--current|--staged|--target-tree|bind-commit/);
  assert.doesNotMatch(skill, /baseRunId|effectiveResults|fullReason|inputSource/);
});
