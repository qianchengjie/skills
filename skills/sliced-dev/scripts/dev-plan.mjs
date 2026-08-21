#!/usr/bin/env node

import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DELIVER_SCRIPT = fileURLToPath(
  new URL('../../deliver-task/scripts/deliver-task.mjs', import.meta.url),
);

const PLAN_STATUSES = new Set(['draft', 'executing', 'paused', 'done']);
const PHASES = new Set(['slicing', 'executing', 'blocked', 'closing', 'done']);
const PREFLIGHT_STATUSES = new Set(['pending', 'passed', 'blocked']);
const PLAN_GATES = new Set(['pending-grill', 'grilling', 'grilled', 'no-grill']);
const SLICE_GATES = new Set([...PLAN_GATES, 'not-applicable']);
const CLOSED_PLAN_GATES = new Set(['grilled', 'no-grill']);
const CLOSED_SLICE_GATES = new Set(['grilled', 'no-grill', 'not-applicable']);
const SLICE_STATUSES = new Set([
  'not-started',
  'blocked',
  'in-progress',
  'done',
  'split',
  'skipped',
]);
const TERMINAL_SLICE_STATUSES = new Set(['done', 'split', 'skipped']);
const DEPENDENCY_COMPLETE_STATUSES = new Set(['done', 'skipped']);
const SLICE_CANDIDATES = new Set(['候选自动', '候选需确认']);
const RISK_LEVELS = new Set(['待判定', 'A', 'B', 'C']);
const EXECUTION_MODES = new Set(['待判定', '自动', '需确认']);
const ACCEPTANCE_POLICIES = new Set(['required', 'not-required']);
const DECISION_STATUSES = new Set(['open', 'decided']);
const AUDIT_STATUSES = new Set(['pending', 'active', 'done']);
const WHOLE_REVIEW_STATUSES = new Set(['package-generated', 'passed', 'blocked']);
const WHOLE_REVIEW_VERDICTS = [
  '全局约束符合性',
  '跨切片交接一致性',
  '非目标 / 边界回归',
  '需求闭合性',
  '残余风险 / 发布就绪度',
];

const PLAN_DIR_RE = /^\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SLICE_ID_RE = /^S\d+(?:\.\d+)*$/;
const DECISION_ID_RE = /^D\d+(?:\.\d+)*$/;
const AUDIT_ID_RE = /^A\d+$/;
const GIT_OID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const SHA256_RE = /^sha256:[0-9a-f]{64}$/;
const PLACEHOLDER_RE = /^(?:待定|待补充|待执行前补充|todo|tbd|暂无)[。.]?$/i;
const EXPLICIT_NONE_RE = /^(?:无|none|n\/a|na|暂无)[。.]?$/i;

const PLAN_SECTIONS = new Set([
  '当前状态',
  '文件索引',
  '目标',
  '全局约束',
  '切片',
  '整任务审查结论',
]);
const REQUIRED_PLAN_SECTIONS = ['当前状态', '文件索引', '目标', '全局约束', '切片'];
const SLICE_SECTIONS = new Set(['关联项', '委托合同', '切片交接', '任务内容', '验收']);
const REQUIRED_SLICE_SECTIONS = ['关联项', '委托合同', '切片交接', '任务内容', '验收'];
const SLICE_HEADER_FIELDS = new Set([
  '状态',
  '门禁',
  '候选',
  '风险',
  '执行',
  '依赖',
  '替代切片',
  '跳过依据',
]);
const REQUIRED_SLICE_HEADER_FIELDS = ['状态', '门禁', '候选', '风险', '执行', '依赖'];
const LEGACY_EXECUTION_FIELDS = new Set([
  '上下文预检',
  '硬门禁',
  'AI Review',
  '用户验收',
  '修复次数',
  'Commit',
  'baseCommit',
  'headCommit',
  '验证',
]);
const LEGACY_EXECUTION_SECTIONS = new Set([
  '上下文预检',
  '门禁记录',
  'Claims',
  'AI Review 结论',
  '验证备注',
  '用户验收',
]);
const TASK_DURABLE_FILES = new Set([
  'task.json',
  'execution.json',
  'claims.json',
  'audits.md',
  'delivery.json',
  '.gitignore',
]);
const PLAN_DURABLE_FILES = new Set(['plan.md', 'decisions.md', 'audits.md']);
const DEV_PLANS_GITIGNORE = 'dev-plans/.gitignore';
const WHOLE_PACKAGE_PATTERN = '*/review-packages/**';

class UsageError extends Error {}
class GateError extends Error {}

function usageError(message) {
  return new UsageError(message);
}

