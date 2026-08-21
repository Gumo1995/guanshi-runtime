"use strict";

const {
  normalizeAction,
  selectMemoriesForTurn,
} = require("./ai-memory-selector");

const MODEL_MEMORY_CONTEXT_SCHEMA = "guanshi-ai-model-memory-context-v1";

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
  const defaultPromptMax = parsePositiveInt(config.defaultPromptMaxEntries, 5);
  const requestedMax = parsePositiveInt(source.maxMemoryItems || source.memoryMaxItems || source.memoryLimit, 0);
  const selectedMax = requestedMax || defaultPromptMax || 5;
  return {
    includeMemory,
    maxItems: Math.max(1, Math.min(24, selectedMax, configuredMax || 12)),
  };
}

function shouldIncludeMemoryMode(mode) {
  const value = normalizeText(mode, 80).toLowerCase();
  return !["none", "off", "false", "disabled", "disabled_only"].includes(value);
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
    excluded: [],
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
  const policyMode = ["legacy", "shadow", "strict_v2"].includes(config.memoryPolicyMode)
    ? config.memoryPolicyMode
    : "strict_v2";
  const selectorInput = {
    entries,
    role: options.role || "planner",
    action,
    request: options.request,
    userText: options.userText || options.request?.text,
    selectedObjects: options.selectedObjects,
    pageWorkContext: options.pageWorkContext,
    globalBackgroundContext: options.globalBackgroundContext,
    maxItems: policy.maxItems,
    now: options.now,
  };
  let selection;
  if (policyMode === "shadow") {
    const legacySelection = selectMemoriesForTurn({ ...selectorInput, policyMode: "legacy" });
    const strictSelection = selectMemoriesForTurn({ ...selectorInput, policyMode: "strict_v2" });
    selection = legacySelection;
    try {
      memoryStore.recordSelectorShadowComparison?.({
        action,
        legacyMemoryIds: legacySelection.entries.map((entry) => entry.memoryId),
        strictMemoryIds: strictSelection.entries.map((entry) => entry.memoryId),
      });
    } catch {
      // Shadow auditing must never block the model-facing legacy selection.
    }
  } else {
    selection = selectMemoriesForTurn({ ...selectorInput, policyMode });
  }

  return {
    schema: MODEL_MEMORY_CONTEXT_SCHEMA,
    selectionSchema: selection.schema,
    included: selection.included,
    reason: selection.reason,
    policyMode,
    mode: policy.includeMemory,
    maxItems: policy.maxItems,
    count: selection.count,
    role: selection.role,
    action,
    entries: selection.entries.map((entry) => ({
      ...entry,
      typeLabel: MEMORY_TYPE_LABELS[entry.type] || normalizeText(entry.type || "memory", 40),
    })),
    excluded: selection.excluded,
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
      match: normalizeObject(entry.match),
      projection: normalizeText(entry.projection, 300),
      reason: normalizeText(entry.reason, 300),
      usedBy: normalizeText(entry.usedBy, 40),
      hasRule: entry.hasRule === true,
    })),
    excluded: Array.isArray(context.excluded)
      ? context.excluded.slice(0, 24).map((entry) => ({
        memoryId: normalizeText(entry.memoryId, 100),
        type: normalizeText(entry.type, 40),
        title: normalizeText(entry.title, 160),
        reason: normalizeText(entry.reason, 120),
        usedBy: normalizeText(entry.usedBy, 40),
      }))
      : [],
  };
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

  for (const entry of entries) {
    lines.push(`- ${normalizeText(entry.projection, 300) || `[${entry.strength || "soft"} ${entry.type || "memory"}] ${entry.body}`}`);
  }

  return normalizeText(lines.join("\n"), 8000);
}

module.exports = {
  MODEL_MEMORY_CONTEXT_SCHEMA,
  buildModelMemoryContext,
  renderModelMemoryPromptBlock,
  summarizeModelMemoryContext,
};
