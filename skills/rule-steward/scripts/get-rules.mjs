#!/usr/bin/env node

import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, realpathSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ID_RE = /^[A-Z][A-Z0-9]*-[0-9]{3}$/;
const NS_RE = /^[A-Z][A-Z0-9]*$/;
const GIT_OID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const RULE_HEADING_RE = /^###\s+([A-Z][A-Z0-9]*-[0-9]{3})\s+(.+?)\s*$/;
const RULE_LEVELS = new Set(["MUST", "SHOULD", "ADVISORY"]);
const INDEX_PATH = ".agents/rules/index.md";
const RETIRED_PATH = ".agents/rules/retired.md";
const USAGE = [
  "Usage:",
  "  Catalog (workspace):",
  "    get-rules.mjs [--root <path>] --catalog",
  "    get-rules.mjs [--root <path>] --catalog --optional-source",
  "  Catalog (commit):",
  "    get-rules.mjs [--root <path>] --catalog --commit <FULL-OID>",
  "  Rule ID (workspace):",
  "    get-rules.mjs [--root <path>] <RULE-ID>...",
  "  Rule ID (commit):",
  "    get-rules.mjs [--root <path>] --commit <FULL-OID> <RULE-ID>...",
].join("\n");

function fail(message) {
  console.error(message);
  process.exit(1);
}

function writeStdout(output) {
  return new Promise((resolve, reject) => {
    process.stdout.write(output, (error) => error ? reject(error) : resolve());
  });
}

function parseArgs(argv) {
  let root = process.cwd();
  let commit = null;
  let catalog = false;
  let optionalSource = false;
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
    if (arg === "--commit") {
      if (commit !== null) fail("Duplicate option: --commit");
      const value = argv[i + 1];
      if (!value) fail("Missing value for --commit");
      commit = value;
      i += 1;
      continue;
    }
    if (arg === "--catalog") {
      if (catalog) fail("Duplicate option: --catalog");
      catalog = true;
      continue;
    }
    if (arg === "--optional-source") {
      if (optionalSource) fail("Duplicate option: --optional-source");
      optionalSource = true;
      continue;
    }
    if (arg.startsWith("--")) fail(`Unknown option: ${arg}`);
    ids.push(arg);
  }

  if (catalog && ids.length > 0) fail("--catalog cannot be combined with rule IDs");
  if (optionalSource && !catalog) fail("--optional-source requires --catalog");
  if (optionalSource && commit !== null) fail("--optional-source only supports workspace catalogs");
  if (!catalog && ids.length === 0) fail(USAGE);

  return { root, commit, catalog, optionalSource, ids };
}

function git(root, args, options = {}) {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, GIT_NO_LAZY_FETCH: "1" },
    ...options,
  });
}

function resolveCommit(root, commit) {
  if (!GIT_OID_RE.test(commit)) fail("Commit must use a full normalized commit OID");
  let resolved;
  try {
    resolved = git(root, ["rev-parse", "--verify", `${commit}^{commit}`]).trim();
  } catch {
    fail("Commit must resolve to the same commit OID");
  }
  if (resolved !== commit) fail("Commit must resolve to the same commit OID");
  return resolved;
}

function createReader(root, requestedCommit) {
  if (requestedCommit === null) {
    return {
      source: { kind: "workspace" },
      root,
      exists(repoPath) {
        return existsSync(path.join(root, ...repoPath.split("/")));
      },
      async read(repoPath) {
        return readFile(path.join(root, ...repoPath.split("/")), "utf8");
      },
    };
  }

  let repositoryRoot;
  try {
    repositoryRoot = realpathSync(git(root, ["rev-parse", "--show-toplevel"]).trim());
  } catch {
    fail(`Not a Git repository: ${root}`);
  }
  const commit = resolveCommit(repositoryRoot, requestedCommit);
  return {
    source: { kind: "commit", commit },
    root: repositoryRoot,
    exists(repoPath) {
      try {
        git(repositoryRoot, ["cat-file", "-e", `${commit}:${repoPath}`], { stdio: ["ignore", "ignore", "ignore"] });
        return true;
      } catch {
        return false;
      }
    },
    async read(repoPath) {
      try {
        return git(repositoryRoot, ["show", `${commit}:${repoPath}`]);
      } catch {
        throw new Error(`Missing file at commit ${commit}: ${repoPath}`);
      }
    },
  };
}

