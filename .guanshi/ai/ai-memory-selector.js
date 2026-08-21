"use strict";

const {
  KNOWN_MEMORY_RULE_KINDS,
  isRecognizedMemoryRule,
  isValidMemoryRule,
  normalizeRuleMatcherValues,
  normalizeRuleTopic,
} = require("./ai-memory-rule-registry");
const {
  buildMemoryRelationSubjectKey,
  buildMemoryScope,
  getDefaultModelReadable,
  getMemoryValidity,
  memoriesAreExactDuplicates,
  memoryScopesOverlap,
} = require("./ai-memory-policy");

const MEMORY_SELECTION_SCHEMA = "guanshi-ai-memory-selection-v1";

const MODEL_MEMORY_TYPES = new Set(["profile", "preference", "habit", "principle", "boundary", "rule", "playbook"]);
const EXCLUDED_MODEL_MEMORY_TYPES = new Set(["review", "capability_request"]);
const STRENGTH_ORDER = {
  hard: 3,
  soft: 2,
  observed: 1,
};
const SCHEDULE_ACTIONS = new Set(["plan_today", "plan_week", "reflow_unfinished", "schedule_draft"]);
const SCHEDULE_ACTION_ALIASES = new Set(["schedule_draft", "schedule_planning"]);
const ENGINE_RULE_KINDS = KNOWN_MEMORY_RULE_KINDS;

function normalizeText(value, maxLength = 4000) {
  return String(value || "").trim().slice(0, maxLength);
}

function normalizeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeStringList(value, maxItems = 12, maxLength = 80) {
  const source = [];
  const append = (item) => {
    if (Array.isArray(item)) {
      for (const nested of item) append(nested);
      return;
    }
    if (["string", "number", "boolean"].includes(typeof item)) source.push(item);
  };
  append(value);
  return Array.from(new Set(source
    .flatMap((item) => String(item || "").split(/[,，、/／]+/))
    .map((item) => normalizeText(item, maxLength))
    .filter((item) => item && item !== "[object Object]")))
    .slice(0, maxItems);
}

