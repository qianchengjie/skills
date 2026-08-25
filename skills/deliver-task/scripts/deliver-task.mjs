#!/usr/bin/env node

import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const TASK_SCHEMA = 'deliver-task.task.v1';
const WORKSPACE_SCHEMA = 'deliver-task.workspace.v1';
const EXECUTION_SCHEMA = 'deliver-task.execution.v1';
const CLAIMS_SCHEMA = 'deliver-task.claims.v1';
const DELIVERY_SCHEMA = 'deliver-task.delivery.v1';
const COMMIT_POLICIES = new Set(['required', 'allowed', 'forbidden']);
const RESULT_STATUSES = new Set(['delivered', 'needs-upstream', 'blocked']);
const CLAIM_STATUSES = new Set(['proposed', 'implemented', 'verified', 'blocked', 'waived']);
const ACCEPTANCE_POLICIES = new Set(['required', 'not-required']);
const ACCEPTANCE_RESULTS = new Set(['passed', 'skipped', 'rejected']);
const SCOPED_REVIEW_RESULTS = new Set(['clean', 'findings', 'cannot-bound']);
const FULL_REVIEW_RESULTS = new Set(['clean', 'findings']);
const REVIEW_WAVE_RESULTS = new Set(['clean', 'failed']);
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

async function optionalLstat(target) {
  try {
    return await fs.lstat(target);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
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
    throw gateError('task proof state is incomplete: artifacts/workspace.json is missing');
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

function taskRevisionRefs(root, task) {
  const prefix = `refs/heads/deliver-task/${task.taskId}-r${task.revision}-`;
  return git(root, ['for-each-ref', '--format=%(refname)', 'refs/heads'])
    .split(/\r?\n/)
    .filter((reference) => reference.startsWith(prefix));
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
  if (state === null) throw gateError('task proof state is missing from existing workspace');
  if (!state.isDirectory() || state.isSymbolicLink()) {
    throw gateError('task proof state is incomplete: .dev-task must be a real directory');
  }

  let context;
  let existingTask;
  try {
    context = await resolveContext(taskDir);
    existingTask = await readTask(context);
  } catch (error) {
    throw gateError(`task proof state is incomplete: ${error.message}`);
  }
  if (canonicalJson(existingTask) !== canonicalJson(task)) {
    throw gateError('task proof state has a different task identity');
  }

  try {
    const claims = await readJson(path.join(taskDir, 'claims.json'), 'claims.json');
    validateClaims(claims, task);
    const audits = await readJsonOrText(path.join(taskDir, 'audits.md'), 'audits.md');
    if (!audits.trim()) throw gateError('audits.md must not be empty');
    const ignore = await readJsonOrText(path.join(taskDir, '.gitignore'), '.gitignore');
    if (ignore !== '*\n') throw gateError('.gitignore must contain exactly *');
    const record = await readJson(workspaceRecordPath(context), 'artifacts/workspace.json');
    await validateWorkspaceRecord(record, task, workspaceRoot);
    return outputForStart(record);
  } catch (error) {
    throw gateError(`task proof state is incomplete: ${error.message}`);
  }
}

async function findTaskRevisionWorkspace(repoRoot, task) {
  const matches = [];
  for (const worktree of registeredWorktrees(repoRoot)) {
    if (!worktree.workspacePath) continue;
    let workspaceRoot;
    let source;
    try {
      workspaceRoot = await fs.realpath(worktree.workspacePath);
      source = await fs.readFile(path.join(workspaceRoot, '.dev-task', 'task.json'), 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw gateError(`cannot inspect live task proof state: ${error.message}`);
    }

    let candidate;
    try {
      candidate = JSON.parse(source);
    } catch {
      continue;
    }
    if (
      !isPlainObject(candidate) ||
      candidate.taskId !== task.taskId ||
      candidate.revision !== task.revision
    ) {
      continue;
    }

    let existingTask;
    try {
      existingTask = validateTask(candidate, workspaceRoot);
    } catch (error) {
      throw gateError(`task proof state is incomplete: ${error.message}`);
    }
    if (canonicalJson(existingTask) !== canonicalJson(task)) {
      throw gateError('same revision contract drift detected; increment task.revision');
    }
    matches.push(workspaceRoot);
  }

  if (matches.length > 1) {
    throw gateError('multiple live workspaces contain the same task identity');
  }
  if (matches.length === 1) return matches[0];

  const branch = `refs/heads/${workspaceBranch(task)}`;
  if (gitRefExists(repoRoot, branch)) {
    const registeredPath = worktreePathForBranch(repoRoot, branch);
    if (!registeredPath) {
      throw gateError('task branch exists but its live task proof workspace is missing');
    }
    const workspaceRoot = await fs.realpath(registeredPath);
    if (workspaceRoot === repoRoot) {
      throw gateError('task branch is checked out in the source workspace without isolated proof state');
    }
    return workspaceRoot;
  }

  if (taskRevisionRefs(repoRoot, task).length > 0) {
    throw gateError('same revision contract drift detected; increment task.revision');
  }
  return null;
}

async function writeInitialTaskState(workspaceRoot, task, record) {
  const taskDir = path.join(workspaceRoot, '.dev-task');
  if (await optionalLstat(taskDir)) {
    throw gateError('.dev-task already exists and cannot be initialized as new proof state');
  }
  const stagingDir = await fs.mkdtemp(path.join(workspaceRoot, '.dev-task.tmp-'));
  let installed = false;
  try {
    await writeJson(path.join(stagingDir, 'task.json'), task);
    await writeJson(path.join(stagingDir, 'claims.json'), {
      schemaVersion: CLAIMS_SCHEMA,
      task: bindingForTask(task),
      claims: [],
    });
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
    throw gateError(`cannot initialize task proof state: ${error.message}`);
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

  const boundWorkspace = await findTaskRevisionWorkspace(repoRoot, task);
  if (boundWorkspace !== null) {
    const output = await readCompleteTaskState(boundWorkspace, task);
    if (boundWorkspace !== workspaceRoot) {
      throw gateError('task identity is already bound to another live workspace');
    }
    return output;
  }

  const taskDir = path.join(workspaceRoot, '.dev-task');
  const existingState = await optionalLstat(taskDir);
  if (existingState !== null) {
    if (!existingState.isDirectory() || existingState.isSymbolicLink()) {
      throw gateError('provided workspace contains incomplete task proof state');
    }
    let existingTask;
    try {
      existingTask = validateTask(
        await readJson(path.join(taskDir, 'task.json'), 'task.json'),
        workspaceRoot,
      );
    } catch (error) {
      throw gateError(`provided workspace contains incomplete task proof state: ${error.message}`);
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
  const existingWorkspace = await findTaskRevisionWorkspace(repoRoot, task);
  if (existingWorkspace) return readCompleteTaskState(existingWorkspace, task);

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

function validateTargetForTask(target, task, label) {
  validateTargetIdentity(target, label);
  if (target.kind === 'commit-range' && task.commitPolicy === 'forbidden') {
    throw gateError(`${label} cannot use a commit-range target with commitPolicy forbidden`);
  }
  if (target.kind === 'worktree' && task.commitPolicy === 'required') {
    throw gateError(`${label} cannot use a worktree target with commitPolicy required`);
  }
  if (target.baseCommit !== task.baseCommit) {
    throw gateError(`${label} must use task.baseCommit`);
  }
}

function validateTarget(target, task, execution, label = 'delivery.target') {
  validateTargetForTask(target, task, label);
  if (target.executionHash !== executionHash(execution)) {
    throw gateError(`${label} has stale execution binding`);
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

function auditEntries(source) {
  const lines = source.split(/\r?\n/);
  const headings = [];
  const anchors = new Set();
  for (const [lineIndex, line] of lines.entries()) {
    const match = /^###\s+(A[1-9][0-9]*)(?:[：:].*)?$/.exec(line);
    if (!match) continue;
    const anchor = match[1];
    if (anchors.has(anchor)) throw gateError(`audits.md has duplicate anchor ${anchor}`);
    anchors.add(anchor);
    headings.push({ anchor, lineIndex });
  }
  return headings.map((heading, index) => {
    const end = headings[index + 1]?.lineIndex ?? lines.length;
    return {
      index,
      reference: `audits.md#${heading.anchor}`,
      section: lines.slice(heading.lineIndex + 1, end).join('\n'),
    };
  });
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

function resolvePriorReviewWaveAuditRef(reviewHistory, reference, currentEntry, label) {
  assertAuditRef(reference, label);
  const evidence = reviewHistory.entriesByRef.get(reference);
  if (!evidence) throw gateError(`evidence ref missing anchor: ${reference}`);
  if (evidence.index >= currentEntry.index) {
    throw gateError(`${label} must reference an earlier audits.md A entry`);
  }
  return evidence;
}

function validateReviewResultBinding(
  record,
  task,
  target,
  executionHashValue,
  { domain, mode, result, label },
) {
  assertExactObject(
    record,
    ['task', 'executionHash', 'target', 'domain', 'mode', 'result'],
    [],
    `${label} review result`,
  );
  validateBinding(record.task, task, `${label} review result.task`);
  if (record.domain !== domain) {
    throw gateError(`${label} review result.domain must be ${domain}`);
  }
  if (record.mode !== mode) {
    throw gateError(`${label} review result.mode must be ${mode}`);
  }
  if (record.result !== result) {
    throw gateError(`${label} review result.result must be ${result}`);
  }
  if (record.executionHash !== executionHashValue) {
    throw gateError(`${label} review result has stale execution binding`);
  }
  if (canonicalJson(record.target) !== canonicalJson(target)) {
    throw gateError(`${label} review result has stale target binding`);
  }
}

function validateReviewResultRef(
  reviewHistory,
  reference,
  currentEntry,
  task,
  target,
  executionHashValue,
  expected,
) {
  const evidence = resolvePriorReviewWaveAuditRef(
    reviewHistory,
    reference,
    currentEntry,
    expected.label,
  );
  const binding = singleProtocolBlock(
    evidence.section,
    'deliver-task-review-result',
    expected.label,
  );
  validateReviewResultBinding(binding, task, target, executionHashValue, expected);
}

function validateReviewDomain(
  record,
  reviewHistory,
  currentEntry,
  task,
  target,
  executionHashValue,
  domain,
  label,
) {
  assertExactObject(
    record,
    ['scopedRef', 'scopedResult', 'fullRef', 'fullResult'],
    [],
    label,
  );
  if (!SCOPED_REVIEW_RESULTS.has(record.scopedResult)) {
    throw gateError(`${label}.scopedResult must be clean, findings, or cannot-bound`);
  }
  validateReviewResultRef(
    reviewHistory,
    record.scopedRef,
    currentEntry,
    task,
    target,
    executionHashValue,
    {
      domain,
      mode: 'scoped',
      result: record.scopedResult,
      label: `${label}.scopedRef`,
    },
  );
  if (record.scopedResult === 'cannot-bound') {
    if (record.fullRef === null || record.fullResult === null) {
      throw gateError(`${label} scoped cannot-bound requires fullRef and fullResult`);
    }
    if (!FULL_REVIEW_RESULTS.has(record.fullResult)) {
      throw gateError(`${label}.fullResult must be clean or findings after scoped cannot-bound`);
    }
    validateReviewResultRef(
      reviewHistory,
      record.fullRef,
      currentEntry,
      task,
      target,
      executionHashValue,
      {
        domain,
        mode: 'full',
        result: record.fullResult,
        label: `${label}.fullRef`,
      },
    );
    return record.fullResult;
  }
  if (record.fullRef !== null || record.fullResult !== null) {
    throw gateError(`${label} Full Review is only allowed after scoped cannot-bound`);
  }
  return record.scopedResult;
}

function validateReviewWave(
  record,
  task,
  reviewHistory,
  currentEntry,
  expectedWave,
  priorFailedWaveCount,
  previousWaveTarget,
) {
  const label = `Review Wave ${expectedWave}`;
  assertExactObject(
    record,
    [
      'task',
      'executionHash',
      'wave',
      'failedWaveCount',
      'previousTarget',
      'target',
      'repairInputRefs',
      'repairDiffRef',
      'validationRefs',
      'general',
      'rules',
      'mergedFindingRefs',
      'result',
    ],
    [],
    label,
  );
  if (priorFailedWaveCount >= 4) {
    throw gateError(`4 failed Review Waves require controller adjudication/escalation; stop automatic repair before wave ${expectedWave}`);
  }
  validateBinding(record.task, task, `${label}.task`);
  if (record.executionHash !== record.target?.executionHash) {
    throw gateError(`${label}.executionHash must equal ${label}.target.executionHash`);
  }
  if (record.wave !== expectedWave) {
    throw gateError(`${label}.wave must equal ${expectedWave}`);
  }
  if (!Number.isSafeInteger(record.failedWaveCount) || record.failedWaveCount < 0) {
    throw gateError(`${label}.failedWaveCount must be a non-negative integer`);
  }
  validateTargetForTask(record.previousTarget, task, `${label}.previousTarget`);
  validateTargetForTask(record.target, task, `${label}.target`);
  if (canonicalJson(record.previousTarget) === canonicalJson(record.target)) {
    throw gateError(`${label} requires a changed target`);
  }
  if (
    previousWaveTarget !== null
    && canonicalJson(record.previousTarget) !== canonicalJson(previousWaveTarget)
  ) {
    throw gateError(`${label}.previousTarget must equal the preceding Review Wave target`);
  }
  assertStringArray(record.repairInputRefs, `${label}.repairInputRefs`, { nonEmpty: true });
  assertString(record.repairDiffRef, `${label}.repairDiffRef`);
  assertStringArray(record.validationRefs, `${label}.validationRefs`, { nonEmpty: true });
  assertStringArray(record.mergedFindingRefs, `${label}.mergedFindingRefs`);
  const references = [
    ...record.repairInputRefs.map((reference, index) => [reference, `${label}.repairInputRefs[${index}]`]),
    [record.repairDiffRef, `${label}.repairDiffRef`],
    ...record.validationRefs.map((reference, index) => [
      reference,
      `${label}.validationRefs[${index}]`,
    ]),
    ...record.mergedFindingRefs.map((reference, index) => [
      reference,
      `${label}.mergedFindingRefs[${index}]`,
    ]),
  ];
  for (const [reference, referenceLabel] of references) {
    resolvePriorReviewWaveAuditRef(reviewHistory, reference, currentEntry, referenceLabel);
  }

  const generalResult = validateReviewDomain(
    record.general,
    reviewHistory,
    currentEntry,
    task,
    record.target,
    record.executionHash,
    'general',
    `${label}.General`,
  );
  let rulesResult = 'clean';
  if (record.rules === 'not-applicable') {
    rulesResult = 'clean';
  } else {
    rulesResult = validateReviewDomain(
      record.rules,
      reviewHistory,
      currentEntry,
      task,
      record.target,
      record.executionHash,
      'rules',
      `${label}.Rules`,
    );
  }
  if (!REVIEW_WAVE_RESULTS.has(record.result)) {
    throw gateError(`${label}.result must be clean or failed`);
  }
  if (record.result === 'clean' && record.mergedFindingRefs.length !== 0) {
    throw gateError(`${label} clean requires mergedFindingRefs to be empty`);
  }
  if (record.result === 'failed' && record.mergedFindingRefs.length === 0) {
    throw gateError(`${label} failed requires mergedFindingRefs to not be empty`);
  }
  const expectedResult = generalResult === 'findings' || rulesResult === 'findings' ? 'failed' : 'clean';
  if (record.result !== expectedResult) {
    throw gateError(`${label}.result must match the merged General and Rules outcomes: ${expectedResult}`);
  }
  const expectedFailedWaveCount = priorFailedWaveCount + (record.result === 'failed' ? 1 : 0);
  if (record.failedWaveCount !== expectedFailedWaveCount) {
    throw gateError(
      `${label}.failedWaveCount must equal cumulative failed Review Wave count ${expectedFailedWaveCount}`,
    );
  }
  return { record, failedWaveCount: expectedFailedWaveCount };
}

async function validateReviewWaveHistory(context, task, execution) {
  const audits = await readJsonOrText(path.join(context.taskDir, 'audits.md'), 'audits.md');
  if (protocolBlocks(audits, 'deliver-task-repair-closure', 'audits.md').length > 0) {
    throw gateError('deliver-task-repair-closure is no longer supported; use deliver-task-review-wave');
  }
  const entries = auditEntries(audits);
  const entriesByRef = new Map(entries.map((entry) => [entry.reference, entry]));
  const records = [];
  for (const entry of entries) {
    const blocks = protocolBlocks(entry.section, 'deliver-task-review-wave', entry.reference);
    if (blocks.length > 1) {
      throw gateError(`${entry.reference} must contain at most one deliver-task-review-wave block`);
    }
    if (blocks.length === 1) records.push({ record: blocks[0], entry });
  }
  const allBlocks = protocolBlocks(audits, 'deliver-task-review-wave', 'audits.md');
  if (allBlocks.length !== records.length) {
    throw gateError('each deliver-task-review-wave block must be inside one audits.md A entry');
  }
  if (records.length > 0 && execution === null) {
    throw gateError('Review Wave history requires delivery.target and execution.json binding');
  }
  const reviewHistory = { entriesByRef };
  const validated = [];
  let failedWaveCount = 0;
  let previousWaveTarget = null;
  for (const [index, { record, entry }] of records.entries()) {
    const result = validateReviewWave(
      record,
      task,
      reviewHistory,
      entry,
      index + 1,
      failedWaveCount,
      previousWaveTarget,
    );
    validated.push(result.record);
    failedWaveCount = result.failedWaveCount;
    previousWaveTarget = result.record.target;
  }
  if (validated.length > 0) {
    const currentExecutionHash = executionHash(execution);
    const finalWave = validated.at(-1);
    if (
      finalWave.executionHash !== currentExecutionHash
      || finalWave.target.executionHash !== currentExecutionHash
    ) {
      throw gateError('final Review Wave must bind the current execution.json');
    }
  }
  return { records: validated, failedWaveCount };
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

async function validateDeliveredBindings(context, task, execution, delivery, reviewWaveHistory) {
  const generalRef = delivery.evidenceRefs.generalReview;
  assertAuditRef(generalRef, 'delivery.evidenceRefs.generalReview');
  const generalEvidence = await resolveEvidenceRef(context, generalRef, { allowNotApplicable: false });
  const generalBinding = singleProtocolBlock(
    generalEvidence.section,
    'deliver-task-binding',
    'General Review evidence',
  );
  validateGeneralBinding(generalBinding, task, execution, delivery.target, 'General Review binding');

  const evidenceWaves = protocolBlocks(
    generalEvidence.section,
    'deliver-task-review-wave',
    'General Review evidence',
  );
  if (reviewWaveHistory.records.length > 0) {
    if (evidenceWaves.length !== 1) {
      throw gateError('final Review Wave evidence must contain exactly one deliver-task-review-wave block');
    }
    const finalWave = reviewWaveHistory.records.at(-1);
    if (canonicalJson(evidenceWaves[0]) !== canonicalJson(finalWave)) {
      throw gateError('delivery.evidenceRefs.generalReview must reference the final Review Wave');
    }
    if (finalWave.result !== 'clean') {
      throw gateError('delivered requires the final Review Wave to be clean');
    }
    if (canonicalJson(finalWave.target) !== canonicalJson(delivery.target)) {
      throw gateError('final Review Wave has stale target binding');
    }
    if (!finalWave.validationRefs.includes(delivery.evidenceRefs.verification)) {
      throw gateError('delivery.evidenceRefs.verification must reference final Review Wave validationRefs');
    }
    if (finalWave.rules === 'not-applicable') {
      if (delivery.evidenceRefs.rulesReview !== 'not-applicable') {
        throw gateError('Rules not-applicable Review Wave requires delivery rulesReview not-applicable');
      }
    } else if (delivery.evidenceRefs.rulesReview !== generalRef) {
      throw gateError('applicable Rules scoped verification requires the merged Review Wave evidence ref');
    }
  } else {
    if (evidenceWaves.length !== 0) {
      throw gateError('delivery General evidence contains an untracked Review Wave');
    }
  }

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
  const reviewWaveHistory = await validateReviewWaveHistory(context, task, execution);
  if (delivery.result === 'delivered') {
    await validateDeliveredBindings(context, task, execution, delivery, reviewWaveHistory);
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
    '用法：deliver-task.mjs start <repo> - [--workspace <path>]\n'
      + '      deliver-task.mjs <task-hash|validate-execution|snapshot-target|validate-result|close-check> <task-worktree>/.dev-task\n',
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

  const taskCommands = new Set([
    'task-hash',
    'validate-execution',
    'snapshot-target',
    'validate-result',
    'close-check',
  ]);
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
