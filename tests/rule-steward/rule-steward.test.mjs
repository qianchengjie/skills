import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const initScript = path.join(repoRoot, "skills/rule-steward/scripts/init-rules.mjs");
const getScript = path.join(repoRoot, "skills/rule-steward/scripts/get-rules.mjs");

async function runNode(args, options = {}) {
  return execFileAsync(process.execPath, args, {
    cwd: repoRoot,
    ...options,
  });
}

async function runGit(root, args) {
  return execFileAsync("git", args, { cwd: root });
}

function hash(content) {
  return `sha256:${crypto.createHash("sha256").update(content).digest("hex")}`;
}

async function assertFails(args, pattern) {
  try {
    await runNode(args);
  } catch (error) {
    assert.match(`${error.stderr}${error.stdout}`, pattern);
    return error;
  }
  assert.fail(`Expected command to fail: ${args.join(" ")}`);
}

const root = await mkdtemp(path.join(os.tmpdir(), "rule-steward-"));

const absentRoot = await mkdtemp(path.join(os.tmpdir(), "rule-steward-absent-"));
await runGit(absentRoot, ["init", "-q"]);
const optionalAbsentCatalog = JSON.parse((await runNode([
  getScript,
  "--root",
  absentRoot,
  "--catalog",
  "--optional-source",
])).stdout);
assert.deepEqual(optionalAbsentCatalog, { source: { kind: "absent" }, rules: [] });
await assertFails([getScript, "--root", absentRoot, "--catalog"], /Missing rules index/);
await assertFails(
  [getScript, "--root", path.join(absentRoot, "missing"), "--catalog", "--optional-source"],
  /Invalid repository root/,
);
await assertFails(
  [getScript, "--root", absentRoot, "--catalog", "--optional-source", "--commit", "0".repeat(40)],
  /--optional-source only supports workspace catalogs/,
);

const partialRoot = await mkdtemp(path.join(os.tmpdir(), "rule-steward-partial-"));
await mkdir(path.join(partialRoot, ".agents/rules"), { recursive: true });
await assertFails(
  [getScript, "--root", partialRoot, "--catalog", "--optional-source"],
  /Missing rules index/,
);

const initResult = await runNode([initScript, "--root", root]);
assert.match(initResult.stdout, /Initialized rule store/);
assert.match(initResult.stdout, /建议加入 AGENTS\.md 的入口片段/);
assert.match(initResult.stdout, /涉及规则判断时，引用相关规则 ID/);
assert.match(initResult.stdout, /项目规则不覆盖系统 \/ 开发者 \/ 用户指令/);
assert.doesNotMatch(initResult.stdout, /如果未读取项目规则/);
assert.match(initResult.stdout, /本脚本不会自动修改 AGENTS\.md/);

const indexPath = path.join(root, ".agents/rules/index.md");
assert.match(await readFile(indexPath, "utf8"), /\| `CORE` \| active \| `always\/constraints\.md` \|/);
assert.match(
  await readFile(path.join(root, ".agents/rules/always/constraints.md"), "utf8"),
  /载体由消费 workflow 指定/,
);
assert.match(
  await readFile(path.join(root, ".agents/rules/always/constraints.md"), "utf8"),
  /- 通过条件：/,
);

const optionalEmptyCatalog = JSON.parse((await runNode([
  getScript,
  "--root",
  root,
  "--catalog",
  "--optional-source",
])).stdout);
assert.equal(optionalEmptyCatalog.source.kind, "workspace");
assert.match(optionalEmptyCatalog.source.indexHash, /^sha256:[0-9a-f]{64}$/);
assert.deepEqual(optionalEmptyCatalog.source.files.map((file) => file.path), [
  ".agents/rules/always/constraints.md",
]);
assert.deepEqual(optionalEmptyCatalog.rules, []);

await assertFails([initScript, "--root", root], /Refusing to overwrite existing file/);
await assertFails([getScript, "--root", root, "CORE-001"], /Rule not found: CORE-001/);

await writeFile(
  indexPath,
  `# Rules Index

## Namespaces

| Namespace | 状态 | 文件 | 触发条件 |
| --- | --- | --- | --- |
| \`CORE\` | active | \`concerns/README.md\` | 每次任务必读 |
`,
);
await assertFails([getScript, "--root", root, "CORE-001"], /Invalid active rule file path/);

await writeFile(path.join(root, ".agents/rules/concerns/core.md"), "# Wrong CORE target\n");
await writeFile(
  indexPath,
  `# Rules Index

## Namespaces

| Namespace | 状态 | 文件 | 触发条件 |
| --- | --- | --- | --- |
| \`CORE\` | active | \`concerns/core.md\` | 每次任务必读 |
`,
);
await assertFails([getScript, "--root", root, "CORE-001"], /CORE namespace must use always\/constraints\.md/);