function normalizeKeywordList(value, maxItems = 12, maxLength = 80) {
  return normalizeStringList(value, maxItems, maxLength)
    .filter((item) => !/^\d+(?:\.\d+)?(?:分钟|小时)?$/i.test(item));
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeAction(value) {
  const action = normalizeText(value, 100);
  if (!action) return "";
  const parts = action.split(".");
  return parts[parts.length - 1] || action;
}

function isScheduleAction(action) {
  return SCHEDULE_ACTIONS.has(normalizeAction(action));
}

function entryAppliesToAction(entry, action) {
  const actionName = normalizeAction(action);
  if (!actionName) return true;
  const appliesTo = normalizeStringList(entry?.appliesTo, 16, 100).map(normalizeAction).filter(Boolean);
  if (!appliesTo.length) return true;
  if (appliesTo.includes(actionName)) return true;
  if (isScheduleAction(actionName) && appliesTo.some((item) => SCHEDULE_ACTION_ALIASES.has(item))) return true;
  return false;
}

function normalizeMatch(rawMatch = {}) {
  const source = normalizeObject(rawMatch);
  const keywords = normalizeKeywordList([
    source.keywords,
    source.keyword,
    source.tags,
    source.titleContains,
    source.titleIncludes,
    source.textContains,
    source.contains,
  ], 12, 80);
  const taskType = normalizeStringList(source.taskType || source.taskTypes, 8, 80);
  const project = normalizeStringList(source.project || source.projects, 8, 120);
  const category = normalizeStringList(source.category || source.categories, 8, 80);
  const timeHint = normalizeStringList(source.timeHint || source.timeHints || source.time, 8, 80);
  return {
    ...(keywords.length ? { keywords } : {}),
    ...(taskType.length ? { taskType } : {}),
    ...(project.length ? { project } : {}),
    ...(category.length ? { category } : {}),
    ...(timeHint.length ? { timeHint } : {}),
  };
}

function extractRuleMatch(rule = {}) {
  const source = normalizeObject(rule);
  const kind = normalizeText(source.kind, 80);
  if (!kind) return {};
  const matcherObject = source.matcher && typeof source.matcher === "object" && !Array.isArray(source.matcher)
    ? source.matcher
    : {};
  const match = {
    keywords: normalizeKeywordList(
      [
        normalizeRuleMatcherValues(source.matcher),
        matcherObject.keywords,
        matcherObject.keyword,
        matcherObject.titleContains,
        matcherObject.titleIncludes,
        matcherObject.textContains,
        matcherObject.contains,
        source.trigger,
        source.keyword,
      ],
      8,
      80,
    ),
    taskType: normalizeStringList(matcherObject.taskType || matcherObject.taskTypes || source.taskType || source.taskTypes, 8, 80),
    project: normalizeStringList(matcherObject.project || matcherObject.projects, 8, 120),
    category: normalizeStringList(matcherObject.category || matcherObject.categories || source.category || source.categories || source.taskCategories, 8, 80),
  };
  if (kind === "task_duration_estimate") {
    const topic = normalizeRuleTopic(source.matcher || source.taskType);
    const aliases = {
      customer_reply: ["客户回复", "回复客户", "回客户"],
      supplier_reply: ["供应商回复", "回复供应商"],
      customer_followup: ["客户回访", "回访客户"],
      customer_feedback: ["客户反馈"],
      journal_writing: ["写日记", "日记"],
      customer_communication: ["客户沟通", "沟通客户"],
    };
    if (aliases[topic]) match.keywords = [...normalizeStringList(match.keywords, 8, 80), ...aliases[topic]];
  }
  if (kind === "prefer_task_type_window" && (source.start || source.end)) {
    match.timeHint = normalizeStringList([source.start, source.end], 4, 20);
  }
  if (kind === "workflow_playbook" && normalizeText(source.trigger, 120) === "large_project_or_unclear_scope") {
    match.keywords = [...normalizeKeywordList(match.keywords, 8, 80), "复杂项目", "复杂方案", "项目推进"];
  }
  return normalizeMatch(match);
}

function mergeMatch(left = {}, right = {}) {
  return normalizeMatch({
    keywords: [...normalizeStringList(left.keywords, 12), ...normalizeStringList(right.keywords, 12)],
    taskType: [...normalizeStringList(left.taskType, 8), ...normalizeStringList(right.taskType, 8)],
    project: [...normalizeStringList(left.project, 8), ...normalizeStringList(right.project, 8)],
    category: [...normalizeStringList(left.category, 8), ...normalizeStringList(right.category, 8)],
    timeHint: [...normalizeStringList(left.timeHint, 8), ...normalizeStringList(right.timeHint, 8)],
  });
}

function normalizeEntryMatch(entry = {}) {
  const merged = mergeMatch(normalizeMatch(entry.match), extractRuleMatch(entry.rule));
  if (normalizeText(entry.rule?.kind, 80) !== "task_duration_estimate") return merged;
  const topic = normalizeRuleTopic([
    entry.rule?.matcher,
    entry.rule?.taskType,
    merged.keywords,
    entry.title,
  ]);
  const aliases = {
    customer_reply: ["客户回复", "回复客户", "回客户"],
    supplier_reply: ["供应商回复", "回复供应商"],
    customer_followup: ["客户回访", "回访客户"],
    customer_feedback: ["客户反馈"],
    journal_writing: ["写日记", "日记"],
    customer_communication: ["客户沟通", "沟通客户"],
  };
  if (!aliases[topic]) return merged;
  return mergeMatch(merged, { keywords: aliases[topic], taskType: aliases[topic] });
}

function flattenForMatch(value, maxLength = 12000) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return normalizeText(value, maxLength);
  }
  if (Array.isArray(value)) {
    return normalizeText(value.map((item) => flattenForMatch(item, maxLength)).filter(Boolean).join("\n"), maxLength);
  }
  if (typeof value === "object") {
    return normalizeText(Object.values(value).map((item) => flattenForMatch(item, maxLength)).filter(Boolean).join("\n"), maxLength);
  }
  return "";
}

