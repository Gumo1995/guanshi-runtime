"use strict";

const {
  buildRuleSubjectKey,
  isMemoryRuleSupported,
  normalizeRuleTopic,
  stableHash,
  validateMemoryRule,
} = require("./ai-memory-rule-registry");

const MEMORY_POLICY_VERSION = "memory-policy-v2";
const MEMORY_TYPES = new Set(["profile", "principle", "habit", "boundary", "preference", "rule", "playbook", "review"]);
const LEGACY_MEMORY_TYPES = new Set([...MEMORY_TYPES, "capability_request"]);
const MEMORY_STRENGTHS = new Set(["hard", "soft", "observed"]);
const MATCH_MODES = new Set(["global", "any", "all"]);
const MEMORY_OPERATION_INTENTS = new Set(["create", "update", "replace"]);
const SUBJECT_KEY_PATTERN = /^[a-z0-9][a-z0-9_.-]{2,159}$/;

function normalizeText(value, maxLength = 4000) {
  return String(value || "").trim().slice(0, maxLength);
}

function normalizeStringList(value, maxItems = 16, maxLength = 100) {
  const source = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  return Array.from(new Set(source
    .filter((item) => ["string", "number", "boolean"].includes(typeof item))
    .map((item) => normalizeText(item, maxLength))
    .filter((item) => item && item !== "[object Object]")))
    .slice(0, maxItems);
}

function normalizeIsoDate(value) {
  const text = normalizeText(value, 40);
  if (!text) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const [year, month, day] = text.split("-").map((item) => Number.parseInt(item, 10));
    const parsedDate = new Date(Date.UTC(year, month - 1, day));
    if (
      parsedDate.getUTCFullYear() !== year
      || parsedDate.getUTCMonth() + 1 !== month
      || parsedDate.getUTCDate() !== day
    ) return "";
    return text;
  }
  const parsed = new Date(text);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : "";
}

function normalizeConfidence(value) {
  if (value === "" || value === undefined || value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : null;
}

function normalizeMatch(rawMatch = {}) {
  const source = rawMatch && typeof rawMatch === "object" && !Array.isArray(rawMatch) ? rawMatch : {};
  const result = {};
  for (const [key, maxItems, maxLength] of [
    ["keywords", 12, 80],
    ["taskType", 8, 80],
    ["project", 8, 120],
    ["category", 8, 80],
    ["timeHint", 8, 80],
  ]) {
    const rawValues = key === "keywords"
      ? [
        source.keywords,
        source.keyword,
        source.tags,
        source.titleContains,
        source.titleIncludes,
        source.textContains,
        source.contains,
      ].flatMap((item) => Array.isArray(item) ? item : item === undefined || item === null ? [] : [item])
      : source[key];
    const values = normalizeStringList(rawValues, maxItems, maxLength)
      .filter((item) => key !== "keywords" || !/^\d+(?:\.\d+)?(?:分钟|小时)?$/i.test(item));
    if (values.length) result[key] = values;
  }
  return result;
}

function hasMatch(match) {
  return Object.values(match || {}).some((value) => Array.isArray(value) && value.length > 0);
}

function deriveSubjectKey(source = {}) {
  const fromRule = buildRuleSubjectKey(source.rule, source);
  if (fromRule) return fromRule;
  const explicit = normalizeText(source.subjectKey, 160).toLowerCase();
  if (SUBJECT_KEY_PATTERN.test(explicit)) return explicit;
  const type = LEGACY_MEMORY_TYPES.has(source.type) ? source.type : "memory";
  const basis = normalizeText(source.title || source.body, 500);
  return basis ? `memory.${type}.${stableHash(basis)}` : "";
}

function getDefaultModelReadable(type) {
  return !["review", "capability_request"].includes(type);
}

function getDefaultEngineReadable(type, rule) {
  if (["review", "capability_request"].includes(type)) return false;
  return Boolean(rule && typeof rule === "object" && ["boundary", "rule", "habit"].includes(type));
}

function normalizeMemoryCandidate(input = {}, options = {}) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const type = normalizeText(source.type, 40);
  const match = normalizeMatch(source.match);
  const rule = source.rule && typeof source.rule === "object" && !Array.isArray(source.rule) ? source.rule : null;
  const defaultStrength = type === "boundary" || type === "rule" ? "hard" : type === "review" ? "observed" : "soft";
  const modelReadable = typeof source.modelReadable === "boolean" ? source.modelReadable : getDefaultModelReadable(type);
  const engineReadable = typeof source.engineReadable === "boolean" ? source.engineReadable : getDefaultEngineReadable(type, rule);
  const matchModeRaw = normalizeText(source.matchMode, 40);
  const operationIntentRaw = normalizeText(source.operationIntent || source.operation, 40).toLowerCase();
  const operationIntent = operationIntentRaw === "new" ? "create" : operationIntentRaw;
  return {
    policyVersion: normalizeText(source.policyVersion, 80) || (options.legacy ? "legacy-v1" : MEMORY_POLICY_VERSION),
    classification: normalizeText(source.classification, 80) || "long_term_memory",
    type,
    subjectKey: deriveSubjectKey({ ...source, type, rule, match }),
    title: normalizeText(source.title, 160),
    body: normalizeText(source.body, 4000),
    strength: MEMORY_STRENGTHS.has(source.strength) ? source.strength : defaultStrength,
    appliesTo: normalizeStringList(source.appliesTo, 16, 100),
    modelReadable,
    engineReadable,
    matchMode: MATCH_MODES.has(matchModeRaw) ? matchModeRaw : hasMatch(match) ? "any" : "global",
    match,
    rule,
    validFrom: normalizeIsoDate(source.validFrom),
    validUntil: normalizeIsoDate(source.validUntil),
    reviewAfter: normalizeIsoDate(source.reviewAfter),
    confidence: normalizeConfidence(source.confidence),
    operationIntent: MEMORY_OPERATION_INTENTS.has(operationIntent) ? operationIntent : "",
    targetMemoryIds: normalizeStringList(source.targetMemoryIds || source.targetMemoryId, 24, 120),
    supersedes: normalizeStringList(source.supersedes, 12, 120),
    supersededBy: normalizeText(source.supersededBy, 120),
    evidence: source.evidence && typeof source.evidence === "object" && !Array.isArray(source.evidence) ? source.evidence : {},
  };
}

