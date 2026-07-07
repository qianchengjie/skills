#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const MODES = new Set([
  'dispatch',
  'task',
  'retry-task',
  'shard',
  'final-review',
  'render-final',
  'render-response',
  'final-md',
  'run',
]);

const SCHEMA_VERSION = 2;
const RETURN_STATUSES = ['not_started', 'started', 'returned', 'not_returned', 'format_invalid', 'untrusted'];
const AGGREGATE_STATUSES = ['aggregated', 'not_aggregated'];
const RESULT_STATUSES = ['passed', 'finding', 'not_applicable', 'cannot_verify'];
const PROTOCOL_GATES = ['passed', 'incomplete', 'blocked'];
const SCOPE_MODES = ['full', 'scoped'];
const COVERAGE_CLAIMS = ['full_complete', 'scoped_complete', 'incomplete', 'blocked'];
const SEMANTIC_VERDICTS = ['clean', 'issues', 'unknown'];
const REVIEW_ITEM_RE = /^RI\d{3}$/;
const FINDING_RE = /^F\d{3}$/;

const LABELS = {
  passed: '通过',
  incomplete: '未完成',
  blocked: '阻断',
  full: '完整范围',
  scoped: '限定范围',
  full_complete: '完整完成',
  scoped_complete: '限定范围完成',
  clean: '未发现问题',
  issues: '发现问题',
  unknown: '未知',
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
  const artifact = args.dir || args.input || args.output || null;
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
  requireFields(dispatch, artifact, result, 'D004', '', ['kind', 'schemaVersion', 'runId', 'ruleSet', 'targets', 'reviewItems', 'reviewBatches']);
  if (!isNonEmptyString(dispatch.runId)) addViolation(result, 'D005', artifact, '/runId', 'runId must be non-empty string', 'string', dispatch.runId);

  const ruleSet = validateRuleSet(dispatch.ruleSet, artifact, result);
  const targets = validateTargets(dispatch.targets, artifact, result);
  const reviewItems = validateReviewItems(dispatch.reviewItems, ruleSet, targets, artifact, result);
  validateReviewBatches(dispatch.reviewBatches, ruleSet, reviewItems, artifact, result);
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

  const ruleSourcesByRuleRef = new Map();
  if (!Array.isArray(ruleSet.ruleSources)) {
    addViolation(result, 'D024', artifact, '/ruleSet/ruleSources', 'ruleSources must be array', 'array', ruleSet.ruleSources);
  } else {
    ruleSet.ruleSources.forEach((source, index) => {
      const pointer = `/ruleSet/ruleSources/${index}`;
      requireFields(source, artifact, result, 'D025', pointer, ['namespace', 'ruleRef', 'sourceFile', 'sourceHash', 'trigger', 'appliesTo']);
      if (!isNonEmptyString(source && source.namespace)) addViolation(result, 'D026', artifact, `${pointer}/namespace`, 'namespace must be non-empty string', 'string', source && source.namespace);
      if (!isNonEmptyString(source && source.ruleRef)) addViolation(result, 'D027', artifact, `${pointer}/ruleRef`, 'ruleRef must be non-empty string', 'string', source && source.ruleRef);
      if (!isNonEmptyString(source && source.sourceFile)) addViolation(result, 'D028', artifact, `${pointer}/sourceFile`, 'sourceFile must be non-empty string', 'string', source && source.sourceFile);
      if (!isNonEmptyString(source && source.sourceHash)) addViolation(result, 'D029', artifact, `${pointer}/sourceHash`, 'sourceHash is required', 'non-empty hash', source && source.sourceHash);
      if (!candidateRuleRefs.has(source && source.ruleRef)) addViolation(result, 'D030', artifact, `${pointer}/ruleRef`, 'ruleSources[].ruleRef must be in candidateRuleRefs', Array.from(candidateRuleRefs), source && source.ruleRef);
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
    }
    if (item && item.reviewItemId) itemMap.set(item.reviewItemId, item);
  });
  return itemMap;
}

