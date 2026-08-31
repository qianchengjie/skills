import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const skillDir = path.join(repoRoot, "skills/rules-review");
const operationalEvalPath = path.join(
  repoRoot,
  "evals/rules-review/operational-model-stays-semantic/eval.md",
);

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

test("轻量 rules-review 保留最小语义合同", () => {
  const skill = fs.readFileSync(path.join(skillDir, "SKILL.md"), "utf8");

  assert.match(
    skill,
    /^description: 当需要依据项目 active Rules 审查 caller 指定代码范围内的 Rule applicability 与 violation 时使用。$/m,
  );
  assert.match(
    skill,
    /# Rules Review\n\n`rules-review` 只读判断 caller 指定范围内的代码是否违反适用 Rule。\n\n## 判断边界/,
  );

  for (const contract of [
    "--root <repository> --catalog --optional-source",
    "--root <repository> --catalog --commit <FULL-OID>",
    "Catalog 与后续 Rule 正文必须来自同一 source。",
    "只有 reader 成功返回 catalog，才以其 `rules` 作为完整 active catalog。",
    "`source.kind = absent` 仅表示项目不存在 Rule source；目录缺失本身不能证明 absent。",
    "合法 workspace 或 commit source 也允许返回 `rules: []`。",
    "reader 失败形成 discovery `cannot_verify`。",
  ]) {
    assert.ok(skill.includes(contract), `缺少文本合同：${contract}`);
  }

  assert.match(
    skill,
    /每项 `cannot_verify` 只写：\n\n1\. 未决环节及对象：`scope`、`discovery`、`<RULE-ID> applicability` 或 `<RULE-ID> compliance`；\n2\. 缺失或冲突的决定性事实，以及它阻止的结论。/,
  );
});

test("operational model eval 使用 Harness 挂载路径", () => {
  const evaluation = fs.readFileSync(operationalEvalPath, "utf8");

  assert.match(evaluation, /完整读取 \/opt\/rules-review\/SKILL\.md。/);
  assert.match(evaluation, /Harness 将 subject package 挂载为 `\/opt\/rules-review`。/);
  assert.doesNotMatch(evaluation, /\/Users\//);
});
