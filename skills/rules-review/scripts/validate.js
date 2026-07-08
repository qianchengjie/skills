#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const MODES = new Set([
  'dispatch',
  'task',
  'retry-task',
  'shard',
  'final-review',
  'build-tasks',
  'aggregate-final',
  'render-final',
  'render-response',
  'final-md',
  'run',
]);

const SCHEMA_VERSION = 2;
const RETURN_STATUSES = ['not_started', 'started', 'returned', 'not_returned', 'format_invalid', 'untrusted'];
const AGGREGATE_STATUSES = ['aggregated', 'not_aggregated'];
const RESULT_STATUSES = ['passed', 'finding', 'observation', 'not_applicable', 'cannot_verify'];
const PROTOCOL_GATES = ['passed', 'incomplete', 'blocked'];
const SCOPE_MODES = ['full', 'scoped'];
const COVERAGE_CLAIMS = ['full_complete', 'scoped_complete', 'incomplete', 'blocked'];
const SEMANTIC_VERDICTS = ['clean', 'issues', 'unknown'];
const RECOMMENDATIONS = ['ready_for_merge', 'must_fix_before_merge', 'should_review_before_merge', 'manual_verification_required', 'review_incomplete', 'review_blocked'];
const RULE_LEVELS = ['MUST', 'SHOULD', 'ADVISORY'];
const FINDING_ORIGINS = ['introduced_by_change', 'worsened_by_change', 'exposed_by_change', 'pre_existing'];
const FINDING_PRIORITIES = ['must_fix', 'should_fix'];
const ACCEPTED_RISK_STATUSES = ['accepted'];
const ACCEPTED_RISK_ACCEPTED_BY = ['human', 'user', 'project_owner'];
const ISSUE_SUMMARY_FIELDS = ['findings', 'mustFix', 'shouldFix', 'cannotVerify', 'observations'];
const EXECUTION_POLICY_VERSION = 'review-execution-policy/v1';
const EXECUTION_MODES = ['single_batch', 'multi_batch'];
const EXECUTION_SELECTED_BY = ['ai', 'human_override'];
const APPLICABILITY_STATUSES = ['applicable', 'not_applicable'];
const FAILURE_CHECK_OUTCOMES = ['checked_no_violation', 'not_triggered'];
const REVIEW_ITEM_RE = /^RI\d{3}$/;
const FINDING_RE = /^F\d{3}$/;

