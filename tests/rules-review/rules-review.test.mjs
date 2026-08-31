import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const skillDir = path.join(repoRoot, "skills/rules-review");

function listFiles(directory, prefix = "") {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = path.join(prefix, entry.name);
    return entry.isDirectory()
      ? listFiles(path.join(directory, entry.name), relativePath)
      : [relativePath];
  });
}

test("轻量 rules-review package 只承载自身运行入口", () => {
  assert.deepEqual(listFiles(skillDir).sort(), ["SKILL.md", "agents/openai.yaml"]);
  const skill = fs.readFileSync(path.join(skillDir, "SKILL.md"), "utf8");
  assert.match(skill, /^name: rules-review$/m);
});
