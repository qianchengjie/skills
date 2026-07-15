import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const validator = path.join(repoRoot, "scripts/validate-skill-invocation.mjs");
const root = await mkdtemp(path.join(os.tmpdir(), "skill-invocation-"));

async function createSkill(name, frontmatter = "", openaiYaml = null) {
  const skill = path.join(root, name);
  await mkdir(skill, { recursive: true });
  await writeFile(
    path.join(skill, "SKILL.md"),
    `---\nname: ${name}\ndescription: test skill\n${frontmatter}---\n\n# Test\n`,
  );
  if (openaiYaml !== null) {
    await mkdir(path.join(skill, "agents"));
    await writeFile(path.join(skill, "agents/openai.yaml"), openaiYaml);
  }
  return skill;
}

async function validate(skill) {
  return execFileAsync(process.execPath, [validator, skill]);
}

async function assertFails(skill, pattern) {
  try {
    await validate(skill);
  } catch (error) {
    assert.match(`${error.stderr}${error.stdout}`, pattern);
    return;
  }
  assert.fail(`Expected validation to fail: ${skill}`);
}

await validate(await createSkill("implicit"));
await validate(
  await createSkill(
    "manual",
    "disable-model-invocation: true\n",
    "policy:\n  allow_implicit_invocation: false\n",
  ),
);
await assertFails(
  await createSkill("claude-only", "disable-model-invocation: true\n"),
  /manual invocation must set both/,
);
await assertFails(
  await createSkill("codex-only", "", "policy:\n  allow_implicit_invocation: false\n"),
  /manual invocation must set both/,
);
await assertFails(
  await createSkill("invalid", "disable-model-invocation: yes\n"),
  /must be true or false/,
);

console.log("skill invocation metadata tests passed");