function validateReviewBatches(reviewBatches, ruleSet, reviewItems, artifact, result) {
  if (!Array.isArray(reviewBatches)) {
    addViolation(result, 'D080', artifact, '/reviewBatches', 'reviewBatches must be array', 'array', reviewBatches);
    return;
  }
  const batchIds = new Set();
  reviewBatches.forEach((batch, index) => {
    const pointer = `/reviewBatches/${index}`;
    requireFields(batch, artifact, result, 'D081', pointer, ['reviewBatchId', 'ruleSetId', 'reviewItemIds', 'taskRef', 'returnStatus', 'aggregateStatus']);
    if (!isNonEmptyString(batch && batch.reviewBatchId)) addViolation(result, 'D082', artifact, `${pointer}/reviewBatchId`, 'reviewBatchId must be non-empty string', 'string', batch && batch.reviewBatchId);
    if (batchIds.has(batch && batch.reviewBatchId)) addViolation(result, 'D083', artifact, `${pointer}/reviewBatchId`, 'reviewBatchId must be unique', 'unique batch id', batch && batch.reviewBatchId);
    if (batch && batch.reviewBatchId) batchIds.add(batch.reviewBatchId);
    if (batch && batch.ruleSetId !== ruleSet.ruleSetId) addViolation(result, 'D084', artifact, `${pointer}/ruleSetId`, 'reviewBatch.ruleSetId must match ruleSet.ruleSetId', ruleSet.ruleSetId, batch.ruleSetId);
    validateStringSet(batch && batch.reviewItemIds, artifact, result, 'D085', `${pointer}/reviewItemIds`);
    asArray(batch && batch.reviewItemIds).forEach((reviewItemId, itemIndex) => {
      if (!reviewItems.has(reviewItemId)) addViolation(result, 'D086', artifact, `${pointer}/reviewItemIds/${itemIndex}`, 'reviewBatch reviewItemIds must exist in reviewItems', Array.from(reviewItems.keys()), reviewItemId);
    });
    if (!isNonEmptyString(batch && batch.taskRef)) addViolation(result, 'D087', artifact, `${pointer}/taskRef`, 'taskRef must be non-empty string', 'string', batch && batch.taskRef);
    if (!RETURN_STATUSES.includes(batch && batch.returnStatus)) addViolation(result, 'D088', artifact, `${pointer}/returnStatus`, 'returnStatus must be valid', RETURN_STATUSES, batch && batch.returnStatus);
    if (!AGGREGATE_STATUSES.includes(batch && batch.aggregateStatus)) addViolation(result, 'D089', artifact, `${pointer}/aggregateStatus`, 'aggregateStatus must be valid', AGGREGATE_STATUSES, batch && batch.aggregateStatus);
    if (batch && batch.aggregateStatus === 'aggregated' && batch.returnStatus !== 'returned') {
      addViolation(result, 'D090', artifact, pointer, 'aggregated reviewBatch must have returnStatus returned', 'returned', batch.returnStatus);
    }
  });
}

