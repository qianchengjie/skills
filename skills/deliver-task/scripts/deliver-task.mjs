#!/usr/bin/env node

import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const TASK_SCHEMA = 'deliver-task.task.v1';
const WORKSPACE_SCHEMA = 'deliver-task.workspace.v1';
const EXECUTION_SCHEMA = 'deliver-task.execution.v1';
const COMMIT_POLICIES = new Set(['required', 'allowed', 'forbidden']);
const ACCEPTANCE_POLICIES = new Set(['required', 'not-required']);
const RULES_REVIEW_POLICIES = new Set(['required', 'not-required']);
const INITIAL_REPAIR_POLICIES = new Set(['approval-required', 'auto']);
const REVISION_TRANSACTION_NAME = '.revision-transaction';
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
  const semanticBoundary = { ...execution };
  delete semanticBoundary.evidenceRefs;
  return sha256(canonicalJson(semanticBoundary));
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

async function readText(file, label) {
  try {
    return await fs.readFile(file, 'utf8');
  } catch (error) {
    throw gateError(`${label} missing or unreadable: ${error.message}`);
  }
}

function assertAuditRef(reference, label) {
  if (!/^audits\.md#A[1-9][0-9]*$/.test(reference || '')) {
    throw gateError(`${label} must reference an audits.md A entry`);
  }
}

async function resolveEvidenceRef(context, reference) {
  assertString(reference, 'evidence ref');
  const [relativeFile, anchor, ...extra] = reference.split('#');
  if (extra.length > 0 || !relativeFile) throw gateError(`invalid evidence ref: ${reference}`);
  const normalized = normalizeRepoPattern(relativeFile, `evidence ref ${reference}`);
  const target = path.resolve(context.taskDir, ...normalized.split('/'));
  const relative = path.relative(context.taskDir, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw gateError(`evidence ref escapes task directory: ${reference}`);
  }
  const source = await readText(target, `evidence ref ${reference}`);
  if (!anchor) return source;

  const escaped = anchor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const lines = source.split(/\r?\n/);
  const heading = new RegExp(`^(#{1,6})\\s+${escaped}(?:[：:].*)?$`);
  if (!lines.some((line) => heading.test(line))) {
    throw gateError(`evidence ref missing anchor: ${reference}`);
  }
  return source;
}

