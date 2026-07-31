"use strict";

const MODEL_MEMORY_CONTEXT_SCHEMA = "guanshi-ai-model-memory-context-v1";

const MEMORY_TYPE_ORDER = ["profile", "preference", "habit", "principle", "boundary", "rule", "playbook"];
const MEMORY_TYPE_LABELS = {
  profile: "时间管理画像",
  preference: "偏好",
  habit: "习惯",
  principle: "原则",
  boundary: "边界",
  rule: "规则",
  playbook: "经验方法",
  capability_request: "能力需求",
};

function normalizeText(value, maxLength = 4000) {
  return String(value || "").trim().slice(0, maxLength);
}

function normalizeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeStringList(value, maxItems = 16) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => normalizeText(item, 80)).filter(Boolean).slice(0, maxItems);
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeMemoryPolicy(rawPolicy = {}, config = {}) {
  const source = normalizeObject(rawPolicy);
  const defaultMode = normalizeText(config.defaultInjectionMode || "active_relevant", 80);
  const includeMemory = normalizeText(source.includeMemory || defaultMode || "active_relevant", 80);
  const configuredMax = parsePositiveInt(config.maxInjectedEntries, 12);
  const requestedMax = parsePositiveInt(source.maxItems, configuredMax);
  return {
    includeMemory,
    maxItems: Math.max(1, Math.min(24, requestedMax, configuredMax || 12)),
  };
}

function shouldIncludeMemoryMode(mode) {
  const value = normalizeText(mode, 80).toLowerCase();
  return !["none", "off", "false", "disabled", "disabled_only"].includes(value);
}

function normalizeAction(value) {
  const action = normalizeText(value, 100);
  if (!action) return "";
  const parts = action.split(".");
  return parts[parts.length - 1] || action;
}

function entryAppliesToAction(entry, action) {
  const actionName = normalizeAction(action);
  if (!actionName) return true;
  const appliesTo = normalizeStringList(entry?.appliesTo, 16);
  if (!appliesTo.length) return true;
  const normalizedAppliesTo = appliesTo.map(normalizeAction).filter(Boolean);
  return normalizedAppliesTo.includes(actionName)
    || normalizedAppliesTo.includes("assistant")
    || (["plan_today", "plan_week", "reflow_unfinished"].includes(actionName) && normalizedAppliesTo.includes("schedule_draft"));
}

function getTypeOrder(type) {
  const index = MEMORY_TYPE_ORDER.indexOf(type);
  return index >= 0 ? index : MEMORY_TYPE_ORDER.length;
}

function sortPromptEntries(entries) {
  return [...entries].sort((left, right) => {
    const typeDiff = getTypeOrder(left.type) - getTypeOrder(right.type);
    if (typeDiff !== 0) return typeDiff;
    return String(right.updatedAt || "").localeCompare(String(left.updatedAt || ""));
  });
}

function sanitizePromptEntry(entry) {
  const rule = normalizeObject(entry?.rule);
  return {
    memoryId: normalizeText(entry?.id, 100),
    type: normalizeText(entry?.type, 40),
    typeLabel: MEMORY_TYPE_LABELS[entry?.type] || normalizeText(entry?.type || "memory", 40),
    title: normalizeText(entry?.title || "未命名记忆", 160),
    strength: normalizeText(entry?.strength || "soft", 40),
    appliesTo: normalizeStringList(entry?.appliesTo, 16),
    body: normalizeText(entry?.body, 900),
    rule: Object.keys(rule).length ? rule : null,
    updatedAt: normalizeText(entry?.updatedAt, 80),
  };
}

function buildDisabledMemoryContext(reason, extra = {}) {
  return {
    schema: MODEL_MEMORY_CONTEXT_SCHEMA,
    included: false,
    reason,
    mode: "",
    maxItems: 0,
    count: 0,
    entries: [],
    ...extra,
  };
}

