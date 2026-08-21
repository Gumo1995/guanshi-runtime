"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const { createAiDraftStore } = require("./ai-draft-store");
const { createAiMemoryStore } = require("./ai-memory-store");
const { redactSensitiveValue } = require("./ai-redaction");
const {
  AI_ACTION_REVIEW_SCHEMA,
  reviewMcpToolDefinition,
} = require("./ai-action-governance");

const MCP_STATUS_SCHEMA = "guanshi-mcp-status-v1";
const MCP_TOOL_LIST_SCHEMA = "guanshi-mcp-tool-list-v1";
const MCP_TODO_LIST_SCHEMA = "guanshi-mcp-todo-list-v1";
const MCP_TODO_SCHEMA = "guanshi-mcp-todo-v1";
const MCP_BUSY_BLOCKS_SCHEMA = "guanshi-mcp-busy-blocks-v1";
const MCP_MEMORY_LIST_SCHEMA = "guanshi-mcp-memory-list-v1";
const MCP_MEMORY_SCHEMA = "guanshi-mcp-memory-v1";
const MCP_PROGRESS_SUMMARY_SCHEMA = "guanshi-mcp-progress-summary-v1";
const MCP_SCHEDULE_CONTEXT_SCHEMA = "guanshi-mcp-schedule-context-v1";
const MCP_DRAFT_LIST_SCHEMA = "guanshi-mcp-draft-list-v1";
const MCP_DRAFT_SCHEMA = "guanshi-mcp-draft-v1";
const MCP_PROPOSAL_SCHEMA = "guanshi-mcp-proposal-v1";
const MCP_CREATE_DRAFT_RESULT_SCHEMA = "guanshi-mcp-create-draft-result-v1";
const MCP_MEMORY_PROPOSAL_RESULT_SCHEMA = "guanshi-mcp-memory-proposal-result-v1";
const MCP_REVIEW_INSIGHT_RESULT_SCHEMA = "guanshi-mcp-review-insight-result-v1";
const LOCAL_DATA_BACKUP_SCHEMA = "timequality-local-storage-export-v1";

const TODO_STORAGE_KEY = "time_quality_todos_v1";
const JOURNAL_STORAGE_KEY = "time_quality_journal_v1";

const BUILT_IN_PROFILES = {
  "codex-local": {
    clientId: "codex-local",
    displayName: "Codex",
    kind: "codex",
    enabled: true,
    scopes: [
      "read_status",
      "read_todos",
      "read_calendar_busy",
      "read_memory_summary",
      "read_memory_detail",
      "read_progress_summary",
      "read_drafts",
      "create_task_draft",
      "create_schedule_draft",
      "propose_memory",
      "create_review_insight",
    ],
  },
  "claude-local": {
    clientId: "claude-local",
    displayName: "Claude",
    kind: "claude",
    enabled: true,
    scopes: [
      "read_status",
      "read_todos",
      "read_calendar_busy",
      "read_memory_summary",
      "read_memory_detail",
      "read_progress_summary",
      "read_drafts",
      "create_task_draft",
      "create_schedule_draft",
      "propose_memory",
      "create_review_insight",
    ],
  },
  "hermes-local": {
    clientId: "hermes-local",
    displayName: "Hermes",
    kind: "hermes",
    enabled: true,
    scopes: [
      "read_status",
      "read_todos",
      "read_calendar_busy",
      "read_memory_summary",
      "read_memory_detail",
      "read_progress_summary",
      "read_drafts",
      "create_task_draft",
      "create_schedule_draft",
      "propose_memory",
      "create_review_insight",
    ],
  },
  "custom-readonly": {
    clientId: "custom-readonly",
    displayName: "Custom",
    kind: "custom",
    enabled: true,
    scopes: [
      "read_status",
      "read_todos",
      "read_calendar_busy",
      "read_memory_summary",
      "read_progress_summary",
      "read_drafts",
    ],
  },
};