await writeFile(
  indexPath,
  `# Rules Index

## Namespaces

| Namespace | 状态 | 文件 | 触发条件 |
| --- | --- | --- | --- |
| \`CORE\` | retired | \`always/constraints.md\` | 每次任务必读 |
`,
);
await assertFails([getScript, "--root", root, "CORE-001"], /CORE namespace must be active/);

await writeFile(
  indexPath,
  `# Rules Index

## Namespaces

| Namespace | 状态 | 文件 | 触发条件 |
| --- | --- | --- | --- |
| \`FOO\` | active | \`concerns/core.md\` | 测试 |
`,
);
await assertFails([getScript, "--root", root, "CORE-001"], /Missing required CORE namespace/);

await writeFile(
  indexPath,
  `# Rules Index

## Namespaces

| Namespace | 状态 | 文件 | 触发条件 |
| --- | --- | --- | --- |
| \`CORE\` | active | \`retired.md\` | 每次任务必读 |
`,
);
await assertFails([getScript, "--root", root, "CORE-001"], /Invalid active rule file path/);

await writeFile(
  indexPath,
  `# Rules Index

## Namespaces

| Namespace | 状态 | 文件 | 触发条件 |
| --- | --- | --- | --- |
| \`CORE\` | active | \`domain/index.md\` | 每次任务必读 |
`,
);
await assertFails([getScript, "--root", root, "CORE-001"], /Invalid active rule file path/);

await writeFile(
  indexPath,
  `# Rules Index

## Namespaces

| Namespace | 状态 | 文件 | 触发条件 |
| --- | --- | --- | --- |
| \`CORE\` | active | \`always/constraints.md\` | 每次任务必读 |
`,
);

const constraintsPath = path.join(root, ".agents/rules/always/constraints.md");
await writeFile(
  constraintsPath,
  `# Constraints

### CORE-001 不越界修改

- 级别：MUST
- 生效条件：每次任务
- 规则：不得修改任务范围外的无关代码。
- 通过条件：
  - 实际修改仅包含当前任务范围内的内容。
- 证据要求：
  - 说明实际修改范围。
- 失败条件：
  - 未经授权修改无关文件。
- 无法验证条件：
  - 当前材料无法判断范围。
`,
);