function buildMatchHaystack(options = {}) {
  return [
    options.userText,
    options.request?.text,
    options.selectedObjects,
    options.pageWorkContext,
    options.globalBackgroundContext,
  ].map((item) => flattenForMatch(item, 12000)).filter(Boolean).join("\n").toLowerCase();
}

function scoreListMatches(values, haystack, label, points) {
  const normalized = normalizeStringList(values, 12, 120);
  const hits = [];
  for (const value of normalized) {
    if (!value) continue;
    if (haystack.includes(value.toLowerCase())) hits.push(value);
  }
  return {
    score: hits.length * points,
    reasons: hits.map((value) => `${label}:${value}`),
    hit: hits.length > 0,
    constrained: normalized.length > 0,
  };
}

function scoreEntryMatch(entry, options = {}, strict = true) {
  const match = normalizeEntryMatch(entry);
  const haystack = buildMatchHaystack(options);
  const reasons = [];
  let score = 0;
  if (!Object.keys(match).length) {
    return {
      score: 5,
      match,
      mode: "global",
      eligible: true,
      reasons: ["global_memory"],
    };
  }
  const declaredMode = ["global", "any", "all"].includes(entry.matchMode)
    ? entry.matchMode
    : "any";
  const conditionalGlobal = declaredMode === "global"
    && Object.keys(match).length
    && (["rule", "playbook"].includes(normalizeText(entry.type, 40)) || normalizeText(entry.rule?.kind, 80) === "task_duration_estimate");
  const mode = conditionalGlobal
    ? "any"
    : declaredMode;
  const results = [
    scoreListMatches(match.keywords, haystack, "keyword", 20),
    scoreListMatches(match.taskType, haystack, "task_type", 16),
    scoreListMatches(match.project, haystack, "project", 16),
    scoreListMatches(match.category, haystack, "category", 12),
    scoreListMatches(match.timeHint, haystack, "time_hint", 10),
  ];
  for (const result of results) {
    score += result.score;
    reasons.push(...result.reasons);
  }
  const constrained = results.filter((result) => result.constrained);
  const modeEligible = mode === "global"
    || (mode === "all" ? constrained.every((result) => result.hit) : constrained.some((result) => result.hit));
  const projectConstraint = results[2];
  const eligible = modeEligible && (!projectConstraint.constrained || projectConstraint.hit);
  if (!reasons.length) reasons.push(strict ? "match_required_not_hit" : "match_not_hit");
  return {
    score,
    match,
    mode,
    eligible: strict ? eligible : true,
    reasons,
  };
}

function getStrengthOrder(strength) {
  return STRENGTH_ORDER[normalizeText(strength, 40)] || 0;
}

function getEntryHardExclusion(entry, options = {}) {
  if (!entry || typeof entry !== "object") return "invalid_entry";
  if (entry.status !== "active") return "status_not_active";
  if (entry.userConfirmed !== true) return "not_user_confirmed";
  const modelReadable = typeof entry.modelReadable === "boolean"
    ? entry.modelReadable
    : entry.engineReadable !== false && getDefaultModelReadable(entry.type);
  if (!modelReadable) return "model_read_disabled";
  if (EXCLUDED_MODEL_MEMORY_TYPES.has(entry.type)) return "type_excluded";
  if (entry.supersededBy) return "superseded";
  const validity = getMemoryValidity(entry, options.now || new Date().toISOString());
  if (validity.status === "not_started") return "validity_not_started";
  if (validity.status === "expired") return "validity_expired";
  if (!entryAppliesToAction(entry, options.action)) return "applies_to_mismatch";
  if (options.role === "scheduler" && !isValidMemoryRule(entry.rule)) return "rule_not_projectable";
  if (!normalizeText(entry.body, 4000) && options.role !== "scheduler") return "empty_body";
  return "";
}

function buildProjectionLine(entry) {
  const type = normalizeText(entry?.type || "memory", 40);
  const strength = normalizeText(entry?.strength || "soft", 40);
  const body = normalizeText(entry?.body, 220);
  return `[${strength} ${type}] ${body}`;
}