const LABELS = {
  passed: '协议通过',
  incomplete: '未完成',
  blocked: '阻塞',
  full: '完整范围',
  scoped: '限定范围',
  full_complete: '协议覆盖完整',
  scoped_complete: '限定协议覆盖完整',
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
    ok: result.ok,
    mode: result.mode,
    artifact: result.artifact,
    violations: result.violations,
    skipped: result.skipped,
  };
  if (result.gate) data.gate = result.gate;
  if (result.rendered) data.rendered = result.rendered;
  if (result.response) data.response = result.response;
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
    if (mode === 'dispatch') {
      const dispatch = readJson(args.input, args.input, result, 'D001');
      if (dispatch) validateDispatch(dispatch, args.input, result);
    } else if (mode === 'task') {
      const task = readJson(args.input, args.input, result, 'T001');
      if (task) validateTask(task, args.input, result);
    } else if (mode === 'retry-task') {
      const retryTask = readJson(args.input, args.input, result, 'RT001');
      if (retryTask) validateRetryTask(retryTask, args.input, result);
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
    'retry-task.schema.json',
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

function validateDispatch(dispatch, artifact, result) {
  expectKind(dispatch, artifact, result, 'D002', 'rules-review-dispatch');
  validateSchemaVersion(dispatch, artifact, result, 'D003');
  requireFields(dispatch, artifact, result, 'D004', '', ['kind', 'schemaVersion', 'runId', 'ruleSet', 'targets', 'applicabilityMatrix', 'reviewItems', 'executionPlan', 'reviewBatches']);
  if (!isNonEmptyString(dispatch.runId)) addViolation(result, 'D005', artifact, '/runId', 'runId must be non-empty string', 'string', dispatch.runId);
  validateNoPriorReviewInputs(dispatch, artifact, result);

  const ruleSet = validateRuleSet(dispatch.ruleSet, artifact, result);
  const targets = validateTargets(dispatch.targets, artifact, result);
  const reviewItems = validateReviewItems(dispatch.reviewItems, ruleSet, targets, artifact, result);
  validateApplicabilityMatrix(dispatch.applicabilityMatrix, ruleSet, targets, reviewItems, artifact, result);
  validateRequiredContextCoverage(ruleSet, dispatch.targets, artifact, result);
  validateReviewBatches(dispatch.reviewBatches, ruleSet, reviewItems, artifact, result);
  validateExecutionPlan(dispatch.executionPlan, dispatch, ruleSet, reviewItems, artifact, result);
}

function validateRuleSet(ruleSet, artifact, result) {
  const empty = {
    ruleSetId: null,
    candidateRuleRefs: new Set(),
    requiredRuleRefs: new Set(),
    excludedRuleRefs: new Set(),
    globallyNotApplicableRuleRefs: new Set(),
    ruleSourcesByRuleRef: new Map(),
  };
  if (!isObject(ruleSet)) {
    addViolation(result, 'D010', artifact, '/ruleSet', 'ruleSet must be object', 'object', ruleSet);
    return empty;
  }

  requireFields(ruleSet, artifact, result, 'D011', '/ruleSet', [
    'ruleSetId',
    'sourceIndexHash',
    'candidateRuleRefs',
    'requiredRuleRefs',
    'excludedRuleRefs',
    'globallyNotApplicableRuleRefs',
    'ruleSources',
  ]);
  if (!isNonEmptyString(ruleSet.ruleSetId)) addViolation(result, 'D012', artifact, '/ruleSet/ruleSetId', 'ruleSetId must be non-empty string', 'string', ruleSet.ruleSetId);
  if (!isNonEmptyString(ruleSet.sourceIndexHash)) addViolation(result, 'D013', artifact, '/ruleSet/sourceIndexHash', 'sourceIndexHash is required', 'non-empty hash', ruleSet.sourceIndexHash);

  const candidateRuleRefs = validateStringSet(ruleSet.candidateRuleRefs, artifact, result, 'D014', '/ruleSet/candidateRuleRefs');
  const requiredRuleRefs = validateStringSet(ruleSet.requiredRuleRefs, artifact, result, 'D015', '/ruleSet/requiredRuleRefs');
  const excludedRuleRefs = validateStringSet(ruleSet.excludedRuleRefs, artifact, result, 'D016', '/ruleSet/excludedRuleRefs');
  const globallyNotApplicableRuleRefs = validateStringSet(ruleSet.globallyNotApplicableRuleRefs, artifact, result, 'D017', '/ruleSet/globallyNotApplicableRuleRefs');

  requireSubset(requiredRuleRefs, candidateRuleRefs, artifact, result, 'D018', '/ruleSet/requiredRuleRefs', 'requiredRuleRefs must be subset of candidateRuleRefs');
  requireSubset(excludedRuleRefs, candidateRuleRefs, artifact, result, 'D019', '/ruleSet/excludedRuleRefs', 'excludedRuleRefs must be subset of candidateRuleRefs');
  requireSubset(globallyNotApplicableRuleRefs, candidateRuleRefs, artifact, result, 'D020', '/ruleSet/globallyNotApplicableRuleRefs', 'globallyNotApplicableRuleRefs must be subset of candidateRuleRefs');
  requireDisjoint(requiredRuleRefs, excludedRuleRefs, artifact, result, 'D021', '/ruleSet', 'requiredRuleRefs and excludedRuleRefs must not overlap');
  requireDisjoint(requiredRuleRefs, globallyNotApplicableRuleRefs, artifact, result, 'D022', '/ruleSet', 'requiredRuleRefs and globallyNotApplicableRuleRefs must not overlap');
  requireDisjoint(excludedRuleRefs, globallyNotApplicableRuleRefs, artifact, result, 'D023', '/ruleSet', 'excludedRuleRefs and globallyNotApplicableRuleRefs must not overlap');

  const classifiedRuleRefs = new Set([...requiredRuleRefs, ...excludedRuleRefs, ...globallyNotApplicableRuleRefs]);
  candidateRuleRefs.forEach((ruleRef) => {
    if (!classifiedRuleRefs.has(ruleRef)) {
      addViolation(result, 'D033', artifact, '/ruleSet/candidateRuleRefs', 'candidateRuleRef must be classified as required, excluded, or globallyNotApplicable', 'requiredRuleRefs | excludedRuleRefs | globallyNotApplicableRuleRefs', ruleRef);
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
    requiredRuleRefs,
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
    requireFields(expansion, artifact, result, 'D050', pointer, ['addedTargetIds']);
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
  if (!isNonEmptyString(target && target.targetId)) addViolation(result, 'D046', artifact, `${pointer}/targetId`, 'targetId must be non-empty string', 'string', target && target.targetId);
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
  if (!Array.isArray(reviewItems)) {
    addViolation(result, 'D060', artifact, '/reviewItems', 'reviewItems must be array', 'array', reviewItems);
    return itemMap;
  }
  reviewItems.forEach((item, index) => {
    const pointer = `/reviewItems/${index}`;
    requireFields(item, artifact, result, 'D061', pointer, ['reviewItemId', 'ruleRef', 'targetKind', 'targetId', 'required']);
    if (!REVIEW_ITEM_RE.test(item && item.reviewItemId)) addViolation(result, 'D062', artifact, `${pointer}/reviewItemId`, 'reviewItemId must match RIxxx', 'RIxxx', item && item.reviewItemId);
    if (itemMap.has(item && item.reviewItemId)) addViolation(result, 'D063', artifact, `${pointer}/reviewItemId`, 'reviewItemId must be unique', 'unique RIxxx', item && item.reviewItemId);
    if (!ruleSet.candidateRuleRefs.has(item && item.ruleRef)) addViolation(result, 'D064', artifact, `${pointer}/ruleRef`, 'reviewItem.ruleRef must exist in candidateRuleRefs', Array.from(ruleSet.candidateRuleRefs), item && item.ruleRef);
    if (item && item.required !== true && item.required !== false) addViolation(result, 'D065', artifact, `${pointer}/required`, 'required must be boolean', 'boolean', item && item.required);
    if (item && item.required === true && !ruleSet.requiredRuleRefs.has(item.ruleRef)) addViolation(result, 'D066', artifact, `${pointer}/ruleRef`, 'required reviewItem ruleRef must be in requiredRuleRefs', Array.from(ruleSet.requiredRuleRefs), item.ruleRef);
    if (item && item.required === true && ruleSet.globallyNotApplicableRuleRefs.has(item.ruleRef)) {
      addViolation(result, 'D067', artifact, `${pointer}/ruleRef`, 'globallyNotApplicableRuleRefs must not generate required reviewItem', 'non-required or no reviewItem', item.ruleRef);
    }
    if (!targets.allTargetIds.has(item && item.targetId)) {
      addViolation(result, 'D068', artifact, `${pointer}/targetId`, 'reviewItem targetId must exist in targets.changedUnits[] or targets.candidates[]', Array.from(targets.allTargetIds), item && item.targetId);
    } else {
      const target = targets.targetById.get(item.targetId);
      if (target && item.targetKind !== target.targetKind) {
        addViolation(result, 'D069', artifact, `${pointer}/targetKind`, 'reviewItem targetKind must match target targetKind', target.targetKind, item.targetKind);
      }
      validateReviewTargetContext(target, artifact, result, 'D071', `${pointer}/targetId`);
    }
    if (item && item.reviewItemId) itemMap.set(item.reviewItemId, item);
  });
  ruleSet.requiredRuleRefs.forEach((ruleRef) => {
    const hasRequiredItem = Array.from(itemMap.values()).some((item) => item.required === true && item.ruleRef === ruleRef);
    if (!hasRequiredItem) addViolation(result, 'D070', artifact, '/reviewItems', 'requiredRuleRef must generate at least one required reviewItem', ruleRef, Array.from(itemMap.values()));
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
    if (!ruleSet.requiredRuleRefs.has(entry && entry.ruleRef)) {
      addViolation(result, 'D152', artifact, `${pointer}/ruleRef`, 'applicabilityMatrix ruleRef must be requiredRuleRefs item', Array.from(ruleSet.requiredRuleRefs), entry && entry.ruleRef);
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
    if (rowsByPair.has(key)) addViolation(result, 'D157', artifact, pointer, 'applicabilityMatrix must contain one row per required rule and target pair', 'unique ruleRef + targetId', entry);
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
      if (item.ruleRef !== entry.ruleRef || item.targetId !== entry.targetId || item.targetKind !== entry.targetKind || item.required !== true) {
        addViolation(result, 'D160', artifact, `${pointer}/reviewItemId`, 'applicable matrix row must point to matching required reviewItem', { ruleRef: entry.ruleRef, targetId: entry.targetId, targetKind: entry.targetKind, required: true }, item);
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

  ruleSet.requiredRuleRefs.forEach((ruleRef) => {
    targets.targetById.forEach((_target, targetId) => {
      const key = applicabilityKey(ruleRef, targetId);
      if (!rowsByPair.has(key)) {
        addViolation(result, 'D163', artifact, '/applicabilityMatrix', 'applicabilityMatrix must cover every requiredRuleRef x target pair', key, Array.from(rowsByPair.keys()));
      }
    });
  });

  reviewItems.forEach((item) => {
    if (!item.required) return;
    if (!applicableItemIds.has(item.reviewItemId)) {
      addViolation(result, 'D164', artifact, '/applicabilityMatrix', 'each required reviewItem must be backed by applicable matrix row', item.reviewItemId, Array.from(applicableItemIds));
    }
  });
}

function applicabilityKey(ruleRef, targetId) {
  return `${ruleRef || ''}\u0000${targetId || ''}`;
}

function validateRequiredContextCoverage(ruleSet, targets, artifact, result) {
  const requiredContextById = new Map();
  ruleSet.requiredRuleRefs.forEach((ruleRef) => {
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
        addViolation(result, 'D170', artifact, `/targets/contextExpansions/${index}/requiredContextRefs/${refIndex}`, 'requiredContextRefs must reference required rule context', Array.from(requiredContextById.keys()), contextId);
      } else {
        covered.add(contextId);
      }
    });
  });

  requiredContextById.forEach((_value, contextId) => {
    if (!covered.has(contextId)) {
      addViolation(result, 'D171', artifact, '/targets/contextExpansions', 'required rule context must be covered by contextExpansions.requiredContextRefs', contextId, Array.from(covered));
    }
  });
}

function validateNoPriorReviewInputs(dispatch, artifact, result) {
  if (Object.prototype.hasOwnProperty.call(dispatch, 'priorReviewCheck')) {
    addViolation(result, 'D180', artifact, '/priorReviewCheck', 'priorReviewCheck is forbidden; rules-review must not consume prior review results', 'field absent', dispatch.priorReviewCheck);
  }
  validateNoPriorReviewArtifactRefs(dispatch, artifact, result, '');
}

function validateNoPriorReviewArtifactRefs(value, artifact, result, pointer) {
  if (typeof value === 'string') {
    if (value.includes('.rules-review-tmp/') || value.includes('.rules-review-tmp\\')) {
      addViolation(result, 'D181', artifact, pointer || '/', 'dispatch must not reference prior review artifacts', 'no prior review artifact reference', value);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateNoPriorReviewArtifactRefs(item, artifact, result, `${pointer}/${index}`));
    return;
  }
  if (isObject(value)) {
    Object.entries(value).forEach(([key, item]) => validateNoPriorReviewArtifactRefs(item, artifact, result, `${pointer}/${escapeJsonPointer(key)}`));
  }
}

function escapeJsonPointer(value) {
  return String(value).replace(/~/g, '~0').replace(/\//g, '~1');
}

function validateReviewBatches(reviewBatches, ruleSet, reviewItems, artifact, result) {
  if (!Array.isArray(reviewBatches)) {
    addViolation(result, 'D080', artifact, '/reviewBatches', 'reviewBatches must be array', 'array', reviewBatches);
    return;
  }
  const batchIds = new Set();
  const assignment = new Map();
  reviewBatches.forEach((batch, index) => {
    const pointer = `/reviewBatches/${index}`;
    requireFields(batch, artifact, result, 'D081', pointer, ['reviewBatchId', 'ruleSetId', 'reviewItemIds', 'taskRef', 'returnStatus', 'aggregateStatus']);
    if (!isNonEmptyString(batch && batch.reviewBatchId)) addViolation(result, 'D082', artifact, `${pointer}/reviewBatchId`, 'reviewBatchId must be non-empty string', 'string', batch && batch.reviewBatchId);
    if (batchIds.has(batch && batch.reviewBatchId)) addViolation(result, 'D083', artifact, `${pointer}/reviewBatchId`, 'reviewBatchId must be unique', 'unique batch id', batch && batch.reviewBatchId);
    if (batch && batch.reviewBatchId) batchIds.add(batch.reviewBatchId);
    if (batch && batch.ruleSetId !== ruleSet.ruleSetId) addViolation(result, 'D084', artifact, `${pointer}/ruleSetId`, 'reviewBatch.ruleSetId must match ruleSet.ruleSetId', ruleSet.ruleSetId, batch.ruleSetId);
    validateStringSet(batch && batch.reviewItemIds, artifact, result, 'D085', `${pointer}/reviewItemIds`);
    if (!isNonEmptyArray(batch && batch.reviewItemIds)) addViolation(result, 'D093', artifact, `${pointer}/reviewItemIds`, 'reviewBatch must include at least one reviewItemId', 'non-empty reviewItemIds', batch && batch.reviewItemIds);
    asArray(batch && batch.reviewItemIds).forEach((reviewItemId, itemIndex) => {
      if (!reviewItems.has(reviewItemId)) addViolation(result, 'D086', artifact, `${pointer}/reviewItemIds/${itemIndex}`, 'reviewBatch reviewItemIds must exist in reviewItems', Array.from(reviewItems.keys()), reviewItemId);
      if (!assignment.has(reviewItemId)) assignment.set(reviewItemId, []);
      assignment.get(reviewItemId).push(batch && batch.reviewBatchId);
    });
    if (!isNonEmptyString(batch && batch.taskRef)) addViolation(result, 'D087', artifact, `${pointer}/taskRef`, 'taskRef must be non-empty string', 'string', batch && batch.taskRef);
    if (!RETURN_STATUSES.includes(batch && batch.returnStatus)) addViolation(result, 'D088', artifact, `${pointer}/returnStatus`, 'returnStatus must be valid', RETURN_STATUSES, batch && batch.returnStatus);
    if (!AGGREGATE_STATUSES.includes(batch && batch.aggregateStatus)) addViolation(result, 'D089', artifact, `${pointer}/aggregateStatus`, 'aggregateStatus must be valid', AGGREGATE_STATUSES, batch && batch.aggregateStatus);
    if (batch && batch.aggregateStatus === 'aggregated' && batch.returnStatus !== 'returned') {
      addViolation(result, 'D090', artifact, pointer, 'aggregated reviewBatch must have returnStatus returned', 'returned', batch.returnStatus);
    }
  });
  assignment.forEach((batchIdsForItem, reviewItemId) => {
    if (batchIdsForItem.length > 1) {
      addViolation(result, 'D091', artifact, '/reviewBatches', 'reviewItemId must not be assigned to multiple reviewBatches', 'single reviewBatch assignment', { reviewItemId, reviewBatchIds: batchIdsForItem });
    }
  });
  reviewItems.forEach((item, reviewItemId) => {
    if (!assignment.has(reviewItemId)) {
      addViolation(result, 'D092', artifact, '/reviewBatches', 'reviewItem must be assigned to one reviewBatch', reviewItemId, Array.from(assignment.keys()));
    }
  });
}

function validateExecutionPlan(executionPlan, dispatch, ruleSet, reviewItems, artifact, result) {
  if (!isObject(executionPlan)) {
    addViolation(result, 'D100', artifact, '/executionPlan', 'executionPlan must be object', 'object', executionPlan);
    return;
  }

  requireFields(executionPlan, artifact, result, 'D101', '/executionPlan', [
    'mode',
    'selectedBy',
    'policyVersion',
    'metrics',
    'signals',
    'reason',
    'humanOverride',
  ]);

  if (!EXECUTION_MODES.includes(executionPlan.mode)) {
    addViolation(result, 'D102', artifact, '/executionPlan/mode', 'executionPlan.mode must be valid', EXECUTION_MODES, executionPlan.mode);
  }
  if (!EXECUTION_SELECTED_BY.includes(executionPlan.selectedBy)) {
    addViolation(result, 'D103', artifact, '/executionPlan/selectedBy', 'executionPlan.selectedBy must be valid', EXECUTION_SELECTED_BY, executionPlan.selectedBy);
  }
  if (executionPlan.policyVersion !== EXECUTION_POLICY_VERSION) {
    addViolation(result, 'D104', artifact, '/executionPlan/policyVersion', 'executionPlan.policyVersion must match review execution policy', EXECUTION_POLICY_VERSION, executionPlan.policyVersion);
  }
  if (!isNonEmptyString(executionPlan.reason)) {
    addViolation(result, 'D105', artifact, '/executionPlan/reason', 'executionPlan.reason must be non-empty string', 'non-empty reason', executionPlan.reason);
  }

  validateExecutionMetrics(executionPlan.metrics, dispatch, ruleSet, reviewItems, artifact, result);
  validateExecutionSignals(executionPlan.signals, artifact, result);
  validateHumanOverride(executionPlan, artifact, result);
  validateExecutionModeAgainstPolicy(executionPlan, dispatch, artifact, result);
}

function validateExecutionMetrics(metrics, dispatch, ruleSet, reviewItems, artifact, result) {
  if (!isObject(metrics)) {
    addViolation(result, 'D110', artifact, '/executionPlan/metrics', 'executionPlan.metrics must be object', 'object', metrics);
    return;
  }

  requireFields(metrics, artifact, result, 'D111', '/executionPlan/metrics', [
    'changedUnits',
    'candidates',
    'targets',
    'requiredRuleRefs',
    'reviewItems',
  ]);

  const expected = {
    changedUnits: asArray(dispatch && dispatch.targets && dispatch.targets.changedUnits).length,
    candidates: asArray(dispatch && dispatch.targets && dispatch.targets.candidates).length,
    targets: asArray(dispatch && dispatch.targets && dispatch.targets.changedUnits).length + asArray(dispatch && dispatch.targets && dispatch.targets.candidates).length,
    requiredRuleRefs: ruleSet.requiredRuleRefs.size,
    reviewItems: reviewItems.size,
  };

  Object.keys(expected).forEach((key) => {
    if (!Number.isInteger(metrics[key]) || metrics[key] < 0) {
      addViolation(result, 'D112', artifact, `/executionPlan/metrics/${key}`, 'executionPlan metric must be non-negative integer', 'integer >= 0', metrics[key]);
      return;
    }
    if (metrics[key] !== expected[key]) {
      addViolation(result, 'D113', artifact, `/executionPlan/metrics/${key}`, 'executionPlan metric must match dispatch facts', expected[key], metrics[key]);
    }
  });
}

function validateExecutionSignals(signals, artifact, result) {
  if (!isObject(signals)) {
    addViolation(result, 'D120', artifact, '/executionPlan/signals', 'executionPlan.signals must be object', 'object', signals);
    return;
  }
  requireFields(signals, artifact, result, 'D121', '/executionPlan/signals', ['userRequestedConcurrency']);
  if (signals.userRequestedConcurrency !== true && signals.userRequestedConcurrency !== false) {
    addViolation(result, 'D122', artifact, '/executionPlan/signals/userRequestedConcurrency', 'userRequestedConcurrency must be boolean', 'boolean', signals.userRequestedConcurrency);
  }
}

function validateHumanOverride(executionPlan, artifact, result) {
  if (executionPlan.selectedBy === 'human_override') {
    if (!isObject(executionPlan.humanOverride)) {
      addViolation(result, 'D130', artifact, '/executionPlan/humanOverride', 'humanOverride must be object when selectedBy=human_override', 'object', executionPlan.humanOverride);
      return;
    }
    requireFields(executionPlan.humanOverride, artifact, result, 'D131', '/executionPlan/humanOverride', ['requestedMode', 'risk']);
    if (!EXECUTION_MODES.includes(executionPlan.humanOverride.requestedMode)) {
      addViolation(result, 'D132', artifact, '/executionPlan/humanOverride/requestedMode', 'humanOverride.requestedMode must be valid', EXECUTION_MODES, executionPlan.humanOverride.requestedMode);
    }
    if (executionPlan.humanOverride.requestedMode !== executionPlan.mode) {
      addViolation(result, 'D135', artifact, '/executionPlan/humanOverride/requestedMode', 'humanOverride.requestedMode must match executionPlan.mode', executionPlan.mode, executionPlan.humanOverride.requestedMode);
    }
    if (!isNonEmptyString(executionPlan.humanOverride.risk)) {
      addViolation(result, 'D133', artifact, '/executionPlan/humanOverride/risk', 'humanOverride.risk must be non-empty string', 'non-empty risk', executionPlan.humanOverride.risk);
    }
    return;
  }

  if (executionPlan.humanOverride !== null) {
    addViolation(result, 'D134', artifact, '/executionPlan/humanOverride', 'humanOverride must be null unless selectedBy=human_override', null, executionPlan.humanOverride);
  }
}

function validateExecutionModeAgainstPolicy(executionPlan, dispatch, artifact, result) {
  const batchCount = asArray(dispatch && dispatch.reviewBatches).length;
  if (executionPlan.mode === 'single_batch' && batchCount !== 1) {
    addViolation(result, 'D140', artifact, '/reviewBatches', 'single_batch executionPlan requires exactly one reviewBatch', 1, batchCount);
  }
  if (executionPlan.mode === 'multi_batch' && batchCount < 2) {
    addViolation(result, 'D141', artifact, '/reviewBatches', 'multi_batch executionPlan requires at least two reviewBatches', '>= 2', batchCount);
  }

  if (executionPlan.selectedBy === 'human_override') return;
  const metrics = isObject(executionPlan.metrics) ? executionPlan.metrics : {};
  const signals = isObject(executionPlan.signals) ? executionPlan.signals : {};
  const mustMulti = metrics.reviewItems > 30 || metrics.targets > 20 || signals.userRequestedConcurrency === true;
  if (mustMulti && executionPlan.mode !== 'multi_batch') {
    addViolation(result, 'D142', artifact, '/executionPlan/mode', 'hard execution policy requires multi_batch', 'multi_batch', executionPlan.mode);
  }
}

function validateTask(task, artifact, result) {
  expectKind(task, artifact, result, 'T002', 'rules-review-task');
  validateSchemaVersion(task, artifact, result, 'T003');
  requireFields(task, artifact, result, 'T004', '', ['kind', 'schemaVersion', 'runId', 'reviewBatchId', 'ruleSetId', 'reviewItems', 'rules', 'targets', 'applicabilityMatrix', 'outputContract']);
  if (!Array.isArray(task.reviewItems)) addViolation(result, 'T005', artifact, '/reviewItems', 'reviewItems must be array', 'array', task.reviewItems);
  if (!Array.isArray(task.rules)) addViolation(result, 'T006', artifact, '/rules', 'rules must be array', 'array', task.rules);
  if (!Array.isArray(task.targets)) addViolation(result, 'T007', artifact, '/targets', 'targets must be array', 'array', task.targets);
  if (!Array.isArray(task.applicabilityMatrix)) addViolation(result, 'T018', artifact, '/applicabilityMatrix', 'applicabilityMatrix must be array', 'array', task.applicabilityMatrix);

  asArray(task.reviewItems).forEach((item, index) => {
    const pointer = `/reviewItems/${index}`;
    requireFields(item, artifact, result, 'T008', pointer, ['reviewItemId', 'ruleRef', 'targetKind', 'targetId', 'required']);
    if (!REVIEW_ITEM_RE.test(item && item.reviewItemId)) addViolation(result, 'T009', artifact, `${pointer}/reviewItemId`, 'reviewItemId must match RIxxx', 'RIxxx', item && item.reviewItemId);
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
  });
  if (!isObject(task.outputContract)) {
    addViolation(result, 'T013', artifact, '/outputContract', 'outputContract must be object', 'object', task.outputContract);
  } else {
    if (task.outputContract.format !== 'strict_json') addViolation(result, 'T014', artifact, '/outputContract/format', 'output format must be strict_json', 'strict_json', task.outputContract.format);
    if (task.outputContract.schemaRef !== 'schemas/shard.schema.json') addViolation(result, 'T015', artifact, '/outputContract/schemaRef', 'schemaRef must point to shard schema', 'schemas/shard.schema.json', task.outputContract.schemaRef);
  }
  validateTaskApplicabilityMatrix(task, artifact, result);
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
    if (item.required !== true || item.ruleRef !== entry.ruleRef || item.targetId !== entry.targetId || item.targetKind !== entry.targetKind) {
      addViolation(result, 'T039', artifact, `${pointer}/reviewItemId`, 'task applicabilityMatrix row must match required reviewItem', item, entry);
    }
  });

  reviewItems.forEach((item) => {
    if (item && item.required === true && !rowsByItem.has(item.reviewItemId)) {
      addViolation(result, 'T040', artifact, '/applicabilityMatrix', 'task must include an applicable matrix row for each required reviewItem', item.reviewItemId, Array.from(rowsByItem.keys()));
    }
  });
}

function validateRetryTask(retryTask, artifact, result) {
  expectKind(retryTask, artifact, result, 'RT002', 'rules-review-retry-task');
  validateSchemaVersion(retryTask, artifact, result, 'RT003');
  requireFields(retryTask, artifact, result, 'RT004', '', ['kind', 'schemaVersion', 'runId', 'retryAttempt', 'reason', 'originalTaskRef', 'violations', 'outputContract']);
  if (!Number.isInteger(retryTask.retryAttempt) || retryTask.retryAttempt < 1) addViolation(result, 'RT005', artifact, '/retryAttempt', 'retryAttempt must be positive integer', 'integer >= 1', retryTask.retryAttempt);
  if (!Array.isArray(retryTask.violations)) addViolation(result, 'RT006', artifact, '/violations', 'violations must be array', 'array', retryTask.violations);
}

function validateShard(shard, task, artifact, result) {
  expectKind(shard, artifact, result, 'S002', 'rules-review-shard');
  validateSchemaVersion(shard, artifact, result, 'S003');
  requireFields(shard, artifact, result, 'S004', '', ['kind', 'schemaVersion', 'runId', 'reviewBatchId', 'results']);
  if (task) {
    if (shard.runId !== task.runId) addViolation(result, 'S005', artifact, '/runId', 'shard runId must match task runId', task.runId, shard.runId);
    if (shard.reviewBatchId !== task.reviewBatchId) addViolation(result, 'S006', artifact, '/reviewBatchId', 'shard reviewBatchId must match task reviewBatchId', task.reviewBatchId, shard.reviewBatchId);
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

  if (reviewResult && reviewResult.status === 'finding') {
    if (!FINDING_RE.test(reviewResult.findingId)) addViolation(result, `${prefix}013`, artifact, `${pointer}/findingId`, 'finding result requires findingId and evidence', 'Fxxx', reviewResult.findingId);
    validateEvidenceArray(reviewResult.evidence, artifact, result, `${prefix}014`, `${pointer}/evidence`, 'finding result requires findingId and evidence');
    validateReviewResultDisposition(reviewResult, taskContext, artifact, result, pointer, prefix);
  }
  if (reviewResult && reviewResult.status === 'observation') {
    if (!hasValidEvidenceArray(reviewResult.evidence) && !isNonEmptyString(reviewResult.reason)) {
      addViolation(result, `${prefix}019`, artifact, pointer, 'observation result requires reason or evidence', 'reason or evidence[]', reviewResult);
    }
    if (reviewResult.evidence !== undefined) validateEvidenceArray(reviewResult.evidence, artifact, result, `${prefix}020`, `${pointer}/evidence`, 'observation evidence must be reviewable when present');
    validateReviewResultDisposition(reviewResult, taskContext, artifact, result, pointer, prefix);
  }
  if (reviewResult && reviewResult.status === 'passed') {
    validateEvidenceArray(reviewResult.evidence, artifact, result, `${prefix}015`, `${pointer}/evidence`, 'passed result requires evidence');
    validateFailureChecks(reviewResult, taskContext, artifact, result, pointer, prefix);
  }
  if (reviewResult && reviewResult.status === 'not_applicable' && !isNonEmptyString(reviewResult.reason)) {
    addViolation(result, `${prefix}016`, artifact, `${pointer}/reason`, 'not_applicable result requires reason', 'non-empty reason', reviewResult.reason);
  }
  if (reviewResult && reviewResult.status === 'cannot_verify' && !isNonEmptyString(reviewResult.reason) && !hasValidEvidenceArray(reviewResult.evidence)) {
    addViolation(result, `${prefix}017`, artifact, pointer, 'cannot_verify result requires reason or evidence', 'reason or evidence[]', reviewResult);
  }
  if (reviewResult && reviewResult.status === 'not_applicable' && reviewResult.evidence !== undefined) {
    validateEvidenceArray(reviewResult.evidence, artifact, result, `${prefix}018`, `${pointer}/evidence`, 'not_applicable evidence must be reviewable when present');
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
    validateEvidenceArray(check && check.evidence, artifact, result, `${prefix}034`, `${checkPointer}/evidence`, 'failureCheck requires evidence');
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
      validateAcceptedRisk(reviewResult.acceptedRisk, artifact, result, `${prefix}028`, `${pointer}/acceptedRisk`);
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

function validateAcceptedRisk(value, artifact, result, code, pointer) {
  if (!isObject(value)) {
    addViolation(result, code, artifact, pointer, 'acceptedRisk must be object for MUST downgrade', 'acceptedRisk object', value);
    return false;
  }
  let ok = true;
  const required = ['status', 'acceptedBy', 'scope', 'reason'];
  required.forEach((field) => {
    if (!(field in value)) {
      addViolation(result, code, artifact, `${pointer}/${field}`, 'acceptedRisk required field is missing', field, null);
      ok = false;
    }
  });
  if (!ACCEPTED_RISK_STATUSES.includes(value.status)) {
    addViolation(result, code, artifact, `${pointer}/status`, 'acceptedRisk.status must be accepted', ACCEPTED_RISK_STATUSES, value.status);
    ok = false;
  }
  if (!ACCEPTED_RISK_ACCEPTED_BY.includes(value.acceptedBy)) {
    addViolation(result, code, artifact, `${pointer}/acceptedBy`, 'acceptedRisk.acceptedBy must be valid', ACCEPTED_RISK_ACCEPTED_BY, value.acceptedBy);
    ok = false;
  }
  ['scope', 'reason'].forEach((field) => {
    if (!isNonEmptyString(value[field])) {
      addViolation(result, code, artifact, `${pointer}/${field}`, 'acceptedRisk field must be non-empty string', 'string', value[field]);
      ok = false;
    }
  });
  if (!isNonEmptyString(value.expiresAt) && !isNonEmptyString(value.followUp)) {
    addViolation(result, code, artifact, pointer, 'acceptedRisk requires expiresAt or followUp', 'expiresAt or followUp', value);
    ok = false;
  }
  return ok;
}

function validateRun(runDir, result) {
  if (!runDir || runDir === true) {
    addViolation(result, 'RUN001', null, '/dir', 'run mode requires --dir', 'run directory', runDir || null, 2);
    return;
  }

  validateRunDirectoryFiles(runDir, result);

  const dispatchPath = path.join(runDir, 'dispatch.json');
  const finalReviewPath = path.join(runDir, 'finalReview.json');
  const finalMdPath = path.join(runDir, 'final.md');
  const dispatch = readJson(dispatchPath, rel(runDir, dispatchPath), result, 'D001');
  if (dispatch) validateDispatch(dispatch, rel(runDir, dispatchPath), result);

  const finalReview = readJson(finalReviewPath, rel(runDir, finalReviewPath), result, 'FR001');
  if (finalReview) validateFinalReviewShape(finalReview, rel(runDir, finalReviewPath), result);

  const runState = dispatch ? validateRunArtifacts(runDir, dispatch, result) : { results: [], resultOwners: new Map() };
  if (dispatch) validateRequiredResults(dispatch, runState.results, runState.resultOwners, result);

  const beforeFinalGate = calculateGate(dispatch, runState.results, result);
  if (finalReview && dispatch) validateFinalReviewAgainstComputed(finalReview, dispatch, runState.results, beforeFinalGate, rel(runDir, finalReviewPath), result);
  result.gate = calculateGate(dispatch, runState.results, result);

  if (result.gate.protocolGate !== 'passed') {
    addViolation(result, 'RUN900', rel(runDir, 'finalReview.json'), '/protocolGate', 'protocolGate must be passed for automation gate success', 'passed', result.gate.protocolGate, 1, null);
  } else {
    validateFinalMarkdown(finalReview, finalMdPath, result, dispatch);
  }
}

function validateRunDirectoryFiles(runDir, result) {
  if (!fs.existsSync(runDir) || !fs.statSync(runDir).isDirectory()) {
    addViolation(result, 'RUN002', null, '/dir', 'run directory must exist', 'directory', runDir, 2);
    return;
  }
  collectFiles(runDir).forEach((filePath) => {
    const relativePath = rel(runDir, filePath);
    if (!isAllowedRunArtifact(relativePath)) {
      addViolation(result, 'RUN003', relativePath, null, 'run directory must only contain rules-review protocol artifacts', 'dispatch/finalReview/final/response or JSON under tasks/retries/shards/validations', relativePath);
    }
  });
}

function collectFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(dir, entry.name);
    return entry.isDirectory() ? collectFiles(entryPath) : [entryPath];
  });
}

function isAllowedRunArtifact(relativePath) {
  if (['dispatch.json', 'finalReview.json', 'final.md', 'response.md'].includes(relativePath)) return true;
  return /^(tasks|retries|shards|validations)\/[^/]+\.json$/.test(relativePath);
}

function validateRunArtifacts(runDir, dispatch, result) {
  const reviewItems = new Map(asArray(dispatch.reviewItems).map((item) => [item.reviewItemId, item]));
  const results = [];
  const resultOwners = new Map();

  asArray(dispatch.reviewBatches).forEach((batch, batchIndex) => {
    const batchPointer = `/reviewBatches/${batchIndex}`;
    const taskPath = path.join(runDir, batch.taskRef || '');
    const taskArtifact = rel(runDir, taskPath);
    const taskExists = batch.taskRef && fs.existsSync(taskPath);

    if (!taskExists) {
      const impact = batch.returnStatus === 'returned' ? 'blocked' : 'incomplete';
      addViolation(result, 'RUN010', rel(runDir, 'dispatch.json'), `${batchPointer}/taskRef`, 'task.json missing for reviewBatch', 'readable taskRef', batch.taskRef, impact === 'blocked' ? 2 : 1, impact);
      return;
    }

    const task = readJson(taskPath, taskArtifact, result, 'T001');
    if (!task) return;
    validateTask(task, taskArtifact, result);
    validateTaskAgainstDispatch(task, dispatch, batch, reviewItems, taskArtifact, result);

    const completeBatch = batch.returnStatus === 'returned' && batch.aggregateStatus === 'aggregated';
    if (!completeBatch) {
      const statusImpact = ['format_invalid', 'untrusted'].includes(batch.returnStatus) || (batch.returnStatus === 'returned' && batch.aggregateStatus === 'not_aggregated')
        ? 'blocked'
        : 'incomplete';
      addViolation(result, 'RUN011', rel(runDir, 'dispatch.json'), batchPointer, 'reviewBatch was not returned and aggregated', 'returned + aggregated', {
        returnStatus: batch.returnStatus,
        aggregateStatus: batch.aggregateStatus,
      }, 1, statusImpact);
      return;
    }

    if (!isNonEmptyString(batch.shardRef)) {
      addViolation(result, 'RUN012', rel(runDir, 'dispatch.json'), `${batchPointer}/shardRef`, 'returned reviewBatch requires shardRef', 'shardRef', batch.shardRef);
      return;
    }

    const shardPath = path.join(runDir, batch.shardRef);
    const shardArtifact = rel(runDir, shardPath);
    const shard = readJson(shardPath, shardArtifact, result, 'S001');
    if (!shard) return;
    validateShard(shard, task, shardArtifact, result);
    validateShardAgainstBatch(shard, batch, shardArtifact, result);

    asArray(shard.results).forEach((reviewResult, resultIndex) => {
      if (reviewResult && reviewResult.reviewItemId) {
        results.push(reviewResult);
        if (!resultOwners.has(reviewResult.reviewItemId)) resultOwners.set(reviewResult.reviewItemId, []);
        resultOwners.get(reviewResult.reviewItemId).push({ batch, shard, index: resultIndex });
      }
    });
  });

  return { results, resultOwners };
}

function validateTaskAgainstDispatch(task, dispatch, batch, reviewItems, artifact, result) {
  if (task.runId !== dispatch.runId) addViolation(result, 'RUN020', artifact, '/runId', 'task runId must match dispatch runId', dispatch.runId, task.runId);
  if (task.reviewBatchId !== batch.reviewBatchId) addViolation(result, 'RUN021', artifact, '/reviewBatchId', 'task reviewBatchId must match reviewBatchId', batch.reviewBatchId, task.reviewBatchId);
  if (task.ruleSetId !== dispatch.ruleSet.ruleSetId) addViolation(result, 'RUN022', artifact, '/ruleSetId', 'task ruleSetId must match dispatch ruleSetId', dispatch.ruleSet.ruleSetId, task.ruleSetId);

  const expectedItemIds = asArray(batch.reviewItemIds);
  const actualItemIds = asArray(task.reviewItems).map((item) => item.reviewItemId);
  if (!setsEqual(new Set(expectedItemIds), new Set(actualItemIds))) {
    addViolation(result, 'RUN023', artifact, '/reviewItems', 'task reviewItems must match reviewBatch reviewItemIds', expectedItemIds, actualItemIds);
  }
  asArray(task.reviewItems).forEach((item, index) => {
    const expected = reviewItems.get(item.reviewItemId);
    if (!expected) return;
    ['ruleRef', 'targetKind', 'targetId', 'required'].forEach((field) => {
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

function validateRequiredResults(dispatch, results, resultOwners, result) {
  const reviewItems = new Map(asArray(dispatch.reviewItems).map((item) => [item.reviewItemId, item]));
  const assignedIds = new Set(reviewItems.keys());

  results.forEach((reviewResult, index) => {
    if (!assignedIds.has(reviewResult && reviewResult.reviewItemId)) {
      addViolation(result, 'RUN040', result.artifact, `/results/${index}/reviewItemId`, 'result must reference assigned reviewItemId', Array.from(assignedIds), reviewResult && reviewResult.reviewItemId);
    }
  });

  reviewItems.forEach((item) => {
    if (!item.required) return;
    const owners = resultOwners.get(item.reviewItemId) || [];
    if (owners.length === 0) {
      addViolation(result, 'RUN041', result.artifact, `/reviewItems/${item.reviewItemId}`, 'required reviewItem must have exactly one result', 'one result', 0, 1, 'incomplete');
    } else if (owners.length > 1) {
      addViolation(result, 'RUN042', result.artifact, `/reviewItems/${item.reviewItemId}`, 'reviewItem has duplicate results', 'one result', owners.length);
    }
  });
}

function calculateGate(dispatch, results, result) {
  const protocolGate = result.gateImpact.blocked ? 'blocked' : result.gateImpact.incomplete ? 'incomplete' : 'passed';
  const scopeMode = dispatch && dispatch.ruleSet && asArray(dispatch.ruleSet.excludedRuleRefs).length > 0 ? 'scoped' : 'full';
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
  const findings = asArray(results).filter((reviewResult) => reviewResult && reviewResult.status === 'finding');
  return {
    findings: findings.length,
    mustFix: findings.filter((reviewResult) => deriveFindingPriority(reviewResult, dispatch) === 'must_fix').length,
    shouldFix: findings.filter((reviewResult) => deriveFindingPriority(reviewResult, dispatch) === 'should_fix').length,
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
  return asArray(results)
    .filter((reviewResult) => reviewResult && reviewResult.status === 'finding')
    .map((reviewResult) => {
      const item = reviewItems.get(reviewResult.reviewItemId) || {};
      const source = ruleSources.get(item.ruleRef) || {};
      const finding = {
        findingId: reviewResult.findingId,
        reviewItemId: reviewResult.reviewItemId,
        ruleRef: item.ruleRef || 'unknown',
        targetId: item.targetId || 'unknown',
        ruleLevel: source.ruleLevel || 'unknown',
        origin: reviewResult.origin,
        priority: deriveFindingPriority(reviewResult, dispatch),
        evidence: reviewResult.evidence,
      };
      copyOptionalFields(reviewResult, finding, ['priorityReason', 'upgradeReason', 'originReason', 'acceptedRisk']);
      return finding;
    });
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
  fs.mkdirSync(outputDir, { recursive: true });
  const written = [];
  const reviewItems = new Map(asArray(dispatch.reviewItems).map((item) => [item.reviewItemId, item]));
  tasks.forEach(({ batch, task }) => {
    const outputPath = path.join(outputDir, path.basename(batch.taskRef || `${batch.reviewBatchId}.json`));
    fs.writeFileSync(outputPath, `${JSON.stringify(task, null, 2)}\n`);
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
    return {
      batch,
      task: {
        kind: 'rules-review-task',
        schemaVersion: SCHEMA_VERSION,
        runId: dispatch.runId,
        reviewBatchId: batch.reviewBatchId,
        ruleSetId: dispatch.ruleSet.ruleSetId,
        reviewItems,
        rules: asArray(dispatch.ruleSet.ruleSources).filter((source) => source && ruleRefs.has(source.ruleRef) && ruleSourcesByRuleRef.has(source.ruleRef)),
        targets: [...asArray(dispatch.targets && dispatch.targets.changedUnits), ...asArray(dispatch.targets && dispatch.targets.candidates)]
          .filter((target) => target && targetIds.has(target.targetId) && targetsById.has(target.targetId)),
        applicabilityMatrix: applicabilityRows,
        outputContract: {
          format: 'strict_json',
          schemaRef: 'schemas/shard.schema.json',
        },
      },
    };
  });
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

  validateRunDirectoryFiles(runDir, result);
  const dispatchPath = path.join(runDir, 'dispatch.json');
  const dispatch = readJson(dispatchPath, rel(runDir, dispatchPath), result, 'D001');
  if (dispatch) validateDispatch(dispatch, rel(runDir, dispatchPath), result);
  const runState = dispatch ? validateRunArtifacts(runDir, dispatch, result) : { results: [], resultOwners: new Map() };
  if (dispatch) validateRequiredResults(dispatch, runState.results, runState.resultOwners, result);
  const gate = calculateGate(dispatch, runState.results, result);
  result.gate = gate;
  if (!dispatch) return;

  const finalReview = buildFinalReview(dispatch, runState.results, gate);
  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  fs.writeFileSync(args.output, `${JSON.stringify(finalReview, null, 2)}\n`);
  validateFinalReviewShape(finalReview, args.output, result);
  validateFinalReviewAgainstComputed(finalReview, dispatch, runState.results, gate, args.output, result);
  result.rendered = args.output;
}

function buildFinalReview(dispatch, results, gate) {
  const finalReview = {
    kind: 'rules-review-final-review',
    schemaVersion: SCHEMA_VERSION,
    runId: dispatch.runId,
    protocolGate: gate.protocolGate,
    scopeMode: gate.scopeMode,
    coverageClaim: gate.coverageClaim,
    semanticVerdict: gate.semanticVerdict,
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
  return finalReview;
}

function validateFinalReviewShape(finalReview, artifact, result) {
  expectKind(finalReview, artifact, result, 'FR002', 'rules-review-final-review');
  validateSchemaVersion(finalReview, artifact, result, 'FR003');
  requireFields(finalReview, artifact, result, 'FR004', '', [
    'kind',
    'schemaVersion',
    'runId',
    'protocolGate',
    'scopeMode',
    'coverageClaim',
    'semanticVerdict',
    'excludedRuleRefs',
    'findings',
    'observations',
    'issueSummary',
    'recommendation',
    'validationResults',
  ]);
  if (!PROTOCOL_GATES.includes(finalReview.protocolGate)) addViolation(result, 'FR005', artifact, '/protocolGate', 'protocolGate must be valid', PROTOCOL_GATES, finalReview.protocolGate);
  if (!SCOPE_MODES.includes(finalReview.scopeMode)) addViolation(result, 'FR006', artifact, '/scopeMode', 'scopeMode must be valid', SCOPE_MODES, finalReview.scopeMode);
  if (!COVERAGE_CLAIMS.includes(finalReview.coverageClaim)) addViolation(result, 'FR007', artifact, '/coverageClaim', 'coverageClaim must be valid', COVERAGE_CLAIMS, finalReview.coverageClaim);
  if (!SEMANTIC_VERDICTS.includes(finalReview.semanticVerdict)) addViolation(result, 'FR008', artifact, '/semanticVerdict', 'semanticVerdict must be valid', SEMANTIC_VERDICTS, finalReview.semanticVerdict);
  validateIssueSummary(finalReview.issueSummary, artifact, result, 'FR015', '/issueSummary');
  if (!RECOMMENDATIONS.includes(finalReview.recommendation)) addViolation(result, 'FR016', artifact, '/recommendation', 'recommendation must be valid', RECOMMENDATIONS, finalReview.recommendation);
  validateStringSet(finalReview.excludedRuleRefs, artifact, result, 'FR009', '/excludedRuleRefs');
  if (!Array.isArray(finalReview.findings)) addViolation(result, 'FR010', artifact, '/findings', 'findings must be array', 'array', finalReview.findings);
  if (!Array.isArray(finalReview.observations)) addViolation(result, 'FR058', artifact, '/observations', 'observations must be array', 'array', finalReview.observations);
  validateValidationResults(finalReview, artifact, result);
  if (finalReview.cannotVerifyItems !== undefined) validateCannotVerifyItems(finalReview.cannotVerifyItems, artifact, result);
  asArray(finalReview.findings).forEach((finding, index) => {
    requireFields(finding, artifact, result, 'FR012', `/findings/${index}`, ['findingId', 'reviewItemId', 'ruleRef', 'targetId', 'ruleLevel', 'origin', 'priority', 'evidence']);
    if (!RULE_LEVELS.includes(finding && finding.ruleLevel)) addViolation(result, 'FR059', artifact, `/findings/${index}/ruleLevel`, 'final finding ruleLevel must be valid', RULE_LEVELS, finding && finding.ruleLevel);
    if (!FINDING_ORIGINS.includes(finding && finding.origin)) addViolation(result, 'FR060', artifact, `/findings/${index}/origin`, 'final finding origin must be valid', FINDING_ORIGINS, finding && finding.origin);
    if (!FINDING_PRIORITIES.includes(finding && finding.priority)) addViolation(result, 'FR061', artifact, `/findings/${index}/priority`, 'final finding priority must be valid', FINDING_PRIORITIES, finding && finding.priority);
    if (finding && finding.acceptedRisk !== undefined) validateAcceptedRisk(finding.acceptedRisk, artifact, result, 'FR062', `/findings/${index}/acceptedRisk`);
    validateEvidenceArray(finding && finding.evidence, artifact, result, 'FR013', `/findings/${index}/evidence`, 'final finding requires evidence');
  });
  asArray(finalReview.observations).forEach((observation, index) => {
    requireFields(observation, artifact, result, 'FR063', `/observations/${index}`, ['reviewItemId', 'ruleRef', 'targetId', 'ruleLevel', 'origin']);
    if (!REVIEW_ITEM_RE.test(observation && observation.reviewItemId)) addViolation(result, 'FR064', artifact, `/observations/${index}/reviewItemId`, 'observation reviewItemId must match RIxxx', 'RIxxx', observation && observation.reviewItemId);
    if (!isNonEmptyString(observation && observation.ruleRef)) addViolation(result, 'FR065', artifact, `/observations/${index}/ruleRef`, 'observation ruleRef must be non-empty string', 'string', observation && observation.ruleRef);
    if (!isNonEmptyString(observation && observation.targetId)) addViolation(result, 'FR066', artifact, `/observations/${index}/targetId`, 'observation targetId must be non-empty string', 'string', observation && observation.targetId);
    if (!RULE_LEVELS.includes(observation && observation.ruleLevel)) addViolation(result, 'FR067', artifact, `/observations/${index}/ruleLevel`, 'observation ruleLevel must be valid', RULE_LEVELS, observation && observation.ruleLevel);
    if (!FINDING_ORIGINS.includes(observation && observation.origin)) addViolation(result, 'FR068', artifact, `/observations/${index}/origin`, 'observation origin must be valid', FINDING_ORIGINS, observation && observation.origin);
    if (!hasValidEvidenceArray(observation && observation.evidence) && !isNonEmptyString(observation && observation.reason)) addViolation(result, 'FR069', artifact, `/observations/${index}`, 'observation requires reason or evidence', 'reason or evidence[]', observation);
    if (observation && observation.evidence !== undefined) validateEvidenceArray(observation.evidence, artifact, result, 'FR070', `/observations/${index}/evidence`, 'observation evidence must be reviewable when present');
  });
}

function validateFinalReviewAgainstComputed(finalReview, dispatch, results, computed, artifact, result) {
  if (finalReview.runId !== dispatch.runId) addViolation(result, 'FR020', artifact, '/runId', 'finalReview runId must match dispatch runId', dispatch.runId, finalReview.runId);

  const excluded = asArray(dispatch.ruleSet.excludedRuleRefs);
  if (!setsEqual(new Set(asArray(finalReview.excludedRuleRefs)), new Set(excluded))) {
    addViolation(result, 'FR021', artifact, '/excludedRuleRefs', 'finalReview excludedRuleRefs must match dispatch ruleSet.excludedRuleRefs', excluded, finalReview.excludedRuleRefs);
  }
  if (finalReview.scopeMode === 'scoped' && asArray(finalReview.excludedRuleRefs).length === 0) {
    addViolation(result, 'FR022', artifact, '/excludedRuleRefs', 'scoped scopeMode requires excludedRuleRefs', 'non-empty excludedRuleRefs', finalReview.excludedRuleRefs);
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
}

function renderFinalMode(args, result) {
  const finalReview = readJson(args.input, args.input, result, 'FR001');
  if (!finalReview) return;
  if (!args.output || args.output === true) {
    addViolation(result, 'EXEC004', null, '/output', 'render-final requires --output', 'output path', args.output || null, 2);
    return;
  }
  const dispatch = args.dispatch && args.dispatch !== true ? readJson(args.dispatch, args.dispatch, result, 'D001') : null;
  if (dispatch) validateDispatch(dispatch, args.dispatch, result);
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
  const markdown = renderResponseMarkdown(runDir, finalReview, dispatch.executionPlan, result.gate);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, markdown);
  result.rendered = outputPath;
  result.response = markdown;
}

function validateFinalMarkdownMode(args, result) {
  const finalReview = readJson(args['final-review'], args['final-review'], result, 'FR001');
  if (!finalReview) return;
  const dispatch = args.dispatch && args.dispatch !== true ? readJson(args.dispatch, args.dispatch, result, 'D001') : null;
  if (dispatch) validateDispatch(dispatch, args.dispatch, result);
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
  if (dispatch && dispatch.executionPlan) {
    required.push(
      formatExecutionMode(dispatch.executionPlan.mode),
      `ruleSetId：${dispatch.ruleSet && dispatch.ruleSet.ruleSetId ? dispatch.ruleSet.ruleSetId : '未知'}`,
      `sourceIndexHash：${dispatch.ruleSet && dispatch.ruleSet.sourceIndexHash ? dispatch.ruleSet.sourceIndexHash : '未知'}`,
      `reviewItems：${asArray(dispatch.reviewItems).length}`,
      `reviewBatches：${asArray(dispatch.reviewBatches).length}`,
    );
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
  const executionPlan = dispatch && dispatch.executionPlan;
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
  appendFindingLines(lines, findings);
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
  lines.push(
    '',
    '## 范围',
    `- 范围模式：${label(finalReview.scopeMode)}`,
    `- 覆盖声明：${label(finalReview.coverageClaim)}`,
    `- 排除规则：${formatList(finalReview.excludedRuleRefs)}`,
    '',
    '## 审计',
    ...formatAuditLines(finalReview, dispatch, runDir),
    '',
    '## 执行计划',
    ...formatExecutionPlanLines(executionPlan),
  );
  lines.push('', '## 验证', `- protocolGate：${protocolGateLabel(finalReview.protocolGate)}`);
  asArray(finalReview.validationResults).forEach((validation) => {
    lines.push(`- ${validation.mode || 'validation'}：${validation.ok === false ? '失败' : '成功'}`);
  });
  return `${lines.join('\n')}\n`;
}

function renderResponseMarkdown(runDir, finalReview, executionPlan, gate) {
  const finalMdPath = path.resolve(runDir, 'final.md');
  const finalReviewPath = path.resolve(runDir, 'finalReview.json');
  const dispatchPath = path.resolve(runDir, 'dispatch.json');
  const findings = asArray(finalReview.findings);
  const issueSummary = gate && gate.issueSummary ? gate.issueSummary : issueSummaryFromFinalReview(finalReview);
  const protocolGate = gate && gate.protocolGate ? gate.protocolGate : finalReview.protocolGate;
  const recommendation = gate && gate.recommendation ? gate.recommendation : finalReview.recommendation || deriveRecommendation(protocolGate, issueSummary);
  const runCommand = formatRunCommand(runDir);

  const lines = [
    `# ${reviewTitle(protocolGate, issueSummary)}`,
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
    '',
    '## 问题',
    findings.length === 0 ? '- 无' : null,
  ].filter((line) => line !== null);
  appendFindingLines(lines, findings);
  lines.push(
    '',
    '## 报告',
    `- 完整报告：${formatMarkdownFileLink('final.md', finalMdPath)}`,
    `- 事实源：${formatMarkdownFileLink('finalReview.json', finalReviewPath)}`,
    `- 分派源：${formatMarkdownFileLink('dispatch.json', dispatchPath)}`,
    '',
    '## 执行计划',
    ...formatExecutionPlanLines(executionPlan),
    '',
    '## 验证',
    `- \`${runCommand}\`：协议校验成功`,
    '',
  );
  return lines.join('\n');
}

function appendFindingLines(lines, findings) {
  const groups = [
    ['must_fix', '必须修复'],
    ['should_fix', '建议修复'],
  ];
  groups.forEach(([priority, title]) => {
    const items = findings.filter((finding) => finding && finding.priority === priority);
    if (items.length === 0) return;
    lines.push(`### ${title}`);
    items.forEach((finding) => {
      const reason = finding.priorityReason ? `；原因：${finding.priorityReason}` : '';
      lines.push(`- ${finding.findingId} | ${finding.reviewItemId} | ${finding.ruleRef} | ${finding.ruleLevel} | ${label(finding.origin)} | ${finding.targetId}：${formatEvidence(finding.evidence)}${reason}`);
    });
  });
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
    requireFields(item, artifact, result, 'FR037', `/cannotVerifyItems/${index}`, ['reviewItemId', 'ruleRef', 'targetId', 'reason']);
    if (!REVIEW_ITEM_RE.test(item && item.reviewItemId)) addViolation(result, 'FR057', artifact, `/cannotVerifyItems/${index}/reviewItemId`, 'cannotVerify item reviewItemId must match RIxxx', 'RIxxx', item && item.reviewItemId);
    if (!isNonEmptyString(item && item.ruleRef)) addViolation(result, 'FR038', artifact, `/cannotVerifyItems/${index}/ruleRef`, 'cannotVerify item ruleRef must be non-empty string', 'string', item && item.ruleRef);
    if (!isNonEmptyString(item && item.targetId)) addViolation(result, 'FR039', artifact, `/cannotVerifyItems/${index}/targetId`, 'cannotVerify item targetId must be non-empty string', 'string', item && item.targetId);
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

function findingItemsEqual(left, right) {
  return unorderedItemsEqual(left, right, findingItemEqual);
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
  const fields = ['findingId', 'reviewItemId', 'ruleRef', 'targetId', 'ruleLevel', 'origin', 'priority', 'priorityReason', 'upgradeReason', 'originReason'];
  return fields.every((field) => optionalField(left, field) === optionalField(right, field))
    && evidenceArraysEqual(left && left.evidence, right && right.evidence)
    && acceptedRiskEqual(left && left.acceptedRisk, right && right.acceptedRisk);
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

function acceptedRiskEqual(left, right) {
  if (left === undefined && right === undefined) return true;
  if (!isObject(left) || !isObject(right)) return false;
  return ['status', 'acceptedBy', 'scope', 'reason', 'expiresAt', 'followUp'].every((field) => optionalField(left, field) === optionalField(right, field));
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
  const targets = dispatch && dispatch.targets ? dispatch.targets : {};
  const validation = getRunValidationSummary(finalReview);
  return [
    `- runId：${finalReview.runId || '未知'}`,
    `- ruleSetId：${ruleSet.ruleSetId || '未知'}`,
    `- sourceIndexHash：${ruleSet.sourceIndexHash || '未知'}`,
    `- candidateRuleRefs：${asArray(ruleSet.candidateRuleRefs).length}`,
    `- requiredRuleRefs：${asArray(ruleSet.requiredRuleRefs).length}`,
    `- excludedRuleRefs：${asArray(ruleSet.excludedRuleRefs).length}`,
    `- globallyNotApplicableRuleRefs：${asArray(ruleSet.globallyNotApplicableRuleRefs).length}`,
    `- changedUnits：${asArray(targets.changedUnits).length}`,
    `- candidates：${asArray(targets.candidates).length}`,
    `- contextExpansions：${asArray(targets.contextExpansions).length}`,
    `- applicabilityMatrix：${asArray(dispatch && dispatch.applicabilityMatrix).length}`,
    `- reviewItems：${asArray(dispatch && dispatch.reviewItems).length}`,
    `- reviewBatches：${asArray(dispatch && dispatch.reviewBatches).length}`,
    `- 验证命令：\`${formatRunCommand(runDir)}\``,
    `- 验证摘要：protocolGate=${validation.protocolGate || '未知'}，semanticVerdict=${validation.semanticVerdict || '未知'}，findings=${formatMetric(validation.issueSummary && validation.issueSummary.findings)}，mustFix=${formatMetric(validation.issueSummary && validation.issueSummary.mustFix)}，shouldFix=${formatMetric(validation.issueSummary && validation.issueSummary.shouldFix)}，cannotVerify=${formatMetric(validation.issueSummary && validation.issueSummary.cannotVerify)}，observations=${formatMetric(validation.issueSummary && validation.issueSummary.observations)}，recommendation=${validation.recommendation || '未知'}`,
  ];
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

function reviewConclusion(protocolGate, issueSummary) {
  if (protocolGate === 'incomplete') return '审查未完成';
  if (protocolGate === 'blocked') return '审查阻塞';
  if (issueSummary.findings > 0) return '发现问题';
  if (issueSummary.cannotVerify > 0) return '未发现明确问题';
  return '未发现问题';
}

function formatExecutionMode(mode) {
  if (mode === 'single_batch') return 'single_batch';
  if (mode === 'multi_batch') return 'multi_batch';
  return String(mode || '未知');
}

function formatExecutionPlanLines(executionPlan) {
  if (!isObject(executionPlan)) return ['- 未记录'];
  const metrics = isObject(executionPlan.metrics) ? executionPlan.metrics : {};
  const signals = isObject(executionPlan.signals) ? executionPlan.signals : {};
  const lines = [
    `- mode：${formatExecutionMode(executionPlan.mode)}`,
    `- selectedBy：${executionPlan.selectedBy || '未知'}`,
    `- policyVersion：${executionPlan.policyVersion || '未知'}`,
    `- metrics：changedUnits=${formatMetric(metrics.changedUnits)}，candidates=${formatMetric(metrics.candidates)}，targets=${formatMetric(metrics.targets)}，requiredRuleRefs=${formatMetric(metrics.requiredRuleRefs)}，reviewItems=${formatMetric(metrics.reviewItems)}`,
    `- userRequestedConcurrency：${signals.userRequestedConcurrency === true ? 'true' : 'false'}`,
    `- reason：${executionPlan.reason || '未记录'}`,
  ];
  if (isObject(executionPlan.humanOverride)) {
    lines.push(`- humanOverride：requestedMode=${executionPlan.humanOverride.requestedMode || '未知'}，risk=${executionPlan.humanOverride.risk || '未记录'}`);
  }
  return lines;
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

function escapeTableCell(value) {
  return String(value || '').replace(/\|/g, '\\|').replace(/\n/g, '<br>');
}

main();