function validateTask(task, artifact, result) {
  expectKind(task, artifact, result, 'T002', 'rules-review-task');
  validateSchemaVersion(task, artifact, result, 'T003');
  requireFields(task, artifact, result, 'T004', '', ['kind', 'schemaVersion', 'runId', 'reviewBatchId', 'ruleSetId', 'reviewItems', 'rules', 'targets', 'outputContract']);
  if (!Array.isArray(task.reviewItems)) addViolation(result, 'T005', artifact, '/reviewItems', 'reviewItems must be array', 'array', task.reviewItems);
  if (!Array.isArray(task.rules)) addViolation(result, 'T006', artifact, '/rules', 'rules must be array', 'array', task.rules);
  if (!Array.isArray(task.targets)) addViolation(result, 'T007', artifact, '/targets', 'targets must be array', 'array', task.targets);

  asArray(task.reviewItems).forEach((item, index) => {
    const pointer = `/reviewItems/${index}`;
    requireFields(item, artifact, result, 'T008', pointer, ['reviewItemId', 'ruleRef', 'targetKind', 'targetId', 'required']);
    if (!REVIEW_ITEM_RE.test(item && item.reviewItemId)) addViolation(result, 'T009', artifact, `${pointer}/reviewItemId`, 'reviewItemId must match RIxxx', 'RIxxx', item && item.reviewItemId);
  });
  asArray(task.rules).forEach((rule, index) => {
    const pointer = `/rules/${index}`;
    requireFields(rule, artifact, result, 'T010', pointer, ['namespace', 'ruleRef', 'sourceFile', 'sourceHash', 'trigger', 'appliesTo']);
    if (!isNonEmptyString(rule && rule.sourceHash)) addViolation(result, 'T011', artifact, `${pointer}/sourceHash`, 'sourceHash is required', 'non-empty hash', rule && rule.sourceHash);
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
  const taskItemIds = new Set(asArray(task && task.reviewItems).map((item) => item.reviewItemId));
  const seen = new Set();
  shard.results.forEach((reviewResult, index) => {
    const pointer = `/results/${index}`;
    validateReviewResult(reviewResult, artifact, result, pointer, 'S');
    if (seen.has(reviewResult && reviewResult.reviewItemId)) {
      addViolation(result, 'S020', artifact, `${pointer}/reviewItemId`, 'reviewItem has duplicate results in shard', 'one result per reviewItemId', reviewResult && reviewResult.reviewItemId);
    }
    if (reviewResult && reviewResult.reviewItemId) seen.add(reviewResult.reviewItemId);
    if (task && !taskItemIds.has(reviewResult && reviewResult.reviewItemId)) {
      addViolation(result, 'S021', artifact, `${pointer}/reviewItemId`, 'result must reference assigned reviewItemId', Array.from(taskItemIds), reviewResult && reviewResult.reviewItemId);
    }
  });
}

function validateReviewResult(reviewResult, artifact, result, pointer, prefix) {
  requireFields(reviewResult, artifact, result, `${prefix}010`, pointer, ['reviewItemId', 'status']);
  if (!REVIEW_ITEM_RE.test(reviewResult && reviewResult.reviewItemId)) addViolation(result, `${prefix}011`, artifact, `${pointer}/reviewItemId`, 'reviewItemId must match RIxxx', 'RIxxx', reviewResult && reviewResult.reviewItemId);
  if (!RESULT_STATUSES.includes(reviewResult && reviewResult.status)) addViolation(result, `${prefix}012`, artifact, `${pointer}/status`, 'result status must be valid', RESULT_STATUSES, reviewResult && reviewResult.status);

  if (reviewResult && reviewResult.status === 'finding') {
    if (!FINDING_RE.test(reviewResult.findingId)) addViolation(result, `${prefix}013`, artifact, `${pointer}/findingId`, 'finding result requires findingId and evidence', 'Fxxx', reviewResult.findingId);
    if (!isNonEmptyArray(reviewResult.evidence)) addViolation(result, `${prefix}014`, artifact, `${pointer}/evidence`, 'finding result requires findingId and evidence', 'non-empty evidence[]', reviewResult.evidence);
  }
  if (reviewResult && reviewResult.status === 'passed' && !isNonEmptyArray(reviewResult.evidence)) {
    addViolation(result, `${prefix}015`, artifact, `${pointer}/evidence`, 'passed result requires evidence', 'non-empty evidence[]', reviewResult.evidence);
  }
  if (reviewResult && reviewResult.status === 'not_applicable' && !isNonEmptyString(reviewResult.reason)) {
    addViolation(result, `${prefix}016`, artifact, `${pointer}/reason`, 'not_applicable result requires reason', 'non-empty reason', reviewResult.reason);
  }
  if (reviewResult && reviewResult.status === 'cannot_verify' && !isNonEmptyString(reviewResult.reason) && !isNonEmptyArray(reviewResult.evidence)) {
    addViolation(result, `${prefix}017`, artifact, pointer, 'cannot_verify result requires reason or evidence', 'reason or evidence[]', reviewResult);
  }
}

function validateRun(runDir, result) {
  if (!runDir || runDir === true) {
    addViolation(result, 'RUN001', null, '/dir', 'run mode requires --dir', 'run directory', runDir || null, 2);
    return;
  }

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
    validateFinalMarkdown(finalReview, finalMdPath, result);
  }
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
      addViolation(result, 'RUN011', rel(runDir, 'dispatch.json'), batchPointer, 'reviewBatch was not returned and aggregated', 'returned + aggregated', {
        returnStatus: batch.returnStatus,
        aggregateStatus: batch.aggregateStatus,
      }, 1, 'incomplete');
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
  });
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
  return { protocolGate, scopeMode, coverageClaim, semanticVerdict };
}