function gateError(message) {
  return new GateError(message);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])]),
  );
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256(value) {
  return `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
}

function git(root, args, { encoding = 'utf8' } = {}) {
  try {
    return execFileSync('git', args, {
      cwd: root,
      encoding,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const detail = String(error.stderr || error.stdout || error.message || '').trim();
    throw gateError(`git ${args.join(' ')} failed${detail ? `: ${detail}` : ''}`);
  }
}

function parseNullPaths(buffer) {
  return buffer
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .map((item) => item.split(path.sep).join('/'));
}

function formatDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function assertDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw usageError(`invalid date: ${value}`);
}

function assertSlug(value) {
  if (!SLUG_RE.test(value || '')) throw usageError(`invalid slug: ${value}`);
}

async function pathExists(target) {
  return fs.access(target).then(() => true, () => false);
}

async function readText(file, label) {
  try {
    return await fs.readFile(file, 'utf8');
  } catch (error) {
    throw gateError(`${label} missing or unreadable: ${error.message}`);
  }
}

async function readJson(file, label) {
  const source = await readText(file, label);
  try {
    return JSON.parse(source);
  } catch (error) {
    throw gateError(`${label} must be valid JSON: ${error.message}`);
  }
}

async function writeJson(file, value) {
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

function visibleLines(markdown) {
  const lines = markdown.split(/\r?\n/);
  let fence = null;
  return lines.map((line) => {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker[0];
      else if (marker[0] === fence) fence = null;
      return '';
    }
    return fence ? '' : line;
  });
}

function headingSections(markdown, level) {
  const lines = markdown.split(/\r?\n/);
  const visible = visibleLines(markdown);
  const prefix = '#'.repeat(level);
  const headingRe = new RegExp(`^${prefix}\\s+(.+?)\\s*$`);
  const headings = [];
  for (let index = 0; index < visible.length; index += 1) {
    const match = headingRe.exec(visible[index]);
    if (match) headings.push({ index, title: match[1] });
  }
  return headings.map((heading, index) => {
    let end = lines.length;
    for (let cursor = heading.index + 1; cursor < visible.length; cursor += 1) {
      const next = /^(#{1,6})\s+/.exec(visible[cursor]);
      if (next && next[1].length <= level) {
        end = cursor;
        break;
      }
    }
    return {
      title: heading.title,
      body: lines.slice(heading.index + 1, end).join('\n'),
      start: heading.index + 1,
      ordinal: index,
    };
  });
}

function getSection(markdown, title, level = 2) {
  const matches = headingSections(markdown, level).filter((section) => section.title === title);
  return matches.length === 1 ? matches[0].body : '';
}

function getFieldEntries(markdown, name) {
  const pattern = new RegExp(`^- ${escapeRegExp(name)}[：:]\\s*(.*)$`);
  return visibleLines(markdown)
    .map((line) => pattern.exec(line))
    .filter(Boolean)
    .map((match) => match[1].trim());
}

function getField(markdown, name) {
  const values = getFieldEntries(markdown, name);
  return values.length === 1 ? values[0] : undefined;
}

function topLevelFields(markdown) {
  return visibleLines(markdown)
    .map((line) => /^- ([^：:]+)[：:]\s*(.*)$/.exec(line))
    .filter(Boolean)
    .map((match) => ({ name: match[1].trim(), value: match[2].trim() }));
}

function getQuoteEntries(markdown, name) {
  const pattern = new RegExp(`^> ${escapeRegExp(name)}[：:]\\s*(.*)$`);
  return visibleLines(markdown)
    .map((line) => pattern.exec(line))
    .filter(Boolean)
    .map((match) => match[1].trim());
}

function getQuoteField(markdown, name) {
  const values = getQuoteEntries(markdown, name);
  return values.length === 1 ? values[0] : undefined;
}

function nestedList(markdown, name) {
  const lines = visibleLines(markdown);
  const startRe = new RegExp(`^- ${escapeRegExp(name)}[：:]\\s*(.*)$`);
  const starts = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = startRe.exec(lines[index]);
    if (match) starts.push({ index, inline: match[1].trim() });
  }
  if (starts.length !== 1) return { present: starts.length > 0, duplicate: starts.length > 1, items: [] };
  const [{ index, inline }] = starts;
  if (inline) {
    return {
      present: true,
      duplicate: false,
      items: EXPLICIT_NONE_RE.test(inline) ? [] : [inline],
    };
  }
  const items = [];
  for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
    if (/^- /.test(lines[cursor]) || /^#{1,6}\s+/.test(lines[cursor])) break;
    const item = /^\s{2,}-\s+(.+?)\s*$/.exec(lines[cursor]);
    if (item) items.push(item[1].trim());
    else if (lines[cursor].trim()) break;
  }
  return {
    present: true,
    duplicate: false,
    items: items.length === 1 && EXPLICIT_NONE_RE.test(items[0]) ? [] : items,
  };
}

function bulletList(markdown) {
  return visibleLines(markdown)
    .map((line) => /^-\s+(.+?)\s*$/.exec(line))
    .filter(Boolean)
    .map((match) => match[1].trim())
    .filter((item) => !EXPLICIT_NONE_RE.test(item));
}

function parseIdBlocks(markdown, idRe) {
  const blocks = new Map();
  const duplicates = [];
  for (const section of headingSections(markdown, 3)) {
    const match = /^([^：:]+)[：:]\s*(.+)$/.exec(section.title);
    if (!match || !idRe.test(match[1])) continue;
    const id = match[1];
    if (blocks.has(id)) duplicates.push(id);
    else blocks.set(id, { ...section, id, label: match[2].trim() });
  }
  return { blocks, duplicates };
}

function parseSlices(plan) {
  return parseIdBlocks(getSection(plan, '切片'), SLICE_ID_RE);
}

function parseAssociationItems(markdown) {
  const items = [];
  for (const line of visibleLines(markdown)) {
    const cells = line
      .trim()
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((item) => item.trim());
    if (cells.length < 2) continue;
    if (/^(?:D\d+(?:\.\d+)*|A\d+)$/.test(cells[0])) {
      items.push({ id: cells[0], status: cells[1] });
    }
  }
  return items;
}

function splitIds(value) {
  if (!value || EXPLICIT_NONE_RE.test(value)) return [];
  return value.split(/\s*(?:\/|、|,|，)\s*/).filter(Boolean);
}

function taskIdForSlice(sliceId) {
  return sliceId.toLowerCase().replaceAll('.', '-');
}

function taskRelativeDir(context, sliceId) {
  return `${context.planRef}/deliveries/${taskIdForSlice(sliceId)}`;
}

function taskAbsoluteDir(context, sliceId) {
  return path.join(context.repoRoot, ...taskRelativeDir(context, sliceId).split('/'));
}

async function ensureTaskDirectory(context, sliceId) {
  const deliveriesDir = path.join(context.planDir, 'deliveries');
  const taskDir = taskAbsoluteDir(context, sliceId);
  for (const [target, label] of [
    [deliveriesDir, 'deliveries directory'],
    [taskDir, 'task directory'],
  ]) {
    let stat;
    try {
      stat = await fs.lstat(target);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await fs.mkdir(target).catch((mkdirError) => {
        if (mkdirError.code !== 'EEXIST') throw mkdirError;
      });
      stat = await fs.lstat(target);
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw gateError(`${label} must be a real directory inside the plan`);
    }
  }
  const canonicalTaskDir = await fs.realpath(taskDir);
  const relative = path.relative(context.planDir, canonicalTaskDir);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw gateError('task directory must be a real directory inside the plan');
  }
  return canonicalTaskDir;
}

async function existingTaskDirectory(context, sliceId) {
  const deliveriesDir = path.join(context.planDir, 'deliveries');
  const taskDir = taskAbsoluteDir(context, sliceId);
  for (const [target, label] of [
    [deliveriesDir, 'deliveries directory'],
    [taskDir, 'task directory'],
  ]) {
    let stat;
    try {
      stat = await fs.lstat(target);
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw gateError(`${label} must be a real directory inside the plan`);
    }
  }
  const canonicalTaskDir = await fs.realpath(taskDir);
  const relative = path.relative(context.planDir, canonicalTaskDir);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw gateError('task directory must be a real directory inside the plan');
  }
  return canonicalTaskDir;
}

function normalizeRepoPattern(value, label) {
  if (!value || typeof value !== 'string') throw gateError(`${label} must be non-empty`);
  if (value.includes('\\')) throw gateError(`${label} must use forward slashes`);
  if (path.posix.isAbsolute(value)) throw gateError(`${label} must be repository-relative`);
  const normalized = path.posix.normalize(value);
  if (normalized === '..' || normalized.startsWith('../') || normalized !== value) {
    throw gateError(`${label} must be a normalized repository-relative path or glob`);
  }
  return normalized;
}

function taskContractFromSlice(context, sliceId, slice, baseCommit, revision) {
  const contract = getSection(slice.body, '委托合同', 4);
  const localConstraints = nestedList(contract, '约束').items;
  const nonGoals = nestedList(contract, '非目标').items;
  const forbiddenPaths = nestedList(contract, '禁止修改').items;
  const globalConstraints = bulletList(getSection(context.plan, '全局约束'));
  return {
    schemaVersion: 'deliver-task.task.v1',
    taskId: taskIdForSlice(sliceId),
    revision,
    caller: {
      kind: 'delegated',
      name: 'sliced-dev',
      ref: `${context.planRef}/plan.md#${sliceId}`,
    },
    objective: getSection(slice.body, '任务内容', 4).trim(),
    acceptanceCriteria: bulletList(getSection(slice.body, '验收', 4)),
    constraints: [...globalConstraints, ...localConstraints],
    nonGoals,
    forbiddenPaths,
    baseCommit,
    commitPolicy: 'required',
    acceptancePolicy: getField(contract, '验收策略'),
  };
}

function taskSemanticProjection(task) {
  if (!isPlainObject(task)) return task;
  const { revision: _revision, baseCommit: _baseCommit, ...projection } = task;
  return projection;
}