function buildModelMemoryContext(options = {}) {
  const memoryStore = options.memoryStore;
  if (!memoryStore || typeof memoryStore.readConfig !== "function" || typeof memoryStore.listEntries !== "function") {
    return buildDisabledMemoryContext("memory_store_unavailable");
  }

  let config;
  try {
    config = memoryStore.readConfig();
  } catch {
    return buildDisabledMemoryContext("memory_config_unreadable");
  }

  const policy = normalizeMemoryPolicy(options.contextPolicy || options.request?.contextPolicy, config);
  if (!shouldIncludeMemoryMode(policy.includeMemory)) {
    return buildDisabledMemoryContext("request_policy_disabled", {
      mode: policy.includeMemory,
      maxItems: policy.maxItems,
    });
  }
  if (config.enabled === false) {
    return buildDisabledMemoryContext("memory_disabled", {
      mode: policy.includeMemory,
      maxItems: policy.maxItems,
    });
  }
  if (config.autoInject === false) {
    return buildDisabledMemoryContext("memory_auto_inject_disabled", {
      mode: policy.includeMemory,
      maxItems: policy.maxItems,
    });
  }
  if (config.allowExternalAgentRead === false) {
    return buildDisabledMemoryContext("memory_external_read_disabled", {
      mode: policy.includeMemory,
      maxItems: policy.maxItems,
    });
  }

  let entries;
  try {
    entries = memoryStore.listEntries();
  } catch {
    return buildDisabledMemoryContext("memory_entries_unreadable", {
      mode: policy.includeMemory,
      maxItems: policy.maxItems,
    });
  }

  const action = normalizeAction(options.action || options.request?.intentHint || "");
  const promptEntries = sortPromptEntries(entries)
    .filter((entry) => entry?.status === "active")
    .filter((entry) => entry?.userConfirmed === true)
    .filter((entry) => entry?.engineReadable !== false)
    .filter((entry) => !["review", "capability_request"].includes(entry?.type))
    .filter((entry) => entryAppliesToAction(entry, action))
    .slice(0, policy.maxItems)
    .map(sanitizePromptEntry)
    .filter((entry) => entry.memoryId && entry.body);

  return {
    schema: MODEL_MEMORY_CONTEXT_SCHEMA,
    included: promptEntries.length > 0,
    reason: promptEntries.length > 0 ? "included" : "no_confirmed_memory",
    mode: policy.includeMemory,
    maxItems: policy.maxItems,
    count: promptEntries.length,
    action,
    entries: promptEntries,
  };
}

function summarizeModelMemoryContext(memoryContext = {}) {
  const context = normalizeObject(memoryContext);
  const entries = Array.isArray(context.entries) ? context.entries : [];
  return {
    schema: MODEL_MEMORY_CONTEXT_SCHEMA,
    included: context.included === true,
    reason: normalizeText(context.reason, 80),
    mode: normalizeText(context.mode, 80),
    count: entries.length,
    action: normalizeText(context.action, 100),
    entries: entries.map((entry) => ({
      memoryId: normalizeText(entry.memoryId, 100),
      type: normalizeText(entry.type, 40),
      title: normalizeText(entry.title, 160),
      strength: normalizeText(entry.strength, 40),
      appliesTo: normalizeStringList(entry.appliesTo, 16),
      hasRule: !!entry.rule,
    })),
  };
}

function formatRule(rule) {
  if (!rule || typeof rule !== "object" || Array.isArray(rule)) return "";
  try {
    return normalizeText(JSON.stringify(rule), 900);
  } catch {
    return "";
  }
}

function renderModelMemoryPromptBlock(memoryContext = {}) {
  const context = normalizeObject(memoryContext);
  const entries = Array.isArray(context.entries) ? context.entries : [];
  if (context.included !== true || !entries.length) return "";

  const lines = [
    "## 已确认的用户时间记忆",
    "",
    "以下内容来自用户已确认的本地记忆。把它作为理解用户偏好、原则、习惯和时间边界的上下文；如果和本轮明确要求冲突，以本轮要求为准。",
    "它只能帮助你理解和表达；任何会改变待办、日历、提醒、排程或记忆的事项，仍必须走受控工具并等待用户在观时 UI 确认。",
  ];

  let currentType = "";
  for (const entry of entries) {
    if (entry.type !== currentType) {
      currentType = entry.type;
      lines.push("", `### ${entry.typeLabel || MEMORY_TYPE_LABELS[currentType] || currentType}`);
    }
    const appliesTo = entry.appliesTo.length ? `；适用：${entry.appliesTo.join("、")}` : "";
    lines.push(`- ${entry.title}（${entry.strength || "soft"}${appliesTo}）：${entry.body}`);
    const rule = formatRule(entry.rule);
    if (rule) lines.push(`  - 结构化规则：${rule}`);
  }

  return normalizeText(lines.join("\n"), 8000);
}

module.exports = {
  MODEL_MEMORY_CONTEXT_SCHEMA,
  buildModelMemoryContext,
  renderModelMemoryPromptBlock,
  summarizeModelMemoryContext,
};