function buildSelectedMemory(entry, scored, options = {}) {
  const role = normalizeText(options.role || "planner", 40);
  return {
    memoryId: normalizeText(entry.id, 100),
    type: normalizeText(entry.type, 40),
    title: normalizeText(entry.title || "untitled memory", 160),
    strength: normalizeText(entry.strength || "soft", 40),
    appliesTo: normalizeStringList(entry.appliesTo, 16, 100),
    body: normalizeText(entry.body, 900),
    match: scored.match,
    projection: buildProjectionLine(entry),
    score: scored.score,
    reason: scored.reasons.join(",") || "selected",
    usedBy: role,
    hasRule: isRecognizedMemoryRule(entry.rule),
    subjectKey: normalizeText(entry.subjectKey, 160),
    relationSubjectKey: buildMemoryRelationSubjectKey(entry),
    matchMode: scored.mode,
    reviewDue: getMemoryValidity(entry, options.now || new Date().toISOString()).reviewDue,
    updatedAt: normalizeText(entry.updatedAt, 80),
  };
}

function buildExcludedMemory(entry, reason, options = {}) {
  return {
    memoryId: normalizeText(entry?.id, 100),
    type: normalizeText(entry?.type, 40),
    title: normalizeText(entry?.title, 160),
    reason,
    usedBy: normalizeText(options.role || "planner", 40),
  };
}

function sortScoredEntries(left, right) {
  const scoreDiff = right.score - left.score;
  if (scoreDiff !== 0) return scoreDiff;
  const strengthDiff = getStrengthOrder(right.entry.strength) - getStrengthOrder(left.entry.strength);
  if (strengthDiff !== 0) return strengthDiff;
  return String(right.entry.updatedAt || "").localeCompare(String(left.entry.updatedAt || ""));
}

function sortCanonicalCandidates(left, right) {
  const leftUserPriority = normalizeText(left.entry.sourceKind, 40) === "user" ? 1 : 0;
  const rightUserPriority = normalizeText(right.entry.sourceKind, 40) === "user" ? 1 : 0;
  if (leftUserPriority !== rightUserPriority) return rightUserPriority - leftUserPriority;
  const createdDiff = String(left.entry.createdAt || "9999").localeCompare(String(right.entry.createdAt || "9999"));
  if (createdDiff !== 0) return createdDiff;
  return String(left.entry.id || "").localeCompare(String(right.entry.id || ""));
}