async function writeJson(file, value) {
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function optionalLstat(target) {
  try {
    return await fs.lstat(target);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function replaceFileFromSnapshot(snapshotPath, destinationPath) {
  const restoreDir = await fs.mkdtemp(
    path.join(path.dirname(destinationPath), '.revision-restore-'),
  );
  const restorePath = path.join(restoreDir, path.basename(destinationPath));
  try {
    await fs.copyFile(snapshotPath, restorePath);
    await fs.rename(restorePath, destinationPath);
  } finally {
    await fs.rm(restoreDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function recoverRevisionTransaction(taskDir, expectedTaskId = null) {
  const transactionDir = path.join(taskDir, REVISION_TRANSACTION_NAME);
  const transactionState = await optionalLstat(transactionDir);
  if (transactionState === null) return false;
  if (!transactionState.isDirectory() || transactionState.isSymbolicLink()) {
    throw gateError('revision transaction recovery state must be a real directory');
  }

  const oldTaskPath = path.join(transactionDir, 'old-task.json');
  const oldTask = await readJson(oldTaskPath, 'revision transaction old-task.json');
  if (expectedTaskId !== null && oldTask.taskId !== expectedTaskId) return false;
  const snapshots = [
    [oldTaskPath, path.join(taskDir, 'task.json')],
    [
      path.join(transactionDir, 'old-workspace.json'),
      path.join(taskDir, 'artifacts', 'workspace.json'),
    ],
  ];
  for (const [snapshotPath] of snapshots) {
    const state = await optionalLstat(snapshotPath);
    if (state === null || !state.isFile() || state.isSymbolicLink()) {
      throw gateError('revision transaction recovery state is incomplete');
    }
  }
  for (const [snapshotPath, destinationPath] of snapshots) {
    await replaceFileFromSnapshot(snapshotPath, destinationPath);
  }
  await fs.rm(transactionDir, { recursive: true });
  return true;
}

async function stageRevisionTransaction(taskDir) {
  const transactionDir = path.join(taskDir, REVISION_TRANSACTION_NAME);
  if (await optionalLstat(transactionDir)) {
    throw gateError('revision transaction recovery must complete before a new revision');
  }
  const stagingDir = await fs.mkdtemp(
    path.join(taskDir, `${REVISION_TRANSACTION_NAME}.tmp-`),
  );
  try {
    await fs.copyFile(path.join(taskDir, 'task.json'), path.join(stagingDir, 'old-task.json'));
    await fs.copyFile(
      path.join(taskDir, 'artifacts', 'workspace.json'),
      path.join(stagingDir, 'old-workspace.json'),
    );
    await fs.rename(stagingDir, transactionDir);
    return transactionDir;
  } catch (error) {
    await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

async function resolveRepositoryRoot(repoArg) {
  if (!repoArg) throw usageError('repository is required');
  const requested = path.resolve(repoArg);
  const stat = await optionalLstat(requested);
  if (stat === null) throw usageError(`repository directory missing: ${repoArg}`);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw usageError(`repository must be a real directory: ${repoArg}`);
  }
  let root;
  try {
    root = git(requested, ['rev-parse', '--show-toplevel']).trim();
  } catch {
    throw usageError(`repository must be inside a Git worktree: ${repoArg}`);
  }
  return fs.realpath(root);
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
  const expectedTaskDir = path.join(canonicalRoot, '.dev-task');
  if (canonicalTaskDir !== expectedTaskDir) {
    throw usageError('task directory must be <task-worktree>/.dev-task');
  }
  return { repoRoot: canonicalRoot, taskDir: canonicalTaskDir, relativeTaskDir: '.dev-task' };
}

async function readTaskContractFromStdin() {
  let source = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) source += chunk;
  try {
    return JSON.parse(source);
  } catch (error) {
    throw gateError(`task contract stdin must be valid JSON: ${error.message}`);
  }
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
  if (!isPlainObject(task)) throw gateError('task.json must be an object');
  if (task.schemaVersion !== TASK_SCHEMA) {
    throw gateError(`task.schemaVersion must be ${TASK_SCHEMA}`);
  }
  const requiredFields = [
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
    'rulesReviewPolicy',
    'initialRepairPolicy',
  ];
  assertExactObject(
    task,
    requiredFields,
    [],
    'task.json',
  );
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
  if (!RULES_REVIEW_POLICIES.has(task.rulesReviewPolicy)) {
    throw gateError(`task.rulesReviewPolicy must be one of ${[...RULES_REVIEW_POLICIES].join(', ')}`);
  }
  if (!INITIAL_REPAIR_POLICIES.has(task.initialRepairPolicy)) {
    throw gateError(`task.initialRepairPolicy must be one of ${[...INITIAL_REPAIR_POLICIES].join(', ')}`);
  }
  return task;
}

async function validateArchitectureAuthority(architecturePath) {
  if (architecturePath === null) return;
  let stat;
  let source;
  try {
    stat = await fs.stat(architecturePath);
    source = await fs.readFile(architecturePath, 'utf8');
  } catch (error) {
    throw gateError(`Architecture missing or unreadable: ${error.message}`);
  }
  if (!stat.isFile()) throw gateError('Architecture path must reference a file');
  const confirmationLines = source.split(/\r?\n/u);
  if (confirmationLines.some((line) => /^\s*-\s+\[ \](?:\s|$)/u.test(line))) {
    throw gateError('Architecture contains unchecked [ ] confirmation units');
  }
  if (!confirmationLines.some((line) => /^\s*-\s+\[x\](?:\s|$)/u.test(line))) {
    throw gateError('Architecture must contain at least one confirmed [x] unit');
  }
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

async function validateWorkspaceRecord(record, task, expectedWorkspaceRoot = null) {
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
  if (expectedWorkspaceRoot !== null && workspaceRoot !== expectedWorkspaceRoot) {
    throw gateError('workspace.workspacePath must equal the task worktree Git root');
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
    throw gateError('task state is incomplete: artifacts/workspace.json is missing');
  }
  const { workspaceRoot } = await validateWorkspaceRecord(record, task, context.repoRoot);
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

function isIgnoredRepoPath(root, repoPath) {
  try {
    execFileSync('git', ['check-ignore', '--quiet', '--', repoPath], {
      cwd: root,
      stdio: 'ignore',
    });
    return true;
  } catch (error) {
    if (error.status === 1) return false;
    throw gateError(`git check-ignore failed for ${repoPath}`);
  }
}

function worktreePathForBranch(root, branch) {
  for (const worktree of registeredWorktrees(root)) {
    if (worktree.branch === branch) {
      return worktree.workspacePath;
    }
  }
  return null;
}

function registeredWorktrees(root) {
  const output = git(root, ['worktree', 'list', '--porcelain']).trim();
  if (!output) return [];
  return output.split(/\n\n+/).map((block) => {
    const lines = block.split('\n');
    const worktreeLine = lines.find((line) => line.startsWith('worktree '));
    const branchLine = lines.find((line) => line.startsWith('branch '));
    return {
      workspacePath: worktreeLine?.slice('worktree '.length) ?? null,
      branch: branchLine?.slice('branch '.length) ?? null,
    };
  });
}

async function gitCommonDir(root) {
  const commonDir = git(root, ['rev-parse', '--git-common-dir']).trim();
  const absolute = path.isAbsolute(commonDir) ? commonDir : path.resolve(root, commonDir);
  return fs.realpath(absolute);
}

function isTaskBranchRef(reference, task) {
  const prefix = `refs/heads/deliver-task/${task.taskId}-r`;
  return reference?.startsWith(prefix)
    && /^\d+-[0-9a-f]{12}$/.test(reference.slice(prefix.length));
}

function taskBranchRefs(root, task) {
  return git(root, ['for-each-ref', '--format=%(refname)', 'refs/heads'])
    .split(/\r?\n/)
    .filter((reference) => isTaskBranchRef(reference, task));
}

function outputForStart(record) {
  return {
    task: record.task,
    taskDir: path.join(record.workspacePath, '.dev-task'),
    workspacePath: record.workspacePath,
    kind: record.kind,
    branch: record.branch,
    baseCommit: record.baseCommit,
  };
}

async function readCompleteTaskState(workspaceRoot, task) {
  const taskDir = path.join(workspaceRoot, '.dev-task');
  const state = await optionalLstat(taskDir);
  if (state === null) throw gateError('task state is missing from existing workspace');
  if (!state.isDirectory() || state.isSymbolicLink()) {
    throw gateError('task state is incomplete: .dev-task must be a real directory');
  }

  let context;
  let existingTask;
  try {
    context = await resolveContext(taskDir);
    existingTask = await readTask(context);
  } catch (error) {
    throw gateError(`task state is incomplete: ${error.message}`);
  }
  if (canonicalJson(existingTask) !== canonicalJson(task)) {
    throw gateError('task state has a different task identity');
  }

  try {
    const audits = await readText(path.join(taskDir, 'audits.md'), 'audits.md');
    if (!audits.trim()) throw gateError('audits.md must not be empty');
    const ignore = await readText(path.join(taskDir, '.gitignore'), '.gitignore');
    if (ignore !== '*\n') throw gateError('.gitignore must contain exactly *');
    const record = await readJson(workspaceRecordPath(context), 'artifacts/workspace.json');
    await validateWorkspaceRecord(record, task, workspaceRoot);
    return outputForStart(record);
  } catch (error) {
    throw gateError(`task state is incomplete: ${error.message}`);
  }
}

async function findTaskWorkspace(repoRoot, task) {
  const matches = [];
  for (const worktree of registeredWorktrees(repoRoot)) {
    if (!worktree.workspacePath) continue;
    let workspaceRoot;
    let source;
    try {
      workspaceRoot = await fs.realpath(worktree.workspacePath);
      await recoverRevisionTransaction(
        path.join(workspaceRoot, '.dev-task'),
        task.taskId,
      );
      source = await fs.readFile(path.join(workspaceRoot, '.dev-task', 'task.json'), 'utf8');
    } catch (error) {
      if (
        error.code === 'ENOENT'
        && !isTaskBranchRef(worktree.branch, task)
      ) {
        continue;
      }
      if (error.code === 'ENOENT') {
        throw gateError('task branch exists but its live task state is missing');
      }
      throw gateError(`cannot inspect live task state: ${error.message}`);
    }

    let candidate;
    try {
      candidate = JSON.parse(source);
    } catch {
      if (isTaskBranchRef(worktree.branch, task)) {
        throw gateError('task state is incomplete: task.json must contain valid JSON');
      }
      continue;
    }
    if (
      !isPlainObject(candidate) ||
      candidate.taskId !== task.taskId
    ) {
      if (isTaskBranchRef(worktree.branch, task)) {
        throw gateError('task state is incomplete: task branch does not match task.json');
      }
      continue;
    }

    let existingTask;
    try {
      existingTask = validateTask(candidate, workspaceRoot);
    } catch (error) {
      throw gateError(`task state is incomplete: ${error.message}`);
    }
    if (existingTask.revision === task.revision) {
      if (canonicalJson(existingTask) !== canonicalJson(task)) {
        throw gateError('same revision contract drift detected; increment task.revision');
      }
      matches.push({ workspaceRoot, task: existingTask });
      continue;
    }
    if (existingTask.baseCommit !== task.baseCommit) continue;
    if (existingTask.revision > task.revision) {
      throw gateError('task revision is older than the live task revision');
    }
    matches.push({ workspaceRoot, task: existingTask });
  }

  if (matches.length > 1) {
    throw gateError('multiple live workspaces contain the same task lineage');
  }
  if (matches.length === 1) return matches[0];

  const branch = `refs/heads/${workspaceBranch(task)}`;
  if (gitRefExists(repoRoot, branch)) {
    const registeredPath = worktreePathForBranch(repoRoot, branch);
    if (!registeredPath) {
      throw gateError('task branch exists but its live task workspace is missing');
    }
    const workspaceRoot = await fs.realpath(registeredPath);
    if (workspaceRoot === repoRoot) {
      throw gateError('task branch is checked out in the source workspace without isolated task state');
    }
    return { workspaceRoot, task };
  }

  for (const taskRef of taskBranchRefs(repoRoot, task)) {
    if (!worktreePathForBranch(repoRoot, taskRef)) {
      throw gateError('task branch exists but its live task workspace is missing');
    }
  }
  return null;
}

async function reviseTaskState(workspaceRoot, existingTask, task) {
  if (existingTask.taskId !== task.taskId || existingTask.baseCommit !== task.baseCommit) {
    throw gateError('contract revision must stay in the current task lineage');
  }
  if (task.revision <= existingTask.revision) {
    throw gateError('contract revision must increase task.revision');
  }

  await readCompleteTaskState(workspaceRoot, existingTask);
  const taskDir = path.join(workspaceRoot, '.dev-task');
  const context = await resolveContext(taskDir);
  const record = await readJson(workspaceRecordPath(context), 'artifacts/workspace.json');
  const revisedRecord = { ...record, task: bindingForTask(task) };
  await validateWorkspaceRecord(revisedRecord, task, workspaceRoot);
  const transactionDir = await stageRevisionTransaction(taskDir);
  try {
    await writeJson(workspaceRecordPath(context), revisedRecord);
    await writeJson(path.join(taskDir, 'task.json'), task);
    await fs.rm(transactionDir, { recursive: true });
  } catch (error) {
    try {
      await recoverRevisionTransaction(taskDir);
    } catch (recoveryError) {
      throw gateError(
        `cannot revise task state: ${error.message}; recovery failed: ${recoveryError.message}`,
      );
    }
    throw gateError(`cannot revise task state: ${error.message}`);
  }
  return readCompleteTaskState(workspaceRoot, task);
}

async function continueTaskState(binding, task) {
  if (canonicalJson(binding.task) === canonicalJson(task)) {
    return readCompleteTaskState(binding.workspaceRoot, task);
  }
  return reviseTaskState(binding.workspaceRoot, binding.task, task);
}

async function writeInitialTaskState(workspaceRoot, task, record) {
  const taskDir = path.join(workspaceRoot, '.dev-task');
  if (await optionalLstat(taskDir)) {
    throw gateError('.dev-task already exists and cannot be initialized as new task state');
  }
  const stagingDir = await fs.mkdtemp(path.join(workspaceRoot, '.dev-task.tmp-'));
  let installed = false;
  try {
    await writeJson(path.join(stagingDir, 'task.json'), task);
    await fs.writeFile(
      path.join(stagingDir, 'audits.md'),
      `# 交付审计\n\n- taskId：${task.taskId}\n- revision：${task.revision}\n- taskHash：${taskHash(task)}\n`,
    );
    await fs.writeFile(path.join(stagingDir, '.gitignore'), '*\n');
    await fs.mkdir(path.join(stagingDir, 'artifacts'));
    await writeJson(path.join(stagingDir, 'artifacts', 'workspace.json'), record);
    await fs.rename(stagingDir, taskDir);
    installed = true;
    return taskDir;
  } catch (error) {
    await fs.rm(installed ? taskDir : stagingDir, { recursive: true, force: true }).catch(() => {});
    if (error instanceof GateError) throw error;
    throw gateError(`cannot initialize task state: ${error.message}`);
  }
}

async function rollbackCreatedWorkspace(repoRoot, workspacePath, branch) {
  const errors = [];
  const registeredPath = worktreePathForBranch(repoRoot, branch);
  if (registeredPath) {
    try {
      git(repoRoot, ['worktree', 'remove', '--force', registeredPath]);
    } catch (error) {
      errors.push(error.message);
    }
  }
  await fs.rm(workspacePath, { recursive: true, force: true }).catch((error) => errors.push(error.message));
  if (gitRefExists(repoRoot, branch)) {
    try {
      git(repoRoot, ['branch', '-D', branch.slice('refs/heads/'.length)]);
    } catch (error) {
      errors.push(error.message);
    }
  }
  if (errors.length > 0) throw gateError(`rollback failed: ${errors.join('; ')}`);
}

async function startWithProvidedWorkspace(repoRoot, task, providedPath) {
  const workspaceRoot = await resolveWorkspaceRoot(providedPath);
  if (await gitCommonDir(workspaceRoot) !== await gitCommonDir(repoRoot)) {
    throw gateError('provided workspace must belong to the same Git repository');
  }

  const binding = await findTaskWorkspace(repoRoot, task);
  if (binding !== null) {
    if (binding.workspaceRoot !== workspaceRoot) {
      throw gateError('task identity is already bound to another live workspace');
    }
    return continueTaskState(binding, task);
  }

  const taskDir = path.join(workspaceRoot, '.dev-task');
  const existingState = await optionalLstat(taskDir);
  if (existingState !== null) {
    if (!existingState.isDirectory() || existingState.isSymbolicLink()) {
      throw gateError('provided workspace contains incomplete task state');
    }
    let existingTask;
    try {
      existingTask = validateTask(
        await readJson(path.join(taskDir, 'task.json'), 'task.json'),
        workspaceRoot,
      );
    } catch (error) {
      throw gateError(`provided workspace contains incomplete task state: ${error.message}`);
    }
    if (canonicalJson(existingTask) !== canonicalJson(task)) {
      throw gateError('provided workspace already contains an existing task identity');
    }
    return readCompleteTaskState(workspaceRoot, task);
  }

  const headCommit = resolveCommit(workspaceRoot, 'HEAD', 'provided workspace HEAD');
  if (headCommit !== task.baseCommit) {
    throw gateError('new provided workspace must start exactly at task.baseCommit');
  }
  const dirtyPaths = changedPathsFrom(workspaceRoot, headCommit);
  if (dirtyPaths.length > 0) {
    throw gateError(`new provided workspace must be clean: ${dirtyPaths.join(', ')}`);
  }
  const record = {
    schemaVersion: WORKSPACE_SCHEMA,
    task: bindingForTask(task),
    kind: 'provided',
    workspacePath: workspaceRoot,
    branch: currentBranchRef(workspaceRoot),
    baseCommit: task.baseCommit,
  };
  await validateWorkspaceRecord(record, task, workspaceRoot);
  let created = false;
  try {
    await writeInitialTaskState(workspaceRoot, task, record);
    created = true;
    return await readCompleteTaskState(workspaceRoot, task);
  } catch (error) {
    if (created) await fs.rm(taskDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

async function startWithManagedWorkspace(repoRoot, task) {
  const binding = await findTaskWorkspace(repoRoot, task);
  if (binding) return continueTaskState(binding, task);

  const shortBranch = workspaceBranch(task);
  const branch = `refs/heads/${shortBranch}`;

  if (!isIgnoredRepoPath(repoRoot, '.worktrees/')) {
    throw gateError('managed workspace fallback requires .worktrees/ to be ignored');
  }
  const workspaceParent = path.join(repoRoot, '.worktrees');
  await fs.mkdir(workspaceParent, { recursive: true });
  const workspacePath = await fs.mkdtemp(
    path.join(workspaceParent, `deliver-task-${task.taskId}-r${task.revision}-`),
  );
  try {
    git(repoRoot, ['worktree', 'add', '-q', '-b', shortBranch, workspacePath, task.baseCommit]);
    const workspaceRoot = await fs.realpath(workspacePath);
    const record = {
      schemaVersion: WORKSPACE_SCHEMA,
      task: bindingForTask(task),
      kind: 'git-worktree',
      workspacePath: workspaceRoot,
      branch,
      baseCommit: task.baseCommit,
    };
    await validateWorkspaceRecord(record, task, workspaceRoot);
    await writeInitialTaskState(workspaceRoot, task, record);
    return await readCompleteTaskState(workspaceRoot, task);
  } catch (error) {
    try {
      await rollbackCreatedWorkspace(repoRoot, workspacePath, branch);
    } catch (rollbackError) {
      throw gateError(`${error.message}; ${rollbackError.message}`);
    }
    throw error;
  }
}

async function startTask(repoRoot, task, providedPath) {
  if (providedPath) return startWithProvidedWorkspace(repoRoot, task, providedPath);
  return startWithManagedWorkspace(repoRoot, task);
}

async function validateExecution(execution, task, context) {
  assertExactObject(
    execution,
    ['schemaVersion', 'task', 'allowedPaths', 'forbiddenPaths', 'architecturePath', 'evidenceRefs'],
    [],
    'execution.json',
  );
  if (execution.schemaVersion !== EXECUTION_SCHEMA) {
    throw gateError(`execution.schemaVersion must be ${EXECUTION_SCHEMA}`);
  }
  validateBinding(execution.task, task, 'execution.task');
  assertStringArray(execution.allowedPaths, 'execution.allowedPaths', { nonEmpty: true });
  assertStringArray(execution.forbiddenPaths, 'execution.forbiddenPaths');
  if (execution.architecturePath !== null) {
    assertString(execution.architecturePath, 'execution.architecturePath');
    if (!path.isAbsolute(execution.architecturePath)) {
      throw gateError('execution.architecturePath must be an absolute path or null');
    }
    if (path.normalize(execution.architecturePath) !== execution.architecturePath) {
      throw gateError('execution.architecturePath must be a normalized absolute path');
    }
    if (path.basename(execution.architecturePath) !== 'ARCHITECTURE.md') {
      throw gateError('execution.architecturePath must point to ARCHITECTURE.md');
    }
  }
  await validateArchitectureAuthority(execution.architecturePath);
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
    const dirtyPaths = changedPathsFrom(context.repoRoot, headCommit);
    assertBoundary(dirtyPaths, task, execution, context, 'worktree changes');
    if (dirtyPaths.length > 0) {
      throw gateError(`committed target has additional worktree changes: ${dirtyPaths.join(', ')}`);
    }
    return { kind: 'commit-range', baseCommit, headCommit, executionHash: currentExecutionHash };
  }

  const changedPaths = changedPathsFrom(context.repoRoot, baseCommit);
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

function printUsage() {
  process.stderr.write(
    '用法：deliver-task.mjs start <repo> - [--workspace <path>]\n'
      + '      deliver-task.mjs <task-hash|validate-execution|snapshot-target> <task-worktree>/.dev-task\n',
  );
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command) throw usageError('invalid arguments');

  if (command === 'start') {
    const [repoArg, stdinMarker, ...extra] = args;
    if (!repoArg || stdinMarker !== '-') {
      throw usageError('start requires <repo> and - for stdin task contract');
    }
    if (extra.length !== 0 && !(extra.length === 2 && extra[0] === '--workspace' && extra[1])) {
      throw usageError('start accepts only optional --workspace <path>');
    }
    const repoRoot = await resolveRepositoryRoot(repoArg);
    const task = validateTask(await readTaskContractFromStdin(), repoRoot);
    const output = await startTask(repoRoot, task, extra[1]);
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    return;
  }

  const taskCommands = new Set(['task-hash', 'validate-execution', 'snapshot-target']);
  if (!taskCommands.has(command)) {
    throw usageError(`unknown command: ${command}`);
  }
  const [taskDirArg, ...extra] = args;
  if (!taskDirArg) throw usageError(`${command} requires taskDir`);
  if (extra.length > 0) throw usageError(`${command} does not accept extra arguments`);
  const sourceContext = await resolveContext(taskDirArg);
  const task = await readTask(sourceContext);
  const context = await readWorkspaceContext(sourceContext, task);
  if (command === 'task-hash') {
    process.stdout.write(`${taskHash(task)}\n`);
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