function deriveSemanticVerdict(results, protocolGate) {
  if (asArray(results).some((reviewResult) => reviewResult && reviewResult.status === 'finding')) return 'issues';
  if (asArray(results).some((reviewResult) => reviewResult && reviewResult.status === 'cannot_verify')) return 'unknown';
  if (protocolGate === 'passed') return 'clean';
  return 'unknown';
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
    'validationResults',
  ]);
  if (!PROTOCOL_GATES.includes(finalReview.protocolGate)) addViolation(result, 'FR005', artifact, '/protocolGate', 'protocolGate must be valid', PROTOCOL_GATES, finalReview.protocolGate);
  if (!SCOPE_MODES.includes(finalReview.scopeMode)) addViolation(result, 'FR006', artifact, '/scopeMode', 'scopeMode must be valid', SCOPE_MODES, finalReview.scopeMode);
  if (!COVERAGE_CLAIMS.includes(finalReview.coverageClaim)) addViolation(result, 'FR007', artifact, '/coverageClaim', 'coverageClaim must be valid', COVERAGE_CLAIMS, finalReview.coverageClaim);
  if (!SEMANTIC_VERDICTS.includes(finalReview.semanticVerdict)) addViolation(result, 'FR008', artifact, '/semanticVerdict', 'semanticVerdict must be valid', SEMANTIC_VERDICTS, finalReview.semanticVerdict);
  validateStringSet(finalReview.excludedRuleRefs, artifact, result, 'FR009', '/excludedRuleRefs');
  if (!Array.isArray(finalReview.findings)) addViolation(result, 'FR010', artifact, '/findings', 'findings must be array', 'array', finalReview.findings);
  if (!Array.isArray(finalReview.validationResults)) addViolation(result, 'FR011', artifact, '/validationResults', 'validationResults must be array', 'array', finalReview.validationResults);
  asArray(finalReview.findings).forEach((finding, index) => {
    requireFields(finding, artifact, result, 'FR012', `/findings/${index}`, ['findingId', 'reviewItemId', 'ruleRef', 'targetId', 'evidence']);
    if (!isNonEmptyArray(finding && finding.evidence)) addViolation(result, 'FR013', artifact, `/findings/${index}/evidence`, 'final finding requires evidence[]', 'non-empty evidence[]', finding && finding.evidence);
  });
  asArray(finalReview.validationResults).forEach((validation, index) => {
    if (validation && validation.ok === false) addViolation(result, 'FR014', artifact, `/validationResults/${index}`, 'finalReview.validationResults contains failed validation', 'all ok or omitted failure', validation);
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
  } else if (![derivedSemantic, 'unknown'].includes(finalReview.semanticVerdict)) {
    addViolation(result, 'FR028', artifact, '/semanticVerdict', 'incomplete or blocked semanticVerdict can only be unknown or derived from legal results', [derivedSemantic, 'unknown'], finalReview.semanticVerdict);
  }

  const resultFindings = asArray(results).filter((reviewResult) => reviewResult && reviewResult.status === 'finding');
  const finalFindings = asArray(finalReview.findings);
  resultFindings.forEach((finding) => {
    const matched = finalFindings.some((entry) => entry.findingId === finding.findingId && entry.reviewItemId === finding.reviewItemId);
    if (!matched) addViolation(result, 'FR029', artifact, '/findings', 'finding result must appear in finalReview.findings[]', { findingId: finding.findingId, reviewItemId: finding.reviewItemId }, finalFindings);
  });
}

