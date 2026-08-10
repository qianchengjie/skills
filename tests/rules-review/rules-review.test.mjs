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

function currentProtocolVersion() {
  return readJson(
    path.join(repoRoot, "skills/rules-review/schemas/dispatch.schema.json"),
  ).properties.schemaVersion.const;
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

function contentHash(content) {
  return `sha256:${crypto.createHash("sha256").update(content).digest("hex")}`;
}

function testRunId(label) {
  const suffix = crypto.createHash("sha256").update(label).digest("hex").slice(0, 8);
  return `20260810T000000Z-rr-${suffix}`;
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

function testRuleBlock(ruleRef) {
  return [
    `### ${ruleRef} 检查当前变更`,
    "",
    "- 级别：MUST",
    "- 生效条件：每次任务",
    "- 规则：检查当前变更。",
    "- 通过条件：",
    "  - 当前变更已经按规则完成检查。",
    "- 证据要求：",
    "  - 记录检查证据。",
    "- 失败条件：",
    "  - 未检查当前变更。",
    "- 无法验证条件：",
    "  - 当前材料不足。",
    "",
  ].join("\n");
}

function writeTestRuleStore(root, ruleRefs) {
  const refsByNamespace = new Map();
  for (const ruleRef of ruleRefs) {
    const namespace = ruleRef.split("-")[0];
    if (!refsByNamespace.has(namespace)) refsByNamespace.set(namespace, []);
    refsByNamespace.get(namespace).push(ruleRef);
  }
  if (!refsByNamespace.has("CORE")) refsByNamespace.set("CORE", []);
  const namespaces = ["CORE", ...[...refsByNamespace.keys()].filter((namespace) => namespace !== "CORE").sort()];
  const rows = namespaces.map((namespace) => {
    const file = namespace === "CORE"
      ? "always/constraints.md"
      : `concerns/${namespace.toLowerCase()}.md`;
    return `| \`${namespace}\` | active | \`${file}\` | ${namespace === "CORE" ? "每次任务必读" : `命中 ${namespace} 关注点时`} |`;
  });
  fs.mkdirSync(path.join(root, ".agents/rules/always"), { recursive: true });
  fs.mkdirSync(path.join(root, ".agents/rules/concerns"), { recursive: true });
  fs.writeFileSync(path.join(root, ".agents/rules/index.md"), [
    "# Rules Index",
    "",
    "## Namespaces",
    "",
    "| Namespace | 状态 | 文件 | 触发条件 |",
    "| --- | --- | --- | --- |",
    ...rows,
    "",
  ].join("\n"));
  for (const namespace of namespaces) {
    const file = namespace === "CORE"
      ? "always/constraints.md"
      : `concerns/${namespace.toLowerCase()}.md`;
    fs.writeFileSync(
      path.join(root, ".agents/rules", ...file.split("/")),
      refsByNamespace.get(namespace).map(testRuleBlock).join("\n"),
    );
  }
}

function createRepository() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rules-review-v8-"));
  fs.mkdirSync(path.join(root, ".agents/rules"), { recursive: true });
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, ".gitignore"), ".rules-review-tmp/\n");
  writeTestRuleStore(root, ["CORE-001"]);
  fs.writeFileSync(path.join(root, "src/main.js"), "export const main = 1;\n");
  fs.writeFileSync(path.join(root, "src/other.js"), "export const other = 1;\n");
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "Test User"]);
  git(root, ["add", "."]);
  git(root, ["commit", "-qm", "base"]);
  return root;
}

