#!/usr/bin/env node

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ID_RE = /^[A-Z][A-Z0-9]*-[0-9]{3}$/;
const NS_RE = /^[A-Z][A-Z0-9]*$/;
const RULE_HEADING_RE = /^###\s+([A-Z][A-Z0-9]*-[0-9]{3})\s+(.+?)\s*$/;

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseArgs(argv) {
  let root = process.cwd();
  const ids = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--root") {
      const value = argv[i + 1];
      if (!value) fail("Missing value for --root");
      root = path.resolve(value);
      i += 1;
      continue;
    }
    if (arg.startsWith("--")) fail(`Unknown option: ${arg}`);
    ids.push(arg);
  }

  if (ids.length === 0) fail("Usage: get-rules.mjs [--root <path>] <RULE-ID>...");

  return { root, ids };
}

function stripTicks(value) {
  const trimmed = value.trim();
  return trimmed.startsWith("`") && trimmed.endsWith("`")
    ? trimmed.slice(1, -1)
    : trimmed;
}

function assertSafeRulePath(file) {
  if (path.isAbsolute(file) || file.startsWith("./") || file.includes("\\")) {
    fail(`Invalid rule file path: ${file}`);
  }
  if (file.split(/[\\/]+/).includes("..")) {
    fail(`Invalid rule file path: ${file}`);
  }
}

function assertActiveRulePath(file) {
  if (file === "always/constraints.md") return;
  if (/^(concerns|domain)\/(?!README\.md$|retired\.md$|index\.md$)[^/]+\.md$/.test(file)) {
    return;
  }
  fail(`Invalid active rule file path: ${file}`);
}

function parseMarkdownTableRow(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return null;
  return trimmed
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim());
}

function isSeparatorRow(cells) {
  return cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

async function parseIndex(rulesRoot) {
  const indexPath = path.join(rulesRoot, "index.md");
  if (!existsSync(indexPath)) fail(`Missing rules index: ${indexPath}`);

  const content = await readFile(indexPath, "utf8");
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === "## Namespaces");
  if (start === -1) fail("Missing ## Namespaces table in .agents/rules/index.md");

  const tableLines = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) {
      if (tableLines.length === 0) continue;
      break;
    }
    if (!line.trim().startsWith("|")) {
      if (tableLines.length === 0) continue;
      break;
    }
    tableLines.push(line);
  }

  if (tableLines.length < 2) fail("Invalid Namespaces table");

  const header = parseMarkdownTableRow(tableLines[0]);
  if (!header || header.join("|") !== "Namespace|状态|文件|触发条件") {
    fail("Namespaces table header must be: | Namespace | 状态 | 文件 | 触发条件 |");
  }

  const separator = parseMarkdownTableRow(tableLines[1]);
  if (!separator || !isSeparatorRow(separator)) fail("Invalid Namespaces table separator");

  const namespaces = new Map();
  for (const line of tableLines.slice(2)) {
    const row = parseMarkdownTableRow(line);
    if (!row || row.length !== 4) fail(`Invalid namespace row: ${line}`);

    const namespace = stripTicks(row[0]);
    const status = row[1].trim();
    const file = stripTicks(row[2]);
    const trigger = row[3].trim();

    if (!NS_RE.test(namespace)) fail(`Invalid namespace: ${namespace}`);
    if (status !== "active" && status !== "retired") {
      fail(`Invalid namespace status for ${namespace}: ${status}`);
    }
    assertSafeRulePath(file);
    if (status === "active") assertActiveRulePath(file);
    if (namespaces.has(namespace)) fail(`Duplicate namespace: ${namespace}`);

    const absoluteFile = path.join(rulesRoot, file);
    if (status === "active" && !existsSync(absoluteFile)) {
      fail(`Missing active rule file for ${namespace}: ${absoluteFile}`);
    }

    namespaces.set(namespace, { status, file, trigger, absoluteFile });
  }

  return namespaces;
}

function splitRuleId(id) {
  if (!ID_RE.test(id)) fail(`Invalid rule ID: ${id}`);
  return id.slice(0, id.indexOf("-"));
}