const TOOL_DEFINITIONS = [
  {
    name: "guanshi.get_status",
    description: "Read Guanshi version, MCP capabilities, and data availability without Provider config.",
    scope: "read_status",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "guanshi.list_active_todos",
    description: "Read active todo summaries with normalized planning fields.",
    scope: "read_todos",
    inputSchema: {
      type: "object",
      properties: {
        dateFrom: { type: "string" },
        dateTo: { type: "string" },
        status: { type: "array", items: { type: "string" } },
        limit: { type: "integer", minimum: 1, maximum: 200 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "guanshi.get_todo",
    description: "Read one normalized todo summary.",
    scope: "read_todos",
    inputSchema: {
      type: "object",
      required: ["todoId"],
      properties: {
        todoId: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "guanshi.get_busy_blocks",
    description: "Read calendar and planned busy blocks with titles and external ids omitted.",
    scope: "read_calendar_busy",
    inputSchema: {
      type: "object",
      properties: {
        dateFrom: { type: "string" },
        dateTo: { type: "string" },
        sources: { type: "array", items: { type: "string" } },
      },
      additionalProperties: false,
    },
  },
  {
    name: "guanshi.list_memory",
    description: "Read active memory summaries only.",
    scope: "read_memory_summary",
    inputSchema: {
      type: "object",
      properties: {
        types: { type: "array", items: { type: "string" } },
        limit: { type: "integer", minimum: 1, maximum: 100 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "guanshi.get_memory",
    description: "Read one active memory entry body when the client has memory-detail scope.",
    scope: "read_memory_detail",
    inputSchema: {
      type: "object",
      required: ["memoryId"],
      properties: {
        memoryId: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "guanshi.get_progress_summary",
    description: "Read derived execution progress summary. It cannot become a rule directly.",
    scope: "read_progress_summary",
    inputSchema: {
      type: "object",
      properties: {
        window: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "guanshi.get_schedule_context",
    description: "Read minimal scheduling context: todos, busy blocks, memory projections, and progress summary.",
    scopes: ["read_todos", "read_calendar_busy", "read_memory_summary", "read_progress_summary"],
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string" },
        horizonDays: { type: "integer", minimum: 1, maximum: 31 },
        includeMemory: { type: "boolean" },
        includeProgress: { type: "boolean" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "guanshi.list_drafts",
    description: "Read MCP-created draft summaries.",
    scope: "read_drafts",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "array", items: { type: "string" } },
        source: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 100 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "guanshi.get_draft",
    description: "Read one MCP draft or schedule draft detail without changing status.",
    scope: "read_drafts",
    inputSchema: {
      type: "object",
      required: ["draftId"],
      properties: {
        draftId: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "guanshi.create_task_draft",
    description: "Create a pending task draft. This never creates a real todo.",
    scope: "create_task_draft",
    inputSchema: {
      type: "object",
      required: ["clientRequestId", "title"],
      properties: {
        clientRequestId: { type: "string" },
        title: { type: "string" },
        notes: { type: "string" },
        suggestedFields: { type: "object" },
        reason: { type: "string" },
      },
      additionalProperties: true,
    },
  },
  {
    name: "guanshi.create_schedule_draft",
    description: "Create a pending schedule draft after Guanshi scheduler validation. This never applies the plan.",
    scope: "create_schedule_draft",
    inputSchema: {
      type: "object",
      required: ["clientRequestId"],
      properties: {
        clientRequestId: { type: "string" },
        date: { type: "string" },
        intent: { type: "string" },
        strategy: { type: "string" },
        todos: { type: "array" },
        busyBlocks: { type: "array" },
        workingWindows: { type: "array" },
        proposedBlocks: { type: "array" },
        reason: { type: "string" },
      },
      additionalProperties: true,
    },
  },
  {
    name: "guanshi.propose_memory_entry",
    description: "Create a pending memory proposal. This never writes active memory.",
    scope: "propose_memory",
    inputSchema: {
      type: "object",
      required: ["clientRequestId", "type", "title", "body"],
      properties: {
        clientRequestId: { type: "string" },
        type: { type: "string" },
        title: { type: "string" },
        body: { type: "string" },
        evidence: { type: "array", items: { type: "string" } },
        scope: { type: "array", items: { type: "string" } },
        confidence: { type: "string" },
      },
      additionalProperties: true,
    },
  },
  {
    name: "guanshi.create_review_insight",
    description: "Create a pending review insight. It cannot become memory directly.",
    scope: "create_review_insight",
    inputSchema: {
      type: "object",
      required: ["clientRequestId"],
      properties: {
        clientRequestId: { type: "string" },
        window: { type: "string" },
        insights: { type: "array" },
      },
      additionalProperties: true,
    },
  },
  {
    name: "guanshi.apply_draft",
    description: "Disabled in v1.6.0. Drafts must be confirmed inside Guanshi UI.",
    scope: "apply_draft",
    disabled: true,
    inputSchema: {
      type: "object",
      properties: {
        draftId: { type: "string" },
      },
      additionalProperties: true,
    },
  },
];

function createMcpError(code, message, retryable = false, details = {}) {
  const error = new Error(message || code);
  error.code = code;
  error.retryable = Boolean(retryable);
  error.details = details && typeof details === "object" ? details : {};
  return error;
}

function normalizeText(value, maxLength = 4000) {
  return String(value || "").trim().slice(0, maxLength);
}

function getDefaultMemoryScope(type, rule = {}) {
  const memoryType = normalizeText(type, 40);
  const kind = normalizeText(rule?.kind, 80);
  if (kind === "no_work_after") return ["assistant", "parse_task", "plan_today", "plan_week", "reflow_unfinished", "schedule_draft"];
  if (["task_duration_estimate", "task_duration_policy", "task_estimation", "breakdown_time_allocation"].includes(kind)) {
    return ["assistant", "parse_task", "breakdown_task"];
  }
  if (memoryType === "playbook" || kind === "workflow_playbook") return ["assistant", "breakdown_task", "review_day"];
  return ["plan_today", "plan_week", "reflow_unfinished", "schedule_draft"];
}

function clampInteger(value, fallback, min, max) {
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

function addDays(dateText, days) {
  const date = parseDate(dateText);
  if (!date) return "";
  date.setDate(date.getDate() + days);
  return formatDate(date);
}

function parseClockToMinutes(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(normalizeText(value, 8));
  if (!match) return null;
  const hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function formatClock(minutes) {
  const safe = Math.max(0, Math.min(24 * 60 - 1, Math.floor(minutes)));
  return `${pad2(Math.floor(safe / 60))}:${pad2(safe % 60)}`;
}

function makeSafeId(value, fallback = "mcp") {
  const text = normalizeText(value, 120)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return (text || fallback).slice(0, 96);
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function hashPayload(value) {
  return crypto.createHash("sha256").update(stableStringify(value)).digest("hex");
}

function readJsonIfExists(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw createMcpError("CONTEXT_UNAVAILABLE", "Local context could not be read.", true);
  }
}

function writeJsonAtomic(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, filePath);
}

function parseStoredArray(value) {
  if (Array.isArray(value)) return value;
  const text = normalizeText(value, 2 * 1024 * 1024);
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function sanitizeAiMeta(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return {
    summary: normalizeText(value.summary, 240),
  };
}

function normalizeTodoSummary(raw = {}, index = 0) {
  const id = normalizeText(raw.id || `todo_${index}`, 120);
  const dueDate = normalizeText(raw.dueDate || raw.date, 20);
  const startTime = normalizeText(raw.startTime || raw.plannedStart, 8);
  const endTime = normalizeText(raw.endTime || raw.plannedEnd, 8);
  const estimatedMinutes = clampInteger(raw.estimatedMinutes, 45, 0, 24 * 60);
  const remainingMinutes = raw.completed === true ? 0 : clampInteger(raw.remainingMinutes, estimatedMinutes || 45, 0, 24 * 60);
  return {
    id,
    title: normalizeText(raw.title || "未命名待办", 200),
    status: raw.completed === true ? "completed" : startTime && endTime ? "doing" : "todo",
    date: dueDate,
    plannedStart: startTime,
    plannedEnd: endTime,
    durationMinutes: estimatedMinutes,
    remainingMinutes,
    priority: normalizeText(raw.priority || "P2", 20),
    importance: Number.isFinite(Number(raw.importance)) ? Number(raw.importance) : 0,
    urgency: Number.isFinite(Number(raw.urgency)) ? Number(raw.urgency) : 0,
    taskType: normalizeText(raw.taskType || "other", 40),
    energyLevel: normalizeText(raw.energyLevel, 40),
    deadline: dueDate,
    planLocked: raw.planLocked === true,
    splittable: raw.splittable === true,
    minimumBlockMinutes: clampInteger(raw.minimumBlockMinutes, Math.max(5, remainingMinutes || estimatedMinutes || 45), 5, 24 * 60),
    dependencies: Array.isArray(raw.dependencies) ? raw.dependencies.map((item) => normalizeText(item, 120)).filter(Boolean).slice(0, 20) : [],
    aiMeta: sanitizeAiMeta(raw.aiMeta),
  };
}

function todoSummaryToSchedulerTodo(todo, index = 0) {
  return {
    id: todo.id,
    title: todo.title,
    category: normalizeText(todo.category || (["deep_work", "admin", "communication"].includes(todo.taskType) ? "工作" : ""), 80),
    dueDate: todo.date,
    startTime: todo.plannedStart,
    endTime: todo.plannedEnd,
    estimatedMinutes: todo.durationMinutes,
    remainingMinutes: todo.remainingMinutes,
    priority: todo.priority,
    importance: todo.importance,
    urgency: todo.urgency,
    taskType: todo.taskType,
    energyLevel: todo.energyLevel,
    splittable: todo.splittable,
    minimumBlockMinutes: todo.minimumBlockMinutes,
    dependencies: todo.dependencies,
    planLocked: todo.planLocked,
    orderInDay: index,
    completed: todo.status === "completed",
  };
}

function filterTodos(todos, args = {}) {
  const dateFrom = normalizeText(args.dateFrom, 20);
  const dateTo = normalizeText(args.dateTo, 20);
  const statusFilter = Array.isArray(args.status) ? new Set(args.status.map((item) => normalizeText(item, 40)).filter(Boolean)) : null;
  return todos.filter((todo) => {
    if (statusFilter && !statusFilter.has(todo.status)) return false;
    if (dateFrom && todo.date && todo.date < dateFrom) return false;
    if (dateTo && todo.date && todo.date > dateTo) return false;
    return todo.status !== "completed";
  });
}

function readLocalData(dataDir) {
  const latestPath = path.join(dataDir, "local-data", "latest.json");
  const latest = readJsonIfExists(latestPath);
  if (!latest || latest.schema !== LOCAL_DATA_BACKUP_SCHEMA || !latest.storage || typeof latest.storage !== "object") {
    return {
      available: false,
      exportedAt: "",
      stats: { entries: 0, todos: 0, storageKeys: 0 },
      todos: [],
      entries: [],
    };
  }
  return {
    available: true,
    exportedAt: normalizeText(latest.exportedAt || latest.receivedAt, 80),
    stats: {
      entries: Number.isFinite(Number(latest.stats?.entries)) ? Number(latest.stats.entries) : 0,
      todos: Number.isFinite(Number(latest.stats?.todos)) ? Number(latest.stats.todos) : 0,
      storageKeys: Object.keys(latest.storage).length,
    },
    todos: parseStoredArray(latest.storage[TODO_STORAGE_KEY]).map(normalizeTodoSummary),
    entries: parseStoredArray(latest.storage[JOURNAL_STORAGE_KEY]),
  };
}

function dateTimeToIso(date, clock) {
  if (!date || !clock) return "";
  return `${date}T${clock}:00+08:00`;
}

function getPlannedBusyBlocks(todos, dateFrom, dateTo) {
  return todos
    .filter((todo) => todo.date && todo.plannedStart && todo.plannedEnd)
    .filter((todo) => !dateFrom || todo.date >= dateFrom)
    .filter((todo) => !dateTo || todo.date <= dateTo)
    .map((todo) => ({
      schema: "guanshi-busy-block-v1",
      id: `planned_${todo.id}`,
      source: "planned",
      date: todo.date,
      start: todo.plannedStart,
      end: todo.plannedEnd,
      isHard: todo.planLocked,
      titlePolicy: "masked",
      visibility: "busy_only",
    }));
}

function readCalendarBusyBlocks(dataDir, dateFrom, dateTo) {
  const payload = readJsonIfExists(path.join(dataDir, "calendar_sync.json"));
  const events = Array.isArray(payload?.events) ? payload.events : [];
  return events.map((event, index) => {
    const date = normalizeText(event.date || String(event.start || "").slice(0, 10), 20);
    const start = normalizeText(event.startTime || String(event.start || "").slice(11, 16), 8);
    const end = normalizeText(event.endTime || String(event.end || "").slice(11, 16), 8);
    if (!date || !start || !end) return null;
    if (dateFrom && date < dateFrom) return null;
    if (dateTo && date > dateTo) return null;
    return {
      schema: "guanshi-busy-block-v1",
      id: `calendar_busy_${index + 1}`,
      source: "calendar",
      date,
      start,
      end,
      isHard: true,
      titlePolicy: "masked",
      visibility: "busy_only",
    };
  }).filter(Boolean);
}

function toMcpBusyBlock(block) {
  return {
    start: dateTimeToIso(block.date, block.start),
    end: dateTimeToIso(block.date, block.end),
    source: block.source === "planned" ? "planned" : "calendar",
    privacy: "busy",
  };
}

function buildProgressSummary(todos, args = {}) {
  const activeWindow = normalizeText(args.window || "7d", 20);
  const total = todos.length;
  const completed = todos.filter((todo) => todo.status === "completed").length;
  const plannedMinutes = todos.reduce((sum, todo) => sum + (Number(todo.durationMinutes) || 0), 0);
  const completedMinutes = todos.filter((todo) => todo.status === "completed").reduce((sum, todo) => sum + (Number(todo.durationMinutes) || 0), 0);
  const delayed = todos.filter((todo) => todo.status !== "completed" && todo.deadline).length;
  return {
    schema: MCP_PROGRESS_SUMMARY_SCHEMA,
    window: activeWindow,
    completionRate: total ? Number((completed / total).toFixed(2)) : 0,
    plannedMinutes,
    completedMinutes,
    patterns: delayed ? [
      {
        kind: "open_deadline_work",
        summary: "仍有带日期的未完成任务，需要用户确认后才能沉淀为原则。",
        confidence: "medium",
      },
    ] : [],
    canBecomeRuleDirectly: false,
  };
}

function getToolDefinition(name) {
  return TOOL_DEFINITIONS.find((tool) => tool.name === name) || null;
}

function resolveProfile(clientId = "") {
  const id = normalizeText(clientId || process.env.GUANSHI_MCP_CLIENT_ID || "codex-local", 120);
  return BUILT_IN_PROFILES[id] || {
    ...BUILT_IN_PROFILES["custom-readonly"],
    clientId: id || "custom-readonly",
  };
}

function hasScope(profile, scope) {
  return Array.isArray(profile.scopes) && profile.scopes.includes(scope);
}

function assertToolAllowed(profile, tool) {
  if (!tool) throw createMcpError("TOOL_DISABLED", "The requested tool is not available.", false);
  if (tool.disabled) {
    throw createMcpError("TOOL_DISABLED", "This tool is disabled. Create a draft and wait for Guanshi UI confirmation.", false, {
      tool: tool.name,
    });
  }
  const scopes = Array.isArray(tool.scopes) ? tool.scopes : [tool.scope].filter(Boolean);
  for (const scope of scopes) {
    if (!hasScope(profile, scope)) {
      throw createMcpError("PERMISSION_DENIED", "The client does not have the required Guanshi MCP scope.", false, {
        scope,
        tool: tool.name,
      });
    }
  }
}

function makeToolResult(payload, isError = false) {
  const safePayload = redactSensitiveValue(payload, { maxStringLength: 12000 });
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(safePayload, null, 2),
      },
    ],
    structuredContent: safePayload,
    isError,
  };
}

function makeErrorPayload(error) {
  return {
    error: {
      code: normalizeText(error?.code || "INTERNAL_ERROR", 80),
      message: error instanceof Error ? redactSensitiveValue(normalizeText(error.message, 500), { maxStringLength: 500 }) : "Guanshi MCP tool failed.",
      retryable: Boolean(error?.retryable),
      details: redactSensitiveValue(error?.details || {}, { maxStringLength: 2000 }),
    },
  };
}

function stripToolMetadata(args = {}) {
  const result = {};
  for (const [key, value] of Object.entries(args && typeof args === "object" && !Array.isArray(args) ? args : {})) {
    if (key === "clientId") continue;
    result[key] = value;
  }
  return result;
}

function assertJsonType(value, schema = {}, label = "argument") {
  if (!schema.type) return;
  if (schema.type === "string" && typeof value !== "string") {
    throw createMcpError("SCHEMA_INVALID", `${label} must be a string.`, false, { label });
  }
  if (schema.type === "boolean" && typeof value !== "boolean") {
    throw createMcpError("SCHEMA_INVALID", `${label} must be a boolean.`, false, { label });
  }
  if (schema.type === "integer" && !Number.isInteger(value)) {
    throw createMcpError("SCHEMA_INVALID", `${label} must be an integer.`, false, { label });
  }
  if (schema.type === "array" && !Array.isArray(value)) {
    throw createMcpError("SCHEMA_INVALID", `${label} must be an array.`, false, { label });
  }
  if (schema.type === "object" && (!value || typeof value !== "object" || Array.isArray(value))) {
    throw createMcpError("SCHEMA_INVALID", `${label} must be an object.`, false, { label });
  }
}

function assertToolInputSchema(tool, args = {}) {
  const schema = tool?.inputSchema || {};
  assertJsonType(args, schema, "arguments");
  const properties = schema.properties && typeof schema.properties === "object" ? schema.properties : {};
  const required = Array.isArray(schema.required) ? schema.required : [];
  for (const key of required) {
    if (args[key] === undefined || args[key] === null || args[key] === "") {
      throw createMcpError("SCHEMA_INVALID", `${key} is required.`, false, { key });
    }
  }
  if (schema.additionalProperties === false) {
    for (const key of Object.keys(args)) {
      if (!Object.prototype.hasOwnProperty.call(properties, key)) {
        throw createMcpError("SCHEMA_INVALID", `Unexpected argument: ${key}.`, false, { key });
      }
    }
  }
  for (const [key, childSchema] of Object.entries(properties)) {
    if (args[key] !== undefined && args[key] !== null) {
      assertJsonType(args[key], childSchema, key);
    }
  }
}

function createMcpStore(options = {}) {
  const dataDir = path.resolve(options.dataDir || process.cwd());
  const baseDir = path.join(dataDir, "ai-mcp");
  const proposalsDir = path.join(baseDir, "proposals");
  const idempotencyDir = path.join(baseDir, "idempotency");
  const now = typeof options.now === "function" ? options.now : () => new Date().toISOString();

  function recordPath(proposalId) {
    return path.join(proposalsDir, `${makeSafeId(proposalId)}.json`);
  }

  function idempotencyPath(clientRequestId) {
    return path.join(idempotencyDir, `${makeSafeId(clientRequestId)}.json`);
  }

  function listRecords() {
    fs.mkdirSync(proposalsDir, { recursive: true });
    const records = [];
    for (const item of fs.readdirSync(proposalsDir, { withFileTypes: true })) {
      if (!item.isFile() || !item.name.endsWith(".json")) continue;
      try {
        const record = JSON.parse(fs.readFileSync(path.join(proposalsDir, item.name), "utf8"));
        if (record?.schema === MCP_PROPOSAL_SCHEMA) records.push(record);
      } catch {
        // Skip corrupt MCP proposal records while preserving the rest.
      }
    }
    records.sort((left, right) => String(right.updatedAt || right.createdAt).localeCompare(String(left.updatedAt || left.createdAt)));
    return records;
  }

  function getRecord(id) {
    const normalized = makeSafeId(id);
    const direct = readJsonIfExists(recordPath(normalized));
    if (direct?.schema === MCP_PROPOSAL_SCHEMA) return direct;
    return listRecords().find((record) => record.proposalId === id || record.payload?.draftId === id || record.result?.draftId === id) || null;
  }

  function createIdempotentRecord({ clientRequestId, fingerprint, agent, proposalType, result, createResult, actionReview }) {
    const requestId = normalizeText(clientRequestId, 120);
    if (!requestId) throw createMcpError("SCHEMA_INVALID", "clientRequestId is required.", false);
    const idemPath = idempotencyPath(requestId);
    const existing = readJsonIfExists(idemPath);
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw createMcpError("IDEMPOTENCY_CONFLICT", "clientRequestId has already been used with a different payload.", false, {
          clientRequestId: requestId,
        });
      }
      const record = getRecord(existing.proposalId);
      if (record) return { record, result: record.result, idempotentReplay: true };
    }
    const timestamp = now();
    const proposalId = `mcp_proposal_${makeSafeId(requestId)}`;
    const finalResult = typeof createResult === "function" ? createResult() : result;
    const record = {
      schema: MCP_PROPOSAL_SCHEMA,
      proposalId,
      clientRequestId: requestId,
      agent,
      proposalType,
      result: finalResult,
      payload: finalResult?.draft || finalResult?.proposal || finalResult?.insight || finalResult,
      permissions: {
        canApply: false,
        requiresGuanshiUiConfirmation: true,
        reviewStatus: actionReview?.status || "needs_confirmation",
      },
      actionReview: actionReview || null,
      status: "pending",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    writeJsonAtomic(recordPath(proposalId), record);
    writeJsonAtomic(idemPath, {
      clientRequestId: requestId,
      fingerprint,
      proposalId,
      createdAt: timestamp,
    });
    return { record, result: finalResult, idempotentReplay: false };
  }

  return {
    createIdempotentRecord,
    getRecord,
    listRecords,
  };
}

function auditMcpCall(dataDir, entry) {
  const timestamp = normalizeText(entry.timestamp || new Date().toISOString(), 80);
  const date = timestamp.slice(0, 10) || "unknown";
  const auditDir = path.join(dataDir, "ai-logs", "mcp");
  const filePath = path.join(auditDir, `${date}.jsonl`);
  const safe = {
    timestamp,
    clientId: normalizeText(entry.clientId, 120),
    tool: normalizeText(entry.tool, 160),
    status: normalizeText(entry.status, 40),
    draftId: normalizeText(entry.draftId, 160),
    proposalId: normalizeText(entry.proposalId, 160),
    durationMs: Number.isFinite(Number(entry.durationMs)) ? Number(entry.durationMs) : 0,
    redacted: true,
  };
  fs.mkdirSync(auditDir, { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(safe)}\n`, "utf8");
}

function createMcpToolRuntime(options = {}) {
  const dataDir = path.resolve(options.dataDir || process.cwd());
  const now = typeof options.now === "function" ? options.now : () => new Date().toISOString();
  const packageVersion = normalizeText(options.packageVersion || process.env.GUANSHI_MCP_PACKAGE_VERSION || "1.6.0", 40);
  const memoryStore = options.memoryStore || createAiMemoryStore({ dataDir, now });
  const draftStore = options.draftStore || createAiDraftStore({ dataDir, now });
  const mcpStore = createMcpStore({ dataDir, now });

  function agentFromProfile(profile) {
    return {
      kind: profile.kind || "custom",
      displayName: profile.displayName || profile.clientId || "External Agent",
      clientId: profile.clientId,
    };
  }

  function listTools(clientId = "") {
    const profile = resolveProfile(clientId);
    return {
      schema: MCP_TOOL_LIST_SCHEMA,
      tools: TOOL_DEFINITIONS
        .filter((tool) => tool.disabled || (Array.isArray(tool.scopes) ? tool.scopes.every((scope) => hasScope(profile, scope)) : hasScope(profile, tool.scope)))
        .map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          governance: reviewMcpToolDefinition(tool),
          disabled: tool.disabled === true,
        })),
    };
  }

  function getStatus() {
    const localData = readLocalData(dataDir);
    let memoryAvailable = true;
    try {
      memoryStore.readConfig();
    } catch {
      memoryAvailable = false;
    }
    return {
      schema: MCP_STATUS_SCHEMA,
      app: {
        name: "Guanshi",
        version: packageVersion,
      },
      mcp: {
        schemaVersion: 1,
        transport: "stdio-jsonrpc",
        capabilities: {
          readOnly: true,
          createDraft: true,
          applyDraft: false,
        },
        governance: {
          actionReviewSchema: AI_ACTION_REVIEW_SCHEMA,
          externalApply: false,
          draftApply: "guanshi_ui_confirmation_only",
        },
      },
      data: {
        todosAvailable: localData.available,
        busyBlocksAvailable: localData.available || Boolean(readJsonIfExists(path.join(dataDir, "calendar_sync.json"))),
        memoryAvailable,
        progressAvailable: localData.available,
      },
    };
  }

  function listActiveTodos(args = {}) {
    const localData = readLocalData(dataDir);
    const limit = clampInteger(args.limit, 100, 1, 200);
    const items = filterTodos(localData.todos, args).slice(0, limit);
    return {
      schema: MCP_TODO_LIST_SCHEMA,
      items,
      truncated: filterTodos(localData.todos, args).length > items.length,
    };
  }

  function getTodo(args = {}) {
    const todoId = normalizeText(args.todoId, 120);
    if (!todoId) throw createMcpError("SCHEMA_INVALID", "todoId is required.", false);
    const localData = readLocalData(dataDir);
    const item = localData.todos.find((todo) => todo.id === todoId);
    if (!item) throw createMcpError("CONTEXT_UNAVAILABLE", "Todo was not found in the latest local data snapshot.", true, { todoId });
    return {
      schema: MCP_TODO_SCHEMA,
      item,
    };
  }

  function getSchedulerBusyBlocks(args = {}) {
    const localData = readLocalData(dataDir);
    const dateFrom = normalizeText(args.dateFrom || args.date, 20);
    const dateTo = normalizeText(args.dateTo || (dateFrom ? addDays(dateFrom, clampInteger(args.horizonDays, 1, 1, 31) - 1) : ""), 20);
    const sources = Array.isArray(args.sources) && args.sources.length
      ? new Set(args.sources.map((item) => normalizeText(item, 40)).filter(Boolean))
      : new Set(["calendar", "planned"]);
    const blocks = [];
    if (sources.has("calendar")) blocks.push(...readCalendarBusyBlocks(dataDir, dateFrom, dateTo));
    if (sources.has("planned")) blocks.push(...getPlannedBusyBlocks(localData.todos, dateFrom, dateTo));
    return blocks;
  }

  function getBusyBlocks(args = {}) {
    const schedulerBlocks = getSchedulerBusyBlocks(args);
    return {
      schema: MCP_BUSY_BLOCKS_SCHEMA,
      calendarDetailLevel: "busy_only",
      blocks: schedulerBlocks.map(toMcpBusyBlock),
    };
  }

  function listMemory(args = {}) {
    const types = Array.isArray(args.types) ? new Set(args.types.map((item) => normalizeText(item, 40)).filter(Boolean)) : null;
    const limit = clampInteger(args.limit, 50, 1, 100);
    const entries = memoryStore.listEntries()
      .filter((entry) => entry.status === "active")
      .filter((entry) => !types || types.has(entry.type))
      .slice(0, limit);
    return {
      schema: MCP_MEMORY_LIST_SCHEMA,
      items: entries.map((entry) => ({
        id: entry.id,
        type: entry.type,
        title: entry.title,
        summary: entry.title,
        priority: entry.strength === "hard" ? 90 : 60,
        confidence: entry.userConfirmed ? "confirmed" : "proposed",
        updatedAt: entry.updatedAt,
      })),
    };
  }

  function getMemory(args = {}) {
    const memoryId = normalizeText(args.memoryId, 120);
    if (!memoryId) throw createMcpError("SCHEMA_INVALID", "memoryId is required.", false);
    const entry = memoryStore.getEntry(memoryId);
    if (entry.status !== "active") throw createMcpError("CONTEXT_UNAVAILABLE", "Memory is not active.", true, { memoryId });
    return {
      schema: MCP_MEMORY_SCHEMA,
      item: {
        id: entry.id,
        type: entry.type,
        title: entry.title,
        body: entry.body,
        scope: entry.appliesTo,
        priority: entry.strength === "hard" ? 90 : 60,
        confidence: entry.userConfirmed ? "confirmed" : "proposed",
        rule: entry.rule || null,
      },
    };
  }

  function getProgressSummary(args = {}) {
    const localData = readLocalData(dataDir);
    return buildProgressSummary(localData.todos, args);
  }

  function getScheduleContext(args = {}) {
    const date = normalizeText(args.date, 20) || formatDate(new Date(now()));
    const horizonDays = clampInteger(args.horizonDays, 7, 1, 31);
    const dateTo = addDays(date, horizonDays - 1);
    const localData = readLocalData(dataDir);
    const todos = filterTodos(localData.todos, { dateFrom: date, dateTo }).map(todoSummaryToSchedulerTodo);
    const busyBlocks = getSchedulerBusyBlocks({ dateFrom: date, dateTo });
    const projections = args.includeMemory === false ? [] : memoryStore.getEngineProjections({ target: "scheduler", action: "schedule_draft" });
    const hardConstraints = projections.filter((item) => item.strength === "hard");
    const softPreferences = projections.filter((item) => item.strength !== "hard");
    return {
      schema: MCP_SCHEDULE_CONTEXT_SCHEMA,
      date,
      todos,
      busyBlocks,
      memoryProjection: {
        hardConstraints,
        softPreferences,
        projections,
      },
      progressSummary: args.includeProgress === false ? null : buildProgressSummary(localData.todos, { window: "7d" }),
      limits: {
        calendarDetailLevel: "busy_only",
        canApply: false,
      },
    };
  }

  function createTaskDraft(args = {}, profile) {
    const title = normalizeText(args.title, 200);
    const clientRequestId = normalizeText(args.clientRequestId, 120);
    if (!title || !clientRequestId) throw createMcpError("SCHEMA_INVALID", "clientRequestId and title are required.", false);
    const draftId = `draft_mcp_task_${makeSafeId(clientRequestId)}`;
    const actionReview = reviewMcpToolDefinition(getToolDefinition("guanshi.create_task_draft"), args);
    const result = {
      schema: MCP_CREATE_DRAFT_RESULT_SCHEMA,
      draftId,
      draftType: "task_create",
      status: "pending",
      requiresGuanshiUiConfirmation: true,
      canApply: false,
      actionReview,
      draft: {
        schema: "guanshi-mcp-task-draft-v1",
        draftId,
        status: "pending",
        title,
        notes: normalizeText(args.notes, 1000),
        suggestedFields: args.suggestedFields && typeof args.suggestedFields === "object" && !Array.isArray(args.suggestedFields)
          ? args.suggestedFields
          : {},
        reason: normalizeText(args.reason, 1000),
        source: {
          kind: "mcp",
          client: profile.clientId,
        },
      },
    };
    const stored = mcpStore.createIdempotentRecord({
      clientRequestId,
      fingerprint: hashPayload({ tool: "guanshi.create_task_draft", args }),
      agent: agentFromProfile(profile),
      proposalType: "task_draft",
      result,
      actionReview,
    });
    return {
      ...stored.result,
      idempotentReplay: stored.idempotentReplay,
    };
  }

  function createScheduleDraft(args = {}, profile) {
    const clientRequestId = normalizeText(args.clientRequestId, 120);
    if (!clientRequestId) throw createMcpError("SCHEMA_INVALID", "clientRequestId is required.", false);
    const draftId = `draft_mcp_schedule_${makeSafeId(clientRequestId)}`;
    const actionReview = reviewMcpToolDefinition(getToolDefinition("guanshi.create_schedule_draft"), args);
    const createResult = () => {
      const date = normalizeText(args.date || args.targetDate, 20) || formatDate(new Date(now()));
      const action = normalizeText(args.intent || "plan_today", 80);
      const end = action === "plan_week" ? addDays(date, 6) : date;
      const localData = readLocalData(dataDir);
      const todos = Array.isArray(args.todos) && args.todos.length
        ? args.todos
        : filterTodos(localData.todos, { dateFrom: date, dateTo: end }).map(todoSummaryToSchedulerTodo);
      const proposedTodos = Array.isArray(args.proposedBlocks)
        ? args.proposedBlocks.map((block, index) => {
          const startText = normalizeText(block.start, 40);
          const endText = normalizeText(block.end, 40);
          const blockDate = normalizeText(block.date || startText.slice(0, 10) || date, 20);
          const startClock = normalizeText(block.startTime || startText.slice(11, 16), 8);
          const endClock = normalizeText(block.endTime || endText.slice(11, 16), 8);
          const startMinutes = parseClockToMinutes(startClock);
          const endMinutes = parseClockToMinutes(endClock);
          const duration = startMinutes !== null && endMinutes !== null && endMinutes > startMinutes ? endMinutes - startMinutes : 45;
          return {
            id: normalizeText(block.todoId || `mcp_proposed_${index + 1}`, 120),
            title: normalizeText(block.title || block.todoId || `MCP proposed block ${index + 1}`, 200),
            category: "工作",
            dueDate: blockDate,
            estimatedMinutes: duration,
            remainingMinutes: duration,
            priority: "P2",
            taskType: "deep_work",
            splittable: duration >= 60,
            minimumBlockMinutes: Math.min(duration, 45),
          };
        }) : [];
      const schedulerInput = {
        schema: "guanshi-scheduler-input-v1",
        draftId,
        requestId: `req_mcp_${makeSafeId(clientRequestId)}`,
        action,
        timezone: normalizeText(args.timezone || "Asia/Shanghai", 80),
        source: {
          kind: "mcp",
          client: profile.clientId,
        },
        dateRange: {
          start: date,
          end,
        },
        todos: todos.length ? todos : proposedTodos,
        busyBlocks: Array.isArray(args.busyBlocks) ? args.busyBlocks : getSchedulerBusyBlocks({ dateFrom: date, dateTo: end }),
        memoryProjections: Array.isArray(args.memoryProjections) ? args.memoryProjections : memoryStore.getEngineProjections({ target: "scheduler", action }),
        progressSummary: normalizeText(args.reason, 1000) || null,
        options: {
          workingWindows: Array.isArray(args.workingWindows) ? args.workingWindows : [],
          defaultGapMinutes: clampInteger(args.defaultGapMinutes, 5, 0, 60),
          strategy: normalizeText(args.strategy || "balanced", 80),
          allowMoveExistingUnlocked: true,
          allowSplitLongTasks: true,
          maxDays: action === "plan_week" ? 7 : 1,
        },
      };
      const draft = draftStore.createDraft(schedulerInput);
      return {
        schema: MCP_CREATE_DRAFT_RESULT_SCHEMA,
        draftId: draft.draftId,
        draftType: "schedule",
        status: draft.status,
        requiresGuanshiUiConfirmation: true,
        canApply: false,
        actionReview,
        validation: {
          schemaValid: draft.schema === "guanshi-schedule-draft-v1",
          schedulerValid: !draft.conflicts.length,
          conflicts: draft.conflicts,
        },
        draft,
      };
    };
    const stored = mcpStore.createIdempotentRecord({
      clientRequestId,
      fingerprint: hashPayload({ tool: "guanshi.create_schedule_draft", args }),
      agent: agentFromProfile(profile),
      proposalType: "schedule_draft",
      createResult,
      actionReview,
    });
    return {
      ...stored.result,
      idempotentReplay: stored.idempotentReplay,
    };
  }

  function proposeMemoryEntry(args = {}, profile) {
    const clientRequestId = normalizeText(args.clientRequestId, 120);
    const type = normalizeText(args.type, 40);
    const title = normalizeText(args.title, 160);
    const body = normalizeText(args.body, 4000);
    if (!clientRequestId || !type || !title || !body) {
      throw createMcpError("SCHEMA_INVALID", "clientRequestId, type, title, and body are required.", false);
    }
    const actionReview = reviewMcpToolDefinition(getToolDefinition("guanshi.propose_memory_entry"), args);
    const createResult = () => {
      const rule = args.rule && typeof args.rule === "object" && !Array.isArray(args.rule) ? args.rule : null;
      const proposal = memoryStore.createProposal({
        schema: "guanshi-ai-memory-proposal-v1",
        proposalId: `proposal_mcp_${makeSafeId(clientRequestId)}`,
        status: "pending_confirmation",
        type,
        title,
        body,
        strength: normalizeText(args.strength || (type === "boundary" || type === "rule" ? "hard" : "soft"), 40),
        appliesTo: Array.isArray(args.scope) && args.scope.length ? args.scope : getDefaultMemoryScope(type, rule),
        modelReadable: args.modelReadable !== false,
        engineReadable: typeof args.engineReadable === "boolean"
          ? args.engineReadable
          : Boolean(rule && ["boundary", "rule", "habit"].includes(type)),
        subjectKey: normalizeText(args.subjectKey, 160),
        matchMode: normalizeText(args.matchMode, 40),
        match: args.match && typeof args.match === "object" && !Array.isArray(args.match) ? args.match : {},
        rule,
        validFrom: normalizeText(args.validFrom, 80),
        validUntil: normalizeText(args.validUntil, 80),
        reviewAfter: normalizeText(args.reviewAfter, 80),
        confidence: args.confidence,
        evidence: {
          source: "mcp_agent",
          clientRequestId,
          sources: Array.isArray(args.evidence) ? args.evidence.map((item) => normalizeText(item, 240)).filter(Boolean).slice(0, 8) : [],
          confidence: normalizeText(args.confidence || "proposed", 40),
        },
        createdBy: {
          kind: "mcp_agent",
          name: profile.displayName || profile.clientId,
        },
      });
      return {
        schema: MCP_MEMORY_PROPOSAL_RESULT_SCHEMA,
        proposalId: proposal.proposalId,
        status: "proposed",
        storedStatus: proposal.status,
        requiresGuanshiUiConfirmation: true,
        canWriteActiveMemory: false,
        actionReview,
        proposal,
      };
    };
    const stored = mcpStore.createIdempotentRecord({
      clientRequestId,
      fingerprint: hashPayload({ tool: "guanshi.propose_memory_entry", args }),
      agent: agentFromProfile(profile),
      proposalType: "memory_proposal",
      createResult,
      actionReview,
    });
    return {
      ...stored.result,
      idempotentReplay: stored.idempotentReplay,
    };
  }

  function createReviewInsight(args = {}, profile) {
    const clientRequestId = normalizeText(args.clientRequestId, 120);
    if (!clientRequestId) throw createMcpError("SCHEMA_INVALID", "clientRequestId is required.", false);
    const insightId = `review_insight_mcp_${makeSafeId(clientRequestId)}`;
    const actionReview = reviewMcpToolDefinition(getToolDefinition("guanshi.create_review_insight"), args);
    const result = {
      schema: MCP_REVIEW_INSIGHT_RESULT_SCHEMA,
      insightId,
      status: "pending_review",
      canBecomeMemoryDirectly: false,
      actionReview,
      insight: {
        schema: "guanshi-mcp-review-insight-v1",
        insightId,
        window: normalizeText(args.window || "7d", 20),
        insights: Array.isArray(args.insights) ? args.insights.slice(0, 20) : [],
        source: {
          kind: "mcp",
          client: profile.clientId,
        },
      },
    };
    const stored = mcpStore.createIdempotentRecord({
      clientRequestId,
      fingerprint: hashPayload({ tool: "guanshi.create_review_insight", args }),
      agent: agentFromProfile(profile),
      proposalType: "review_insight",
      result,
      actionReview,
    });
    return {
      ...stored.result,
      idempotentReplay: stored.idempotentReplay,
    };
  }

  function listDrafts(args = {}) {
    const limit = clampInteger(args.limit, 50, 1, 100);
    const statuses = Array.isArray(args.status) && args.status.length ? new Set(args.status.map((item) => normalizeText(item, 40)).filter(Boolean)) : null;
    const records = mcpStore.listRecords()
      .filter((record) => !statuses || statuses.has(record.status) || statuses.has(record.result?.status))
      .slice(0, limit);
    return {
      schema: MCP_DRAFT_LIST_SCHEMA,
      items: records.map((record) => ({
        draftId: record.result?.draftId || record.result?.proposalId || record.result?.insightId || record.proposalId,
        draftType: record.result?.draftType || record.proposalType,
        status: record.result?.status || record.status,
        source: {
          kind: "mcp",
          client: record.agent?.clientId || record.agent?.kind || "",
        },
        createdAt: record.createdAt,
        requiresGuanshiUiConfirmation: true,
        actionReview: record.actionReview || record.result?.actionReview || null,
      })),
    };
  }

  function getDraft(args = {}) {
    const draftId = normalizeText(args.draftId, 160);
    if (!draftId) throw createMcpError("SCHEMA_INVALID", "draftId is required.", false);
    const record = mcpStore.getRecord(draftId);
    if (record) {
      return {
        schema: MCP_DRAFT_SCHEMA,
        draft: {
          draftId: record.result?.draftId || record.result?.proposalId || record.result?.insightId || record.proposalId,
          draftType: record.result?.draftType || record.proposalType,
          status: record.result?.status || record.status,
          payload: record.payload,
          permissions: record.permissions,
          actionReview: record.actionReview || record.result?.actionReview || null,
          source: {
            kind: "mcp",
            client: record.agent?.clientId || "",
          },
        },
      };
    }
    const draft = draftStore.getDraft(draftId);
    return {
      schema: MCP_DRAFT_SCHEMA,
      draft: {
        draftId: draft.draftId,
        draftType: "schedule",
        status: draft.status,
        payload: draft,
        permissions: {
          canApply: false,
          requiresGuanshiUiConfirmation: true,
        },
        source: draft.source || {},
      },
    };
  }

  function dispatchTool(toolName, args = {}, profile) {
    switch (toolName) {
      case "guanshi.get_status":
        return getStatus(args);
      case "guanshi.list_active_todos":
        return listActiveTodos(args);
      case "guanshi.get_todo":
        return getTodo(args);
      case "guanshi.get_busy_blocks":
        return getBusyBlocks(args);
      case "guanshi.list_memory":
        return listMemory(args);
      case "guanshi.get_memory":
        return getMemory(args);
      case "guanshi.get_progress_summary":
        return getProgressSummary(args);
      case "guanshi.get_schedule_context":
        return getScheduleContext(args);
      case "guanshi.list_drafts":
        return listDrafts(args);
      case "guanshi.get_draft":
        return getDraft(args);
      case "guanshi.create_task_draft":
        return createTaskDraft(args, profile);
      case "guanshi.create_schedule_draft":
        return createScheduleDraft(args, profile);
      case "guanshi.propose_memory_entry":
        return proposeMemoryEntry(args, profile);
      case "guanshi.create_review_insight":
        return createReviewInsight(args, profile);
      default:
        throw createMcpError("TOOL_DISABLED", "The requested Guanshi MCP tool is disabled or unknown.", false, { tool: toolName });
    }
  }

  function callTool(toolName, args = {}, callOptions = {}) {
    const startedAt = Date.now();
    const rawArgs = args && typeof args === "object" && !Array.isArray(args) ? args : {};
    const redactedArgs = redactSensitiveValue(rawArgs, { maxStringLength: 12000 });
    const profile = resolveProfile(callOptions.clientId || redactedArgs.clientId);
    const toolArgs = stripToolMetadata(redactedArgs);
    const tool = getToolDefinition(toolName);
    try {
      assertToolAllowed(profile, tool);
      assertToolInputSchema(tool, toolArgs);
      const payload = dispatchTool(toolName, toolArgs, profile);
      auditMcpCall(dataDir, {
        timestamp: now(),
        clientId: profile.clientId,
        tool: toolName,
        status: "success",
        draftId: payload.draftId,
        proposalId: payload.proposalId,
        durationMs: Date.now() - startedAt,
      });
      return makeToolResult(payload);
    } catch (error) {
      const payload = makeErrorPayload(error);
      auditMcpCall(dataDir, {
        timestamp: now(),
        clientId: profile.clientId,
        tool: toolName,
        status: "error",
        durationMs: Date.now() - startedAt,
      });
      return makeToolResult(payload, true);
    }
  }

  function handleJsonRpcMessage(message = {}) {
    const id = message.id;
    const method = normalizeText(message.method, 120);
    if (!method) return null;
    try {
      if (method.startsWith("notifications/")) return null;
      if (method === "initialize") {
        return {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: "2025-06-18",
            capabilities: {
              tools: {
                listChanged: false,
              },
            },
            serverInfo: {
              name: "guanshi",
              version: packageVersion,
            },
            instructions: "Use Guanshi tools to read minimal time-management context and create pending drafts. apply_draft is disabled.",
          },
        };
      }
      if (method === "ping") {
        return { jsonrpc: "2.0", id, result: {} };
      }
      if (method === "tools/list") {
        const clientId = message.params?.clientId || message.params?.arguments?.clientId || "";
        return {
          jsonrpc: "2.0",
          id,
          result: {
            tools: listTools(clientId).tools,
          },
        };
      }
      if (method === "tools/call") {
        const toolName = normalizeText(message.params?.name, 160);
        const args = message.params?.arguments && typeof message.params.arguments === "object" ? message.params.arguments : {};
        return {
          jsonrpc: "2.0",
          id,
          result: callTool(toolName, args, { clientId: args.clientId }),
        };
      }
      return {
        jsonrpc: "2.0",
        id,
        error: {
          code: -32601,
          message: `Method not found: ${method}`,
        },
      };
    } catch (error) {
      return {
        jsonrpc: "2.0",
        id,
        error: {
          code: -32603,
          message: error instanceof Error ? normalizeText(error.message, 500) : "Internal error",
        },
      };
    }
  }

  return {
    callTool,
    handleJsonRpcMessage,
    listTools,
  };
}

module.exports = {
  MCP_PROPOSAL_SCHEMA,
  createMcpError,
  createMcpToolRuntime,
};
