"use strict";

const MEMORY_RULE_REGISTRY_SCHEMA = "guanshi-ai-memory-rule-registry-v1";

function normalizeText(value, maxLength = 4000) {
  return String(value || "").trim().slice(0, maxLength);
}

function normalizeClock(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(normalizeText(value, 20));
  if (!match) return "";
  const hour = Number.parseInt(match[1], 10);
  const minute = Number.parseInt(match[2], 10);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return "";
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function normalizePositiveInteger(value, max = 24 * 60) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > max) return null;
  return parsed;
}

function stableHash(value) {
  let hash = 2166136261;
  for (const char of normalizeText(value, 500).toLowerCase()) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function normalizeTopicText(value) {
  return normalizeText(value, 240)
    .toLowerCase()
    .replace(/\[objectobject\]/g, "")
    .replace(/[\s，。！？、；：,.!?;:'"“”‘’（）()\-_/]+/g, "")
    .replace(/\d+(?:\.\d+)?/g, "")
    .replace(/(?:类任务|任务|事项|默认|一般|通常|以后|估时|估算|预计|时长|分钟|小时)/g, "")
    .slice(0, 160);
}

const RULE_TOPIC_ALIASES = Object.freeze([
  { key: "customer_reply", patterns: ["客户回复", "回复客户", "回客户", "clientreply", "customerreply"] },
  { key: "supplier_reply", patterns: ["供应商回复", "回复供应商", "supplierreply", "vendorreply"] },
  { key: "customer_followup", patterns: ["客户回访", "回访客户", "customerfollowup", "clientfollowup"] },
  { key: "customer_feedback", patterns: ["客户反馈", "反馈客户", "customerfeedback", "clientfeedback"] },
  { key: "journal_writing", patterns: ["写日记", "日记", "journalwriting", "writejournal"] },
  { key: "customer_communication", patterns: ["客户沟通", "沟通客户", "customercommunication", "clientcommunication"] },
]);

function flattenRuleTopicValues(value, result = []) {
  if (value === undefined || value === null) return result;
  if (Array.isArray(value)) {
    for (const item of value) flattenRuleTopicValues(item, result);
    return result;
  }
  if (typeof value === "object") {
    for (const key of [
      "matcher",
      "keywords",
      "keyword",
      "titleContains",
      "titleIncludes",
      "textContains",
      "contains",
      "intent",
      "topic",
      "taskType",
      "taskTypes",
      "category",
      "categories",
    ]) {
      if (Object.prototype.hasOwnProperty.call(value, key)) flattenRuleTopicValues(value[key], result);
    }
    return result;
  }
  const text = normalizeTopicText(value);
  if (text) result.push(text);
  return result;
}

function flattenRuleMatcherValues(value, result = []) {
  if (value === undefined || value === null) return result;
  if (Array.isArray(value)) {
    for (const item of value) flattenRuleMatcherValues(item, result);
    return result;
  }
  if (typeof value === "object") {
    for (const key of [
      "matcher",
      "keywords",
      "keyword",
      "titleContains",
      "titleIncludes",
      "textContains",
      "contains",
      "intent",
      "topic",
    ]) {
      if (Object.prototype.hasOwnProperty.call(value, key)) flattenRuleMatcherValues(value[key], result);
    }
    return result;
  }
  const text = normalizeText(value, 120);
  if (text && text !== "[object Object]") result.push(text);
  return result;
}

function normalizeRuleMatcherValues(value, maxItems = 16) {
  return Array.from(new Set(flattenRuleMatcherValues(value))).slice(0, maxItems);
}

function normalizeRuleTopic(value) {
  const values = Array.from(new Set(flattenRuleTopicValues(value)));
  for (const alias of RULE_TOPIC_ALIASES) {
    if (values.some((item) => alias.patterns.some((pattern) => item.includes(pattern)))) return alias.key;
  }
  const genericAliases = {
    communication: "communication",
    deepwork: "deep_work",
    admin: "admin",
    errand: "errand",
    other: "other",
  };
  const generic = values.map((item) => genericAliases[item]).find(Boolean);
  if (generic) return generic;
  return values.length ? `topic_${stableHash(values.sort().join("|"))}` : "unspecified";
}

function validateNoWorkAfter(rule) {
  return normalizeClock(rule.time) ? [] : ["rule.time must be a valid HH:mm clock"];
}

function validateFixedBreak(rule) {
  const start = normalizeClock(rule.start);
  const end = normalizeClock(rule.end);
  if (!start || !end) return ["rule.start and rule.end must be valid HH:mm clocks"];
  if (end <= start) return ["rule.end must be later than rule.start"];
  return [];
}

function validatePositiveField(rule, field, max) {
  return normalizePositiveInteger(rule[field], max) === null ? [`rule.${field} must be a positive integer`] : [];
}

function validateTaskWindow(rule) {
  const errors = [];
  if (!normalizeText(rule.taskType, 80)) errors.push("rule.taskType is required");
  const start = normalizeClock(rule.start);
  const end = normalizeClock(rule.end);
  if (!start || !end || end <= start) errors.push("rule.start/end must form a valid time window");
  return errors;
}

function validateTaskDurationEstimate(rule) {
  const errors = validatePositiveField(rule, "estimatedMinutes", 24 * 60);
  const matcherObject = rule.matcher && typeof rule.matcher === "object" && !Array.isArray(rule.matcher)
    ? rule.matcher
    : {};
  const hasScopedMatcher = [
    matcherObject.taskType,
    matcherObject.taskTypes,
    matcherObject.project,
    matcherObject.projects,
    matcherObject.category,
    matcherObject.categories,
  ].some((value) => normalizeText(Array.isArray(value) ? value[0] : value, 120));
  if (!normalizeRuleMatcherValues(rule.matcher).length && !normalizeText(rule.taskType, 120) && !hasScopedMatcher) {
    errors.push("rule.matcher or rule.taskType is required");
  }
  return errors;
}

function validateWorkflowPlaybook(rule) {
  const steps = Array.isArray(rule.steps) ? rule.steps.map((item) => normalizeText(item, 160)).filter(Boolean) : [];
  return steps.length ? [] : ["rule.steps must contain at least one step"];
}

const RULE_SPECS = Object.freeze({
  no_work_after: {
    kind: "no_work_after",
    label: "晚间工作边界",
    consumers: ["scheduler", "task_guard"],
    defaultAppliesTo: ["assistant", "parse_task", "plan_today", "plan_week", "reflow_unfinished", "schedule_draft"],
    validate: validateNoWorkAfter,
    buildSubjectKey: () => "time.boundary.workday_end",
  },
  fixed_break: {
    kind: "fixed_break",
    label: "固定休息时段",
    consumers: ["scheduler"],
    defaultAppliesTo: ["plan_today", "plan_week", "reflow_unfinished", "schedule_draft"],
    validate: validateFixedBreak,
    buildSubjectKey: (rule) => `time.habit.fixed_break.${stableHash(`${rule.start}-${rule.end}`)}`,
  },
  buffer_after_calendar_event: {
    kind: "buffer_after_calendar_event",
    label: "日程后缓冲",
    consumers: [],
    defaultAppliesTo: ["plan_today", "plan_week", "reflow_unfinished", "schedule_draft"],
    validate: (rule) => validatePositiveField(rule, "minutes", 24 * 60),
    buildSubjectKey: () => "time.rule.calendar_event_buffer",
  },
  max_big_tasks_per_day: {
    kind: "max_big_tasks_per_day",
    label: "每日大任务上限",
    consumers: [],
    defaultAppliesTo: ["plan_today", "plan_week", "reflow_unfinished", "schedule_draft"],
    validate: (rule) => validatePositiveField(rule, "count", 100),
    buildSubjectKey: () => "time.rule.max_big_tasks_per_day",
  },
  prefer_task_type_window: {
    kind: "prefer_task_type_window",
    label: "任务类型时段偏好",
    consumers: [],
    defaultAppliesTo: ["plan_today", "plan_week", "reflow_unfinished", "schedule_draft"],
    validate: validateTaskWindow,
    buildSubjectKey: (rule) => `time.preference.task_window.${stableHash(rule.taskType)}`,
  },
  task_duration_estimate: {
    kind: "task_duration_estimate",
    label: "任务估时",
    consumers: [],
    defaultAppliesTo: ["assistant", "parse_task", "breakdown_task"],
    validate: validateTaskDurationEstimate,
    buildSubjectKey: (rule, context = {}) => `time.duration.${normalizeRuleTopic([
      rule.matcher,
      rule.taskType,
      context.match?.keywords,
      context.title,
    ])}`,
  },
  task_duration_policy: {
    kind: "task_duration_policy",
    label: "任务估时策略",
    consumers: [],
    defaultAppliesTo: ["assistant", "parse_task", "breakdown_task"],
    validate: () => [],
    buildSubjectKey: (rule) => `time.duration_policy.${stableHash(JSON.stringify(rule))}`,
  },
  task_estimation: {
    kind: "task_estimation",
    label: "任务估时方法",
    consumers: [],
    defaultAppliesTo: ["assistant", "parse_task", "breakdown_task"],
    validate: () => [],
    buildSubjectKey: (rule) => `time.task_estimation.${stableHash(JSON.stringify(rule))}`,
  },
  breakdown_time_allocation: {
    kind: "breakdown_time_allocation",
    label: "拆解时间分配",
    consumers: [],
    defaultAppliesTo: ["assistant", "breakdown_task"],
    validate: () => [],
    buildSubjectKey: (rule) => `time.breakdown_allocation.${stableHash(JSON.stringify(rule))}`,
  },
  workflow_playbook: {
    kind: "workflow_playbook",
    label: "协作方法",
    consumers: [],
    defaultAppliesTo: ["assistant", "breakdown_task", "review_day"],
    validate: validateWorkflowPlaybook,
    buildSubjectKey: (rule) => `assistant.playbook.${stableHash(rule.trigger || JSON.stringify(rule.steps || []))}`,
  },
});

const KNOWN_MEMORY_RULE_KINDS = new Set(Object.keys(RULE_SPECS));

function getMemoryRuleSpec(kind) {
  return RULE_SPECS[normalizeText(kind, 80)] || null;
}

function validateMemoryRule(rule) {
  const source = rule && typeof rule === "object" && !Array.isArray(rule) ? rule : null;
  const kind = normalizeText(source?.kind, 80);
  const spec = getMemoryRuleSpec(kind);
  if (!source || !kind) {
    return { known: false, valid: false, kind: "", errors: ["rule.kind is required"], consumers: [] };
  }
  if (!spec) {
    return { known: false, valid: false, kind, errors: ["rule.kind is not registered"], consumers: [] };
  }
  const errors = spec.validate(source);
  return {
    known: true,
    valid: errors.length === 0,
    kind,
    errors,
    consumers: [...spec.consumers],
  };
}

function isRecognizedMemoryRule(rule) {
  return validateMemoryRule(rule).known;
}

function isValidMemoryRule(rule) {
  return validateMemoryRule(rule).valid;
}

function isMemoryRuleSupported(rule, target) {
  const result = validateMemoryRule(rule);
  return result.valid && result.consumers.includes(normalizeText(target, 80));
}

function buildRuleSubjectKey(rule, context = {}) {
  const source = rule && typeof rule === "object" && !Array.isArray(rule) ? rule : null;
  const spec = getMemoryRuleSpec(source?.kind);
  return spec ? normalizeText(spec.buildSubjectKey(source, context), 160) : "";
}

function getMemoryRuleRegistrySummary() {
  return {
    schema: MEMORY_RULE_REGISTRY_SCHEMA,
    rules: Object.values(RULE_SPECS).map((spec) => ({
      kind: spec.kind,
      label: spec.label,
      consumers: [...spec.consumers],
      defaultAppliesTo: [...spec.defaultAppliesTo],
      engineSupported: spec.consumers.length > 0,
    })),
  };
}

module.exports = {
  KNOWN_MEMORY_RULE_KINDS,
  MEMORY_RULE_REGISTRY_SCHEMA,
  buildRuleSubjectKey,
  getMemoryRuleRegistrySummary,
  getMemoryRuleSpec,
  isMemoryRuleSupported,
  isRecognizedMemoryRule,
  isValidMemoryRule,
  normalizeRuleMatcherValues,
  normalizeRuleTopic,
  stableHash,
  validateMemoryRule,
};