function createConstructionCase(t, {
  runId = "construction-test",
  productionInput = false,
  workspaceRules = false,
  emptyActiveFile = false,
  indexContent,
  mutateInput,
} = {}) {
  const resolvedRunId = testRunId(runId);
  const resolvedIndexContent = indexContent || [
    "# Rules Index",
    "",
    "## Namespaces",
    "",
    "| Namespace | 状态 | 文件 | 触发条件 |",
    "| --- | --- | --- | --- |",
    "| `CORE` | active | `always/constraints.md` | 每次任务必读 |",
    ...(emptyActiveFile
      ? ["| `EMPTY` | active | `domain/empty.md` | 修改空领域时 |"]
      : []),
    "",
  ].join("\n");
  const root = createRepository();
  const inputRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rules-review-construction-input-"));
  const rulesContent = [
    "# Core Rules",
    "",
    "### CORE-001 检查主文件",
    "- 级别：MUST",
    "- 生效条件：每次任务",
    "- 规则：检查主文件。",
    "- 通过条件：",
    "  - 主文件已经完成检查。",
    "- 证据要求：",
    "  - 记录主文件。",
    "- 失败条件：",
    "  - 未检查主文件。",
    "- 无法验证条件：",
    "  - 主文件缺失。",
    "",
    "### CORE-002 检查上下文",
    "- 级别：SHOULD",
    "- 生效条件：存在上下文候选时",
    "- 规则：检查上下文。",
    "- 通过条件：",
    "  - 上下文候选已经完成检查。",
    "- 证据要求：",
    "  - 记录上下文。",
    "- 失败条件：",
    "  - 未检查上下文。",
    "- 无法验证条件：",
    "  - 上下文缺失。",
    "",
  ].join("\n");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  t.after(() => fs.rmSync(inputRoot, { recursive: true, force: true }));

  fs.mkdirSync(path.join(root, ".agents/rules/always"), { recursive: true });
  fs.writeFileSync(path.join(root, ".agents/rules/index.md"), resolvedIndexContent);
  fs.writeFileSync(path.join(root, ".agents/rules/always/constraints.md"), rulesContent);
  if (emptyActiveFile) {
    fs.mkdirSync(path.join(root, ".agents/rules/domain"), { recursive: true });
    fs.writeFileSync(path.join(root, ".agents/rules/domain/empty.md"), "");
  }
  git(root, ["add", ".agents/rules"]);
  git(root, ["commit", "-qm", "construction rules"]);
  const baseCommit = git(root, ["rev-parse", "HEAD"]);
  fs.writeFileSync(path.join(root, "src/main.js"), "export const main = 2;\n");
  git(root, ["add", "src/main.js"]);
  git(root, ["commit", "-qm", "construction target"]);
  const targetCommit = git(root, ["rev-parse", "HEAD"]);

  const input = {
    kind: productionInput
      ? "rules-review-dispatch-construction-input"
      : "rules-review-dispatch-construction-eval-input",
    schemaVersion: 2,
    runId: resolvedRunId,
    repository: productionInput
      ? {
        baseCommit,
        targetCommit,
        ...(workspaceRules ? {} : { rulesCommit: targetCommit }),
        excludedFiles: [],
      }
      : {
        fixture: "project.bundle",
        baseCommit,
        targetCommit,
        rulesCommit: targetCommit,
        excludedFiles: [],
      },
    catalogSource: {
      kind: workspaceRules ? "workspace" : "commit",
      ...(!workspaceRules ? { commit: targetCommit } : {}),
      indexHash: contentHash(resolvedIndexContent),
      files: [
        {
          path: ".agents/rules/always/constraints.md",
          contentHash: contentHash(rulesContent),
        },
        ...(emptyActiveFile
          ? [{
            path: ".agents/rules/domain/empty.md",
            contentHash: contentHash(""),
          }]
          : []),
      ],
    },
    ruleProjection: {
      ruleSetId: "RS-CONSTRUCTION",
      candidateRuleRefs: ["CORE-001", "CORE-002"],
      selectedRuleRefs: ["CORE-001", "CORE-002"],
      excludedRuleRefs: [],
      globallyNotApplicableRuleRefs: [],
    },
    targets: {
      changedUnits: [{
        targetId: "T001",
        targetKind: "changed_unit",
        inputRefs: ["src/main.js"],
        loc: "src/main.js:1",
        summary: "主文件变更",
      }],
      candidates: [{
        targetId: "T002",
        targetKind: "context_candidate",
        inputRefs: ["src/other.js"],
        loc: "src/other.js:1",
        summary: "上下文候选",
      }],
      contextExpansions: [{
        expansionId: "X001",
        reason: "CORE-002 需要上下文",
        addedTargetIds: ["T002"],
      }],
    },
    applicability: {
      encoding: {
        targetOrder: ["T001", "T002"],
        legend: {
          A: "applicable",
          N: "not_applicable",
        },
        rule: "每个 selected rule 的字符串必须与 targetOrder 等长；每个字符显式决定对应 ruleRef × targetId，禁止缺省决定。",
      },
      evidenceProjection: {
        loc: "{target.loc}",
        summary: "固定 {ruleRef} 对 {target.targetId} 为 {decisionZh}",
      },
      notApplicableReason: "固定 {ruleRef} 对 {target.targetId} 不适用",
      byRule: {
        "CORE-001": "AN",
        "CORE-002": "AA",
      },
    },
    batchRuleRefs: {
      B001: ["CORE-001", "CORE-002"],
    },
    expectedCounts: {
      candidateRuleRefs: 2,
      selectedRuleRefs: 2,
      excludedRuleRefs: 0,
      globallyNotApplicableRuleRefs: 0,
      changedUnits: 1,
      candidates: 1,
      targets: 2,
      applicabilityMatrix: 4,
      reviewItems: 3,
      reviewBatches: 1,
    },
  };
  if (mutateInput) mutateInput(input);
  const inputPath = path.join(inputRoot, "dispatch-input.json");
  const output = `.rules-review-tmp/${resolvedRunId}/dispatch.json`;
  writeJson(inputPath, input);
  return {
    root,
    input,
    inputPath,
    output,
    outputPath: path.join(root, output),
    indexContent: resolvedIndexContent,
    rulesContent,
    baseCommit,
    targetCommit,
  };
}