const activeResult = await runNode([getScript, "--root", root, "CORE-001"]);
assert.match(activeResult.stdout, /### CORE-001 不越界修改/);
assert.match(activeResult.stdout, /- 通过条件：\n  - 实际修改仅包含当前任务范围内的内容。/);

await mkdir(path.join(root, ".agents/rules/concerns"), { recursive: true });
await writeFile(
  path.join(root, ".agents/rules/concerns/hidden.md"),
  `# Hidden

### HID-001 未登记规则

- 级别：MUST
- 生效条件：测试
- 规则：不应被读取。
- 通过条件：
  - 未登记规则不进入 active 规则读取结果。
- 证据要求：
  - 无
- 失败条件：
  - 无
- 无法验证条件：
  - 无
`,
);
await assertFails([getScript, "--root", root, "HID-001"], /Namespace is not registered/);

await writeFile(
  path.join(root, ".agents/rules/retired.md"),
  `# Retired Rules

### CORE-002 旧底线规则

- 替代：CORE-001
- 原因：合并到底线规则
`,
);
const retiredResult = await runNode([getScript, "--root", root, "CORE-002"]);
assert.match(retiredResult.stdout, /### CORE-002 DEPRECATED/);
assert.match(retiredResult.stdout, /- 原标题：旧底线规则/);

const multiIdFailure = await assertFails(
  [getScript, "--root", root, "CORE-001", "CORE-999"],
  /Rule not found: CORE-999/,
);
assert.equal(multiIdFailure.stdout, "");

await writeFile(
  path.join(root, ".agents/rules/retired.md"),
  `# Retired Rules

### CORE-001 不越界修改

- 替代：无
- 原因：测试冲突
`,
);
await assertFails([getScript, "--root", root, "CORE-001"], /both active and retired/);

const catalogRoot = await mkdtemp(path.join(os.tmpdir(), "rule-steward-catalog-"));
const catalogIndex = `# Rules Index

## Namespaces

| Namespace | 状态 | 文件 | 触发条件 |
| --- | --- | --- | --- |
| \`CORE\` | active | \`always/constraints.md\` | 每次任务必读 |
| \`TEST\` | active | \`concerns/testing.md\` | 修改测试时 |
| \`EMPTY\` | active | \`domain/empty.md\` | 修改空领域时 |
`;
const catalogCore = `# Constraints

### CORE-002 保持原子修改

- 级别：SHOULD
- 生效条件：修改多个文件时
- 规则：只修改任务范围内的文件。
- 通过条件：
  - 实际改动只包含任务范围内的文件。
- 证据要求：
  - 列出修改文件。
- 失败条件：
  - 修改无关文件。
- 无法验证条件：
  - 缺少 diff。

### CORE-001 先读约束

- 级别：MUST
- 生效条件：每次任务
- 规则：先读取项目约束。
- 通过条件：
  - 项目约束在执行任务前已读取。
- 证据要求：
  - 引用约束。
- 失败条件：
  - 未读取约束。
- 无法验证条件：
  - 约束不可读。
`;
const catalogTesting = `# Testing

### TEST-001 修改测试时运行定向测试

- 级别：ADVISORY
- 生效条件：修改测试代码时
- 规则：运行相关定向测试。
- 通过条件：
  - 相关定向测试已通过明确入口执行并记录结果。
- 证据要求：
  - 记录测试命令。
- 失败条件：
  - 未运行相关测试。
- 无法验证条件：
  - 测试环境不可用。
`;
await mkdir(path.join(catalogRoot, ".agents/rules/always"), { recursive: true });
await mkdir(path.join(catalogRoot, ".agents/rules/concerns"), { recursive: true });
await mkdir(path.join(catalogRoot, ".agents/rules/domain"), { recursive: true });
await writeFile(path.join(catalogRoot, ".agents/rules/index.md"), catalogIndex);
await writeFile(path.join(catalogRoot, ".agents/rules/always/constraints.md"), catalogCore);
await writeFile(path.join(catalogRoot, ".agents/rules/concerns/testing.md"), catalogTesting);
await writeFile(path.join(catalogRoot, ".agents/rules/domain/empty.md"), "");

const workspaceCatalogResult = await runNode([getScript, "--root", catalogRoot, "--catalog"]);
const workspaceCatalog = JSON.parse(workspaceCatalogResult.stdout);
assert.deepEqual(workspaceCatalog, {
  source: {
    kind: "workspace",
    indexHash: hash(catalogIndex),
    files: [
      {
        path: ".agents/rules/always/constraints.md",
        contentHash: hash(catalogCore),
      },
      {
        path: ".agents/rules/concerns/testing.md",
        contentHash: hash(catalogTesting),
      },
      {
        path: ".agents/rules/domain/empty.md",
        contentHash: hash(""),
      },
    ],
  },
  rules: [
    {
      ruleRef: "CORE-001",
      title: "先读约束",
      ruleLevel: "MUST",
      trigger: "每次任务必读",
      appliesTo: "每次任务",
      sourceFile: ".agents/rules/always/constraints.md",
    },
    {
      ruleRef: "CORE-002",
      title: "保持原子修改",
      ruleLevel: "SHOULD",
      trigger: "每次任务必读",
      appliesTo: "修改多个文件时",
      sourceFile: ".agents/rules/always/constraints.md",
    },
    {
      ruleRef: "TEST-001",
      title: "修改测试时运行定向测试",
      ruleLevel: "ADVISORY",
      trigger: "修改测试时",
      appliesTo: "修改测试代码时",
      sourceFile: ".agents/rules/concerns/testing.md",
    },
  ],
});
await assertFails(
  [getScript, "--root", catalogRoot, "--catalog", "CORE-001"],
  /--catalog cannot be combined with rule IDs/,
);

await runGit(catalogRoot, ["init", "-q"]);
await runGit(catalogRoot, ["config", "user.email", "test@example.com"]);
await runGit(catalogRoot, ["config", "user.name", "Test User"]);
await runGit(catalogRoot, ["add", ".agents/rules"]);
await runGit(catalogRoot, ["commit", "-qm", "rules"]);
const { stdout: commitStdout } = await runGit(catalogRoot, ["rev-parse", "HEAD"]);
const commit = commitStdout.trim();
const { stdout: treeStdout } = await runGit(catalogRoot, ["rev-parse", "HEAD^{tree}"]);
const tree = treeStdout.trim();
const { stdout: blobStdout } = await runGit(catalogRoot, ["rev-parse", "HEAD:.agents/rules/index.md"]);
const blob = blobStdout.trim();

await writeFile(
  path.join(catalogRoot, ".agents/rules/always/constraints.md"),
  catalogCore.replace("先读约束", "脏工作区规则"),
);
const commitCatalog = JSON.parse((await runNode([
  getScript,
  "--root",
  catalogRoot,
  "--catalog",
  "--commit",
  commit,
])).stdout);
assert.equal(commitCatalog.source.kind, "commit");
assert.equal(commitCatalog.source.commit, commit);
assert.equal(commitCatalog.rules[0].title, "先读约束");
assert.match((await runNode([
  getScript,
  "--root",
  catalogRoot,
  "--commit",
  commit,
  "CORE-001",
])).stdout, /### CORE-001 先读约束/);

for (const invalidCommit of [commit.slice(0, 12), tree, blob]) {
  const failure = await assertFails(
    [getScript, "--root", catalogRoot, "--catalog", "--commit", invalidCommit],
    /full normalized commit OID|must resolve to the same commit OID/,
  );
  assert.equal(failure.stdout, "");
}

await rm(path.join(catalogRoot, ".agents/rules"), { recursive: true });
await assertFails(
  [getScript, "--root", catalogRoot, "--catalog", "--optional-source"],
  /Missing rules index/,
);

const invalidCatalogCases = [
  {
    name: "missing-field",
    index: catalogIndex,
    core: catalogCore.replace("- 生效条件：每次任务\n", ""),
    pattern: /Missing 生效条件 field/,
  },
  {
    name: "invalid-level",
    index: catalogIndex,
    core: catalogCore.replace("- 级别：MUST", "- 级别：REQUIRED"),
    pattern: /Invalid rule level/,
  },
  {
    name: "missing-pass-conditions",
    index: catalogIndex,
    core: catalogCore.replace(
      "- 通过条件：\n  - 项目约束在执行任务前已读取。\n",
      "",
    ),
    pattern: /Missing 通过条件 field/,
  },
  {
    name: "empty-pass-conditions",
    index: catalogIndex,
    core: catalogCore.replace(
      "- 通过条件：\n  - 项目约束在执行任务前已读取。\n",
      "- 通过条件：\n",
    ),
    pattern: /Missing 通过条件 items/,
  },
  {
    name: "misindented-pass-conditions",
    index: catalogIndex,
    core: catalogCore.replace(
      "  - 项目约束在执行任务前已读取。",
      "    - 项目约束在执行任务前已读取。",
    ),
    pattern: /Missing 通过条件 items/,
  },
  {
    name: "namespace-mismatch",
    index: catalogIndex,
    core: catalogCore.replace("CORE-001", "TEST-002"),
    pattern: /does not match namespace CORE/,
  },
];

for (const invalid of invalidCatalogCases) {
  const invalidRoot = await mkdtemp(path.join(os.tmpdir(), `rule-steward-${invalid.name}-`));
  await mkdir(path.join(invalidRoot, ".agents/rules/always"), { recursive: true });
  await mkdir(path.join(invalidRoot, ".agents/rules/concerns"), { recursive: true });
  await mkdir(path.join(invalidRoot, ".agents/rules/domain"), { recursive: true });
  await writeFile(path.join(invalidRoot, ".agents/rules/index.md"), invalid.index);
  await writeFile(path.join(invalidRoot, ".agents/rules/always/constraints.md"), invalid.core);
  await writeFile(path.join(invalidRoot, ".agents/rules/concerns/testing.md"), catalogTesting);
  await writeFile(path.join(invalidRoot, ".agents/rules/domain/empty.md"), "");
  const failure = await assertFails(
    [getScript, "--root", invalidRoot, "--catalog"],
    invalid.pattern,
  );
  assert.equal(failure.stdout, "");
}

const conflictRoot = await mkdtemp(path.join(os.tmpdir(), "rule-steward-catalog-conflict-"));
await mkdir(path.join(conflictRoot, ".agents/rules/always"), { recursive: true });
await mkdir(path.join(conflictRoot, ".agents/rules/concerns"), { recursive: true });
await mkdir(path.join(conflictRoot, ".agents/rules/domain"), { recursive: true });
await writeFile(path.join(conflictRoot, ".agents/rules/index.md"), catalogIndex);
await writeFile(path.join(conflictRoot, ".agents/rules/always/constraints.md"), catalogCore);
await writeFile(path.join(conflictRoot, ".agents/rules/concerns/testing.md"), catalogTesting);
await writeFile(path.join(conflictRoot, ".agents/rules/domain/empty.md"), "");
await writeFile(
  path.join(conflictRoot, ".agents/rules/retired.md"),
  `### CORE-001 先读约束

- 替代：无
- 原因：测试冲突
`,
);
const conflictFailure = await assertFails(
  [getScript, "--root", conflictRoot, "--catalog"],
  /both active and retired/,
);
assert.equal(conflictFailure.stdout, "");

console.log("rule-steward tests passed");
