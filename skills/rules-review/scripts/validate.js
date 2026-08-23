#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const MODES = new Set([
  'new-run-id',
  'dispatch',
  'construct-dispatch',
  'seal-dispatch',
  'task',
  'shard',
  'final-review',
  'build-tasks',
  'aggregate-final',
  'render-final',
  'render-response',
  'render-handoff',
  'final-md',
  'run',
]);

const SCHEMA_VERSION = 8;
const RESULT_STATUSES = ['passed', 'finding', 'observation', 'cannot_verify'];
const PROTOCOL_GATES = ['passed', 'incomplete', 'blocked'];
const SCOPE_MODES = ['full', 'scoped'];
const COVERAGE_CLAIMS = ['full_complete', 'scoped_complete', 'incomplete', 'blocked'];
const SEMANTIC_VERDICTS = ['clean', 'issues', 'unknown'];
const RECOMMENDATIONS = ['ready_for_merge', 'must_fix_before_merge', 'should_review_before_merge', 'manual_verification_required', 'review_incomplete', 'review_blocked'];
const RULE_LEVELS = ['MUST', 'SHOULD', 'ADVISORY'];
const FINDING_ORIGINS = ['introduced_by_change', 'worsened_by_change', 'exposed_by_change', 'pre_existing'];
const FINDING_PRIORITIES = ['must_fix', 'should_fix'];
const ISSUE_SUMMARY_FIELDS = ['findings', 'mustFix', 'shouldFix', 'cannotVerify', 'observations'];
const APPLICABILITY_STATUSES = ['applicable', 'not_applicable'];
const FAILURE_CHECK_OUTCOMES = ['checked_no_violation', 'not_triggered'];
const REVIEW_ITEM_RE = /^RI\d{3,}$/;
const TARGET_RE = /^T\d{3,}$/;
const FINDING_RE = /^F\d{3,}$/;
const SHA256_RE = /^sha256:[0-9a-f]{64}$/;
const GIT_OID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const RUN_ID_RE = /^[0-9]{8}T[0-9]{6}Z-rr-[0-9a-f]{8}$/;
const SAFE_TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

const LABELS = {
  passed: '协议通过',
  incomplete: '未完成',
  blocked: '阻塞',
  full: '完整范围',
  scoped: '限定范围',
  full_complete: '本轮范围协议覆盖完整',
  scoped_complete: '本轮限定范围协议覆盖完整',
  clean: '未发现问题',
  issues: '发现问题',
  unknown: '未知',
  ready_for_merge: '可以合并',
  must_fix_before_merge: '合并前必须修复',
  should_review_before_merge: '合并前建议确认',
  manual_verification_required: '需要人工验证',
  review_incomplete: '审查未完成',
  review_blocked: '审查阻塞',
  must_fix: '必须修复',
  should_fix: '建议修复',
  introduced_by_change: '本次引入',
  worsened_by_change: '本次加重',
  exposed_by_change: '本次暴露',
  pre_existing: '历史存在',
};

const PROTOCOL_GATE_LABELS = {
  passed: '协议通过',
  incomplete: '协议未完成',
  blocked: '协议阻塞',
};

function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = run(args);
  finalize(result);
  process.stdout.write(`${JSON.stringify(publicResult(result), null, 2)}\n`);
  process.exit(result.exitCode);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      if (!args._) args._ = [];
      args._.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function createResult(mode, artifact) {
  return {
    ok: false,
    mode: mode || null,
    artifact: artifact || null,
    violations: [],
    skipped: [],
    exitCode: 0,
    rendered: null,
    response: null,
    gateImpact: { incomplete: false, blocked: false },
    gate: null,
  };
}

function publicResult(result) {
  const data = {
    schemaVersion: SCHEMA_VERSION,
    ok: result.ok,
    mode: result.mode,
    artifact: result.artifact,
    violations: result.violations,
    skipped: result.skipped,
  };
  if (result.gate) data.gate = result.gate;
  if (result.rendered) data.rendered = result.rendered;
  if (result.response) data.response = result.response;
  if (result.runId) data.runId = result.runId;
  return data;
}

function finalize(result) {
  result.ok = result.violations.length === 0 && (!result.gate || result.gate.protocolGate === 'passed');
  if (result.ok) {
    result.exitCode = 0;
  } else if (result.exitCode === 0) {
    result.exitCode = 1;
  }
}

function addViolation(result, code, artifact, jsonPointer, message, expected, actual, exitCode = 1, gateImpact = 'blocked') {
  result.violations.push({
    code,
    severity: 'error',
    artifact: artifact == null ? result.artifact : artifact,
    jsonPointer: jsonPointer == null ? null : jsonPointer,
    message,
    expected: expected == null ? null : expected,
    actual: actual == null ? null : actual,
  });
  if (gateImpact === 'blocked') result.gateImpact.blocked = true;
  if (gateImpact === 'incomplete') result.gateImpact.incomplete = true;
  if (exitCode > result.exitCode) result.exitCode = exitCode;
}

function run(args) {
  const mode = args.mode;
  const artifact = args.dir || args.input || args.output || args.dispatch || args.out || null;
  const result = createResult(mode, artifact);

  if (!mode || !MODES.has(mode)) {
    addViolation(result, 'EXEC001', null, '/mode', 'unknown or missing mode', Array.from(MODES), mode || null, 2);
    return result;
  }

  ensureSchemaFiles(result);
  if (mode !== 'render-final' && result.exitCode === 2) return result;

  try {
    if (mode === 'new-run-id') {
      result.runId = `${new Date().toISOString().replace(/[-:]|\.\d{3}/g, '')}-rr-${crypto.randomBytes(4).toString('hex')}`;
    } else if (mode === 'construct-dispatch') {
      constructDispatchMode(args, result);
    } else if (mode === 'seal-dispatch') {
      sealDispatchMode(args, result);
    } else if (mode === 'dispatch') {
      const dispatch = readJson(args.input, args.input, result, 'D001');
      if (dispatch) validateDispatch(dispatch, args.input, result, args.input);
    } else if (mode === 'task') {
      const task = readJson(args.input, args.input, result, 'T001');
      if (task) validateTask(task, args.input, result);
    } else if (mode === 'shard') {
      const task = readJson(args.task, args.task, result, 'T001');
      const shard = readJson(args.input, args.input, result, 'S001');
      if (task) validateTask(task, args.task, result);
      if (task && shard) validateShard(shard, task, args.input, result);
    } else if (mode === 'final-review') {
      const finalReview = readJson(args.input, args.input, result, 'FR001');
      if (finalReview) validateFinalReviewShape(finalReview, args.input, result);
    } else if (mode === 'build-tasks') {
      buildTasksMode(args, result);
    } else if (mode === 'aggregate-final') {
      aggregateFinalMode(args, result);
    } else if (mode === 'render-final') {
      renderFinalMode(args, result);
    } else if (mode === 'render-response') {
      renderResponseMode(args, result);
    } else if (mode === 'render-handoff') {
      renderHandoffMode(args, result);
    } else if (mode === 'final-md') {
      validateFinalMarkdownMode(args, result);
    } else if (mode === 'run') {
      validateRun(args.dir, result);
    }
  } catch (error) {
    addViolation(result, 'EXEC999', null, null, error.message || 'unexpected validator error', 'no runtime error', error.stack || String(error), 2);
  }

  return result;
}

function ensureSchemaFiles(result) {
  const schemaDir = path.resolve(__dirname, '..', 'schemas');
  [
    'dispatch.schema.json',
    'task.schema.json',
    'shard.schema.json',
    'validation.schema.json',
    'final-review.schema.json',
  ].forEach((file) => {
    const filePath = path.join(schemaDir, file);
    if (!fs.existsSync(filePath)) {
      addViolation(result, 'EXEC002', filePath, null, 'schema file is missing', file, null, 2);
      return;
    }
    try {
      JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
      addViolation(result, 'EXEC003', filePath, null, 'schema file is not strict JSON', 'JSON.parse-compatible schema', error.message, 2);
    }
  });
}

function readJson(filePath, artifact, result, code, gateImpact = 'blocked') {
  if (!filePath || filePath === true) {
    addViolation(result, code, artifact || null, null, 'missing JSON input path', 'file path', filePath || null, 2, gateImpact);
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    addViolation(result, code, artifact, null, 'input is not strict JSON or file is unreadable', 'JSON.parse-compatible content', error.message, 2, gateImpact);
    return null;
  }
}

function readText(filePath, artifact, result, code, gateImpact = 'blocked') {
  if (!filePath || filePath === true) {
    addViolation(result, code, artifact || null, null, 'missing text input path', 'file path', filePath || null, 2, gateImpact);
    return null;
  }
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    addViolation(result, code, artifact, null, 'cannot read file', 'readable file', error.message, 2, gateImpact);
    return null;
  }
}