function draft({
  runId = testRunId("run-v8"),
  inputRefs = ["src/main.js"],
  excludedFiles = [],
  candidateRuleRefs = ["CORE-001"],
  selectedRuleRefs = ["CORE-001"],
  excludedRuleRefs = [],
  globallyNotApplicableRuleRefs = [],
  ruleSources,
} = {}) {
  return {
    kind: "rules-review-dispatch",
    schemaVersion: 8,
    runId,
    reviewRange: { excludedFiles },
    ruleSnapshot: { files: [] },
    inputSnapshot: { files: [] },
    ruleSet: {
      ruleSetId: "RS001",
      sourceIndexHash: `sha256:${"0".repeat(64)}`,
      candidateRuleRefs,
      selectedRuleRefs,
      excludedRuleRefs,
      globallyNotApplicableRuleRefs,
      ruleSources: ruleSources || candidateRuleRefs.map((ruleRef) => ({
        namespace: ruleRef.split("-")[0],
        ruleRef,
        ruleLevel: "MUST",
        sourceFile: ruleRef.startsWith("CORE-")
          ? ".agents/rules/always/constraints.md"
          : `.agents/rules/concerns/${ruleRef.split("-")[0].toLowerCase()}.md`,
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
    applicabilityMatrix: selectedRuleRefs.map((ruleRef, index) => ({
      ruleRef,
      targetId: "T001",
      targetKind: "changed_unit",
      applicability: "applicable",
      reviewItemId: `RI${String(index + 1).padStart(3, "0")}`,
      evidence: [{ loc: `${inputRefs[0]}:1`, summary: "适用性已判断" }],
    })),
    reviewItems: selectedRuleRefs.map((ruleRef, index) => ({
      reviewItemId: `RI${String(index + 1).padStart(3, "0")}`,
      ruleRef,
      targetKind: "changed_unit",
      targetId: "T001",
    })),
    reviewBatches: selectedRuleRefs.length === 0 ? [] : [{
      reviewBatchId: "B001",
      reviewItemIds: selectedRuleRefs.map((_, index) => `RI${String(index + 1).padStart(3, "0")}`),
    }],
  };
}

function createDraft(root, options = {}) {
  if (options.candidateRuleRefs?.includes("AUX-001")) {
    writeTestRuleStore(root, options.candidateRuleRefs);
  }
  const runId = testRunId(options.runId || "run-v8");
  const file = path.join(root, ".rules-review-tmp", runId, "dispatch.json");
  writeJson(file, draft({ ...options, runId }));
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
    schemaVersion: 8,
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
  const cleanResponse = response;

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
  assert.doesNotMatch(response, /## 问题(?:\n|$)/);
  assert.doesNotMatch(response, /未发现需要修复或人工验证的项目/);
  assert.ok(response.indexOf("## 无法验证") < response.indexOf("## 其他关注项"));
  assert.ok(response.indexOf("## 其他关注项") < response.indexOf("## 报告"));
  assert.match(cleanResponse, /## 审查结果\n- 未发现需要修复或人工验证的项目。/);

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
  assert.doesNotMatch(response, /## 问题(?:\n|$)|未发现需要修复或人工验证的项目/);
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
  draftDispatch.ruleSet.candidateRuleRefs.push("AUX-001");
  draftDispatch.ruleSet.selectedRuleRefs.push("AUX-001");
  draftDispatch.ruleSet.ruleSources.push({
    ...draftDispatch.ruleSet.ruleSources[0],
    namespace: "AUX",
    ruleRef: "AUX-001",
    sourceFile: ".agents/rules/concerns/aux.md",
  });
  writeTestRuleStore(root, ["CORE-001", "AUX-001"]);
  const targetSpecs = [
    ["T001", "src/main.js", "CI 是否组装 backend 制品", "CORE-001"],
    ["T002", "src/other.js", "WebView 是否允许进入 /backend", "CORE-001"],
    ["T003", "src/host.js", "独立宿主是否生成 /backend 路由", "AUX-001"],
  ];
  draftDispatch.targets.changedUnits = targetSpecs.map(([targetId, inputRef, summary]) => ({
    targetId,
    targetKind: "changed_unit",
    inputRefs: [inputRef],
    loc: `${inputRef}:1`,
    summary,
  }));
  draftDispatch.applicabilityMatrix = draftDispatch.ruleSet.selectedRuleRefs.flatMap((ruleRef) => (
    targetSpecs.map(([targetId, inputRef, , applicableRuleRef], index) => (
      ruleRef === applicableRuleRef
        ? {
          ruleRef,
          targetId,
          targetKind: "changed_unit",
          applicability: "applicable",
          reviewItemId: `RI${String(index + 1).padStart(3, "0")}`,
          evidence: [{ loc: `${inputRef}:1`, summary: "适用性已判断" }],
        }
        : {
          ruleRef,
          targetId,
          targetKind: "changed_unit",
          applicability: "not_applicable",
          reason: `${ruleRef} 不适用于 ${targetId}`,
          evidence: [{ loc: `${inputRef}:1`, summary: "不适用性已判断" }],
        }
    ))
  ));
  draftDispatch.reviewItems = targetSpecs.map(([targetId, , , ruleRef], index) => ({
    reviewItemId: `RI${String(index + 1).padStart(3, "0")}`,
    ruleRef,
    targetKind: "changed_unit",
    targetId,
  }));
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
    schemaVersion: 8,
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
  assert.deepEqual(finalReview.findings[0].evidenceGroups.map((group) => group.ruleRef), ["CORE-001", "CORE-001", "AUX-001"]);
  assert.deepEqual(finalReview.findings[0].evidenceGroups.map((group) => group.priority), ["must_fix", "should_fix", "should_fix"]);
  assert.equal(finalReview.findings[0].evidenceGroups.length, 3);
  assert.equal("otherConcerns" in finalReview, false);
  assert.equal(response.split(rootCause).length - 1, 1);
  assert.match(response, /## 问题/);
  assert.doesNotMatch(response, /## 审查结果/);
  const repositoryRoot = fs.realpathSync(root);
  assert.ok(finalMarkdown.includes([
    `#### F001：${rootCause}`,
    "- RI001｜CORE-001（SHOULD）｜T001｜本次引入",
    "  - 优先级原因：共同门禁缺失会让无制品入口进入生产路径。",
    `  - CI 是否组装 backend 制品｜[src/main.js:1](${path.join(repositoryRoot, "src/main.js")}:1)`,
    "- RI002｜CORE-001（SHOULD）｜T002｜本次引入",
    `  - WebView 是否允许进入 /backend｜[src/other.js:1](${path.join(repositoryRoot, "src/other.js")}:1)`,
    "- RI003｜AUX-001（SHOULD）｜T003｜本次引入",
    `  - 独立宿主是否生成 /backend 路由｜[src/host.js:1](${path.join(repositoryRoot, "src/host.js")}:1)`,
  ].join("\n")));
  assert.ok(response.split("\n").includes(`- F001：${rootCause}`));
  assert.doesNotMatch(response, /CORE-001|AUX-001|src\/(?:main|other|host)\.js:1|目标：T00[123]|来源：|优先级：(must_fix|should_fix)/);

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

test("render-handoff 生成不含本机路径的可转发修复说明", async (t) => {
  const root = createRepository();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "src/main.js"), "export const main = 2;\n");

  const dispatchFile = createDraft(root, { runId: "portable-handoff" });
  const dispatch = await seal(dispatchFile);
  const runDir = path.dirname(dispatchFile);
  const taskDir = path.join(runDir, "tasks");
  await run(["--mode", "build-tasks", "--dispatch", dispatchFile, "--out", taskDir]);
  const task = readJson(path.join(taskDir, "B001.json"));
  const shardFile = path.join(runDir, "shards/B001.json");
  const shard = {
    kind: "rules-review-shard",
    schemaVersion: 8,
    runId: dispatch.runId,
    reviewBatchId: "B001",
    targetTree: dispatch.reviewRange.targetTree,
    taskHash: task.taskHash,
    results: [{
      reviewItemId: "RI001",
      status: "finding",
      rootCause: "主文件缺少必要保护。",
      origin: "introduced_by_change",
      evidence: [{ loc: "src/main.js:1", summary: "变更直接暴露未保护入口" }],
    }],
  };
  writeJson(shardFile, shard);

  for (const args of [
    ["--mode", "aggregate-final", "--dir", runDir, "--output", path.join(runDir, "finalReview.json")],
    ["--mode", "render-final", "--input", path.join(runDir, "finalReview.json"), "--dispatch", dispatchFile, "--output", path.join(runDir, "final.md")],
    ["--mode", "render-handoff", "--dir", runDir],
  ]) {
    await run(args);
  }

  const handoffFile = path.join(runDir, "handoff.md");
  let handoff = fs.readFileSync(handoffFile, "utf8");
  assert.match(handoff, /# rules-review 修复交接/);
  assert.match(handoff, new RegExp(`runId：${dispatch.runId}`));
  assert.match(handoff, new RegExp(`目标 commit：${dispatch.reviewRange.boundCommit}`));
  assert.match(handoff, /审查结论：发现问题/);
  assert.match(handoff, /F001：主文件缺少必要保护。/);
  assert.match(handoff, /RI001｜CORE-001（MUST）｜T001｜本次引入/);
  assert.match(handoff, /变更直接暴露未保护入口｜`src\/main\.js:1`/);
  assert.doesNotMatch(handoff, new RegExp(fs.realpathSync(root).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  shard.results[0] = {
    reviewItemId: "RI001",
    status: "cannot_verify",
    reason: "缺少目标宿主环境。",
  };
  writeJson(shardFile, shard);
  for (const args of [
    ["--mode", "aggregate-final", "--dir", runDir, "--output", path.join(runDir, "finalReview.json")],
    ["--mode", "render-final", "--input", path.join(runDir, "finalReview.json"), "--dispatch", dispatchFile, "--output", path.join(runDir, "final.md")],
    ["--mode", "render-handoff", "--dir", runDir],
    ["--mode", "run", "--dir", runDir],
  ]) {
    await run(args);
  }
  handoff = fs.readFileSync(handoffFile, "utf8");
  assert.match(handoff, /## 无法验证/);
  assert.match(handoff, /RI001｜CORE-001｜T001：缺少目标宿主环境。/);
  assert.doesNotMatch(handoff, /主文件缺少必要保护。/);
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
  }));
  draftDispatch.reviewBatches = ["B001", "B002"].map((reviewBatchId, index) => ({
    reviewBatchId,
    reviewItemIds: [`RI${String(index + 1).padStart(3, "0")}`],
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
      schemaVersion: 8,
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

test("construct-dispatch 对 2×2 紧凑输入做完整确定性投影", async (t) => {
  const fixture = createConstructionCase(t, { productionInput: true });
  const inputBefore = fs.readFileSync(fixture.inputPath);
  const construction = await runJson([
    "--mode", "construct-dispatch",
    "--input", fixture.inputPath,
    "--output", fixture.output,
  ], fixture.root);
  const dispatch = readJson(fixture.outputPath);

  assert.equal(construction.ok, true);
  assert.equal(construction.rendered, fixture.output);
  assert.deepEqual(fs.readFileSync(fixture.inputPath), inputBefore);
  assert.deepEqual(dispatch.ruleInputSource, {
    kind: "commit",
    commit: fixture.targetCommit,
  });
  assert.deepEqual(dispatch.ruleSet, {
    ruleSetId: "RS-CONSTRUCTION",
    sourceIndexHash: contentHash(fixture.indexContent),
    candidateRuleRefs: ["CORE-001", "CORE-002"],
    selectedRuleRefs: ["CORE-001", "CORE-002"],
    excludedRuleRefs: [],
    globallyNotApplicableRuleRefs: [],
    ruleSources: [{
      namespace: "CORE",
      ruleRef: "CORE-001",
      ruleLevel: "MUST",
      sourceFile: ".agents/rules/always/constraints.md",
      sourceHash: contentHash(fixture.rulesContent),
      trigger: "每次任务必读",
      appliesTo: "每次任务",
      summary: "检查主文件",
      ruleText: "检查主文件。",
      failureConditions: [{
        conditionId: "CORE-001-FC-01",
        summary: "未检查主文件。",
      }],
    }, {
      namespace: "CORE",
      ruleRef: "CORE-002",
      ruleLevel: "SHOULD",
      sourceFile: ".agents/rules/always/constraints.md",
      sourceHash: contentHash(fixture.rulesContent),
      trigger: "每次任务必读",
      appliesTo: "存在上下文候选时",
      summary: "检查上下文",
      ruleText: "检查上下文。",
      failureConditions: [{
        conditionId: "CORE-002-FC-01",
        summary: "未检查上下文。",
      }],
    }],
  });
  assert.deepEqual(dispatch.targets, fixture.input.targets);
  assert.deepEqual(dispatch.applicabilityMatrix, [{
    ruleRef: "CORE-001",
    targetId: "T001",
    targetKind: "changed_unit",
    applicability: "applicable",
    reviewItemId: "RI001",
    evidence: [{
      loc: "src/main.js:1",
      summary: "固定 CORE-001 对 T001 为 适用",
    }],
  }, {
    ruleRef: "CORE-001",
    targetId: "T002",
    targetKind: "context_candidate",
    applicability: "not_applicable",
    reason: "固定 CORE-001 对 T002 不适用",
    evidence: [{
      loc: "src/other.js:1",
      summary: "固定 CORE-001 对 T002 为 不适用",
    }],
  }, {
    ruleRef: "CORE-002",
    targetId: "T001",
    targetKind: "changed_unit",
    applicability: "applicable",
    reviewItemId: "RI002",
    evidence: [{
      loc: "src/main.js:1",
      summary: "固定 CORE-002 对 T001 为 适用",
    }],
  }, {
    ruleRef: "CORE-002",
    targetId: "T002",
    targetKind: "context_candidate",
    applicability: "applicable",
    reviewItemId: "RI003",
    evidence: [{
      loc: "src/other.js:1",
      summary: "固定 CORE-002 对 T002 为 适用",
    }],
  }]);
  assert.deepEqual(dispatch.reviewItems, [{
    reviewItemId: "RI001",
    ruleRef: "CORE-001",
    targetKind: "changed_unit",
    targetId: "T001",
  }, {
    reviewItemId: "RI002",
    ruleRef: "CORE-002",
    targetKind: "changed_unit",
    targetId: "T001",
  }, {
    reviewItemId: "RI003",
    ruleRef: "CORE-002",
    targetKind: "context_candidate",
    targetId: "T002",
  }]);
  assert.equal("executionPlan" in dispatch, false);
  assert.deepEqual(dispatch.reviewBatches, [{
    reviewBatchId: "B001",
    reviewItemIds: ["RI001", "RI002", "RI003"],
  }]);
  assert.match(
    dispatch.ruleSnapshot.files.find((entry) =>
      entry.path === ".agents/rules/always/constraints.md"
    ).content,
    /- 通过条件：/,
  );
  assert.equal("passConditions" in dispatch.ruleSet.ruleSources[0], false);
  const validation = await runJson(["--mode", "dispatch", "--input", fixture.outputPath], fixture.root);
  assert.equal(validation.ok, true);
});

test("construct-dispatch 要求通过条件使用非空两空格缩进列表", async (t) => {
  const cases = [
    {
      name: "missing",
      mutate(content) {
        return content.replace(
          "- 通过条件：\n  - 主文件已经完成检查。\n",
          "",
        );
      },
      expected: /rule list is missing: 通过条件/,
    },
    {
      name: "empty",
      mutate(content) {
        return content.replace(
          "- 通过条件：\n  - 主文件已经完成检查。\n",
          "- 通过条件：\n",
        );
      },
      expected: /rule list is empty: 通过条件/,
    },
    {
      name: "misindented",
      mutate(content) {
        return content.replace(
          "  - 主文件已经完成检查。",
          "    - 主文件已经完成检查。",
        );
      },
      expected: /rule list is empty: 通过条件/,
    },
  ];

  for (const { name, mutate, expected } of cases) {
    const fixture = createConstructionCase(t, {
      runId: `pass-conditions-${name}`,
      productionInput: true,
      workspaceRules: true,
    });
    const invalidRules = mutate(fixture.rulesContent);
    fs.writeFileSync(
      path.join(fixture.root, ".agents/rules/always/constraints.md"),
      invalidRules,
    );
    fixture.input.catalogSource.files[0].contentHash = contentHash(invalidRules);
    writeJson(fixture.inputPath, fixture.input);

    await expectFailure([
      "--mode", "construct-dispatch",
      "--input", fixture.inputPath,
      "--output", fixture.output,
    ], expected, fixture.root);
    assert.equal(fs.existsSync(fixture.outputPath), false);
  }
});

test("空 TARGET 即使 selected 规则声明 requiredContext 也不生成审查工件", async (t) => {
  const root = createRepository();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = createDraft(root, { runId: "empty-target" });
  const dispatch = readJson(file);
  dispatch.ruleSet.ruleSources[0].requiredContext = [{
    contextId: "CTX-001",
    summary: "需要额外上下文",
  }];
  dispatch.targets = {
    changedUnits: [],
    candidates: [],
    contextExpansions: [],
  };
  dispatch.applicabilityMatrix = [];
  dispatch.reviewItems = [];
  dispatch.reviewBatches = [];
  writeJson(file, dispatch);

  const sealed = await seal(file);
  assert.deepEqual(sealed.ruleSet.selectedRuleRefs, ["CORE-001"]);
  assert.equal("requiredRuleRefs" in sealed.ruleSet, false);
  assert.deepEqual(sealed.applicabilityMatrix, []);
  assert.deepEqual(sealed.reviewItems, []);
  assert.deepEqual(sealed.reviewBatches, []);

  const runDir = path.dirname(file);
  await run([
    "--mode", "aggregate-final",
    "--dir", runDir,
    "--output", path.join(runDir, "finalReview.json"),
  ]);
  assert.equal(readJson(path.join(runDir, "finalReview.json")).recommendation, "ready_for_merge");
});

test("construct-dispatch 用普通紧凑输入封印 workspace 规则", async (t) => {
  const fixture = createConstructionCase(t, {
    runId: "workspace-construction",
    productionInput: true,
    workspaceRules: true,
  });
  const workspaceRules = fixture.rulesContent.replace(
    "检查主文件。",
    "检查 workspace 中的主文件。",
  );
  fs.writeFileSync(
    path.join(fixture.root, ".agents/rules/always/constraints.md"),
    workspaceRules,
  );
  fixture.input.catalogSource.files[0].contentHash = contentHash(workspaceRules);
  writeJson(fixture.inputPath, fixture.input);

  const construction = await runJson([
    "--mode", "construct-dispatch",
    "--input", fixture.inputPath,
    "--output", fixture.output,
  ], fixture.root);
  const dispatch = readJson(fixture.outputPath);

  assert.equal(construction.ok, true);
  assert.deepEqual(dispatch.ruleInputSource, { kind: "workspace" });
  assert.equal(
    dispatch.ruleSnapshot.files.find(({ path: file }) =>
      file === ".agents/rules/always/constraints.md"
    ).content,
    workspaceRules,
  );
  assert.equal(dispatch.ruleSet.ruleSources[0].ruleText, "检查 workspace 中的主文件。");
  const validation = await runJson(
    ["--mode", "dispatch", "--input", fixture.outputPath],
    fixture.root,
  );
  assert.equal(validation.ok, true);
});

test("construct-dispatch 拒绝 construction input v1", async (t) => {
  const fixture = createConstructionCase(t, {
    productionInput: true,
    mutateInput(input) {
      input.schemaVersion = 1;
    },
  });
  await expectFailure([
    "--mode", "construct-dispatch",
    "--input", fixture.inputPath,
    "--output", fixture.output,
  ], /schemaVersion must equal 2/, fixture.root);
  assert.equal(fs.existsSync(fixture.outputPath), false);
});

test("construct-dispatch 在 catalogSource 漂移时失败且不产生 dispatch", async (t) => {
  const fixture = createConstructionCase(t, {
    runId: "catalog-drift",
    productionInput: true,
    workspaceRules: true,
  });
  fs.writeFileSync(
    path.join(fixture.root, ".agents/rules/always/constraints.md"),
    fixture.rulesContent.replace("检查主文件。", "catalog 后修改规则。"),
  );
  await expectFailure([
    "--mode", "construct-dispatch",
    "--input", fixture.inputPath,
    "--output", fixture.output,
  ], /catalogSource.*contentHash|catalog source.*hash/i, fixture.root);
  assert.equal(fs.existsSync(fixture.outputPath), false);
});

test("construct-dispatch 重新检查 retired 冲突", async (t) => {
  const fixture = createConstructionCase(t, {
    runId: "retired-drift",
    productionInput: true,
    workspaceRules: true,
  });
  fs.writeFileSync(
    path.join(fixture.root, ".agents/rules/retired.md"),
    [
      "# Retired Rules",
      "",
      "### CORE-001 检查主文件",
      "",
      "- 替代：无",
      "- 原因：catalog 后形成冲突",
      "",
    ].join("\n"),
  );
  await expectFailure([
    "--mode", "construct-dispatch",
    "--input", fixture.inputPath,
    "--output", fixture.output,
  ], /both active and retired/, fixture.root);
  assert.equal(fs.existsSync(fixture.outputPath), false);
});

test("construct-dispatch 要求 candidateRuleRefs 等于全部 active IDs", async (t) => {
  const fixture = createConstructionCase(t, {
    runId: "missing-candidate",
    productionInput: true,
    mutateInput(input) {
      input.ruleProjection.candidateRuleRefs = ["CORE-001"];
      input.ruleProjection.selectedRuleRefs = ["CORE-001"];
      delete input.applicability.byRule["CORE-002"];
      input.batchRuleRefs.B001 = ["CORE-001"];
      Object.assign(input.expectedCounts, {
        candidateRuleRefs: 1,
        selectedRuleRefs: 1,
        applicabilityMatrix: 2,
        reviewItems: 1,
      });
    },
  });
  await expectFailure([
    "--mode", "construct-dispatch",
    "--input", fixture.inputPath,
    "--output", fixture.output,
  ], /candidateRuleRefs must equal all active rule IDs/, fixture.root);
  assert.equal(fs.existsSync(fixture.outputPath), false);
});

test("dispatch 封印空 active 文件，task 仍只投影当前 batch 规则文件", async (t) => {
  const fixture = createConstructionCase(t, {
    runId: "empty-active-file",
    productionInput: true,
    emptyActiveFile: true,
  });
  await run([
    "--mode", "construct-dispatch",
    "--input", fixture.inputPath,
    "--output", fixture.output,
  ], fixture.root);
  const dispatch = readJson(fixture.outputPath);
  assert.deepEqual(dispatch.ruleSnapshot.files.map(({ path: file }) => file), [
    ".agents/rules/always/constraints.md",
    ".agents/rules/domain/empty.md",
    ".agents/rules/index.md",
  ]);
  const taskDir = path.join(path.dirname(fixture.outputPath), "tasks");
  await run([
    "--mode", "build-tasks",
    "--dispatch", fixture.outputPath,
    "--out", taskDir,
  ], fixture.root);
  assert.deepEqual(readJson(path.join(taskDir, "B001.json")).ruleSnapshot.files.map(({ path: file }) => file), [
    ".agents/rules/always/constraints.md",
    ".agents/rules/index.md",
  ]);
  dispatch.ruleSnapshot.files = dispatch.ruleSnapshot.files.filter(
    ({ path: file }) => file !== ".agents/rules/domain/empty.md",
  );
  writeJson(fixture.outputPath, dispatch);
  await expectFailure(
    ["--mode", "dispatch", "--input", fixture.outputPath],
    /all active rule files|missing active rule file snapshot/,
    fixture.root,
  );
});

test("construct-dispatch 拒绝未声明的构造输入身份", async (t) => {
  const fixture = createConstructionCase(t, {
    productionInput: true,
    mutateInput(input) {
      input.kind = "other-construction-input";
    },
  });
  await expectFailure([
    "--mode", "construct-dispatch",
    "--input", fixture.inputPath,
    "--output", fixture.output,
  ], /construction input kind/, fixture.root);
  assert.equal(fs.existsSync(fixture.outputPath), false);
});

test("construct-dispatch 拒绝非规范提交身份", async (t) => {
  const fixture = createConstructionCase(t, {
    productionInput: true,
    mutateInput(input) {
      input.repository.targetCommit = "HEAD";
    },
  });
  await expectFailure([
    "--mode", "construct-dispatch",
    "--input", fixture.inputPath,
    "--output", fixture.output,
  ], /normalized commit ID/, fixture.root);
  assert.equal(fs.existsSync(fixture.outputPath), false);
});

test("construct-dispatch 拒绝不符合 rule-steward 协议的索引", async (t) => {
  const fixture = createConstructionCase(t, {
    productionInput: true,
    indexContent: "| `CORE` | active | `always/constraints.md` | 每次任务必读 |\n",
  });
  await expectFailure([
    "--mode", "construct-dispatch",
    "--input", fixture.inputPath,
    "--output", fixture.output,
  ], /Namespaces/, fixture.root);
  assert.equal(fs.existsSync(fixture.outputPath), false);
});

test("construct-dispatch 对同一 run 只允许一个并发写入成功", async (t) => {
  const fixture = createConstructionCase(t);
  const attempts = await Promise.allSettled(Array.from({ length: 4 }, () => run([
    "--mode", "construct-dispatch",
    "--input", fixture.inputPath,
    "--output", fixture.output,
  ], fixture.root)));
  assert.equal(attempts.filter((attempt) => attempt.status === "fulfilled").length, 1);
  const validation = await runJson(["--mode", "dispatch", "--input", fixture.outputPath], fixture.root);
  assert.equal(validation.ok, true);
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
  assert.deepEqual(dispatch.ruleSnapshot.files.map((entry) => entry.path), [".agents/rules/always/constraints.md", ".agents/rules/index.md"]);

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
  const targetRule = git(root, ["show", `${target}:.agents/rules/always/constraints.md`]);

  writeTestRuleStore(root, ["WORK-001"]);
  const workspaceRulePath = path.join(root, ".agents/rules/concerns/work.md");
  fs.writeFileSync(
    workspaceRulePath,
    testRuleBlock("WORK-001").replace("检查当前变更。", "工作区新规则。"),
  );
  const file = createDraft(root, {
    runId: "workspace-rules",
    candidateRuleRefs: ["WORK-001"],
    selectedRuleRefs: ["WORK-001"],
    ruleSources: [{
      namespace: "WORK",
      ruleRef: "WORK-001",
      ruleLevel: "MUST",
      sourceFile: ".agents/rules/concerns/work.md",
      sourceHash: `sha256:${"0".repeat(64)}`,
      trigger: ["always"],
      appliesTo: ["*"],
      summary: "工作区新规则",
    }],
  });

  const dispatch = await seal(file, target, base);
  const snapshotRule = dispatch.ruleSnapshot.files.find((entry) => entry.path === ".agents/rules/concerns/work.md");
  assert.deepEqual(dispatch.ruleInputSource, { kind: "workspace" });
  assert.deepEqual(dispatch.ruleSet.candidateRuleRefs, ["WORK-001"]);
  assert.equal(dispatch.ruleSet.ruleSources[0].summary, "工作区新规则");
  assert.match(snapshotRule.content, /工作区新规则/);
  assert.doesNotMatch(targetRule, /工作区新规则/);

  fs.writeFileSync(workspaceRulePath, testRuleBlock("WORK-001").replace("检查当前变更。", "封印后再次修改。"));
  const runDir = await materializePassingRun(file);
  const task = readJson(path.join(runDir, "tasks/B001.json"));
  assert.deepEqual(task.ruleInputSource, { kind: "workspace" });
  assert.match(task.ruleSnapshot.files.find((entry) => entry.path === ".agents/rules/concerns/work.md").content, /工作区新规则/);
  assert.doesNotMatch(task.ruleSnapshot.files.find((entry) => entry.path === ".agents/rules/concerns/work.md").content, /封印后再次修改/);
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

  writeTestRuleStore(root, ["RULE-001"]);
  const committedRulePath = path.join(root, ".agents/rules/concerns/rule.md");
  fs.writeFileSync(
    committedRulePath,
    testRuleBlock("RULE-001").replace("检查当前变更。", "指定 commit 规则。"),
  );
  git(root, ["add", ".agents/rules"]);
  git(root, ["commit", "-qm", "rules"]);
  const rulesCommit = git(root, ["rev-parse", "HEAD"]);

  writeTestRuleStore(root, ["WORK-001"]);
  fs.writeFileSync(
    path.join(root, ".agents/rules/concerns/work.md"),
    testRuleBlock("WORK-001").replace("检查当前变更。", "工作区规则。"),
  );
  const ruleSources = [{
    namespace: "RULE",
    ruleRef: "RULE-001",
    ruleLevel: "MUST",
    sourceFile: ".agents/rules/concerns/rule.md",
    sourceHash: `sha256:${"0".repeat(64)}`,
    trigger: ["always"],
    appliesTo: ["*"],
    summary: "指定 commit 规则",
  }];
  const file = createDraft(root, {
    runId: "commit-rules",
    candidateRuleRefs: ["RULE-001"],
    selectedRuleRefs: ["RULE-001"],
    ruleSources,
  });

  const dispatch = await seal(file, target, base, rulesCommit);
  const snapshotRule = dispatch.ruleSnapshot.files.find((entry) => entry.path === ".agents/rules/concerns/rule.md");
  assert.deepEqual(dispatch.ruleInputSource, { kind: "commit", commit: rulesCommit });
  assert.deepEqual(dispatch.ruleSet.candidateRuleRefs, ["RULE-001"]);
  assert.match(snapshotRule.content, /指定 commit 规则/);
  assert.doesNotMatch(snapshotRule.content, /工作区规则/);
  assert.doesNotMatch(git(root, ["show", `${target}:.agents/rules/always/constraints.md`]), /指定 commit 规则/);

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
  const driftedRule = drifted.ruleSnapshot.files.find((entry) => entry.path === ".agents/rules/concerns/rule.md");
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

  writeTestRuleStore(root, ["CORE-001"]);
  const invalidFile = createDraft(root, { runId: "missing-file", inputRefs: ["src/main.js"] });
  await expectFailure(
    ["--mode", "seal-dispatch", "--input", invalidFile, "--base", dispatch.reviewRange.baseCommit, "--target-commit", dispatch.reviewRange.boundCommit],
    /targetTree changed file is not covered by changedUnits\.inputRefs/,
  );
});

test("v8 finalReview 独立校验和 schema 均拒绝文件排除", async (t) => {
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

test("非空 TARGET 拒绝 selected 规则全部判为不适用", async (t) => {
  const root = createRepository();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "src/main.js"), "export const main = 2;\n");
  const file = createDraft(root, { runId: "selected-without-review-item" });
  const dispatch = await seal(file);
  dispatch.applicabilityMatrix = [{
    ruleRef: "CORE-001",
    targetId: "T001",
    targetKind: "changed_unit",
    applicability: "not_applicable",
    reason: "错误地全部判为不适用",
    evidence: [{ loc: "src/main.js:1", summary: "适用性已判断" }],
  }];
  dispatch.reviewItems = [];
  dispatch.reviewBatches = [];
  writeJson(file, dispatch);

  await expectFailure(
    ["--mode", "dispatch", "--input", file],
    /selectedRuleRef must generate at least one reviewItem when targets exist/,
  );
});

test("非空 TARGET 拒绝缺少 selectedRuleRef × targetId 矩阵行", async (t) => {
  const root = createRepository();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "src/main.js"), "export const main = 2;\n");
  const file = createDraft(root, { runId: "missing-selected-matrix-row" });
  const dispatch = await seal(file);
  dispatch.applicabilityMatrix = [];
  writeJson(file, dispatch);

  await expectFailure(
    ["--mode", "dispatch", "--input", file],
    /applicabilityMatrix must cover every selectedRuleRef x target pair/,
  );
});

test("每个 reviewItem 必须由当前 run 分派，非空 reviewItems 禁止空 batch", async (t) => {
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
  writeJson(file, dispatch);
  await expectFailure(["--mode", "dispatch", "--input", file], /reviewItem must be assigned to one reviewBatch/);
});

test("v8 程序化覆盖缺失结果、重复结果、证据缺失和坏 context expansion", async (t) => {
  const root = createRepository();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "src/main.js"), "export const main = 2;\n");
  const file = createDraft(root, { runId: "core-negative-coverage" });
  const dispatch = await seal(file);
  const runDir = path.dirname(file);
  const taskDir = path.join(runDir, "tasks");
  await run(["--mode", "build-tasks", "--dispatch", file, "--out", taskDir]);
  const taskFile = path.join(taskDir, "B001.json");
  const task = readJson(taskFile);
  const validShard = passedShard(dispatch, task);
  const cases = [
    {
      name: "missing-result",
      results: [],
      expected: /shard results must cover every task reviewItem/,
    },
    {
      name: "duplicate-result",
      results: [validShard.results[0], validShard.results[0]],
      expected: /reviewItem has duplicate results in shard/,
    },
    {
      name: "missing-evidence",
      results: [{ ...validShard.results[0], evidence: [] }],
      expected: /passed result requires evidence/,
    },
  ];

  for (const { name, results, expected } of cases) {
    const shardFile = path.join(root, `${name}.json`);
    writeJson(shardFile, { ...validShard, results });
    await expectFailure(
      ["--mode", "shard", "--task", taskFile, "--input", shardFile],
      expected,
    );
  }

  const invalidDispatch = readJson(file);
  invalidDispatch.targets.contextExpansions = [{
    expansionId: "X001",
    reason: "错误引用不存在的候选 target",
    addedTargetIds: ["T999"],
  }];
  writeJson(file, invalidDispatch);
  await expectFailure(
    ["--mode", "dispatch", "--input", file],
    /contextExpansions\[\]\.addedTargetIds\[\] must exist/,
  );
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

test("runId 只接受 UTC 时间、rr 标记和 8 位小写十六进制随机后缀", async (t) => {
  const root = createRepository();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "src/main.js"), "export const main = 2;\n");
  const file = createDraft(root, { runId: "20260810T073012Z-rr-a1b2c3d4" });
  const dispatch = await seal(file);

  dispatch.runId = "run-v8";
  writeJson(file, dispatch);
  await expectFailure(
    ["--mode", "dispatch", "--input", file],
    /runId must match YYYYMMDDTHHmmssZ-rr-xxxxxxxx/,
  );

  for (const schemaFile of [
    "dispatch.schema.json",
    "task.schema.json",
    "shard.schema.json",
    "final-review.schema.json",
  ]) {
    const schema = readJson(path.join(repoRoot, "skills/rules-review/schemas", schemaFile));
    const pattern = new RegExp(schema.properties.runId.pattern);
    assert.equal(pattern.test("20260810T073012Z-rr-a1b2c3d4"), true, schemaFile);
    assert.equal(pattern.test("run-v8"), false, schemaFile);
  }
});

test("v7 工件与旧 incremental 字段明确拒绝，v8 工件通过", async (t) => {
  const root = createRepository();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "src/main.js"), "export const main = 2;\n");
  const file = createDraft(root);
  await seal(file);
  const dispatch = readJson(file);
  const current = await runJson(["--mode", "dispatch", "--input", file]);
  assert.equal(current.ok, true);

  dispatch.ruleSet.requiredRuleRefs = [...dispatch.ruleSet.selectedRuleRefs];
  writeJson(file, dispatch);
  await expectFailure(
    ["--mode", "dispatch", "--input", file],
    /ruleSet contains unsupported field/,
  );
  delete dispatch.ruleSet.requiredRuleRefs;

  dispatch.schemaVersion = 7;
  writeJson(file, dispatch);
  await expectFailure(["--mode", "dispatch", "--input", file], /schemaVersion must match rules-review protocol/);

  dispatch.schemaVersion = 8;
  dispatch.continuation = { baseRunId: "old-run" };
  dispatch.fullReason = "legacy";
  dispatch.inputSource = { mode: "worktree" };
  writeJson(file, dispatch);
  await expectFailure(["--mode", "dispatch", "--input", file], /dispatch contains unsupported field/);

  for (const schemaFile of [
    "dispatch.schema.json",
    "task.schema.json",
    "shard.schema.json",
    "validation.schema.json",
    "final-review.schema.json",
  ]) {
    const schema = readJson(path.join(repoRoot, "skills/rules-review/schemas", schemaFile));
    assert.equal(schema.properties.schemaVersion.const, 8, schemaFile);
  }
  assert.equal(
    fs.existsSync(path.join(repoRoot, "skills/rules-review/schemas/retry-task.schema.json")),
    false,
  );
});

test("静态 reviewBatch 直接从 task 和 shard 文件派生完成态", async (t) => {
  const root = createRepository();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "src/main.js"), "export const main = 2;\n");
  const dispatchFile = createDraft(root, { runId: "static-batch-state" });
  const dispatch = await seal(dispatchFile);

  const runDir = path.dirname(dispatchFile);
  const taskDir = path.join(runDir, "tasks");
  await run(["--mode", "build-tasks", "--dispatch", dispatchFile, "--out", taskDir]);
  const task = readJson(path.join(taskDir, "B001.json"));
  const shard = passedShard(dispatch, task);
  writeJson(path.join(runDir, "shards/B001.json"), shard);

  const aggregation = await runJson([
    "--mode", "aggregate-final",
    "--dir", runDir,
    "--output", path.join(runDir, "finalReview.json"),
  ]);
  assert.equal(aggregation.ok, true);
  assert.equal(aggregation.gate.protocolGate, "passed");

  dispatch.reviewBatches[0].returnStatus = "returned";
  writeJson(dispatchFile, dispatch);
  await expectFailure(
    ["--mode", "dispatch", "--input", dispatchFile],
    /reviewBatch contains unsupported field/,
  );
});

test("retry-task 不再是 rules-review 协议入口", async (t) => {
  const root = createRepository();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "retry-task.json");
  writeJson(file, {
    kind: "rules-review-retry-task",
    schemaVersion: currentProtocolVersion(),
    runId: "removed-retry",
    retryAttempt: 1,
    reason: "修正格式错误",
    originalTaskRef: "tasks/B001.json",
    violations: [],
    outputContract: {
      format: "strict_json",
      schemaRef: "schemas/shard.schema.json",
    },
  });

  await expectFailure(
    ["--mode", "retry-task", "--input", file],
    /unknown or missing mode/,
  );
  fs.rmSync(file);

  fs.writeFileSync(path.join(root, "src/main.js"), "export const main = 2;\n");
  const dispatchFile = createDraft(root, { runId: "removed-retry-run" });
  await seal(dispatchFile);
  const runDir = await materializePassingRun(dispatchFile);
  writeJson(path.join(runDir, "retries/B001.json"), {});
  await expectFailure(
    ["--mode", "run", "--dir", runDir],
    /RUN003|only contain rules-review protocol artifacts/,
  );
});

test("reviewItem.required 与 shard not_applicable 不再是协议路径", async (t) => {
  const root = createRepository();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "src/main.js"), "export const main = 2;\n");
  const dispatchFile = createDraft(root, { runId: "removed-optional-item" });
  const dispatch = await seal(dispatchFile);
  const taskDir = path.join(path.dirname(dispatchFile), "tasks");
  await run(["--mode", "build-tasks", "--dispatch", dispatchFile, "--out", taskDir]);
  const taskFile = path.join(taskDir, "B001.json");
  const task = readJson(taskFile);
  const optionalTaskFile = path.join(root, "optional-task.json");
  const optionalTask = structuredClone(task);
  optionalTask.reviewItems[0].required = false;
  optionalTask.taskHash = calculateTaskHash(optionalTask);
  writeJson(optionalTaskFile, optionalTask);
  await expectFailure(
    ["--mode", "task", "--input", optionalTaskFile],
    /task reviewItem contains unsupported field|required/,
  );

  const shardFile = path.join(path.dirname(dispatchFile), "shards/B001.json");
  writeJson(shardFile, {
    kind: "rules-review-shard",
    schemaVersion: currentProtocolVersion(),
    runId: dispatch.runId,
    reviewBatchId: "B001",
    targetTree: dispatch.reviewRange.targetTree,
    taskHash: task.taskHash,
    results: [{
      reviewItemId: "RI001",
      status: "not_applicable",
      reason: "reviewer 运行时改判不适用",
    }],
  });

  await expectFailure(
    ["--mode", "shard", "--task", taskFile, "--input", shardFile],
    /not_applicable|status.*valid/,
  );
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
  assert.match(skill, /`targetCommit`/);
  assert.match(skill, /rulesCommit/);
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