function validateTaskProjection(context, sliceId, slice, task, errors) {
  const expected = taskContractFromSlice(
    context,
    sliceId,
    slice,
    task.baseCommit,
    task.revision,
  );
  if (canonicalJson(taskSemanticProjection(task)) !== canonicalJson(taskSemanticProjection(expected))) {
    errors.push(`plan.md:${sliceId}: task.json immutable contract is stale; run delegate-task`);
  }
}

function runDeliver(context, command, sliceId) {
  const taskDir = taskRelativeDir(context, sliceId);
  try {
    return execFileSync(process.execPath, [DELIVER_SCRIPT, command, taskDir], {
      cwd: context.repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    const detail = String(error.stderr || error.stdout || error.message || '').trim();
    throw gateError(`deliver-task ${command} failed for ${sliceId}${detail ? `: ${detail}` : ''}`);
  }
}

async function resolvePlanContext(planDirArg, { cli = false } = {}) {
  if (!planDirArg) throw usageError('plan directory is required');
  if (path.isAbsolute(planDirArg)) {
    if (cli) throw usageError('plan directory must be repository-relative');
  }
  const absoluteInput = path.resolve(planDirArg);
  let stat;
  try {
    stat = await fs.lstat(absoluteInput);
  } catch {
    throw usageError(`plan directory does not exist or is not readable: ${planDirArg}`);
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw usageError(`plan directory must be a real directory: ${planDirArg}`);
  }
  const repoRoot = git(absoluteInput, ['rev-parse', '--show-toplevel']).trim();
  const canonicalRoot = await fs.realpath(repoRoot);
  const canonicalPlanDir = await fs.realpath(absoluteInput);
  const planRef = path.relative(canonicalRoot, canonicalPlanDir).split(path.sep).join('/');
  const parts = planRef.split('/');
  if (parts.length !== 2 || parts[0] !== 'dev-plans' || !PLAN_DIR_RE.test(parts[1])) {
    throw usageError(`plan directory must be dev-plans/YYYY-MM-DD-slug: ${planDirArg}`);
  }
  const [plan, decisions, audits] = await Promise.all([
    readText(path.join(canonicalPlanDir, 'plan.md'), 'plan.md'),
    readText(path.join(canonicalPlanDir, 'decisions.md'), 'decisions.md'),
    readText(path.join(canonicalPlanDir, 'audits.md'), 'audits.md'),
  ]);
  return {
    repoRoot: canonicalRoot,
    planDir: canonicalPlanDir,
    planRef,
    plan,
    decisions,
    audits,
  };
}

function validateUniqueHeadings(markdown, level, allowed, label, errors) {
  const sections = headingSections(markdown, level);
  const seen = new Set();
  for (const section of sections) {
    if (seen.has(section.title)) errors.push(`${label}: duplicate heading ${section.title}`);
    seen.add(section.title);
    if (allowed && !allowed.has(section.title)) {
      errors.push(`${label}: unsupported heading ${section.title}`);
    }
  }
}

function validateTopLevelPlan(context, slices, errors) {
  if (!/^#\s+\S/m.test(context.plan)) errors.push('plan.md: missing H1 title');
  validateUniqueHeadings(context.plan, 2, PLAN_SECTIONS, 'plan.md', errors);
  for (const section of REQUIRED_PLAN_SECTIONS) {
    if (!getSection(context.plan, section)) errors.push(`plan.md: missing ## ${section}`);
  }

  const metadata = [
    ['档位', new Set(['完整'])],
    ['状态', PLAN_STATUSES],
    ['上游依据', null],
    ['计划一致性预检', PREFLIGHT_STATUSES],
    ['拆分拷问', PLAN_GATES],
  ];
  const allowedMetadata = new Set([...metadata.map(([name]) => name), '整任务审查']);
  const metadataSource = context.plan.split(/^##\s+/m, 1)[0];
  for (const line of visibleLines(metadataSource)) {
    const match = /^>\s+([^：:]+)[：:]\s*/.exec(line);
    if (match && !allowedMetadata.has(match[1].trim())) {
      errors.push(`plan.md: unsupported metadata ${match[1].trim()}`);
    }
  }
  for (const [name, values] of metadata) {
    const entries = getQuoteEntries(context.plan, name);
    if (entries.length !== 1 || !entries[0]) {
      errors.push(`plan.md: ${name} must appear exactly once and be non-empty`);
    } else if (values && !values.has(entries[0])) {
      errors.push(`plan.md: invalid ${name} ${entries[0]}`);
    }
  }
  const wholeReviewEntries = getQuoteEntries(context.plan, '整任务审查');
  if (wholeReviewEntries.length > 1) errors.push('plan.md: 整任务审查 must appear at most once');
  if (wholeReviewEntries.length === 1 && !WHOLE_REVIEW_STATUSES.has(wholeReviewEntries[0])) {
    errors.push(`plan.md: invalid 整任务审查 ${wholeReviewEntries[0]}`);
  }

  const current = getSection(context.plan, '当前状态');
  const phase = getField(current, '阶段');
  const currentSlice = getField(current, '当前切片');
  const nextStep = getField(current, '下一步');
  if (!PHASES.has(phase)) errors.push(`plan.md: invalid 阶段 ${phase ?? '<missing>'}`);
  if (!currentSlice) errors.push('plan.md: missing 当前切片');
  if (!nextStep) errors.push('plan.md: missing 下一步');
  if (currentSlice && !new Set(['待定', '无']).has(currentSlice) && !slices.has(currentSlice)) {
    errors.push(`plan.md: 当前切片 ${currentSlice} does not exist`);
  }

  const planStatus = getQuoteField(context.plan, '状态');
  const preflight = getQuoteField(context.plan, '计划一致性预检');
  const splitGate = getQuoteField(context.plan, '拆分拷问');
  if (new Set(['executing', 'done']).has(planStatus)) {
    if (slices.size === 0) errors.push(`plan.md: ${planStatus} plan requires at least one slice`);
    if (preflight !== 'passed') errors.push(`plan.md: ${planStatus} plan requires 计划一致性预检 passed`);
    if (!CLOSED_PLAN_GATES.has(splitGate)) errors.push(`plan.md: ${planStatus} plan requires closed 拆分拷问`);
  }
  if (planStatus === 'done') {
    if (phase !== 'done') errors.push('plan.md: done plan requires 阶段 done');
    if (currentSlice !== '无') errors.push('plan.md: done plan requires 当前切片 无');
    for (const [id, slice] of slices) {
      const status = getField(slice.body, '状态');
      if (!TERMINAL_SLICE_STATUSES.has(status)) {
        errors.push(`plan.md:${id}: done plan cannot include ${status ?? '<missing>'} slice`);
      }
    }
  }

  const target = getSection(context.plan, '目标').trim();
  if (!target || PLACEHOLDER_RE.test(target)) errors.push('plan.md: 目标 must be non-placeholder');
}

function validateContractSection(sliceId, slice, errors) {
  const contract = getSection(slice.body, '委托合同', 4);
  const allowed = new Set(['验收策略', '约束', '非目标', '禁止修改']);
  const fields = topLevelFields(contract);
  const seen = new Set();
  for (const field of fields) {
    if (seen.has(field.name)) errors.push(`plan.md:${sliceId}: duplicate 委托合同 field ${field.name}`);
    seen.add(field.name);
    if (!allowed.has(field.name)) errors.push(`plan.md:${sliceId}: unsupported 委托合同 field ${field.name}`);
  }
  const acceptancePolicy = getField(contract, '验收策略');
  if (!ACCEPTANCE_POLICIES.has(acceptancePolicy)) {
    errors.push(`plan.md:${sliceId}: invalid 验收策略 ${acceptancePolicy ?? '<missing>'}`);
  }
  for (const name of ['约束', '非目标', '禁止修改']) {
    const list = nestedList(contract, name);
    if (!list.present) errors.push(`plan.md:${sliceId}: 委托合同 missing ${name}`);
    if (list.duplicate) errors.push(`plan.md:${sliceId}: duplicate 委托合同 field ${name}`);
    if (new Set(list.items).size !== list.items.length) {
      errors.push(`plan.md:${sliceId}: 委托合同 ${name} must not contain duplicates`);
    }
  }
  const risk = getField(slice.body, '风险');
  const execution = getField(slice.body, '执行');
  if ((risk === 'C' || execution === '需确认') && acceptancePolicy !== 'required') {
    errors.push(`plan.md:${sliceId}: C/需确认 slice requires 验收策略 required`);
  }
  for (const [index, item] of nestedList(contract, '禁止修改').items.entries()) {
    try {
      normalizeRepoPattern(item, `plan.md:${sliceId}: 禁止修改[${index}]`);
    } catch (error) {
      errors.push(error.message);
    }
  }
}

function validateHandoff(sliceId, slice, errors) {
  const handoff = getSection(slice.body, '切片交接', 4);
  for (const name of ['输入', '输出']) {
    const list = nestedList(handoff, name);
    if (!list.present) errors.push(`plan.md:${sliceId}: 切片交接 missing ${name}`);
    if (list.duplicate) errors.push(`plan.md:${sliceId}: duplicate 切片交接 field ${name}`);
  }
}

function validateSliceShape(sliceId, slice, slices, decisions, audits, referencedDecisions, errors) {
  const headings = headingSections(slice.body, 4);
  const seenHeadings = new Set();
  const legacySections = [];
  for (const heading of headings) {
    if (seenHeadings.has(heading.title)) errors.push(`plan.md:${sliceId}: duplicate subsection ${heading.title}`);
    seenHeadings.add(heading.title);
    if (LEGACY_EXECUTION_SECTIONS.has(heading.title)) legacySections.push(heading.title);
    else if (!SLICE_SECTIONS.has(heading.title)) {
      errors.push(`plan.md:${sliceId}: unsupported subsection ${heading.title}`);
    }
  }

  const header = slice.body.split(/^####\s+/m, 1)[0];
  const fields = topLevelFields(header);
  const legacyFields = fields.filter((field) => LEGACY_EXECUTION_FIELDS.has(field.name));
  if (legacyFields.length > 0 || legacySections.length > 0) {
    const names = [...new Set([...legacyFields.map((field) => field.name), ...legacySections])];
    errors.push(`plan.md:${sliceId}: unsupported delegated execution fields: ${names.join(', ')}`);
  }
  const fieldNames = new Set();
  for (const field of fields) {
    if (fieldNames.has(field.name)) errors.push(`plan.md:${sliceId}: duplicate field ${field.name}`);
    fieldNames.add(field.name);
    if (!SLICE_HEADER_FIELDS.has(field.name) && !LEGACY_EXECUTION_FIELDS.has(field.name)) {
      errors.push(`plan.md:${sliceId}: unsupported field ${field.name}`);
    }
  }
  for (const name of REQUIRED_SLICE_HEADER_FIELDS) {
    if (!fieldNames.has(name)) errors.push(`plan.md:${sliceId}: missing ${name}`);
  }
  for (const title of REQUIRED_SLICE_SECTIONS) {
    if (!seenHeadings.has(title)) errors.push(`plan.md:${sliceId}: missing #### ${title}`);
  }

  const status = getField(header, '状态');
  const gate = getField(header, '门禁');
  const candidate = getField(header, '候选');
  const risk = getField(header, '风险');
  const execution = getField(header, '执行');
  if (!SLICE_STATUSES.has(status)) errors.push(`plan.md:${sliceId}: invalid 状态 ${status ?? '<missing>'}`);
  if (!SLICE_GATES.has(gate)) errors.push(`plan.md:${sliceId}: invalid 门禁 ${gate ?? '<missing>'}`);
  if (!SLICE_CANDIDATES.has(candidate)) errors.push(`plan.md:${sliceId}: invalid 候选 ${candidate ?? '<missing>'}`);
  if (!RISK_LEVELS.has(risk)) errors.push(`plan.md:${sliceId}: invalid 风险 ${risk ?? '<missing>'}`);
  if (!EXECUTION_MODES.has(execution)) errors.push(`plan.md:${sliceId}: invalid 执行 ${execution ?? '<missing>'}`);
  if ((status === 'in-progress' || TERMINAL_SLICE_STATUSES.has(status)) && !CLOSED_SLICE_GATES.has(gate)) {
    errors.push(`plan.md:${sliceId}: ${status} slice requires closed 门禁`);
  }
  if (risk === 'C' && execution === '自动') {
    errors.push(`plan.md:${sliceId}: risk C cannot use 执行 自动`);
  }
  if (status === 'done' && (risk === '待判定' || execution === '待判定')) {
    errors.push(`plan.md:${sliceId}: done slice requires definite 风险 and 执行`);
  }

  const dependencies = splitIds(getField(header, '依赖'));
  for (const dependency of dependencies) {
    if (!SLICE_ID_RE.test(dependency) || !slices.has(dependency)) {
      errors.push(`plan.md:${sliceId}: dependency ${dependency} does not exist`);
    }
    if (dependency === sliceId) errors.push(`plan.md:${sliceId}: slice cannot depend on itself`);
  }

  if (status === 'split') {
    const replacements = splitIds(getField(header, '替代切片'));
    if (replacements.length === 0) errors.push(`plan.md:${sliceId}: split slice requires 替代切片`);
    for (const replacement of replacements) {
      if (!replacement.startsWith(`${sliceId}.`) || !slices.has(replacement)) {
        errors.push(`plan.md:${sliceId}: invalid 替代切片 ${replacement}`);
      }
    }
  } else if (fieldNames.has('替代切片')) {
    errors.push(`plan.md:${sliceId}: only split slice may use 替代切片`);
  }

  const skipBasis = getField(header, '跳过依据');
  if (status === 'skipped') {
    if (!DECISION_ID_RE.test(skipBasis || '') || getField(decisions.get(skipBasis)?.body || '', '状态') !== 'decided') {
      errors.push(`plan.md:${sliceId}: skipped slice requires one decided 跳过依据`);
    }
  } else if (fieldNames.has('跳过依据')) {
    errors.push(`plan.md:${sliceId}: only skipped slice may use 跳过依据`);
  }

  const objective = getSection(slice.body, '任务内容', 4).trim();
  if (!objective || PLACEHOLDER_RE.test(objective)) errors.push(`plan.md:${sliceId}: 任务内容 must be non-placeholder`);
  const acceptance = bulletList(getSection(slice.body, '验收', 4));
  if (acceptance.length === 0) errors.push(`plan.md:${sliceId}: 验收 requires at least one item`);
  if (new Set(acceptance).size !== acceptance.length) {
    errors.push(`plan.md:${sliceId}: 验收 must not contain duplicates`);
  }
  validateContractSection(sliceId, slice, errors);
  validateHandoff(sliceId, slice, errors);

  const associationItems = parseAssociationItems(getSection(slice.body, '关联项', 4));
  for (const item of associationItems) {
    const source = item.id.startsWith('D') ? decisions : audits;
    const block = source.get(item.id);
    if (!block) errors.push(`plan.md:${sliceId}: 关联项 references missing ${item.id}`);
    else {
      const actual = getField(block.body, '状态');
      if (actual !== item.status) {
        errors.push(`plan.md:${sliceId}: ${item.id} status ${item.status} differs from ${actual}`);
      }
    }
    if (item.id.startsWith('D')) referencedDecisions.add(item.id);
  }
  const hasOpenDecision = associationItems.some((item) => item.id.startsWith('D') && item.status === 'open');
  if (hasOpenDecision && status !== 'blocked') {
    errors.push(`plan.md:${sliceId}: slice with open decision must be blocked`);
  }
}

function validateDependencyGraph(slices, errors) {
  const visiting = new Set();
  const visited = new Set();
  function visit(id, trail) {
    if (visiting.has(id)) {
      errors.push(`plan.md:${id}: dependency cycle ${[...trail, id].join(' -> ')}`);
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    const block = slices.get(id);
    for (const dependency of splitIds(getField(block?.body || '', '依赖'))) {
      if (slices.has(dependency)) visit(dependency, [...trail, id]);
    }
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of slices.keys()) visit(id, []);
}

function validateDecisionDocument(context, slices, errors) {
  if (!/^#\s+分叉记录\s*$/m.test(context.decisions)) errors.push('decisions.md: missing H1 分叉记录');
  const parsed = parseIdBlocks(context.decisions, DECISION_ID_RE);
  for (const id of parsed.duplicates) errors.push(`decisions.md: duplicate ${id}`);
  for (const section of headingSections(context.decisions, 3)) {
    if (!/^D\d+(?:\.\d+)*[：:]\s*\S/.test(section.title)) {
      errors.push(`decisions.md: unsupported heading ${section.title}`);
    }
  }
  for (const [id, block] of parsed.blocks) {
    const status = getField(block.body, '状态');
    if (!DECISION_STATUSES.has(status)) errors.push(`decisions.md:${id}: invalid 状态 ${status ?? '<missing>'}`);
    if (!getField(block.body, '关联')) errors.push(`decisions.md:${id}: missing 关联`);
    if (status === 'open') {
      if (!getField(block.body, '问题')) errors.push(`decisions.md:${id}: open decision missing 问题`);
      if (!getField(block.body, '推荐')) errors.push(`decisions.md:${id}: open decision missing 推荐`);
    }
    if (status === 'decided' && !getField(block.body, '结论')) {
      errors.push(`decisions.md:${id}: decided decision missing 结论`);
    }
  }
  return parsed.blocks;
}

function validateAuditDocument(context, errors) {
  if (!/^#\s+审计记录\s*$/m.test(context.audits)) errors.push('audits.md: missing H1 审计记录');
  const parsed = parseIdBlocks(context.audits, AUDIT_ID_RE);
  for (const id of parsed.duplicates) errors.push(`audits.md: duplicate ${id}`);
  for (const section of headingSections(context.audits, 3)) {
    if (!/^A\d+[：:]\s*\S/.test(section.title)) {
      errors.push(`audits.md: unsupported heading ${section.title}`);
    }
  }
  for (const [id, block] of parsed.blocks) {
    const status = getField(block.body, '状态');
    if (!AUDIT_STATUSES.has(status)) errors.push(`audits.md:${id}: invalid 状态 ${status ?? '<missing>'}`);
    if (!getField(block.body, '关联')) errors.push(`audits.md:${id}: missing 关联`);
  }
  return parsed.blocks;
}

function validateOpenDecisionVisibility(decisions, referenced, errors) {
  for (const [id, block] of decisions) {
    if (getField(block.body, '状态') === 'open' && !referenced.has(id)) {
      errors.push(`decisions.md:${id}: open decision is not referenced by any slice`);
    }
  }
}

function validateWholeReviewShape(context, errors) {
  const status = getQuoteField(context.plan, '整任务审查');
  const section = getSection(context.plan, '整任务审查结论');
  if (!status) {
    if (section) errors.push('plan.md: ## 整任务审查结论 requires top-level 整任务审查');
    return;
  }
  if (!section) {
    errors.push('plan.md: 整任务审查 requires ## 整任务审查结论');
    return;
  }
  const hashes = getFieldEntries(section, 'reviewPackageHash');
  if (hashes.length !== 1 || !SHA256_RE.test(hashes[0])) {
    errors.push('plan.md: 整任务审查结论 requires one sha256 reviewPackageHash');
  }
  if (status === 'passed') {
    for (const verdict of WHOLE_REVIEW_VERDICTS) {
      const matchingRows = visibleLines(section).filter((line) => {
        const cells = line.trim().replace(/^\||\|$/g, '').split('|').map((item) => item.trim());
        return cells[0] === verdict && cells[1] === 'passed';
      });
      if (matchingRows.length !== 1) {
        errors.push(`plan.md: 整任务审查 passed requires passed verdict ${verdict}`);
      }
    }
  }
}

async function validateTaskState(context, sliceId, slice, errors, { ignoreTaskId } = {}) {
  if (sliceId === ignoreTaskId) return;
  const status = getField(slice.body, '状态');
  let taskDir;
  try {
    taskDir = await existingTaskDirectory(context, sliceId);
  } catch (error) {
    errors.push(error.message);
    return;
  }
  if (taskDir === null) {
    if (status === 'done') errors.push(`plan.md:${sliceId}: done slice requires delegated task.json`);
    return;
  }
  const taskPath = path.join(taskDir, 'task.json');
  const exists = await pathExists(taskPath);
  if (!exists) {
    if (status === 'done') errors.push(`plan.md:${sliceId}: done slice requires delegated task.json`);
    return;
  }
  let task;
  try {
    runDeliver(context, 'validate-task', sliceId);
    task = await readJson(taskPath, `${sliceId} task.json`);
    validateTaskProjection(context, sliceId, slice, task, errors);
  } catch (error) {
    errors.push(error.message);
    return;
  }

  const deliveryPath = path.join(taskDir, 'delivery.json');
  if (!(await pathExists(deliveryPath))) {
    if (TERMINAL_SLICE_STATUSES.has(status) && status !== 'skipped') {
      errors.push(`plan.md:${sliceId}: ${status} slice requires delivery.json`);
    }
    return;
  }
  if (!TERMINAL_SLICE_STATUSES.has(status)) return;
  try {
    runDeliver(context, 'validate-result', sliceId);
    const delivery = await readJson(deliveryPath, `${sliceId} delivery.json`);
    if (status === 'done' && delivery.result !== 'delivered') {
      errors.push(`plan.md:${sliceId}: delivery result must be delivered, got ${delivery.result}`);
    }
    if (status === 'split' && delivery.result !== 'needs-reslice') {
      errors.push(`plan.md:${sliceId}: split slice requires delivery result needs-reslice`);
    }
  } catch (error) {
    errors.push(error.message);
  }
}

async function validateContext(context, options = {}) {
  const errors = [];
  const parsedSlices = parseSlices(context.plan);
  for (const id of parsedSlices.duplicates) errors.push(`plan.md: duplicate ${id}`);
  const slices = parsedSlices.blocks;
  validateTopLevelPlan(context, slices, errors);
  const audits = validateAuditDocument(context, errors);
  const decisions = validateDecisionDocument(context, slices, errors);
  const referencedDecisions = new Set();
  for (const [sliceId, slice] of slices) {
    validateSliceShape(sliceId, slice, slices, decisions, audits, referencedDecisions, errors);
  }
  validateDependencyGraph(slices, errors);
  validateOpenDecisionVisibility(decisions, referencedDecisions, errors);
  validateWholeReviewShape(context, errors);
  await Promise.all(
    [...slices].map(([sliceId, slice]) =>
      validateTaskState(context, sliceId, slice, errors, options)),
  );
  return { errors, slices, decisions, audits };
}

export async function validatePlan(planDir, options = {}) {
  const context = await resolvePlanContext(planDir);
  return (await validateContext(context, options)).errors;
}

async function ensureDevPlansGitignore(repoRoot) {
  const target = path.join(repoRoot, ...DEV_PLANS_GITIGNORE.split('/'));
  await fs.mkdir(path.dirname(target), { recursive: true });
  let source = '';
  try {
    source = await fs.readFile(target, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const lines = source.split(/\r?\n/).map((line) => line.trim());
  if (lines.includes(WHOLE_PACKAGE_PATTERN)) return;
  const separator = source && !source.endsWith('\n') ? '\n' : '';
  await fs.writeFile(target, `${source}${separator}${WHOLE_PACKAGE_PATTERN}\n`);
}

function planTemplate({ title, upstream }) {
  return `# ${title}

> 档位：完整
> 状态：draft
> 上游依据：${upstream}
> 计划一致性预检：pending
> 拆分拷问：pending-grill

## 当前状态

- 阶段：slicing
- 当前切片：待定
- 下一步：完成任务级分叉门禁并产出切片

## 文件索引

| 文件 | 职责 |
| --- | --- |
| [decisions.md](./decisions.md) | 分叉正文 |
| [audits.md](./audits.md) | 计划级长审计与跨切片证据 |
| [deliveries/](./deliveries/) | deliver-task 的任务合同与交付结果 |

## 目标

待补充。

## 全局约束

- 暂无。

## 切片

待拆分。
`;
}

export async function initPlan({ slug, title, date = formatDate(), upstream = '无' }) {
  assertSlug(slug);
  assertDate(date);
  if (!title) throw usageError('--title is required');
  const repoRoot = git(process.cwd(), ['rev-parse', '--show-toplevel']).trim();
  const planRef = `dev-plans/${date}-${slug}`;
  const planDir = path.join(repoRoot, ...planRef.split('/'));
  if (await pathExists(planDir)) throw usageError(`target directory already exists: ${planRef}`);
  await fs.mkdir(planDir, { recursive: true });
  await ensureDevPlansGitignore(repoRoot);
  await Promise.all([
    fs.writeFile(path.join(planDir, 'plan.md'), planTemplate({ title, upstream })),
    fs.writeFile(path.join(planDir, 'decisions.md'), '# 分叉记录\n\n暂无分叉。\n'),
    fs.writeFile(path.join(planDir, 'audits.md'), '# 审计记录\n\n暂无计划级长证据。\n'),
  ]);
  return planRef;
}

function requireSlice(slices, sliceId, command) {
  if (!SLICE_ID_RE.test(sliceId || '')) throw usageError(`${command} requires a valid S-id`);
  const slice = slices.get(sliceId);
  if (!slice) throw usageError(`${command}: slice ${sliceId} does not exist`);
  return slice;
}

function assertDelegateReady(sliceId, slice, slices) {
  const status = getField(slice.body, '状态');
  const gate = getField(slice.body, '门禁');
  const risk = getField(slice.body, '风险');
  const execution = getField(slice.body, '执行');
  if (!new Set(['not-started', 'in-progress', 'blocked']).has(status)) {
    throw gateError(`delegate-task requires ${sliceId} status not-started/in-progress/blocked, got ${status}`);
  }
  if (!CLOSED_SLICE_GATES.has(gate)) throw gateError(`delegate-task requires ${sliceId} closed 门禁`);
  if (risk === '待判定' || execution === '待判定') {
    throw gateError(`delegate-task requires ${sliceId} definite 风险 and 执行`);
  }
  const incomplete = splitIds(getField(slice.body, '依赖')).filter((dependency) => {
    const dependencySlice = slices.get(dependency);
    return !dependencySlice || !DEPENDENCY_COMPLETE_STATUSES.has(getField(dependencySlice.body, '状态'));
  });
  if (incomplete.length > 0) {
    throw gateError(`delegate-task dependencies are not done/skipped: ${incomplete.join(', ')}`);
  }
}

async function delegateTask(context, sliceId, { refreshBase = false } = {}) {
  const validation = await validateContext(context, { ignoreTaskId: sliceId });
  if (validation.errors.length > 0) {
    throw gateError(`validate failed before delegate-task:\n${validation.errors.map((item) => `- ${item}`).join('\n')}`);
  }
  const slice = requireSlice(validation.slices, sliceId, 'delegate-task');
  assertDelegateReady(sliceId, slice, validation.slices);

  const taskDir = await ensureTaskDirectory(context, sliceId);
  const taskPath = path.join(taskDir, 'task.json');
  const existingSource = await fs.readFile(taskPath, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  let existing = null;
  if (existingSource !== null) {
    runDeliver(context, 'validate-task', sliceId);
    existing = JSON.parse(existingSource);
  }
  const currentHead = git(context.repoRoot, ['rev-parse', 'HEAD']).trim();
  if (!GIT_OID_RE.test(currentHead)) throw gateError('HEAD is not a normalized Git commit');
  const candidate = taskContractFromSlice(
    context,
    sliceId,
    slice,
    existing?.baseCommit ?? currentHead,
    existing?.revision ?? 1,
  );
  const unchanged = !refreshBase && existing
    && canonicalJson(taskSemanticProjection(existing)) === canonicalJson(taskSemanticProjection(candidate));
  const task = unchanged
    ? existing
    : taskContractFromSlice(
      context,
      sliceId,
      slice,
      currentHead,
      existing ? existing.revision + 1 : 1,
    );

  await writeJson(taskPath, task);
  try {
    runDeliver(context, 'validate-task', sliceId);
  } catch (error) {
    if (existingSource === null) await fs.unlink(taskPath).catch(() => {});
    else await fs.writeFile(taskPath, existingSource);
    throw error;
  }
  return { task, changed: !unchanged, taskDir: taskRelativeDir(context, sliceId) };
}

async function deliveryStatus(context, sliceId) {
  const validation = await validateContext(context);
  if (validation.errors.length > 0) {
    throw gateError(`validate failed before delivery-status:\n${validation.errors.map((item) => `- ${item}`).join('\n')}`);
  }
  requireSlice(validation.slices, sliceId, 'delivery-status');
  runDeliver(context, 'validate-result', sliceId);
  const delivery = await readJson(path.join(taskAbsoluteDir(context, sliceId), 'delivery.json'), 'delivery.json');
  return {
    sliceId,
    taskDir: taskRelativeDir(context, sliceId),
    result: delivery.result,
    target: delivery.target,
    evidenceRefs: delivery.evidenceRefs,
    residualRiskRefs: delivery.residualRiskRefs,
    upstreamRequest: delivery.upstreamRequest,
  };
}

async function sliceCloseCheck(context, sliceId) {
  const validation = await validateContext(context);
  if (validation.errors.length > 0) {
    throw gateError(`validate failed before slice-close-check:\n${validation.errors.map((item) => `- ${item}`).join('\n')}`);
  }
  const slice = requireSlice(validation.slices, sliceId, 'slice-close-check');
  if (getField(slice.body, '状态') !== 'done') {
    throw gateError(`slice-close-check requires ${sliceId} status done`);
  }
  runDeliver(context, 'validate-result', sliceId);
  const delivery = await readJson(path.join(taskAbsoluteDir(context, sliceId), 'delivery.json'), 'delivery.json');
  if (delivery.result !== 'delivered') {
    throw gateError(`delivery result must be delivered, got ${delivery.result}`);
  }
}

function isAllowedPlanCommitPath(context, repoPath) {
  if (repoPath === DEV_PLANS_GITIGNORE) return true;
  if (!repoPath.startsWith(`${context.planRef}/`)) return false;
  const relative = repoPath.slice(context.planRef.length + 1);
  if (PLAN_DURABLE_FILES.has(relative)) return true;
  const parts = relative.split('/');
  const taskIds = new Set(
    [...parseSlices(context.plan).blocks.keys()].map((sliceId) => taskIdForSlice(sliceId)),
  );
  return parts.length === 3
    && parts[0] === 'deliveries'
    && taskIds.has(parts[1])
    && TASK_DURABLE_FILES.has(parts[2]);
}

async function planCommitCheck(context) {
  const validation = await validateContext(context);
  if (validation.errors.length > 0) {
    throw gateError(`validate failed before plan-commit-check:\n${validation.errors.map((item) => `- ${item}`).join('\n')}`);
  }
  const staged = parseNullPaths(
    git(context.repoRoot, ['diff', '--cached', '--name-only', '-z', '--'], { encoding: 'buffer' }),
  );
  if (staged.length === 0) throw gateError('plan-commit-check requires staged durable plan state');
  const outside = staged.filter((repoPath) => !isAllowedPlanCommitPath(context, repoPath));
  if (outside.length > 0) {
    throw gateError(`staged paths are outside durable plan scope: ${outside.join(', ')}`);
  }
  const artifacts = staged.filter((repoPath) => repoPath.includes('/artifacts/') || repoPath.includes('/review-packages/'));
  if (artifacts.length > 0) throw gateError(`generated artifacts must not be staged: ${artifacts.join(', ')}`);

  const unstaged = parseNullPaths(
    git(context.repoRoot, ['diff', '--name-only', '-z', '--'], { encoding: 'buffer' }),
  );
  const untracked = parseNullPaths(
    git(context.repoRoot, ['ls-files', '--others', '--exclude-standard', '-z'], { encoding: 'buffer' }),
  );
  const stagedSet = new Set(staged);
  const residual = [...new Set([...unstaged, ...untracked])]
    .filter((repoPath) => isAllowedPlanCommitPath(context, repoPath) && !stagedSet.has(repoPath));
  if (residual.length > 0) {
    throw gateError(`durable plan state is not fully staged: ${residual.join(', ')}`);
  }
}

function renderFence(language, value) {
  return `\`\`\`${language}\n${value.trimEnd()}\n\`\`\``;
}

function renderTargetDiff(context, delivery) {
  if (delivery.target?.kind !== 'commit-range') return '无 committed diff。';
  return git(
    context.repoRoot,
    ['diff', '--no-ext-diff', '--binary', `${delivery.target.baseCommit}..${delivery.target.headCommit}`, '--'],
  ).trimEnd() || '无 committed diff。';
}

async function buildWholeReviewPackage(context) {
  const validation = await validateContext(context);
  if (validation.errors.length > 0) {
    throw gateError(`validate failed before whole-review-package:\n${validation.errors.map((item) => `- ${item}`).join('\n')}`);
  }
  const sections = [
    '# sliced-dev 整任务审查包',
    '',
    '本包只聚合各 deliver-task 已固定的任务、target 与证据引用；审查跨切片约束、交接和整体闭合，不重做单任务 General Review。',
    '',
    '## 当前计划',
    '',
    context.plan.trimEnd(),
    '',
    '## 分叉记录',
    '',
    context.decisions.trimEnd(),
    '',
    '## 计划级审计',
    '',
    context.audits.trimEnd(),
  ];
  for (const [sliceId, slice] of validation.slices) {
    const status = getField(slice.body, '状态');
    if (status !== 'done') continue;
    const task = await readText(path.join(taskAbsoluteDir(context, sliceId), 'task.json'), `${sliceId} task.json`);
    const delivery = await readJson(path.join(taskAbsoluteDir(context, sliceId), 'delivery.json'), `${sliceId} delivery.json`);
    sections.push(
      '',
      `## ${sliceId} 委托结果`,
      '',
      '### task.json',
      '',
      renderFence('json', task),
      '',
      '### delivery.json',
      '',
      renderFence('json', JSON.stringify(delivery, null, 2)),
      '',
      '### Git Diff',
      '',
      renderFence('diff', renderTargetDiff(context, delivery)),
    );
  }
  sections.push(
    '',
    '## Reviewer Instructions',
    '',
    '请独立检查全局约束、跨切片交接、非目标边界、整体需求闭合和残余风险；不要把单任务内部实现流程重新归 sliced-dev 所有。',
    '',
    '## 整任务审查结论模板',
    '',
    '| Verdict | Status | Severity | Evidence | Note |',
    '| --- | --- | --- | --- | --- |',
    ...WHOLE_REVIEW_VERDICTS.map((verdict) => `| ${verdict} | pending | pending | 待审查 | 待审查 |`),
    '',
  );
  return `${sections.join('\n')}\n`;
}

async function writeWholeReviewPackage(context) {
  const content = await buildWholeReviewPackage(context);
  const directory = path.join(context.planDir, 'review-packages');
  const target = path.join(directory, 'whole-task.md');
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(target, content);
  return {
    target: `${context.planRef}/review-packages/whole-task.md`,
    hash: sha256(content),
  };
}

async function closeCheck(context) {
  const validation = await validateContext(context);
  const errors = [...validation.errors];
  if (getQuoteField(context.plan, '状态') !== 'done') errors.push('plan.md: close-check requires 状态 done');
  const wholeReview = getQuoteField(context.plan, '整任务审查');
  if (wholeReview) {
    if (wholeReview !== 'passed') errors.push('plan.md: close-check requires 整任务审查 passed');
    const packagePath = path.join(context.planDir, 'review-packages/whole-task.md');
    let packageSource;
    try {
      packageSource = await fs.readFile(packagePath, 'utf8');
    } catch {
      errors.push('whole review package is missing; regenerate whole-review-package');
    }
    const recordedHash = getField(getSection(context.plan, '整任务审查结论'), 'reviewPackageHash');
    if (packageSource && recordedHash !== sha256(packageSource)) {
      errors.push('plan.md: whole review package hash is stale');
    }
  }
  if (errors.length > 0) {
    throw gateError(`close-check failed:\n${errors.map((item) => `- ${item}`).join('\n')}`);
  }
}

async function buildRoster(context) {
  const validation = await validateContext(context);
  if (validation.errors.length > 0) {
    throw gateError(`validate failed before roster:\n${validation.errors.map((item) => `- ${item}`).join('\n')}`);
  }
  const rows = ['| Slice | 状态 | 门禁 | 风险 | 执行 | 依赖 | Delivery |', '| --- | --- | --- | --- | --- | --- | --- |'];
  for (const [sliceId, slice] of validation.slices) {
    let delivery = '未委托';
    if (await pathExists(path.join(taskAbsoluteDir(context, sliceId), 'task.json'))) delivery = '已委托';
    if (await pathExists(path.join(taskAbsoluteDir(context, sliceId), 'delivery.json'))) {
      try {
        delivery = (await readJson(path.join(taskAbsoluteDir(context, sliceId), 'delivery.json'), 'delivery.json')).result;
      } catch {
        delivery = 'invalid';
      }
    }
    rows.push(`| ${sliceId} | ${getField(slice.body, '状态')} | ${getField(slice.body, '门禁')} | ${getField(slice.body, '风险')} | ${getField(slice.body, '执行')} | ${getField(slice.body, '依赖')} | ${delivery} |`);
  }
  return rows.join('\n');
}

async function buildShow(context, target) {
  const validation = await validateContext(context);
  if (validation.errors.length > 0) {
    throw gateError(`validate failed before show:\n${validation.errors.map((item) => `- ${item}`).join('\n')}`);
  }
  let sliceId = target;
  if (target === 'current') {
    sliceId = getField(getSection(context.plan, '当前状态'), '当前切片');
    if (new Set(['无', '待定']).has(sliceId)) return getSection(context.plan, '当前状态').trimEnd();
  }
  const slice = requireSlice(validation.slices, sliceId, 'show');
  return `### ${sliceId}：${slice.label}\n${slice.body}`.trimEnd();
}

function getArgValue(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  if (index === args.length - 1 || args[index + 1].startsWith('--')) {
    throw usageError(`${name} requires a value`);
  }
  return args[index + 1];
}

function printUsage() {
  process.stderr.write(`用法：
  node <sliced-dev-skill-dir>/scripts/dev-plan.mjs init <slug> --title "<title>" [--date YYYY-MM-DD] [--upstream <value>]
  node <sliced-dev-skill-dir>/scripts/dev-plan.mjs validate dev-plans/YYYY-MM-DD-slug
  node <sliced-dev-skill-dir>/scripts/dev-plan.mjs delegate-task dev-plans/YYYY-MM-DD-slug S1 [--refresh-base]
  node <sliced-dev-skill-dir>/scripts/dev-plan.mjs delivery-status dev-plans/YYYY-MM-DD-slug S1
  node <sliced-dev-skill-dir>/scripts/dev-plan.mjs slice-close-check dev-plans/YYYY-MM-DD-slug S1
  node <sliced-dev-skill-dir>/scripts/dev-plan.mjs plan-commit-check dev-plans/YYYY-MM-DD-slug
  node <sliced-dev-skill-dir>/scripts/dev-plan.mjs whole-review-package dev-plans/YYYY-MM-DD-slug
  node <sliced-dev-skill-dir>/scripts/dev-plan.mjs close-check dev-plans/YYYY-MM-DD-slug
  node <sliced-dev-skill-dir>/scripts/dev-plan.mjs show dev-plans/YYYY-MM-DD-slug current|S1
  node <sliced-dev-skill-dir>/scripts/dev-plan.mjs roster dev-plans/YYYY-MM-DD-slug
`);
}

async function main(argv = process.argv.slice(2)) {
  const [command, first, ...rest] = argv;
  if (command === 'init') {
    if (!first) throw usageError('init requires <slug>');
    const known = new Set(['--title', '--date', '--upstream']);
    for (let index = 0; index < rest.length; index += 2) {
      if (!known.has(rest[index]) || index + 1 >= rest.length) throw usageError('invalid init arguments');
    }
    const planRef = await initPlan({
      slug: first,
      title: getArgValue(rest, '--title'),
      date: getArgValue(rest, '--date') ?? formatDate(),
      upstream: getArgValue(rest, '--upstream') ?? '无',
    });
    process.stdout.write(`Created ${planRef}\n`);
    return 0;
  }

  const knownCommands = new Set([
    'validate',
    'delegate-task',
    'delivery-status',
    'slice-close-check',
    'plan-commit-check',
    'whole-review-package',
    'close-check',
    'show',
    'roster',
  ]);
  if (!knownCommands.has(command)) throw usageError(command ? `unknown command: ${command}` : 'command is required');
  const context = await resolvePlanContext(first, { cli: true });

  if (command === 'validate') {
    if (rest.length > 0) throw usageError('validate requires exactly one plan directory');
    const { errors } = await validateContext(context);
    if (errors.length > 0) {
      process.stderr.write(`ERROR:\n${errors.map((item) => `- ${item}`).join('\n')}\n`);
      return 1;
    }
    process.stdout.write('OK: dev plan is valid\n');
    return 0;
  }
  if (command === 'delegate-task') {
    if (rest.length < 1 || rest.length > 2 || (rest.length === 2 && rest[1] !== '--refresh-base')) {
      throw usageError('delegate-task requires one plan directory, one slice id, and optional --refresh-base');
    }
    const result = await delegateTask(context, rest[0], { refreshBase: rest[1] === '--refresh-base' });
    process.stdout.write(`${result.changed ? 'Wrote' : 'Kept'} ${result.taskDir}/task.json revision ${result.task.revision}\n`);
    return 0;
  }
  if (command === 'delivery-status') {
    if (rest.length !== 1) throw usageError('delivery-status requires one plan directory and one slice id');
    process.stdout.write(`${JSON.stringify(await deliveryStatus(context, rest[0]), null, 2)}\n`);
    return 0;
  }
  if (command === 'slice-close-check') {
    if (rest.length !== 1) throw usageError('slice-close-check requires one plan directory and one slice id');
    await sliceCloseCheck(context, rest[0]);
    process.stdout.write(`OK: slice ${rest[0]} is ready for caller checkpoint\n`);
    return 0;
  }
  if (command === 'plan-commit-check') {
    if (rest.length > 0) throw usageError('plan-commit-check requires exactly one plan directory');
    await planCommitCheck(context);
    process.stdout.write('OK: staged durable plan files are ready to commit\n');
    return 0;
  }
  if (command === 'whole-review-package') {
    if (rest.length > 0) throw usageError('whole-review-package requires exactly one plan directory');
    const result = await writeWholeReviewPackage(context);
    process.stdout.write(`Wrote ${result.target}\nreviewPackageHash ${result.hash}\n`);
    return 0;
  }
  if (command === 'close-check') {
    if (rest.length > 0) throw usageError('close-check requires exactly one plan directory');
    await closeCheck(context);
    process.stdout.write('OK: dev plan is ready to close\n');
    return 0;
  }
  if (command === 'show') {
    if (rest.length !== 1) throw usageError('show requires one plan directory and current|S-id');
    process.stdout.write(`${await buildShow(context, rest[0])}\n`);
    return 0;
  }
  if (command === 'roster') {
    if (rest.length > 0) throw usageError('roster requires exactly one plan directory');
    process.stdout.write(`${await buildRoster(context)}\n`);
    return 0;
  }
  return 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      if (error instanceof UsageError) printUsage();
      process.stderr.write(`ERROR: ${error.message}\n`);
      process.exitCode = error instanceof UsageError ? 2 : 1;
    });
}

export const __private__ = {
  formatDate,
  getSection,
  getField,
  parseAssociationItems,
  parseSlices,
  taskIdForSlice,
  canonicalJson,
  sha256,
};