function isWorkspaceRuleSourceAbsent(root) {
  if (!existsSync(root) || !statSync(root).isDirectory()) fail(`Invalid repository root: ${root}`);
  if (existsSync(path.join(root, ".agents/rules"))) return false;
  try {
    git(root, ["rev-parse", "--is-inside-work-tree"]);
  } catch {
    if (existsSync(path.join(root, ".git"))) fail(`Cannot inspect Git repository: ${root}`);
    return true;
  }
  try {
    if (git(root, ["ls-files", "--", ".agents/rules"]).trim()) return false;
  } catch {
    fail(`Cannot inspect Git index: ${root}`);
  }
  try {
    return !git(root, ["ls-tree", "-r", "--name-only", "HEAD", "--", ".agents/rules"]).trim();
  } catch {
    try {
      git(root, ["status", "--porcelain"]);
      return true;
    } catch {
      fail(`Cannot inspect Git HEAD: ${root}`);
    }
  }
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
  if (file.split("/").includes("..")) fail(`Invalid rule file path: ${file}`);
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

function ruleRepoPath(file) {
  return `.agents/rules/${file}`;
}

async function parseIndex(reader) {
  if (!reader.exists(INDEX_PATH)) {
    fail(`Missing rules index: ${path.join(reader.root, ".agents/rules/index.md")}`);
  }
  const content = await reader.read(INDEX_PATH);
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
  const activeFiles = new Set();
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
    if (!trigger) fail(`Missing namespace trigger for ${namespace}`);
    if (namespaces.has(namespace)) fail(`Duplicate namespace: ${namespace}`);

    const repoPath = ruleRepoPath(file);
    if (status === "active") {
      if (activeFiles.has(repoPath)) fail(`Active rule file is registered more than once: ${repoPath}`);
      if (!reader.exists(repoPath)) fail(`Missing active rule file for ${namespace}: ${repoPath}`);
      activeFiles.add(repoPath);
    }
    namespaces.set(namespace, { status, file, trigger, repoPath });
  }

  const core = namespaces.get("CORE");
  if (!core) fail("Missing required CORE namespace");
  if (core.status !== "active") fail("CORE namespace must be active");
  if (core.file !== "always/constraints.md") fail("CORE namespace must use always/constraints.md");
  return { content, namespaces };
}

function splitRuleId(id) {
  if (!ID_RE.test(id)) fail(`Invalid rule ID: ${id}`);
  return id.slice(0, id.indexOf("-"));
}

function parseField(markdown, fieldName) {
  const escaped = fieldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = markdown.match(new RegExp(`^- ${escaped}：(.+)$`, "m"));
  return match?.[1]?.trim() ?? null;
}

function parseList(markdown, fieldName, id) {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `- ${fieldName}：`);
  if (start === -1) fail(`Missing ${fieldName} field for active rule: ${id}`);
  const items = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const match = lines[i].match(/^\s{2}-\s+(.+?)\s*$/);
    if (match) {
      items.push(match[1]);
      continue;
    }
    if (/^-\s/.test(lines[i]) || RULE_HEADING_RE.test(lines[i])) break;
  }
  if (items.length === 0) fail(`Missing ${fieldName} items for active rule: ${id}`);
}

function parseActiveRuleFile(content, registration) {
  const lines = content.split(/\r?\n/);
  const headingIndexes = [];
  lines.forEach((line, index) => {
    const match = line.match(RULE_HEADING_RE);
    if (match) headingIndexes.push({ index, match });
  });

  const rules = [];
  headingIndexes.forEach(({ index, match }, headingIndex) => {
    const id = match[1];
    if (splitRuleId(id) !== registration.namespace) {
      fail(`Active rule ${id} does not match namespace ${registration.namespace}`);
    }
    const end = headingIndexes[headingIndex + 1]?.index ?? lines.length;
    const markdown = lines.slice(index, end).join("\n").trimEnd();
    const ruleLevel = parseField(markdown, "级别");
    const appliesTo = parseField(markdown, "生效条件");
    const ruleText = parseField(markdown, "规则");
    if (!ruleLevel) fail(`Missing 级别 field for active rule: ${id}`);
    if (!RULE_LEVELS.has(ruleLevel)) fail(`Invalid rule level for ${id}: ${ruleLevel}`);
    if (!appliesTo) fail(`Missing 生效条件 field for active rule: ${id}`);
    if (!ruleText) fail(`Missing 规则 field for active rule: ${id}`);
    parseList(markdown, "通过条件", id);
    parseList(markdown, "证据要求", id);
    parseList(markdown, "失败条件", id);
    parseList(markdown, "无法验证条件", id);
    rules.push({
      id,
      title: match[2].trim(),
      ruleLevel,
      appliesTo,
      markdown,
      sourceFile: registration.repoPath,
      trigger: registration.trigger,
    });
  });
  return rules;
}

