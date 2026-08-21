#!/usr/bin/env node

import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const TASK_SCHEMA = 'deliver-task.task.v1';
const CLAIMS_SCHEMA = 'deliver-task.claims.v1';
const DELIVERY_SCHEMA = 'deliver-task.delivery.v1';
const COMMIT_POLICIES = new Set(['required', 'allowed', 'forbidden']);
const RESULT_STATUSES = new Set(['delivered', 'needs-upstream', 'needs-reslice', 'blocked']);
const CLAIM_STATUSES = new Set(['proposed', 'implemented', 'verified', 'blocked', 'waived']);
const ACCEPTANCE_STATUSES = new Set(['not-required', 'pending', 'passed', 'skipped']);
const UPSTREAM_KINDS = new Set([
  'target-change',
  'acceptance-change',
  'contract-change',
  'authorization-change',
  'user-acceptance',
]);
const SHA256_RE = /^sha256:[0-9a-f]{64}$/;
const TASK_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const GIT_OID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

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

function assertExactObject(value, required, optional, label) {
  if (!isPlainObject(value)) throw gateError(`${label} must be an object`);
  const allowed = new Set([...required, ...optional]);
  const missing = required.filter((field) => !(field in value));
  const extra = Object.keys(value).filter((field) => !allowed.has(field));
  if (missing.length > 0) throw gateError(`${label} missing fields: ${missing.join(', ')}`);
  if (extra.length > 0) throw gateError(`${label} has unsupported fields: ${extra.join(', ')}`);
}

function assertString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw gateError(`${label} must be a non-empty string`);
}