function validateMemoryCandidate(input = {}, options = {}) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const candidate = normalizeMemoryCandidate(input, options);
  const errors = [];
  const warnings = [];
  const allowLegacyCapabilityRequest = options.allowLegacyCapabilityRequest === true;
  const explicitSubjectKey = normalizeText(source.subjectKey, 160).toLowerCase();
  const explicitMatchMode = normalizeText(source.matchMode, 40);
  const explicitStrength = normalizeText(source.strength, 40);
  if (!LEGACY_MEMORY_TYPES.has(candidate.type)) errors.push("type_invalid");
  if (candidate.type === "capability_request" && !allowLegacyCapabilityRequest) errors.push("capability_request_deprecated");
  if (!candidate.title) errors.push("title_required");
  if (!candidate.body) errors.push("body_required");
  if (!candidate.appliesTo.length && !["review", "capability_request"].includes(candidate.type)) errors.push("applies_to_required");
  if (explicitSubjectKey && !SUBJECT_KEY_PATTERN.test(explicitSubjectKey)) errors.push("subject_key_invalid");
  if (!SUBJECT_KEY_PATTERN.test(candidate.subjectKey)) errors.push("subject_key_invalid");
  if (explicitMatchMode && !MATCH_MODES.has(explicitMatchMode)) errors.push("match_mode_invalid");
  if (explicitStrength && !MEMORY_STRENGTHS.has(explicitStrength)) errors.push("strength_invalid");
  if (source.modelReadable !== undefined && typeof source.modelReadable !== "boolean") errors.push("model_readable_invalid");
  if (source.engineReadable !== undefined && typeof source.engineReadable !== "boolean") errors.push("engine_readable_invalid");
  for (const [field, normalizedField] of [
    ["validFrom", candidate.validFrom],
    ["validUntil", candidate.validUntil],
    ["reviewAfter", candidate.reviewAfter],
  ]) {
    if (normalizeText(source[field], 80) && !normalizedField) errors.push(`${field.replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`)}_invalid`);
  }
  if (source.confidence !== undefined && source.confidence !== null && source.confidence !== "") {
    const explicitConfidence = Number(source.confidence);
    if (!Number.isFinite(explicitConfidence) || explicitConfidence < 0 || explicitConfidence > 1) errors.push("confidence_invalid");
  }
  if (candidate.matchMode === "global" && hasMatch(candidate.match)) warnings.push("global_match_ignored");
  if (candidate.matchMode !== "global" && !hasMatch(candidate.match)) errors.push("match_required");
  if (candidate.validFrom && candidate.validUntil && candidate.validUntil < candidate.validFrom) errors.push("validity_range_invalid");
  if (candidate.strength === "hard" && !["boundary", "rule", "habit"].includes(candidate.type)) errors.push("hard_strength_not_allowed_for_type");
  if (candidate.strength === "hard" && candidate.confidence !== null && candidate.confidence < 0.8) warnings.push("hard_memory_low_confidence");
  const ruleStatus = candidate.rule ? validateMemoryRule(candidate.rule) : { known: false, valid: false, kind: "", errors: [], consumers: [] };
  if (candidate.rule && ruleStatus.known && !ruleStatus.valid) errors.push(...ruleStatus.errors.map((item) => `rule_invalid:${item}`));
  if (candidate.rule && !ruleStatus.known) warnings.push("rule_kind_unknown_model_only");
  if (candidate.engineReadable && !candidate.rule) warnings.push("engine_requested_without_rule");
  if (candidate.engineReadable && candidate.rule && ruleStatus.valid && !ruleStatus.consumers.length) warnings.push("rule_has_no_deterministic_consumer");
  return {
    candidate,
    validation: {
      status: errors.length ? "invalid" : warnings.length ? "valid_with_warnings" : "valid",
      errors,
      warnings,
    },
    effectiveModelReadable: candidate.modelReadable && getDefaultModelReadable(candidate.type),
    effectiveEngineReadable: candidate.engineReadable && Boolean(candidate.rule) && ruleStatus.valid && ruleStatus.consumers.length > 0,
    ruleStatus,
  };
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function normalizeComparableText(value) {
  return normalizeText(value, 4000).toLowerCase().replace(/[\s，。！？、；：,.!?;:'"“”‘’（）()\-_/]+/g, "");
}

function buildMemoryRelationSubjectKey(input = {}) {
  const candidate = normalizeMemoryCandidate(input);
  const fromRule = buildRuleSubjectKey(candidate.rule, candidate);
  return fromRule || candidate.subjectKey;
}

function isAmbiguousMemorySubjectKey(value) {
  const subjectKey = normalizeText(value, 160).toLowerCase();
  return !subjectKey || subjectKey === "unspecified" || subjectKey.endsWith(".unspecified");
}

function buildMemorySemanticSubjectKey(input = {}) {
  return buildMemoryRelationSubjectKey(input);
}

function hasSameMemorySubject(left, right) {
  const leftKey = buildMemoryRelationSubjectKey(left);
  const rightKey = buildMemoryRelationSubjectKey(right);
  return Boolean(leftKey && rightKey && leftKey === rightKey);
}

function actionsOverlap(left = {}, right = {}) {
  const leftActions = new Set(normalizeStringList(left.appliesTo, 16, 100));
  const rightActions = normalizeStringList(right.appliesTo, 16, 100);
  if (!leftActions.size || !rightActions.length) return true;
  return rightActions.some((action) => leftActions.has(action));
}

function normalizeScopeValue(value, dimension) {
  if (dimension === "taskType") return normalizeRuleTopic(value);
  return normalizeComparableText(value);
}

function buildMemoryScope(input = {}) {
  const candidate = normalizeMemoryCandidate(input);
  const matcher = candidate.rule?.matcher && typeof candidate.rule.matcher === "object" && !Array.isArray(candidate.rule.matcher)
    ? candidate.rule.matcher
    : {};
  const dimensions = {
    project: [candidate.match?.project, matcher.project, matcher.projects],
    taskType: [candidate.match?.taskType, matcher.taskType, matcher.taskTypes, candidate.rule?.taskType],
    category: [candidate.match?.category, matcher.category, matcher.categories, candidate.rule?.category, candidate.rule?.taskCategories],
  };
  const result = {};
  for (const [dimension, sources] of Object.entries(dimensions)) {
    const values = Array.from(new Set(sources
      .flatMap((source) => normalizeStringList(source, 12, 120))
      .map((value) => normalizeScopeValue(value, dimension))
      .filter((value) => value && value !== "unspecified")));
    if (values.length) result[dimension] = values;
  }
  return result;
}

function listsAreDisjoint(leftValues = [], rightValues = []) {
  if (!leftValues.length || !rightValues.length) return false;
  const leftSet = new Set(leftValues);
  return !rightValues.some((value) => leftSet.has(value));
}

function validityRangesOverlap(left = {}, right = {}) {
  const leftFrom = normalizeIsoDate(left.validFrom) || "0000-01-01";
  const leftUntil = normalizeIsoDate(left.validUntil) || "9999-12-31";
  const rightFrom = normalizeIsoDate(right.validFrom) || "0000-01-01";
  const rightUntil = normalizeIsoDate(right.validUntil) || "9999-12-31";
  return leftFrom <= rightUntil && rightFrom <= leftUntil;
}

function memoryScopesOverlap(left = {}, right = {}) {
  if (!actionsOverlap(left, right) || !validityRangesOverlap(left, right)) return false;
  const leftScope = buildMemoryScope(left);
  const rightScope = buildMemoryScope(right);
  const leftProjects = leftScope.project || [];
  const rightProjects = rightScope.project || [];
  if (Boolean(leftProjects.length) !== Boolean(rightProjects.length)) return false;
  for (const dimension of ["project", "taskType", "category"]) {
    if (listsAreDisjoint(leftScope[dimension], rightScope[dimension])) return false;
  }
  return true;
}

function buildRuleEffectSignature(input = {}) {
  const candidate = normalizeMemoryCandidate(input);
  const rule = candidate.rule || null;
  const kind = normalizeText(rule?.kind, 80);
  if (!rule) return `body:${normalizeComparableText(candidate.body)}`;
  if (kind === "task_duration_estimate") {
    return canonicalJson({ kind, subject: buildRuleSubjectKey(rule), estimatedMinutes: Number(rule.estimatedMinutes) || null });
  }
  if (kind === "no_work_after") return canonicalJson({ kind, time: normalizeText(rule.time, 20) });
  if (kind === "fixed_break") return canonicalJson({ kind, start: normalizeText(rule.start, 20), end: normalizeText(rule.end, 20) });
  if (kind === "prefer_task_type_window") {
    return canonicalJson({ kind, taskType: normalizeRuleTopic(rule.taskType), start: normalizeText(rule.start, 20), end: normalizeText(rule.end, 20) });
  }
  if (kind === "workflow_playbook") {
    return canonicalJson({ kind, trigger: normalizeComparableText(rule.trigger), steps: normalizeStringList(rule.steps, 24, 160).map(normalizeComparableText) });
  }
  return canonicalJson(rule);
}

function buildScopeSignature(input = {}) {
  const candidate = normalizeMemoryCandidate(input);
  return canonicalJson({
    appliesTo: [...candidate.appliesTo].sort(),
    scope: buildMemoryScope(candidate),
    validFrom: candidate.validFrom,
    validUntil: candidate.validUntil,
  });
}

function memoryScopesEqual(left = {}, right = {}) {
  return buildScopeSignature(left) === buildScopeSignature(right);
}

function memoriesAreExactDuplicates(left = {}, right = {}) {
  return hasSameMemorySubject(left, right)
    && buildRuleEffectSignature(left) === buildRuleEffectSignature(right)
    && buildScopeSignature(left) === buildScopeSignature(right);
}

function analyzeMemoryRelation(candidateInput = {}, entries = []) {
  const candidate = normalizeMemoryCandidate(candidateInput);
  const relationSubjectKey = buildMemoryRelationSubjectKey(candidate);
  const ambiguousSubject = isAmbiguousMemorySubjectKey(relationSubjectKey);
  const related = (Array.isArray(entries) ? entries : [])
    .filter((entry) => entry?.status === "active")
    .filter((entry) => !entry.supersededBy)
    .filter((entry) => !ambiguousSubject && hasSameMemorySubject(candidate, entry));
  const baseRelation = {
    policyVersion: "memory-relation-v2.2",
    subjectKey: relationSubjectKey,
    operationIntent: candidate.operationIntent,
    subjectResolved: !ambiguousSubject,
  };
  const summarizeRelated = (items) => items.map((entry) => ({ id: entry.id, title: normalizeText(entry.title, 160) }));
  if (ambiguousSubject) {
    const kind = ["update", "replace"].includes(candidate.operationIntent) ? "unresolved_update" : "new";
    return {
      ...baseRelation,
      kind,
      relatedMemoryIds: [],
      relatedMemories: [],
      resolutionRequired: kind === "unresolved_update",
      reason: "subject_unresolved",
    };
  }
  if (!related.length) {
    const kind = ["update", "replace"].includes(candidate.operationIntent) ? "unresolved_update" : "new";
    return { ...baseRelation, kind, relatedMemoryIds: [], relatedMemories: [], resolutionRequired: kind === "unresolved_update" };
  }
  const exact = related.filter((entry) => memoriesAreExactDuplicates(entry, candidate));
  if (exact.length) {
    const exactSorted = [...exact].sort((left, right) => String(left.id).localeCompare(String(right.id)));
    return { ...baseRelation, kind: "duplicate", relatedMemoryIds: exactSorted.map((entry) => entry.id), relatedMemories: summarizeRelated(exactSorted), resolutionRequired: false };
  }
  const overlapping = related.filter((entry) => memoryScopesOverlap(entry, candidate));
  if (!overlapping.length) {
    const relatedSorted = [...related].sort((left, right) => String(left.id).localeCompare(String(right.id)));
    return { ...baseRelation, kind: "parallel", relatedMemoryIds: relatedSorted.map((entry) => entry.id), relatedMemories: summarizeRelated(relatedSorted), resolutionRequired: false };
  }
  const explicitTargetIds = new Set([...candidate.supersedes, ...candidate.targetMemoryIds]);
  const explicitUpdates = overlapping.filter((entry) => explicitTargetIds.has(entry.id));
  if (explicitUpdates.length) {
    const kind = explicitUpdates.length === 1 && overlapping.length === 1 ? "update" : "conflict";
    const overlappingSorted = [...overlapping].sort((left, right) => String(left.id).localeCompare(String(right.id)));
    return { ...baseRelation, kind, relatedMemoryIds: overlappingSorted.map((entry) => entry.id), relatedMemories: summarizeRelated(overlappingSorted), resolutionRequired: kind === "conflict" };
  }
  if (
    overlapping.length === 1
    && candidate.operationIntent !== "create"
    && (candidate.operationIntent === "update" || candidate.operationIntent === "replace" || memoryScopesEqual(overlapping[0], candidate))
  ) {
    return { ...baseRelation, kind: "update", relatedMemoryIds: [overlapping[0].id], relatedMemories: summarizeRelated([overlapping[0]]), resolutionRequired: false };
  }
  const overlappingSorted = [...overlapping].sort((left, right) => String(left.id).localeCompare(String(right.id)));
  return { ...baseRelation, kind: "conflict", relatedMemoryIds: overlappingSorted.map((entry) => entry.id), relatedMemories: summarizeRelated(overlappingSorted), resolutionRequired: true };
}

function getMemoryValidity(entry = {}, nowValue = new Date().toISOString()) {
  const normalizedNow = normalizeIsoDate(nowValue) || new Date().toISOString();
  const now = /^\d{4}-\d{2}-\d{2}$/.test(normalizedNow) ? `${normalizedNow}T12:00:00.000Z` : normalizedNow;
  const validFrom = normalizeIsoDate(entry.validFrom);
  const validUntil = normalizeIsoDate(entry.validUntil);
  const reviewAfter = normalizeIsoDate(entry.reviewAfter);
  const validFromBoundary = /^\d{4}-\d{2}-\d{2}$/.test(validFrom) ? `${validFrom}T00:00:00.000Z` : validFrom;
  const validUntilBoundary = /^\d{4}-\d{2}-\d{2}$/.test(validUntil) ? `${validUntil}T23:59:59.999Z` : validUntil;
  const reviewBoundary = /^\d{4}-\d{2}-\d{2}$/.test(reviewAfter) ? `${reviewAfter}T00:00:00.000Z` : reviewAfter;
  if (validFromBoundary && now < validFromBoundary) return { status: "not_started", reviewDue: false };
  if (validUntilBoundary && now > validUntilBoundary) return { status: "expired", reviewDue: false };
  return { status: "valid", reviewDue: Boolean(reviewBoundary && now >= reviewBoundary) };
}

function getEffectiveEngineStatus(entry = {}, target = "scheduler") {
  if (entry.engineReadable === false) return { effective: false, reason: "engine_read_disabled" };
  if (!entry.rule) return { effective: false, reason: "rule_not_projectable" };
  const result = validateMemoryRule(entry.rule);
  if (!result.known) return { effective: false, reason: "rule_kind_unknown" };
  if (!result.valid) return { effective: false, reason: "rule_invalid" };
  if (!isMemoryRuleSupported(entry.rule, target)) return { effective: false, reason: "rule_target_unsupported" };
  return { effective: true, reason: "supported" };
}

module.exports = {
  LEGACY_MEMORY_TYPES,
  MATCH_MODES,
  MEMORY_POLICY_VERSION,
  MEMORY_OPERATION_INTENTS,
  MEMORY_STRENGTHS,
  MEMORY_TYPES,
  analyzeMemoryRelation,
  buildMemoryRelationSubjectKey,
  buildMemorySemanticSubjectKey,
  buildMemoryScope,
  canonicalJson,
  deriveSubjectKey,
  getDefaultModelReadable,
  getEffectiveEngineStatus,
  getMemoryValidity,
  isAmbiguousMemorySubjectKey,
  memoriesAreExactDuplicates,
  memoryScopesEqual,
  memoryScopesOverlap,
  normalizeMemoryCandidate,
  validateMemoryCandidate,
};
