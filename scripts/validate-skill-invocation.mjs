#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

function fail(message) {
  throw new Error(message);
}

function readFrontmatter(content, source) {
  const lines = content.split(/\r?\n/);
  if (lines[0] !== "---") fail(`${source}: missing YAML frontmatter start`);

  const end = lines.indexOf("---", 1);
  if (end === -1) fail(`${source}: missing YAML frontmatter end`);
  return lines.slice(1, end);
}

function readClaudePolicy(lines, source) {
  const entries = lines.filter((line) => line.startsWith("disable-model-invocation:"));
  if (entries.length > 1) fail(`${source}: duplicate disable-model-invocation`);
  if (entries.length === 0) return false;

  const match = entries[0].match(/^disable-model-invocation: (true|false)$/);
  if (!match) fail(`${source}: disable-model-invocation must be true or false`);
  return match[1] === "true";
}

function readCodexPolicy(content, source) {
  if (content === null) return false;

  const lines = content.split(/\r?\n/);
  const policyIndexes = lines
    .map((line, index) => (line === "policy:" ? index : -1))
    .filter((index) => index !== -1);
  if (policyIndexes.length > 1) fail(`${source}: duplicate policy section`);

  const entries = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.trimStart().startsWith("allow_implicit_invocation:"));
  if (entries.length > 1) fail(`${source}: duplicate allow_implicit_invocation`);
  if (entries.length === 0) return false;

  const [{ line, index }] = entries;
  const policyIndex = policyIndexes[0];
  const nextTopLevel = lines.findIndex(
    (candidate, candidateIndex) => candidateIndex > policyIndex && /^\S/.test(candidate),
  );
  const insidePolicy =
    policyIndex !== undefined &&
    index > policyIndex &&
    (nextTopLevel === -1 || index < nextTopLevel);
  const match = line.match(/^  allow_implicit_invocation: (true|false)$/);
  if (!insidePolicy || !match) {
    fail(`${source}: policy.allow_implicit_invocation must be true or false`);
  }
  return match[1] === "false";
}

async function readOptional(file) {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

const skill = process.argv[2];
if (!skill || process.argv.length !== 3) {
  console.error("Usage: validate-skill-invocation.mjs <skill-directory>");
  process.exit(2);
}

try {
  const skillFile = path.join(skill, "SKILL.md");
  const openaiFile = path.join(skill, "agents/openai.yaml");
  const claudeManual = readClaudePolicy(
    readFrontmatter(await readFile(skillFile, "utf8"), skillFile),
    skillFile,
  );
  const codexManual = readCodexPolicy(await readOptional(openaiFile), openaiFile);

  if (claudeManual !== codexManual) {
    fail(
      `${skill}: manual invocation must set both disable-model-invocation: true and policy.allow_implicit_invocation: false`,
    );
  }

  console.log(`${skill}: invocation policy ok`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