function assertStringArray(value, label, { nonEmpty = false } = {}) {
  if (!Array.isArray(value)) throw gateError(`${label} must be an array`);
  if (nonEmpty && value.length === 0) throw gateError(`${label} must not be empty`);
  value.forEach((item, index) => assertString(item, `${label}[${index}]`));
  if (new Set(value).size !== value.length) throw gateError(`${label} must not contain duplicates`);
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

function taskHash(task) {
  return sha256(canonicalJson(task));
}

function git(root, args, options = {}) {
  try {
    return execFileSync('git', args, {
      cwd: root,
      encoding: options.encoding ?? 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const detail = String(error.stderr || error.stdout || error.message || '').trim();
    throw gateError(`git ${args.join(' ')} failed${detail ? `: ${detail}` : ''}`);
  }
}

function resolveCommit(root, revision, label) {
  let commit;
  try {
    commit = git(root, ['rev-parse', '--verify', '--end-of-options', `${revision}^{commit}`]).trim();
  } catch {
    throw gateError(`${label} is not a resolvable Git commit`);
  }
  if (!GIT_OID_RE.test(commit)) throw gateError(`${label} did not resolve to a normalized Git commit`);
  return commit;
}

function normalizeRepoPattern(value, label) {
  assertString(value, label);
  if (value.includes('\\')) throw gateError(`${label} must use forward slashes`);
  if (path.posix.isAbsolute(value)) throw gateError(`${label} must be repository-relative`);
  const normalized = path.posix.normalize(value);
  if (normalized === '..' || normalized.startsWith('../') || normalized !== value) {
    throw gateError(`${label} must be a normalized repository-relative path or glob`);
  }
  return normalized;
}

function globToRegExp(pattern) {
  let source = '';
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === '*' && pattern[index + 1] === '*') {
      source += '.*';
      index += 1;
    } else if (character === '*') {
      source += '[^/]*';
    } else if (character === '?') {
      source += '[^/]';
    } else {
      source += character.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
    }
  }
  return new RegExp(`^${source}$`);
}

function matchesAny(repoPath, patterns) {
  return patterns.some((pattern) => globToRegExp(pattern).test(repoPath));
}

async function readJson(file, label) {
  let source;
  try {
    source = await fs.readFile(file, 'utf8');
  } catch (error) {
    throw gateError(`${label} missing or unreadable: ${error.message}`);
  }
  try {
    return JSON.parse(source);
  } catch (error) {
    throw gateError(`${label} must be valid JSON: ${error.message}`);
  }
}

async function writeJson(file, value) {
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function resolveContext(taskDirArg) {
  if (!taskDirArg) throw usageError('task directory is required');
  const taskDir = path.resolve(taskDirArg);
  let taskDirStat;
  try {
    taskDirStat = await fs.lstat(taskDir);
  } catch (error) {
    throw usageError(`task directory missing: ${taskDirArg}`);
  }
  if (!taskDirStat.isDirectory() || taskDirStat.isSymbolicLink()) {
    throw usageError(`task directory must be a real directory: ${taskDirArg}`);
  }
  const repoRoot = git(taskDir, ['rev-parse', '--show-toplevel']).trim();
  const canonicalRoot = await fs.realpath(repoRoot);
  const canonicalTaskDir = await fs.realpath(taskDir);
  const relativeTaskDir = path.relative(canonicalRoot, canonicalTaskDir).split(path.sep).join('/');
  if (!relativeTaskDir || relativeTaskDir.startsWith('../') || path.isAbsolute(relativeTaskDir)) {
    throw usageError('task directory must be inside one Git worktree');
  }
  return { repoRoot: canonicalRoot, taskDir: canonicalTaskDir, relativeTaskDir };
}

function validateCaller(caller) {
  assertExactObject(caller, ['kind'], ['ref'], 'task.caller');
  if (!new Set(['direct', 'sliced-dev']).has(caller.kind)) {
    throw gateError('task.caller.kind must be direct or sliced-dev');
  }
  if (caller.kind === 'sliced-dev') assertString(caller.ref, 'task.caller.ref');
  if (caller.ref !== undefined) assertString(caller.ref, 'task.caller.ref');
}

function validateUpstreamAcceptance(acceptance) {
  assertExactObject(acceptance, ['status'], ['evidenceRef'], 'task.upstreamAcceptance');
  if (!ACCEPTANCE_STATUSES.has(acceptance.status)) {
    throw gateError(`task.upstreamAcceptance.status must be one of ${[...ACCEPTANCE_STATUSES].join(', ')}`);
  }
  if (acceptance.evidenceRef !== undefined) assertString(acceptance.evidenceRef, 'task.upstreamAcceptance.evidenceRef');
  if (new Set(['passed', 'skipped']).has(acceptance.status) && acceptance.evidenceRef === undefined) {
    throw gateError(`task.upstreamAcceptance ${acceptance.status} requires evidenceRef`);
  }
}

function validateTask(task, repoRoot) {
  assertExactObject(
    task,
    [
      'schemaVersion',
      'taskId',
      'revision',
      'caller',
      'objective',
      'acceptanceCriteria',
      'constraints',
      'nonGoals',
      'allowedPaths',
      'forbiddenPaths',
      'baseCommit',
      'commitPolicy',
      'upstreamAcceptance',
    ],
    [],
    'task.json',
  );
  if (task.schemaVersion !== TASK_SCHEMA) throw gateError(`task.schemaVersion must be ${TASK_SCHEMA}`);
  if (!TASK_ID_RE.test(task.taskId || '')) throw gateError('task.taskId must be a lowercase hyphenated slug');
  if (!Number.isSafeInteger(task.revision) || task.revision < 1) {
    throw gateError('task.revision must be a positive integer');
  }
  validateCaller(task.caller);
  assertString(task.objective, 'task.objective');
  assertStringArray(task.acceptanceCriteria, 'task.acceptanceCriteria', { nonEmpty: true });
  assertStringArray(task.constraints, 'task.constraints');
  assertStringArray(task.nonGoals, 'task.nonGoals');
  assertStringArray(task.allowedPaths, 'task.allowedPaths', { nonEmpty: true });
  assertStringArray(task.forbiddenPaths, 'task.forbiddenPaths');
  task.allowedPaths.forEach((item, index) => normalizeRepoPattern(item, `task.allowedPaths[${index}]`));
  task.forbiddenPaths.forEach((item, index) => normalizeRepoPattern(item, `task.forbiddenPaths[${index}]`));
  resolveCommit(repoRoot, task.baseCommit, 'task.baseCommit');
  if (!COMMIT_POLICIES.has(task.commitPolicy)) {
    throw gateError(`task.commitPolicy must be one of ${[...COMMIT_POLICIES].join(', ')}`);
  }
  validateUpstreamAcceptance(task.upstreamAcceptance);
  return task;
}

async function readTask(context) {
  const task = await readJson(path.join(context.taskDir, 'task.json'), 'task.json');
  return validateTask(task, context.repoRoot);
}

function bindingForTask(task) {
  return {
    taskId: task.taskId,
    revision: task.revision,
    taskHash: taskHash(task),
  };
}

function validateBinding(binding, task, label) {
  assertExactObject(binding, ['taskId', 'revision', 'taskHash'], [], label);
  const expected = bindingForTask(task);
  if (
    binding.taskId !== expected.taskId
    || binding.revision !== expected.revision
    || binding.taskHash !== expected.taskHash
  ) {
    throw gateError(`${label} has stale task binding; expected ${expected.taskId}@${expected.revision} ${expected.taskHash}`);
  }
}

async function initTask(context, task) {
  await fs.mkdir(path.join(context.taskDir, 'artifacts'), { recursive: true });
  const gitignore = path.join(context.taskDir, '.gitignore');
  try {
    await fs.access(gitignore);
  } catch {
    await fs.writeFile(gitignore, '/artifacts/\n');
  }

  const claimsFile = path.join(context.taskDir, 'claims.json');
  try {
    await fs.access(claimsFile);
  } catch {
    await writeJson(claimsFile, {
      schemaVersion: CLAIMS_SCHEMA,
      task: bindingForTask(task),
      claims: [],
    });
  }

  const auditsFile = path.join(context.taskDir, 'audits.md');
  try {
    await fs.access(auditsFile);
  } catch {
    await fs.writeFile(
      auditsFile,
      `# 单任务审计\n\n- taskId：${task.taskId}\n- revision：${task.revision}\n- taskHash：${taskHash(task)}\n`,
    );
  }
}

function parseNullPaths(buffer) {
  return buffer
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .map((item) => item.split(path.sep).join('/'));
}

function isInsideTaskDir(repoPath, context) {
  return repoPath === context.relativeTaskDir || repoPath.startsWith(`${context.relativeTaskDir}/`);
}

function changedPathsFrom(root, revision) {
  const tracked = parseNullPaths(git(root, ['diff', '--name-only', '-z', revision, '--'], { encoding: 'buffer' }));
  const untracked = parseNullPaths(git(root, ['ls-files', '--others', '--exclude-standard', '-z'], { encoding: 'buffer' }));
  return [...new Set([...tracked, ...untracked])].sort();
}

function commitRangePaths(root, baseCommit, headCommit) {
  return parseNullPaths(
    git(root, ['diff', '--name-only', '-z', `${baseCommit}..${headCommit}`, '--'], { encoding: 'buffer' }),
  ).sort();
}

function assertBoundary(paths, task, context, label) {
  for (const repoPath of paths) {
    if (isInsideTaskDir(repoPath, context)) {
      throw gateError(`${label} includes task-owned artifact path ${repoPath}`);
    }
    if (matchesAny(repoPath, task.forbiddenPaths)) {
      throw gateError(`${repoPath} matches task.forbiddenPaths`);
    }
    if (!matchesAny(repoPath, task.allowedPaths)) {
      throw gateError(`${repoPath} is outside task.allowedPaths`);
    }
  }
}

async function worktreeSnapshot(root, paths) {
  const entries = [];
  for (const repoPath of paths) {
    const absolute = path.join(root, ...repoPath.split('/'));
    let stat;
    try {
      stat = await fs.lstat(absolute);
    } catch (error) {
      if (error.code === 'ENOENT') {
        entries.push({ path: repoPath, mode: 'deleted', contentHash: null });
        continue;
      }
      throw error;
    }
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw gateError(`worktree target only accepts regular files: ${repoPath}`);
    }
    const content = await fs.readFile(absolute);
    entries.push({
      path: repoPath,
      mode: stat.mode & 0o111 ? '100755' : '100644',
      contentHash: sha256(content),
    });
  }
  return sha256(canonicalJson(entries));
}

function isAncestor(root, ancestor, descendant) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], {
      cwd: root,
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

async function snapshotTarget(context, task) {
  const baseCommit = resolveCommit(context.repoRoot, task.baseCommit, 'task.baseCommit');
  const headCommit = resolveCommit(context.repoRoot, 'HEAD', 'HEAD');
  if (task.commitPolicy === 'forbidden' && headCommit !== baseCommit) {
    throw gateError('commitPolicy forbidden requires HEAD to equal baseCommit');
  }

  if (headCommit !== baseCommit) {
    if (!isAncestor(context.repoRoot, baseCommit, headCommit)) {
      throw gateError('task.baseCommit must be an ancestor of HEAD');
    }
    const rangePaths = commitRangePaths(context.repoRoot, baseCommit, headCommit);
    assertBoundary(rangePaths, task, context, 'commit range');
    const dirtyPaths = changedPathsFrom(context.repoRoot, headCommit).filter((item) => !isInsideTaskDir(item, context));
    if (dirtyPaths.length > 0) {
      throw gateError(`committed target has additional worktree changes: ${dirtyPaths.join(', ')}`);
    }
    return { kind: 'commit-range', baseCommit, headCommit };
  }

  const changedPaths = changedPathsFrom(context.repoRoot, baseCommit).filter((item) => !isInsideTaskDir(item, context));
  assertBoundary(changedPaths, task, context, 'worktree target');
  if (changedPaths.length === 0) return { kind: 'no-change', baseCommit };
  if (task.commitPolicy === 'required') {
    throw gateError('commitPolicy required requires a committed target when code changed');
  }
  return {
    kind: 'worktree',
    baseCommit,
    snapshotHash: await worktreeSnapshot(context.repoRoot, changedPaths),
  };
}

function validateTarget(target, task) {
  if (!isPlainObject(target)) throw gateError('delivery.target must be an object');
  if (target.kind === 'commit-range') {
    assertExactObject(target, ['kind', 'baseCommit', 'headCommit'], [], 'delivery.target');
    if (task.commitPolicy === 'forbidden') throw gateError('commitPolicy forbidden cannot use a commit-range target');
    return;
  }
  if (target.kind === 'worktree') {
    assertExactObject(target, ['kind', 'baseCommit', 'snapshotHash'], [], 'delivery.target');
    if (task.commitPolicy === 'required') throw gateError('commitPolicy required cannot use a worktree target');
    if (!SHA256_RE.test(target.snapshotHash || '')) throw gateError('delivery.target.snapshotHash must be sha256');
    return;
  }
  if (target.kind === 'no-change') {
    assertExactObject(target, ['kind', 'baseCommit'], [], 'delivery.target');
    return;
  }
  throw gateError('delivery.target.kind must be commit-range, worktree, or no-change');
}

function validateEvidenceRefs(evidenceRefs, { delivered }) {
  assertExactObject(
    evidenceRefs,
    ['claims', 'verification', 'generalReview', 'rulesReview'],
    [],
    'delivery.evidenceRefs',
  );
  for (const field of ['claims', 'verification', 'generalReview', 'rulesReview']) {
    const value = evidenceRefs[field];
    if (delivered) assertString(value, `delivery.evidenceRefs.${field}`);
    else if (value !== null) assertString(value, `delivery.evidenceRefs.${field}`);
  }
}

function validateUpstreamRequest(request, result) {
  if (result === 'delivered') {
    if (request !== null) throw gateError('delivered requires upstreamRequest to be null');
    return;
  }
  assertExactObject(request, ['kind', 'summary', 'evidenceRefs'], [], 'delivery.upstreamRequest');
  assertString(request.summary, 'delivery.upstreamRequest.summary');
  assertStringArray(request.evidenceRefs, 'delivery.upstreamRequest.evidenceRefs');
  if (result === 'needs-reslice' && request.kind !== 'reslice') {
    throw gateError('needs-reslice requires upstreamRequest.kind reslice');
  }
  if (result === 'needs-upstream' && !UPSTREAM_KINDS.has(request.kind)) {
    throw gateError(`needs-upstream requires one of ${[...UPSTREAM_KINDS].join(', ')}`);
  }
  if (result === 'blocked' && request.kind !== 'blocker') {
    throw gateError('blocked requires upstreamRequest.kind blocker');
  }
}

function validateDelivery(delivery, task) {
  assertExactObject(
    delivery,
    [
      'schemaVersion',
      'task',
      'result',
      'target',
      'evidenceRefs',
      'residualRiskRefs',
      'upstreamRequest',
    ],
    [],
    'delivery.json',
  );
  if (delivery.schemaVersion !== DELIVERY_SCHEMA) {
    throw gateError(`delivery.schemaVersion must be ${DELIVERY_SCHEMA}`);
  }
  validateBinding(delivery.task, task, 'delivery.task');
  if (!RESULT_STATUSES.has(delivery.result)) {
    throw gateError(`delivery.result must be one of ${[...RESULT_STATUSES].join(', ')}`);
  }
  if (delivery.target !== null) validateTarget(delivery.target, task);
  if (delivery.result === 'delivered' && delivery.target === null) {
    throw gateError('delivered requires a target');
  }
  validateEvidenceRefs(delivery.evidenceRefs, { delivered: delivery.result === 'delivered' });
  assertStringArray(delivery.residualRiskRefs, 'delivery.residualRiskRefs');
  validateUpstreamRequest(delivery.upstreamRequest, delivery.result);
  return delivery;
}

async function readDelivery(context, task) {
  const delivery = await readJson(path.join(context.taskDir, 'delivery.json'), 'delivery.json');
  return validateDelivery(delivery, task);
}

function validateClaims(claims, task, { requireClosed = false } = {}) {
  assertExactObject(claims, ['schemaVersion', 'task', 'claims'], [], 'claims.json');
  if (claims.schemaVersion !== CLAIMS_SCHEMA) throw gateError(`claims.schemaVersion must be ${CLAIMS_SCHEMA}`);
  validateBinding(claims.task, task, 'claims.task');
  if (!Array.isArray(claims.claims)) throw gateError('claims.claims must be an array');
  const ids = new Set();
  for (const [index, claim] of claims.claims.entries()) {
    const label = `claims.claims[${index}]`;
    assertExactObject(claim, ['claimId', 'statement', 'status', 'evidenceRefs'], [], label);
    if (!/^C[1-9][0-9]*$/.test(claim.claimId || '')) throw gateError(`${label}.claimId must match C<positive integer>`);
    if (ids.has(claim.claimId)) throw gateError(`duplicate claimId ${claim.claimId}`);
    ids.add(claim.claimId);
    assertString(claim.statement, `${label}.statement`);
    if (!CLAIM_STATUSES.has(claim.status)) {
      throw gateError(`${label}.status must be one of ${[...CLAIM_STATUSES].join(', ')}`);
    }
    assertStringArray(claim.evidenceRefs, `${label}.evidenceRefs`);
    if (new Set(['verified', 'waived']).has(claim.status) && claim.evidenceRefs.length === 0) {
      throw gateError(`${label} ${claim.status} requires evidenceRefs`);
    }
  }
  if (requireClosed) {
    if (claims.claims.length === 0) throw gateError('delivered requires at least one claim');
    const open = claims.claims.filter((claim) => !new Set(['verified', 'waived']).has(claim.status));
    if (open.length > 0) {
      throw gateError(`delivered claims must be verified or waived: ${open.map((claim) => claim.claimId).join(', ')}`);
    }
  }
  return claims;
}

async function resolveEvidenceRef(context, reference) {
  if (reference === 'not-applicable') return;
  assertString(reference, 'evidence ref');
  const [relativeFile, anchor, ...extra] = reference.split('#');
  if (extra.length > 0 || !relativeFile) throw gateError(`invalid evidence ref: ${reference}`);
  const normalized = normalizeRepoPattern(relativeFile, `evidence ref ${reference}`);
  const target = path.resolve(context.taskDir, ...normalized.split('/'));
  const relative = path.relative(context.taskDir, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw gateError(`evidence ref escapes task directory: ${reference}`);
  }
  let source;
  try {
    source = await fs.readFile(target, 'utf8');
  } catch {
    throw gateError(`evidence ref missing: ${reference}`);
  }
  if (anchor) {
    const escaped = anchor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const heading = new RegExp(`^#{1,6}\\s+${escaped}(?:[：:].*)?$`, 'm');
    if (!heading.test(source)) throw gateError(`evidence ref missing anchor: ${reference}`);
  }
}

async function closeCheck(context, task, delivery) {
  if (delivery.result !== 'delivered') throw gateError(`close-check requires delivered, got ${delivery.result}`);
  const claims = validateClaims(
    await readJson(path.join(context.taskDir, 'claims.json'), 'claims.json'),
    task,
    { requireClosed: true },
  );
  const references = new Set([
    ...Object.values(delivery.evidenceRefs),
    ...delivery.residualRiskRefs,
    ...claims.claims.flatMap((claim) => claim.evidenceRefs),
  ]);
  for (const reference of references) await resolveEvidenceRef(context, reference);

  const currentTarget = await snapshotTarget(context, task);
  if (canonicalJson(currentTarget) !== canonicalJson(delivery.target)) {
    throw gateError(
      `delivery target is stale; current ${currentTarget.kind} target changed or snapshotHash no longer matches`,
    );
  }
}

function printUsage() {
  process.stderr.write(
    '用法：deliver-task.mjs <init|validate-task|task-hash|snapshot-target|validate-result|close-check> <taskDir>\n',
  );
}

async function main() {
  const [command, taskDirArg, ...extra] = process.argv.slice(2);
  if (!command || !taskDirArg || extra.length > 0) throw usageError('invalid arguments');
  const context = await resolveContext(taskDirArg);
  const task = await readTask(context);

  if (command === 'validate-task') {
    process.stdout.write('task.json: passed\n');
    return;
  }
  if (command === 'task-hash') {
    process.stdout.write(`${taskHash(task)}\n`);
    return;
  }
  if (command === 'init') {
    await initTask(context, task);
    process.stdout.write(`${context.taskDir}: initialized\n`);
    return;
  }
  if (command === 'snapshot-target') {
    process.stdout.write(`${JSON.stringify(await snapshotTarget(context, task), null, 2)}\n`);
    return;
  }
  if (command === 'validate-result') {
    await readDelivery(context, task);
    process.stdout.write('delivery.json: passed\n');
    return;
  }
  if (command === 'close-check') {
    const delivery = await readDelivery(context, task);
    await closeCheck(context, task, delivery);
    process.stdout.write('deliver-task close-check: passed\n');
    return;
  }
  throw usageError(`unknown command: ${command}`);
}

main().catch((error) => {
  if (error instanceof UsageError) {
    printUsage();
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
    return;
  }
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