function renderFinalMode(args, result) {
  const finalReview = readJson(args.input, args.input, result, 'FR001');
  if (!finalReview) return;
  if (!args.output || args.output === true) {
    addViolation(result, 'EXEC004', null, '/output', 'render-final requires --output', 'output path', args.output || null, 2);
    return;
  }
  const markdown = renderFinalMarkdown(finalReview);
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
  const finalReview = readJson(finalReviewPath, rel(runDir, finalReviewPath), result, 'FR001');
  if (!finalReview || result.violations.length > 0) return;

  const outputPath = !args.output || args.output === true ? path.join(runDir, 'response.md') : args.output;
  const markdown = renderResponseMarkdown(runDir, finalReview);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, markdown);
  result.rendered = outputPath;
  result.response = markdown;
}

function validateFinalMarkdownMode(args, result) {
  const finalReview = readJson(args['final-review'], args['final-review'], result, 'FR001');
  if (!finalReview) return;
  validateFinalMarkdown(finalReview, args.input, result);
}

function validateFinalMarkdown(finalReview, markdownPath, result) {
  const markdown = readText(markdownPath, markdownPath, result, 'FM001');
  if (markdown == null || !finalReview) return;
  const required = [
    label(finalReview.protocolGate),
    label(finalReview.coverageClaim),
    label(finalReview.semanticVerdict),
  ];
  required.forEach((token, index) => {
    if (!markdown.includes(token)) addViolation(result, `FM00${index + 2}`, markdownPath, null, 'final Markdown must include rendered finalReview status labels', token, markdown);
  });
}

function renderFinalMarkdown(finalReview) {
  const findings = asArray(finalReview.findings);
  const lines = [
    '**结论**',
    `协议门禁：${label(finalReview.protocolGate)}。覆盖声明：${label(finalReview.coverageClaim)}。语义结论：${label(finalReview.semanticVerdict)}。`,
    '',
    '**范围**',
    `- 范围模式：${label(finalReview.scopeMode)}`,
    `- 排除规则：${formatList(finalReview.excludedRuleRefs)}`,
    '',
    '**发现**',
    findings.length === 0 ? '- 无' : null,
  ].filter((line) => line !== null);
  findings.forEach((finding) => {
    lines.push(`- ${finding.findingId} | ${finding.reviewItemId} | ${finding.ruleRef} | ${finding.targetId}：${formatEvidence(finding.evidence)}`);
  });
  lines.push('', '**验证**', `- protocolGate：${label(finalReview.protocolGate)}`);
  asArray(finalReview.validationResults).forEach((validation) => {
    lines.push(`- ${validation.mode || 'validation'}：${validation.ok === false ? '失败' : '通过'}`);
  });
  return `${lines.join('\n')}\n`;
}

function renderResponseMarkdown(runDir, finalReview) {
  const finalMdPath = path.resolve(runDir, 'final.md');
  const finalReviewPath = path.resolve(runDir, 'finalReview.json');
  const runCommand = [
    'node',
    formatCommandPath(path.relative(process.cwd(), __filename) || __filename),
    '--mode',
    'run',
    '--dir',
    formatCommandPath(path.relative(process.cwd(), path.resolve(runDir)) || runDir),
  ].join(' ');

  return [
    '**结论**',
    `\`${label(finalReview.protocolGate)}\`。覆盖声明：\`${label(finalReview.coverageClaim)}\`；语义结论：\`${label(finalReview.semanticVerdict)}\`。`,
    '',
    '**报告**',
    `- 完整报告：${formatMarkdownFileLink('final.md', finalMdPath)}`,
    `- 事实源：${formatMarkdownFileLink('finalReview.json', finalReviewPath)}`,
    '',
    '**验证**',
    `- \`${runCommand}\`：通过`,
    '',
  ].join('\n');
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

function requireSubset(left, right, artifact, result, code, pointer, message) {
  const missing = Array.from(left).filter((item) => !right.has(item));
  if (missing.length > 0) addViolation(result, code, artifact, pointer, message, Array.from(right), missing);
}

function requireDisjoint(left, right, artifact, result, code, pointer, message) {
  const overlap = Array.from(left).filter((item) => right.has(item));
  if (overlap.length > 0) addViolation(result, code, artifact, pointer, message, 'disjoint sets', overlap);
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

main();
