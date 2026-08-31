import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const lightweightDir = path.join(repoRoot, "skills/rules-review");
const deepDir = path.join(repoRoot, "skills/deep-rules-review");

test("轻量与深度 Rule review 的 package 边界分离", () => {
  const lightweightSkill = fs.readFileSync(path.join(lightweightDir, "SKILL.md"), "utf8");
  const deepSkill = fs.readFileSync(path.join(deepDir, "SKILL.md"), "utf8");

  assert.match(lightweightSkill, /^name: rules-review$/m);
  assert.match(deepSkill, /^name: deep-rules-review$/m);
  assert.equal(fs.existsSync(path.join(lightweightDir, "scripts")), false);
  assert.equal(fs.existsSync(path.join(lightweightDir, "schemas")), false);
  assert.equal(fs.existsSync(path.join(lightweightDir, "references")), false);
  assert.equal(fs.existsSync(path.join(deepDir, "scripts/validate.js")), true);
  assert.equal(fs.existsSync(path.join(deepDir, "schemas/dispatch.schema.json")), true);
});