function selectMemoriesForTurn(options = {}) {
  const role = normalizeText(options.role || "planner", 40) || "planner";
  const action = normalizeAction(options.action || options.request?.intentHint || "");
  const maxItems = Math.max(1, Math.min(24, parsePositiveInt(options.maxItems, 5)));
  const entries = Array.isArray(options.entries) ? options.entries : [];
  const strict = options.policyMode !== "legacy";
  const excluded = [];
  const candidates = [];
  const governanceCandidates = [];

  for (const entry of entries) {
    const hardReason = getEntryHardExclusion(entry, { ...options, action, role });
    if (hardReason) {
      excluded.push(buildExcludedMemory(entry, hardReason, { role }));
      continue;
    }
    governanceCandidates.push({ entry });
    const matchScore = scoreEntryMatch(entry, options, strict);
    if (!matchScore.eligible) {
      excluded.push(buildExcludedMemory(entry, "match_required_not_hit", { role }));
      continue;
    }
    const score = (getStrengthOrder(entry.strength) * 10) + matchScore.score;
    candidates.push({
      entry,
      score,
      match: matchScore.match,
      reasons: matchScore.reasons,
    });
  }

  const scopeShadowed = new Set();
  const eligibleSubjectGroups = new Map();
  for (const candidate of candidates) {
    const subjectKey = buildMemoryRelationSubjectKey(candidate.entry);
    if (!subjectKey) continue;
    if (!eligibleSubjectGroups.has(subjectKey)) eligibleSubjectGroups.set(subjectKey, []);
    eligibleSubjectGroups.get(subjectKey).push(candidate);
  }
  for (const group of eligibleSubjectGroups.values()) {
    const hasProjectScopedMatch = group.some((candidate) => (buildMemoryScope(candidate.entry).project || []).length > 0);
    if (!hasProjectScopedMatch) continue;
    for (const candidate of group) {
      if (!(buildMemoryScope(candidate.entry).project || []).length) scopeShadowed.add(candidate.entry.id);
    }
  }
  if (scopeShadowed.size) {
    for (let index = candidates.length - 1; index >= 0; index -= 1) {
      const candidate = candidates[index];
      if (!scopeShadowed.has(candidate.entry.id)) continue;
      excluded.push(buildExcludedMemory(candidate.entry, "scope_shadowed", { role }));
      candidates.splice(index, 1);
    }
  }

  const subjectGroups = new Map();
  for (const candidate of candidates) {
    const subjectKey = buildMemoryRelationSubjectKey(candidate.entry);
    if (!subjectKey) continue;
    if (!subjectGroups.has(subjectKey)) subjectGroups.set(subjectKey, []);
    subjectGroups.get(subjectKey).push(candidate);
  }
  const conflicted = new Set();
  const duplicateLosers = new Set();
  const governanceGroups = new Map();
  for (const candidate of governanceCandidates) {
    const subjectKey = buildMemoryRelationSubjectKey(candidate.entry);
    if (!subjectKey) continue;
    if (!governanceGroups.has(subjectKey)) governanceGroups.set(subjectKey, []);
    governanceGroups.get(subjectKey).push(candidate);
  }
  for (const group of governanceGroups.values()) {
    if (group.length < 2) continue;
    for (let leftIndex = 0; leftIndex < group.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < group.length; rightIndex += 1) {
        const left = group[leftIndex];
        const right = group[rightIndex];
        if (!memoryScopesOverlap(left.entry, right.entry)) continue;
        if (!memoriesAreExactDuplicates(left.entry, right.entry)) {
          conflicted.add(left.entry.id);
          conflicted.add(right.entry.id);
        }
      }
    }
  }
  for (const group of subjectGroups.values()) {
    if (group.length < 2) continue;
    if (group.some((candidate) => conflicted.has(candidate.entry.id))) continue;
    const kept = [];
    for (const candidate of [...group].sort(sortCanonicalCandidates)) {
      const duplicateOfKept = kept.some((other) => (
        memoryScopesOverlap(candidate.entry, other.entry)
        && memoriesAreExactDuplicates(candidate.entry, other.entry)
      ));
      if (duplicateOfKept) duplicateLosers.add(candidate.entry.id);
      else kept.push(candidate);
    }
  }
  for (const item of excluded) {
    if (conflicted.has(item.memoryId)) item.reason = "subject_conflict";
  }
  if (conflicted.size || duplicateLosers.size) {
    for (let index = candidates.length - 1; index >= 0; index -= 1) {
      const candidate = candidates[index];
      const reason = conflicted.has(candidate.entry.id)
        ? "subject_conflict"
        : duplicateLosers.has(candidate.entry.id)
          ? "subject_duplicate"
          : "";
      if (!reason) continue;
      excluded.push(buildExcludedMemory(candidate.entry, reason, { role }));
      candidates.splice(index, 1);
    }
  }

  candidates.sort(sortScoredEntries);
  const includedCandidates = candidates.slice(0, maxItems);
  for (const candidate of candidates.slice(maxItems)) {
    excluded.push(buildExcludedMemory(candidate.entry, "over_limit", { role }));
  }

  const selected = includedCandidates
    .map((candidate) => buildSelectedMemory(candidate.entry, candidate, { role, now: options.now }))
    .filter((entry) => entry.memoryId && (entry.body || role === "scheduler"));

  return {
    schema: MEMORY_SELECTION_SCHEMA,
    included: selected.length > 0,
    reason: selected.length > 0 ? "included" : "no_matching_memory",
    role,
    action,
    maxItems,
    count: selected.length,
    entries: selected,
    excluded,
  };
}

module.exports = {
  ENGINE_RULE_KINDS,
  MEMORY_SELECTION_SCHEMA,
  entryAppliesToAction,
  isRecognizedMemoryRule,
  normalizeAction,
  normalizeEntryMatch,
  normalizeMatch,
  selectMemoriesForTurn,
};
