#!/usr/bin/env node

import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const TASK_SCHEMA = 'deliver-task.task.v1';
const WORKSPACE_SCHEMA = 'deliver-task.workspace.v1';
const EXECUTION_SCHEMA = 'deliver-task.execution.v1';
const CLAIMS_SCHEMA = 'deliver-task.claims.v1';
const DELIVERY_SCHEMA = 'deliver-task.delivery.v1';
const COMMIT_POLICIES = new Set(['required', 'allowed', 'forbidden']);
const RESULT_STATUSES = new Set(['delivered', 'needs-upstream', 'needs-reslice', 'blocked']);
const CLAIM_STATUSES = new Set(['proposed', 'implemented', 'verified', 'blocked', 'waived']);
const ACCEPTANCE_POLICIES = new Set(['required', 'not-required']);
const ACCEPTANCE_RESULTS = new Set(['passed', 'skipped', 'rejected']);
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
const WORKSPACE_KINDS = new Set(['provided', 'git-worktree']);

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

function executionHash(execution) {
  return sha256(canonicalJson(execution));
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

async function readOptionalJson(file, label) {
  let source;
  try {
    source = await fs.readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
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
  if (!isPlainObject(caller)) throw gateError('task.caller must be an object');
  if (caller.kind === 'direct') {
    assertExactObject(caller, ['kind'], [], 'task.caller');
    return;
  }
  if (caller.kind === 'delegated') {
    assertExactObject(caller, ['kind', 'name', 'ref'], [], 'task.caller');
    if (!TASK_ID_RE.test(caller.name || '')) {
      throw gateError('task.caller.name must be a lowercase hyphenated id');
    }
    assertString(caller.ref, 'task.caller.ref');
    return;
  }
  throw gateError('task.caller.kind must be direct or delegated');
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
      'forbiddenPaths',
      'baseCommit',
      'commitPolicy',
      'acceptancePolicy',
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
  assertStringArray(task.forbiddenPaths, 'task.forbiddenPaths');
  task.forbiddenPaths.forEach((item, index) => normalizeRepoPattern(item, `task.forbiddenPaths[${index}]`));
  if (!GIT_OID_RE.test(task.baseCommit || '')) {
    throw gateError('task.baseCommit must be a full Git commit OID');
  }
  const baseCommit = resolveCommit(repoRoot, task.baseCommit, 'task.baseCommit');
  if (baseCommit !== task.baseCommit) {
    throw gateError('task.baseCommit must identify the commit object directly');
  }
  if (!COMMIT_POLICIES.has(task.commitPolicy)) {
    throw gateError(`task.commitPolicy must be one of ${[...COMMIT_POLICIES].join(', ')}`);
  }
  if (!ACCEPTANCE_POLICIES.has(task.acceptancePolicy)) {
    throw gateError(`task.acceptancePolicy must be one of ${[...ACCEPTANCE_POLICIES].join(', ')}`);
  }
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

function workspaceRecordPath(context) {
  return path.join(context.taskDir, 'artifacts', 'workspace.json');
}

async function resolveWorkspaceRoot(candidate) {
  const requested = path.resolve(candidate);
  let stat;
  try {
    stat = await fs.lstat(requested);
  } catch {
    throw gateError(`workspace directory missing: ${candidate}`);
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw gateError(`workspace must be a real directory: ${candidate}`);
  }
  const root = git(requested, ['rev-parse', '--show-toplevel']).trim();
  return fs.realpath(root);
}

function currentBranchRef(root) {
  try {
    return execFileSync('git', ['symbolic-ref', '-q', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || null;
  } catch {
    return null;
  }
}

async function validateWorkspaceRecord(record, task) {
  assertExactObject(
    record,
    ['schemaVersion', 'task', 'kind', 'workspacePath', 'branch', 'baseCommit'],
    [],
    'workspace.json',
  );
  if (record.schemaVersion !== WORKSPACE_SCHEMA) {
    throw gateError(`workspace.schemaVersion must be ${WORKSPACE_SCHEMA}`);
  }
  validateBinding(record.task, task, 'workspace.task');
  if (!WORKSPACE_KINDS.has(record.kind)) {
    throw gateError(`workspace.kind must be one of ${[...WORKSPACE_KINDS].join(', ')}`);
  }
  assertString(record.workspacePath, 'workspace.workspacePath');
  if (!path.isAbsolute(record.workspacePath)) {
    throw gateError('workspace.workspacePath must be absolute');
  }
  if (record.branch !== null) {
    if (typeof record.branch !== 'string' || !/^refs\/heads\/[^\s]+$/.test(record.branch)) {
      throw gateError('workspace.branch must be null or a full refs/heads ref');
    }
  }
  if (record.kind === 'git-worktree' && record.branch === null) {
    throw gateError('git-worktree workspace requires a branch');
  }
  if (record.baseCommit !== task.baseCommit) {
    throw gateError('workspace.baseCommit must equal task.baseCommit');
  }

  const workspaceRoot = await resolveWorkspaceRoot(record.workspacePath);
  if (workspaceRoot !== record.workspacePath) {
    throw gateError(`workspace.workspacePath must be the canonical Git root ${workspaceRoot}`);
  }
  const baseCommit = resolveCommit(workspaceRoot, task.baseCommit, 'task.baseCommit in workspace');
  const headCommit = resolveCommit(workspaceRoot, 'HEAD', 'workspace HEAD');
  if (!isAncestor(workspaceRoot, baseCommit, headCommit)) {
    throw gateError('workspace HEAD must descend from task.baseCommit');
  }
  if (currentBranchRef(workspaceRoot) !== record.branch) {
    throw gateError('workspace branch identity changed');
  }
  return { record, workspaceRoot };
}

async function readWorkspaceContext(context, task) {
  const record = await readOptionalJson(workspaceRecordPath(context), 'artifacts/workspace.json');
  if (record === null) {
    throw gateError('task workspace is not prepared; run prepare-workspace before preflight');
  }
  const { workspaceRoot } = await validateWorkspaceRecord(record, task);
  return {
    ...context,
    repoRoot: workspaceRoot,
    workspace: record,
  };
}

function workspaceBranch(task) {
  return `deliver-task/${task.taskId}-r${task.revision}-${taskHash(task).slice('sha256:'.length, 'sha256:'.length + 12)}`;
}

function gitRefExists(root, reference) {
  try {
    execFileSync('git', ['show-ref', '--verify', '--quiet', reference], {
      cwd: root,
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

function worktreePathForBranch(root, branch) {
  const blocks = git(root, ['worktree', 'list', '--porcelain']).trim().split(/\n\n+/);
  for (const block of blocks) {
    const lines = block.split('\n');
    const worktreeLine = lines.find((line) => line.startsWith('worktree '));
    const branchLine = lines.find((line) => line.startsWith('branch '));
    if (worktreeLine && branchLine === `branch ${branch}`) {
      return worktreeLine.slice('worktree '.length);
    }
  }
  return null;
}

function hasPriorWorkspaceBinding(record, task) {
  if (!isPlainObject(record) || record.schemaVersion !== WORKSPACE_SCHEMA) return false;
  try {
    validateBindingShape(record.task, 'workspace.task');
  } catch {
    return false;
  }
  return record.task.taskId === task.taskId && record.task.revision < task.revision;
}

async function prepareWorkspace(context, task, providedPath) {
  const target = workspaceRecordPath(context);
  let existing = await readOptionalJson(target, 'artifacts/workspace.json');
  if (existing !== null && hasPriorWorkspaceBinding(existing, task)) existing = null;
  if (existing !== null) {
    const { record, workspaceRoot } = await validateWorkspaceRecord(existing, task);
    if (providedPath) {
      const requestedWorkspace = await resolveWorkspaceRoot(providedPath);
      if (requestedWorkspace !== workspaceRoot) {
        throw gateError('prepared workspace does not match --workspace');
      }
    }
    return record;
  }

  let kind;
  let workspacePath;
  let branch;
  if (providedPath) {
    kind = 'provided';
    workspacePath = await resolveWorkspaceRoot(providedPath);
    const headCommit = resolveCommit(workspacePath, 'HEAD', 'provided workspace HEAD');
    if (headCommit !== task.baseCommit) {
      throw gateError('new provided workspace must start exactly at task.baseCommit');
    }
    const dirtyPaths = changedPathsFrom(workspacePath, headCommit)
      .filter((repoPath) => !isInsideTaskDir(repoPath, context));
    if (dirtyPaths.length > 0) {
      throw gateError(`new provided workspace must be clean outside taskDir: ${dirtyPaths.join(', ')}`);
    }
    branch = currentBranchRef(workspacePath);
  } else {
    kind = 'git-worktree';
    const shortBranch = workspaceBranch(task);
    branch = `refs/heads/${shortBranch}`;
    const registeredPath = worktreePathForBranch(context.repoRoot, branch);
    if (registeredPath) {
      workspacePath = await fs.realpath(registeredPath);
      if (workspacePath === context.repoRoot) {
        throw gateError('task branch is checked out in the source workspace and cannot be reused as isolated');
      }
    } else {
      if (gitRefExists(context.repoRoot, branch)) {
        const branchCommit = resolveCommit(context.repoRoot, branch, 'existing task workspace branch');
        if (!isAncestor(context.repoRoot, task.baseCommit, branchCommit)) {
          throw gateError('existing task workspace branch does not descend from task.baseCommit');
        }
      }
      workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), `deliver-task-${task.taskId}-`));
      try {
        git(context.repoRoot, gitRefExists(context.repoRoot, branch)
          ? ['worktree', 'add', '-q', workspacePath, shortBranch]
          : ['worktree', 'add', '-q', '-b', shortBranch, workspacePath, task.baseCommit]);
      } catch (error) {
        await fs.rmdir(workspacePath).catch(() => {});
        throw error;
      }
      workspacePath = await fs.realpath(workspacePath);
    }
  }

  const record = {
    schemaVersion: WORKSPACE_SCHEMA,
    task: bindingForTask(task),
    kind,
    workspacePath,
    branch,
    baseCommit: task.baseCommit,
  };
  await validateWorkspaceRecord(record, task);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await writeJson(target, record);
  return record;
}

async function validateExecution(execution, task, context) {
  assertExactObject(
    execution,
    ['schemaVersion', 'task', 'allowedPaths', 'forbiddenPaths', 'evidenceRefs'],
    [],
    'execution.json',
  );
  if (execution.schemaVersion !== EXECUTION_SCHEMA) {
    throw gateError(`execution.schemaVersion must be ${EXECUTION_SCHEMA}`);
  }
  validateBinding(execution.task, task, 'execution.task');
  assertStringArray(execution.allowedPaths, 'execution.allowedPaths', { nonEmpty: true });
  assertStringArray(execution.forbiddenPaths, 'execution.forbiddenPaths');
  assertStringArray(execution.evidenceRefs, 'execution.evidenceRefs', { nonEmpty: true });
  execution.allowedPaths.forEach((item, index) => normalizeRepoPattern(item, `execution.allowedPaths[${index}]`));
  execution.forbiddenPaths.forEach((item, index) => normalizeRepoPattern(item, `execution.forbiddenPaths[${index}]`));
  for (const [index, reference] of execution.evidenceRefs.entries()) {
    assertAuditRef(reference, `execution.evidenceRefs[${index}]`);
    await resolveEvidenceRef(context, reference, { allowNotApplicable: false });
  }
  return execution;
}

async function readExecution(context, task) {
  const execution = await readJson(path.join(context.taskDir, 'execution.json'), 'execution.json');
  return validateExecution(execution, task, context);
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
  return context.relativeTaskDir !== null
    && (repoPath === context.relativeTaskDir || repoPath.startsWith(`${context.relativeTaskDir}/`));
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

function assertBoundary(paths, task, execution, context, label) {
  for (const repoPath of paths) {
    if (isInsideTaskDir(repoPath, context)) {
      throw gateError(`${label} includes task-owned artifact path ${repoPath}`);
    }
    if (matchesAny(repoPath, task.forbiddenPaths)) {
      throw gateError(`${repoPath} matches task.forbiddenPaths`);
    }
    if (matchesAny(repoPath, execution.forbiddenPaths)) {
      throw gateError(`${repoPath} matches execution.forbiddenPaths`);
    }
    if (!matchesAny(repoPath, execution.allowedPaths)) {
      throw gateError(`${repoPath} is outside execution.allowedPaths`);
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

async function snapshotTarget(context, task, execution) {
  const baseCommit = resolveCommit(context.repoRoot, task.baseCommit, 'task.baseCommit');
  const headCommit = resolveCommit(context.repoRoot, 'HEAD', 'HEAD');
  const currentExecutionHash = executionHash(execution);
  if (task.commitPolicy === 'forbidden' && headCommit !== baseCommit) {
    throw gateError('commitPolicy forbidden requires HEAD to equal baseCommit');
  }

  if (headCommit !== baseCommit) {
    if (!isAncestor(context.repoRoot, baseCommit, headCommit)) {
      throw gateError('task.baseCommit must be an ancestor of HEAD');
    }
    const rangePaths = commitRangePaths(context.repoRoot, baseCommit, headCommit);
    assertBoundary(rangePaths, task, execution, context, 'commit range');
    const dirtyPaths = changedPathsFrom(context.repoRoot, headCommit).filter((item) => !isInsideTaskDir(item, context));
    if (dirtyPaths.length > 0) {
      throw gateError(`committed target has additional worktree changes: ${dirtyPaths.join(', ')}`);
    }
    return { kind: 'commit-range', baseCommit, headCommit, executionHash: currentExecutionHash };
  }

  const changedPaths = changedPathsFrom(context.repoRoot, baseCommit).filter((item) => !isInsideTaskDir(item, context));
  assertBoundary(changedPaths, task, execution, context, 'worktree target');
  if (changedPaths.length === 0) return { kind: 'no-change', baseCommit, executionHash: currentExecutionHash };
  if (task.commitPolicy === 'required') {
    throw gateError('commitPolicy required requires a committed target when code changed');
  }
  return {
    kind: 'worktree',
    baseCommit,
    snapshotHash: await worktreeSnapshot(context.repoRoot, changedPaths),
    executionHash: currentExecutionHash,
  };
}

function validateTargetIdentity(target, label) {
  if (!isPlainObject(target)) throw gateError(`${label} must be an object`);
  if (target.kind === 'commit-range') {
    assertExactObject(target, ['kind', 'baseCommit', 'headCommit', 'executionHash'], [], label);
    if (!GIT_OID_RE.test(target.headCommit || '')) {
      throw gateError(`${label}.headCommit must be a full Git commit OID`);
    }
  } else if (target.kind === 'worktree') {
    assertExactObject(target, ['kind', 'baseCommit', 'snapshotHash', 'executionHash'], [], label);
    if (!SHA256_RE.test(target.snapshotHash || '')) throw gateError(`${label}.snapshotHash must be sha256`);
  } else if (target.kind === 'no-change') {
    assertExactObject(target, ['kind', 'baseCommit', 'executionHash'], [], label);
  } else {
    throw gateError(`${label}.kind must be commit-range, worktree, or no-change`);
  }
  if (!GIT_OID_RE.test(target.baseCommit || '')) {
    throw gateError(`${label}.baseCommit must be a full Git commit OID`);
  }
  if (!SHA256_RE.test(target.executionHash || '')) {
    throw gateError(`${label}.executionHash must be sha256`);
  }
}

function validateTarget(target, task, execution) {
  validateTargetIdentity(target, 'delivery.target');
  if (target.kind === 'commit-range' && task.commitPolicy === 'forbidden') {
    throw gateError('commitPolicy forbidden cannot use a commit-range target');
  }
  if (target.kind === 'worktree' && task.commitPolicy === 'required') {
    throw gateError('commitPolicy required cannot use a worktree target');
  }
  if (target.executionHash !== executionHash(execution)) {
    throw gateError('delivery.target has stale execution binding');
  }
}

function validateEvidenceRefs(evidenceRefs, { delivered }) {
  assertExactObject(
    evidenceRefs,
    ['claims', 'verification', 'generalReview', 'acceptance', 'rulesReview'],
    [],
    'delivery.evidenceRefs',
  );
  for (const field of ['claims', 'verification', 'generalReview', 'rulesReview']) {
    const value = evidenceRefs[field];
    if (delivered) assertString(value, `delivery.evidenceRefs.${field}`);
    else if (value !== null) assertString(value, `delivery.evidenceRefs.${field}`);
  }
  if (evidenceRefs.acceptance !== null) {
    assertString(evidenceRefs.acceptance, 'delivery.evidenceRefs.acceptance');
  }
}

function validateUpstreamRequest(request, result) {
  if (result === 'delivered') {
    if (request !== null) throw gateError('delivered requires upstreamRequest to be null');
    return;
  }
  assertExactObject(request, ['kind', 'summary', 'evidenceRefs'], [], 'delivery.upstreamRequest');
  assertString(request.summary, 'delivery.upstreamRequest.summary');
  assertStringArray(request.evidenceRefs, 'delivery.upstreamRequest.evidenceRefs', { nonEmpty: true });
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

function validateDelivery(delivery, task, execution) {
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
  if (delivery.target !== null) {
    if (!execution) throw gateError('delivery.target requires execution.json');
    validateTarget(delivery.target, task, execution);
  }
  if (delivery.result === 'delivered' && delivery.target === null) {
    throw gateError('delivered requires a target');
  }
  validateEvidenceRefs(delivery.evidenceRefs, { delivered: delivery.result === 'delivered' });
  assertStringArray(delivery.residualRiskRefs, 'delivery.residualRiskRefs');
  validateUpstreamRequest(delivery.upstreamRequest, delivery.result);
  return delivery;
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

async function resolveEvidenceRef(context, reference, { allowNotApplicable = true } = {}) {
  if (reference === 'not-applicable') {
    if (!allowNotApplicable) throw gateError('evidence ref not-applicable is not a task-owned evidence ref');
    return { source: '', section: '' };
  }
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
    const lines = source.split(/\r?\n/);
    const heading = new RegExp(`^(#{1,6})\\s+${escaped}(?:[：:].*)?$`);
    const start = lines.findIndex((line) => heading.test(line));
    if (start === -1) throw gateError(`evidence ref missing anchor: ${reference}`);
    const level = heading.exec(lines[start])[1].length;
    let end = lines.length;
    for (let index = start + 1; index < lines.length; index += 1) {
      const nextHeading = /^(#{1,6})\s+/.exec(lines[index]);
      if (nextHeading && nextHeading[1].length <= level) {
        end = index;
        break;
      }
    }
    return { source, section: lines.slice(start + 1, end).join('\n') };
  }
  return { source, section: source };
}

function protocolBlocks(source, blockName, label) {
  const opening = `\`\`\`${blockName}`;
  const lines = source.split(/\r?\n/);
  const blocks = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].trim() !== opening) continue;
    const end = lines.findIndex((line, candidate) => candidate > index && line.trim() === '\`\`\`');
    if (end === -1) throw gateError(`${label} has unterminated ${blockName} block`);
    const payload = lines.slice(index + 1, end).join('\n').trim();
    try {
      blocks.push(JSON.parse(payload));
    } catch (error) {
      throw gateError(`${label} ${blockName} block must be valid JSON: ${error.message}`);
    }
    index = end;
  }
  return blocks;
}

function singleProtocolBlock(source, blockName, label) {
  const blocks = protocolBlocks(source, blockName, label);
  if (blocks.length !== 1) {
    throw gateError(`${label} must contain exactly one ${blockName} block`);
  }
  return blocks[0];
}

function assertAuditRef(reference, label) {
  if (!/^audits\.md#A[1-9][0-9]*$/.test(reference || '')) {
    throw gateError(`${label} must reference an audits.md A entry`);
  }
}

function validateBindingShape(binding, label) {
  assertExactObject(binding, ['taskId', 'revision', 'taskHash'], [], label);
  assertString(binding.taskId, `${label}.taskId`);
  if (!Number.isSafeInteger(binding.revision) || binding.revision < 1) {
    throw gateError(`${label}.revision must be a positive integer`);
  }
  if (!SHA256_RE.test(binding.taskHash || '')) throw gateError(`${label}.taskHash must be sha256`);
}

function sameTaskBinding(binding, task) {
  return canonicalJson(binding) === canonicalJson(bindingForTask(task));
}

function validateGeneralBinding(record, task, execution, target, label) {
  assertExactObject(record, ['task', 'executionHash', 'target'], [], label);
  validateBinding(record.task, task, `${label}.task`);
  if (record.executionHash !== executionHash(execution)) {
    throw gateError(`${label} has stale execution binding`);
  }
  if (canonicalJson(record.target) !== canonicalJson(target)) {
    throw gateError(`${label} has stale target binding`);
  }
}

function validateAcceptanceShape(record, label) {
  assertExactObject(record, ['task', 'target', 'status', 'evidenceRefs'], [], label);
  validateBindingShape(record.task, `${label}.task`);
  validateTargetIdentity(record.target, `${label}.target`);
  if (!ACCEPTANCE_RESULTS.has(record.status)) {
    throw gateError(`${label}.status must be one of ${[...ACCEPTANCE_RESULTS].join(', ')}`);
  }
  assertStringArray(record.evidenceRefs, `${label}.evidenceRefs`, { nonEmpty: true });
  return record;
}

async function validateDeliveredBindings(context, task, execution, delivery) {
  const generalRef = delivery.evidenceRefs.generalReview;
  assertAuditRef(generalRef, 'delivery.evidenceRefs.generalReview');
  const generalEvidence = await resolveEvidenceRef(context, generalRef, { allowNotApplicable: false });
  const generalBinding = singleProtocolBlock(
    generalEvidence.section,
    'deliver-task-binding',
    'General Review evidence',
  );
  validateGeneralBinding(generalBinding, task, execution, delivery.target, 'General Review binding');

  const acceptanceRef = delivery.evidenceRefs.acceptance;
  if (task.acceptancePolicy === 'not-required') {
    if (acceptanceRef !== null) {
      throw gateError('acceptancePolicy not-required requires delivery.evidenceRefs.acceptance to be null');
    }
    return;
  }
  if (acceptanceRef === null) {
    throw gateError('acceptancePolicy required requires passed/skipped acceptance evidence');
  }
  assertAuditRef(acceptanceRef, 'delivery.evidenceRefs.acceptance');
  const acceptanceEvidence = await resolveEvidenceRef(context, acceptanceRef, { allowNotApplicable: false });
  const acceptance = validateAcceptanceShape(
    singleProtocolBlock(
      acceptanceEvidence.section,
      'deliver-task-acceptance',
      'acceptance evidence',
    ),
    'acceptance evidence',
  );
  validateBinding(acceptance.task, task, 'acceptance evidence.task');
  if (canonicalJson(acceptance.target) !== canonicalJson(delivery.target)) {
    throw gateError('acceptance evidence has stale target binding');
  }
  if (!new Set(['passed', 'skipped']).has(acceptance.status)) {
    throw gateError(`acceptancePolicy required cannot deliver with acceptance ${acceptance.status}`);
  }
  for (const reference of acceptance.evidenceRefs) {
    await resolveEvidenceRef(context, reference, { allowNotApplicable: false });
  }

  const audits = await readJsonOrText(path.join(context.taskDir, 'audits.md'), 'audits.md');
  const records = protocolBlocks(audits, 'deliver-task-acceptance', 'audits.md')
    .map((record, index) => validateAcceptanceShape(record, `audits.md acceptance[${index}]`));
  for (const record of records) {
    if (!sameTaskBinding(record.task, task)) continue;
    for (const reference of record.evidenceRefs) {
      await resolveEvidenceRef(context, reference, { allowNotApplicable: false });
    }
    if (record.status === 'rejected' && canonicalJson(record.target) === canonicalJson(delivery.target)) {
      throw gateError('target has rejected acceptance and cannot be delivered');
    }
  }
}

async function readJsonOrText(file, label) {
  try {
    return await fs.readFile(file, 'utf8');
  } catch (error) {
    throw gateError(`${label} missing or unreadable: ${error.message}`);
  }
}

async function readDelivery(context, task) {
  const raw = await readJson(path.join(context.taskDir, 'delivery.json'), 'delivery.json');
  const execution = raw?.target != null ? await readExecution(context, task) : null;
  const delivery = validateDelivery(raw, task, execution);
  if (delivery.result === 'delivered') {
    await validateDeliveredBindings(context, task, execution, delivery);
  } else {
    for (const reference of delivery.upstreamRequest.evidenceRefs) {
      await resolveEvidenceRef(context, reference, { allowNotApplicable: false });
    }
  }
  return { delivery, execution };
}

async function closeCheck(context, task, execution, delivery) {
  if (delivery.result !== 'delivered') throw gateError(`close-check requires delivered, got ${delivery.result}`);
  const claims = validateClaims(
    await readJson(path.join(context.taskDir, 'claims.json'), 'claims.json'),
    task,
    { requireClosed: true },
  );
  const references = new Set([
    ...Object.values(delivery.evidenceRefs).filter((reference) => reference !== null),
    ...delivery.residualRiskRefs,
    ...claims.claims.flatMap((claim) => claim.evidenceRefs),
  ]);
  for (const reference of references) await resolveEvidenceRef(context, reference);

  const currentTarget = await snapshotTarget(context, task, execution);
  if (canonicalJson(currentTarget) !== canonicalJson(delivery.target)) {
    throw gateError(
      `delivery target is stale; current ${currentTarget.kind} target changed or snapshotHash no longer matches`,
    );
  }
}

function printUsage() {
  process.stderr.write(
    '用法：deliver-task.mjs <validate-task|task-hash|prepare-workspace|init|validate-execution|snapshot-target|validate-result|close-check> <taskDir> [--workspace <path>]\n',
  );
}

async function main() {
  const [command, taskDirArg, ...extra] = process.argv.slice(2);
  if (!command || !taskDirArg) throw usageError('invalid arguments');
  const sourceContext = await resolveContext(taskDirArg);
  const task = await readTask(sourceContext);

  if (command === 'validate-task') {
    if (extra.length > 0) throw usageError('validate-task does not accept extra arguments');
    process.stdout.write('task.json: passed\n');
    return;
  }
  if (command === 'task-hash') {
    if (extra.length > 0) throw usageError('task-hash does not accept extra arguments');
    process.stdout.write(`${taskHash(task)}\n`);
    return;
  }
  if (command === 'prepare-workspace') {
    if (extra.length !== 0 && !(extra.length === 2 && extra[0] === '--workspace')) {
      throw usageError('prepare-workspace accepts only optional --workspace <path>');
    }
    const record = await prepareWorkspace(sourceContext, task, extra[1]);
    process.stdout.write(`${JSON.stringify(record, null, 2)}\n`);
    return;
  }
  if (extra.length > 0) throw usageError(`${command} does not accept extra arguments`);
  if (!new Set(['init', 'validate-execution', 'snapshot-target', 'validate-result', 'close-check']).has(command)) {
    throw usageError(`unknown command: ${command}`);
  }
  if (command === 'init') {
    await prepareWorkspace(sourceContext, task);
  }
  const context = await readWorkspaceContext(sourceContext, task);
  if (command === 'init') {
    await initTask(context, task);
    process.stdout.write(`${context.taskDir}: initialized\n`);
    return;
  }
  if (command === 'validate-execution') {
    const execution = await readExecution(context, task);
    process.stdout.write(`execution.json: passed ${executionHash(execution)}\n`);
    return;
  }
  if (command === 'snapshot-target') {
    const execution = await readExecution(context, task);
    process.stdout.write(`${JSON.stringify(await snapshotTarget(context, task, execution), null, 2)}\n`);
    return;
  }
  if (command === 'validate-result') {
    await readDelivery(context, task);
    process.stdout.write('delivery.json: passed\n');
    return;
  }
  if (command === 'close-check') {
    const { delivery, execution } = await readDelivery(context, task);
    await closeCheck(context, task, execution, delivery);
    process.stdout.write('deliver-task close-check: passed\n');
    return;
  }
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
