import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
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

const initResult = await runNode([initScript, "--root", root]);
assert.match(initResult.stdout, /Initialized rule store/);
assert.match(initResult.stdout, /建议加入 AGENTS\.md 的入口片段/);
assert.match(initResult.stdout, /涉及规则判断时，引用相关规则 ID/);
assert.doesNotMatch(initResult.stdout, /如果未读取项目规则/);
assert.match(initResult.stdout, /本脚本不会自动修改 AGENTS\.md/);

const indexPath = path.join(root, ".agents/rules/index.md");
assert.match(await readFile(indexPath, "utf8"), /\| `CORE` \| active \| `always\/constraints\.md` \|/);

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

await mkdir(path.join(root, ".agents/rules/concerns"), { recursive: true });
await writeFile(
  path.join(root, ".agents/rules/concerns/hidden.md"),
  `# Hidden

### HID-001 未登记规则

- 级别：MUST
- 生效条件：测试
- 规则：不应被读取。
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

console.log("rule-steward tests passed");