async function parseActiveRules(reader, namespaces) {
  const active = new Map();
  const files = [];
  for (const [namespace, registration] of namespaces) {
    if (registration.status !== "active") continue;
    const content = await reader.read(registration.repoPath);
    files.push({ path: registration.repoPath, content });
    for (const rule of parseActiveRuleFile(content, { ...registration, namespace })) {
      if (active.has(rule.id)) fail(`Duplicate active rule ID: ${rule.id}`);
      active.set(rule.id, rule);
    }
  }
  return { active, files };
}

function normalizeReplacement(value) {
  if (!value || value === "无") return [];
  return value
    .split(/[,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

async function parseRetiredRules(reader, namespaces) {
  const retired = new Map();
  if (!reader.exists(RETIRED_PATH)) return retired;
  const content = await reader.read(RETIRED_PATH);
  const lines = content.split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(RULE_HEADING_RE);
    if (!match) continue;
    const id = match[1];
    const namespace = splitRuleId(id);
    if (!namespaces.has(namespace)) fail(`Retired rule namespace is not registered: ${id}`);
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
    retired.set(id, { id, title: match[2].trim(), replacements, reason });
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

function contentHash(content) {
  return `sha256:${crypto.createHash("sha256").update(content).digest("hex")}`;
}

const argv = process.argv.slice(2);
if (argv.length === 1 && argv[0] === "--help") {
  await writeStdout(`${USAGE}\n`);
  process.exit(0);
}

const { root, commit, catalog, optionalSource, ids } = parseArgs(argv);
const duplicate = ids.find((id, index) => ids.indexOf(id) !== index);
if (duplicate) fail(`Duplicate requested rule ID: ${duplicate}`);

if (optionalSource && isWorkspaceRuleSourceAbsent(root)) {
  await writeStdout(`${JSON.stringify({ source: { kind: "absent" }, rules: [] }, null, 2)}\n`);
  process.exit(0);
}

const reader = createReader(root, commit);
const { content: indexContent, namespaces } = await parseIndex(reader);
const { active, files } = await parseActiveRules(reader, namespaces);
const retired = await parseRetiredRules(reader, namespaces);
for (const id of active.keys()) {
  if (retired.has(id)) fail(`Rule ID is both active and retired: ${id}`);
}

if (catalog) {
  const output = {
    source: {
      ...reader.source,
      indexHash: contentHash(indexContent),
      files: files
        .map(({ path: filePath, content }) => ({ path: filePath, contentHash: contentHash(content) }))
        .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0),
    },
    rules: [...active.values()]
      .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
      .map((rule) => ({
        ruleRef: rule.id,
        title: rule.title,
        ruleLevel: rule.ruleLevel,
        trigger: rule.trigger,
        appliesTo: rule.appliesTo,
        sourceFile: rule.sourceFile,
      })),
  };
  await writeStdout(`${JSON.stringify(output, null, 2)}\n`);
  process.exit(0);
}

const outputs = [];
for (const id of ids) {
  const namespace = splitRuleId(id);
  if (!namespaces.has(namespace)) fail(`Namespace is not registered for rule ID: ${id}`);
  if (active.has(id)) {
    outputs.push(active.get(id).markdown);
  } else if (retired.has(id)) {
    outputs.push(formatRetired(retired.get(id)));
  } else {
    fail(`Rule not found: ${id}`);
  }
}
process.stdout.write(`${outputs.join("\n\n")}\n`);
