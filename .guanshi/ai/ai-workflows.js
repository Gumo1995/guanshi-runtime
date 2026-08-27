"use strict";

const { createDomainModuleRegistry } = require("./ai-domain-module-registry");
const { normalizeRuleMatcherValues } = require("./ai-memory-rule-registry");
const { normalizeMatch } = require("./ai-memory-selector");
const { deriveSubjectKey, validateMemoryCandidate } = require("./ai-memory-policy");

const AI_ACTION_REQUEST_SCHEMA = "guanshi-ai-action-request-v1";
const AI_COMPOSED_CONTEXT_SCHEMA = "guanshi-ai-composed-context-v1";
const AI_WORKFLOW_EXECUTION_SCHEMA = "guanshi-ai-workflow-execution-v1";
const TASK_PARSE_SCHEMA = "guanshi-task-parse-result-v1";
const TASK_BREAKDOWN_SCHEMA = "guanshi-task-breakdown-result-v1";
const TODO_COMPLETION_SCHEMA = "guanshi-todo-completion-result-v1";
const PRINCIPLE_MEMORY_PROPOSAL_SCHEMA = "guanshi-principle-memory-proposal-v1";
const PLAN_INTENT_SCHEMA = "guanshi-plan-intent-v1";
const REFLOW_SUGGESTION_SCHEMA = "guanshi-reflow-suggestion-v1";
const REVIEW_INSIGHT_SCHEMA = "guanshi-review-insight-v1";

const ACTIONS = new Set([
  "explore_principles",
  "parse_task",
  "breakdown_task",
  "complete_task",
  "save_memory_proposal",
  "plan_today",
  "plan_week",
  "reflow_unfinished",
  "review_day",
]);

const ACTION_MEMORY_TYPES = new Set(["profile", "principle", "habit", "boundary", "preference", "rule", "playbook", "review"]);
const MEMORY_SUBJECT_KEY_PATTERN = /^[a-z0-9][a-z0-9_.-]{2,159}$/;
const REGISTRY_PIPELINE_ACTIONS = new Set(ACTIONS);
const DOMAIN_MODULES = createDomainModuleRegistry();

function createWorkflowError(code, message, statusCode = 400, details = {}) {
  const error = new Error(message || code);
  error.code = code;
  error.statusCode = statusCode;
  error.details = details && typeof details === "object" ? details : {};
  return error;
}

function normalizeText(value, maxLength = 4000) {
  return String(value || "").trim().slice(0, maxLength);
}

function normalizeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizePositiveInteger(value, fallback, min = 0, max = 24 * 60) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function formatDate(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function parseDate(value) {
  const text = normalizeText(value, 20);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T12:00:00`);
  return Number.isFinite(date.getTime()) ? date : null;
}

function normalizeDate(value) {
  const date = parseDate(value);
  return date ? formatDate(date) : "";
}

function addDays(dateText, days) {
  const date = parseDate(dateText);
  if (!date) return "";
  date.setDate(date.getDate() + days);
  return formatDate(date);
}

function getNextWeekday(dateText, targetDay) {
  const date = parseDate(dateText);
  if (!date) return "";
  const current = date.getDay();
  const delta = (targetDay - current + 7) % 7 || 7;
  date.setDate(date.getDate() + delta);
  return formatDate(date);
}

function getCurrentDate(nowIso) {
  const date = new Date(nowIso);
  return Number.isFinite(date.getTime()) ? formatDate(date) : formatDate(new Date());
}

function parseClockToMinutes(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(normalizeText(value, 8));
  if (!match) return null;
  const hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function normalizeClock(value) {
  const minutes = parseClockToMinutes(value);
  return minutes === null ? "" : formatMinutes(minutes);
}

function formatMinutes(minutes) {
  const safe = Math.max(0, Math.min(24 * 60 - 1, Math.floor(minutes)));
  return `${pad2(Math.floor(safe / 60))}:${pad2(safe % 60)}`;
}

function getZonedRuntimeClock(nowIso, timezone) {
  const date = new Date(nowIso);
  if (!Number.isFinite(date.getTime())) return null;
  const safeTimezone = normalizeText(timezone || "Asia/Shanghai", 80) || "Asia/Shanghai";
  const formatterOptions = {
    timeZone: safeTimezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  };
  let parts;
  let resolvedTimezone = safeTimezone;
  try {
    parts = new Intl.DateTimeFormat("en-US", formatterOptions).formatToParts(date);
  } catch {
    resolvedTimezone = "Asia/Shanghai";
    parts = new Intl.DateTimeFormat("en-US", {
      ...formatterOptions,
      timeZone: resolvedTimezone,
    }).formatToParts(date);
  }
  const partMap = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const localDate = `${partMap.year}-${partMap.month}-${partMap.day}`;
  const localTime = `${partMap.hour}:${partMap.minute}`;
  return {
    localDate,
    localTime,
    localTimeWithSeconds: `${localTime}:${partMap.second}`,
    timezone: resolvedTimezone,
  };
}

function buildSchedulerNotBefore(request, dateRange, action, nowIso) {
  if (!["plan_today", "plan_week", "reflow_unfinished"].includes(action)) return null;
  const clockInput = normalizeObject(request.input.runtimeClock);
  const runtimeClock = clockInput.localDate && clockInput.localTime
    ? {
        localDate: normalizeText(clockInput.localDate, 20),
        localTime: normalizeClock(clockInput.localTime),
        localTimeWithSeconds: normalizeText(clockInput.localTimeWithSeconds, 12),
        timezone: normalizeText(clockInput.timezone || request.timezone, 80),
        source: "runtime_clock",
      }
    : {
        ...(getZonedRuntimeClock(nowIso, request.timezone) || {}),
        source: "workflow_now",
      };
  const date = normalizeText(runtimeClock.localDate, 20);
  const time = normalizeClock(runtimeClock.localTime);
  const start = normalizeText(dateRange?.start, 20);
  const end = normalizeText(dateRange?.end || dateRange?.start, 20);
  if (!date || !time || !start || !end || date < start || date > end) return null;
  return {
    schema: "guanshi-scheduler-not-before-v1",
    source: runtimeClock.source,
    date,
    time,
    timeWithSeconds: normalizeText(runtimeClock.localTimeWithSeconds, 12),
    timezone: normalizeText(runtimeClock.timezone || request.timezone, 80),
  };
}

function normalizeActionRequest(input = {}, nowIso = new Date().toISOString()) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const schema = normalizeText(source.schema || AI_ACTION_REQUEST_SCHEMA, 80);
  if (schema !== AI_ACTION_REQUEST_SCHEMA) {
    throw createWorkflowError("AI_ACTION_SCHEMA_INVALID", "AI action request schema is invalid.", 400, { schema });
  }
  const action = normalizeText(source.action, 80);
  if (!ACTIONS.has(action)) {
    throw createWorkflowError("AI_ACTION_UNSUPPORTED", "AI action is not supported.", 400, { action });
  }
  const inputPayload = source.input && typeof source.input === "object" && !Array.isArray(source.input) ? source.input : {};
  const contextPolicy = source.contextPolicy && typeof source.contextPolicy === "object" && !Array.isArray(source.contextPolicy)
    ? source.contextPolicy
    : {};
  if (normalizeText(contextPolicy.includeCalendar || "busy_blocks_only", 80) !== "busy_blocks_only") {
    throw createWorkflowError("AI_CONTEXT_CALENDAR_POLICY_INVALID", "AI calendar context must use busy_blocks_only.", 400);
  }
  return {
    schema: AI_ACTION_REQUEST_SCHEMA,
    action,
    locale: normalizeText(source.locale || "zh-CN", 20),
    timezone: normalizeText(source.timezone || "Asia/Shanghai", 80),
    requestId: normalizeText(source.requestId || `req_${nowIso.replace(/[^0-9]/g, "").slice(0, 14)}`, 120),
    input: inputPayload,
    contextPolicy: {
      includeTodos: normalizeText(contextPolicy.includeTodos || "active_relevant", 80),
      includeCalendar: "busy_blocks_only",
      includeMemory: normalizeText(contextPolicy.includeMemory || "active_index_only", 80),
      includeProgress: normalizeText(contextPolicy.includeProgress || "summary_only", 80),
      maxItems: Math.max(1, Math.min(100, Number.parseInt(String(contextPolicy.maxItems || 80), 10) || 80)),
    },
  };
}

function composeContext(request, stores, nowIso) {
  const todos = Array.isArray(request.input.todos) ? request.input.todos.slice(0, request.contextPolicy.maxItems) : [];
  const busyBlocks = Array.isArray(request.input.busyBlocks) ? request.input.busyBlocks.slice(0, request.contextPolicy.maxItems) : [];
  const memory = stores.memoryStore
    ? stores.memoryStore.getEngineProjections({ target: "scheduler", action: request.action }).slice(0, request.contextPolicy.maxItems)
    : [];
  return {
    schema: AI_COMPOSED_CONTEXT_SCHEMA,
    requestId: request.requestId,
    generatedAt: nowIso,
    timezone: request.timezone,
    todos,
    busyBlocks,
    memory,
    progress: {
      included: Boolean(request.input.progressSummary),
      summary: normalizeText(request.input.progressSummary, 1000),
    },
    redactions: {
      calendarTitles: "masked",
      externalIds: "omitted",
      providerSecrets: "omitted",
    },
  };
}

function inferEstimatedMinutes(text) {
  if (/半\s*小时/.test(text)) return 30;
  const hourMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:个)?小时/);
  if (hourMatch) return Math.max(5, Math.round(Number(hourMatch[1]) * 60));
  const minuteMatch = text.match(/(\d+)\s*分钟/);
  if (minuteMatch) return Math.max(5, Number.parseInt(minuteMatch[1], 10));
  return 30;
}

function inferDate(text, currentDate, input = {}) {
  if (input.targetDate || input.date) return normalizeText(input.targetDate || input.date, 20);
  if (/明天/.test(text)) return addDays(currentDate, 1);
  if (/后天/.test(text)) return addDays(currentDate, 2);
  if (/今天|今晚|上午|下午|晚上/.test(text)) return currentDate;
  if (/周五|星期五/.test(text)) return getNextWeekday(currentDate, 5);
  if (/周一|星期一/.test(text)) return getNextWeekday(currentDate, 1);
  return "";
}

function inferStartTime(text) {
  const explicit = text.match(/(\d{1,2})[:：](\d{2})/);
  if (explicit) return `${pad2(Number.parseInt(explicit[1], 10))}:${explicit[2]}`;
  const hour = text.match(/(?:晚上|上午|下午|早上)?\s*(\d{1,2})\s*点/);
  if (hour) {
    let value = Number.parseInt(hour[1], 10);
    if (/下午|晚上/.test(text) && value < 12) value += 12;
    return `${pad2(value)}:00`;
  }
  if (/下午/.test(text)) return "14:00";
  if (/上午|早上/.test(text)) return "09:30";
  return "";
}

function inferTitle(text) {
  const normalized = normalizeText(text, 200);
  const patterns = [
    [/写(.{0,18}?方案)/, "写$1"],
    [/(处理|弄完|完成)?\s*报销/, "处理报销"],
    [/看完\s*([A-Za-z0-9\u4e00-\u9fff\s]+?)(?:文档|资料)/, "看完 $1文档"],
    [/回客户消息|回复客户消息/, "回客户消息"],
    [/完成\s*([A-Za-z0-9\u4e00-\u9fff\s]+?)(?:$|，|,)/, "完成$1"],
  ];
  for (const [regex, replacement] of patterns) {
    const match = regex.exec(normalized);
    if (match) return match[0].replace(regex, replacement).replace(/\s+/g, " ").trim().slice(0, 80);
  }
  return normalized
    .replace(/^(帮我|请|把|将)/, "")
    .replace(/(安排|提醒我|最多|找个|这周|今天|明天|后天|上午|下午|晚上|周五前|星期五前|\d+\s*(?:分钟|小时|点)).*$/g, "")
    .trim()
    .slice(0, 80) || "待确认任务";
}

function inferProject(text) {
  const match = text.match(/放到(.{1,30}?项目)/);
  return match ? match[1].trim() : "";
}

function inferTaskType(text) {
  if (/报销/.test(text)) return "admin";
  if (/客户|消息|邮件|沟通/.test(text)) return "communication";
  if (/方案|架构|文档|写|看完|学习/.test(text)) return "deep_work";
  if (/跑腿|买|取/.test(text)) return "errand";
  return "other";
}

function inferCapabilityName(text) {
  if (/记账|支出|消费|报销金额|花了/.test(text)) return "记账能力";
  if (/邮件|邮箱|收件箱/.test(text)) return "邮件处理能力";
  if (/会议纪要|会议内容|录音/.test(text)) return "会议纪要能力";
  if (/自动|同步|导入/.test(text)) return "自动化能力";
  return "新能力需求";
}

function inferTaskEstimateMatcher(text) {
  if (/回复客户|回客户|客户.*消息|消息.*客户|打电话|电话回复|回电话/.test(text)) return "客户回复/电话沟通";
  if (/邮件|邮箱/.test(text)) return "邮件处理";
  if (/沟通|同步|确认/.test(text)) return "沟通确认";
  if (/报销|行政/.test(text)) return "行政处理";
  if (/方案|架构|文档|写|学习|深度/.test(text)) return "深度工作";
  return "相似任务";
}

function normalizeStringList(value, maxItems = 12, maxLength = 80) {
  const source = Array.isArray(value) ? value : [];
  return Array.from(new Set(
    source
      .map((item) => normalizeText(item, maxLength))
      .filter(Boolean),
  )).slice(0, maxItems);
}

function normalizeMemoryType(value, fallback = "principle") {
  const raw = normalizeText(value, 80).toLowerCase();
  const aliases = {
    principles: "principle",
    principle_memory: "principle",
    time_principle: "principle",
    preferences: "preference",
    habits: "habit",
    boundaries: "boundary",
    rules: "rule",
    playbooks: "playbook",
  };
  const type = aliases[raw] || raw || fallback;
  return ACTION_MEMORY_TYPES.has(type) ? type : fallback;
}

function normalizeMemoryStrength(value, fallback = "soft") {
  const strength = normalizeText(value || fallback, 40);
  return ["hard", "soft", "observed"].includes(strength) ? strength : fallback;
}

function inferPlannerMemoryType(proposal = {}, rule = null, body = "") {
  const kind = normalizeText(rule?.kind, 80);
  if (kind === "no_work_after") return "boundary";
  if (kind === "fixed_break") return "habit";
  if (kind === "prefer_task_type_window") return "preference";
  if (kind === "workflow_playbook") return "playbook";
  if (kind) return "rule";
  const text = `${normalizeText(proposal.title, 160)} ${normalizeText(body, 1000)}`;
  if (/边界|不安排|不要安排|不工作|禁止/.test(text)) return "boundary";
  if (/习惯|每周|每天|通常会|固定/.test(text)) return "habit";
  if (/偏好|更喜欢|倾向|优先/.test(text)) return "preference";
  if (/流程|方法|步骤|先.+再/.test(text)) return "playbook";
  if (/规则|估时|约束|默认/.test(text)) return "rule";
  return "principle";
}

function normalizePlannerMemoryRule(value, normalizedFields = []) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : null;
  if (!source) return null;
  const rule = { ...source };
  const kind = normalizeText(rule.kind, 80);
  if (kind === "task_duration_estimate") {
    if (rule.estimatedMinutes === undefined) {
      const estimatedMinutes = rule.defaultMinutes ?? rule.durationMinutes ?? rule.minutes;
      if (estimatedMinutes !== undefined) {
        rule.estimatedMinutes = estimatedMinutes;
        normalizedFields.push("rule.estimatedMinutes");
      }
    }
    if (!normalizeRuleMatcherValues(rule.matcher).length) {
      const matcher = normalizeText(rule.condition || rule.taskType, 120);
      if (matcher) {
        rule.matcher = matcher;
        normalizedFields.push("rule.matcher");
      }
    }
  } else if (kind === "no_work_after" && !normalizeText(rule.time, 20)) {
    const time = normalizeText(rule.cutoffTime || rule.after, 20);
    if (time) {
      rule.time = time;
      normalizedFields.push("rule.time");
    }
  } else if (kind === "fixed_break") {
    if (!normalizeText(rule.start, 20) && normalizeText(rule.startTime, 20)) {
      rule.start = rule.startTime;
      normalizedFields.push("rule.start");
    }
    if (!normalizeText(rule.end, 20) && normalizeText(rule.endTime, 20)) {
      rule.end = rule.endTime;
      normalizedFields.push("rule.end");
    }
  } else if (kind === "buffer_after_calendar_event" && rule.minutes === undefined && rule.bufferMinutes !== undefined) {
    rule.minutes = rule.bufferMinutes;
    normalizedFields.push("rule.minutes");
  } else if (kind === "max_big_tasks_per_day" && rule.count === undefined && rule.maxCount !== undefined) {
    rule.count = rule.maxCount;
    normalizedFields.push("rule.count");
  }
  return rule;
}

function normalizePlannerMemoryStrength(value, fallback, normalizedFields = []) {
  const raw = normalizeText(value, 40).toLowerCase();
  if (!raw) {
    normalizedFields.push("strength");
    return fallback;
  }
  if (["hard", "soft", "observed"].includes(raw)) return raw;
  const aliases = {
    hard_rule: "hard",
    strict_rule: "hard",
    constraint: "hard",
    soft_rule: "soft",
    preference_rule: "soft",
    suggestion: "soft",
    observation: "observed",
    observed_pattern: "observed",
  };
  if (aliases[raw]) {
    normalizedFields.push("strength");
    return aliases[raw];
  }
  return raw;
}

function normalizePlannerMatchMode(value, match, normalizedFields = []) {
  const raw = normalizeText(value, 40).toLowerCase();
  const fallback = Object.keys(match || {}).length ? "any" : "global";
  if (!raw) {
    normalizedFields.push("matchMode");
    return fallback;
  }
  if (["global", "any", "all"].includes(raw)) return raw;
  const aliases = {
    semantic: "any",
    keyword: "any",
    keywords: "any",
    relevant: "any",
    conditional: "any",
    any_match: "any",
    or: "any",
    all_match: "all",
    and: "all",
    always: "global",
    unconditional: "global",
  };
  if (aliases[raw]) {
    normalizedFields.push("matchMode");
    return aliases[raw];
  }
  return raw;
}

function normalizePlannerBoolean(value, fallback, field, normalizedFields = []) {
  if (typeof value === "boolean") return value;
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (["true", "yes", "1"].includes(text)) {
    normalizedFields.push(field);
    return true;
  }
  if (["false", "no", "0"].includes(text)) {
    normalizedFields.push(field);
    return false;
  }
  if (value && typeof value === "object" && !Array.isArray(value) && typeof value.enabled === "boolean") {
    normalizedFields.push(field);
    return value.enabled;
  }
  normalizedFields.push(field);
  return fallback;
}

function requestsModelOnlyMemory(text) {
  const source = normalizeText(text, 2000);
  return /(?:只|仅)(?:给|供)?\s*(?:AI|模型).{0,12}(?:参考|读取)|不要.{0,20}(?:本地|排程器|规则引擎).{0,12}(?:执行|应用|生效)|不(?:让|交给).{0,20}(?:本地|排程器|规则引擎).{0,12}(?:执行|应用)/i.test(source);
}

function normalizePlannerSubjectKey(value, candidate = {}, normalizedFields = []) {
  const supplied = normalizeText(value, 160).toLowerCase();
  if (MEMORY_SUBJECT_KEY_PATTERN.test(supplied)) return supplied;
  const derived = deriveSubjectKey({
    type: candidate.type,
    rule: candidate.rule,
    title: candidate.title,
    body: candidate.body,
  });
  if (derived && !normalizedFields.includes("subjectKey")) normalizedFields.push("subjectKey");
  return derived;
}

function getDefaultMemoryAppliesTo(type) {
  if (type === "playbook") return ["assistant", "breakdown_task", "review_day"];
  return ["plan_today", "plan_week", "reflow_unfinished", "schedule_draft"];
}

function isTaskEstimationRule(rule, body = "") {
  const kind = normalizeText(rule?.kind, 80);
  if (["task_duration_estimate", "task_duration_policy", "task_estimation", "breakdown_time_allocation"].includes(kind)) return true;
  return /估时|预计.*分钟|一般.*分钟|通常.*分钟|拆解.*时间|时长/.test(normalizeText(body, 1000));
}

function getMemoryAppliesTo(type, rule, body = "") {
  if (normalizeText(rule?.kind, 80) === "no_work_after") return ["assistant", "parse_task", "plan_today", "plan_week", "reflow_unfinished", "schedule_draft"];
  if (isTaskEstimationRule(rule, body)) return ["assistant", "parse_task", "breakdown_task"];
  return getDefaultMemoryAppliesTo(type);
}

function buildMemoryProposalMatch(type, rule, body = "", suppliedMatch = {}) {
  const explicitMatch = normalizeMatch(suppliedMatch);
  if (Object.keys(explicitMatch).length) return explicitMatch;

  const kind = normalizeText(rule?.kind, 80);
  const matcherValues = normalizeRuleMatcherValues(rule?.matcher || rule?.trigger, 8);
  const matcher = matcherValues[0] || "";
  const inferred = {
    keywords: [],
    taskType: [],
    category: [],
    timeHint: [],
  };
  if (matcherValues.length) inferred.keywords.push(...matcherValues);
  if (rule?.taskType) inferred.taskType.push(rule.taskType);
  if (Array.isArray(rule?.taskCategories)) inferred.category.push(...rule.taskCategories);
  if (kind === "task_duration_estimate") {
    inferred.keywords.push(...normalizeText(body, 400).split(/[\s,，、/]+/).filter(Boolean).slice(0, 4));
  } else if (kind === "prefer_task_type_window") {
    inferred.timeHint.push("上午", "深度工作");
  } else if (kind === "no_work_after") {
    inferred.timeHint.push("晚上", "晚间", normalizeText(rule.time, 20));
  } else if (kind === "buffer_after_calendar_event") {
    inferred.keywords.push("会议", "日程", "缓冲");
  } else if (kind === "workflow_playbook" || type === "playbook") {
    inferred.keywords.push("方法", "流程", "拆解");
    if (matcher === "large_project_or_unclear_scope") inferred.keywords.push("复杂项目", "项目推进");
  }
  return normalizeMatch(inferred);
}

function getPlannerMemoryProposalCandidate(input = {}) {
  const direct = normalizeObject(
    input.proposal
    || input.memory
    || input.memoryProposal
    || input.memoryDraft
    || input.principle,
  );
  if (Object.keys(direct).length) return direct;

  const semanticAction = normalizeObject(input.semanticAction);
  const semanticArguments = normalizeObject(semanticAction.arguments);
  return normalizeObject(
    semanticArguments.proposal
    || semanticArguments.memory
    || semanticArguments.memoryProposal
    || semanticArguments.memoryDraft
    || semanticArguments.principle,
  );
}

function getPlannerMemoryOperationIntent(input = {}, proposal = {}) {
  const semanticAction = normalizeObject(input.semanticAction);
  const semanticArguments = normalizeObject(semanticAction.arguments);
  const decision = normalizeObject(input.memoryDecision || semanticArguments.memoryDecision);
  const raw = normalizeText(proposal.operationIntent || proposal.operation || decision.operation, 40).toLowerCase();
  if (raw === "new") return "create";
  return ["create", "update", "replace"].includes(raw) ? raw : "";
}

function buildMemoryProposalEvidence(rawEvidence, defaults = {}) {
  const supplied = normalizeObject(rawEvidence);
  const evidenceText = typeof rawEvidence === "string" ? normalizeText(rawEvidence, 500) : "";
  return {
    ...supplied,
    source: normalizeText(supplied.source || defaults.source, 120),
    quote: normalizeText(supplied.quote || defaults.quote, 500),
    date: normalizeText(supplied.date || defaults.date, 40),
    ...(evidenceText ? { note: evidenceText } : {}),
    ...(Array.isArray(supplied.tags)
      ? { tags: normalizeStringList(supplied.tags, 12, 80) }
      : Array.isArray(defaults.tags)
        ? { tags: normalizeStringList(defaults.tags, 12, 80) }
        : {}),
  };
}

function finalizeMemoryProposalCandidate(candidateInput, request, currentDate, options = {}) {
  const policy = validateMemoryCandidate(candidateInput);
  if (policy.validation.errors.length) {
    throw createWorkflowError(
      "AI_MEMORY_PROPOSAL_POLICY_INVALID",
      "记忆候选没有通过统一 Memory Policy 校验。",
      400,
      {
        candidateSource: normalizeText(options.candidateSource, 80),
        validation: policy.validation,
      },
    );
  }
  const candidate = policy.candidate;
  return {
    schema: PRINCIPLE_MEMORY_PROPOSAL_SCHEMA,
    proposalId: `proposal_${request.requestId}`,
    policyVersion: candidate.policyVersion,
    classification: candidate.classification,
    type: candidate.type,
    subjectKey: candidate.subjectKey,
    title: candidate.title,
    body: candidate.body,
    strength: candidate.strength,
    appliesTo: candidate.appliesTo,
    modelReadable: candidate.modelReadable,
    engineReadable: candidate.engineReadable,
    matchMode: candidate.matchMode,
    match: candidate.match,
    rule: candidate.rule,
    validFrom: candidate.validFrom,
    validUntil: candidate.validUntil,
    reviewAfter: candidate.reviewAfter,
    confidence: candidate.confidence,
    operationIntent: candidate.operationIntent,
    targetMemoryIds: candidate.targetMemoryIds,
    supersedes: candidate.supersedes,
    evidence: candidate.evidence,
    candidateSource: normalizeText(options.candidateSource, 80),
    normalizedFields: normalizeStringList(options.normalizedFields, 24, 80),
    requiresConfirmation: true,
  };
}

function normalizePlannerMemoryProposal(request, currentDate) {
  const proposal = getPlannerMemoryProposalCandidate(request.input);
  if (!Object.keys(proposal).length) return null;
  const text = normalizeText(request.input.text, 4000);
  const normalizedFields = [];
  const rawType = normalizeText(proposal.type, 80).toLowerCase();
  if (["capability", "capability_request"].includes(rawType)) {
    throw createWorkflowError("AI_MEMORY_TYPE_DEPRECATED", "产品能力需求不属于用户记忆。", 400);
  }
  const knownTypeAliases = new Set(["principles", "principle_memory", "time_principle", "preferences", "habits", "boundaries", "rules", "playbooks"]);
  const containerTypeAliases = new Set(["memory", "memory_proposal", "time_memory_proposal", "long_term_memory"]);
  if (rawType && !ACTION_MEMORY_TYPES.has(rawType) && !knownTypeAliases.has(rawType) && !containerTypeAliases.has(rawType)) {
    throw createWorkflowError("AI_MEMORY_PROPOSAL_POLICY_INVALID", "Planner 提供了未知的记忆类型。", 400, {
      candidateSource: "planner_candidate",
      validation: { status: "invalid", errors: ["type_invalid"], warnings: [] },
    });
  }
  const body = normalizeText(proposal.body || proposal.content || proposal.summary || proposal.description, 4000);
  const rule = normalizePlannerMemoryRule(proposal.rule, normalizedFields);
  const inferredType = inferPlannerMemoryType(proposal, rule, body);
  const type = containerTypeAliases.has(rawType)
    ? inferredType
    : normalizeMemoryType(rawType, inferredType);
  if (!rawType || rawType !== type) normalizedFields.push("type");
  const title = normalizeText(proposal.title || proposal.name, 160);
  const defaultStrength = type === "boundary" || type === "rule" ? "hard" : type === "review" ? "observed" : "soft";
  const suppliedAppliesTo = normalizeStringList(proposal.appliesTo || proposal.applies_to, 16, 80);
  const appliesTo = suppliedAppliesTo.length ? suppliedAppliesTo : getMemoryAppliesTo(type, rule, body);
  if (!suppliedAppliesTo.length) normalizedFields.push("appliesTo");
  const suppliedMatch = normalizeMatch(proposal.match || proposal.matching);
  const rawMatchMode = normalizeText(proposal.matchMode || proposal.match_mode, 40);
  const rawModeIsGlobal = ["global", "always", "unconditional"].includes(rawMatchMode.toLowerCase());
  const match = rawModeIsGlobal
    ? suppliedMatch
    : Object.keys(suppliedMatch).length
      ? suppliedMatch
      : buildMemoryProposalMatch(type, rule, body);
  const matchMode = normalizePlannerMatchMode(rawMatchMode, match, normalizedFields);
  if (!Object.keys(suppliedMatch).length && Object.keys(match).length) normalizedFields.push("match");
  const subjectKey = normalizePlannerSubjectKey(proposal.subjectKey || proposal.subject_key, {
    type,
    rule,
    title,
    body,
  }, normalizedFields);
  const modelReadable = normalizePlannerBoolean(proposal.modelReadable, type !== "review", "modelReadable", normalizedFields);
  const engineReadableDefault = Boolean(rule && ["no_work_after", "fixed_break"].includes(normalizeText(rule.kind, 80)));
  let engineReadable = normalizePlannerBoolean(proposal.engineReadable, engineReadableDefault, "engineReadable", normalizedFields);
  if (requestsModelOnlyMemory(text) && engineReadable) {
    engineReadable = false;
    if (!normalizedFields.includes("engineReadable")) normalizedFields.push("engineReadable");
  }
  const evidence = buildMemoryProposalEvidence(proposal.evidence, {
    source: "planner_memory_proposal",
    quote: normalizeText(request.input.sourceText || text, 500),
    date: currentDate,
    tags: normalizeStringList(proposal.tags, 12, 80),
  });
  const operationIntent = getPlannerMemoryOperationIntent(request.input, proposal);
  return finalizeMemoryProposalCandidate({
    policyVersion: proposal.policyVersion || proposal.policy_version,
    classification: proposal.classification,
    type,
    subjectKey,
    title,
    body,
    strength: normalizePlannerMemoryStrength(proposal.strength, defaultStrength, normalizedFields),
    appliesTo,
    modelReadable,
    engineReadable,
    matchMode,
    match,
    rule,
    validFrom: proposal.validFrom || proposal.valid_from,
    validUntil: proposal.validUntil || proposal.valid_until,
    reviewAfter: proposal.reviewAfter || proposal.review_after,
    confidence: proposal.confidence,
    operationIntent,
    targetMemoryIds: proposal.targetMemoryIds || proposal.target_memory_ids,
    supersedes: proposal.supersedes,
    evidence,
  }, request, currentDate, {
    candidateSource: "planner_candidate",
    normalizedFields,
  });
}

function getPlannerTaskCandidate(input = {}) {
  return normalizeObject(
    input.task
    || input.taskDraft
    || input.todoDraft
    || input.todoCandidate
    || input.candidateTask,
  );
}

function getTaskInputWithCandidate(input = {}) {
  const candidate = getPlannerTaskCandidate(input);
  return {
    ...candidate,
    ...input,
    title: input.title || input.taskTitle || input.todoTitle || candidate.title || candidate.name || candidate.summary,
    project: input.project || candidate.project,
    targetDate: input.targetDate || input.date || candidate.targetDate || candidate.dueDate || candidate.date,
    date: input.date || input.targetDate || candidate.date || candidate.dueDate || candidate.targetDate,
    startTime: input.startTime || input.time || candidate.startTime || candidate.time || candidate.start,
    endTime: input.endTime || candidate.endTime || candidate.end,
    estimatedMinutes: input.estimatedMinutes || input.durationMinutes || candidate.estimatedMinutes || candidate.durationMinutes || candidate.duration,
    taskType: input.taskType || candidate.taskType || candidate.type,
  };
}

function compactTitleSegment(value, maxLength = 18) {
  let text = normalizeText(value, 120)
    .replace(/[「」]/g, "")
    .replace(/^(帮我|请|把|将|创建一个|创建|提醒我|安排|处理|完成)\s*/, "")
    .replace(/创建一个提醒给我/g, "")
    .replace(/这个任务|当前任务/g, "任务")
    .replace(/的消息/g, "")
    .replace(/消息$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  if (/张总/.test(text) && /(回复|回|电话)/.test(text)) return "回复张总";
  if (/客户/.test(text) && /(回复|回|电话)/.test(text)) return "回复客户";
  const aiPlan = /(AI\s*架构方案)/i.exec(text);
  if (aiPlan) return aiPlan[1].replace(/\s+/g, " ");
  const plan = /([\u4e00-\u9fffA-Za-z0-9 ]{1,18}方案)/.exec(text);
  if (plan) return plan[1].replace(/^(完成|准备|推进|输出)\s*/, "").trim();
  return text.slice(0, maxLength);
}

function compactBreakdownStepTitle(value) {
  let text = normalizeText(value, 120)
    .replace(/[「」]/g, "")
    .replace(/^(帮我|请|把|将|创建一个|创建|提醒我|安排)\s*/, "")
    .replace(/^确认客户与回复方式$/, "确认方式")
    .replace(/^整理回复要点$/, "整理要点")
    .replace(/^发送回复并记录后续事项$/, "发送记录")
    .replace(/客户|回复/g, "")
    .replace(/上线/g, "")
    .replace(/清单$/, "")
    .replace(/事项$/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (text === "发送并记录后续") text = "发送记录";
  if (text === "确认与方式") text = "确认方式";
  return text.slice(0, 18) || compactTitleSegment(value, 18) || "下一步";
}

function formatBreakdownTodoTitle(parentTitle, childTitle) {
  const rawChild = normalizeText(childTitle, 80);
  if (!rawChild) return "待确认子任务";
  if (/\s-\s/.test(rawChild)) return rawChild.slice(0, 80);
  const parent = compactTitleSegment(parentTitle, 18);
  const child = compactBreakdownStepTitle(rawChild);
  if (!parent) return child;
  if (child === parent || child.startsWith(`${parent} `)) return child.slice(0, 80);
  return `${parent} - ${child}`.slice(0, 80);
}

function normalizePlannerBreakdownChildren(request, parentTitle, parentTaskType) {
  const input = normalizeObject(request.input);
  const breakdown = normalizeObject(input.breakdown || input.taskBreakdown || input.plan);
  const semanticAction = normalizeObject(input.semanticAction);
  const sourceText = normalizeText(input.sourceText || input.text, 500);
  const normalizedGoal = normalizeText(input.normalizedGoal || semanticAction.normalizedGoal, 700);
  const source = Array.isArray(input.children)
    ? input.children
    : Array.isArray(input.subtasks)
      ? input.subtasks
      : Array.isArray(input.taskDrafts)
        ? input.taskDrafts
        : Array.isArray(breakdown.children)
          ? breakdown.children
          : Array.isArray(breakdown.subtasks)
            ? breakdown.subtasks
            : [];
  return source
    .slice(0, 12)
    .map((item, index) => {
      const child = normalizeObject(item);
      const rawTitle = normalizeText(child.title || child.name || child.summary || child.text, 160);
      if (!rawTitle) return null;
      const title = formatBreakdownTodoTitle(parentTitle, rawTitle);
      const estimatedMinutes = normalizePositiveInteger(
        child.estimatedMinutes || child.durationMinutes || child.duration,
        30,
        5,
        24 * 60,
      );
      const suppliedDependsOn = normalizeStringList(child.dependsOnDraftIds || child.dependsOn || child.dependencies, 8, 120);
      const notes = normalizeText(child.notes || child.note || child.description, 1000)
        || buildTaskDraftNotes({
          sourceText,
          understanding: normalizedGoal || `将「${parentTitle}」拆解出一步：「${title}」。`,
          parentTitle,
          childTitle: title,
        });
      const normalized = {
        draftTodoId: normalizeText(child.draftTodoId || child.id || `child_draft_${request.requestId}_${index + 1}`, 120),
        title,
        estimatedMinutes,
        taskType: normalizeText(child.taskType || child.type || parentTaskType || "deep_work", 40),
        dependsOnDraftIds: suppliedDependsOn.length ? suppliedDependsOn : index === 0 ? [] : [`child_draft_${request.requestId}_${index}`],
        notes,
        requiresConfirmation: true,
      };
      const dueDate = normalizeDate(child.dueDate || child.targetDate || child.date);
      const startTime = normalizeClock(child.startTime || child.time || child.start);
      const endTime = normalizeClock(child.endTime || child.end);
      if (dueDate) normalized.dueDate = dueDate;
      if (startTime) normalized.startTime = startTime;
      if (endTime) normalized.endTime = endTime;
      return normalized;
    })
    .filter(Boolean);
}

function addReferenceId(target, value) {
  const text = normalizeText(value, 120);
  if (text) target.push(text);
}

function collectBreakdownParentRefs(input = {}) {
  const refs = [];
  const semanticAction = normalizeObject(input.semanticAction);
  const semanticArgs = normalizeObject(semanticAction.arguments);
  addReferenceId(refs, input.todoId || input.parentTodoId || input.parentTaskId);
  for (const item of [
    ...normalizeStringList(input.contextRefs, 20, 120),
    ...normalizeStringList(input.targetObjectIds, 20, 120),
    ...normalizeStringList(semanticAction.contextRefs, 20, 120),
    ...normalizeStringList(semanticArgs.contextRefs, 20, 120),
  ]) {
    addReferenceId(refs, item);
  }
  const targetObjects = [
    ...(Array.isArray(input.targetObjects) ? input.targetObjects : []),
    ...(Array.isArray(semanticAction.targetObjects) ? semanticAction.targetObjects : []),
    ...(Array.isArray(semanticArgs.targetObjects) ? semanticArgs.targetObjects : []),
  ];
  for (const item of targetObjects) {
    const object = normalizeObject(item);
    addReferenceId(refs, object.id || object.todoId || object.refId);
  }
  return Array.from(new Set(refs));
}

function findTodoByReference(todos, refs) {
  if (!Array.isArray(todos) || !refs.length) return {};
  return normalizeObject(todos.find((todo) => {
    const id = normalizeText(todo?.id, 120);
    return id && refs.some((ref) => ref === id || ref === `todo:${id}` || ref.endsWith(`/${id}`));
  }));
}

function resolveBreakdownParent(input = {}) {
  const explicitParent = normalizeObject(input.todo || input.parentTodo || input.parentTask);
  if (Object.keys(explicitParent).length) return explicitParent;
  const selectedTodo = normalizeObject(input.selectedTodo);
  if (Object.keys(selectedTodo).length) return selectedTodo;
  return findTodoByReference(input.todos, collectBreakdownParentRefs(input));
}

function collectCompletionTargetRefs(input = {}) {
  const completion = normalizeObject(input.completion || input.completionDraft || input.taskCompletion);
  const targetTodo = normalizeObject(input.targetTodo || completion.targetTodo);
  const refs = collectBreakdownParentRefs(input);
  addReferenceId(refs, input.targetTodoId || input.sourceTodoId || completion.todoId || completion.targetTodoId);
  addReferenceId(refs, targetTodo.id || targetTodo.todoId);
  return Array.from(new Set(refs));
}

function resolveCompletionTarget(input = {}) {
  const targetTodo = normalizeObject(input.targetTodo);
  if (Object.keys(targetTodo).length && (targetTodo.id || targetTodo.todoId)) return targetTodo;
  const refs = collectCompletionTargetRefs(input);
  const referencedTarget = findTodoByReference([
    normalizeObject(input.todo),
    normalizeObject(input.selectedTodo),
    ...(Array.isArray(input.todos) ? input.todos : []),
  ], refs);
  if (Object.keys(referencedTarget).length) return referencedTarget;
  const selectedTarget = normalizeObject(input.todo || input.selectedTodo);
  return Object.keys(selectedTarget).length ? selectedTarget : {};
}

function normalizeOptionalScore(value) {
  if (value === null || value === undefined || value === "") return null;
  const normalized = String(value).trim();
  const score = /^\d+$/.test(normalized) ? Number(normalized) : Number.NaN;
  if (!Number.isInteger(score) || score < 1 || score > 10) {
    throw createWorkflowError("AI_TODO_COMPLETION_SCORE_INVALID", "Todo completion scores must be integers from 1 to 10.", 400);
  }
  return score;
}

function getCompletionCandidate(input = {}) {
  const completion = normalizeObject(input.completion || input.completionDraft || input.taskCompletion || input.actual);
  const updates = normalizeObject(input.updates || input.taskUpdates || completion.updates);
  return {
    ...completion,
    ...updates,
    actualDate: input.actualDate || completion.actualDate || completion.date || updates.actualDate,
    actualStartTime: input.actualStartTime || completion.actualStartTime || completion.startTime || updates.actualStartTime,
    actualEndTime: input.actualEndTime || completion.actualEndTime || completion.endTime || updates.actualEndTime,
    actualDurationMinutes:
      input.actualDurationMinutes
      || completion.actualDurationMinutes
      || completion.durationMinutes
      || updates.actualDurationMinutes,
    qualityScore: input.qualityScore ?? completion.qualityScore ?? completion.quality ?? updates.qualityScore,
    happinessScore: input.happinessScore ?? completion.happinessScore ?? completion.happiness ?? updates.happinessScore,
    updatedTitle: input.updatedTitle || input.title || completion.updatedTitle || updates.title,
    updatedProject: input.updatedProject || input.project || completion.updatedProject || updates.project,
    updatedCategory: input.updatedCategory || input.category || completion.updatedCategory || updates.category,
    updatedTags: input.updatedTags || input.tags || completion.updatedTags || updates.tags,
    updatedNote: input.updatedNote || input.note || input.notes || completion.updatedNote || updates.note || updates.notes,
  };
}

function buildTodoCompletionResult(request, targetTodo, nowIso) {
  const target = normalizeObject(targetTodo);
  const targetTodoId = normalizeText(target.id || target.todoId, 120);
  if (!targetTodoId) {
    throw createWorkflowError("AI_TODO_COMPLETION_TARGET_REQUIRED", "Todo completion requires one explicit todo target.", 400);
  }
  if (target.completed === true) {
    throw createWorkflowError("AI_TODO_ALREADY_COMPLETED", "The selected todo is already completed.", 409, { todoId: targetTodoId });
  }

  const candidate = getCompletionCandidate(request.input);
  const runtimeClock = getZonedRuntimeClock(nowIso, request.timezone) || {};
  const actualDate = normalizeDate(candidate.actualDate) || normalizeDate(runtimeClock.localDate) || getCurrentDate(nowIso);
  const fallbackDuration = normalizePositiveInteger(
    target.remainingMinutes || target.estimatedMinutes,
    30,
    5,
    24 * 60,
  );
  const suppliedDuration = normalizePositiveInteger(candidate.actualDurationMinutes, fallbackDuration, 5, 24 * 60);
  let startTime = normalizeClock(candidate.actualStartTime);
  let endTime = normalizeClock(candidate.actualEndTime);
  let startMinutes = parseClockToMinutes(startTime);
  let endMinutes = parseClockToMinutes(endTime);
  const assumptions = normalizeStringList(
    request.input.assumptions || normalizeObject(request.input.semanticAction).assumptions,
    8,
    220,
  );
  const warnings = normalizeStringList(
    request.input.warnings || normalizeObject(request.input.semanticAction).warnings,
    8,
    220,
  );

  if (startMinutes === null && endMinutes === null) {
    endTime = normalizeClock(runtimeClock.localTime) || "09:30";
    endMinutes = parseClockToMinutes(endTime);
    startMinutes = Math.max(0, (endMinutes ?? suppliedDuration) - suppliedDuration);
    startTime = formatMinutes(startMinutes);
    assumptions.push(`未提供实际时间，按完成时刻向前回推 ${Math.max(5, (endMinutes ?? suppliedDuration) - startMinutes)} 分钟。`);
  } else if (startMinutes !== null && endMinutes === null) {
    endMinutes = startMinutes + suppliedDuration;
    if (endMinutes >= 24 * 60) {
      throw createWorkflowError("AI_TODO_COMPLETION_TIME_INVALID", "Todo completion time cannot cross midnight in one calendar block.", 400);
    }
    endTime = formatMinutes(endMinutes);
  } else if (startMinutes === null && endMinutes !== null) {
    startMinutes = Math.max(0, endMinutes - suppliedDuration);
    startTime = formatMinutes(startMinutes);
  }
  if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes) {
    throw createWorkflowError("AI_TODO_COMPLETION_TIME_INVALID", "Todo completion requires a valid actual start and end time.", 400);
  }

  const actualDurationMinutes = endMinutes - startMinutes;
  const qualityScore = normalizeOptionalScore(candidate.qualityScore);
  const happinessScore = normalizeOptionalScore(candidate.happinessScore);
  const update = {
    dueDate: actualDate,
    startTime,
    endTime,
    estimatedMinutes: actualDurationMinutes,
  };
  const updatedTitle = normalizeText(candidate.updatedTitle, 160);
  const updatedProject = normalizeText(candidate.updatedProject, 120);
  const updatedCategory = normalizeText(candidate.updatedCategory, 80);
  const updatedNote = normalizeText(candidate.updatedNote, 2000);
  const updatedTags = Array.isArray(candidate.updatedTags)
    ? normalizeStringList(candidate.updatedTags, 16, 60)
    : null;
  if (updatedTitle) update.title = updatedTitle;
  if (updatedProject) update.project = updatedProject;
  if (updatedCategory) update.category = updatedCategory;
  if (updatedNote) update.note = updatedNote;
  if (updatedTags) update.tags = updatedTags;
  if (qualityScore !== null) update.qualityScore = qualityScore;
  if (happinessScore !== null) update.happinessScore = happinessScore;

  const item = {
    schema: "guanshi-todo-completion-draft-v1",
    completionDraftId: `completion_draft_${request.requestId}`,
    targetTodoId,
    targetTitle: normalizeText(target.title || "未命名待办", 160),
    original: {
      title: normalizeText(target.title, 160),
      dueDate: normalizeDate(target.dueDate),
      startTime: normalizeClock(target.startTime),
      endTime: normalizeClock(target.endTime),
      estimatedMinutes: normalizePositiveInteger(target.estimatedMinutes, 0, 0, 24 * 60),
    },
    update,
    completion: {
      completed: true,
      completedAt: nowIso,
      calendarBlock: {
        date: actualDate,
        start: startTime,
        end: endTime,
        durationMinutes: actualDurationMinutes,
        source: target.repeat && target.repeat !== "none" ? "todo-recurring-completed" : "todo-completed",
        needsReview: qualityScore === null || happinessScore === null,
      },
    },
    assumptions: Array.from(new Set(assumptions)),
    warnings: Array.from(new Set(warnings)),
    requiresConfirmation: true,
  };
  return {
    schema: TODO_COMPLETION_SCHEMA,
    sourceRequestId: request.requestId,
    items: [item],
    warnings: item.warnings,
  };
}

function splitMinutesByWeights(total, weights, minMinutes = 5) {
  const rawTotal = normalizePositiveInteger(total, minMinutes * weights.length, minMinutes, 24 * 60);
  const normalizedTotal = Math.max(minMinutes * weights.length, Math.round(rawTotal / 5) * 5);
  const safeWeights = weights.map((weight) => Math.max(1, Number(weight) || 1));
  const weightTotal = safeWeights.reduce((sum, weight) => sum + weight, 0);
  const rounded = safeWeights.map((weight) => Math.max(minMinutes, Math.round((normalizedTotal * weight / weightTotal) / 5) * 5));
  let diff = normalizedTotal - rounded.reduce((sum, minutes) => sum + minutes, 0);
  let index = rounded.length - 1;
  while (diff !== 0 && rounded.length) {
    const step = diff > 0 ? 5 : -5;
    if (step > 0 || rounded[index] + step >= minMinutes) {
      rounded[index] += step;
      diff -= step;
    }
    index = (index - 1 + rounded.length) % rounded.length;
  }
  return rounded;
}

function normalizeBreakdownParentSchedule(parent = {}) {
  return {
    dueDate: normalizeDate(parent.dueDate || parent.targetDate || parent.date),
    startTime: normalizeClock(parent.startTime || parent.time || parent.start || parent.plannedStart),
    endTime: normalizeClock(parent.endTime || parent.end || parent.plannedEnd),
  };
}

function applyBreakdownChildSchedule(children, parent = {}) {
  const parentSchedule = normalizeBreakdownParentSchedule(parent);
  let cursorMinutes = parseClockToMinutes(parentSchedule.startTime);
  return children.map((child) => {
    const dueDate = normalizeDate(child.dueDate || child.targetDate || child.date) || parentSchedule.dueDate;
    const explicitStartTime = normalizeClock(child.startTime || child.time || child.start);
    const explicitEndTime = normalizeClock(child.endTime || child.end);
    const startTime = explicitStartTime || (cursorMinutes !== null ? formatMinutes(cursorMinutes) : "");
    const startMinutes = parseClockToMinutes(startTime);
    const estimatedMinutes = normalizePositiveInteger(child.estimatedMinutes, 0, 0, 24 * 60);
    const endTime = explicitEndTime || (startMinutes !== null && estimatedMinutes > 0
      ? formatMinutes(startMinutes + estimatedMinutes)
      : "");
    const endMinutes = parseClockToMinutes(endTime);
    if (endMinutes !== null) cursorMinutes = endMinutes;
    return {
      ...child,
      ...(dueDate ? { dueDate } : {}),
      ...(startTime ? { startTime } : {}),
      ...(endTime ? { endTime } : {}),
    };
  });
}

function buildTaskDraftNotes(options = {}) {
  const sourceText = normalizeText(options.sourceText, 500);
  const understanding = normalizeText(options.understanding || options.normalizedGoal, 700);
  const parentTitle = normalizeText(options.parentTitle, 160);
  const childTitle = normalizeText(options.childTitle, 160);
  const lines = [];
  if (sourceText) lines.push(`原文：${sourceText}`);
  if (understanding) {
    lines.push(`理解：${understanding}`);
  } else if (parentTitle && childTitle) {
    lines.push(`理解：将「${parentTitle}」拆解出一步：「${childTitle}」。`);
  } else if (childTitle) {
    lines.push(`理解：创建待办「${childTitle}」。`);
  }
  return normalizeText(lines.join("\n"), 1000);
}

function inferPriority(text) {
  if (/马上|立刻|紧急|今天必须/.test(text)) return "urgent";
  if (/周五前|截止|今天/.test(text)) return "high";
  return "medium";
}

function hasNightBoundaryConflict(startTime, memory) {
  const start = parseClockToMinutes(startTime);
  if (start === null) return false;
  return memory.some((item) => {
    if (!item || item.status !== "active" || item.strength !== "hard" || !item.rule) return false;
    if (item.rule.kind !== "no_work_after") return false;
    const boundary = parseClockToMinutes(item.rule.time);
    return boundary !== null && start >= boundary;
  });
}

function buildTaskParseResult(request, context, currentDate) {
  const taskInput = getTaskInputWithCandidate(request.input);
  const text = normalizeText(request.input.text, 4000);
  const semanticAction = normalizeObject(request.input.semanticAction);
  const normalizedGoal = normalizeText(taskInput.normalizedGoal || taskInput.goal || semanticAction.normalizedGoal, 4000);
  const parseText = [text, normalizedGoal].filter(Boolean).join("\n");
  const explicitEstimatedMinutes = Number.parseInt(String(taskInput.estimatedMinutes || taskInput.durationMinutes || ""), 10);
  const estimatedMinutes = Number.isFinite(explicitEstimatedMinutes) && explicitEstimatedMinutes > 0
    ? explicitEstimatedMinutes
    : inferEstimatedMinutes(parseText);
  const dueDate = inferDate(parseText, currentDate, taskInput);
  const explicitStartTime = normalizeClock(taskInput.startTime || taskInput.time);
  const startTime = explicitStartTime || inferStartTime(parseText);
  const explicitEndTime = normalizeClock(taskInput.endTime);
  const endTime = explicitEndTime || (startTime ? formatMinutes((parseClockToMinutes(startTime) || 0) + estimatedMinutes) : "");
  const taskType = normalizeText(taskInput.taskType || taskInput.type, 40) || inferTaskType(parseText);
  const missingFields = normalizeStringList(taskInput.missingFields, 12, 80);
  if (!dueDate) missingFields.push("dueDate");
  if (/这周|找个/.test(parseText) && !taskInput.targetDate) missingFields.push("specificDate");
  const warnings = [];
  if (startTime && hasNightBoundaryConflict(startTime, context.memory)) {
    warnings.push({
      code: "night_boundary_warning",
      message: "该时间可能突破已确认的晚间工作边界，需要用户确认。",
    });
  }
  const title = normalizeText(taskInput.title || taskInput.taskTitle || taskInput.todoTitle, 80) || inferTitle(parseText);
  const taskNotes = normalizeText(taskInput.notes || taskInput.note || taskInput.description, 1000)
    || buildTaskDraftNotes({
      sourceText: taskInput.sourceText || text,
      understanding: normalizedGoal || `创建待办「${title}」。`,
    });
  return {
    schema: TASK_PARSE_SCHEMA,
    sourceRequestId: request.requestId,
    items: [
      {
        draftTodoId: `todo_draft_${request.requestId}`,
        title,
        project: normalizeText(taskInput.project, 80) || inferProject(parseText),
        category: normalizeText(taskInput.category, 80) || (taskType === "communication" || taskType === "deep_work" || taskType === "admin" ? "工作" : ""),
        tags: normalizeStringList(taskInput.tags, 8, 40).length
          ? normalizeStringList(taskInput.tags, 8, 40)
          : taskType === "admin" ? ["行政"] : taskType === "deep_work" ? ["深度工作"] : [],
        dueDate,
        startTime,
        endTime,
        estimatedMinutes,
        priority: normalizeText(taskInput.priority, 40) || inferPriority(text),
        importance: Number.isFinite(Number(taskInput.importance)) ? Number(taskInput.importance) : taskType === "deep_work" ? 4 : 3,
        urgency: Number.isFinite(Number(taskInput.urgency)) ? Number(taskInput.urgency) : /今天|明天|周五前|截止/.test(text) ? 4 : 3,
        taskType,
        energyLevel: normalizeText(taskInput.energyLevel, 40) || (taskType === "deep_work" ? "high" : "medium"),
        splittable: typeof taskInput.splittable === "boolean" ? taskInput.splittable : estimatedMinutes >= 60,
        minimumBlockMinutes: normalizePositiveInteger(taskInput.minimumBlockMinutes, estimatedMinutes >= 60 ? 30 : Math.min(estimatedMinutes, 30), 5, 24 * 60),
        notes: taskNotes,
        confidence: Number.isFinite(Number(taskInput.confidence))
          ? Math.max(0, Math.min(1, Number(taskInput.confidence)))
          : missingFields.length ? 0.56 : 0.82,
        missingFields: Array.from(new Set(missingFields)),
      },
    ],
    warnings,
  };
}

function buildTaskBreakdownResult(request) {
  const parent = resolveBreakdownParent(request.input);
  const parentTitle = normalizeText(parent.title || request.input.parentTitle || request.input.text || "待拆解任务", 160);
  const semanticAction = normalizeObject(request.input.semanticAction);
  const normalizedGoal = normalizeText(request.input.normalizedGoal || semanticAction.normalizedGoal, 700);
  const sourceText = normalizeText(request.input.sourceText || request.input.text, 500);
  const total = Math.max(30, Number.parseInt(String(parent.remainingMinutes || parent.estimatedMinutes || 120), 10) || 120);
  const plannerChildren = applyBreakdownChildSchedule(
    normalizePlannerBreakdownChildren(request, parentTitle, parent.taskType),
    parent,
  );
  if (plannerChildren.length) {
    return {
      schema: TASK_BREAKDOWN_SCHEMA,
      sourceTodoId: normalizeText(parent.id || "", 120),
      parentTitle,
      children: plannerChildren,
      rollup: {
        totalEstimatedMinutes: plannerChildren.reduce((sum, child) => sum + child.estimatedMinutes, 0),
        recommendedMinimumBlockMinutes: Math.min(45, Math.max(15, Math.round(plannerChildren.reduce((sum, child) => sum + child.estimatedMinutes, 0) / plannerChildren.length / 5) * 5)),
      },
      warnings: [],
    };
  }
  const childCount = /第一步|先/.test(normalizeText(request.input.text)) ? 1 : 3;
  const base = Math.max(15, Math.round(total / childCount / 5) * 5);
  let titles = childCount === 1
    ? ["明确下一步"]
    : ["梳理范围", "执行核心工作", "检查收尾"];
  if (parent.taskType === "communication" && childCount > 1) {
    titles = ["确认客户与回复方式", "整理回复要点", "发送回复并记录后续事项"];
  }
  const childMinutes = parent.taskType === "communication" && childCount > 1
    ? splitMinutesByWeights(total, [1, 2, 1])
    : splitMinutesByWeights(total, titles.map(() => 1), 15);
  const children = applyBreakdownChildSchedule(
    titles.map((title, index) => ({
      draftTodoId: `child_draft_${request.requestId}_${index + 1}`,
      title: formatBreakdownTodoTitle(parentTitle, title),
      estimatedMinutes: childMinutes[index] || base,
      taskType: parent.taskType || "deep_work",
      dependsOnDraftIds: index === 0 ? [] : [`child_draft_${request.requestId}_${index}`],
      notes: buildTaskDraftNotes({
        sourceText,
        understanding: normalizedGoal || `将「${parentTitle}」拆解出一步：「${title}」。`,
        parentTitle,
        childTitle: title,
      }),
      requiresConfirmation: true,
    })),
    parent,
  );
  return {
    schema: TASK_BREAKDOWN_SCHEMA,
    sourceTodoId: normalizeText(parent.id || "", 120),
    parentTitle,
    children,
    rollup: {
      totalEstimatedMinutes: children.reduce((sum, child) => sum + child.estimatedMinutes, 0),
      recommendedMinimumBlockMinutes: Math.min(45, Math.max(15, base)),
    },
    warnings: [],
  };
}

function inferMemoryProposal(request, currentDate) {
  const plannerProposal = normalizePlannerMemoryProposal(request, currentDate);
  if (plannerProposal) return plannerProposal;

  const text = normalizeText(request.input.text, 4000);
  let type = "principle";
  let title = "时间管理原则";
  let body = text;
  let strength = "soft";
  let modelReadable = true;
  let engineReadable = false;
  let rule = null;
  const durationEstimateMatch = /(估时|预计|一般|通常|默认|按).{0,30}?(\d+)\s*分钟|(\d+)\s*分钟.{0,30}?(估时|预计|一般|通常|默认|按)/.exec(text);
  if (durationEstimateMatch) {
    const minutes = Number.parseInt(durationEstimateMatch[2] || durationEstimateMatch[3], 10);
    const matcher = inferTaskEstimateMatcher(text);
    type = "rule";
    title = `${matcher}估时规则`;
    body = `${matcher}一般按 ${minutes} 分钟估时。`;
    strength = "soft";
    rule = {
      kind: "task_duration_estimate",
      matcher,
      estimatedMinutes: minutes,
      source: "user_memory",
    };
  } else if (/(经验|方法|流程|原则).*?(先|第一步).*(再|然后|最后)|复杂项目.*(先|再|然后)/.test(text)) {
    type = "playbook";
    title = /复杂项目/.test(text) ? "复杂项目推进方法" : "用户工作方法";
    body = text;
    strength = "soft";
    engineReadable = false;
    rule = {
      kind: "workflow_playbook",
      trigger: /复杂项目/.test(text) ? "large_project_or_unclear_scope" : "user_method",
      steps: text.split(/，|。|；|;|\n/).map((item) => normalizeText(item, 120)).filter(Boolean).slice(0, 8),
    };
  } else if (/21[:：]?30|晚上.*不.*工作|不想工作/.test(text)) {
    type = "boundary";
    title = "晚间工作边界";
    body = "21:30 后不安排工作任务。";
    strength = "hard";
    engineReadable = true;
    rule = { kind: "no_work_after", time: "21:30", taskCategories: ["工作"] };
  } else if (/会议后.*(\d+)\s*分钟.*缓冲/.test(text)) {
    const minutes = Number.parseInt(RegExp.$1, 10);
    type = "rule";
    title = "会议后缓冲规则";
    body = `会议后预留 ${minutes} 分钟缓冲。`;
    strength = "hard";
    rule = { kind: "buffer_after_calendar_event", minutes, appliesToEventTypes: ["meeting"] };
  } else if (/最多.*一个.*大任务|每天.*一个.*大任务/.test(text)) {
    type = "principle";
    title = "每天最多一个大任务";
    body = "每天最多安排一个大任务。";
    strength = "soft";
    rule = { kind: "max_big_tasks_per_day", count: 1 };
  } else if (/上午.*效率.*高|上午.*深度/.test(text)) {
    type = "preference";
    title = "上午深度工作偏好";
    body = "用户更适合在上午安排深度工作。";
    strength = "soft";
    rule = { kind: "prefer_task_type_window", taskType: "deep_work", start: "09:00", end: "12:00" };
  } else if (/请记住|帮我记住|记下来|以后都|我的原则是|我的习惯是|我的偏好是/.test(text)) {
    title = normalizeText(text.replace(/^(请记住|帮我记住|记下来|我的原则是|我的习惯是|我的偏好是)[：:\s]*/, ""), 24) || "用户长期偏好";
    body = text;
  } else {
    throw createWorkflowError(
      "AI_MEMORY_CANDIDATE_INCOMPLETE",
      "这段内容还不足以形成明确的长期记忆，请说明希望长期保留的偏好、原则、习惯或边界。",
      400,
    );
  }
  if (type === "review") {
    modelReadable = false;
    engineReadable = false;
  }
  const appliesTo = getMemoryAppliesTo(type, rule, body);
  const match = buildMemoryProposalMatch(type, rule, body, request.input.match);
  return finalizeMemoryProposalCandidate({
    type,
    title,
    body,
    strength,
    appliesTo,
    modelReadable,
    engineReadable,
    matchMode: Object.keys(match).length ? "any" : "global",
    match,
    rule,
    validFrom: "",
    validUntil: "",
    reviewAfter: "",
    confidence: null,
    supersedes: [],
    evidence: {
      source: "user_message",
      quote: text.slice(0, 240),
      date: currentDate,
      extraction: "legacy_heuristic_fallback",
    },
  }, request, currentDate, {
    candidateSource: "legacy_heuristic",
    normalizedFields: ["subjectKey", "matchMode", "appliesTo", "modelReadable", "engineReadable"],
  });
}

function buildPlanIntent(request, context, dateRange, action) {
  const todos = Array.isArray(request.input.todos) ? request.input.todos : [];
  const memoryRefs = context.memory.map((item) => item.memoryId).filter(Boolean);
  const orderingHints = todos.slice(0, 12).map((todo) => ({
    todoId: normalizeText(todo.id, 120),
    reason: "按优先级、截止日期、剩余时间和用户确认的时间原则排序。",
    priorityHint: /P0|P1|urgent|high/.test(String(todo.priority || "")) ? "high" : "medium",
  })).filter((hint) => hint.todoId);
  return {
    schema: PLAN_INTENT_SCHEMA,
    action,
    dateRange,
    goals: [
      action === "plan_week" ? "生成本周可确认的排程草稿" : "生成今天可确认的排程草稿",
      "避让忙碌时间、锁定任务和用户确认的硬边界",
    ],
    orderingHints,
    memoryRefs,
    warnings: [],
  };
}

function buildSchedulerInput(request, context, dateRange, action, strategy = "balanced", runtime = {}) {
  const notBefore = buildSchedulerNotBefore(request, dateRange, action, runtime.nowIso);
  const options = {
    workingWindows: Array.isArray(request.input.workingWindows) ? request.input.workingWindows : [],
    defaultGapMinutes: Number.parseInt(String(request.input.defaultGapMinutes || 5), 10) || 5,
    strategy,
    allowMoveExistingUnlocked: request.input.allowMoveExistingUnlocked !== false,
    allowSplitLongTasks: request.input.allowSplitLongTasks !== false,
    maxDays: action === "plan_week" ? 7 : 1,
  };
  if (notBefore) options.notBefore = notBefore;
  return {
    schema: "guanshi-scheduler-input-v1",
    draftId: `draft_${request.requestId}`,
    requestId: request.requestId,
    action,
    timezone: request.timezone,
    dateRange,
    todos: Array.isArray(request.input.todos) ? request.input.todos : [],
    busyBlocks: Array.isArray(request.input.busyBlocks) ? request.input.busyBlocks : [],
    memoryProjections: context.memory,
    progressSummary: request.input.progressSummary || null,
    planIntent: null,
    options,
  };
}

function buildReflowSuggestion(request, dateRange, schedulerInput = null) {
  const todos = Array.isArray(request.input.todos) ? request.input.todos : [];
  const notBefore = normalizeObject(schedulerInput?.options?.notBefore);
  const suggestedStartTime = notBefore.date === dateRange.start && notBefore.time
    ? normalizeClock(notBefore.time)
    : "09:30";
  const suggestions = todos
    .filter((todo) => !todo.planLocked)
    .slice(0, 12)
    .map((todo) => ({
      todoId: normalizeText(todo.id, 120),
      from: {
        date: normalizeText(todo.dueDate, 20),
        startTime: normalizeText(todo.startTime, 8),
      },
      to: {
        date: dateRange.start,
        startTime: suggestedStartTime,
      },
      reason: "按最小变更策略移动到最近可用时间。",
      risk: "medium",
    }))
    .filter((item) => item.todoId);
  return {
    schema: REFLOW_SUGGESTION_SCHEMA,
    sourceRequestId: request.requestId,
    strategy: "minimal_change",
    suggestions,
    requiresScheduleDraft: true,
  };
}

function normalizePlannerReviewInsights(request) {
  const review = normalizeObject(request.input.review || request.input.reviewInsight || request.input.insight);
  const source = Array.isArray(request.input.insights)
    ? request.input.insights
    : Array.isArray(review.insights)
      ? review.insights
      : [];
  return source
    .slice(0, 8)
    .map((item, index) => {
      const insight = normalizeObject(item);
      const summary = normalizeText(insight.summary || insight.title || insight.text || insight.content, 500);
      if (!summary) return null;
      const proposal = normalizeObject(insight.proposal);
      return {
        insightId: normalizeText(insight.insightId || insight.id || `insight_${request.requestId}_${String(index + 1).padStart(3, "0")}`, 120),
        type: normalizeText(insight.type || "progress_pattern", 80),
        summary,
        evidence: Object.keys(normalizeObject(insight.evidence)).length
          ? normalizeObject(insight.evidence)
          : {
            source: "planner_review_insight",
            metrics: normalizeObject(request.input.metrics),
          },
        proposal: Object.keys(proposal).length
          ? proposal
          : {
            kind: "memory_proposal",
            suggestedType: "preference",
            title: "根据复盘调整时间安排偏好",
          },
      };
    })
    .filter(Boolean);
}

function buildReviewInsight(request, currentDate) {
  const review = normalizeObject(request.input.review || request.input.reviewInsight || request.input.insight);
  const period = normalizeObject(request.input.period || review.period);
  const start = period.start || currentDate;
  const end = period.end || start;
  const plannerInsights = normalizePlannerReviewInsights(request);
  return {
    schema: REVIEW_INSIGHT_SCHEMA,
    period: { start, end },
    insights: plannerInsights.length ? plannerInsights : [
      {
        insightId: `insight_${request.requestId}_001`,
        type: "progress_pattern",
        summary: normalizeText(request.input.progressSummary || "近期执行情况需要用户确认后再沉淀为规则。", 300),
        evidence: {
          source: "summary_only",
          metrics: request.input.metrics || {},
        },
        proposal: {
          kind: "memory_proposal",
          suggestedType: "preference",
          title: "根据复盘调整时间安排偏好",
        },
      },
    ],
  };
}

function buildExploration(request) {
  return {
    schema: "guanshi-principle-exploration-v1",
    sourceRequestId: request.requestId,
    prompts: [
      "哪些时间段最适合处理深度工作？",
      "哪些时段应该避免安排工作任务？",
      "哪些习惯或边界需要在排程时被严格遵守？",
    ],
    candidateMemoryTypes: ["principle", "boundary", "preference", "rule"],
    requiresConfirmation: false,
  };
}

function getRegistryActionByLegacyAction(action) {
  if (!REGISTRY_PIPELINE_ACTIONS.has(action)) return null;
  const registry = DOMAIN_MODULES.getActionRegistry("time");
  return registry.action_registry.find((item) => item.legacy_action === action || item.action_id === `time.${action}`) || null;
}

function createStepTrace(stepId, status, output = null, extra = {}) {
  return {
    step_id: stepId,
    status,
    output_schema: normalizeText(output?.schema || extra.output_schema || "", 120),
    output_summary: normalizeText(extra.output_summary || "", 500),
  };
}

function resolveWorkflowDateRange(request, currentDate) {
  if (request.action === "reflow_unfinished") {
    const start = normalizeText(request.input.targetDate || request.input.date, 20) || addDays(currentDate, 1);
    return { start, end: start };
  }
  const review = normalizeObject(request.input.review || request.input.reviewInsight || request.input.insight);
  const period = normalizeObject(request.input.period || review.period);
  const start = normalizeText(period.start || request.input.date || request.input.targetDate, 20) || currentDate;
  if (request.action === "plan_week") return { start, end: addDays(start, 6) };
  const end = normalizeText(period.end, 20) || start;
  return { start, end };
}

const REGISTRY_STEP_HANDLERS = {
  "time.step.context.collect"(state) {
    return {
      output: {
        schema: AI_COMPOSED_CONTEXT_SCHEMA,
        requestId: state.context.requestId,
        todos: state.context.todos,
        busyBlocks: state.context.busyBlocks,
        memory: state.context.memory,
        progress: state.context.progress,
      },
      summary: `todos ${state.context.todos.length} / busyBlocks ${state.context.busyBlocks.length} / memory ${state.context.memory.length}`,
    };
  },

  "time.step.memory.project_principles"(state) {
    return {
      output: {
        schema: "guanshi-memory-projection-step-v1",
        memoryRefs: state.context.memory.map((item) => item.memoryId).filter(Boolean),
        count: state.context.memory.length,
      },
      summary: `${state.context.memory.length} 条可用记忆`,
    };
  },

  "time.step.memory.extract_candidate"(state) {
    const proposal = inferMemoryProposal(state.request, state.currentDate);
    state.result = proposal;
    return {
      output: proposal,
      summary: `${proposal.type || "memory"} / ${proposal.title || "未命名提案"}`,
    };
  },

  "time.step.draft.create_memory_proposal"(state) {
    const proposal = state.result || inferMemoryProposal(state.request, state.currentDate);
    const storedProposal = state.stores.memoryStore ? state.stores.memoryStore.createProposal({
      ...proposal,
      schema: "guanshi-ai-memory-proposal-v1",
      status: "pending_confirmation",
      createdBy: { kind: "ai", name: "guanshi-ai-workflow" },
    }) : null;
    if (storedProposal) state.artifacts.push({ kind: "memory_proposal", proposal: storedProposal });
    return {
      output: {
        schema: "guanshi-pending-memory-proposal-step-v1",
        proposalId: storedProposal?.proposalId || proposal.proposalId || "",
        status: storedProposal?.status || "pending_confirmation",
        requiresConfirmation: true,
      },
      summary: storedProposal ? "1 条待确认记忆提案" : "生成记忆提案",
    };
  },

  "time.step.semantic.explore_principles"(state) {
    const result = buildExploration(state.request);
    state.result = result;
    return {
      output: result,
      summary: `${result.prompts.length} 个探索问题`,
    };
  },

  "time.step.todo.extract_fields"(state) {
    const result = buildTaskParseResult(state.request, state.context, state.currentDate);
    state.result = result;
    return {
      output: result,
      summary: `${result.items.length} 个待办草稿`,
    };
  },

  "time.step.todo.resolve_time_fields"(state) {
    const items = Array.isArray(state.result?.items) ? state.result.items : [];
    return {
      output: {
        schema: "guanshi-task-time-resolution-step-v1",
        items: items.map((item) => ({
          draftTodoId: item.draftTodoId || "",
          dueDate: item.dueDate || "",
          startTime: item.startTime || "",
          endTime: item.endTime || "",
          estimatedMinutes: item.estimatedMinutes || 0,
          missingFields: Array.isArray(item.missingFields) ? item.missingFields : [],
        })),
      },
      summary: `${items.filter((item) => item.dueDate || item.startTime).length}/${items.length} 个草稿含时间字段`,
    };
  },

  "time.step.draft.create_todo"(state) {
    const items = Array.isArray(state.result?.items) ? state.result.items : [];
    return {
      output: {
        schema: "guanshi-pending-todo-draft-step-v1",
        count: items.length,
        requiresConfirmation: true,
        writeLocalData: false,
      },
      summary: `${items.length} 个待确认待办草稿`,
    };
  },

  "time.step.todo.resolve_target"(state) {
    const parent = resolveBreakdownParent(state.request.input);
    state.parentTask = parent;
    return {
      output: {
        schema: "guanshi-breakdown-parent-step-v1",
        todoId: normalizeText(parent.id, 120),
        title: normalizeText(parent.title || state.request.input.parentTitle || state.request.input.text || "待拆解任务", 160),
        estimatedMinutes: normalizePositiveInteger(parent.remainingMinutes || parent.estimatedMinutes, 0, 0, 24 * 60),
        dueDate: normalizeDate(parent.dueDate || parent.targetDate || parent.date),
        startTime: normalizeClock(parent.startTime || parent.time || parent.start || parent.plannedStart),
        endTime: normalizeClock(parent.endTime || parent.end || parent.plannedEnd),
      },
      summary: normalizeText(parent.title || state.request.input.parentTitle || state.request.input.text || "待拆解任务", 160),
    };
  },

  "time.step.semantic.generate_subtasks"(state) {
    const result = buildTaskBreakdownResult(state.request);
    state.result = result;
    return {
      output: result,
      summary: `${result.children.length} 个子任务`,
    };
  },

  "time.step.todo.allocate_subtask_schedule"(state) {
    const children = Array.isArray(state.result?.children) ? state.result.children : [];
    return {
      output: {
        schema: "guanshi-subtask-allocation-step-v1",
        totalEstimatedMinutes: children.reduce((sum, child) => sum + normalizePositiveInteger(child.estimatedMinutes, 0, 0, 24 * 60), 0),
        childCount: children.length,
        allocations: children.map((child) => ({
          draftTodoId: child.draftTodoId || "",
          estimatedMinutes: child.estimatedMinutes || 0,
        })),
      },
      summary: `${children.length} 个子任务 / ${state.result?.rollup?.totalEstimatedMinutes || 0} 分钟`,
    };
  },

  "time.step.todo.inherit_parent_schedule"(state) {
    const children = Array.isArray(state.result?.children) ? state.result.children : [];
    return {
      output: {
        schema: "guanshi-parent-schedule-inheritance-step-v1",
        sourceTodoId: state.result?.sourceTodoId || "",
        inheritedCount: children.filter((child) => child.dueDate || child.startTime || child.endTime).length,
        schedules: children.map((child) => ({
          draftTodoId: child.draftTodoId || "",
          dueDate: child.dueDate || "",
          startTime: child.startTime || "",
          endTime: child.endTime || "",
        })),
      },
      summary: `${children.filter((child) => child.dueDate || child.startTime || child.endTime).length}/${children.length} 个子任务继承时间`,
    };
  },

  "time.step.draft.create_todo_batch"(state) {
    const children = Array.isArray(state.result?.children) ? state.result.children : [];
    return {
      output: {
        schema: "guanshi-pending-todo-batch-step-v1",
        count: children.length,
        requiresConfirmation: true,
        writeLocalData: false,
      },
      summary: `${children.length} 个待确认子待办草稿`,
    };
  },

  "time.step.todo.resolve_completion_target"(state) {
    const target = resolveCompletionTarget(state.request.input);
    const targetTodoId = normalizeText(target.id || target.todoId, 120);
    if (!targetTodoId) {
      throw createWorkflowError("AI_TODO_COMPLETION_TARGET_REQUIRED", "Todo completion requires one explicit todo target.", 400);
    }
    state.completionTarget = target;
    return {
      output: {
        schema: "guanshi-todo-completion-target-step-v1",
        todoId: targetTodoId,
        title: normalizeText(target.title || "未命名待办", 160),
        completed: target.completed === true,
      },
      summary: normalizeText(target.title || targetTodoId, 160),
    };
  },

  "time.step.todo.normalize_completion"(state) {
    const result = buildTodoCompletionResult(
      state.request,
      state.completionTarget || resolveCompletionTarget(state.request.input),
      state.nowIso,
    );
    state.result = result;
    const item = result.items[0];
    return {
      output: result,
      summary: `${item.targetTitle} / ${item.completion.calendarBlock.date} ${item.completion.calendarBlock.start}-${item.completion.calendarBlock.end}`,
    };
  },

  "time.step.draft.create_todo_completion"(state) {
    const items = Array.isArray(state.result?.items) ? state.result.items : [];
    return {
      output: {
        schema: "guanshi-pending-todo-completion-step-v1",
        count: items.length,
        targetTodoIds: items.map((item) => item.targetTodoId).filter(Boolean),
        requiresConfirmation: items.length > 0,
        writeLocalData: false,
      },
      summary: `${items.length} 个待确认完成草稿`,
    };
  },

  "time.step.time.resolve_reference_scope"(state) {
    state.dateRange = resolveWorkflowDateRange(state.request, state.currentDate);
    return {
      output: {
        schema: "guanshi-reference-scope-step-v1",
        action: state.request.action,
        dateRange: state.dateRange,
        todosCount: state.context.todos.length,
        busyBlocksCount: state.context.busyBlocks.length,
        memoryCount: state.context.memory.length,
        progressIncluded: state.context.progress.included,
      },
      summary: `${state.dateRange.start} 至 ${state.dateRange.end}`,
    };
  },

  "time.step.todo.collect_unfinished"(state) {
    const todos = Array.isArray(state.request.input.todos) ? state.request.input.todos : [];
    const movableTodos = todos.filter((todo) => !todo.planLocked);
    state.unfinishedTodos = movableTodos;
    return {
      output: {
        schema: "guanshi-unfinished-todos-step-v1",
        count: movableTodos.length,
        todoIds: movableTodos.map((todo) => normalizeText(todo.id, 120)).filter(Boolean),
      },
      summary: `${movableTodos.length} 个可重排任务`,
    };
  },

  "time.step.scheduler.build_input"(state) {
    state.dateRange = state.dateRange || resolveWorkflowDateRange(state.request, state.currentDate);
    const strategy = state.request.action === "reflow_unfinished"
      ? "minimal_change"
      : state.request.input.strategy || "balanced";
    state.schedulerInput = buildSchedulerInput(state.request, state.context, state.dateRange, state.request.action, strategy, {
      nowIso: state.nowIso,
    });
    const notBeforeSummary = state.schedulerInput.options.notBefore
      ? ` / 不早于 ${state.schedulerInput.options.notBefore.date} ${state.schedulerInput.options.notBefore.time}`
      : "";
    return {
      output: {
        schema: "guanshi-scheduler-input-step-v1",
        schedulerInputSchema: state.schedulerInput.schema,
        draftId: state.schedulerInput.draftId,
        action: state.schedulerInput.action,
        dateRange: state.schedulerInput.dateRange,
        todosCount: state.schedulerInput.todos.length,
        busyBlocksCount: state.schedulerInput.busyBlocks.length,
        strategy: state.schedulerInput.options.strategy,
        notBefore: state.schedulerInput.options.notBefore || null,
      },
      summary: `${state.schedulerInput.action} / ${state.schedulerInput.todos.length} 个待办 / ${state.schedulerInput.busyBlocks.length} 个占用块${notBeforeSummary}`,
    };
  },

  "time.step.scheduler.generate_day_plan"(state) {
    const result = buildPlanIntent(state.request, state.context, state.dateRange, state.request.action);
    state.result = result;
    return {
      output: result,
      summary: `${result.orderingHints.length} 个排序提示`,
    };
  },

  "time.step.scheduler.generate_week_plan"(state) {
    const result = buildPlanIntent(state.request, state.context, state.dateRange, state.request.action);
    state.result = result;
    return {
      output: result,
      summary: `${result.orderingHints.length} 个排序提示`,
    };
  },

  "time.step.scheduler.generate_reflow"(state) {
    state.dateRange = state.dateRange || resolveWorkflowDateRange(state.request, state.currentDate);
    const result = buildReflowSuggestion(state.request, state.dateRange, state.schedulerInput);
    state.result = result;
    return {
      output: result,
      summary: `${result.suggestions.length} 条重排建议`,
    };
  },

  "time.step.draft.create_schedule"(state) {
    const schedulerInput = state.schedulerInput || buildSchedulerInput(
      state.request,
      state.context,
      state.dateRange || resolveWorkflowDateRange(state.request, state.currentDate),
      state.request.action,
      state.request.action === "reflow_unfinished" ? "minimal_change" : (state.request.input.strategy || "balanced"),
      { nowIso: state.nowIso },
    );
    const draft = state.stores.draftStore ? state.stores.draftStore.createDraft(schedulerInput) : null;
    const actionable = Boolean(draft && Array.isArray(draft.changes) && draft.changes.length);
    if (actionable) {
      state.artifacts.push({ kind: "schedule_draft", draft });
    } else if (state.result && typeof state.result === "object") {
      state.result = {
        ...state.result,
        ...(Object.prototype.hasOwnProperty.call(state.result, "requiresScheduleDraft") ? { requiresScheduleDraft: false } : {}),
        warnings: [
          ...(Array.isArray(state.result.warnings) ? state.result.warnings : []),
          {
            code: "no_actionable_schedule_changes",
            message: draft?.conflicts?.length
              ? "当前约束下没有可执行的排程变更，请先处理冲突或调整范围。"
              : "当前范围没有可重排的任务，因此未创建待确认草稿。",
          },
        ],
      };
    }
    return {
      output: {
        schema: "guanshi-pending-schedule-draft-step-v1",
        draftId: draft?.draftId || schedulerInput.draftId || "",
        status: draft?.status || "not_created",
        changeCount: Array.isArray(draft?.changes) ? draft.changes.length : 0,
        requiresConfirmation: actionable,
      },
      summary: actionable ? `${draft.changes.length} 条排程变更待确认` : "没有可确认的排程变更",
    };
  },

  "time.step.review.collect_entries"(state) {
    const evidence = {
      schema: "guanshi-review-evidence-step-v1",
      period: state.dateRange || { start: state.currentDate, end: state.currentDate },
      todosCount: state.context.todos.length,
      busyBlocksCount: state.context.busyBlocks.length,
      progressSummary: state.context.progress.summary,
      metrics: normalizeObject(state.request.input.metrics),
    };
    state.reviewEvidence = evidence;
    return {
      output: evidence,
      summary: `todos ${evidence.todosCount} / busyBlocks ${evidence.busyBlocksCount} / progress ${evidence.progressSummary ? "有" : "无"}`,
    };
  },

  "time.step.review.generate_insight"(state) {
    const result = buildReviewInsight(state.request, state.currentDate);
    state.result = result;
    return {
      output: result,
      summary: `${result.insights.length} 条洞察`,
    };
  },

  "time.step.policy.confirm_draft"(state) {
    const itemCount = Array.isArray(state.result?.items)
      ? state.result.items.length
      : Array.isArray(state.result?.children)
        ? state.result.children.length
        : 0;
    const artifactCount = state.artifacts.length;
    const pendingCount = itemCount || artifactCount;
    return {
      output: {
        schema: "guanshi-pending-confirmation-step-v1",
        action: state.request.action,
        itemCount: pendingCount,
        artifactCount,
        requiresConfirmation: pendingCount > 0,
        writeLocalDataBeforeConfirmation: false,
      },
      summary: pendingCount ? `${pendingCount} 项等待用户确认` : "没有可确认产物",
    };
  },

  "time.step.writer.compose_answer"(state) {
    return {
      output: {
        schema: "guanshi-workflow-writer-boundary-v1",
        note: "Workflow stops at structured result; Writer composes the visible answer after workflow.",
        resultSchema: state.result?.schema || "",
      },
      summary: "交给 Writer 组织最终回复",
    };
  },
};

function executeRegistryWorkflow(registryAction, request, context, stores, options = {}) {
  const state = {
    request,
    context,
    stores,
    nowIso: options.nowIso,
    currentDate: options.currentDate,
    result: null,
    artifacts: [],
    stepOutputs: {},
  };
  const steps = [];
  for (const stepId of normalizeStringList(registryAction.steps, 40, 120)) {
    const handler = REGISTRY_STEP_HANDLERS[stepId];
    if (typeof handler !== "function") {
      throw createWorkflowError("AI_WORKFLOW_STEP_UNSUPPORTED", "AI workflow step is not supported.", 400, {
        action: request.action,
        action_id: registryAction.action_id,
        step_id: stepId,
      });
    }
    const { output, summary } = handler(state) || {};
    state.stepOutputs[stepId] = output || null;
    steps.push(createStepTrace(stepId, "completed", output, { output_summary: summary }));
  }
  if (!state.result) {
    throw createWorkflowError("AI_WORKFLOW_RESULT_MISSING", "AI workflow pipeline did not produce a result.", 500, {
      action: request.action,
      action_id: registryAction.action_id,
    });
  }
  return {
    request,
    context,
    result: state.result,
    artifacts: state.artifacts,
    execution: {
      schema: AI_WORKFLOW_EXECUTION_SCHEMA,
      mode: "registry_pipeline",
      action_id: registryAction.action_id,
      legacy_action: registryAction.legacy_action || request.action,
      step_count: steps.length,
      steps,
    },
  };
}

function executeAiWorkflow(rawRequest, stores = {}, options = {}) {
  const nowIso = typeof options.now === "function" ? options.now() : new Date().toISOString();
  const currentDate = normalizeText(rawRequest?.input?.currentDate, 20) || getCurrentDate(nowIso);
  const request = normalizeActionRequest(rawRequest, nowIso);
  const context = composeContext(request, stores, nowIso);
  const registryAction = getRegistryActionByLegacyAction(request.action);
  if (registryAction?.execution_mode === "registry_pipeline") {
    return executeRegistryWorkflow(registryAction, request, context, stores, { nowIso, currentDate });
  }

  if (request.action === "explore_principles") {
    return { request, context, result: buildExploration(request), artifacts: [] };
  }
  if (request.action === "parse_task") {
    return { request, context, result: buildTaskParseResult(request, context, currentDate), artifacts: [] };
  }
  if (request.action === "breakdown_task") {
    return { request, context, result: buildTaskBreakdownResult(request), artifacts: [] };
  }
  if (request.action === "complete_task") {
    return {
      request,
      context,
      result: buildTodoCompletionResult(request, resolveCompletionTarget(request.input), nowIso),
      artifacts: [],
    };
  }
  if (request.action === "save_memory_proposal") {
    const proposal = inferMemoryProposal(request, currentDate);
    const storedProposal = stores.memoryStore ? stores.memoryStore.createProposal({
      ...proposal,
      schema: "guanshi-ai-memory-proposal-v1",
      status: "pending_confirmation",
      createdBy: { kind: "ai", name: "guanshi-ai-workflow" },
    }) : null;
    return { request, context, result: proposal, artifacts: storedProposal ? [{ kind: "memory_proposal", proposal: storedProposal }] : [] };
  }

  if (request.action === "plan_today" || request.action === "plan_week") {
    const start = normalizeText(request.input.date || request.input.targetDate, 20) || currentDate;
    const end = request.action === "plan_week" ? addDays(start, 6) : start;
    const dateRange = { start, end };
    const planIntent = buildPlanIntent(request, context, dateRange, request.action);
    const schedulerInput = buildSchedulerInput(request, context, dateRange, request.action, request.input.strategy || "balanced", {
      nowIso,
    });
    const draft = stores.draftStore ? stores.draftStore.createDraft(schedulerInput) : null;
    const actionable = Boolean(draft && Array.isArray(draft.changes) && draft.changes.length);
    if (!actionable) {
      planIntent.warnings = [
        ...(Array.isArray(planIntent.warnings) ? planIntent.warnings : []),
        { code: "no_actionable_schedule_changes", message: "当前范围没有生成可执行的排程变更。" },
      ];
    }
    return {
      request,
      context,
      result: planIntent,
      artifacts: actionable ? [{ kind: "schedule_draft", draft }] : [],
    };
  }

  if (request.action === "reflow_unfinished") {
    const start = normalizeText(request.input.targetDate || request.input.date, 20) || addDays(currentDate, 1);
    const dateRange = { start, end: start };
    const schedulerInput = buildSchedulerInput(request, context, dateRange, "reflow_unfinished", "minimal_change", {
      nowIso,
    });
    const suggestion = buildReflowSuggestion(request, dateRange, schedulerInput);
    const draft = stores.draftStore ? stores.draftStore.createDraft(schedulerInput) : null;
    const actionable = Boolean(draft && Array.isArray(draft.changes) && draft.changes.length);
    if (!actionable) {
      suggestion.requiresScheduleDraft = false;
      suggestion.warnings = [{ code: "no_actionable_schedule_changes", message: "当前范围没有可重排的任务或没有可用时间。" }];
    }
    return {
      request,
      context,
      result: suggestion,
      artifacts: actionable ? [{ kind: "schedule_draft", draft }] : [],
    };
  }

  if (request.action === "review_day") {
    return { request, context, result: buildReviewInsight(request, currentDate), artifacts: [] };
  }

  throw createWorkflowError("AI_ACTION_UNSUPPORTED", "AI action is not supported.", 400, { action: request.action });
}

module.exports = {
  AI_ACTION_REQUEST_SCHEMA,
  executeAiWorkflow,
  normalizeActionRequest,
};