async function findRuleInFile(filePath, id) {
  const content = await readFile(filePath, "utf8");
  const lines = content.split(/\r?\n/);
  const matches = [];

  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(RULE_HEADING_RE);
    if (match?.[1] === id) matches.push(i);
  }

  if (matches.length > 1) fail(`Duplicate rule ID ${id} in ${filePath}`);
  if (matches.length === 0) return null;

  const start = matches[0];
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (RULE_HEADING_RE.test(lines[i])) {
      end = i;
      break;
    }
  }

  return {
    title: lines[start].replace(/^###\s+[A-Z][A-Z0-9]*-[0-9]{3}\s+/, "").trim(),
    markdown: lines.slice(start, end).join("\n").trimEnd(),
  };
}

function parseField(markdown, fieldName) {
  const escaped = fieldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = markdown.match(new RegExp(`^- ${escaped}：(.+)$`, "m"));
  return match?.[1]?.trim() ?? null;
}

function normalizeReplacement(value) {
  if (!value || value === "无") return [];
  return value
    .split(/[,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

async function parseRetiredRules(rulesRoot, namespaces) {
  const retiredPath = path.join(rulesRoot, "retired.md");
  const retired = new Map();
  if (!existsSync(retiredPath)) return retired;

  const content = await readFile(retiredPath, "utf8");
  const lines = content.split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(RULE_HEADING_RE);
    if (!match) continue;

    const id = match[1];
    const namespace = splitRuleId(id);
    if (!namespaces.has(namespace)) {
      fail(`Retired rule namespace is not registered: ${id}`);
    }
    if (retired.has(id)) fail(`Duplicate retired rule ID: ${id}`);

    let end = lines.length;
    for (let j = i + 1; j < lines.length; j += 1) {
      if (RULE_HEADING_RE.test(lines[j])) {
        end = j;
        break;
      }
    }

    const markdown = lines.slice(i, end).join("\n").trimEnd();
    const replacementText = parseField(markdown, "替代");
    const reason = parseField(markdown, "原因");
    if (!replacementText) fail(`Missing 替代 field for retired rule: ${id}`);
    if (!reason) fail(`Missing 原因 field for retired rule: ${id}`);

    const replacements = normalizeReplacement(replacementText);
    for (const replacement of replacements) {
      if (!ID_RE.test(replacement)) fail(`Invalid replacement ID for ${id}: ${replacement}`);
    }

    retired.set(id, {
      id,
      title: match[2].trim(),
      replacements,
      reason,
    });
  }

  return retired;
}

function formatRetired(rule) {
  const replacementText = rule.replacements.length > 0 ? rule.replacements.join(", ") : "无";
  return [
    `### ${rule.id} DEPRECATED`,
    "",
    `- 原标题：${rule.title}`,
    `- 替代：${replacementText}`,
    `- 原因：${rule.reason}`,
  ].join("\n");
}

const { root, ids } = parseArgs(process.argv.slice(2));
const duplicate = ids.find((id, index) => ids.indexOf(id) !== index);
if (duplicate) fail(`Duplicate requested rule ID: ${duplicate}`);

const rulesRoot = path.join(root, ".agents", "rules");
const namespaces = await parseIndex(rulesRoot);
const retired = await parseRetiredRules(rulesRoot, namespaces);
const outputs = [];

for (const id of ids) {
  const namespace = splitRuleId(id);
  const registration = namespaces.get(namespace);
  if (!registration) fail(`Namespace is not registered for rule ID: ${id}`);

  const retiredRule = retired.get(id);
  const activeRule =
    registration.status === "active"
      ? await findRuleInFile(registration.absoluteFile, id)
      : null;

  if (activeRule && retiredRule) fail(`Rule ID is both active and retired: ${id}`);
  if (activeRule) {
    outputs.push(activeRule.markdown);
    continue;
  }
  if (retiredRule) {
    outputs.push(formatRetired(retiredRule));
    continue;
  }

  fail(`Rule not found: ${id}`);
}

console.log(outputs.join("\n\n"));