function constructDispatchMode(args, result) {
  const input = readJson(args.input, args.input, result, 'CD001');
  if (!input) return;
  result.artifact = args.output || args.input;

  let temporary = null;
  try {
    const root = loadCurrentRepository();
    const output = resolveConstructionOutput(root, args.output, input.runId);
    if (fs.existsSync(output)) throw new Error('construct-dispatch output already exists; create a fresh run');

    const construction = buildDispatchDraft(input, root);
    const sealArgs = {
      base: input.repository.baseCommit,
      'target-commit': input.repository.targetCommit,
    };
    if (construction.rulesCommit) sealArgs['rules-commit'] = construction.rulesCommit;
    const sealed = sealDispatchDraft(
      construction.draft,
      sealArgs,
      root,
      construction.snapshotRule,
      construction.rulePaths,
    );

    ensureSafeOutputParent(root, output);
    temporary = path.join(path.dirname(output), `.${path.basename(output)}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`);
    fs.writeFileSync(temporary, `${JSON.stringify(sealed, null, 2)}\n`, { flag: 'wx' });
    validateDispatch(sealed, args.output, result, temporary);
    if (result.violations.length > 0) return;
    fs.linkSync(temporary, output);
    fs.unlinkSync(temporary);
    temporary = null;
    result.rendered = args.output;
  } catch (error) {
    addViolation(result, 'CD002', args.input, null, `construct-dispatch failed closed: ${error.message}`, 'valid compact semantic input and fresh canonical dispatch output', error.message, 2);
  } finally {
    if (temporary) {
      try {
        fs.unlinkSync(temporary);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
  }
}

function loadCurrentRepository() {
  const rootOutput = execFileSync('git', ['-C', process.cwd(), 'rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  }).trim();
  if (!rootOutput || rootOutput.includes('\n')) throw new Error('unable to determine a single Git worktree root');
  return fs.realpathSync(rootOutput);
}

function resolveConstructionOutput(root, output, runId) {
  if (!isRunId(runId)) throw new Error('construction input runId must match YYYYMMDDTHHmmssZ-rr-xxxxxxxx');
  if (!isNonEmptyString(output)) throw new Error('construct-dispatch requires --output <relative-path>');
  assertSafeRepoRelativePath(output);
  const expected = `.rules-review-tmp/${runId}/dispatch.json`;
  if (output !== expected) throw new Error(`construct-dispatch output must equal ${expected}`);
  const resolved = path.resolve(root, ...output.split('/'));
  assertPathInsideRoot(root, resolved, 'construct-dispatch output');
  return resolved;
}

function ensureSafeOutputParent(root, output) {
  const relative = path.relative(root, path.dirname(output));
  let current = root;
  relative.split(path.sep).filter(Boolean).forEach((segment) => {
    current = path.join(current, segment);
    try {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`output parent must be a real directory: ${current}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      fs.mkdirSync(current);
    }
  });
}

function buildDispatchDraft(input, root) {
  if (!isObject(input) || input.schemaVersion !== 2) throw new Error('construction input schemaVersion must equal 2');
  const legacyInput = input.kind === 'rules-review-dispatch-construction-eval-input';
  if (!legacyInput && input.kind !== 'rules-review-dispatch-construction-input') {
    throw new Error('construction input kind must equal rules-review-dispatch-construction-input');
  }
  assertConstructionKeys(input, [
    'kind',
    'schemaVersion',
    'runId',
    'repository',
    'catalogSource',
    'ruleProjection',
    'targets',
    'applicability',
    'batchRuleRefs',
    'expectedCounts',
  ], 'construction input');
  const repository = requireConstructionObject(input.repository, 'repository');
  const ruleProjection = requireConstructionObject(input.ruleProjection, 'ruleProjection');
  const inputTargets = requireConstructionObject(input.targets, 'targets');
  const applicability = requireConstructionObject(input.applicability, 'applicability');
  const batchRuleRefs = requireConstructionObject(input.batchRuleRefs, 'batchRuleRefs');
  const hasRulesCommit = Object.prototype.hasOwnProperty.call(repository, 'rulesCommit');
  assertConstructionKeys(
    repository,
    legacyInput
      ? ['fixture', 'baseCommit', 'targetCommit', 'rulesCommit', 'excludedFiles']
      : ['baseCommit', 'targetCommit', ...(hasRulesCommit ? ['rulesCommit'] : []), 'excludedFiles'],
    'repository',
  );
  assertConstructionKeys(ruleProjection, [
    'ruleSetId',
    'candidateRuleRefs',
    'selectedRuleRefs',
    'excludedRuleRefs',
    'globallyNotApplicableRuleRefs',
  ], 'ruleProjection');
  assertConstructionKeys(inputTargets, ['changedUnits', 'candidates', 'contextExpansions'], 'targets');
  assertConstructionKeys(applicability, ['encoding', 'evidenceProjection', 'notApplicableReason', 'byRule'], 'applicability');
  if (legacyInput) assertSafeRepoRelativePath(repository.fixture);
  resolveConstructionCommit(root, repository.baseCommit, 'repository.baseCommit');
  resolveConstructionCommit(root, repository.targetCommit, 'repository.targetCommit');
  const rulesCommit = hasRulesCommit
    ? resolveConstructionCommit(root, repository.rulesCommit, 'repository.rulesCommit')
    : null;
  const rulesTree = rulesCommit ? resolveTree(root, `${rulesCommit}^{tree}`) : null;
  const snapshotRule = memoizeConstructionRuleSnapshot(
    rulesCommit
      ? (repoPath) => snapshotRuleFile(root, rulesTree, repoPath)
      : (repoPath) => snapshotWorkspaceRuleFile(root, repoPath),
  );
  const ruleFileExists = rulesCommit
    ? (repoPath) => readTreeEntry(root, rulesTree, repoPath).state === 'present'
    : (repoPath) => fs.existsSync(path.resolve(root, ...repoPath.split('/')));
  const catalog = buildConstructionRuleCatalog(snapshotRule, ruleFileExists);
  validateConstructionCatalogSource(input.catalogSource, rulesCommit, catalog);
  const candidateRuleRefs = constructionStringSet(ruleProjection.candidateRuleRefs, 'ruleProjection.candidateRuleRefs');
  const selectedRuleRefs = constructionStringSet(ruleProjection.selectedRuleRefs, 'ruleProjection.selectedRuleRefs');
  const excludedRuleRefs = constructionStringSet(ruleProjection.excludedRuleRefs, 'ruleProjection.excludedRuleRefs');
  const globallyNotApplicableRuleRefs = constructionStringSet(ruleProjection.globallyNotApplicableRuleRefs, 'ruleProjection.globallyNotApplicableRuleRefs');
  if (candidateRuleRefs.some((ruleRef) => !/^[A-Z][A-Z0-9]*-\d{3}$/.test(ruleRef))) {
    throw new Error('ruleProjection.candidateRuleRefs must contain canonical rule IDs');
  }
  if (!setsEqual(new Set(candidateRuleRefs), new Set(catalog.rules.keys()))) {
    throw new Error('ruleProjection.candidateRuleRefs must equal all active rule IDs');
  }
  const changedUnits = constructionArray(inputTargets.changedUnits, 'targets.changedUnits');
  const candidates = constructionArray(inputTargets.candidates, 'targets.candidates');
  const contextExpansions = constructionArray(inputTargets.contextExpansions, 'targets.contextExpansions');
  [...changedUnits, ...candidates].forEach((target, index) => {
    assertConstructionKeys(
      requireConstructionObject(target, `target ${index}`),
      ['targetId', 'targetKind', 'inputRefs', 'loc', 'summary'],
      `target ${index}`,
    );
  });
  contextExpansions.forEach((expansion, index) => {
    assertConstructionKeys(
      requireConstructionObject(expansion, `targets.contextExpansions.${index}`),
      ['expansionId', 'reason', 'addedTargetIds'],
      `targets.contextExpansions.${index}`,
    );
  });
  const targets = [...changedUnits, ...candidates];
  const targetById = new Map(targets.map((target) => [target && target.targetId, target]));
  if (targetById.size !== targets.length || targetById.has(undefined)) throw new Error('construction targets require unique targetId values');

  const encoding = requireConstructionObject(applicability.encoding, 'applicability.encoding');
  assertConstructionKeys(encoding, ['targetOrder', 'legend', 'rule'], 'applicability.encoding');
  if (encoding.rule !== '每个 selected rule 的字符串必须与 targetOrder 等长；每个字符显式决定对应 ruleRef × targetId，禁止缺省决定。') {
    throw new Error('applicability.encoding.rule does not match construction-input v2');
  }
  const targetOrder = constructionStringSet(encoding.targetOrder, 'applicability.encoding.targetOrder');
  if (targetOrder.length !== targets.length || targetOrder.some((targetId) => !targetById.has(targetId))) {
    throw new Error('applicability targetOrder must cover every target exactly once');
  }
  const legend = requireConstructionObject(encoding.legend, 'applicability.encoding.legend');
  assertConstructionKeys(legend, ['A', 'N'], 'applicability.encoding.legend');
  if (legend.A !== 'applicable' || legend.N !== 'not_applicable') {
    throw new Error('applicability legend must map A/N to applicable/not_applicable');
  }
  const evidenceProjection = requireConstructionObject(applicability.evidenceProjection, 'applicability.evidenceProjection');
  assertConstructionKeys(evidenceProjection, ['loc', 'summary'], 'applicability.evidenceProjection');
  const byRule = requireConstructionObject(applicability.byRule, 'applicability.byRule');
  if (!setsEqual(new Set(Object.keys(byRule)), new Set(selectedRuleRefs))) {
    throw new Error('applicability.byRule must contain exactly selectedRuleRefs');
  }

  const ruleSources = buildConstructionRuleSources(catalog, candidateRuleRefs);
  const applicabilityMatrix = [];
  const reviewItems = [];

  selectedRuleRefs.forEach((ruleRef) => {
    const decisions = byRule[ruleRef];
    if (typeof decisions !== 'string' || decisions.length !== targetOrder.length || /[^AN]/.test(decisions)) {
      throw new Error(`applicability.byRule.${ruleRef} must contain one A/N decision per target`);
    }
    targetOrder.forEach((targetId, targetIndex) => {
      const target = targetById.get(targetId);
      const applicable = decisions[targetIndex] === 'A';
      const values = {
        'target.loc': target.loc,
        ruleRef,
        'target.targetId': targetId,
        decisionZh: applicable ? '适用' : '不适用',
      };
      const entry = {
        ruleRef,
        targetId,
        targetKind: target.targetKind,
        applicability: applicable ? 'applicable' : 'not_applicable',
        evidence: [{
          loc: renderConstructionTemplate(applicability.evidenceProjection.loc, values, 'applicability.evidenceProjection.loc'),
          summary: renderConstructionTemplate(applicability.evidenceProjection.summary, values, 'applicability.evidenceProjection.summary'),
        }],
      };
      if (applicable) {
        const reviewItemId = `RI${String(reviewItems.length + 1).padStart(3, '0')}`;
        entry.reviewItemId = reviewItemId;
        reviewItems.push({
          reviewItemId,
          ruleRef,
          targetKind: target.targetKind,
          targetId,
        });
      } else {
        entry.reason = renderConstructionTemplate(applicability.notApplicableReason, values, 'applicability.notApplicableReason');
      }
      applicabilityMatrix.push(entry);
    });
  });

  const assignedRules = new Set();
  const reviewBatches = Object.entries(batchRuleRefs).map(([reviewBatchId, ruleRefs]) => {
    if (!isSafeToken(reviewBatchId)) throw new Error(`invalid reviewBatchId: ${reviewBatchId}`);
    const batchRules = constructionStringSet(ruleRefs, `batchRuleRefs.${reviewBatchId}`);
    batchRules.forEach((ruleRef) => {
      if (!selectedRuleRefs.includes(ruleRef)) throw new Error(`batch rule must be selected: ${ruleRef}`);
      if (assignedRules.has(ruleRef)) throw new Error(`batch rule is assigned more than once: ${ruleRef}`);
      assignedRules.add(ruleRef);
    });
    return {
      reviewBatchId,
      reviewItemIds: reviewItems.filter((item) => batchRules.includes(item.ruleRef)).map((item) => item.reviewItemId),
    };
  }).filter((batch) => batch.reviewItemIds.length > 0);
  if (!setsEqual(assignedRules, new Set(selectedRuleRefs))) {
    throw new Error('batchRuleRefs must cover selectedRuleRefs exactly once');
  }

  const draft = {
    kind: 'rules-review-dispatch',
    schemaVersion: SCHEMA_VERSION,
    runId: input.runId,
    reviewRange: {
      excludedFiles: constructionArray(repository.excludedFiles, 'repository.excludedFiles'),
    },
    ruleSnapshot: { files: [] },
    inputSnapshot: { files: [] },
    ruleSet: {
      ruleSetId: ruleProjection.ruleSetId,
      sourceIndexHash: `sha256:${'0'.repeat(64)}`,
      candidateRuleRefs,
      selectedRuleRefs,
      excludedRuleRefs,
      globallyNotApplicableRuleRefs,
      ruleSources,
    },
    targets: {
      changedUnits: JSON.parse(JSON.stringify(changedUnits)),
      candidates: JSON.parse(JSON.stringify(candidates)),
      contextExpansions: JSON.parse(JSON.stringify(contextExpansions)),
    },
    applicabilityMatrix,
    reviewItems,
    reviewBatches,
  };
  assertExpectedConstructionCounts(input.expectedCounts, draft);
  return {
    draft,
    rulesCommit,
    snapshotRule,
    rulePaths: ['.agents/rules/index.md', ...catalog.files.map((file) => file.path)],
  };
}

function memoizeConstructionRuleSnapshot(snapshotRule) {
  const snapshots = new Map();
  return (repoPath) => {
    if (!snapshots.has(repoPath)) snapshots.set(repoPath, snapshotRule(repoPath));
    return snapshots.get(repoPath);
  };
}

function buildConstructionRuleSources(catalog, candidateRuleRefs) {
  return candidateRuleRefs.map((ruleRef) => {
    const rule = catalog.rules.get(ruleRef);
    if (!rule) throw new Error(`rule source is missing active rule ${ruleRef}`);
    return {
      namespace: rule.namespace,
      ruleRef,
      ruleLevel: rule.ruleLevel,
      sourceFile: rule.sourceFile,
      sourceHash: `sha256:${'0'.repeat(64)}`,
      trigger: rule.trigger,
      appliesTo: rule.appliesTo,
      summary: rule.summary,
      ruleText: rule.ruleText,
      ...(rule.failureConditions.length > 0 ? { failureConditions: rule.failureConditions } : {}),
    };
  });
}

function buildConstructionRuleCatalog(snapshotRule, ruleFileExists) {
  const indexFile = snapshotRule('.agents/rules/index.md');
  const index = parseConstructionRuleIndex(indexFile.content);
  const files = [];
  const rules = new Map();

  index.forEach((registration, namespace) => {
    if (registration.status !== 'active') return;
    const file = snapshotRule(registration.sourceFile);
    files.push(file);
    parseConstructionRuleFile(file.content, registration.sourceFile, namespace).forEach((rule, ruleRef) => {
      if (rules.has(ruleRef)) throw new Error(`duplicate active rule ID: ${ruleRef}`);
      rules.set(ruleRef, {
        ...rule,
        namespace,
        sourceFile: registration.sourceFile,
        trigger: registration.trigger,
      });
    });
  });

  if (ruleFileExists('.agents/rules/retired.md')) {
    const retiredRefs = parseConstructionRetiredRuleRefs(
      snapshotRule('.agents/rules/retired.md').content,
      index,
    );
    retiredRefs.forEach((ruleRef) => {
      if (rules.has(ruleRef)) throw new Error(`rule ID is both active and retired: ${ruleRef}`);
    });
  }

  files.sort((left, right) => compareStrings(left.path, right.path));
  return { indexFile, index, files, rules };
}

function parseConstructionRetiredRuleRefs(content, index) {
  const refs = new Set();
  for (const match of content.matchAll(/^###\s+([A-Z][A-Z0-9]*-\d{3})\s+(.+?)\s*$/gm)) {
    const ruleRef = match[1];
    const namespace = ruleRef.split('-')[0];
    if (!index.has(namespace)) throw new Error(`retired rule namespace is not registered: ${ruleRef}`);
    if (refs.has(ruleRef)) throw new Error(`duplicate retired rule ID: ${ruleRef}`);
    refs.add(ruleRef);
  }
  return refs;
}

function validateConstructionCatalogSource(catalogSource, rulesCommit, catalog) {
  const source = requireConstructionObject(catalogSource, 'catalogSource');
  const expectedKind = rulesCommit ? 'commit' : 'workspace';
  const expectedFields = rulesCommit
    ? ['kind', 'commit', 'indexHash', 'files']
    : ['kind', 'indexHash', 'files'];
  assertConstructionKeys(source, expectedFields, 'catalogSource');
  if (source.kind !== expectedKind) {
    throw new Error(`catalogSource.kind must equal ${expectedKind}`);
  }
  if (rulesCommit && source.commit !== rulesCommit) {
    throw new Error('catalogSource.commit must equal repository.rulesCommit');
  }
  if (source.indexHash !== catalog.indexFile.contentHash) {
    throw new Error('catalogSource.indexHash does not match the current rule index hash');
  }

  const declaredFiles = constructionArray(source.files, 'catalogSource.files');
  const declaredByPath = new Map();
  declaredFiles.forEach((file, index) => {
    const entry = requireConstructionObject(file, `catalogSource.files.${index}`);
    assertConstructionKeys(entry, ['path', 'contentHash'], `catalogSource.files.${index}`);
    assertSafeRepoRelativePath(entry.path);
    if (!SHA256_RE.test(entry.contentHash || '')) {
      throw new Error(`catalogSource.files.${index}.contentHash must use sha256:<64hex>`);
    }
    if (declaredByPath.has(entry.path)) {
      throw new Error(`catalogSource.files contains duplicate path ${entry.path}`);
    }
    declaredByPath.set(entry.path, entry.contentHash);
  });
  const actualByPath = new Map(catalog.files.map((file) => [file.path, file.contentHash]));
  if (!setsEqual(new Set(declaredByPath.keys()), new Set(actualByPath.keys()))) {
    throw new Error('catalogSource.files paths must equal all active rule files');
  }
  actualByPath.forEach((contentHash, repoPath) => {
    if (declaredByPath.get(repoPath) !== contentHash) {
      throw new Error(`catalogSource.files contentHash does not match current rule file: ${repoPath}`);
    }
  });
}

function parseConstructionRuleIndex(content) {
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === '## Namespaces');
  if (start < 0) throw new Error('rules index is missing the ## Namespaces table');
  const tableLines = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) {
      if (tableLines.length === 0) continue;
      break;
    }
    if (!line.trim().startsWith('|')) {
      if (tableLines.length === 0) continue;
      break;
    }
    tableLines.push(line);
  }
  if (tableLines.length < 2) throw new Error('rules index contains an invalid Namespaces table');
  const header = parseConstructionTableRow(tableLines[0]);
  if (!header || header.join('|') !== 'Namespace|状态|文件|触发条件') {
    throw new Error('rules index Namespaces header is invalid');
  }
  const separator = parseConstructionTableRow(tableLines[1]);
  if (!separator || separator.length !== 4 || !separator.every((cell) => /^:?-{3,}:?$/.test(cell))) {
    throw new Error('rules index Namespaces separator is invalid');
  }

  const registrations = new Map();
  const activeFiles = new Set();
  tableLines.slice(2).forEach((line) => {
    const row = parseConstructionTableRow(line);
    if (!row || row.length !== 4) throw new Error(`invalid namespace row: ${line}`);
    const namespace = stripConstructionTicks(row[0]);
    const status = row[1].trim();
    const file = stripConstructionTicks(row[2]);
    const trigger = row[3].trim();
    if (!/^[A-Z][A-Z0-9]*$/.test(namespace)) throw new Error(`invalid namespace: ${namespace}`);
    if (status !== 'active' && status !== 'retired') throw new Error(`invalid namespace status for ${namespace}: ${status}`);
    if (path.isAbsolute(file) || file.startsWith('./') || file.includes('\\') || file.split('/').includes('..')) {
      throw new Error(`invalid rule file path: ${file}`);
    }
    const sourceFile = `.agents/rules/${file}`;
    assertSafeRepoRelativePath(sourceFile);
    if (status === 'active' && file !== 'always/constraints.md'
      && !/^(concerns|domain)\/(?!README\.md$|retired\.md$|index\.md$)[^/]+\.md$/.test(file)) {
      throw new Error(`invalid active rule file path: ${file}`);
    }
    if (!isNonEmptyString(trigger)) throw new Error(`namespace trigger must be non-empty: ${namespace}`);
    if (registrations.has(namespace)) throw new Error(`duplicate namespace in rules index: ${namespace}`);
    if (status === 'active' && activeFiles.has(sourceFile)) {
      throw new Error(`active rule file is registered more than once: ${sourceFile}`);
    }
    if (status === 'active') activeFiles.add(sourceFile);
    registrations.set(namespace, { status, sourceFile, trigger });
  });
  const core = registrations.get('CORE');
  if (!core || core.status !== 'active' || core.sourceFile !== '.agents/rules/always/constraints.md') {
    throw new Error('CORE namespace must be active and use always/constraints.md');
  }
  return registrations;
}

function parseConstructionTableRow(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return null;
  return trimmed.slice(1, -1).split('|').map((cell) => cell.trim());
}

function stripConstructionTicks(value) {
  const trimmed = value.trim();
  return trimmed.startsWith('`') && trimmed.endsWith('`') ? trimmed.slice(1, -1) : trimmed;
}

function parseConstructionRuleFile(content, sourceFile, namespace) {
  const headings = [...content.matchAll(/^###\s+([A-Z][A-Z0-9]*-\d{3})\s+(.+?)\s*$/gm)];
  const rules = new Map();
  headings.forEach((heading, index) => {
    const ruleRef = heading[1];
    if (rules.has(ruleRef)) throw new Error(`duplicate rule ${ruleRef} in ${sourceFile}`);
    if (namespace && ruleRef.split('-')[0] !== namespace) {
      throw new Error(`active rule ${ruleRef} does not match namespace ${namespace}`);
    }
    const block = content.slice(heading.index, headings[index + 1] ? headings[index + 1].index : content.length);
    const ruleLevel = parseConstructionRuleField(block, '级别');
    if (!RULE_LEVELS.includes(ruleLevel)) throw new Error(`invalid rule level for ${ruleRef}`);
    const passConditions = parseConstructionRuleList(block, '通过条件');
    const evidenceRequirements = parseConstructionRuleList(block, '证据要求');
    const failureConditions = parseConstructionRuleList(block, '失败条件');
    const unverifiableConditions = parseConstructionRuleList(block, '无法验证条件');
    if (passConditions.length === 0) throw new Error(`rule list is empty: 通过条件 for ${ruleRef}`);
    if (evidenceRequirements.length === 0) throw new Error(`rule list is empty: 证据要求 for ${ruleRef}`);
    if (failureConditions.length === 0) throw new Error(`rule list is empty: 失败条件 for ${ruleRef}`);
    if (unverifiableConditions.length === 0) throw new Error(`rule list is empty: 无法验证条件 for ${ruleRef}`);
    rules.set(ruleRef, {
      summary: heading[2].trim(),
      ruleLevel,
      appliesTo: parseConstructionRuleField(block, '生效条件'),
      ruleText: parseConstructionRuleField(block, '规则'),
      failureConditions: failureConditions.map((summary, failureIndex) => ({
        conditionId: `${ruleRef}-FC-${String(failureIndex + 1).padStart(2, '0')}`,
        summary,
      })),
    });
  });
  return rules;
}

function parseConstructionRuleField(block, fieldName) {
  const escaped = fieldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = block.match(new RegExp(`^- ${escaped}：(.+)$`, 'm'));
  if (!match || !match[1].trim()) throw new Error(`rule field is missing: ${fieldName}`);
  return match[1].trim();
}

function parseConstructionRuleList(block, fieldName) {
  const lines = block.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `- ${fieldName}：`);
  if (start < 0) throw new Error(`rule list is missing: ${fieldName}`);
  const items = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const match = lines[index].match(/^\s{2}-\s+(.+?)\s*$/);
    if (match) {
      items.push(match[1]);
      continue;
    }
    if (/^-\s/.test(lines[index]) || /^###\s/.test(lines[index])) break;
  }
  return items;
}

function renderConstructionTemplate(template, values, labelText) {
  if (!isNonEmptyString(template)) throw new Error(`${labelText} must be a non-empty template`);
  const rendered = template.replace(/\{([A-Za-z.]+)\}/g, (_match, key) => {
    if (!Object.prototype.hasOwnProperty.call(values, key) || !isNonEmptyString(values[key])) {
      throw new Error(`${labelText} references unavailable value ${key}`);
    }
    return values[key];
  });
  if (/\{[^{}]+\}/.test(rendered)) throw new Error(`${labelText} contains an unsupported placeholder`);
  return rendered;
}

function requireConstructionObject(value, labelText) {
  if (!isObject(value)) throw new Error(`${labelText} must be an object`);
  return value;
}

function assertConstructionKeys(value, keys, labelText) {
  if (!setsEqual(new Set(Object.keys(value)), new Set(keys))) {
    throw new Error(`${labelText} fields do not match construction-input v2`);
  }
}

function resolveConstructionCommit(root, commit, labelText) {
  if (!GIT_OID_RE.test(commit || '')) throw new Error(`${labelText} must use its normalized commit ID`);
  const resolved = resolveCommit(root, commit);
  if (resolved !== commit) throw new Error(`${labelText} must use its normalized commit ID`);
  return resolved;
}

function constructionArray(value, labelText) {
  if (!Array.isArray(value)) throw new Error(`${labelText} must be an array`);
  return value;
}

function constructionStringSet(value, labelText) {
  const items = constructionArray(value, labelText);
  if (items.some((item) => !isNonEmptyString(item))) throw new Error(`${labelText} must contain non-empty strings`);
  if (new Set(items).size !== items.length) throw new Error(`${labelText} must contain unique values`);
  return [...items];
}

function assertExpectedConstructionCounts(expectedCounts, dispatch) {
  const expected = requireConstructionObject(expectedCounts, 'expectedCounts');
  const actual = {
    candidateRuleRefs: asArray(dispatch.ruleSet && dispatch.ruleSet.candidateRuleRefs).length,
    selectedRuleRefs: asArray(dispatch.ruleSet && dispatch.ruleSet.selectedRuleRefs).length,
    excludedRuleRefs: asArray(dispatch.ruleSet && dispatch.ruleSet.excludedRuleRefs).length,
    globallyNotApplicableRuleRefs: asArray(dispatch.ruleSet && dispatch.ruleSet.globallyNotApplicableRuleRefs).length,
    changedUnits: asArray(dispatch.targets && dispatch.targets.changedUnits).length,
    candidates: asArray(dispatch.targets && dispatch.targets.candidates).length,
    targets: asArray(dispatch.targets && dispatch.targets.changedUnits).length + asArray(dispatch.targets && dispatch.targets.candidates).length,
    applicabilityMatrix: asArray(dispatch.applicabilityMatrix).length,
    reviewItems: asArray(dispatch.reviewItems).length,
    reviewBatches: asArray(dispatch.reviewBatches).length,
  };
  if (!setsEqual(new Set(Object.keys(expected)), new Set(Object.keys(actual)))) {
    throw new Error('expectedCounts must declare every supported construction count exactly once');
  }
  Object.entries(actual).forEach(([field, value]) => {
    if (expected[field] !== value) throw new Error(`expectedCounts.${field} expected ${expected[field]} but constructed ${value}`);
  });
}

function sealDispatchMode(args, result) {
  const draft = readJson(args.input, args.input, result, 'D001');
  if (!draft) return;
  if (draft.schemaVersion !== SCHEMA_VERSION) {
    addViolation(result, 'SD001', args.input, '/schemaVersion', `seal-dispatch only accepts schemaVersion ${SCHEMA_VERSION} rules-review drafts`, SCHEMA_VERSION, draft.schemaVersion, 2);
    return;
  }

  let sealed;
  try {
    const { root } = loadRepository(args.input);
    sealed = sealDispatchDraft(draft, args, root);
  } catch (error) {
    addViolation(result, 'SD002', args.input, null, `seal-dispatch failed closed: ${error.message}`, 'unambiguous Git base, committed TARGET, and rule source', error.message, 2);
    return;
  }

  validateDispatch(sealed, args.input, result, args.input);
  if (result.violations.length > 0) return;
  atomicWriteFile(args.input, `${JSON.stringify(sealed, null, 2)}\n`);
  result.rendered = args.input;
}

function sealDispatchDraft(draft, args, root, constructionSnapshotRule, constructionRulePaths) {
  if (draft.reviewRange && Object.prototype.hasOwnProperty.call(draft.reviewRange, 'targetTree')) {
    throw new Error('sealed dispatch cannot be resealed; create a fresh run for a new TARGET');
  }
  if (Object.prototype.hasOwnProperty.call(draft, 'ruleInputSource')) {
    throw new Error('draft dispatch must not declare ruleInputSource; seal-dispatch derives it from --rules-commit');
  }
  if (!isNonEmptyString(args.base)) throw new Error('seal-dispatch requires --base <revision>');
  const unsupportedSelectors = ['current', 'staged', 'target-tree']
    .filter((name) => args[name] !== undefined);
  if (unsupportedSelectors.length > 0) {
    throw new Error(`rules-review only accepts committed TARGETs; unsupported selector(s): ${unsupportedSelectors.join(', ')}`);
  }
  if (!isNonEmptyString(args['target-commit'])) throw new Error('seal-dispatch requires --target-commit <revision>');

  const baseCommit = resolveCommit(root, args.base);
  const baseTree = resolveTree(root, `${baseCommit}^{tree}`);
  const boundCommit = resolveCommit(root, args['target-commit']);
  const targetTree = resolveTree(root, `${boundCommit}^{tree}`);
  let ruleInputSource;
  let snapshotRule;
  let ruleFileExists;
  if (args['rules-commit'] === undefined) {
    ruleInputSource = { kind: 'workspace' };
    snapshotRule = constructionSnapshotRule || ((repoPath) => snapshotWorkspaceRuleFile(root, repoPath));
    ruleFileExists = (repoPath) => fs.existsSync(path.resolve(root, ...repoPath.split('/')));
  } else {
    if (!isNonEmptyString(args['rules-commit'])) throw new Error('--rules-commit requires a Git revision');
    const rulesCommit = resolveCommit(root, args['rules-commit']);
    const rulesTree = resolveTree(root, `${rulesCommit}^{tree}`);
    ruleInputSource = { kind: 'commit', commit: rulesCommit };
    snapshotRule = constructionSnapshotRule || ((repoPath) => snapshotRuleFile(root, rulesTree, repoPath));
    ruleFileExists = (repoPath) => readTreeEntry(root, rulesTree, repoPath).state === 'present';
  }
  snapshotRule = memoizeConstructionRuleSnapshot(snapshotRule);

  const sealed = JSON.parse(JSON.stringify(draft));
  sealed.ruleInputSource = ruleInputSource;
  const excludedFiles = validateSealingExcludedFiles(sealed.reviewRange && sealed.reviewRange.excludedFiles);
  if (excludedFiles.length > 0) throw new Error('commit-only rules-review requires reviewRange.excludedFiles to be exactly []');
  const changedFiles = listTreeChangedFiles(root, baseTree, targetTree);
  assertRegularChangedEntries(root, baseTree, targetTree, changedFiles);
  sealed.reviewRange = {
    baseCommit,
    baseTree,
    targetTree,
    boundCommit,
    excludedFiles,
  };
  sealed.inputSnapshot = {
    files: collectDeclaredInputRefs(sealed)
      .sort(compareStrings)
      .map((repoPath) => snapshotTreeInput(root, targetTree, repoPath)),
  };

  if (!isObject(sealed.ruleSet)) throw new Error('dispatch.ruleSet must be an object before sealing');
  if (!Array.isArray(sealed.ruleSet.ruleSources)) throw new Error('dispatch.ruleSet.ruleSources must be an array before sealing');
  let rulePaths;
  if (constructionRulePaths) {
    rulePaths = [...constructionRulePaths];
  } else {
    const catalog = buildConstructionRuleCatalog(snapshotRule, ruleFileExists);
    const candidateRuleRefs = new Set(asArray(sealed.ruleSet.candidateRuleRefs));
    if (!setsEqual(candidateRuleRefs, new Set(catalog.rules.keys()))) {
      throw new Error('dispatch.ruleSet.candidateRuleRefs must equal all active rule IDs');
    }
    rulePaths = ['.agents/rules/index.md', ...catalog.files.map((file) => file.path)];
  }
  sealed.ruleSet.ruleSources.forEach((source, index) => {
    if (!isNonEmptyString(source && source.sourceFile)) throw new Error(`ruleSources[${index}].sourceFile must be a non-empty repository path`);
    assertSafeRepoRelativePath(source.sourceFile);
    rulePaths.push(source.sourceFile);
  });
  sealed.ruleSnapshot = {
    files: [...new Set(rulePaths)].sort(compareStrings).map(snapshotRule),
  };
  const ruleSnapshotByPath = new Map(sealed.ruleSnapshot.files.map((entry) => [entry.path, entry]));
  sealed.ruleSet.sourceIndexHash = ruleSnapshotByPath.get('.agents/rules/index.md').contentHash;
  sealed.ruleSet.ruleSources.forEach((source) => {
    source.sourceHash = ruleSnapshotByPath.get(source.sourceFile).contentHash;
  });
  return sealed;
}

function atomicWriteFile(filePath, content) {
  const temporary = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`);
  try {
    fs.writeFileSync(temporary, content, { flag: 'wx' });
    fs.renameSync(temporary, filePath);
  } finally {
    try {
      fs.unlinkSync(temporary);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

function git(root, args, options = {}) {
  return execFileSync('git', ['-C', root, ...args], {
    maxBuffer: 64 * 1024 * 1024,
    ...options,
    env: { ...process.env, ...options.env, GIT_NO_LAZY_FETCH: '1' },
  });
}

function validateSealingExcludedFiles(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('reviewRange.excludedFiles must be an array');
  const seen = new Set();
  return value.map((repoPath) => {
    assertSafeRepoRelativePath(repoPath);
    if (seen.has(repoPath)) throw new Error(`reviewRange.excludedFiles contains duplicate path ${repoPath}`);
    seen.add(repoPath);
    return repoPath;
  }).sort(compareStrings);
}

function assertRegularChangedEntries(root, baseTree, targetTree, changedFiles) {
  changedFiles.forEach((repoPath) => {
    [readTreeEntry(root, baseTree, repoPath), readTreeEntry(root, targetTree, repoPath)].forEach((entry) => {
      if (entry.state === 'present' && !['100644', '100755'].includes(entry.mode)) {
        throw new Error(`changed path must be a regular blob: ${repoPath}`);
      }
    });
  });
}

function validateDispatchSchemaVersion(dispatch, artifact, result) {
  if (!isObject(dispatch) || dispatch.schemaVersion !== SCHEMA_VERSION) {
    addViolation(result, 'D003', artifact, '/schemaVersion', 'dispatch schemaVersion must match rules-review protocol', SCHEMA_VERSION, dispatch && dispatch.schemaVersion);
  }
}

function collectDeclaredInputRefs(dispatch) {
  const refs = new Set();
  const targets = [
    ...asArray(dispatch && dispatch.targets && dispatch.targets.changedUnits),
    ...asArray(dispatch && dispatch.targets && dispatch.targets.candidates),
  ];
  targets.forEach((target, index) => {
    if (target && target.inputRefs === undefined) return;
    if (!Array.isArray(target && target.inputRefs)) throw new Error(`target[${index}].inputRefs must be an array`);
    const targetRefs = new Set();
    target.inputRefs.forEach((repoPath) => {
      assertSafeRepoRelativePath(repoPath);
      if (targetRefs.has(repoPath)) throw new Error(`target[${index}].inputRefs contains duplicate path ${repoPath}`);
      targetRefs.add(repoPath);
      refs.add(repoPath);
    });
  });
  return [...refs];
}

function loadRepository(dispatchPath) {
  if (!isNonEmptyString(dispatchPath)) throw new Error('dispatch path is required');
  const absoluteDispatchPath = path.resolve(dispatchPath);
  const dispatchStat = fs.lstatSync(absoluteDispatchPath);
  if (dispatchStat.isSymbolicLink() || !dispatchStat.isFile()) throw new Error('dispatch input must be a regular non-symlink file');
  const realDispatchPath = fs.realpathSync.native(absoluteDispatchPath);
  const rootOutput = execFileSync('git', ['-C', path.dirname(realDispatchPath), 'rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  }).trim();
  if (!rootOutput || rootOutput.includes('\n')) throw new Error('unable to determine a single Git worktree root');
  const root = fs.realpathSync.native(rootOutput);
  assertPathInsideRoot(root, realDispatchPath, 'dispatch input');
  return { root, dispatchPath: realDispatchPath };
}

function assertSafeRepoRelativePath(repoPath) {
  if (!isNonEmptyString(repoPath)) throw new Error('repository path must be a non-empty string');
  if (repoPath.includes('\\') || repoPath.includes('\0')) throw new Error(`unsafe repository path: ${repoPath}`);
  if (path.posix.isAbsolute(repoPath) || /^[A-Za-z]:\//.test(repoPath)) throw new Error(`absolute repository path is forbidden: ${repoPath}`);
  const segments = repoPath.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) throw new Error(`unsafe repository path segments: ${repoPath}`);
  if (path.posix.normalize(repoPath) !== repoPath) throw new Error(`non-canonical repository path: ${repoPath}`);
}

function assertPathInsideRoot(root, candidate, labelText) {
  const relative = path.relative(root, candidate);
  if (relative === '' || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
    throw new Error(`${labelText} must be inside the current Git worktree`);
  }
}

function hashBytes(bytes) {
  return `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
}

function normalizeGitOid(value, labelText) {
  if (!GIT_OID_RE.test(value || '')) throw new Error(`${labelText} did not resolve to one normalized Git object ID`);
  return value;
}

function resolveCommit(root, revision) {
  if (!isNonEmptyString(revision)) throw new Error('Git commit must be a non-empty revision');
  return normalizeGitOid(git(root, ['rev-parse', '--verify', '--end-of-options', `${revision}^{commit}`], { encoding: 'utf8' }).trim(), `Git commit ${revision}`);
}

function resolveTree(root, revision) {
  if (!isNonEmptyString(revision)) throw new Error('Git tree revision must be non-empty');
  const tree = normalizeGitOid(git(root, ['rev-parse', '--verify', '--end-of-options', revision], { encoding: 'utf8' }).trim(), `Git tree ${revision}`);
  if (git(root, ['cat-file', '-t', tree], { encoding: 'utf8' }).trim() !== 'tree') throw new Error(`${revision} is not a Git tree`);
  return tree;
}

function resolveNormalizedTreeObject(root, revision) {
  if (!GIT_OID_RE.test(revision || '')) throw new Error('tree must be a normalized 40 or 64 character lowercase object ID');
  const objectId = normalizeGitOid(git(root, ['rev-parse', '--verify', '--end-of-options', revision], { encoding: 'utf8' }).trim(), `Git object ${revision}`);
  if (objectId !== revision) throw new Error('tree must use its normalized object ID');
  if (git(root, ['cat-file', '-t', objectId], { encoding: 'utf8' }).trim() !== 'tree') throw new Error(`object must be a tree: ${revision}`);
  return objectId;
}

function listTreeChangedFiles(root, baseTree, targetTree) {
  const output = git(root, ['diff', '--name-only', '--no-renames', '-z', baseTree, targetTree, '--']);
  const bytes = Buffer.from(output);
  if (bytes.length > 0 && bytes.at(-1) !== 0) throw new Error('Git tree file inventory is not NUL terminated');
  const files = bytes.length === 0 ? [] : bytes.subarray(0, -1).toString('utf8').split('\0');
  return [...new Set(files.map((repoPath) => {
    assertSafeRepoRelativePath(repoPath);
    return repoPath;
  }))].sort(compareStrings);
}

function readTreeEntry(root, tree, repoPath) {
  assertSafeRepoRelativePath(repoPath);
  const output = Buffer.from(git(root, [
    '--literal-pathspecs',
    'ls-tree',
    '-z',
    tree,
    '--',
    repoPath,
  ]));
  if (output.length === 0) return { state: 'deleted' };
  if (output.at(-1) !== 0 || output.subarray(0, -1).includes(0)) throw new Error(`Git tree lookup returned multiple entries for ${repoPath}`);
  const record = output.subarray(0, -1);
  const tab = record.indexOf(9);
  if (tab < 0) throw new Error(`Git tree lookup returned invalid metadata for ${repoPath}`);
  const [mode, type, objectId] = record.subarray(0, tab).toString('ascii').split(' ');
  const actualPath = record.subarray(tab + 1).toString('utf8');
  if (actualPath !== repoPath) throw new Error(`Git tree lookup path mismatch for ${repoPath}`);
  return { state: 'present', mode, type, objectId: normalizeGitOid(objectId, `Git entry ${repoPath}`) };
}

function readTreeBlob(root, tree, repoPath) {
  const entry = readTreeEntry(root, tree, repoPath);
  if (entry.state !== 'present') throw new Error(`required tree input is missing: ${repoPath}`);
  if (!['100644', '100755'].includes(entry.mode) || entry.type !== 'blob') throw new Error(`Git tree input must be a regular file at ${repoPath}`);
  return { ...entry, content: git(root, ['cat-file', 'blob', entry.objectId]) };
}

function snapshotTreeInput(root, tree, repoPath) {
  const entry = readTreeEntry(root, tree, repoPath);
  if (entry.state === 'deleted') return { inputRef: repoPath, state: 'deleted' };
  const blob = readTreeBlob(root, tree, repoPath);
  return { inputRef: repoPath, state: 'present', mode: blob.mode, contentHash: hashBytes(blob.content) };
}

function snapshotRuleFile(root, tree, repoPath) {
  const blob = readTreeBlob(root, tree, repoPath);
  const content = blob.content.toString('utf8');
  if (!Buffer.from(content, 'utf8').equals(blob.content)) throw new Error(`rule snapshot must be valid UTF-8 text: ${repoPath}`);
  return { path: repoPath, content, contentHash: hashBytes(blob.content) };
}

function snapshotWorkspaceRuleFile(root, repoPath) {
  assertSafeRepoRelativePath(repoPath);
  const filePath = path.resolve(root, ...repoPath.split('/'));
  assertPathInsideRoot(root, filePath, `workspace rule ${repoPath}`);
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`workspace rule input must be a regular non-symlink file: ${repoPath}`);
  const realPath = fs.realpathSync(filePath);
  assertPathInsideRoot(root, realPath, `workspace rule ${repoPath}`);
  const bytes = fs.readFileSync(realPath);
  const content = bytes.toString('utf8');
  if (!Buffer.from(content, 'utf8').equals(bytes)) throw new Error(`rule snapshot must be valid UTF-8 text: ${repoPath}`);
  return { path: repoPath, content, contentHash: hashBytes(bytes) };
}

function validateSealedInputShape(dispatch, reviewItems, artifact, result, fullRuleCatalog = false) {
  validateReviewRangeShape(dispatch.reviewRange, artifact, result);
  const referencedTargetIds = new Set([...reviewItems.values()].map((item) => item && item.targetId).filter(Boolean));
  const allInputRefs = new Set();
  const targetGroups = [
    ['changedUnits', asArray(dispatch.targets && dispatch.targets.changedUnits)],
    ['candidates', asArray(dispatch.targets && dispatch.targets.candidates)],
  ];
  targetGroups.forEach(([group, entries]) => {
    entries.forEach((target, index) => {
      const pointer = `/targets/${group}/${index}/inputRefs`;
      const required = group === 'changedUnits' || referencedTargetIds.has(target && target.targetId);
      const refs = validateRepoPathArray(target && target.inputRefs, artifact, result, 'D202', pointer, !required);
      if (required && refs.length === 0) addViolation(result, 'D203', artifact, pointer, 'changedUnits and reviewItem targets require non-empty inputRefs', 'non-empty inputRefs', target && target.inputRefs);
      refs.forEach((repoPath) => {
        if (isRuleInputPath(repoPath)) {
          addViolation(result, 'D217', artifact, pointer, 'inputRefs must exclude rule input paths', 'code/config/contract path', repoPath);
        }
        allInputRefs.add(repoPath);
      });
    });
  });

  const snapshotFiles = dispatch.inputSnapshot && dispatch.inputSnapshot.files;
  if (!isObject(dispatch.inputSnapshot)) addViolation(result, 'D204', artifact, '/inputSnapshot', 'inputSnapshot must be object', 'object', dispatch.inputSnapshot);
  if (!Array.isArray(snapshotFiles)) addViolation(result, 'D205', artifact, '/inputSnapshot/files', 'inputSnapshot.files must be array', 'array', snapshotFiles);
  const snapshotPaths = new Set();
  asArray(snapshotFiles).forEach((entry, index) => {
    const pointer = `/inputSnapshot/files/${index}`;
    requireFields(entry, artifact, result, 'D206', pointer, ['inputRef', 'state']);
    const repoPath = entry && entry.inputRef;
    try {
      assertSafeRepoRelativePath(repoPath);
    } catch (error) {
      addViolation(result, 'D207', artifact, `${pointer}/inputRef`, error.message, 'safe repository-relative POSIX path', repoPath);
      return;
    }
    if (snapshotPaths.has(repoPath)) addViolation(result, 'D208', artifact, `${pointer}/inputRef`, 'inputSnapshot inputRef must be unique', 'unique inputRef', repoPath);
    snapshotPaths.add(repoPath);
    if (!['present', 'deleted'].includes(entry.state)) addViolation(result, 'D209', artifact, `${pointer}/state`, 'snapshot state must be present or deleted', ['present', 'deleted'], entry.state);
    if (entry.state === 'present') {
      if (!['100644', '100755'].includes(entry.mode)) addViolation(result, 'D210', artifact, `${pointer}/mode`, 'present snapshot requires regular blob mode', ['100644', '100755'], entry.mode);
      if (!SHA256_RE.test(entry.contentHash || '')) addViolation(result, 'D210', artifact, `${pointer}/contentHash`, 'present snapshot requires sha256 contentHash', 'sha256:<64hex>', entry.contentHash);
    }
    if (entry.state === 'deleted') {
      if (Object.prototype.hasOwnProperty.call(entry, 'mode')) addViolation(result, 'D211', artifact, `${pointer}/mode`, 'deleted snapshot forbids mode', 'field absent', entry.mode);
      if (Object.prototype.hasOwnProperty.call(entry, 'contentHash')) addViolation(result, 'D211', artifact, `${pointer}/contentHash`, 'deleted snapshot forbids contentHash', 'field absent', entry.contentHash);
    }
  });
  if (!setsEqual(allInputRefs, snapshotPaths)) addViolation(result, 'D212', artifact, '/inputSnapshot/files', 'inputSnapshot inputRefs must exactly equal declared target inputRefs', [...allInputRefs].sort(compareStrings), [...snapshotPaths].sort(compareStrings));

  if (!SHA256_RE.test((dispatch.ruleSet && dispatch.ruleSet.sourceIndexHash) || '')) addViolation(result, 'D214', artifact, '/ruleSet/sourceIndexHash', 'sourceIndexHash must use sha256:<64hex>', 'sha256:<64hex>', dispatch.ruleSet && dispatch.ruleSet.sourceIndexHash);
  const sourceHashes = new Map();
  asArray(dispatch.ruleSet && dispatch.ruleSet.ruleSources).forEach((source, index) => {
    try {
      assertSafeRepoRelativePath(source && source.sourceFile);
    } catch (error) {
      addViolation(result, 'D215', artifact, `/ruleSet/ruleSources/${index}/sourceFile`, error.message, 'safe repository-relative POSIX path', source && source.sourceFile);
    }
    if (!SHA256_RE.test((source && source.sourceHash) || '')) addViolation(result, 'D216', artifact, `/ruleSet/ruleSources/${index}/sourceHash`, 'sourceHash must use sha256:<64hex>', 'sha256:<64hex>', source && source.sourceHash);
    if (isNonEmptyString(source && source.sourceFile)) {
      if (!sourceHashes.has(source.sourceFile)) {
        sourceHashes.set(source.sourceFile, source.sourceHash);
      } else if (sourceHashes.get(source.sourceFile) !== source.sourceHash) {
        addViolation(result, 'D218', artifact, `/ruleSet/ruleSources/${index}/sourceHash`, 'ruleSources with the same sourceFile must use the same sourceHash', sourceHashes.get(source.sourceFile), source.sourceHash);
      }
    }
  });
  validateRuleSnapshotShape(dispatch, artifact, result, fullRuleCatalog);
}

function validateReviewRangeShape(reviewRange, artifact, result) {
  if (!isObject(reviewRange)) {
    addViolation(result, 'D230', artifact, '/reviewRange', 'reviewRange must be an object', 'object', reviewRange);
    return;
  }
  const required = ['baseCommit', 'baseTree', 'targetTree', 'boundCommit', 'excludedFiles'];
  const allowed = required;
  requireFields(reviewRange, artifact, result, 'D231', '/reviewRange', required);
  rejectUnsupportedFields(reviewRange, artifact, result, 'D232', '/reviewRange', allowed, 'reviewRange');
  ['baseCommit', 'baseTree', 'targetTree', 'boundCommit'].forEach((field) => {
    if (reviewRange[field] !== undefined && !GIT_OID_RE.test(reviewRange[field])) {
      addViolation(result, 'D233', artifact, `/reviewRange/${field}`, `${field} must be a normalized Git object ID`, '40 or 64 lowercase hex', reviewRange[field]);
    }
  });
  validateRepoPathArray(reviewRange.excludedFiles, artifact, result, 'D234', '/reviewRange/excludedFiles');
  if (asArray(reviewRange.excludedFiles).length > 0) {
    addViolation(result, 'D245', artifact, '/reviewRange/excludedFiles', 'commit-only rules-review requires the complete commit range', [], reviewRange.excludedFiles);
  }
}

function validateRuleInputSource(ruleInputSource, artifact, result, code) {
  if (!isObject(ruleInputSource)) {
    addViolation(result, code, artifact, '/ruleInputSource', 'ruleInputSource must be an object', 'workspace or commit rule source', ruleInputSource);
    return;
  }
  if (ruleInputSource.kind === 'workspace') {
    requireFields(ruleInputSource, artifact, result, code, '/ruleInputSource', ['kind']);
    rejectUnsupportedFields(ruleInputSource, artifact, result, code, '/ruleInputSource', ['kind'], 'workspace ruleInputSource');
    return;
  }
  if (ruleInputSource.kind === 'commit') {
    requireFields(ruleInputSource, artifact, result, code, '/ruleInputSource', ['kind', 'commit']);
    rejectUnsupportedFields(ruleInputSource, artifact, result, code, '/ruleInputSource', ['kind', 'commit'], 'commit ruleInputSource');
    if (!GIT_OID_RE.test(ruleInputSource.commit || '')) {
      addViolation(result, code, artifact, '/ruleInputSource/commit', 'ruleInputSource commit must be a normalized Git commit ID', '40 or 64 lowercase hex', ruleInputSource.commit);
    }
    return;
  }
  addViolation(result, code, artifact, '/ruleInputSource/kind', 'ruleInputSource kind must be workspace or commit', ['workspace', 'commit'], ruleInputSource.kind);
}

function validateRuleSnapshotShape(dispatch, artifact, result, fullRuleCatalog = false) {
  const snapshot = dispatch && dispatch.ruleSnapshot;
  if (!isObject(snapshot) || !Array.isArray(snapshot.files)) {
    addViolation(result, 'D235', artifact, '/ruleSnapshot/files', 'ruleSnapshot.files must be an array', 'array', snapshot && snapshot.files);
    return;
  }
  let expectedPaths = new Set(['.agents/rules/index.md', ...asArray(dispatch.ruleSet && dispatch.ruleSet.ruleSources).map((source) => source && source.sourceFile).filter(Boolean)]);
  const actualPaths = new Set();
  snapshot.files.forEach((entry, index) => {
    const pointer = `/ruleSnapshot/files/${index}`;
    requireFields(entry, artifact, result, 'D236', pointer, ['path', 'content', 'contentHash']);
    try {
      assertSafeRepoRelativePath(entry && entry.path);
    } catch (error) {
      addViolation(result, 'D237', artifact, `${pointer}/path`, error.message, 'safe repository path', entry && entry.path);
      return;
    }
    if (actualPaths.has(entry.path)) addViolation(result, 'D238', artifact, `${pointer}/path`, 'ruleSnapshot paths must be unique', 'unique path', entry.path);
    actualPaths.add(entry.path);
    if (typeof entry.content !== 'string') addViolation(result, 'D239', artifact, `${pointer}/content`, 'ruleSnapshot content must be text', 'string', entry.content);
    const contentHash = typeof entry.content === 'string' ? hashBytes(Buffer.from(entry.content, 'utf8')) : null;
    if (!SHA256_RE.test(entry.contentHash || '') || entry.contentHash !== contentHash) {
      addViolation(result, 'D239', artifact, `${pointer}/contentHash`, 'ruleSnapshot contentHash must match content bytes', contentHash, entry.contentHash);
    }
  });
  const byPath = new Map(snapshot.files.map((entry) => [entry && entry.path, entry]));
  if (fullRuleCatalog) {
    try {
      const catalog = deriveDispatchRuleCatalog(byPath);
      expectedPaths = catalog.paths;
      const candidateRuleRefs = new Set(asArray(dispatch.ruleSet && dispatch.ruleSet.candidateRuleRefs));
      if (!setsEqual(candidateRuleRefs, new Set(catalog.rules.keys()))) {
        addViolation(result, 'D248', artifact, '/ruleSet/candidateRuleRefs', 'candidateRuleRefs must equal active rule IDs recomputed from ruleSnapshot', [...catalog.rules.keys()].sort(compareStrings), [...candidateRuleRefs].sort(compareStrings));
      }
      asArray(dispatch.ruleSet && dispatch.ruleSet.ruleSources).forEach((source, index) => {
        const rule = catalog.rules.get(source && source.ruleRef);
        if (rule && (source.sourceFile !== rule.sourceFile || source.namespace !== rule.namespace)) {
          addViolation(result, 'D249', artifact, `/ruleSet/ruleSources/${index}`, 'rule source identity must match ruleSnapshot catalog', { namespace: rule.namespace, sourceFile: rule.sourceFile }, { namespace: source.namespace, sourceFile: source.sourceFile });
        }
      });
    } catch (error) {
      addViolation(result, 'D247', artifact, '/ruleSnapshot', `cannot recompute active rule catalog from ruleSnapshot: ${error.message}`, 'valid rule-steward index and all active rule files', error.message);
    }
  }
  if (!setsEqual(expectedPaths, actualPaths)) addViolation(result, 'D242', artifact, '/ruleSnapshot/files', fullRuleCatalog ? 'ruleSnapshot must exactly cover the rule index and all active rule files' : 'ruleSnapshot must exactly cover the rule index and rule source files', [...expectedPaths].sort(compareStrings), [...actualPaths].sort(compareStrings));
  if (dispatch.ruleSet && byPath.get('.agents/rules/index.md') && dispatch.ruleSet.sourceIndexHash !== byPath.get('.agents/rules/index.md').contentHash) {
    addViolation(result, 'D243', artifact, '/ruleSet/sourceIndexHash', 'sourceIndexHash must equal sealed rule index snapshot', byPath.get('.agents/rules/index.md').contentHash, dispatch.ruleSet.sourceIndexHash);
  }
  asArray(dispatch.ruleSet && dispatch.ruleSet.ruleSources).forEach((source, index) => {
    const file = byPath.get(source && source.sourceFile);
    if (file && source.sourceHash !== file.contentHash) {
      addViolation(result, 'D244', artifact, `/ruleSet/ruleSources/${index}/sourceHash`, 'sourceHash must equal sealed rule source snapshot', file.contentHash, source.sourceHash);
    }
  });
}

function deriveDispatchRuleCatalog(byPath) {
  const indexFile = byPath.get('.agents/rules/index.md');
  if (!indexFile || typeof indexFile.content !== 'string') throw new Error('missing rule index snapshot');
  const index = parseConstructionRuleIndex(indexFile.content);
  const paths = new Set(['.agents/rules/index.md']);
  const rules = new Map();
  index.forEach((registration, namespace) => {
    if (registration.status !== 'active') return;
    paths.add(registration.sourceFile);
    const file = byPath.get(registration.sourceFile);
    if (!file || typeof file.content !== 'string') {
      throw new Error(`missing active rule file snapshot: ${registration.sourceFile}`);
    }
    parseConstructionRuleFile(file.content, registration.sourceFile, namespace).forEach((rule, ruleRef) => {
      if (rules.has(ruleRef)) throw new Error(`duplicate active rule ID: ${ruleRef}`);
      rules.set(ruleRef, {
        ...rule,
        namespace,
        sourceFile: registration.sourceFile,
      });
    });
  });
  return { paths, rules };
}

function validateRepoPathArray(value, artifact, result, code, pointer, optional = false) {
  if (optional && value === undefined) return [];
  if (!Array.isArray(value)) {
    addViolation(result, code, artifact, pointer, 'value must be an array of safe repository paths', 'array', value);
    return [];
  }
  const seen = new Set();
  const valid = [];
  value.forEach((repoPath, index) => {
    try {
      assertSafeRepoRelativePath(repoPath);
    } catch (error) {
      addViolation(result, code, artifact, `${pointer}/${index}`, error.message, 'safe repository-relative POSIX path', repoPath);
      return;
    }
    if (seen.has(repoPath)) {
      addViolation(result, code, artifact, `${pointer}/${index}`, 'repository paths must be unique', 'unique paths', repoPath);
      return;
    }
    seen.add(repoPath);
    valid.push(repoPath);
  });
  return valid;
}

function verifyTreeDispatchInputs(dispatch, currentInputPath, artifact, result) {
  try {
    const { root } = loadRepository(currentInputPath);
    const range = dispatch.reviewRange;
    const baseCommit = resolveCommit(root, range.baseCommit);
    const baseTree = resolveTree(root, range.baseTree);
    const targetTree = resolveNormalizedTreeObject(root, range.targetTree);
    if (baseCommit !== range.baseCommit || baseTree !== range.baseTree || targetTree !== range.targetTree) throw new Error('reviewRange objects must use normalized IDs');
    if (resolveTree(root, `${baseCommit}^{tree}`) !== baseTree) throw new Error('baseCommit tree does not match baseTree');
    const boundCommit = resolveCommit(root, range.boundCommit);
    if (boundCommit !== range.boundCommit) throw new Error('boundCommit must use its normalized commit ID');
    if (resolveTree(root, `${boundCommit}^{tree}`) !== targetTree) throw new Error('boundCommit tree does not match targetTree');

    const changedFiles = listTreeChangedFiles(root, baseTree, targetTree);
    assertRegularChangedEntries(root, baseTree, targetTree, changedFiles);
    const changedUnitRefs = new Set(asArray(dispatch.targets && dispatch.targets.changedUnits).flatMap((target) => asArray(target && target.inputRefs)));
    changedFiles.filter((repoPath) => !isRuleInputPath(repoPath)).forEach((repoPath) => {
      if (!changedUnitRefs.has(repoPath)) throw new Error(`targetTree changed file is not covered by changedUnits.inputRefs: ${repoPath}`);
    });

    asArray(dispatch.inputSnapshot && dispatch.inputSnapshot.files).forEach((entry) => {
      if (!entry || !isNonEmptyString(entry.inputRef)) throw new Error('inputSnapshot contains an invalid inputRef');
      const actual = snapshotTreeInput(root, targetTree, entry.inputRef);
      if (canonicalStringify(actual) !== canonicalStringify(entry)) {
        throw new Error(`targetTree input snapshot mismatch for ${entry.inputRef}`);
      }
    });

    verifyRuleSnapshotSource(root, dispatch.ruleInputSource, dispatch.ruleSnapshot && dispatch.ruleSnapshot.files, 'dispatch');
  } catch (error) {
    addViolation(result, 'D240', artifact, null, `Git tree input verification failed closed: ${error.message}`, 'sealed baseTree, targetTree, blobs, and snapshots', error.message, 2);
  }
}

function verifyRuleSnapshotSource(root, ruleInputSource, files, labelText) {
  if (ruleInputSource && ruleInputSource.kind === 'workspace') return;
  if (!ruleInputSource || ruleInputSource.kind !== 'commit') throw new Error(`${labelText} ruleInputSource is invalid`);
  const rulesCommit = resolveCommit(root, ruleInputSource.commit);
  if (rulesCommit !== ruleInputSource.commit) throw new Error(`${labelText} ruleInputSource commit must use its normalized commit ID`);
  const rulesTree = resolveTree(root, `${rulesCommit}^{tree}`);
  asArray(files).forEach((entry) => {
    const actual = snapshotRuleFile(root, rulesTree, entry.path);
    if (canonicalStringify(actual) !== canonicalStringify(entry)) {
      throw new Error(`${labelText} rules commit snapshot mismatch for ${entry.path}`);
    }
  });
}

function isRuleInputPath(repoPath) {
  return repoPath === '.agents/rules' || repoPath.startsWith('.agents/rules/');
}

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function validateDispatch(dispatch, artifact, result, currentInputPath = artifact) {
  expectKind(dispatch, artifact, result, 'D002', 'rules-review-dispatch');
  validateDispatchSchemaVersion(dispatch, artifact, result);
  const requiredFields = ['kind', 'schemaVersion', 'runId', 'reviewRange', 'ruleInputSource', 'ruleSnapshot', 'inputSnapshot', 'ruleSet', 'targets', 'applicabilityMatrix', 'reviewItems', 'reviewBatches'];
  requireFields(dispatch, artifact, result, 'D004', '', requiredFields);
  rejectUnsupportedFields(dispatch, artifact, result, 'D006', '', requiredFields, 'dispatch');
  if (!isRunId(dispatch && dispatch.runId)) addViolation(result, 'D005', artifact, '/runId', 'runId must match YYYYMMDDTHHmmssZ-rr-xxxxxxxx', 'UTC timestamp + rr + 8 lowercase hex characters', dispatch && dispatch.runId);
  validateRuleInputSource(dispatch && dispatch.ruleInputSource, artifact, result, 'D246');

  const ruleSet = validateRuleSet(dispatch.ruleSet, artifact, result);
  const targets = validateTargets(dispatch.targets, artifact, result);
  const reviewItems = validateReviewItems(dispatch.reviewItems, ruleSet, targets, artifact, result);
  validateApplicabilityMatrix(dispatch.applicabilityMatrix, ruleSet, targets, reviewItems, artifact, result);
  validateRequiredContextCoverage(ruleSet, dispatch.targets, artifact, result);
  validateReviewBatches(dispatch, reviewItems, artifact, result);
  validateSealedInputShape(dispatch, reviewItems, artifact, result, true);
  verifyTreeDispatchInputs(dispatch, currentInputPath, artifact, result);
}

function validateRuleSet(ruleSet, artifact, result) {
  const empty = {
    ruleSetId: null,
    candidateRuleRefs: new Set(),
    selectedRuleRefs: new Set(),
    excludedRuleRefs: new Set(),
    globallyNotApplicableRuleRefs: new Set(),
    ruleSourcesByRuleRef: new Map(),
  };
  if (!isObject(ruleSet)) {
    addViolation(result, 'D010', artifact, '/ruleSet', 'ruleSet must be object', 'object', ruleSet);
    return empty;
  }

  const fields = [
    'ruleSetId',
    'sourceIndexHash',
    'candidateRuleRefs',
    'selectedRuleRefs',
    'excludedRuleRefs',
    'globallyNotApplicableRuleRefs',
    'ruleSources',
  ];
  requireFields(ruleSet, artifact, result, 'D011', '/ruleSet', fields);
  rejectUnsupportedFields(ruleSet, artifact, result, 'D039', '/ruleSet', fields, 'ruleSet');
  if (!isNonEmptyString(ruleSet.ruleSetId)) addViolation(result, 'D012', artifact, '/ruleSet/ruleSetId', 'ruleSetId must be non-empty string', 'string', ruleSet.ruleSetId);
  if (!isNonEmptyString(ruleSet.sourceIndexHash)) addViolation(result, 'D013', artifact, '/ruleSet/sourceIndexHash', 'sourceIndexHash is required', 'non-empty hash', ruleSet.sourceIndexHash);

  const candidateRuleRefs = validateStringSet(ruleSet.candidateRuleRefs, artifact, result, 'D014', '/ruleSet/candidateRuleRefs');
  const selectedRuleRefs = validateStringSet(ruleSet.selectedRuleRefs, artifact, result, 'D037', '/ruleSet/selectedRuleRefs');
  const excludedRuleRefs = validateStringSet(ruleSet.excludedRuleRefs, artifact, result, 'D016', '/ruleSet/excludedRuleRefs');
  const globallyNotApplicableRuleRefs = validateStringSet(ruleSet.globallyNotApplicableRuleRefs, artifact, result, 'D017', '/ruleSet/globallyNotApplicableRuleRefs');

  requireSubset(selectedRuleRefs, candidateRuleRefs, artifact, result, 'D038', '/ruleSet/selectedRuleRefs', 'selectedRuleRefs must be subset of candidateRuleRefs');
  requireSubset(excludedRuleRefs, candidateRuleRefs, artifact, result, 'D019', '/ruleSet/excludedRuleRefs', 'excludedRuleRefs must be subset of candidateRuleRefs');
  requireSubset(globallyNotApplicableRuleRefs, candidateRuleRefs, artifact, result, 'D020', '/ruleSet/globallyNotApplicableRuleRefs', 'globallyNotApplicableRuleRefs must be subset of candidateRuleRefs');
  requireDisjoint(selectedRuleRefs, excludedRuleRefs, artifact, result, 'D021', '/ruleSet', 'selectedRuleRefs and excludedRuleRefs must not overlap');
  requireDisjoint(selectedRuleRefs, globallyNotApplicableRuleRefs, artifact, result, 'D022', '/ruleSet', 'selectedRuleRefs and globallyNotApplicableRuleRefs must not overlap');
  requireDisjoint(excludedRuleRefs, globallyNotApplicableRuleRefs, artifact, result, 'D023', '/ruleSet', 'excludedRuleRefs and globallyNotApplicableRuleRefs must not overlap');

  const classifiedRuleRefs = new Set([...selectedRuleRefs, ...excludedRuleRefs, ...globallyNotApplicableRuleRefs]);
  candidateRuleRefs.forEach((ruleRef) => {
    if (!classifiedRuleRefs.has(ruleRef)) {
      addViolation(result, 'D033', artifact, '/ruleSet/candidateRuleRefs', 'candidateRuleRef must be classified as selected, excluded, or globallyNotApplicable', 'selectedRuleRefs | excludedRuleRefs | globallyNotApplicableRuleRefs', ruleRef);
    }
  });

  const ruleSourcesByRuleRef = new Map();
  if (!Array.isArray(ruleSet.ruleSources)) {
    addViolation(result, 'D024', artifact, '/ruleSet/ruleSources', 'ruleSources must be array', 'array', ruleSet.ruleSources);
  } else {
    ruleSet.ruleSources.forEach((source, index) => {
      const pointer = `/ruleSet/ruleSources/${index}`;
      requireFields(source, artifact, result, 'D025', pointer, ['namespace', 'ruleRef', 'ruleLevel', 'sourceFile', 'sourceHash', 'trigger', 'appliesTo']);
      if (!isNonEmptyString(source && source.namespace)) addViolation(result, 'D026', artifact, `${pointer}/namespace`, 'namespace must be non-empty string', 'string', source && source.namespace);
      if (!isNonEmptyString(source && source.ruleRef)) addViolation(result, 'D027', artifact, `${pointer}/ruleRef`, 'ruleRef must be non-empty string', 'string', source && source.ruleRef);
      if (!isNonEmptyString(source && source.sourceFile)) addViolation(result, 'D028', artifact, `${pointer}/sourceFile`, 'sourceFile must be non-empty string', 'string', source && source.sourceFile);
      if (!isNonEmptyString(source && source.sourceHash)) addViolation(result, 'D029', artifact, `${pointer}/sourceHash`, 'sourceHash is required', 'non-empty hash', source && source.sourceHash);
      if (!candidateRuleRefs.has(source && source.ruleRef)) addViolation(result, 'D030', artifact, `${pointer}/ruleRef`, 'ruleSources[].ruleRef must be in candidateRuleRefs', Array.from(candidateRuleRefs), source && source.ruleRef);
      if (!RULE_LEVELS.includes(source && source.ruleLevel)) addViolation(result, 'D034', artifact, `${pointer}/ruleLevel`, 'ruleSources[].ruleLevel must be valid', RULE_LEVELS, source && source.ruleLevel);
      if (!hasRuleBody(source)) addViolation(result, 'D032', artifact, pointer, 'rule source requires summary or ruleText', 'non-empty summary or ruleText', source);
      if (source && source.failureConditions !== undefined) validateFailureConditions(source.failureConditions, artifact, result, 'D035', `${pointer}/failureConditions`);
      if (source && source.requiredContext !== undefined) validateRequiredContextList(source.requiredContext, artifact, result, 'D036', `${pointer}/requiredContext`);
      if (source && source.ruleRef) ruleSourcesByRuleRef.set(source.ruleRef, source);
    });
  }

  candidateRuleRefs.forEach((ruleRef) => {
    if (!ruleSourcesByRuleRef.has(ruleRef)) {
      addViolation(result, 'D031', artifact, '/ruleSet/ruleSources', 'each candidateRuleRef requires one ruleSources entry', ruleRef, Array.from(ruleSourcesByRuleRef.keys()));
    }
  });

  return {
    ruleSetId: ruleSet.ruleSetId,
    candidateRuleRefs,
    selectedRuleRefs,
    excludedRuleRefs,
    globallyNotApplicableRuleRefs,
    ruleSourcesByRuleRef,
  };
}

function validateTargets(targets, artifact, result) {
  const empty = { allTargetIds: new Set(), candidateTargetIds: new Set(), targetById: new Map() };
  if (!isObject(targets)) {
    addViolation(result, 'D040', artifact, '/targets', 'targets must be object', 'object', targets);
    return empty;
  }
  requireFields(targets, artifact, result, 'D041', '/targets', ['changedUnits', 'candidates', 'contextExpansions']);
  const changedUnits = asArray(targets.changedUnits);
  const candidates = asArray(targets.candidates);
  if (!Array.isArray(targets.changedUnits)) addViolation(result, 'D042', artifact, '/targets/changedUnits', 'changedUnits must be array', 'array', targets.changedUnits);
  if (!Array.isArray(targets.candidates)) addViolation(result, 'D043', artifact, '/targets/candidates', 'candidates must be array', 'array', targets.candidates);
  if (!Array.isArray(targets.contextExpansions)) addViolation(result, 'D044', artifact, '/targets/contextExpansions', 'contextExpansions must be array', 'array', targets.contextExpansions);

  const allTargetIds = new Set();
  const candidateTargetIds = new Set();
  const targetById = new Map();
  changedUnits.forEach((target, index) => validateTarget(target, artifact, result, `/targets/changedUnits/${index}`, allTargetIds, targetById));
  candidates.forEach((target, index) => {
    validateTarget(target, artifact, result, `/targets/candidates/${index}`, allTargetIds, targetById);
    if (target && target.targetId) candidateTargetIds.add(target.targetId);
  });

  asArray(targets.contextExpansions).forEach((expansion, index) => {
    const pointer = `/targets/contextExpansions/${index}`;
    requireFields(expansion, artifact, result, 'D050', pointer, ['reason', 'addedTargetIds']);
    if (!isNonEmptyString(expansion && expansion.reason)) {
      addViolation(result, 'D054', artifact, `${pointer}/reason`, 'contextExpansion reason must be non-empty string', 'non-empty reason', expansion && expansion.reason);
    }
    if (!Array.isArray(expansion && expansion.addedTargetIds)) {
      addViolation(result, 'D051', artifact, `${pointer}/addedTargetIds`, 'addedTargetIds must be array', 'array', expansion && expansion.addedTargetIds);
      return;
    }
    expansion.addedTargetIds.forEach((targetId, targetIndex) => {
      if (!candidateTargetIds.has(targetId)) {
        addViolation(result, 'D052', artifact, `${pointer}/addedTargetIds/${targetIndex}`, 'contextExpansions[].addedTargetIds[] must exist in targets.candidates[]', Array.from(candidateTargetIds), targetId);
      }
    });
    if (expansion && expansion.requiredContextRefs !== undefined) {
      validateStringSet(expansion.requiredContextRefs, artifact, result, 'D053', `${pointer}/requiredContextRefs`);
    }
  });

  return { allTargetIds, candidateTargetIds, targetById };
}

function validateTarget(target, artifact, result, pointer, allTargetIds, targetById) {
  requireFields(target, artifact, result, 'D045', pointer, ['targetId', 'targetKind']);
  if (!TARGET_RE.test((target && target.targetId) || '')) addViolation(result, 'D046', artifact, `${pointer}/targetId`, 'targetId must match T followed by at least three digits', 'Txxx...', target && target.targetId);
  if (!isNonEmptyString(target && target.targetKind)) addViolation(result, 'D047', artifact, `${pointer}/targetKind`, 'targetKind must be non-empty string', 'string', target && target.targetKind);
  ['uid', 'cid', 'uId', 'candidateId'].forEach((legacyKey) => {
    if (target && Object.prototype.hasOwnProperty.call(target, legacyKey)) {
      addViolation(result, 'D048', artifact, `${pointer}/${legacyKey}`, 'targets must use targetId as the only primary id field', 'targetId', legacyKey);
    }
  });
  if (target && target.targetId) {
    if (allTargetIds.has(target.targetId)) addViolation(result, 'D049', artifact, `${pointer}/targetId`, 'targetId must be unique across changedUnits and candidates', 'unique targetId', target.targetId);
    allTargetIds.add(target.targetId);
    targetById.set(target.targetId, target);
  }
}

function validateReviewItems(reviewItems, ruleSet, targets, artifact, result) {
  const itemMap = new Map();
  const itemByTuple = new Map();
  if (!Array.isArray(reviewItems)) {
    addViolation(result, 'D060', artifact, '/reviewItems', 'reviewItems must be array', 'array', reviewItems);
    return itemMap;
  }
  reviewItems.forEach((item, index) => {
    const pointer = `/reviewItems/${index}`;
    const fields = ['reviewItemId', 'ruleRef', 'targetKind', 'targetId'];
    requireFields(item, artifact, result, 'D061', pointer, fields);
    rejectUnsupportedFields(item, artifact, result, 'D065', pointer, fields, 'reviewItem');
    if (!REVIEW_ITEM_RE.test(item && item.reviewItemId)) addViolation(result, 'D062', artifact, `${pointer}/reviewItemId`, 'reviewItemId must match RIxxx', 'RIxxx', item && item.reviewItemId);
    if (itemMap.has(item && item.reviewItemId)) addViolation(result, 'D063', artifact, `${pointer}/reviewItemId`, 'reviewItemId must be unique', 'unique RIxxx', item && item.reviewItemId);
    if (!ruleSet.selectedRuleRefs.has(item && item.ruleRef)) addViolation(result, 'D064', artifact, `${pointer}/ruleRef`, 'reviewItem.ruleRef must exist in selectedRuleRefs', Array.from(ruleSet.selectedRuleRefs), item && item.ruleRef);
    if (!targets.allTargetIds.has(item && item.targetId)) {
      addViolation(result, 'D068', artifact, `${pointer}/targetId`, 'reviewItem targetId must exist in targets.changedUnits[] or targets.candidates[]', Array.from(targets.allTargetIds), item && item.targetId);
    } else {
      const target = targets.targetById.get(item.targetId);
      if (target && item.targetKind !== target.targetKind) {
        addViolation(result, 'D069', artifact, `${pointer}/targetKind`, 'reviewItem targetKind must match target targetKind', target.targetKind, item.targetKind);
      }
      validateReviewTargetContext(target, artifact, result, 'D071', `${pointer}/targetId`);
    }
    if (isNonEmptyString(item && item.ruleRef) && isNonEmptyString(item && item.targetId)) {
      const tuple = reviewItemTuple(item);
      const existing = itemByTuple.get(tuple);
      if (existing) {
        addViolation(result, 'D072', artifact, pointer, 'ruleRef x targetId tuple must map to exactly one reviewItemId', existing.reviewItemId, item.reviewItemId);
      } else {
        itemByTuple.set(tuple, item);
      }
    }
    if (item && item.reviewItemId) itemMap.set(item.reviewItemId, item);
  });
  if (targets.allTargetIds.size > 0) ruleSet.selectedRuleRefs.forEach((ruleRef) => {
    const hasReviewItem = Array.from(itemMap.values()).some((item) => item.ruleRef === ruleRef);
    if (!hasReviewItem) addViolation(result, 'D070', artifact, '/reviewItems', 'selectedRuleRef must generate at least one reviewItem when targets exist', ruleRef, Array.from(itemMap.values()));
  });
  return itemMap;
}

function validateApplicabilityMatrix(rows, ruleSet, targets, reviewItems, artifact, result) {
  if (!Array.isArray(rows)) {
    addViolation(result, 'D150', artifact, '/applicabilityMatrix', 'applicabilityMatrix must be array', 'array', rows);
    return;
  }

  const rowsByPair = new Map();
  const applicableItemIds = new Set();
  rows.forEach((entry, index) => {
    const pointer = `/applicabilityMatrix/${index}`;
    requireFields(entry, artifact, result, 'D151', pointer, ['ruleRef', 'targetId', 'targetKind', 'applicability', 'evidence']);
    if (!ruleSet.selectedRuleRefs.has(entry && entry.ruleRef)) {
      addViolation(result, 'D152', artifact, `${pointer}/ruleRef`, 'applicabilityMatrix ruleRef must be selectedRuleRefs item', Array.from(ruleSet.selectedRuleRefs), entry && entry.ruleRef);
    }
    const target = targets.targetById.get(entry && entry.targetId);
    if (!target) {
      addViolation(result, 'D153', artifact, `${pointer}/targetId`, 'applicabilityMatrix targetId must exist in targets', Array.from(targets.allTargetIds), entry && entry.targetId);
    } else if (entry.targetKind !== target.targetKind) {
      addViolation(result, 'D154', artifact, `${pointer}/targetKind`, 'applicabilityMatrix targetKind must match target', target.targetKind, entry.targetKind);
    }
    if (!APPLICABILITY_STATUSES.includes(entry && entry.applicability)) {
      addViolation(result, 'D155', artifact, `${pointer}/applicability`, 'applicability must be valid', APPLICABILITY_STATUSES, entry && entry.applicability);
    }
    validateEvidenceArray(entry && entry.evidence, artifact, result, 'D156', `${pointer}/evidence`, 'applicabilityMatrix entry requires evidence');

    const key = applicabilityKey(entry && entry.ruleRef, entry && entry.targetId);
    if (rowsByPair.has(key)) addViolation(result, 'D157', artifact, pointer, 'applicabilityMatrix must contain one row per selected rule and target pair', 'unique ruleRef + targetId', entry);
    if (entry && entry.ruleRef && entry.targetId) rowsByPair.set(key, entry);

    if (entry && entry.applicability === 'applicable') {
      if (!REVIEW_ITEM_RE.test(entry.reviewItemId)) {
        addViolation(result, 'D158', artifact, `${pointer}/reviewItemId`, 'applicable matrix row requires reviewItemId', 'RIxxx', entry.reviewItemId);
        return;
      }
      const item = reviewItems.get(entry.reviewItemId);
      if (!item) {
        addViolation(result, 'D159', artifact, `${pointer}/reviewItemId`, 'applicable matrix row reviewItemId must exist in reviewItems', Array.from(reviewItems.keys()), entry.reviewItemId);
        return;
      }
      if (item.ruleRef !== entry.ruleRef || item.targetId !== entry.targetId || item.targetKind !== entry.targetKind) {
        addViolation(result, 'D160', artifact, `${pointer}/reviewItemId`, 'applicable matrix row must point to matching reviewItem', { ruleRef: entry.ruleRef, targetId: entry.targetId, targetKind: entry.targetKind }, item);
      }
      applicableItemIds.add(entry.reviewItemId);
    }

    if (entry && entry.applicability === 'not_applicable') {
      if (!isNonEmptyString(entry.reason)) addViolation(result, 'D161', artifact, `${pointer}/reason`, 'not_applicable matrix row requires reason', 'non-empty reason', entry.reason);
      if (entry.reviewItemId !== undefined && entry.reviewItemId !== null) {
        addViolation(result, 'D162', artifact, `${pointer}/reviewItemId`, 'not_applicable matrix row must not bind reviewItemId', 'no reviewItemId', entry.reviewItemId);
      }
    }
  });

  ruleSet.selectedRuleRefs.forEach((ruleRef) => {
    targets.targetById.forEach((_target, targetId) => {
      const key = applicabilityKey(ruleRef, targetId);
      if (!rowsByPair.has(key)) {
        addViolation(result, 'D163', artifact, '/applicabilityMatrix', 'applicabilityMatrix must cover every selectedRuleRef x target pair', key, Array.from(rowsByPair.keys()));
      }
    });
  });

  reviewItems.forEach((item) => {
    if (!applicableItemIds.has(item.reviewItemId)) {
      addViolation(result, 'D164', artifact, '/applicabilityMatrix', 'each reviewItem must be backed by applicable matrix row', item.reviewItemId, Array.from(applicableItemIds));
    }
  });
}

function applicabilityKey(ruleRef, targetId) {
  return `${ruleRef || ''}\u0000${targetId || ''}`;
}

function validateRequiredContextCoverage(ruleSet, targets, artifact, result) {
  if (asArray(targets && targets.changedUnits).length + asArray(targets && targets.candidates).length === 0) return;

  const requiredContextById = new Map();
  ruleSet.selectedRuleRefs.forEach((ruleRef) => {
    const source = ruleSet.ruleSourcesByRuleRef.get(ruleRef);
    asArray(source && source.requiredContext).forEach((entry) => {
      if (entry && entry.contextId) requiredContextById.set(entry.contextId, { ruleRef, entry });
    });
  });

  if (requiredContextById.size === 0) return;

  const covered = new Set();
  asArray(targets && targets.contextExpansions).forEach((expansion, index) => {
    if (asArray(expansion && expansion.requiredContextRefs).length > 0 && asArray(expansion && expansion.addedTargetIds).length === 0) {
      addViolation(result, 'D172', artifact, `/targets/contextExpansions/${index}/addedTargetIds`, 'contextExpansions with requiredContextRefs must add candidate targets', 'non-empty addedTargetIds', expansion && expansion.addedTargetIds);
    }
    asArray(expansion && expansion.requiredContextRefs).forEach((contextId, refIndex) => {
      if (!requiredContextById.has(contextId)) {
        addViolation(result, 'D170', artifact, `/targets/contextExpansions/${index}/requiredContextRefs/${refIndex}`, 'requiredContextRefs must reference selected rule context', Array.from(requiredContextById.keys()), contextId);
      } else {
        covered.add(contextId);
      }
    });
  });

  requiredContextById.forEach((_value, contextId) => {
    if (!covered.has(contextId)) {
      addViolation(result, 'D171', artifact, '/targets/contextExpansions', 'selected rule context must be covered by contextExpansions.requiredContextRefs', contextId, Array.from(covered));
    }
  });
}

function escapeJsonPointer(value) {
  return String(value).replace(/~/g, '~0').replace(/\//g, '~1');
}

function validateReviewBatches(dispatch, reviewItems, artifact, result) {
  const reviewBatches = dispatch && dispatch.reviewBatches;
  if (!Array.isArray(reviewBatches)) {
    addViolation(result, 'D080', artifact, '/reviewBatches', 'reviewBatches must be array', 'array', reviewBatches);
    return;
  }
  const batchIds = new Set();
  const assignment = new Map();
  reviewBatches.forEach((batch, index) => {
    const pointer = `/reviewBatches/${index}`;
    const fields = ['reviewBatchId', 'reviewItemIds'];
    requireFields(batch, artifact, result, 'D081', pointer, fields);
    rejectUnsupportedFields(batch, artifact, result, 'D087', pointer, fields, 'reviewBatch');
    const reviewBatchId = batch && batch.reviewBatchId;
    if (!isSafeToken(reviewBatchId)) addViolation(result, 'D082', artifact, `${pointer}/reviewBatchId`, 'reviewBatchId must be a safe token', '^[A-Za-z0-9][A-Za-z0-9_-]*$', reviewBatchId);
    if (batchIds.has(batch && batch.reviewBatchId)) addViolation(result, 'D083', artifact, `${pointer}/reviewBatchId`, 'reviewBatchId must be unique', 'unique batch id', batch && batch.reviewBatchId);
    if (batch && batch.reviewBatchId) batchIds.add(batch.reviewBatchId);
    validateStringSet(batch && batch.reviewItemIds, artifact, result, 'D085', `${pointer}/reviewItemIds`);
    if (!isNonEmptyArray(batch && batch.reviewItemIds)) addViolation(result, 'D093', artifact, `${pointer}/reviewItemIds`, 'reviewBatch must include at least one reviewItemId', 'non-empty reviewItemIds', batch && batch.reviewItemIds);
    asArray(batch && batch.reviewItemIds).forEach((reviewItemId, itemIndex) => {
      if (!reviewItems.has(reviewItemId)) addViolation(result, 'D086', artifact, `${pointer}/reviewItemIds/${itemIndex}`, 'reviewBatch reviewItemIds must exist in reviewItems', Array.from(reviewItems.keys()), reviewItemId);
      if (!assignment.has(reviewItemId)) assignment.set(reviewItemId, []);
      assignment.get(reviewItemId).push(batch && batch.reviewBatchId);
    });
  });
  assignment.forEach((batchIdsForItem, reviewItemId) => {
    if (batchIdsForItem.length > 1) {
      addViolation(result, 'D091', artifact, '/reviewBatches', 'reviewItemId must not be assigned to multiple reviewBatches', 'single reviewBatch assignment', { reviewItemId, reviewBatchIds: batchIdsForItem });
    }
  });
  reviewItems.forEach((_item, reviewItemId) => {
    if (!assignment.has(reviewItemId)) {
      addViolation(result, 'D092', artifact, '/reviewBatches', 'reviewItem must be assigned to one reviewBatch', reviewItemId, Array.from(assignment.keys()));
    }
  });
}

function validateTask(task, artifact, result, currentInputPath = artifact) {
  expectKind(task, artifact, result, 'T002', 'rules-review-task');
  validateSchemaVersion(task, artifact, result, 'T003');
  const requiredFields = ['kind', 'schemaVersion', 'runId', 'reviewBatchId', 'taskHash', 'ruleSetId', 'reviewRange', 'ruleInputSource', 'ruleSnapshot', 'inputSnapshot', 'reviewItems', 'rules', 'targets', 'applicabilityMatrix', 'outputContract'];
  requireFields(task, artifact, result, 'T004', '', requiredFields);
  rejectUnsupportedFields(task, artifact, result, 'T042', '', requiredFields, 'task');
  if (!isRunId(task && task.runId)) addViolation(result, 'T022', artifact, '/runId', 'task runId must match YYYYMMDDTHHmmssZ-rr-xxxxxxxx', 'UTC timestamp + rr + 8 lowercase hex characters', task && task.runId);
  if (!isSafeToken(task && task.reviewBatchId)) addViolation(result, 'T025', artifact, '/reviewBatchId', 'task reviewBatchId must be a safe token', '^[A-Za-z0-9][A-Za-z0-9_-]*$', task && task.reviewBatchId);
  const expectedTaskHash = calculateTaskHash(task);
  if (!SHA256_RE.test((task && task.taskHash) || '')) {
    addViolation(result, 'T047', artifact, '/taskHash', 'taskHash must use sha256:<64hex>', 'sha256:<64hex>', task && task.taskHash);
  } else if (task.taskHash !== expectedTaskHash) {
    addViolation(result, 'T048', artifact, '/taskHash', 'taskHash must equal the canonical task content excluding taskHash', expectedTaskHash, task.taskHash);
  }
  if (!Array.isArray(task.reviewItems)) addViolation(result, 'T005', artifact, '/reviewItems', 'reviewItems must be array', 'array', task.reviewItems);
  if (!Array.isArray(task.rules)) addViolation(result, 'T006', artifact, '/rules', 'rules must be array', 'array', task.rules);
  if (!Array.isArray(task.targets)) addViolation(result, 'T007', artifact, '/targets', 'targets must be array', 'array', task.targets);
  if (!Array.isArray(task.applicabilityMatrix)) addViolation(result, 'T018', artifact, '/applicabilityMatrix', 'applicabilityMatrix must be array', 'array', task.applicabilityMatrix);
  validateReviewRangeShape(task.reviewRange, artifact, result);
  validateRuleInputSource(task && task.ruleInputSource, artifact, result, 'T049');
  const ruleIndexSnapshot = asArray(task && task.ruleSnapshot && task.ruleSnapshot.files)
    .find((entry) => entry && entry.path === '.agents/rules/index.md');
  validateRuleSnapshotShape({
    ruleSnapshot: task && task.ruleSnapshot,
    ruleSet: {
      sourceIndexHash: ruleIndexSnapshot && ruleIndexSnapshot.contentHash,
      ruleSources: asArray(task && task.rules),
    },
  }, artifact, result);
  validateTaskTreeInputs(task, currentInputPath, artifact, result);

  asArray(task.reviewItems).forEach((item, index) => {
    const pointer = `/reviewItems/${index}`;
    const fields = ['reviewItemId', 'ruleRef', 'targetKind', 'targetId'];
    requireFields(item, artifact, result, 'T008', pointer, fields);
    rejectUnsupportedFields(item, artifact, result, 'T026', pointer, fields, 'task reviewItem');
    if (!REVIEW_ITEM_RE.test(item && item.reviewItemId)) addViolation(result, 'T009', artifact, `${pointer}/reviewItemId`, 'reviewItemId must match RIxxx', 'RIxxx', item && item.reviewItemId);
    if (!TARGET_RE.test((item && item.targetId) || '')) addViolation(result, 'T023', artifact, `${pointer}/targetId`, 'task reviewItem targetId must match T followed by at least three digits', 'Txxx...', item && item.targetId);
  });
  asArray(task.rules).forEach((rule, index) => {
    const pointer = `/rules/${index}`;
    requireFields(rule, artifact, result, 'T010', pointer, ['namespace', 'ruleRef', 'ruleLevel', 'sourceFile', 'sourceHash', 'trigger', 'appliesTo']);
    if (!RULE_LEVELS.includes(rule && rule.ruleLevel)) addViolation(result, 'T017', artifact, `${pointer}/ruleLevel`, 'task ruleLevel must be valid', RULE_LEVELS, rule && rule.ruleLevel);
    if (!isNonEmptyString(rule && rule.sourceHash)) addViolation(result, 'T011', artifact, `${pointer}/sourceHash`, 'sourceHash is required', 'non-empty hash', rule && rule.sourceHash);
    if (!hasRuleBody(rule)) addViolation(result, 'T016', artifact, pointer, 'task rule requires summary or ruleText', 'non-empty summary or ruleText', rule);
    if (rule && rule.failureConditions !== undefined) validateFailureConditions(rule.failureConditions, artifact, result, 'T019', `${pointer}/failureConditions`);
    if (rule && rule.requiredContext !== undefined) validateRequiredContextList(rule.requiredContext, artifact, result, 'T020', `${pointer}/requiredContext`);
  });
  asArray(task.targets).forEach((target, index) => {
    const pointer = `/targets/${index}`;
    requireFields(target, artifact, result, 'T012', pointer, ['targetId', 'targetKind']);
    rejectUnsupportedFields(target, artifact, result, 'T043', pointer, ['targetId', 'targetKind', 'inputRefs', 'loc', 'source', 'summary'], 'task target');
    if (!TARGET_RE.test((target && target.targetId) || '')) addViolation(result, 'T024', artifact, `${pointer}/targetId`, 'task targetId must match T followed by at least three digits', 'Txxx...', target && target.targetId);
    if (target && target.inputRefs !== undefined) validateRepoPathArray(target.inputRefs, artifact, result, 'T021', `${pointer}/inputRefs`);
  });
  if (!isObject(task.outputContract)) {
    addViolation(result, 'T013', artifact, '/outputContract', 'outputContract must be object', 'object', task.outputContract);
  } else {
    if (task.outputContract.format !== 'strict_json') addViolation(result, 'T014', artifact, '/outputContract/format', 'output format must be strict_json', 'strict_json', task.outputContract.format);
    if (task.outputContract.schemaRef !== 'schemas/shard.schema.json') addViolation(result, 'T015', artifact, '/outputContract/schemaRef', 'schemaRef must point to shard schema', 'schemas/shard.schema.json', task.outputContract.schemaRef);
  }
  validateTaskApplicabilityMatrix(task, artifact, result);
}

function validateTaskTreeInputs(task, currentInputPath, artifact, result) {
  if (!isObject(task && task.inputSnapshot) || !Array.isArray(task.inputSnapshot.files)) {
    addViolation(result, 'T044', artifact, '/inputSnapshot/files', 'task inputSnapshot.files must be an array', 'array', task && task.inputSnapshot && task.inputSnapshot.files);
    return;
  }
  if (!isObject(task && task.ruleSnapshot) || !Array.isArray(task.ruleSnapshot.files)) {
    addViolation(result, 'T046', artifact, '/ruleSnapshot/files', 'task ruleSnapshot.files must be an array', 'array', task && task.ruleSnapshot && task.ruleSnapshot.files);
    return;
  }
  try {
    const { root } = loadRepository(currentInputPath);
    const baseCommit = resolveCommit(root, task.reviewRange.baseCommit);
    const baseTree = resolveTree(root, task.reviewRange.baseTree);
    const targetTree = resolveNormalizedTreeObject(root, task.reviewRange.targetTree);
    if (resolveTree(root, `${baseCommit}^{tree}`) !== baseTree) throw new Error('task baseCommit tree does not match baseTree');
    const boundCommit = resolveCommit(root, task.reviewRange.boundCommit);
    if (boundCommit !== task.reviewRange.boundCommit) throw new Error('task boundCommit must use its normalized commit ID');
    if (resolveTree(root, `${boundCommit}^{tree}`) !== targetTree) {
      throw new Error('task boundCommit tree does not match targetTree');
    }
    task.inputSnapshot.files.forEach((entry) => {
      const actual = snapshotTreeInput(root, targetTree, entry.inputRef);
      if (canonicalStringify(actual) !== canonicalStringify(entry)) throw new Error(`task targetTree input snapshot mismatch for ${entry.inputRef}`);
    });
    verifyRuleSnapshotSource(root, task.ruleInputSource, task.ruleSnapshot.files, 'task');
  } catch (error) {
    addViolation(result, 'T045', artifact, '/reviewRange', `task Git tree verification failed closed: ${error.message}`, 'available immutable range and blobs', error.message, 2);
  }
}

function validateTaskApplicabilityMatrix(task, artifact, result) {
  if (!Array.isArray(task && task.applicabilityMatrix)) return;

  const reviewItems = new Map(asArray(task.reviewItems).map((item) => [item && item.reviewItemId, item]));
  const rules = new Set(asArray(task.rules).map((rule) => rule && rule.ruleRef).filter(Boolean));
  const targets = new Map(asArray(task.targets).map((target) => [target && target.targetId, target]));
  const rowsByItem = new Map();

  task.applicabilityMatrix.forEach((entry, index) => {
    const pointer = `/applicabilityMatrix/${index}`;
    requireFields(entry, artifact, result, 'T030', pointer, ['ruleRef', 'targetId', 'targetKind', 'applicability', 'reviewItemId', 'evidence']);
    if (!TARGET_RE.test((entry && entry.targetId) || '')) addViolation(result, 'T041', artifact, `${pointer}/targetId`, 'task applicability targetId must match T followed by at least three digits', 'Txxx...', entry && entry.targetId);
    if (!rules.has(entry && entry.ruleRef)) addViolation(result, 'T031', artifact, `${pointer}/ruleRef`, 'task applicabilityMatrix ruleRef must exist in task.rules[]', Array.from(rules), entry && entry.ruleRef);
    const target = targets.get(entry && entry.targetId);
    if (!target) {
      addViolation(result, 'T032', artifact, `${pointer}/targetId`, 'task applicabilityMatrix targetId must exist in task.targets[]', Array.from(targets.keys()), entry && entry.targetId);
    } else if (target.targetKind !== entry.targetKind) {
      addViolation(result, 'T033', artifact, `${pointer}/targetKind`, 'task applicabilityMatrix targetKind must match task target', target.targetKind, entry.targetKind);
    }
    if (entry && entry.applicability !== 'applicable') addViolation(result, 'T034', artifact, `${pointer}/applicability`, 'task applicabilityMatrix may only include applicable rows', 'applicable', entry && entry.applicability);
    validateEvidenceArray(entry && entry.evidence, artifact, result, 'T035', `${pointer}/evidence`, 'task applicabilityMatrix entry requires evidence');
    if (!REVIEW_ITEM_RE.test(entry && entry.reviewItemId)) {
      addViolation(result, 'T036', artifact, `${pointer}/reviewItemId`, 'task applicable matrix row requires reviewItemId', 'RIxxx', entry && entry.reviewItemId);
      return;
    }
    if (rowsByItem.has(entry.reviewItemId)) addViolation(result, 'T037', artifact, pointer, 'task applicabilityMatrix must contain one row per reviewItemId', 'unique reviewItemId', entry.reviewItemId);
    rowsByItem.set(entry.reviewItemId, entry);
    const item = reviewItems.get(entry.reviewItemId);
    if (!item) {
      addViolation(result, 'T038', artifact, `${pointer}/reviewItemId`, 'task applicabilityMatrix reviewItemId must exist in task.reviewItems[]', Array.from(reviewItems.keys()), entry.reviewItemId);
      return;
    }
    if (item.ruleRef !== entry.ruleRef || item.targetId !== entry.targetId || item.targetKind !== entry.targetKind) {
      addViolation(result, 'T039', artifact, `${pointer}/reviewItemId`, 'task applicabilityMatrix row must match reviewItem', item, entry);
    }
  });

  reviewItems.forEach((item) => {
    if (item && !rowsByItem.has(item.reviewItemId)) {
      addViolation(result, 'T040', artifact, '/applicabilityMatrix', 'task must include an applicable matrix row for each reviewItem', item.reviewItemId, Array.from(rowsByItem.keys()));
    }
  });
}

function validateShard(shard, task, artifact, result) {
  expectKind(shard, artifact, result, 'S002', 'rules-review-shard');
  validateSchemaVersion(shard, artifact, result, 'S003');
  requireFields(shard, artifact, result, 'S004', '', ['kind', 'schemaVersion', 'runId', 'reviewBatchId', 'targetTree', 'taskHash', 'results']);
  if (!isRunId(shard && shard.runId)) addViolation(result, 'S023', artifact, '/runId', 'shard runId must match YYYYMMDDTHHmmssZ-rr-xxxxxxxx', 'UTC timestamp + rr + 8 lowercase hex characters', shard && shard.runId);
  if (!isSafeToken(shard && shard.reviewBatchId)) addViolation(result, 'S024', artifact, '/reviewBatchId', 'shard reviewBatchId must be a safe token', '^[A-Za-z0-9][A-Za-z0-9_-]*$', shard && shard.reviewBatchId);
  if (!GIT_OID_RE.test((shard && shard.targetTree) || '')) addViolation(result, 'S025', artifact, '/targetTree', 'shard targetTree must be a normalized Git object ID', '40 or 64 lowercase hex', shard && shard.targetTree);
  if (!SHA256_RE.test((shard && shard.taskHash) || '')) addViolation(result, 'S027', artifact, '/taskHash', 'shard taskHash must use sha256:<64hex>', 'sha256:<64hex>', shard && shard.taskHash);
  if (task) {
    if (shard.runId !== task.runId) addViolation(result, 'S005', artifact, '/runId', 'shard runId must match task runId', task.runId, shard.runId);
    if (shard.reviewBatchId !== task.reviewBatchId) addViolation(result, 'S006', artifact, '/reviewBatchId', 'shard reviewBatchId must match task reviewBatchId', task.reviewBatchId, shard.reviewBatchId);
    if (shard.targetTree !== (task.reviewRange && task.reviewRange.targetTree)) addViolation(result, 'S026', artifact, '/targetTree', 'shard targetTree must match task targetTree', task.reviewRange && task.reviewRange.targetTree, shard.targetTree);
    const expectedTaskHash = calculateTaskHash(task);
    if (shard.taskHash !== expectedTaskHash) addViolation(result, 'S028', artifact, '/taskHash', 'shard taskHash must match the canonical task identity', expectedTaskHash, shard.taskHash);
  }
  if (!Array.isArray(shard.results)) {
    addViolation(result, 'S007', artifact, '/results', 'results must be array', 'array', shard.results);
    return;
  }
  const taskContext = buildTaskContext(task);
  const taskItemIds = new Set(asArray(task && task.reviewItems).map((item) => item.reviewItemId));
  const seen = new Set();
  shard.results.forEach((reviewResult, index) => {
    const pointer = `/results/${index}`;
    validateReviewResult(reviewResult, artifact, result, pointer, 'S', taskContext);
    if (seen.has(reviewResult && reviewResult.reviewItemId)) {
      addViolation(result, 'S020', artifact, `${pointer}/reviewItemId`, 'reviewItem has duplicate results in shard', 'one result per reviewItemId', reviewResult && reviewResult.reviewItemId);
    }
    if (reviewResult && reviewResult.reviewItemId) seen.add(reviewResult.reviewItemId);
    if (task && !taskItemIds.has(reviewResult && reviewResult.reviewItemId)) {
      addViolation(result, 'S021', artifact, `${pointer}/reviewItemId`, 'result must reference assigned reviewItemId', Array.from(taskItemIds), reviewResult && reviewResult.reviewItemId);
    }
  });
  if (task) {
    const actual = new Set(asArray(shard.results).map((reviewResult) => reviewResult && reviewResult.reviewItemId).filter(Boolean));
    if (!setsEqual(actual, taskItemIds)) {
      addViolation(result, 'S022', artifact, '/results', 'shard results must cover every task reviewItem', Array.from(taskItemIds), Array.from(actual));
    }
  }
}

function buildTaskContext(task) {
  const reviewItems = new Map(asArray(task && task.reviewItems).map((item) => [item.reviewItemId, item]));
  const rules = new Map(asArray(task && task.rules).map((rule) => [rule.ruleRef, rule]));
  return { reviewItems, rules };
}

function validateReviewResult(reviewResult, artifact, result, pointer, prefix, taskContext) {
  requireFields(reviewResult, artifact, result, `${prefix}010`, pointer, ['reviewItemId', 'status']);
  if (!REVIEW_ITEM_RE.test(reviewResult && reviewResult.reviewItemId)) addViolation(result, `${prefix}011`, artifact, `${pointer}/reviewItemId`, 'reviewItemId must match RIxxx', 'RIxxx', reviewResult && reviewResult.reviewItemId);
  if (!RESULT_STATUSES.includes(reviewResult && reviewResult.status)) addViolation(result, `${prefix}012`, artifact, `${pointer}/status`, 'result status must be valid', RESULT_STATUSES, reviewResult && reviewResult.status);
  if (reviewResult && Object.prototype.hasOwnProperty.call(reviewResult, 'acceptedRisk')) {
    addViolation(result, `${prefix}038`, artifact, `${pointer}/acceptedRisk`, 'acceptedRisk is not supported in rules-review results', 'field absent', reviewResult.acceptedRisk);
  }
  if (reviewResult && Object.prototype.hasOwnProperty.call(reviewResult, 'findingId')) {
    addViolation(result, `${prefix}039`, artifact, `${pointer}/findingId`, 'shard result must not contain findingId', 'field absent', reviewResult.findingId);
  }

  if (reviewResult && reviewResult.status === 'finding') {
    if (!isNonEmptyString(reviewResult.rootCause)) {
      addViolation(result, `${prefix}013`, artifact, `${pointer}/rootCause`, 'finding result requires an explicit rootCause', 'non-empty rootCause', reviewResult.rootCause);
    }
    validateShardEvidenceArray(reviewResult.evidence, artifact, result, `${prefix}014`, `${pointer}/evidence`, 'finding result requires evidence');
    validateReviewResultDisposition(reviewResult, taskContext, artifact, result, pointer, prefix);
  }
  if (reviewResult && reviewResult.status === 'observation') {
    if (!hasValidEvidenceArray(reviewResult.evidence) && !isNonEmptyString(reviewResult.reason)) {
      addViolation(result, `${prefix}019`, artifact, pointer, 'observation result requires reason or evidence', 'reason or evidence[]', reviewResult);
    }
    if (reviewResult.evidence !== undefined) validateShardEvidenceArray(reviewResult.evidence, artifact, result, `${prefix}020`, `${pointer}/evidence`, 'observation evidence must be reviewable when present');
    validateReviewResultDisposition(reviewResult, taskContext, artifact, result, pointer, prefix);
  }
  if (reviewResult && reviewResult.status === 'passed') {
    validateShardEvidenceArray(reviewResult.evidence, artifact, result, `${prefix}015`, `${pointer}/evidence`, 'passed result requires evidence');
    validateFailureChecks(reviewResult, taskContext, artifact, result, pointer, prefix);
  }
  if (reviewResult && reviewResult.status === 'cannot_verify' && !isNonEmptyString(reviewResult.reason) && !hasValidEvidenceArray(reviewResult.evidence)) {
    addViolation(result, `${prefix}017`, artifact, pointer, 'cannot_verify result requires reason or evidence', 'reason or evidence[]', reviewResult);
  }
  if (reviewResult && reviewResult.status === 'cannot_verify' && reviewResult.evidence !== undefined) {
    validateShardEvidenceArray(reviewResult.evidence, artifact, result, `${prefix}041`, `${pointer}/evidence`, 'cannot_verify evidence must be reviewable when present');
  }
}

function validateFailureChecks(reviewResult, taskContext, artifact, result, pointer, prefix) {
  if (!Array.isArray(reviewResult && reviewResult.failureChecks) || reviewResult.failureChecks.length === 0) {
    addViolation(result, `${prefix}030`, artifact, `${pointer}/failureChecks`, 'passed result requires failureChecks', 'non-empty failureChecks[]', reviewResult && reviewResult.failureChecks);
    return;
  }

  const expectedConditions = failureConditionsForReviewResult(reviewResult, taskContext);
  const expectedConditionIds = new Set(expectedConditions.map((condition) => condition && condition.conditionId).filter(Boolean));
  const actualConditionIds = new Set();

  reviewResult.failureChecks.forEach((check, index) => {
    const checkPointer = `${pointer}/failureChecks/${index}`;
    requireFields(check, artifact, result, `${prefix}031`, checkPointer, ['condition', 'outcome', 'evidence']);
    if (!isNonEmptyString(check && check.condition)) addViolation(result, `${prefix}032`, artifact, `${checkPointer}/condition`, 'failureCheck condition must be non-empty string', 'string', check && check.condition);
    if (!FAILURE_CHECK_OUTCOMES.includes(check && check.outcome)) addViolation(result, `${prefix}033`, artifact, `${checkPointer}/outcome`, 'failureCheck outcome must be valid', FAILURE_CHECK_OUTCOMES, check && check.outcome);
    validateShardEvidenceArray(check && check.evidence, artifact, result, `${prefix}034`, `${checkPointer}/evidence`, 'failureCheck requires evidence');
    if (check && check.conditionId !== undefined) {
      if (!isNonEmptyString(check.conditionId)) {
        addViolation(result, `${prefix}035`, artifact, `${checkPointer}/conditionId`, 'failureCheck conditionId must be non-empty string when present', 'string', check.conditionId);
      } else {
        actualConditionIds.add(check.conditionId);
      }
    }
  });

  expectedConditionIds.forEach((conditionId) => {
    if (!actualConditionIds.has(conditionId)) {
      addViolation(result, `${prefix}036`, artifact, `${pointer}/failureChecks`, 'passed failureChecks must cover rule failureConditions', conditionId, Array.from(actualConditionIds));
    }
  });
}

function failureConditionsForReviewResult(reviewResult, taskContext) {
  const item = taskContext && taskContext.reviewItems ? taskContext.reviewItems.get(reviewResult && reviewResult.reviewItemId) : null;
  const rule = item && taskContext && taskContext.rules ? taskContext.rules.get(item.ruleRef) : null;
  return asArray(rule && rule.failureConditions);
}

function validateReviewResultDisposition(reviewResult, taskContext, artifact, result, pointer, prefix) {
  const origin = reviewResult && reviewResult.origin;
  const ruleLevel = ruleLevelForReviewResult(reviewResult, taskContext);
  if (!FINDING_ORIGINS.includes(origin)) addViolation(result, `${prefix}023`, artifact, `${pointer}/origin`, 'finding or observation origin must be valid', FINDING_ORIGINS, origin);
  if (reviewResult.priority !== undefined && !FINDING_PRIORITIES.includes(reviewResult.priority)) {
    addViolation(result, `${prefix}024`, artifact, `${pointer}/priority`, 'finding priority must be valid', FINDING_PRIORITIES, reviewResult.priority);
  }
  if (!RULE_LEVELS.includes(ruleLevel)) return;
  if (!FINDING_ORIGINS.includes(origin)) return;

  const expectedStatus = defaultResultStatus(ruleLevel, origin);
  if (reviewResult.status === 'observation' && ruleLevel !== 'ADVISORY' && ['exposed_by_change', 'pre_existing'].includes(origin)) {
    validateEvidenceArray(reviewResult.evidence, artifact, result, `${prefix}039`, `${pointer}/evidence`, 'non-ADVISORY observation with exposed_by_change or pre_existing requires evidence');
  }
  if (reviewResult.status !== expectedStatus) {
    if (reviewResult.status === 'finding' && expectedStatus === 'observation') {
      if (!isNonEmptyString(reviewResult.upgradeReason)) addViolation(result, `${prefix}025`, artifact, `${pointer}/upgradeReason`, 'upgraded finding requires upgradeReason', 'non-empty upgradeReason', reviewResult.upgradeReason);
      if (origin === 'pre_existing' && !isNonEmptyString(reviewResult.originReason)) addViolation(result, `${prefix}026`, artifact, `${pointer}/originReason`, 'pre_existing finding upgrade requires originReason', 'non-empty originReason', reviewResult.originReason);
    } else {
      addViolation(result, `${prefix}027`, artifact, `${pointer}/status`, 'result status must follow ruleLevel and origin default mapping', expectedStatus, reviewResult.status);
    }
  }

  if (reviewResult.status === 'finding') {
    const expectedPriority = defaultFindingPriority(ruleLevel);
    const actualPriority = reviewResult.priority || expectedPriority;
    if (!FINDING_PRIORITIES.includes(actualPriority)) return;
    if (ruleLevel === 'MUST' && actualPriority !== 'must_fix') {
      addViolation(result, `${prefix}040`, artifact, `${pointer}/priority`, 'MUST finding priority must be must_fix', 'must_fix', actualPriority);
    }
    if (actualPriority !== expectedPriority && ruleLevel !== 'MUST' && !isNonEmptyString(reviewResult.priorityReason)) {
      addViolation(result, `${prefix}029`, artifact, `${pointer}/priorityReason`, 'priority override requires priorityReason', 'non-empty priorityReason', reviewResult.priorityReason);
    }
  }
}

function ruleLevelForReviewResult(reviewResult, taskContext) {
  const item = taskContext && taskContext.reviewItems ? taskContext.reviewItems.get(reviewResult && reviewResult.reviewItemId) : null;
  const rule = item && taskContext && taskContext.rules ? taskContext.rules.get(item.ruleRef) : null;
  return rule && rule.ruleLevel;
}

function defaultResultStatus(ruleLevel, origin) {
  if (ruleLevel === 'ADVISORY') return 'observation';
  if (origin === 'introduced_by_change' || origin === 'worsened_by_change') return 'finding';
  return 'observation';
}

function defaultFindingPriority(ruleLevel) {
  return ruleLevel === 'MUST' ? 'must_fix' : 'should_fix';
}

function validateRun(runDir, result) {
  if (!runDir || runDir === true) {
    addViolation(result, 'RUN001', null, '/dir', 'run mode requires --dir', 'run directory', runDir || null, 2);
    return;
  }

  if (!validateRunDirectoryFiles(runDir, result)) return;

  const dispatchPath = path.join(runDir, 'dispatch.json');
  const finalReviewPath = path.join(runDir, 'finalReview.json');
  const finalMdPath = path.join(runDir, 'final.md');
  const dispatch = readJson(dispatchPath, rel(runDir, dispatchPath), result, 'D001');
  if (dispatch) validateDispatch(dispatch, rel(runDir, dispatchPath), result, dispatchPath);

  const finalReview = readJson(finalReviewPath, rel(runDir, finalReviewPath), result, 'FR001');
  if (finalReview) validateFinalReviewShape(finalReview, rel(runDir, finalReviewPath), result);

  const runState = dispatch ? validateRunArtifacts(runDir, dispatch, result) : { results: [], resultOwners: new Map(), otherConcerns: [] };
  if (dispatch) validateCurrentBatchResults(dispatch, runState.results, runState.resultOwners, result);
  const currentResults = dispatch ? runState.results : [];
  if (dispatch) validateCompleteResults(dispatch, currentResults, result);

  const beforeFinalGate = calculateGate(dispatch, currentResults, result);
  if (finalReview && dispatch) validateFinalReviewAgainstComputed(finalReview, dispatch, currentResults, beforeFinalGate, runState.otherConcerns, rel(runDir, finalReviewPath), result);
  result.gate = calculateGate(dispatch, currentResults, result);
  if (finalReview && result.gate.recommendation === 'should_review_before_merge') {
    result.gate.shouldSetHash = calculateShouldSetHash(finalReview);
  }

  if (result.gate.protocolGate !== 'passed') {
    addViolation(result, 'RUN900', rel(runDir, 'finalReview.json'), '/protocolGate', 'protocolGate must be passed for automation gate success', 'passed', result.gate.protocolGate, 1, null);
  } else {
    validateFinalMarkdown(finalReview, finalMdPath, result, dispatch);
  }
}

function compareFindingIdSuffix(left, right) {
  const leftSuffix = String(left.findingId).slice(1).replace(/^0+(?=\d)/, '');
  const rightSuffix = String(right.findingId).slice(1).replace(/^0+(?=\d)/, '');
  return (leftSuffix.length - rightSuffix.length)
    || (leftSuffix < rightSuffix ? -1 : leftSuffix > rightSuffix ? 1 : 0)
    || compareStrings(String(left.findingId), String(right.findingId));
}

function canonicalStringify(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`;
  if (!isObject(value)) return JSON.stringify(value);
  return `{${Object.keys(value)
    .sort(compareStrings)
    .map((key) => `${JSON.stringify(key)}:${canonicalStringify(value[key])}`)
    .join(',')}}`;
}

function calculateTaskHash(task) {
  const content = { ...task };
  delete content.taskHash;
  return hashBytes(Buffer.from(canonicalStringify(content), 'utf8'));
}

function calculateShouldSetHash(finalReview) {
  const findings = asArray(finalReview && finalReview.findings)
    .filter((finding) => finding && finding.priority === 'should_fix')
    .sort(compareFindingIdSuffix);
  return hashBytes(Buffer.from(canonicalStringify(findings), 'utf8'));
}

function validateRunDirectoryFiles(runDir, result) {
  let stat;
  let realRoot;
  const absoluteRoot = path.resolve(runDir);
  try {
    stat = fs.lstatSync(absoluteRoot);
    if (stat.isSymbolicLink()) throw new Error('run directory must not be a symbolic link');
    if (!stat.isDirectory()) throw new Error('run directory must be a directory');
    realRoot = fs.realpathSync(absoluteRoot);
  } catch (error) {
    addViolation(result, 'RUN002', null, '/dir', 'run directory must be a readable real directory', 'real directory', error.message, 2);
    return false;
  }

  let files;
  try {
    files = collectFiles(absoluteRoot, realRoot);
  } catch (error) {
    addViolation(result, 'RUN004', null, '/dir', 'run tree must not contain symbolic links or escape the run root', 'contained regular files and directories', error.message, 2);
    return false;
  }

  files.forEach((filePath) => {
    const relativePath = rel(runDir, filePath);
    if (!isAllowedRunArtifact(relativePath)) {
      addViolation(result, 'RUN003', relativePath, null, 'run directory must only contain rules-review protocol artifacts', 'dispatch/finalReview/final/response/handoff or JSON under tasks/shards/validations', relativePath);
    }
  });
  return true;
}

function collectFiles(dir, realRoot = fs.realpathSync(dir)) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .sort((left, right) => compareStrings(left.name, right.name))
    .flatMap((entry) => {
      const entryPath = path.join(dir, entry.name);
      const stat = fs.lstatSync(entryPath);
      if (stat.isSymbolicLink()) throw new Error(`symbolic link is forbidden: ${rel(dir, entryPath)}`);
      const realPath = fs.realpathSync(entryPath);
      const relativeRealPath = path.relative(realRoot, realPath);
      if (relativeRealPath.startsWith('..') || path.isAbsolute(relativeRealPath)) {
        throw new Error(`real path escapes run root: ${realPath}`);
      }
      if (stat.isDirectory()) return collectFiles(entryPath, realRoot);
      if (!stat.isFile()) throw new Error(`non-regular run artifact is forbidden: ${entryPath}`);
      return [entryPath];
    });
}

function isAllowedRunArtifact(relativePath) {
  if (['dispatch.json', 'finalReview.json', 'final.md', 'response.md', 'handoff.md'].includes(relativePath)) return true;
  return /^(tasks|shards|validations)\/[^/]+\.json$/.test(relativePath);
}

function validateRunArtifacts(runDir, dispatch, result) {
  const reviewItems = new Map(asArray(dispatch.reviewItems).map((item) => [item.reviewItemId, item]));
  const results = [];
  const resultOwners = new Map();
  const otherConcerns = [];

  if (asArray(dispatch.reviewBatches).length === 0) {
    const reviewerArtifacts = collectFiles(runDir)
      .map((filePath) => rel(runDir, filePath))
      .filter((relativePath) => /^(tasks|shards)\/.+\.json$/.test(relativePath));
    if (reviewerArtifacts.length > 0) {
      addViolation(result, 'RUN009', rel(runDir, 'dispatch.json'), null, 'run without reviewBatches must not contain reviewer JSON artifacts', [], reviewerArtifacts);
    }
    return { results, resultOwners, otherConcerns };
  }

  asArray(dispatch.reviewBatches).forEach((batch, batchIndex) => {
    const batchPointer = `/reviewBatches/${batchIndex}`;
    const reviewBatchId = batch && batch.reviewBatchId;
    const expectedTaskRef = isSafeToken(reviewBatchId) ? `tasks/${reviewBatchId}.json` : null;
    if (!expectedTaskRef) return;
    const taskPath = path.join(runDir, 'tasks', `${reviewBatchId}.json`);
    const taskArtifact = rel(runDir, taskPath);

    if (!fs.existsSync(taskPath)) {
      addViolation(result, 'RUN010', rel(runDir, 'dispatch.json'), batchPointer, 'task.json missing for reviewBatch', expectedTaskRef, null, 1, 'incomplete');
      return;
    }

    const task = readJson(taskPath, taskArtifact, result, 'T001');
    if (!task) return;
    validateTask(task, taskArtifact, result, taskPath);
    validateTaskAgainstDispatch(task, dispatch, batch, reviewItems, taskArtifact, result);

    const expectedShardRef = `shards/${reviewBatchId}.json`;
    const shardPath = path.join(runDir, 'shards', `${reviewBatchId}.json`);
    const shardArtifact = rel(runDir, shardPath);
    if (!fs.existsSync(shardPath)) {
      addViolation(result, 'RUN011', rel(runDir, 'dispatch.json'), batchPointer, 'shard.json missing for reviewBatch', expectedShardRef, null, 1, 'incomplete');
      return;
    }
    const shard = readJson(shardPath, shardArtifact, result, 'S001');
    if (!shard) return;
    validateShard(shard, task, shardArtifact, result);
    validateShardAgainstBatch(shard, batch, shardArtifact, result);
    otherConcerns.push(...asArray(shard.otherConcerns).filter(isNonEmptyString));

    asArray(shard.results).forEach((reviewResult, resultIndex) => {
      if (reviewResult && reviewResult.reviewItemId) {
        results.push(reviewResult);
        if (!resultOwners.has(reviewResult.reviewItemId)) resultOwners.set(reviewResult.reviewItemId, []);
        resultOwners.get(reviewResult.reviewItemId).push({ batch, shard, index: resultIndex });
      }
    });
  });

  return { results, resultOwners, otherConcerns: [...new Set(otherConcerns)] };
}

function mergeValidationResult(target, source) {
  target.violations.push(...source.violations);
  target.skipped.push(...source.skipped);
  target.gateImpact.blocked ||= source.gateImpact.blocked;
  target.gateImpact.incomplete ||= source.gateImpact.incomplete;
  target.exitCode = Math.max(target.exitCode, source.exitCode);
}

function reviewItemTuple(item) {
  return `${item && item.ruleRef || ''}\u0000${item && item.targetId || ''}`;
}

function numericId(value, pattern) {
  return pattern.test(value || '') ? BigInt(String(value).replace(/^[A-Z]+/, '')) : -1n;
}

function maxNumericId(values, pattern) {
  let max = -1n;
  for (const value of values) {
    const numeric = numericId(value, pattern);
    if (numeric > max) max = numeric;
  }
  return max;
}

function validateTaskAgainstDispatch(task, dispatch, batch, reviewItems, artifact, result) {
  if (task.runId !== dispatch.runId) addViolation(result, 'RUN020', artifact, '/runId', 'task runId must match dispatch runId', dispatch.runId, task.runId);
  if (task.reviewBatchId !== batch.reviewBatchId) addViolation(result, 'RUN021', artifact, '/reviewBatchId', 'task reviewBatchId must match reviewBatchId', batch.reviewBatchId, task.reviewBatchId);
  if (task.ruleSetId !== dispatch.ruleSet.ruleSetId) addViolation(result, 'RUN022', artifact, '/ruleSetId', 'task ruleSetId must match dispatch ruleSetId', dispatch.ruleSet.ruleSetId, task.ruleSetId);
  if (canonicalStringify(task.reviewRange) !== canonicalStringify(dispatch.reviewRange)) {
    addViolation(result, 'RUN038', artifact, '/reviewRange', 'task reviewRange must equal dispatch reviewRange', dispatch.reviewRange, task.reviewRange);
  }
  if (canonicalStringify(task.inputSnapshot) !== canonicalStringify(dispatch.inputSnapshot)) {
    addViolation(result, 'RUN039', artifact, '/inputSnapshot', 'task inputSnapshot must equal dispatch inputSnapshot', dispatch.inputSnapshot, task.inputSnapshot);
  }
  if (canonicalStringify(task.ruleInputSource) !== canonicalStringify(dispatch.ruleInputSource)) {
    addViolation(result, 'RUN053', artifact, '/ruleInputSource', 'task ruleInputSource must equal dispatch ruleInputSource', dispatch.ruleInputSource, task.ruleInputSource);
  }
  const expectedRuleSnapshot = projectRuleSnapshot(dispatch.ruleSnapshot, task.rules);
  if (canonicalStringify(task.ruleSnapshot) !== canonicalStringify(expectedRuleSnapshot)) {
    addViolation(result, 'RUN052', artifact, '/ruleSnapshot', 'task ruleSnapshot must equal the sealed dispatch snapshot for its rules', expectedRuleSnapshot, task.ruleSnapshot);
  }

  const expectedItemIds = asArray(batch.reviewItemIds);
  const actualItemIds = asArray(task.reviewItems).map((item) => item.reviewItemId);
  if (!setsEqual(new Set(expectedItemIds), new Set(actualItemIds))) {
    addViolation(result, 'RUN023', artifact, '/reviewItems', 'task reviewItems must match reviewBatch reviewItemIds', expectedItemIds, actualItemIds);
  }
  asArray(task.reviewItems).forEach((item, index) => {
    const expected = reviewItems.get(item.reviewItemId);
    if (!expected) return;
    ['ruleRef', 'targetKind', 'targetId'].forEach((field) => {
      if (item[field] !== expected[field]) addViolation(result, 'RUN024', artifact, `/reviewItems/${index}/${field}`, 'task reviewItem must equal dispatch reviewItem', expected[field], item[field]);
    });
  });
  validateTaskApplicabilityAgainstDispatch(task, dispatch, batch, artifact, result);

  const dispatchTargets = buildDispatchTargetMap(dispatch);
  const taskTargets = new Map(asArray(task.targets).map((target) => [target && target.targetId, target]));
  asArray(task.reviewItems).forEach((item, index) => {
    const taskTarget = taskTargets.get(item && item.targetId);
    const dispatchTarget = dispatchTargets.get(item && item.targetId);
    if (!taskTarget) {
      addViolation(result, 'RUN028', artifact, `/reviewItems/${index}/targetId`, 'task.targets[] must include each task reviewItem targetId', item && item.targetId, Array.from(taskTargets.keys()));
      return;
    }
    if (taskTarget.targetKind !== item.targetKind) {
      addViolation(result, 'RUN029', artifact, `/targets/${item.targetId}/targetKind`, 'task targetKind must match reviewItem targetKind', item.targetKind, taskTarget.targetKind);
    }
    validateReviewTargetContext(taskTarget, artifact, result, 'RUN032', `/targets/${item.targetId}`);
    if (dispatchTarget) validateTargetSnapshot(taskTarget, dispatchTarget, artifact, result, 'RUN030', `/targets/${item.targetId}`);
  });

  const taskRulesByRuleRef = new Map(asArray(task.rules).map((rule) => [rule.ruleRef, rule]));
  expectedItemIds.forEach((reviewItemId) => {
    const item = reviewItems.get(reviewItemId);
    if (item && !taskRulesByRuleRef.has(item.ruleRef)) addViolation(result, 'RUN025', artifact, '/rules', 'task.rules[] must include every batch ruleRef', item.ruleRef, Array.from(taskRulesByRuleRef.keys()));
  });

  asArray(task.rules).forEach((rule, index) => {
    const source = dispatch.ruleSet.ruleSources.find((entry) => entry.ruleRef === rule.ruleRef)
      || dispatch.ruleSet.ruleSources.find((entry) => entry.namespace === rule.namespace && entry.sourceFile === rule.sourceFile);
    if (!source) {
      addViolation(result, 'RUN026', artifact, `/rules/${index}`, 'task rule must map to dispatch ruleSources by ruleRef or namespace/sourceFile', dispatch.ruleSet.ruleSources, rule);
      return;
    }
    if (rule.sourceHash !== source.sourceHash) {
      addViolation(result, 'RUN027', artifact, `/rules/${index}/sourceHash`, 'task.rules[].sourceHash must match dispatch ruleSources[].sourceHash', source.sourceHash, rule.sourceHash);
    }
    if (rule.ruleLevel !== source.ruleLevel) {
      addViolation(result, 'RUN033', artifact, `/rules/${index}/ruleLevel`, 'task.rules[].ruleLevel must match dispatch ruleSources[].ruleLevel', source.ruleLevel, rule.ruleLevel);
    }
    if (!rulesHaveSameBody(rule, source)) {
      addViolation(result, 'RUN031', artifact, `/rules/${index}`, 'task rule summary or ruleText must match dispatch ruleSource', { summary: source.summary || null, ruleText: source.ruleText || null }, { summary: rule.summary || null, ruleText: rule.ruleText || null });
    }
    if (!optionalJsonEqual(rule.failureConditions, source.failureConditions)) {
      addViolation(result, 'RUN036', artifact, `/rules/${index}/failureConditions`, 'task.rules[].failureConditions must match dispatch ruleSources[].failureConditions', source.failureConditions || null, rule.failureConditions || null);
    }
    if (!optionalJsonEqual(rule.requiredContext, source.requiredContext)) {
      addViolation(result, 'RUN037', artifact, `/rules/${index}/requiredContext`, 'task.rules[].requiredContext must match dispatch ruleSources[].requiredContext', source.requiredContext || null, rule.requiredContext || null);
    }
  });
}

function validateTaskApplicabilityAgainstDispatch(task, dispatch, batch, artifact, result) {
  const expectedItemIds = new Set(asArray(batch && batch.reviewItemIds));
  const expectedRows = asArray(dispatch && dispatch.applicabilityMatrix)
    .filter((entry) => entry && entry.reviewItemId && expectedItemIds.has(entry.reviewItemId));
  const actualRows = asArray(task && task.applicabilityMatrix);

  if (actualRows.length !== expectedRows.length) {
    addViolation(result, 'RUN034', artifact, '/applicabilityMatrix', 'task applicabilityMatrix must include each dispatch applicable row for this batch and no extras', expectedRows, actualRows);
    return;
  }
  if (!unorderedItemsEqual(actualRows, expectedRows, applicabilityRowsEqual)) {
    addViolation(result, 'RUN035', artifact, '/applicabilityMatrix', 'task applicabilityMatrix rows must equal dispatch rows for this batch', expectedRows, actualRows);
  }
}

function applicabilityRowsEqual(left, right) {
  return ['ruleRef', 'targetId', 'targetKind', 'applicability', 'reviewItemId', 'reason'].every((field) => optionalField(left, field) === optionalField(right, field))
    && evidenceArraysEqual(left && left.evidence, right && right.evidence);
}

function validateShardAgainstBatch(shard, batch, artifact, result) {
  const batchItems = new Set(asArray(batch.reviewItemIds));
  asArray(shard.results).forEach((reviewResult, index) => {
    if (!batchItems.has(reviewResult && reviewResult.reviewItemId)) {
      addViolation(result, 'RUN030', artifact, `/results/${index}/reviewItemId`, 'shard result reviewItemId must belong to shard reviewBatchId', Array.from(batchItems), reviewResult && reviewResult.reviewItemId);
    }
  });
}

function validateCurrentBatchResults(dispatch, results, resultOwners, result) {
  const assignedIds = new Set(asArray(dispatch.reviewBatches).flatMap((batch) => asArray(batch && batch.reviewItemIds)));

  results.forEach((reviewResult, index) => {
    if (!assignedIds.has(reviewResult && reviewResult.reviewItemId)) {
      addViolation(result, 'RUN040', result.artifact, `/results/${index}/reviewItemId`, 'current shard result must reference a batched reviewItemId', Array.from(assignedIds), reviewResult && reviewResult.reviewItemId);
    }
  });

  assignedIds.forEach((reviewItemId) => {
    const owners = resultOwners.get(reviewItemId) || [];
    if (owners.length === 0) {
      addViolation(result, 'RUN041', result.artifact, `/reviewItems/${reviewItemId}`, 'batched reviewItem must have exactly one current shard result', 'one result', 0, 1, 'incomplete');
    } else if (owners.length > 1) {
      addViolation(result, 'RUN042', result.artifact, `/reviewItems/${reviewItemId}`, 'batched reviewItem has duplicate current shard results', 'one result', owners.length);
    }
  });
}

function validateCompleteResults(dispatch, currentResults, result) {
  const currentIds = new Set(asArray(dispatch && dispatch.reviewItems).map((item) => item && item.reviewItemId).filter(Boolean));
  const counts = new Map();
  asArray(currentResults).forEach((reviewResult, index) => {
    const reviewItemId = reviewResult && reviewResult.reviewItemId;
    if (!currentIds.has(reviewItemId)) {
      addViolation(result, 'RUN043', result.artifact, `/currentResults/${index}/reviewItemId`, 'current result must belong to current reviewItems', [...currentIds], reviewItemId);
      return;
    }
    counts.set(reviewItemId, (counts.get(reviewItemId) || 0) + 1);
  });
  currentIds.forEach((reviewItemId) => {
    const count = counts.get(reviewItemId) || 0;
    if (count !== 1) {
      addViolation(
        result,
        'RUN044',
        result.artifact,
        `/currentResults/${reviewItemId}`,
        'every current reviewItem must have exactly one current result',
        1,
        count,
        1,
        count === 0 ? 'incomplete' : 'blocked',
      );
    }
  });
}

function calculateGate(dispatch, results, result) {
  const protocolGate = result.gateImpact.blocked ? 'blocked' : result.gateImpact.incomplete ? 'incomplete' : 'passed';
  const scopeMode = dispatch && (
    asArray(dispatch.reviewRange && dispatch.reviewRange.excludedFiles).length > 0
    || asArray(dispatch.ruleSet && dispatch.ruleSet.excludedRuleRefs).length > 0
  ) ? 'scoped' : 'full';
  const coverageClaim = protocolGate === 'blocked'
    ? 'blocked'
    : protocolGate === 'incomplete'
      ? 'incomplete'
      : scopeMode === 'scoped'
        ? 'scoped_complete'
        : 'full_complete';
  const semanticVerdict = deriveSemanticVerdict(results, protocolGate);
  const issueSummary = deriveIssueSummary(results, dispatch);
  const recommendation = deriveRecommendation(protocolGate, issueSummary);
  return { protocolGate, scopeMode, coverageClaim, semanticVerdict, issueSummary, recommendation };
}

function deriveSemanticVerdict(results, protocolGate) {
  if (protocolGate !== 'passed') return 'unknown';
  if (asArray(results).some((reviewResult) => reviewResult && reviewResult.status === 'finding')) return 'issues';
  if (asArray(results).some((reviewResult) => reviewResult && reviewResult.status === 'cannot_verify')) return 'unknown';
  return 'clean';
}

function deriveIssueSummary(results, dispatch) {
  const findings = deriveFindingItems(results, dispatch);
  return {
    findings: findings.length,
    mustFix: findings.filter((finding) => finding.priority === 'must_fix').length,
    shouldFix: findings.filter((finding) => finding.priority === 'should_fix').length,
    cannotVerify: asArray(results).filter((reviewResult) => reviewResult && reviewResult.status === 'cannot_verify').length,
    observations: asArray(results).filter((reviewResult) => reviewResult && reviewResult.status === 'observation').length,
  };
}

function issueSummaryFromFinalReview(finalReview) {
  const findings = asArray(finalReview && finalReview.findings);
  const observations = asArray(finalReview && finalReview.observations);
  if (isObject(finalReview && finalReview.issueSummary)) {
    return {
      findings: Number.isInteger(finalReview.issueSummary.findings) ? finalReview.issueSummary.findings : findings.length,
      mustFix: Number.isInteger(finalReview.issueSummary.mustFix) ? finalReview.issueSummary.mustFix : findings.filter((finding) => finding && finding.priority === 'must_fix').length,
      shouldFix: Number.isInteger(finalReview.issueSummary.shouldFix) ? finalReview.issueSummary.shouldFix : findings.filter((finding) => finding && finding.priority === 'should_fix').length,
      cannotVerify: Number.isInteger(finalReview.issueSummary.cannotVerify) ? finalReview.issueSummary.cannotVerify : asArray(finalReview.cannotVerifyItems).length,
      observations: Number.isInteger(finalReview.issueSummary.observations) ? finalReview.issueSummary.observations : observations.length,
    };
  }
  return {
    findings: findings.length,
    mustFix: findings.filter((finding) => finding && finding.priority === 'must_fix').length,
    shouldFix: findings.filter((finding) => finding && finding.priority === 'should_fix').length,
    cannotVerify: asArray(finalReview && finalReview.cannotVerifyItems).length,
    observations: observations.length,
  };
}

function deriveRecommendation(protocolGate, issueSummary) {
  if (protocolGate === 'blocked') return 'review_blocked';
  if (protocolGate === 'incomplete') return 'review_incomplete';
  if (issueSummary.mustFix > 0) return 'must_fix_before_merge';
  if (issueSummary.cannotVerify > 0) return 'manual_verification_required';
  if (issueSummary.shouldFix > 0) return 'should_review_before_merge';
  return 'ready_for_merge';
}

function deriveFindingPriority(reviewResult, dispatch) {
  if (FINDING_PRIORITIES.includes(reviewResult && reviewResult.priority)) return reviewResult.priority;
  return defaultFindingPriority(ruleLevelForDispatchResult(reviewResult, dispatch));
}

function ruleLevelForDispatchResult(reviewResult, dispatch) {
  const reviewItems = new Map(asArray(dispatch && dispatch.reviewItems).map((item) => [item.reviewItemId, item]));
  const ruleSources = new Map(asArray(dispatch && dispatch.ruleSet && dispatch.ruleSet.ruleSources).map((source) => [source.ruleRef, source]));
  const item = reviewItems.get(reviewResult && reviewResult.reviewItemId);
  const source = item ? ruleSources.get(item.ruleRef) : null;
  return source && source.ruleLevel;
}

function deriveFindingItems(results, dispatch) {
  const reviewItems = new Map(asArray(dispatch && dispatch.reviewItems).map((item) => [item.reviewItemId, item]));
  const ruleSources = new Map(asArray(dispatch && dispatch.ruleSet && dispatch.ruleSet.ruleSources).map((source) => [source.ruleRef, source]));
  const reviewBatchIds = new Map(asArray(dispatch && dispatch.reviewBatches).flatMap((batch) => (
    asArray(batch && batch.reviewItemIds).map((reviewItemId) => [reviewItemId, batch.reviewBatchId])
  )));
  const occurrences = asArray(results)
    .filter((reviewResult) => reviewResult && reviewResult.status === 'finding')
    .map((reviewResult) => {
      const item = reviewItems.get(reviewResult.reviewItemId) || {};
      const source = ruleSources.get(item.ruleRef) || {};
      const occurrence = {
        reviewBatchId: reviewBatchIds.get(reviewResult.reviewItemId) || `\0${reviewResult.reviewItemId}`,
        rootCause: reviewResult.rootCause,
        reviewItemId: reviewResult.reviewItemId,
        ruleRef: item.ruleRef || 'unknown',
        targetId: item.targetId || 'unknown',
        ruleLevel: source.ruleLevel || 'unknown',
        origin: reviewResult.origin,
        priority: deriveFindingPriority(reviewResult, dispatch),
        evidence: reviewResult.evidence,
      };
      copyOptionalFields(reviewResult, occurrence, ['priorityReason', 'upgradeReason', 'originReason']);
      return occurrence;
    })
    .sort((left, right) => {
      const leftId = numericId(left.reviewItemId, REVIEW_ITEM_RE);
      const rightId = numericId(right.reviewItemId, REVIEW_ITEM_RE);
      return leftId < rightId ? -1 : leftId > rightId ? 1 : compareStrings(left.reviewItemId, right.reviewItemId);
    });
  const groups = new Map();
  occurrences.forEach((occurrence) => {
    const rootCause = isNonEmptyString(occurrence.rootCause) ? occurrence.rootCause : `\0${occurrence.reviewItemId}`;
    const key = JSON.stringify([occurrence.reviewBatchId, rootCause]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(occurrence);
  });
  const findings = Array.from(groups.values()).map((group, index) => ({
    findingId: `F${String(index + 1).padStart(3, '0')}`,
    rootCause: group[0].rootCause,
    priority: group.some((occurrence) => occurrence.priority === 'must_fix') ? 'must_fix' : 'should_fix',
    evidenceGroups: group.map((occurrence) => {
      const evidenceGroup = { ...occurrence };
      delete evidenceGroup.reviewBatchId;
      delete evidenceGroup.rootCause;
      return evidenceGroup;
    }),
  }));
  return findings.sort(compareFindingItems);
}

function compareFindingItems(left, right) {
  return (FINDING_PRIORITIES.indexOf(left.priority) - FINDING_PRIORITIES.indexOf(right.priority))
    || (left.findingId.length - right.findingId.length)
    || left.findingId.localeCompare(right.findingId);
}

function deriveObservationItems(results, dispatch) {
  const reviewItems = new Map(asArray(dispatch && dispatch.reviewItems).map((item) => [item.reviewItemId, item]));
  const ruleSources = new Map(asArray(dispatch && dispatch.ruleSet && dispatch.ruleSet.ruleSources).map((source) => [source.ruleRef, source]));
  return asArray(results)
    .filter((reviewResult) => reviewResult && reviewResult.status === 'observation')
    .map((reviewResult) => {
      const item = reviewItems.get(reviewResult.reviewItemId) || {};
      const source = ruleSources.get(item.ruleRef) || {};
      const observation = {
        reviewItemId: reviewResult.reviewItemId,
        ruleRef: item.ruleRef || 'unknown',
        targetId: item.targetId || 'unknown',
        ruleLevel: source.ruleLevel || 'unknown',
        origin: reviewResult.origin,
      };
      copyOptionalFields(reviewResult, observation, ['reason', 'evidence', 'upgradeReason', 'originReason']);
      return observation;
    });
}

function copyOptionalFields(source, target, fields) {
  fields.forEach((field) => {
    if (source && source[field] !== undefined) target[field] = source[field];
  });
}

function deriveCannotVerifyItems(results, dispatch) {
  const reviewItems = new Map(asArray(dispatch && dispatch.reviewItems).map((item) => [item.reviewItemId, item]));
  return asArray(results)
    .filter((reviewResult) => reviewResult && reviewResult.status === 'cannot_verify')
    .map((reviewResult) => {
      const item = reviewItems.get(reviewResult.reviewItemId) || {};
      return {
        reviewItemId: reviewResult.reviewItemId,
        ruleRef: item.ruleRef || 'unknown',
        targetId: item.targetId || 'unknown',
        reason: reviewResult.reason || formatEvidence(reviewResult.evidence) || '未记录原因',
      };
    });
}

function buildTasksMode(args, result) {
  const dispatch = readJson(args.dispatch, args.dispatch, result, 'D001');
  if (!dispatch) return;
  validateDispatch(dispatch, args.dispatch, result);
  if (!args.out || args.out === true) {
    addViolation(result, 'BT001', null, '/out', 'build-tasks requires --out', 'output directory', args.out || null, 2);
    return;
  }
  if (result.violations.length > 0) return;

  const outputDir = path.resolve(args.out);
  const tasks = buildTasks(dispatch);
  if (asArray(dispatch.reviewBatches).length === 0 && fs.existsSync(outputDir)) {
    const existingTasks = collectFiles(outputDir).filter((filePath) => filePath.endsWith('.json'));
    if (existingTasks.length > 0) {
      addViolation(result, 'BT002', args.out, '/out', 'build-tasks without reviewBatches requires an empty JSON output directory', [], existingTasks.map((filePath) => path.relative(outputDir, filePath)));
      return;
    }
  }
  const reviewItems = new Map(asArray(dispatch.reviewItems).map((item) => [item.reviewItemId, item]));
  const outputs = tasks.map(({ batch, task }) => {
    const outputPath = path.join(outputDir, `${batch.reviewBatchId}.json`);
    return { batch, task, outputPath, content: `${JSON.stringify(task, null, 2)}\n` };
  });
  const conflict = outputs.find(({ outputPath, content }) => {
    if (!fs.existsSync(outputPath)) return false;
    const stat = fs.lstatSync(outputPath);
    return stat.isSymbolicLink() || !stat.isFile() || fs.readFileSync(outputPath, 'utf8') !== content;
  });
  if (conflict) {
    addViolation(result, 'BT003', conflict.outputPath, '/out', 'build-tasks refuses to overwrite an existing task with different bytes', 'absent task or byte-identical task', conflict.outputPath, 2);
    return;
  }
  fs.mkdirSync(outputDir, { recursive: true });
  const written = [];
  outputs.forEach(({ batch, task, outputPath, content }) => {
    if (!fs.existsSync(outputPath)) fs.writeFileSync(outputPath, content);
    validateTask(task, outputPath, result);
    validateTaskAgainstDispatch(task, dispatch, batch, reviewItems, outputPath, result);
    written.push(outputPath);
  });
  result.rendered = written;
}

function buildTasks(dispatch) {
  const reviewItemsById = new Map(asArray(dispatch.reviewItems).map((item) => [item.reviewItemId, item]));
  const targetsById = buildDispatchTargetMap(dispatch);
  const ruleSourcesByRuleRef = new Map(asArray(dispatch.ruleSet && dispatch.ruleSet.ruleSources).map((source) => [source.ruleRef, source]));
  return asArray(dispatch.reviewBatches).map((batch) => {
    const itemIds = asArray(batch.reviewItemIds);
    const reviewItems = itemIds.map((reviewItemId) => reviewItemsById.get(reviewItemId)).filter(Boolean);
    const ruleRefs = new Set(reviewItems.map((item) => item.ruleRef));
    const targetIds = new Set(reviewItems.map((item) => item.targetId));
    const applicabilityRows = asArray(dispatch.applicabilityMatrix)
      .filter((entry) => entry && entry.reviewItemId && itemIds.includes(entry.reviewItemId));
    const rules = asArray(dispatch.ruleSet.ruleSources).filter((source) => source && ruleRefs.has(source.ruleRef) && ruleSourcesByRuleRef.has(source.ruleRef));
    const output = {
      batch,
      task: {
        kind: 'rules-review-task',
        schemaVersion: SCHEMA_VERSION,
        runId: dispatch.runId,
        reviewBatchId: batch.reviewBatchId,
        ruleSetId: dispatch.ruleSet.ruleSetId,
        reviewRange: dispatch.reviewRange,
        ruleInputSource: dispatch.ruleInputSource,
        ruleSnapshot: projectRuleSnapshot(dispatch.ruleSnapshot, rules),
        inputSnapshot: dispatch.inputSnapshot,
        reviewItems,
        rules,
        targets: [...asArray(dispatch.targets && dispatch.targets.changedUnits), ...asArray(dispatch.targets && dispatch.targets.candidates)]
          .filter((target) => target && targetIds.has(target.targetId) && targetsById.has(target.targetId))
          .map((target) => {
            const projected = { targetId: target.targetId, targetKind: target.targetKind };
            copyOptionalFields(target, projected, ['inputRefs', 'loc', 'source', 'summary']);
            return projected;
          }),
        applicabilityMatrix: applicabilityRows,
        outputContract: {
          format: 'strict_json',
          schemaRef: 'schemas/shard.schema.json',
        },
      },
    };
    output.task.taskHash = calculateTaskHash(output.task);
    return output;
  });
}

function projectRuleSnapshot(ruleSnapshot, rules) {
  const paths = new Set(['.agents/rules/index.md', ...asArray(rules).map((rule) => rule && rule.sourceFile).filter(Boolean)]);
  return { files: asArray(ruleSnapshot && ruleSnapshot.files).filter((entry) => entry && paths.has(entry.path)) };
}

function aggregateFinalMode(args, result) {
  const runDir = args.dir;
  if (!runDir || runDir === true) {
    addViolation(result, 'AF001', null, '/dir', 'aggregate-final requires --dir', 'run directory', runDir || null, 2);
    return;
  }
  if (!args.output || args.output === true) {
    addViolation(result, 'AF002', null, '/output', 'aggregate-final requires --output', 'output path', args.output || null, 2);
    return;
  }

  if (!validateRunDirectoryFiles(runDir, result)) return;
  const dispatchPath = path.join(runDir, 'dispatch.json');
  const dispatch = readJson(dispatchPath, rel(runDir, dispatchPath), result, 'D001');
  if (dispatch) validateDispatch(dispatch, rel(runDir, dispatchPath), result, dispatchPath);
  if (!dispatch || result.violations.length > 0) return;
  const runState = dispatch ? validateRunArtifacts(runDir, dispatch, result) : { results: [], resultOwners: new Map(), otherConcerns: [] };
  if (dispatch) validateCurrentBatchResults(dispatch, runState.results, runState.resultOwners, result);
  const currentResults = dispatch ? runState.results : [];
  if (dispatch) validateCompleteResults(dispatch, currentResults, result);
  const gate = calculateGate(dispatch, currentResults, result);
  result.gate = gate;
  const finalReview = buildFinalReview(dispatch, currentResults, gate, runState.otherConcerns);
  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  fs.writeFileSync(args.output, `${JSON.stringify(finalReview, null, 2)}\n`);
  validateFinalReviewShape(finalReview, args.output, result);
  validateFinalReviewAgainstComputed(finalReview, dispatch, currentResults, gate, runState.otherConcerns, args.output, result);
  result.rendered = args.output;
}

function buildFinalReview(dispatch, results, gate, otherConcerns) {
  const finalReview = {
    kind: 'rules-review-final-review',
    schemaVersion: SCHEMA_VERSION,
    runId: dispatch.runId,
    protocolGate: gate.protocolGate,
    scopeMode: gate.scopeMode,
    coverageClaim: gate.coverageClaim,
    semanticVerdict: gate.semanticVerdict,
    excludedFiles: asArray(dispatch.reviewRange && dispatch.reviewRange.excludedFiles),
    excludedRuleRefs: asArray(dispatch.ruleSet && dispatch.ruleSet.excludedRuleRefs),
    findings: deriveFindingItems(results, dispatch),
    observations: deriveObservationItems(results, dispatch),
    issueSummary: gate.issueSummary,
    recommendation: gate.recommendation,
    validationResults: [
      {
        mode: 'run',
        ok: gate.protocolGate === 'passed',
        protocolGate: gate.protocolGate,
        semanticVerdict: gate.semanticVerdict,
        issueSummary: gate.issueSummary,
        recommendation: gate.recommendation,
      },
    ],
  };
  const cannotVerifyItems = deriveCannotVerifyItems(results, dispatch);
  if (cannotVerifyItems.length > 0) finalReview.cannotVerifyItems = cannotVerifyItems;
  if (asArray(otherConcerns).length > 0) finalReview.otherConcerns = otherConcerns;
  return finalReview;
}

function validateFinalReviewShape(finalReview, artifact, result) {
  expectKind(finalReview, artifact, result, 'FR002', 'rules-review-final-review');
  validateSchemaVersion(finalReview, artifact, result, 'FR003');
  const requiredFields = [
    'kind',
    'schemaVersion',
    'runId',
    'protocolGate',
    'scopeMode',
    'coverageClaim',
    'semanticVerdict',
    'excludedFiles',
    'excludedRuleRefs',
    'findings',
    'observations',
    'issueSummary',
    'recommendation',
    'validationResults',
  ];
  requireFields(finalReview, artifact, result, 'FR004', '', requiredFields);
  rejectUnsupportedFields(finalReview, artifact, result, 'FR078', '', [...requiredFields, 'cannotVerifyItems', 'otherConcerns', 'summary'], 'finalReview');
  if (!isRunId(finalReview && finalReview.runId)) addViolation(result, 'FR075', artifact, '/runId', 'finalReview runId must match YYYYMMDDTHHmmssZ-rr-xxxxxxxx', 'UTC timestamp + rr + 8 lowercase hex characters', finalReview && finalReview.runId);
  if (!PROTOCOL_GATES.includes(finalReview.protocolGate)) addViolation(result, 'FR005', artifact, '/protocolGate', 'protocolGate must be valid', PROTOCOL_GATES, finalReview.protocolGate);
  if (!SCOPE_MODES.includes(finalReview.scopeMode)) addViolation(result, 'FR006', artifact, '/scopeMode', 'scopeMode must be valid', SCOPE_MODES, finalReview.scopeMode);
  if (!COVERAGE_CLAIMS.includes(finalReview.coverageClaim)) addViolation(result, 'FR007', artifact, '/coverageClaim', 'coverageClaim must be valid', COVERAGE_CLAIMS, finalReview.coverageClaim);
  if (!SEMANTIC_VERDICTS.includes(finalReview.semanticVerdict)) addViolation(result, 'FR008', artifact, '/semanticVerdict', 'semanticVerdict must be valid', SEMANTIC_VERDICTS, finalReview.semanticVerdict);
  validateIssueSummary(finalReview.issueSummary, artifact, result, 'FR015', '/issueSummary');
  if (!RECOMMENDATIONS.includes(finalReview.recommendation)) addViolation(result, 'FR016', artifact, '/recommendation', 'recommendation must be valid', RECOMMENDATIONS, finalReview.recommendation);
  const excludedFiles = validateRepoPathArray(finalReview.excludedFiles, artifact, result, 'FR079', '/excludedFiles');
  if (excludedFiles.length > 0) {
    addViolation(result, 'FR081', artifact, '/excludedFiles', 'commit-only rules-review requires excludedFiles to be exactly []', [], finalReview.excludedFiles);
  }
  validateStringSet(finalReview.excludedRuleRefs, artifact, result, 'FR009', '/excludedRuleRefs');
  if (!Array.isArray(finalReview.findings)) addViolation(result, 'FR010', artifact, '/findings', 'findings must be array', 'array', finalReview.findings);
  if (!Array.isArray(finalReview.observations)) addViolation(result, 'FR058', artifact, '/observations', 'observations must be array', 'array', finalReview.observations);
  validateValidationResults(finalReview, artifact, result);
  if (finalReview.cannotVerifyItems !== undefined) validateCannotVerifyItems(finalReview.cannotVerifyItems, artifact, result);
  if (finalReview.otherConcerns !== undefined) validateStringSet(finalReview.otherConcerns, artifact, result, 'FR082', '/otherConcerns');
  asArray(finalReview.findings).forEach((finding, index) => {
    const pointer = `/findings/${index}`;
    requireFields(finding, artifact, result, 'FR012', pointer, ['findingId', 'rootCause', 'priority', 'evidenceGroups']);
    rejectUnsupportedFields(finding, artifact, result, 'FR091', pointer, ['findingId', 'rootCause', 'priority', 'evidenceGroups'], 'finalReview finding');
    if (!FINDING_RE.test(finding && finding.findingId)) addViolation(result, 'FR074', artifact, `/findings/${index}/findingId`, 'final findingId must match F followed by at least three digits', 'Fxxx...', finding && finding.findingId);
    if (!isNonEmptyString(finding && finding.rootCause)) addViolation(result, 'FR085', artifact, `${pointer}/rootCause`, 'final finding rootCause must be non-empty string', 'non-empty rootCause', finding && finding.rootCause);
    if (!FINDING_PRIORITIES.includes(finding && finding.priority)) addViolation(result, 'FR061', artifact, `/findings/${index}/priority`, 'final finding priority must be valid', FINDING_PRIORITIES, finding && finding.priority);
    if (finding && Object.prototype.hasOwnProperty.call(finding, 'acceptedRisk')) {
      addViolation(result, 'FR062', artifact, `/findings/${index}/acceptedRisk`, 'finalReview finding must not contain acceptedRisk', 'field absent', finding.acceptedRisk);
    }
    if (!Array.isArray(finding && finding.evidenceGroups) || finding.evidenceGroups.length === 0) {
      addViolation(result, 'FR013', artifact, `${pointer}/evidenceGroups`, 'final finding requires non-empty evidenceGroups', 'non-empty evidenceGroups[]', finding && finding.evidenceGroups);
    }
    asArray(finding && finding.evidenceGroups).forEach((evidenceGroup, groupIndex) => {
      const groupPointer = `${pointer}/evidenceGroups/${groupIndex}`;
      requireFields(evidenceGroup, artifact, result, 'FR086', groupPointer, ['reviewItemId', 'ruleRef', 'targetId', 'ruleLevel', 'origin', 'priority', 'evidence']);
      rejectUnsupportedFields(evidenceGroup, artifact, result, 'FR092', groupPointer, ['reviewItemId', 'ruleRef', 'targetId', 'ruleLevel', 'origin', 'priority', 'priorityReason', 'upgradeReason', 'originReason', 'evidence'], 'finalReview finding evidenceGroup');
      if (!REVIEW_ITEM_RE.test(evidenceGroup && evidenceGroup.reviewItemId)) addViolation(result, 'FR076', artifact, `${groupPointer}/reviewItemId`, 'finding evidenceGroup reviewItemId must match RI followed by at least three digits', 'RIxxx...', evidenceGroup && evidenceGroup.reviewItemId);
      if (!isNonEmptyString(evidenceGroup && evidenceGroup.ruleRef)) addViolation(result, 'FR087', artifact, `${groupPointer}/ruleRef`, 'finding evidenceGroup ruleRef must be non-empty string', 'string', evidenceGroup && evidenceGroup.ruleRef);
      if (!TARGET_RE.test((evidenceGroup && evidenceGroup.targetId) || '')) addViolation(result, 'FR077', artifact, `${groupPointer}/targetId`, 'finding evidenceGroup targetId must match T followed by at least three digits', 'Txxx...', evidenceGroup && evidenceGroup.targetId);
      if (!RULE_LEVELS.includes(evidenceGroup && evidenceGroup.ruleLevel)) addViolation(result, 'FR059', artifact, `${groupPointer}/ruleLevel`, 'finding evidenceGroup ruleLevel must be valid', RULE_LEVELS, evidenceGroup && evidenceGroup.ruleLevel);
      if (!FINDING_ORIGINS.includes(evidenceGroup && evidenceGroup.origin)) addViolation(result, 'FR060', artifact, `${groupPointer}/origin`, 'finding evidenceGroup origin must be valid', FINDING_ORIGINS, evidenceGroup && evidenceGroup.origin);
      if (!FINDING_PRIORITIES.includes(evidenceGroup && evidenceGroup.priority)) addViolation(result, 'FR088', artifact, `${groupPointer}/priority`, 'finding evidenceGroup priority must be valid', FINDING_PRIORITIES, evidenceGroup && evidenceGroup.priority);
      if (evidenceGroup && Object.prototype.hasOwnProperty.call(evidenceGroup, 'acceptedRisk')) {
        addViolation(result, 'FR089', artifact, `${groupPointer}/acceptedRisk`, 'finding evidenceGroup must not contain acceptedRisk', 'field absent', evidenceGroup.acceptedRisk);
      }
      validateFinalReviewEvidenceArray(evidenceGroup && evidenceGroup.evidence, artifact, result, 'FR090', `${groupPointer}/evidence`, 'finding evidenceGroup requires evidence');
    });
  });
  asArray(finalReview.observations).forEach((observation, index) => {
    const pointer = `/observations/${index}`;
    requireFields(observation, artifact, result, 'FR063', pointer, ['reviewItemId', 'ruleRef', 'targetId', 'ruleLevel', 'origin']);
    rejectUnsupportedFields(observation, artifact, result, 'FR093', pointer, ['reviewItemId', 'ruleRef', 'targetId', 'ruleLevel', 'origin', 'reason', 'upgradeReason', 'originReason', 'evidence'], 'finalReview observation');
    if (!REVIEW_ITEM_RE.test(observation && observation.reviewItemId)) addViolation(result, 'FR064', artifact, `/observations/${index}/reviewItemId`, 'observation reviewItemId must match RIxxx', 'RIxxx', observation && observation.reviewItemId);
    if (!isNonEmptyString(observation && observation.ruleRef)) addViolation(result, 'FR065', artifact, `/observations/${index}/ruleRef`, 'observation ruleRef must be non-empty string', 'string', observation && observation.ruleRef);
    if (!TARGET_RE.test((observation && observation.targetId) || '')) addViolation(result, 'FR066', artifact, `/observations/${index}/targetId`, 'observation targetId must match T followed by at least three digits', 'Txxx...', observation && observation.targetId);
    if (!RULE_LEVELS.includes(observation && observation.ruleLevel)) addViolation(result, 'FR067', artifact, `/observations/${index}/ruleLevel`, 'observation ruleLevel must be valid', RULE_LEVELS, observation && observation.ruleLevel);
    if (!FINDING_ORIGINS.includes(observation && observation.origin)) addViolation(result, 'FR068', artifact, `/observations/${index}/origin`, 'observation origin must be valid', FINDING_ORIGINS, observation && observation.origin);
    if (observation && observation.ruleLevel !== 'ADVISORY' && ['exposed_by_change', 'pre_existing'].includes(observation.origin)) {
      validateEvidenceArray(observation.evidence, artifact, result, 'FR073', `/observations/${index}/evidence`, 'non-ADVISORY observation with exposed_by_change or pre_existing requires evidence');
    }
    if (!hasValidEvidenceArray(observation && observation.evidence) && !isNonEmptyString(observation && observation.reason)) addViolation(result, 'FR069', artifact, `/observations/${index}`, 'observation requires reason or evidence', 'reason or evidence[]', observation);
    if (observation && observation.evidence !== undefined) validateFinalReviewEvidenceArray(observation.evidence, artifact, result, 'FR070', `/observations/${index}/evidence`, 'observation evidence must be reviewable when present');
  });
}

function validateFinalReviewAgainstComputed(finalReview, dispatch, results, computed, otherConcerns, artifact, result) {
  if (finalReview.runId !== dispatch.runId) addViolation(result, 'FR020', artifact, '/runId', 'finalReview runId must match dispatch runId', dispatch.runId, finalReview.runId);

  const excludedFiles = asArray(dispatch.reviewRange && dispatch.reviewRange.excludedFiles);
  if (!setsEqual(new Set(asArray(finalReview.excludedFiles)), new Set(excludedFiles))) {
    addViolation(result, 'FR080', artifact, '/excludedFiles', 'finalReview excludedFiles must match dispatch reviewRange.excludedFiles', excludedFiles, finalReview.excludedFiles);
  }
  const excluded = asArray(dispatch.ruleSet.excludedRuleRefs);
  if (!setsEqual(new Set(asArray(finalReview.excludedRuleRefs)), new Set(excluded))) {
    addViolation(result, 'FR021', artifact, '/excludedRuleRefs', 'finalReview excludedRuleRefs must match dispatch ruleSet.excludedRuleRefs', excluded, finalReview.excludedRuleRefs);
  }
  if (finalReview.scopeMode === 'scoped' && asArray(finalReview.excludedFiles).length === 0 && asArray(finalReview.excludedRuleRefs).length === 0) {
    addViolation(result, 'FR022', artifact, '/scopeMode', 'scoped scopeMode requires excludedFiles or excludedRuleRefs', 'non-empty excludedFiles or excludedRuleRefs', { excludedFiles: finalReview.excludedFiles, excludedRuleRefs: finalReview.excludedRuleRefs });
  }
  if (finalReview.scopeMode === 'scoped' && finalReview.coverageClaim === 'full_complete') {
    addViolation(result, 'FR023', artifact, '/coverageClaim', 'scoped mode must not declare coverageClaim=full_complete', 'scoped_complete/incomplete/blocked', finalReview.coverageClaim);
  }
  if (finalReview.protocolGate !== computed.protocolGate) {
    addViolation(result, 'FR024', artifact, '/protocolGate', 'finalReview protocolGate must equal validator result', computed.protocolGate, finalReview.protocolGate);
  }
  if (finalReview.scopeMode !== computed.scopeMode) {
    addViolation(result, 'FR025', artifact, '/scopeMode', 'finalReview scopeMode must equal validator result', computed.scopeMode, finalReview.scopeMode);
  }
  if (finalReview.coverageClaim !== computed.coverageClaim) {
    addViolation(result, 'FR026', artifact, '/coverageClaim', 'finalReview coverageClaim must equal validator result', computed.coverageClaim, finalReview.coverageClaim);
  }

  const derivedSemantic = deriveSemanticVerdict(results, computed.protocolGate);
  if (computed.protocolGate === 'passed') {
    if (finalReview.semanticVerdict !== derivedSemantic) addViolation(result, 'FR027', artifact, '/semanticVerdict', 'finalReview semanticVerdict must equal validator result', derivedSemantic, finalReview.semanticVerdict);
  } else if (finalReview.semanticVerdict !== 'unknown') {
    addViolation(result, 'FR028', artifact, '/semanticVerdict', 'incomplete or blocked semanticVerdict must be unknown', 'unknown', finalReview.semanticVerdict);
  }
  if (!issueSummariesEqual(finalReview.issueSummary, computed.issueSummary)) {
    addViolation(result, 'FR034', artifact, '/issueSummary', 'finalReview issueSummary must equal validator result', computed.issueSummary, finalReview.issueSummary);
  }
  if (finalReview.recommendation !== computed.recommendation) {
    addViolation(result, 'FR035', artifact, '/recommendation', 'finalReview recommendation must equal validator result', computed.recommendation, finalReview.recommendation);
  }
  validateRunValidationSummary(finalReview, computed, artifact, result);
  validateCannotVerifyItemsAgainstComputed(finalReview, deriveCannotVerifyItems(results, dispatch), artifact, result);
  validateFindingItemsAgainstComputed(finalReview, deriveFindingItems(results, dispatch), artifact, result);
  validateObservationItemsAgainstComputed(finalReview, deriveObservationItems(results, dispatch), artifact, result);
  validateOtherConcernsAgainstComputed(finalReview, otherConcerns, artifact, result);
}

function renderFinalMode(args, result) {
  const finalReview = readJson(args.input, args.input, result, 'FR001');
  if (!finalReview) return;
  validateFinalReviewShape(finalReview, args.input, result);
  if (!args.output || args.output === true) {
    addViolation(result, 'EXEC004', null, '/output', 'render-final requires --output', 'output path', args.output || null, 2);
    return;
  }
  const siblingDispatchPath = path.join(path.dirname(path.resolve(args.input)), 'dispatch.json');
  const dispatchPath = args.dispatch && args.dispatch !== true
    ? args.dispatch
    : fs.existsSync(siblingDispatchPath) ? siblingDispatchPath : null;
  if (!dispatchPath) {
    addViolation(result, 'EXEC006', siblingDispatchPath, '/dispatch', 'render-final requires a same-run dispatch', 'readable dispatch.json with matching runId', null, 2);
    return;
  }
  const dispatch = dispatchPath ? readJson(dispatchPath, dispatchPath, result, 'D001') : null;
  if (dispatch) validateDispatch(dispatch, dispatchPath, result, dispatchPath);
  if (dispatch && dispatch.runId !== finalReview.runId) {
    addViolation(result, 'EXEC005', dispatchPath, '/runId', 'dispatch runId must match finalReview runId before rendering', finalReview.runId, dispatch.runId, 2);
  }
  if (dispatch && result.violations.length === 0) {
    const runDir = path.dirname(path.resolve(args.input));
    if (!validateRunDirectoryFiles(runDir, result)) return;
    const computedResult = createResult('render-final-computation', runDir);
    const runState = validateRunArtifacts(runDir, dispatch, computedResult);
    validateCurrentBatchResults(dispatch, runState.results, runState.resultOwners, computedResult);
    const currentResults = runState.results;
    validateCompleteResults(dispatch, currentResults, computedResult);
    const gate = calculateGate(dispatch, currentResults, computedResult);
    mergeValidationResult(result, computedResult);
    validateFinalReviewAgainstComputed(finalReview, dispatch, currentResults, gate, runState.otherConcerns, args.input, result);
  }
  if (result.violations.length > 0) return;
  const runDir = path.dirname(path.resolve(args.input));
  const markdown = renderFinalMarkdown(finalReview, dispatch, runDir);
  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  fs.writeFileSync(args.output, markdown);
  result.rendered = args.output;
}

function renderResponseMode(args, result) {
  const runDir = args.dir;
  if (!runDir || runDir === true) {
    addViolation(result, 'RR001', null, '/dir', 'render-response mode requires --dir', 'run directory', runDir || null, 2);
    return;
  }

  validateRun(runDir, result);
  if (result.violations.length > 0) return;

  const finalReviewPath = path.join(runDir, 'finalReview.json');
  const dispatchPath = path.join(runDir, 'dispatch.json');
  const finalReview = readJson(finalReviewPath, rel(runDir, finalReviewPath), result, 'FR001');
  if (!finalReview || result.violations.length > 0) return;
  const dispatch = readJson(dispatchPath, rel(runDir, dispatchPath), result, 'D001');
  if (!dispatch || result.violations.length > 0) return;

  const outputPath = !args.output || args.output === true ? path.join(runDir, 'response.md') : args.output;
  const markdown = renderResponseMarkdown(runDir, finalReview, result.gate);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, markdown);
  result.rendered = outputPath;
  result.response = markdown;
}

function renderHandoffMode(args, result) {
  const runDir = args.dir;
  if (!runDir || runDir === true) {
    addViolation(result, 'RH001', null, '/dir', 'render-handoff mode requires --dir', 'run directory', runDir || null, 2);
    return;
  }

  validateRun(runDir, result);
  if (result.violations.length > 0) return;

  const finalReviewPath = path.join(runDir, 'finalReview.json');
  const dispatchPath = path.join(runDir, 'dispatch.json');
  const finalReview = readJson(finalReviewPath, rel(runDir, finalReviewPath), result, 'FR001');
  const dispatch = readJson(dispatchPath, rel(runDir, dispatchPath), result, 'D001');
  if (!finalReview || !dispatch || result.violations.length > 0) return;

  const outputPath = !args.output || args.output === true ? path.join(runDir, 'handoff.md') : args.output;
  const markdown = renderHandoffMarkdown(finalReview, dispatch);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, markdown);
  result.rendered = outputPath;
}

function validateFinalMarkdownMode(args, result) {
  const finalReview = readJson(args['final-review'], args['final-review'], result, 'FR001');
  if (!finalReview) return;
  const siblingDispatchPath = path.join(path.dirname(path.resolve(args['final-review'])), 'dispatch.json');
  const dispatchPath = args.dispatch && args.dispatch !== true
    ? args.dispatch
    : fs.existsSync(siblingDispatchPath) ? siblingDispatchPath : null;
  const dispatch = dispatchPath ? readJson(dispatchPath, dispatchPath, result, 'D001') : null;
  if (dispatch) validateDispatch(dispatch, dispatchPath, result, dispatchPath);
  if (dispatch && dispatch.runId !== finalReview.runId) {
    addViolation(result, 'FM020', dispatchPath, '/runId', 'dispatch runId must match finalReview runId before final Markdown validation', finalReview.runId, dispatch.runId, 2);
  }
  if (result.violations.length > 0) return;
  validateFinalMarkdown(finalReview, args.input, result, dispatch);
}

function validateFinalMarkdown(finalReview, markdownPath, result, dispatch) {
  const markdown = readText(markdownPath, markdownPath, result, 'FM001');
  if (markdown == null || !finalReview) return;
  const issueSummary = issueSummaryFromFinalReview(finalReview);
  const recommendation = finalReview.recommendation || deriveRecommendation(finalReview.protocolGate, issueSummary);
  const required = [
    reviewTitle(finalReview.protocolGate, issueSummary),
    protocolGateLabel(finalReview.protocolGate),
    label(finalReview.coverageClaim),
    reviewConclusion(finalReview.protocolGate, issueSummary),
    label(recommendation),
    `问题数：${issueSummary.findings}`,
    `必须修复：${issueSummary.mustFix}`,
    `建议修复：${issueSummary.shouldFix}`,
    `无法验证：${issueSummary.cannotVerify}`,
    `观察项：${issueSummary.observations}`,
    `runId：${finalReview.runId}`,
    '验证摘要：',
  ];
  if (dispatch) {
    required.push(
      `ruleSetId：${dispatch.ruleSet && dispatch.ruleSet.ruleSetId ? dispatch.ruleSet.ruleSetId : '未知'}`,
      `sourceIndexHash：${dispatch.ruleSet && dispatch.ruleSet.sourceIndexHash ? dispatch.ruleSet.sourceIndexHash : '未知'}`,
      `selectedRuleRefs：${asArray(dispatch.ruleSet && dispatch.ruleSet.selectedRuleRefs).length}`,
      `reviewItems：${asArray(dispatch.reviewItems).length}`,
      `reviewBatches：${asArray(dispatch.reviewBatches).length}`,
      `baseTree：${dispatch.reviewRange && dispatch.reviewRange.baseTree}`,
      `targetTree：${dispatch.reviewRange && dispatch.reviewRange.targetTree}`,
      `规则来源类型：${dispatch.ruleInputSource && dispatch.ruleInputSource.kind}`,
    );
    if (dispatch.ruleInputSource && dispatch.ruleInputSource.kind === 'commit') {
      required.push(`规则来源 commit：${dispatch.ruleInputSource.commit}`);
    }
  }
  if (asArray(finalReview.otherConcerns).length > 0) {
    required.push('其他关注项', ...finalReview.otherConcerns);
  }
  required.forEach((token, index) => {
    if (!markdown.includes(token)) addViolation(result, `FM00${index + 2}`, markdownPath, null, 'final Markdown must include rendered finalReview status labels', token, markdown);
  });
}

function renderFinalMarkdown(finalReview, dispatch, runDir) {
  const findings = asArray(finalReview.findings);
  const observations = asArray(finalReview.observations);
  const issueSummary = issueSummaryFromFinalReview(finalReview);
  const recommendation = finalReview.recommendation || deriveRecommendation(finalReview.protocolGate, issueSummary);
  const repositoryRoot = loadRepository(path.join(runDir, 'dispatch.json')).root;
  const lines = [
    `# ${reviewTitle(finalReview.protocolGate, issueSummary)}`,
    '',
    '## 结论',
    `- 协议门禁：${protocolGateLabel(finalReview.protocolGate)}`,
    `- 审查结论：${reviewConclusion(finalReview.protocolGate, issueSummary)}`,
    `- 修复建议：${label(recommendation)}`,
    `- 问题数：${issueSummary.findings}`,
    `- 必须修复：${issueSummary.mustFix}`,
    `- 建议修复：${issueSummary.shouldFix}`,
    `- 无法验证：${issueSummary.cannotVerify}`,
    `- 观察项：${issueSummary.observations}`,
    '',
    '## 问题',
    findings.length === 0 ? '- 无' : null,
  ].filter((line) => line !== null);
  appendFindingLines(lines, findings, (evidence) => formatEvidenceLocation(evidence, repositoryRoot));
  if (observations.length > 0) {
    lines.push('', '## 观察项');
    observations.forEach((observation) => {
      lines.push(`- ${observation.reviewItemId} | ${observation.ruleRef} | ${observation.ruleLevel} | ${label(observation.origin)} | ${observation.targetId}：${observation.reason || formatEvidence(observation.evidence)}`);
    });
  }
  if (issueSummary.cannotVerify > 0) {
    lines.push('', '## 无法验证', '', '| Review Item | Rule | Target | Reason |', '|---|---|---|---|');
    const items = asArray(finalReview.cannotVerifyItems);
    if (items.length === 0) {
      lines.push('| 未记录 | 未记录 | 未记录 | 请查看 shard results 中 status=cannot_verify 的结果 |');
    } else {
      items.forEach((item) => {
        lines.push(`| ${escapeTableCell(item.reviewItemId)} | ${escapeTableCell(item.ruleRef)} | ${escapeTableCell(item.targetId)} | ${escapeTableCell(item.reason)} |`);
      });
    }
  }
  appendOtherConcerns(lines, finalReview.otherConcerns);
  lines.push(
    '',
    '## 范围',
    `- 范围模式：${label(finalReview.scopeMode)}`,
    `- 覆盖声明：${label(finalReview.coverageClaim)}`,
    `- 排除文件：${formatList(finalReview.excludedFiles)}`,
    `- 排除规则：${formatList(finalReview.excludedRuleRefs)}`,
    '',
    '## 审计',
    ...formatAuditLines(finalReview, dispatch, runDir),
  );
  lines.push('', '## 验证', `- protocolGate：${protocolGateLabel(finalReview.protocolGate)}`);
  asArray(finalReview.validationResults).forEach((validation) => {
    lines.push(`- ${validation.mode || 'validation'}：${validation.ok === false ? '失败' : '成功'}`);
  });
  return `${lines.join('\n')}\n`;
}

function renderResponseMarkdown(runDir, finalReview, gate) {
  const finalMdPath = path.resolve(runDir, 'final.md');
  const finalReviewPath = path.resolve(runDir, 'finalReview.json');
  const dispatchPath = path.resolve(runDir, 'dispatch.json');
  const findings = asArray(finalReview.findings);
  const issueSummary = gate && gate.issueSummary ? gate.issueSummary : issueSummaryFromFinalReview(finalReview);
  const protocolGate = gate && gate.protocolGate ? gate.protocolGate : finalReview.protocolGate;
  const recommendation = gate && gate.recommendation ? gate.recommendation : finalReview.recommendation || deriveRecommendation(protocolGate, issueSummary);

  const lines = [
    `# ${responseTitle(protocolGate, issueSummary)}`,
    '',
    '## 结论',
    `- 协议门禁：${protocolGateLabel(protocolGate)}`,
    `- 审查结论：${reviewConclusion(protocolGate, issueSummary)}`,
    `- 修复建议：${label(recommendation)}`,
    `- 问题数：${issueSummary.findings}`,
    `- 必须修复：${issueSummary.mustFix}`,
    `- 建议修复：${issueSummary.shouldFix}`,
    `- 无法验证：${issueSummary.cannotVerify}`,
    `- 观察项：${issueSummary.observations}`,
  ];
  const cannotVerifyItems = asArray(finalReview.cannotVerifyItems);
  if (findings.length > 0) {
    lines.push('', '## 问题');
    appendResponseFindingLines(lines, findings);
  }
  if (cannotVerifyItems.length > 0) {
    lines.push('', '## 无法验证');
    cannotVerifyItems.forEach((item) => {
      lines.push(`- ${item.ruleRef || '未知'}｜${item.targetId || '未知'}：${item.reason || '未记录原因'}`);
    });
  }
  if (findings.length === 0 && cannotVerifyItems.length === 0) {
    lines.push('', '## 审查结果', '- 未发现需要修复或人工验证的项目。');
  }
  appendOtherConcerns(lines, finalReview.otherConcerns);
  lines.push(
    '',
    '## 报告',
    `- runId：${finalReview.runId}`,
    `- 完整报告：${formatMarkdownFileLink('final.md', finalMdPath)}`,
    `- 事实源：${formatMarkdownFileLink('finalReview.json', finalReviewPath)}`,
    `- 分派源：${formatMarkdownFileLink('dispatch.json', dispatchPath)}`,
    '',
  );
  return lines.join('\n');
}

function renderHandoffMarkdown(finalReview, dispatch) {
  const findings = asArray(finalReview.findings);
  const issueSummary = issueSummaryFromFinalReview(finalReview);
  const recommendation = finalReview.recommendation || deriveRecommendation(finalReview.protocolGate, issueSummary);
  const lines = [
    '# rules-review 修复交接',
    '',
    '## 审查信息',
    `- runId：${finalReview.runId}`,
    `- 目标 commit：${dispatch.reviewRange.boundCommit}`,
    `- 协议门禁：${protocolGateLabel(finalReview.protocolGate)}`,
    `- 审查结论：${reviewConclusion(finalReview.protocolGate, issueSummary)}`,
    `- 修复建议：${label(recommendation)}`,
    '',
    '## 问题',
    findings.length === 0 ? '- 无' : null,
  ].filter((line) => line !== null);
  appendFindingLines(lines, findings, formatPortableEvidenceLocation);
  const cannotVerifyItems = asArray(finalReview.cannotVerifyItems);
  if (cannotVerifyItems.length > 0) {
    lines.push('', '## 无法验证');
    cannotVerifyItems.forEach((item) => {
      lines.push(`- ${item.reviewItemId}｜${item.ruleRef}｜${item.targetId}：${item.reason}`);
    });
  }
  return `${lines.join('\n')}\n`;
}

function appendFindingLines(lines, findings, formatLocation) {
  const groups = [
    ['must_fix', '必须修复'],
    ['should_fix', '建议修复'],
  ];
  groups.forEach(([priority, title]) => {
    const items = findings.filter((finding) => finding && finding.priority === priority);
    if (items.length === 0) return;
    lines.push('', `### ${title}`);
    items.forEach((finding) => {
      lines.push('', `#### ${finding.findingId}：${finding.rootCause}`);
      asArray(finding.evidenceGroups).forEach((evidenceGroup) => {
        lines.push(`- ${evidenceGroup.reviewItemId}｜${evidenceGroup.ruleRef}（${evidenceGroup.ruleLevel}）｜${evidenceGroup.targetId}｜${label(evidenceGroup.origin)}`);
        if (evidenceGroup.priorityReason) lines.push(`  - 优先级原因：${evidenceGroup.priorityReason}`);
        asArray(evidenceGroup.evidence).forEach((evidence) => {
          const location = formatLocation(evidence);
          lines.push(`  - ${evidence.summary || '未记录证据'}${location ? `｜${location}` : ''}`);
        });
      });
    });
  });
}

function appendResponseFindingLines(lines, findings) {
  const groups = [
    ['must_fix', '必须修复'],
    ['should_fix', '建议修复'],
  ];
  groups.forEach(([priority, title]) => {
    const items = findings.filter((finding) => finding && finding.priority === priority);
    if (items.length === 0) return;
    lines.push(`### ${title}`);
    items.forEach((finding) => {
      lines.push(`- ${finding.findingId}：${finding.rootCause}`);
    });
  });
}

function appendOtherConcerns(lines, otherConcerns) {
  const items = asArray(otherConcerns);
  if (items.length === 0) return;
  lines.push('', '## 其他关注项');
  items.forEach((item) => lines.push(`- ${item}`));
}

function expectKind(doc, artifact, result, code, expected) {
  if (!isObject(doc) || doc.kind !== expected) {
    addViolation(result, code, artifact, '/kind', 'kind must match artifact type', expected, doc && doc.kind);
  }
}

function validateSchemaVersion(doc, artifact, result, code) {
  if (!isObject(doc) || doc.schemaVersion !== SCHEMA_VERSION) {
    addViolation(result, code, artifact, '/schemaVersion', 'schemaVersion must match rules-review protocol', SCHEMA_VERSION, doc && doc.schemaVersion);
  }
}

function requireFields(obj, artifact, result, code, pointer, fields) {
  if (!isObject(obj)) {
    addViolation(result, code, artifact, pointer || null, 'value must be object', 'object', obj);
    return;
  }
  fields.forEach((field) => {
    if (!(field in obj)) addViolation(result, code, artifact, pointer ? `${pointer}/${field}` : `/${field}`, 'required field is missing', field, null);
  });
}

function rejectUnsupportedFields(obj, artifact, result, code, pointer, fields, labelText) {
  if (!isObject(obj)) return;
  const allowedFields = new Set(fields);
  Object.keys(obj).forEach((field) => {
    if (!allowedFields.has(field)) {
      addViolation(result, code, artifact, pointer ? `${pointer}/${field}` : `/${field}`, `${labelText} contains unsupported field`, fields, field);
    }
  });
}

function validateStringSet(value, artifact, result, code, pointer) {
  if (!Array.isArray(value)) {
    addViolation(result, code, artifact, pointer, 'value must be array', 'array', value);
    return new Set();
  }
  value.forEach((item, index) => {
    if (!isNonEmptyString(item)) addViolation(result, code, artifact, `${pointer}/${index}`, 'array item must be non-empty string', 'string', item);
  });
  if (new Set(value).size !== value.length) addViolation(result, code, artifact, pointer, 'array values must be unique', 'unique items', value);
  return new Set(value.filter(isNonEmptyString));
}

function validateIssueSummary(value, artifact, result, code, pointer) {
  if (!isObject(value)) {
    addViolation(result, code, artifact, pointer, 'issueSummary must be object', 'object', value);
    return;
  }
  rejectUnsupportedFields(value, artifact, result, code, pointer, ISSUE_SUMMARY_FIELDS, 'issueSummary');
  ISSUE_SUMMARY_FIELDS.forEach((field) => {
    if (!Number.isInteger(value[field]) || value[field] < 0) {
      addViolation(result, code, artifact, `${pointer}/${field}`, 'issueSummary count must be non-negative integer', 'non-negative integer', value[field]);
    }
  });
}

function validateValidationResults(finalReview, artifact, result) {
  if (!Array.isArray(finalReview.validationResults)) {
    addViolation(result, 'FR011', artifact, '/validationResults', 'validationResults must be array', 'array', finalReview.validationResults);
    return;
  }
  if (finalReview.validationResults.length === 0) {
    addViolation(result, 'FR014', artifact, '/validationResults', 'validationResults must include validator run summary', 'non-empty validationResults[]', finalReview.validationResults);
    return;
  }
  asArray(finalReview.validationResults).forEach((validation, index) => {
    const pointer = `/validationResults/${index}`;
    requireFields(validation, artifact, result, 'FR041', pointer, ['mode', 'ok', 'protocolGate', 'semanticVerdict', 'issueSummary', 'recommendation']);
    rejectUnsupportedFields(validation, artifact, result, 'FR096', pointer, ['mode', 'ok', 'protocolGate', 'semanticVerdict', 'issueSummary', 'recommendation'], 'validationResult');
    if (!isNonEmptyString(validation && validation.mode)) addViolation(result, 'FR042', artifact, `${pointer}/mode`, 'validation mode must be non-empty string', 'string', validation && validation.mode);
    if (typeof (validation && validation.ok) !== 'boolean') addViolation(result, 'FR043', artifact, `${pointer}/ok`, 'validation ok must be boolean', 'boolean', validation && validation.ok);
    if (!PROTOCOL_GATES.includes(validation && validation.protocolGate)) addViolation(result, 'FR044', artifact, `${pointer}/protocolGate`, 'validation protocolGate must be valid', PROTOCOL_GATES, validation && validation.protocolGate);
    if (!SEMANTIC_VERDICTS.includes(validation && validation.semanticVerdict)) addViolation(result, 'FR045', artifact, `${pointer}/semanticVerdict`, 'validation semanticVerdict must be valid', SEMANTIC_VERDICTS, validation && validation.semanticVerdict);
    validateIssueSummary(validation && validation.issueSummary, artifact, result, 'FR046', `${pointer}/issueSummary`);
    if (!RECOMMENDATIONS.includes(validation && validation.recommendation)) addViolation(result, 'FR047', artifact, `${pointer}/recommendation`, 'validation recommendation must be valid', RECOMMENDATIONS, validation && validation.recommendation);
  });
}

function validateRunValidationSummary(finalReview, computed, artifact, result) {
  const runSummary = asArray(finalReview.validationResults).find((validation) => validation && validation.mode === 'run');
  if (!runSummary) {
    addViolation(result, 'FR048', artifact, '/validationResults', 'validationResults must include mode=run summary', 'mode=run', finalReview.validationResults);
    return;
  }
  const expected = {
    ok: computed.protocolGate === 'passed',
    protocolGate: computed.protocolGate,
    semanticVerdict: computed.semanticVerdict,
    issueSummary: computed.issueSummary,
    recommendation: computed.recommendation,
  };
  if (runSummary.ok !== expected.ok) addViolation(result, 'FR049', artifact, '/validationResults', 'run validation ok must equal validator result', expected.ok, runSummary.ok);
  if (runSummary.protocolGate !== expected.protocolGate) addViolation(result, 'FR050', artifact, '/validationResults', 'run validation protocolGate must equal validator result', expected.protocolGate, runSummary.protocolGate);
  if (runSummary.semanticVerdict !== expected.semanticVerdict) addViolation(result, 'FR051', artifact, '/validationResults', 'run validation semanticVerdict must equal validator result', expected.semanticVerdict, runSummary.semanticVerdict);
  if (!issueSummariesEqual(runSummary.issueSummary, expected.issueSummary)) addViolation(result, 'FR052', artifact, '/validationResults', 'run validation issueSummary must equal validator result', expected.issueSummary, runSummary.issueSummary);
  if (runSummary.recommendation !== expected.recommendation) addViolation(result, 'FR053', artifact, '/validationResults', 'run validation recommendation must equal validator result', expected.recommendation, runSummary.recommendation);
}

function issueSummariesEqual(left, right) {
  return isObject(left)
    && isObject(right)
    && ISSUE_SUMMARY_FIELDS.every((field) => left[field] === right[field]);
}

function validateCannotVerifyItems(value, artifact, result) {
  if (!Array.isArray(value)) {
    addViolation(result, 'FR036', artifact, '/cannotVerifyItems', 'cannotVerifyItems must be array', 'array', value);
    return;
  }
  value.forEach((item, index) => {
    const pointer = `/cannotVerifyItems/${index}`;
    requireFields(item, artifact, result, 'FR037', pointer, ['reviewItemId', 'ruleRef', 'targetId', 'reason']);
    rejectUnsupportedFields(item, artifact, result, 'FR094', pointer, ['reviewItemId', 'ruleRef', 'targetId', 'reason'], 'finalReview cannotVerify item');
    if (!REVIEW_ITEM_RE.test(item && item.reviewItemId)) addViolation(result, 'FR057', artifact, `/cannotVerifyItems/${index}/reviewItemId`, 'cannotVerify item reviewItemId must match RIxxx', 'RIxxx', item && item.reviewItemId);
    if (!isNonEmptyString(item && item.ruleRef)) addViolation(result, 'FR038', artifact, `/cannotVerifyItems/${index}/ruleRef`, 'cannotVerify item ruleRef must be non-empty string', 'string', item && item.ruleRef);
    if (!TARGET_RE.test((item && item.targetId) || '')) addViolation(result, 'FR039', artifact, `/cannotVerifyItems/${index}/targetId`, 'cannotVerify item targetId must match T followed by at least three digits', 'Txxx...', item && item.targetId);
    if (!isNonEmptyString(item && item.reason)) addViolation(result, 'FR040', artifact, `/cannotVerifyItems/${index}/reason`, 'cannotVerify item reason must be non-empty string', 'string', item && item.reason);
  });
}

function validateCannotVerifyItemsAgainstComputed(finalReview, expectedItems, artifact, result) {
  const actualItems = asArray(finalReview.cannotVerifyItems);
  if (expectedItems.length === 0) {
    if (actualItems.length > 0) addViolation(result, 'FR054', artifact, '/cannotVerifyItems', 'cannotVerifyItems must be empty when no cannot_verify results exist', [], actualItems);
    return;
  }
  if (actualItems.length === 0) {
    addViolation(result, 'FR055', artifact, '/cannotVerifyItems', 'cannotVerifyItems must include every cannot_verify result', expectedItems, actualItems);
    return;
  }
  if (!cannotVerifyItemsEqual(actualItems, expectedItems)) {
    addViolation(result, 'FR056', artifact, '/cannotVerifyItems', 'cannotVerifyItems must equal validator result', expectedItems, actualItems);
  }
}

function validateFindingItemsAgainstComputed(finalReview, expectedItems, artifact, result) {
  const actualItems = asArray(finalReview.findings);
  if (actualItems.length !== expectedItems.length) {
    addViolation(result, 'FR029', artifact, '/findings', 'finalReview findings must include every derived finding and no extras', expectedItems, actualItems);
    return;
  }
  if (!findingItemsEqual(actualItems, expectedItems)) {
    addViolation(result, 'FR032', artifact, '/findings', 'finalReview findings must equal validator result', expectedItems, actualItems);
  }
}

function validateObservationItemsAgainstComputed(finalReview, expectedItems, artifact, result) {
  const actualItems = asArray(finalReview.observations);
  if (actualItems.length !== expectedItems.length) {
    addViolation(result, 'FR071', artifact, '/observations', 'finalReview observations must include every derived observation and no extras', expectedItems, actualItems);
    return;
  }
  if (!observationItemsEqual(actualItems, expectedItems)) {
    addViolation(result, 'FR072', artifact, '/observations', 'finalReview observations must equal validator result', expectedItems, actualItems);
  }
}

function validateOtherConcernsAgainstComputed(finalReview, expectedItems, artifact, result) {
  const actualItems = asArray(finalReview.otherConcerns);
  if (JSON.stringify(actualItems) !== JSON.stringify(asArray(expectedItems))) {
    addViolation(result, 'FR084', artifact, '/otherConcerns', 'finalReview otherConcerns must equal current shard otherConcerns', expectedItems, actualItems);
  }
}

function findingItemsEqual(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((item, index) => findingItemEqual(item, right[index]));
}

function observationItemsEqual(left, right) {
  return unorderedItemsEqual(left, right, observationItemEqual);
}

function unorderedItemsEqual(left, right, equal) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  const used = new Set();
  return left.every((leftItem) => {
    const index = right.findIndex((rightItem, candidateIndex) => !used.has(candidateIndex) && equal(leftItem, rightItem));
    if (index === -1) return false;
    used.add(index);
    return true;
  });
}

function findingItemEqual(left, right) {
  const fields = ['findingId', 'rootCause', 'priority'];
  return fields.every((field) => optionalField(left, field) === optionalField(right, field))
    && Array.isArray(left && left.evidenceGroups)
    && Array.isArray(right && right.evidenceGroups)
    && left.evidenceGroups.length === right.evidenceGroups.length
    && left.evidenceGroups.every((evidenceGroup, index) => findingEvidenceGroupEqual(evidenceGroup, right.evidenceGroups[index]));
}

function findingEvidenceGroupEqual(left, right) {
  const fields = ['reviewItemId', 'ruleRef', 'targetId', 'ruleLevel', 'origin', 'priority', 'priorityReason', 'upgradeReason', 'originReason'];
  return fields.every((field) => optionalField(left, field) === optionalField(right, field))
    && evidenceArraysEqual(left && left.evidence, right && right.evidence);
}

function observationItemEqual(left, right) {
  const fields = ['reviewItemId', 'ruleRef', 'targetId', 'ruleLevel', 'origin', 'reason', 'upgradeReason', 'originReason'];
  return fields.every((field) => optionalField(left, field) === optionalField(right, field))
    && optionalEvidenceArraysEqual(left && left.evidence, right && right.evidence);
}

function optionalField(value, field) {
  return value && value[field] !== undefined ? value[field] : null;
}

function optionalEvidenceArraysEqual(left, right) {
  if (left === undefined && right === undefined) return true;
  return evidenceArraysEqual(left, right);
}

function cannotVerifyItemsEqual(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  return left.every((item, index) => ['reviewItemId', 'ruleRef', 'targetId', 'reason'].every((field) => item && right[index] && item[field] === right[index][field]));
}

function requireSubset(left, right, artifact, result, code, pointer, message) {
  const missing = Array.from(left).filter((item) => !right.has(item));
  if (missing.length > 0) addViolation(result, code, artifact, pointer, message, Array.from(right), missing);
}

function requireDisjoint(left, right, artifact, result, code, pointer, message) {
  const overlap = Array.from(left).filter((item) => right.has(item));
  if (overlap.length > 0) addViolation(result, code, artifact, pointer, message, 'disjoint sets', overlap);
}

function hasRuleBody(rule) {
  return isNonEmptyString(rule && rule.summary) || isNonEmptyString(rule && rule.ruleText);
}

function validateFailureConditions(value, artifact, result, code, pointer) {
  if (!Array.isArray(value)) {
    addViolation(result, code, artifact, pointer, 'failureConditions must be array', 'array', value);
    return;
  }
  const ids = new Set();
  value.forEach((condition, index) => {
    const conditionPointer = `${pointer}/${index}`;
    requireFields(condition, artifact, result, code, conditionPointer, ['conditionId', 'summary']);
    if (!isNonEmptyString(condition && condition.conditionId)) {
      addViolation(result, code, artifact, `${conditionPointer}/conditionId`, 'failureCondition conditionId must be non-empty string', 'string', condition && condition.conditionId);
    } else if (ids.has(condition.conditionId)) {
      addViolation(result, code, artifact, conditionPointer, 'failureConditions conditionId must be unique', 'unique conditionId', condition.conditionId);
    } else {
      ids.add(condition.conditionId);
    }
    if (!isNonEmptyString(condition && condition.summary)) {
      addViolation(result, code, artifact, `${conditionPointer}/summary`, 'failureCondition summary must be non-empty string', 'string', condition && condition.summary);
    }
  });
}

function validateRequiredContextList(value, artifact, result, code, pointer) {
  if (!Array.isArray(value)) {
    addViolation(result, code, artifact, pointer, 'requiredContext must be array', 'array', value);
    return;
  }
  const ids = new Set();
  value.forEach((entry, index) => {
    const entryPointer = `${pointer}/${index}`;
    requireFields(entry, artifact, result, code, entryPointer, ['contextId', 'summary']);
    if (!isNonEmptyString(entry && entry.contextId)) {
      addViolation(result, code, artifact, `${entryPointer}/contextId`, 'requiredContext contextId must be non-empty string', 'string', entry && entry.contextId);
    } else if (ids.has(entry.contextId)) {
      addViolation(result, code, artifact, entryPointer, 'requiredContext contextId must be unique', 'unique contextId', entry.contextId);
    } else {
      ids.add(entry.contextId);
    }
    if (!isNonEmptyString(entry && entry.summary)) {
      addViolation(result, code, artifact, `${entryPointer}/summary`, 'requiredContext summary must be non-empty string', 'string', entry && entry.summary);
    }
  });
}

function rulesHaveSameBody(left, right) {
  return (left.summary || null) === (right.summary || null) && (left.ruleText || null) === (right.ruleText || null);
}

function optionalJsonEqual(left, right) {
  if (left === undefined && right === undefined) return true;
  return JSON.stringify(left) === JSON.stringify(right);
}

function validateEvidenceArray(evidence, artifact, result, code, pointer, message) {
  if (!hasValidEvidenceArray(evidence)) {
    addViolation(result, code, artifact, pointer, message, 'non-empty evidence[] with summary and loc/source', evidence);
  }
}

function validateShardEvidenceArray(evidence, artifact, result, code, pointer, message) {
  validateEvidenceArray(evidence, artifact, result, code, pointer, message);
  asArray(evidence).forEach((item, index) => {
    rejectUnsupportedFields(item, artifact, result, 'S040', `${pointer}/${index}`, ['summary', 'loc', 'source'], 'shard evidence');
  });
}

function validateFinalReviewEvidenceArray(evidence, artifact, result, code, pointer, message) {
  validateEvidenceArray(evidence, artifact, result, code, pointer, message);
  asArray(evidence).forEach((item, index) => {
    rejectUnsupportedFields(item, artifact, result, 'FR095', `${pointer}/${index}`, ['summary', 'loc', 'source'], 'finalReview evidence');
  });
}

function hasValidEvidenceArray(evidence) {
  return Array.isArray(evidence)
    && evidence.length > 0
    && evidence.every((item) => isObject(item) && isNonEmptyString(item.summary) && (isNonEmptyString(item.loc) || isNonEmptyString(item.source)));
}

function evidenceArraysEqual(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((item, index) => evidenceItemsEqual(item, right[index]));
}

function evidenceItemsEqual(left, right) {
  return ['summary', 'loc', 'source'].every((field) => (left && left[field] ? left[field] : null) === (right && right[field] ? right[field] : null));
}

function buildDispatchTargetMap(dispatch) {
  const targetMap = new Map();
  asArray(dispatch && dispatch.targets && dispatch.targets.changedUnits).forEach((target) => {
    if (target && target.targetId) targetMap.set(target.targetId, target);
  });
  asArray(dispatch && dispatch.targets && dispatch.targets.candidates).forEach((target) => {
    if (target && target.targetId) targetMap.set(target.targetId, target);
  });
  return targetMap;
}

function validateTargetSnapshot(actual, expected, artifact, result, code, pointer) {
  ['targetKind', 'loc', 'source', 'summary'].forEach((field) => {
    if (expected[field] !== undefined && actual[field] !== expected[field]) {
      addViolation(result, code, artifact, `${pointer}/${field}`, 'task target snapshot must match dispatch target', expected[field], actual[field]);
    }
  });
  if (expected.inputRefs !== undefined && !optionalJsonEqual(actual.inputRefs, expected.inputRefs)) {
    addViolation(result, code, artifact, `${pointer}/inputRefs`, 'task target inputRefs must match dispatch target', expected.inputRefs, actual.inputRefs);
  }
}

function validateReviewTargetContext(target, artifact, result, code, pointer) {
  if (!isNonEmptyString(target && target.summary) || (!isNonEmptyString(target && target.loc) && !isNonEmptyString(target && target.source))) {
    addViolation(result, code, artifact, pointer, 'reviewItem target must include summary and loc or source', 'non-empty summary plus loc or source', target);
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isSafeToken(value) {
  return typeof value === 'string' && SAFE_TOKEN_RE.test(value);
}

function isRunId(value) {
  return typeof value === 'string' && RUN_ID_RE.test(value);
}

function isNonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0;
}

function setsEqual(left, right) {
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
}

function rel(base, filePath) {
  return path.relative(base, filePath).replace(/\\/g, '/');
}

function formatMarkdownFileLink(labelText, filePath) {
  const absPath = path.resolve(filePath);
  const target = /\s/.test(absPath) ? `<${absPath}>` : absPath;
  return `[${labelText}](${target})`;
}

function formatCommandPath(filePath) {
  if (!filePath) return filePath;
  if (!/[\s'"\\]/.test(filePath)) return filePath;
  return `'${filePath.replace(/'/g, "'\\''")}'`;
}

function label(value) {
  return LABELS[value] || String(value || '未知');
}

function protocolGateLabel(value) {
  return PROTOCOL_GATE_LABELS[value] || label(value);
}

function formatAuditLines(finalReview, dispatch, runDir) {
  const ruleSet = dispatch && dispatch.ruleSet ? dispatch.ruleSet : {};
  const ruleInputSource = dispatch && dispatch.ruleInputSource ? dispatch.ruleInputSource : {};
  const targets = dispatch && dispatch.targets ? dispatch.targets : {};
  const validation = getRunValidationSummary(finalReview);
  const lines = [
    `- runId：${finalReview.runId || '未知'}`,
    `- ruleSetId：${ruleSet.ruleSetId || '未知'}`,
    `- sourceIndexHash：${ruleSet.sourceIndexHash || '未知'}`,
    `- 规则来源类型：${ruleInputSource.kind || '未知'}`,
    `- candidateRuleRefs：${asArray(ruleSet.candidateRuleRefs).length}`,
    `- selectedRuleRefs：${asArray(ruleSet.selectedRuleRefs).length}`,
    `- excludedRuleRefs：${asArray(ruleSet.excludedRuleRefs).length}`,
    `- globallyNotApplicableRuleRefs：${asArray(ruleSet.globallyNotApplicableRuleRefs).length}`,
    `- changedUnits：${asArray(targets.changedUnits).length}`,
    `- candidates：${asArray(targets.candidates).length}`,
    `- contextExpansions：${asArray(targets.contextExpansions).length}`,
    `- applicabilityMatrix：${asArray(dispatch && dispatch.applicabilityMatrix).length}`,
    `- reviewItems：${asArray(dispatch && dispatch.reviewItems).length}`,
    `- reviewBatches：${asArray(dispatch && dispatch.reviewBatches).length}`,
    `- baseCommit：${dispatch && dispatch.reviewRange && dispatch.reviewRange.baseCommit || '未知'}`,
    `- baseTree：${dispatch && dispatch.reviewRange && dispatch.reviewRange.baseTree || '未知'}`,
    `- targetTree：${dispatch && dispatch.reviewRange && dispatch.reviewRange.targetTree || '未知'}`,
    `- boundCommit：${dispatch && dispatch.reviewRange && dispatch.reviewRange.boundCommit || '无'}`,
    `- excludedFiles：${asArray(dispatch && dispatch.reviewRange && dispatch.reviewRange.excludedFiles).length}`,
  ];
  if (ruleInputSource.kind === 'commit') lines.push(`- 规则来源 commit：${ruleInputSource.commit || '未知'}`);
  lines.push(
    `- 验证命令：\`${formatRunCommand(runDir)}\``,
    `- 验证摘要：protocolGate=${validation.protocolGate || '未知'}，semanticVerdict=${validation.semanticVerdict || '未知'}，findings=${formatMetric(validation.issueSummary && validation.issueSummary.findings)}，mustFix=${formatMetric(validation.issueSummary && validation.issueSummary.mustFix)}，shouldFix=${formatMetric(validation.issueSummary && validation.issueSummary.shouldFix)}，cannotVerify=${formatMetric(validation.issueSummary && validation.issueSummary.cannotVerify)}，observations=${formatMetric(validation.issueSummary && validation.issueSummary.observations)}，recommendation=${validation.recommendation || '未知'}`,
  );
  return lines;
}

function getRunValidationSummary(finalReview) {
  return asArray(finalReview && finalReview.validationResults).find((validation) => validation && validation.mode === 'run') || {};
}

function formatRunCommand(runDir) {
  return [
    'node',
    formatCommandPath(path.relative(process.cwd(), __filename) || __filename),
    '--mode',
    'run',
    '--dir',
    formatCommandPath(path.relative(process.cwd(), path.resolve(runDir || '.')) || runDir || '.'),
  ].join(' ');
}

function reviewTitle(protocolGate, issueSummary) {
  if (protocolGate === 'incomplete') return 'rules-review：审查未完成，协议未闭合';
  if (protocolGate === 'blocked') return 'rules-review：审查阻塞，协议输入或结果不可用';
  if (issueSummary.findings > 0 && issueSummary.cannotVerify > 0) {
    return `rules-review：协议通过，发现 ${issueSummary.findings} 项问题，${issueSummary.cannotVerify} 项无法验证`;
  }
  if (issueSummary.findings > 0) return `rules-review：协议通过，发现 ${issueSummary.findings} 项问题`;
  if (issueSummary.cannotVerify > 0) return `rules-review：协议通过，未发现明确问题，但 ${issueSummary.cannotVerify} 项无法验证`;
  return 'rules-review：协议通过，未发现问题';
}

function responseTitle(protocolGate, issueSummary) {
  if (protocolGate === 'incomplete') return 'rules-review：审查未完成';
  if (protocolGate === 'blocked') return 'rules-review：审查阻塞';
  if (issueSummary.findings > 0 && issueSummary.cannotVerify > 0) {
    return `rules-review：发现 ${issueSummary.findings} 项问题，${issueSummary.cannotVerify} 项无法验证`;
  }
  if (issueSummary.findings > 0) return `rules-review：发现 ${issueSummary.findings} 项问题`;
  if (issueSummary.cannotVerify > 0) return `rules-review：未发现明确问题，但 ${issueSummary.cannotVerify} 项无法验证`;
  return 'rules-review：未发现问题';
}

function reviewConclusion(protocolGate, issueSummary) {
  if (protocolGate === 'incomplete') return '审查未完成';
  if (protocolGate === 'blocked') return '审查阻塞';
  if (issueSummary.findings > 0) return '发现问题';
  if (issueSummary.cannotVerify > 0) return '未发现明确问题';
  return '未发现问题';
}

function formatMetric(value) {
  return Number.isInteger(value) ? String(value) : '未知';
}

function formatList(value) {
  const items = asArray(value);
  return items.length === 0 ? '无' : items.join(', ');
}

function formatEvidence(evidence) {
  return asArray(evidence).map((item) => {
    if (typeof item === 'string') return item;
    if (item && typeof item.summary === 'string') return item.summary;
    return JSON.stringify(item);
  }).join('；');
}

function formatEvidenceLocation(evidence, repositoryRoot) {
  const location = evidence && (evidence.loc || evidence.source);
  if (!isNonEmptyString(location) || !isNonEmptyString(evidence && evidence.loc)) return location || '未知位置';
  const match = location.match(/^(.+?):(\d+)(?:-\d+)?$/);
  const repoPath = match ? match[1] : location;
  try {
    assertSafeRepoRelativePath(repoPath);
  } catch {
    return location;
  }
  const filePath = path.join(repositoryRoot, repoPath);
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return location;
  return formatMarkdownFileLink(location, match ? `${filePath}:${match[2]}` : filePath);
}

function formatPortableEvidenceLocation(evidence) {
  if (!isNonEmptyString(evidence && evidence.loc)) return null;
  const match = evidence.loc.match(/^(.+?):(\d+)(?:-\d+)?$/);
  const repoPath = match ? match[1] : evidence.loc;
  try {
    assertSafeRepoRelativePath(repoPath);
  } catch {
    return null;
  }
  return `\`${evidence.loc}\``;
}

function escapeTableCell(value) {
  return String(value || '').replace(/\|/g, '\\|').replace(/\n/g, '<br>');
}

main();
