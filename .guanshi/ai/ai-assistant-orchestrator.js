"use strict";

const { createDomainModuleRegistry } = require("./ai-domain-module-registry");
const { executeAiWorkflow } = require("./ai-workflows");
const { fetchProviderChat } = require("./ai-provider-client");
const { createProviderError } = require("./ai-provider-registry");
const { redactSensitiveValue } = require("./ai-redaction");
const {
  AI_ACTION_REVIEW_SCHEMA,
  reviewAssistantDecision,
} = require("./ai-action-governance");
const {
  buildModelMemoryContext,
  renderModelMemoryPromptBlock,
} = require("./ai-context-composer");
const {
  buildDefaultContextWindow,
  hasHistoricalContextIntent,
  resolveDateReference,
} = require("./date-reference-rules");
const {
  MODEL_INPUT_BUDGET_REPORT_SCHEMA,
  composeModelInput,
} = require("./ai-model-input-composer");

const AI_ASSISTANT_REQUEST_SCHEMA = "guanshi-ai-assistant-request-v1";
const AI_ASSISTANT_RESULT_SCHEMA = "guanshi-ai-assistant-result-v1";
const AI_ACTION_SCHEMA = "guanshi-ai-action-request-v1";
const AI_CONTEXT_SNAPSHOT_SCHEMA = "guanshi-ai-context-snapshot-v1";
const AI_CONTEXT_ENVELOPE_SCHEMA = "guanshi-ai-context-envelope-v2";
const AI_CONTEXT_REQUEST_SCHEMA = "guanshi-ai-context-request-v1";
const AI_CONTEXT_GRANT_SCHEMA = "guanshi-ai-context-grant-v1";
const AI_CONTEXT_ASSESSMENT_SCHEMA = "guanshi-ai-context-assessment-v1";
const AI_CONTEXT_RESOLUTION_SCHEMA = "guanshi-ai-context-resolution-v1";
const AI_CONTEXT_CONTINUATION_SCHEMA = "guanshi-ai-context-continuation-v1";
const AI_CONTEXT_ACCESS_POLICY_SCHEMA = "guanshi-ai-context-access-policy-v1";
const AI_MODEL_INPUT_TRACE_SCHEMA = "guanshi-ai-model-input-trace-v2";
const AI_MODEL_OUTPUT_TRACE_SCHEMA = "guanshi-ai-model-output-trace-v1";
const AI_TURN_TRACE_SCHEMA = "guanshi-ai-turn-trace-v1";
const AI_PLANNER_PROMPT_SCHEMA = "guanshi-ai-planner-prompt-v2";
const AI_SEMANTIC_ACTION_SCHEMA = "guanshi-ai-semantic-action-v1";
const AI_SEMANTIC_FEEDBACK_SCHEMA = "guanshi-ai-semantic-feedback-v1";
const AI_WRITER_PROMPT_SCHEMA = "guanshi-ai-writer-prompt-v2";
const AI_WRITER_TASK_SCHEMA = "guanshi-ai-writer-task-v2";
const AI_RUNTIME_CLOCK_SCHEMA = "guanshi-ai-runtime-clock-v1";
const AI_REFERENCE_SCOPE_SCHEMA = "guanshi-ai-reference-scope-v1";
const AI_VIEW_CONTEXT_SCHEMA = "guanshi-ai-view-context-v1";
const AI_SELECTED_OBJECTS_CONTEXT_SCHEMA = "guanshi-ai-selected-objects-context-v1";
const AI_PAGE_WORK_CONTEXT_SCHEMA = "guanshi-ai-page-work-context-v1";
const AI_GLOBAL_BACKGROUND_CONTEXT_SCHEMA = "guanshi-ai-global-background-context-v1";
const AI_TURN_CONTEXT_SCHEMA = "guanshi-ai-turn-context-v1";
const AI_CONTEXT_CANDIDATES_SCHEMA = "guanshi-ai-context-candidates-v1";

const LEGACY_TOOL_DEFINITIONS = {
  answer: {
    label: "直接回答",
    description: "用于解释、追问、轻量建议，不创建任何草稿或本地数据。",
  },
  explore_principles: {
    label: "探索时间管理原则",
    description: "用于引导用户澄清生活时间管理原则。",
  },
  save_memory_proposal: {
    label: "创建记忆提案",
    description: "用于把用户确认倾向的时间管理原则转成待确认记忆提案。",
  },
  parse_task: {
    label: "解析待办草稿",
    description: "用于把具体任务、提醒、会议准备等输入转成待确认待办草稿。",
  },
  breakdown_task: {
    label: "拆解任务",
    description: "用于把当前任务拆成待确认子任务草稿。",
  },
  plan_today: {
    label: "生成今日排程草稿",
    description: "用于根据待办、忙碌块和记忆生成今日待确认排程草稿。",
  },
  plan_week: {
    label: "生成本周排程草稿",
    description: "用于根据一周上下文生成待确认排程草稿。",
  },
  reflow_unfinished: {
    label: "重排未完成任务",
    description: "用于按最小变更原则把未完成任务转成待确认重排草稿。",
  },
  review_day: {
    label: "复盘/风险洞察",
    description: "用于分析进展、风险、延期和复盘洞察，不直接修改数据。",
  },
};

const TOOL_DEFINITIONS = LEGACY_TOOL_DEFINITIONS;

function createAssistantError(code, message, statusCode = 400, details = {}) {
  const error = new Error(message || code);
  error.code = code;
  error.statusCode = statusCode;
  error.details = details && typeof details === "object" ? details : {};
  if (details?.stage) error.stage = details.stage;
  return error;
}

function addStageToError(error, stage, fallbackCode, fallbackMessage, fallbackStatus = 400) {
  if (error && typeof error === "object") {
    error.stage = error.stage || stage;
    error.code = error.code || fallbackCode;
    error.statusCode = Number(error.statusCode || fallbackStatus);
    error.details = {
      ...(error.details && typeof error.details === "object" ? error.details : {}),
      stage,
    };
    return error;
  }
  return createAssistantError(fallbackCode, fallbackMessage, fallbackStatus, { stage });
}

function normalizeText(value, maxLength = 4000) {
  return String(value || "").trim().slice(0, maxLength);
}

function normalizeRawText(value) {
  return String(value || "").trim();
}

const INTERNAL_WRITER_PREFIX_PATTERN = /Shape要求|responseShape|writerTask|needsFollowUp|mustMention|mustAvoid|prompt_schema|system prompt|Planner|Writer|系统提示词|隐藏上下文|模型输入审计|写作任务|写作工单|工单字段|tone\s*(?:是|:|：)|必须避免.*提及/i;

function hasInternalWriterPrefixSignal(value) {
  return INTERNAL_WRITER_PREFIX_PATTERN.test(String(value || "").slice(0, 900));
}

function isFollowOnWriterThinkingBlock(block, sawInternalPrefix) {
  if (!sawInternalPrefix) return false;
  const compact = String(block || "").replace(/\s+/g, "");
  if (!compact) return true;
  if (/^(?:好的|好|接下来|下面|现在)?(?:来写|我来写|开始写)(?:最终)?(?:正文|回复)/.test(compact)) return true;
  if (/^(?:当前时间|用户问的是|所以|因此)/.test(compact) && /(?:问候|正文|输出|回复|自然)/.test(compact)) return true;
  return false;
}

function sanitizeAssistantAnswerText(value) {
  let text = normalizeText(value, 12000)
    .replace(/^```(?:markdown|text)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  if (!text) return "";

  let sawInternalPrefix = hasInternalWriterPrefixSignal(text);
  if (sawInternalPrefix) {
    const prefixSlice = text.slice(0, 900);
    const transitionMatch = /(?:好的[，,]?\s*)?(?:来写|我来写|开始写|现在写|接下来写)(?:最终)?(?:正文|回复)[。.!！:：\s]*/i.exec(prefixSlice);
    if (transitionMatch) {
      text = text.slice(transitionMatch.index + transitionMatch[0].length).trimStart();
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    const blocks = text.split(/\n\s*\n/);
    if (blocks.length <= 1) break;
    const firstBlock = blocks[0] || "";
    if (hasInternalWriterPrefixSignal(firstBlock) || isFollowOnWriterThinkingBlock(firstBlock, sawInternalPrefix)) {
      sawInternalPrefix = true;
      text = blocks.slice(1).join("\n\n").trimStart();
      changed = true;
    }
  }

  text = text.replace(/^(?:好的[，,]?\s*)?(?:来写|我来写|开始写|现在写|接下来写)(?:最终)?(?:正文|回复)[。.!！:：\s]*/i, "").trim();
  return text;
}

function buildPendingToolAnswer(decision = {}) {
  const label = normalizeText(decision.label || "工具草稿", 160);
  return /^(创建|生成|解析|拆解|重排)/.test(label)
    ? `我会先${label}，等你确认。`
    : `我会先创建${label}，等你确认。`;
}

function createAssistantAnswerStreamFilter(onDelta) {
  const emit = typeof onDelta === "function" ? onDelta : () => {};
  let prefixBuffer = "";
  let released = false;

  function release(value) {
    const text = String(value || "");
    if (text) emit(text);
    prefixBuffer = "";
    released = true;
  }

  return {
    push(delta) {
      const text = String(delta || "");
      if (!text) return;
      if (released) {
        emit(text);
        return;
      }
      prefixBuffer += text;
      const hasInternalPrefix = hasInternalWriterPrefixSignal(prefixBuffer);
      if (hasInternalPrefix) {
        const cleaned = sanitizeAssistantAnswerText(prefixBuffer);
        const cleanedLooksInternal = hasInternalWriterPrefixSignal(cleaned) || isFollowOnWriterThinkingBlock(cleaned, true);
        if ((cleaned && !cleanedLooksInternal && cleaned !== normalizeText(prefixBuffer, 12000) && /\n\s*\n/.test(prefixBuffer)) || prefixBuffer.length >= 900) {
          release(cleaned);
        }
        return;
      }
      if (prefixBuffer.length >= 24 || /[。！？!?；;\n]/.test(prefixBuffer)) {
        release(prefixBuffer);
      }
    },
    flush() {
      if (released || !prefixBuffer) return;
      release(sanitizeAssistantAnswerText(prefixBuffer) || prefixBuffer);
    },
  };
}

function normalizeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeModelInputMessages(value) {
  const source = Array.isArray(value) ? value : [];
  return source
    .map((message, index) => {
      const role = normalizeText(message?.role, 40);
      const content = typeof message?.content === "string"
        ? message.content
        : normalizeText(message?.content, 60000);
      if (!role || !content) return null;
      return {
        index: index + 1,
        role,
        content,
      };
    })
    .filter(Boolean);
}

function collectProviderResponseHeaders(response) {
  const headers = response?.headers;
  if (!headers) return {};
  if (typeof headers.entries === "function") {
    return Object.fromEntries(Array.from(headers.entries()));
  }
  if (typeof headers.forEach === "function") {
    const result = {};
    headers.forEach((value, key) => {
      result[key] = value;
    });
    return result;
  }
  return {};
}

function resolveTraceCreatedAt(now) {
  try {
    const value = typeof now === "function" ? now() : now;
    const date = value ? new Date(value) : new Date();
    if (Number.isFinite(date.getTime())) return date.toISOString();
  } catch {
    // fall through
  }
  return new Date().toISOString();
}

function normalizeReferenceKeys(value, fallback = []) {
  const source = Array.isArray(value) ? value : fallback;
  return source.map((item) => normalizeText(item, 40)).filter(Boolean).slice(0, 12);
}

function normalizeStringList(value, maxItems = 8, maxLength = 180) {
  const source = Array.isArray(value)
    ? value
    : typeof value === "string" && value.trim()
      ? [value]
      : [];
  return Array.from(new Set(
    source
      .map((item) => normalizeText(item, maxLength))
      .filter(Boolean),
  )).slice(0, maxItems);
}

function normalizeSemanticMessageList(value, maxItems = 6, maxLength = 180) {
  const source = Array.isArray(value) ? value : value ? [value] : [];
  return source
    .map((item) => {
      if (typeof item === "string") return normalizeText(item, maxLength);
      if (item && typeof item === "object") {
        return normalizeText(item.message || item.summary || item.reason || item.code || JSON.stringify(item), maxLength);
      }
      return normalizeText(item, maxLength);
    })
    .filter(Boolean)
    .slice(0, maxItems);
}

function normalizeSemanticArguments(value, maxStringLength = 1800) {
  const source = normalizeObject(value);
  const output = {};
  for (const [key, rawValue] of Object.entries(source)) {
    const safeKey = normalizeText(key, 80);
    if (!safeKey) continue;
    if (typeof rawValue === "string") {
      output[safeKey] = normalizeText(rawValue, maxStringLength);
    } else if (Array.isArray(rawValue)) {
      output[safeKey] = rawValue.slice(0, 20).map((item) => {
        if (typeof item === "string") return normalizeText(item, 300);
        if (item && typeof item === "object") return redactSensitiveValue(item, { maxStringLength: 600 });
        return item;
      });
    } else if (rawValue && typeof rawValue === "object") {
      output[safeKey] = redactSensitiveValue(rawValue, { maxStringLength: 1200 });
    } else if (rawValue !== undefined) {
      output[safeKey] = rawValue;
    }
  }
  return output;
}

function normalizeSemanticFeedback(value) {
  const source = normalizeObject(value);
  if (!Object.keys(source).length) return null;
  const previousSemanticAction = normalizeObject(source.previousSemanticAction || source.semanticAction);
  return {
    schema: AI_SEMANTIC_FEEDBACK_SCHEMA,
    mode: normalizeText(source.mode || "regenerate", 40),
    sourceMessageId: normalizeText(source.sourceMessageId, 120),
    originalText: normalizeText(source.originalText, 1200),
    previousNormalizedGoal: sanitizeUserVisibleTaskText(source.previousNormalizedGoal || previousSemanticAction.normalizedGoal, 1200),
    userFeedback: sanitizeUserVisibleTaskText(source.userFeedback || source.feedback || source.prompt, 1200),
    previousSemanticAction: Object.keys(previousSemanticAction).length
      ? redactSensitiveValue(previousSemanticAction, { maxStringLength: 4000 })
      : null,
  };
}

function normalizeDateRange(value) {
  const source = normalizeObject(value);
  const start = normalizeText(source.start || source.dateFrom || source.from || source.date, 20);
  const end = normalizeText(source.end || source.dateTo || source.to || start, 20);
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  return {
    start: datePattern.test(start) ? start : "",
    end: datePattern.test(end) ? end : datePattern.test(start) ? start : "",
  };
}

function normalizeContextIncludeList(value) {
  const allowed = new Set([
    "todos",
    "entries",
    "busyBlocks",
    "memory",
    "progress",
    "selectedTodo",
    "selectedObjects",
    "pageWorkContext",
    "globalBackgroundContext",
    "todoDetails",
    "projectTodos",
    "tagTodos",
    "statusTodos",
    "calendarBusyBlocks",
  ]);
  return normalizeStringList(value, 8, 40)
    .map((item) => {
      if (item === "busy_blocks") return "busyBlocks";
      if (item === "selected_objects") return "selectedObjects";
      if (item === "page_work_context") return "pageWorkContext";
      if (item === "global_background_context") return "globalBackgroundContext";
      if (item === "todo_details") return "todoDetails";
      if (item === "project_todos") return "projectTodos";
      if (item === "tag_todos") return "tagTodos";
      if (item === "status_todos") return "statusTodos";
      if (item === "calendar_busy_blocks") return "calendarBusyBlocks";
      return item;
    })
    .filter((item) => allowed.has(item));
}

function normalizeContextCapabilities(value) {
  return Array.from(new Set(normalizeContextIncludeList(value).map((item) => {
    if (["selectedObjects", "todoDetails"].includes(item)) return "selectedTodo";
    if (["pageWorkContext", "projectTodos", "tagTodos", "statusTodos"].includes(item)) return "todos";
    if (item === "calendarBusyBlocks") return "busyBlocks";
    return item;
  }).filter((item) => ["selectedTodo", "todos", "entries", "busyBlocks"].includes(item))));
}

function normalizePlannerContextAssessment(value) {
  const source = normalizeObject(value);
  const declaredCapabilitySource = source.requiredCapabilities || source.capabilities || source.include || [];
  const declaredCapabilities = Array.isArray(declaredCapabilitySource)
    ? declaredCapabilitySource
    : [declaredCapabilitySource];
  const rawRequirements = Array.isArray(source.required)
    ? source.required
    : Array.isArray(source.requirements)
      ? source.requirements
      : [];
  const requirementCapabilities = rawRequirements.flatMap((item) => (
    typeof item === "string"
      ? [item]
      : [item?.capability || item?.dataType || item?.type]
  ));
  const requiredCapabilities = normalizeContextCapabilities([
    ...declaredCapabilities,
    ...requirementCapabilities,
  ]);
  const status = normalizeText(source.status, 40);
  const declared = Object.keys(source).length > 0;
  const sufficient = source.sufficient === true || status === "sufficient" || (!declared && !requiredCapabilities.length);
  return {
    schema: AI_CONTEXT_ASSESSMENT_SCHEMA,
    declared,
    sufficient,
    requiredCapabilities,
    scopeMode: normalizeText(source.scopeMode || source.scope_mode || source.scope, 80),
    range: normalizeDateRange(source.range || source.dateRange),
    detailLevel: normalizeText(source.detailLevel || source.detail, 80),
    reason: sanitizeUserVisibleTaskText(source.reason || source.explanation, 600),
  };
}

function normalizeContextContinuation(value) {
  const source = normalizeObject(value);
  if (!Object.keys(source).length) return null;
  const requiredCapabilities = normalizeContextCapabilities(
    source.requiredCapabilities || source.required || source.include,
  );
  if (!requiredCapabilities.length) return null;
  return {
    schema: AI_CONTEXT_CONTINUATION_SCHEMA,
    resolutionId: normalizeText(source.resolutionId || source.id, 120),
    sourceRequestId: normalizeText(source.sourceRequestId || source.requestId, 120),
    rerunCount: Math.max(0, Math.min(1, Number.parseInt(String(source.rerunCount || 0), 10) || 0)),
    requiredCapabilities,
    scopeMode: normalizeText(source.scopeMode || source.scope_mode, 80),
    range: normalizeDateRange(source.range),
    surfaceRef: normalizeText(source.surfaceRef || source.surface_ref, 120),
    targetView: normalizeText(source.targetView || source.view, 80),
    previousAction: normalizeText(source.previousAction || source.action, 120),
    reason: sanitizeUserVisibleTaskText(source.reason, 600),
  };
}

function normalizeContextRequestType(value) {
  const raw = normalizeText(value, 80);
  const aliases = {
    time_window: "time_window_expand",
    detail_expand: "todo_detail_expand",
    todo_detail: "todo_detail_expand",
    project: "project_expand",
    tag: "tag_expand",
    status: "status_expand",
    calendar: "calendar_expand",
  };
  const normalized = aliases[raw] || raw;
  const allowed = new Set([
    "time_window_expand",
    "todo_detail_expand",
    "project_expand",
    "tag_expand",
    "status_expand",
    "calendar_expand",
  ]);
  return allowed.has(normalized) ? normalized : "time_window_expand";
}

function normalizeContextRequest(value) {
  const source = normalizeObject(value);
  if (!Object.keys(source).length) return null;
  const range = normalizeDateRange(source.range || source.dateRange || source);
  const include = normalizeContextIncludeList(source.include || source.includes || source.dataTypes);
  const reason = sanitizeUserVisibleTaskText(source.reason || source.message || source.explanation, 600);
  const rawType = source.requestType || source.expansionType || source.kind || (
    source.type === "need_more_context" || source.type === "context_request" ? "" : source.type
  );
  const todoIds = normalizeIdList(source.todoIds || source.todoId, 12);
  const project = normalizeText(source.project, 120);
  const category = normalizeText(source.category, 80);
  const tag = normalizeText(source.tag, 80);
  const status = normalizeText(source.status, 80);
  const detailLevel = normalizeText(source.detailLevel || source.level, 80);
  const target = normalizeText(source.target || source.scope, 120);
  if (!reason && !range.start && !include.length && !todoIds.length && !project && !category && !tag && !status && !detailLevel && !target) return null;
  return {
    schema: AI_CONTEXT_REQUEST_SCHEMA,
    requestType: normalizeContextRequestType(rawType),
    target,
    detailLevel,
    todoIds,
    project,
    category,
    tag,
    status,
    reason: reason || "当前默认上下文不足，需要本轮授权查看更多数据。",
    range,
    include: include.length ? include : ["todos"],
    maxItems: Math.max(1, Math.min(200, Number.parseInt(String(source.maxItems || source.limit || 80), 10) || 80)),
    authorization: "per_turn_required",
  };
}

function normalizeContextGrant(value) {
  const source = normalizeObject(value);
  if (!Object.keys(source).length) return null;
  const requested = normalizeContextRequest(source.request || source.contextRequest || source);
  if (!requested) return null;
  return {
    schema: AI_CONTEXT_GRANT_SCHEMA,
    approved: source.approved !== false,
    sourceRequestId: normalizeText(source.sourceRequestId || source.requestId, 120),
    rerunCount: Math.max(0, Math.min(2, Number.parseInt(String(source.rerunCount || 0), 10) || 0)),
    grantSource: normalizeText(source.grantSource || source.source || "user_confirmed", 80),
    request: requested,
  };
}

function normalizeContextAccessPolicy(value) {
  const source = normalizeObject(value);
  const rawMode = normalizeText(source.mode || "ask_each_time", 80);
  const allowedModes = new Set(["ask_each_time", "allow_conversation", "auto_allow", "no_reference"]);
  const mode = allowedModes.has(rawMode) ? rawMode : "ask_each_time";
  return {
    schema: AI_CONTEXT_ACCESS_POLICY_SCHEMA,
    mode,
    label: sanitizeUserVisibleTaskText(source.label || "", 80),
    conversationId: normalizeText(source.conversationId, 120),
    sessionTtlMinutes: Math.max(1, Math.min(24 * 60, Number.parseInt(String(source.sessionTtlMinutes || 60), 10) || 60)),
    allowedIncludes: normalizeContextIncludeList(source.allowedIncludes || source.include || ["todos", "entries", "busyBlocks"])
      .filter((item) => [
        "todos",
        "entries",
        "busyBlocks",
        "selectedObjects",
        "pageWorkContext",
        "globalBackgroundContext",
        "todoDetails",
        "projectTodos",
        "tagTodos",
        "statusTodos",
        "calendarBusyBlocks",
      ].includes(item)),
    maxAutoReruns: Math.max(0, Math.min(2, Number.parseInt(String(source.maxAutoReruns || 2), 10) || 2)),
  };
}

function sanitizeUserVisibleTaskText(value, maxLength = 1200) {
  return normalizeText(value, maxLength)
    .replace(/观时\s*Planner/gi, "观时 AI 助手")
    .replace(/观时\s*Writer/gi, "观时 AI 助手")
    .replace(/\bPlanner\b/g, "观时 AI 助手")
    .replace(/\bWriter\b/g, "观时 AI 助手")
    .replace(/system prompt|系统提示词|隐藏上下文|模型输入审计|内部流程/gi, "内部实现细节")
    .replace(/路由为?回答或工具|路由回答或工具/g, "判断是直接回答还是创建待确认草稿")
    .replace(/受控工具/g, "受控功能")
    .replace(/路由/g, "判断");
}

function normalizeDomainModules(value) {
  if (value && typeof value.listTools === "function" && typeof value.getTool === "function") {
    return value;
  }
  if (Array.isArray(value)) {
    return createDomainModuleRegistry({ modules: value });
  }
  return createDomainModuleRegistry();
}

function normalizeToolRecord(tool) {
  const source = normalizeObject(tool);
  return {
    tool_id: normalizeText(source.tool_id || source.toolId, 100),
    legacy_action: normalizeText(source.legacy_action || source.legacyAction, 80),
    label: normalizeText(source.label || source.tool_id || source.toolId, 100),
    mode: normalizeText(source.mode || "draft", 40),
    requiresUserConfirmation: source.requiresUserConfirmation === true,
    scopes: Array.isArray(source.scopes) ? source.scopes.map((item) => normalizeText(item, 80)).filter(Boolean) : [],
    draft_schema: Array.isArray(source.draft_schema || source.draftSchema)
      ? (source.draft_schema || source.draftSchema).map((item) => normalizeText(item, 80)).filter(Boolean)
      : [],
    module_id: normalizeText(source.module_id || source.moduleId, 80),
    memory_namespace: normalizeText(source.memory_namespace || source.memoryNamespace, 100),
    apply_policy: normalizeObject(source.apply_policy || source.applyPolicy),
  };
}

function createAssistantToolCatalog(domainModules) {
  const registry = normalizeDomainModules(domainModules);
  const toolList = registry.listTools();
  const tools = Array.isArray(toolList.tools)
    ? toolList.tools.map(normalizeToolRecord).filter((tool) => tool.tool_id && tool.legacy_action && tool.mode !== "disabled")
    : [];
  const aliases = new Map();
  const legacyCounts = new Map();
  for (const tool of tools) {
    aliases.set(tool.tool_id, tool);
    legacyCounts.set(tool.legacy_action, (legacyCounts.get(tool.legacy_action) || 0) + 1);
  }
  for (const tool of tools) {
    if (legacyCounts.get(tool.legacy_action) === 1) aliases.set(tool.legacy_action, tool);
  }
  return {
    registry,
    tools,
    aliases,
  };
}

function resolveAssistantTool(toolCatalog, toolName) {
  const catalog = toolCatalog?.aliases ? toolCatalog : createAssistantToolCatalog();
  const requested = normalizeText(toolName, 100);
  return requested ? catalog.aliases.get(requested) || null : null;
}

function createToolDecision(tool, parsed = {}, parseStatus = "json_tool", requestedTool = "") {
  const source = normalizeObject(parsed);
  return {
    type: "tool",
    tool: tool.tool_id,
    legacyAction: tool.legacy_action,
    label: tool.label,
    moduleId: tool.module_id,
    toolMode: tool.mode,
    requiresUserConfirmation: tool.requiresUserConfirmation,
    memoryNamespace: tool.memory_namespace,
    draftSchema: tool.draft_schema,
    applyPolicy: tool.apply_policy,
    arguments: normalizeObject(source.arguments),
    semanticAction: normalizeObject(source.semanticAction || source.semantic || source.actionPlan),
    contextAssessment: normalizePlannerContextAssessment(source.contextAssessment || source.context_assessment),
    answer: normalizeText(source.answer, 1000),
    reason: normalizeText(source.reason, 500),
    parseStatus,
    requestedTool: normalizeText(requestedTool || source.tool, 100),
  };
}

function normalizeWriterTask(source = {}, providerText = "") {
  const decision = normalizeObject(source);
  const rawTask = normalizeObject(decision.writerTask);
  const needsFollowUp = decision.needsFollowUp === true || rawTask.needsFollowUp === true;
  const goal = sanitizeUserVisibleTaskText(
    rawTask.goal || rawTask.handoff || decision.handoff || decision.answer || decision.message || providerText,
    1200,
  ) || "请根据本轮用户输入和可参考上下文，给出简洁、准确、不过度承诺的中文回复。";
  const mustAvoid = normalizeStringList(rawTask.mustAvoid || decision.mustAvoid, 8, 180);
  if (!mustAvoid.some((item) => /写入|已创建|已保存|待办|日历|提醒|记忆/.test(item))) {
    mustAvoid.push("不要声称已经写入待办、日历、提醒或记忆。");
  }
  if (!mustAvoid.some((item) => /待确认|提案|草稿|卡片/.test(item))) {
    mustAvoid.push("answer 模式没有本轮 Workflow 产物；不要声称已经创建、生成、保存或更新待确认卡片、草稿或记忆提案，也不要承诺稍后自动生成。");
  }
  if (!mustAvoid.some((item) => /Planner|Writer|system prompt|系统提示词|隐藏上下文|模型输入审计/.test(item))) {
    mustAvoid.push("不要提到 Planner、Writer、system prompt、隐藏上下文、模型输入审计。");
  }
  if (!mustAvoid.some((item) => /responseShape|needsFollowUp|写作任务|写作工单|来写正文/.test(item))) {
    mustAvoid.push("不要复述写作任务、responseShape、tone、needsFollowUp、mustMention、mustAvoid、reason、boundary 等工单字段；不要输出“好的，来写正文”等过渡语。");
  }
  return {
    schema: AI_WRITER_TASK_SCHEMA,
    goal,
    responseShape: sanitizeUserVisibleTaskText(
      rawTask.responseShape || decision.responseShape || (needsFollowUp
        ? "一句承接后只追问一个关键问题。"
        : "简洁中文正文；先回应用户当前意图，再给必要的下一步。"),
      240,
    ),
    mustMention: normalizeStringList(rawTask.mustMention || decision.mustMention, 8, 180)
      .map((item) => sanitizeUserVisibleTaskText(item, 180))
      .filter(Boolean),
    mustAvoid,
    tone: sanitizeUserVisibleTaskText(rawTask.tone || decision.tone || "简洁、准确、顺着用户当前意图", 160),
  };
}

function createAnswerDecision(parsed = {}, providerText = "", parseStatus = "json_answer") {
  const source = normalizeObject(parsed);
  const writerTask = normalizeWriterTask(source, providerText);
  return {
    type: "answer",
    intent: normalizeText(source.intent || "general_answer", 80),
    handoff: writerTask.goal,
    writerTask,
    needsFollowUp: source.needsFollowUp === true,
    boundary: normalizeText(source.boundary, 500),
    referenceKeys: normalizeReferenceKeys(source.referenceKeys, ["memory", "todos", "busyBlocks"]),
    semanticAction: normalizeObject(source.semanticAction || source.semantic || source.actionPlan),
    contextAssessment: normalizePlannerContextAssessment(source.contextAssessment || source.context_assessment),
    reason: normalizeText(source.reason || "model_selected_answer", 500),
    parseStatus,
  };
}

function createContextRequestDecision(parsed = {}, providerText = "", parseStatus = "json_context_request") {
  const source = normalizeObject(parsed);
  const contextRequest = normalizeContextRequest(source.contextRequest || source.requestedContext || source.context || source);
  const reason = sanitizeUserVisibleTaskText(source.reason || contextRequest?.reason || providerText, 800);
  const range = contextRequest?.range || {};
  const rangeText = range.start && range.end
    ? range.start === range.end
      ? range.start
      : `${range.start} 至 ${range.end}`
    : "指定范围";
  const includeText = Array.isArray(contextRequest?.include) && contextRequest.include.length
    ? contextRequest.include.join("、")
    : "相关数据";
  return {
    type: "need_more_context",
    intent: normalizeText(source.intent || "need_more_context", 80),
    contextRequest: contextRequest || {
      schema: AI_CONTEXT_REQUEST_SCHEMA,
      requestType: "time_window_expand",
      target: "time_window",
      detailLevel: "",
      todoIds: [],
      project: "",
      category: "",
      tag: "",
      status: "",
      reason: reason || "默认上下文不足，需要本轮授权查看更多数据。",
      range: { start: "", end: "" },
      include: ["todos"],
      maxItems: 80,
      authorization: "per_turn_required",
    },
    contextAssessment: normalizePlannerContextAssessment({
      sufficient: false,
      requiredCapabilities: contextRequest?.include || source.include || ["todos"],
      range: contextRequest?.range || source.range,
      detailLevel: contextRequest?.detailLevel || source.detailLevel,
      reason: reason || contextRequest?.reason,
    }),
    answer: sanitizeUserVisibleTaskText(
      source.answer || source.message || `我需要本轮参考 ${rangeText} 的${includeText}，才能继续判断。`,
      1000,
    ),
    reason,
    referenceKeys: normalizeReferenceKeys(source.referenceKeys, ["todos", "entries", "busyBlocks"]),
    parseStatus,
  };
}

function normalizeMessages(value) {
  const source = Array.isArray(value) ? value : [];
  return source
    .slice(-8)
    .map((message) => {
      const role = message?.role === "assistant" ? "assistant" : "user";
      const content = normalizeText(message?.content || message?.text, 1600);
      return content ? { role, content } : null;
    })
    .filter(Boolean);
}

function normalizeAssistantRequest(input = {}) {
  const source = normalizeObject(input);
  const schema = normalizeText(source.schema || AI_ASSISTANT_REQUEST_SCHEMA, 80);
  if (schema !== AI_ASSISTANT_REQUEST_SCHEMA) {
    throw createAssistantError("AI_ASSISTANT_SCHEMA_INVALID", "AI assistant request schema is invalid.", 400, { schema });
  }
  const text = normalizeRawText(source.text);
  if (!text) {
    throw createAssistantError("AI_ASSISTANT_TEXT_REQUIRED", "AI assistant text is required.", 400);
  }
  const inputPayload = normalizeObject(source.input);
  const semanticFeedback = normalizeSemanticFeedback(source.semanticFeedback || inputPayload.semanticFeedback);
  const contextGrant = normalizeContextGrant(source.contextGrant || inputPayload.contextGrant);
  const contextContinuation = normalizeContextContinuation(source.contextContinuation || inputPayload.contextContinuation);
  const contextAccessPolicy = normalizeContextAccessPolicy(source.contextAccessPolicy || inputPayload.contextAccessPolicy);
  const currentDate = normalizeText(inputPayload.currentDate, 20) || new Date().toISOString().slice(0, 10);
  const intentHint = normalizeText(source.intentHint || source.actionHint, 100);
  return {
    schema,
    requestId: normalizeText(source.requestId || `assistant_${Date.now()}`, 120),
    locale: normalizeText(source.locale || "zh-CN", 20),
    timezone: normalizeText(source.timezone || "Asia/Shanghai", 80),
    providerId: normalizeText(source.providerId, 80),
    text,
    intentHint,
    messages: normalizeMessages(source.messages),
    input: {
      ...inputPayload,
      currentDate,
      text,
      semanticFeedback,
      contextGrant,
      contextContinuation,
      contextAccessPolicy,
    },
    semanticFeedback,
    contextGrant,
    contextContinuation,
    contextAccessPolicy,
    contextPolicy: normalizeObject(source.contextPolicy),
    allowExternalRequest: source.allowExternalRequest === true,
  };
}

function summarizeTodo(todo) {
  const dependencies = Array.isArray(todo?.dependencies)
    ? todo.dependencies.map((item) => normalizeText(item, 80)).filter(Boolean).slice(0, 12)
    : [];
  const note = normalizeText(todo?.note || todo?.notes || todo?.noteDigest, 1500);
  const summary = {
    id: normalizeText(todo?.id, 80),
    title: normalizeText(todo?.title || "未命名待办", 120),
    category: normalizeText(todo?.category, 80),
    project: normalizeText(todo?.project, 80),
    tags: Array.isArray(todo?.tags) ? todo.tags.map((item) => normalizeText(item, 40)).filter(Boolean).slice(0, 8) : [],
    dueDate: normalizeText(todo?.dueDate, 20),
    startTime: normalizeText(todo?.startTime, 8),
    endTime: normalizeText(todo?.endTime, 8),
    estimatedMinutes: Number(todo?.estimatedMinutes || todo?.remainingMinutes || 0) || undefined,
    remainingMinutes: Number(todo?.remainingMinutes || todo?.estimatedMinutes || 0) || undefined,
    planLocked: todo?.planLocked === true,
  };
  if (note) summary.note = note;
  if (dependencies.length) summary.dependencies = dependencies;
  return summary;
}

function summarizeBusyBlock(block) {
  return {
    date: normalizeText(block?.date, 20),
    start: normalizeText(block?.start, 8),
    end: normalizeText(block?.end, 8),
    isHard: block?.isHard !== false,
    titlePolicy: "masked",
  };
}

function summarizeEntry(entry) {
  return {
    id: normalizeText(entry?.id, 80),
    date: normalizeText(entry?.date, 20),
    start: normalizeText(entry?.start || entry?.startTime, 8),
    end: normalizeText(entry?.end || entry?.endTime, 8),
    durationMinutes: Number(entry?.durationMinutes || 0) || undefined,
    title: normalizeText(entry?.title || entry?.name || entry?.summary, 120),
    category: normalizeText(entry?.category, 80),
    project: normalizeText(entry?.project, 80),
    todoId: normalizeText(entry?.todoId || entry?.sourceTodoId, 80),
  };
}

function summarizeTodoForPage(todo) {
  const summary = summarizeTodo(todo);
  delete summary.note;
  delete summary.dependencies;
  const source = normalizeObject(todo);
  if (source.completed === true) summary.completed = true;
  if (normalizeText(source.note || source.notes || source.noteDigest, 10)) summary.hasNote = true;
  if (Array.isArray(source.dependencies) && source.dependencies.some((item) => normalizeText(item, 80))) {
    summary.hasDependencies = true;
  }
  return summary;
}

function normalizeWorkflowTodoCandidate(todo) {
  const source = normalizeObject(todo);
  const id = normalizeText(source.id || source.todoId, 120);
  const title = normalizeText(source.title || source.name, 200);
  if (!id && !title) return null;
  return {
    id,
    title: title || "未命名待办",
    category: normalizeText(source.category, 80),
    project: normalizeText(source.project, 120),
    tags: Array.isArray(source.tags) ? source.tags.slice(0, 16).map((item) => normalizeText(item, 60)).filter(Boolean) : [],
    dueDate: normalizeText(source.dueDate, 20),
    startTime: normalizeText(source.startTime, 8),
    endTime: normalizeText(source.endTime, 8),
    estimatedMinutes: Number(source.estimatedMinutes || source.remainingMinutes || 0) || undefined,
    remainingMinutes: Number(source.remainingMinutes || source.estimatedMinutes || 0) || undefined,
    priority: normalizeText(source.priority, 40),
    importance: Number(source.importance || 0) || 0,
    urgency: Number(source.urgency || 0) || 0,
    taskType: normalizeText(source.taskType, 80),
    energyLevel: normalizeText(source.energyLevel, 40),
    splittable: source.splittable === true,
    minimumBlockMinutes: Number(source.minimumBlockMinutes || 0) || undefined,
    dependencies: Array.isArray(source.dependencies)
      ? source.dependencies.slice(0, 24).map((item) => normalizeText(item, 120)).filter(Boolean)
      : [],
    planLocked: source.planLocked === true,
    completed: source.completed === true,
    orderInDay: Number.isFinite(Number(source.orderInDay)) ? Number(source.orderInDay) : undefined,
  };
}

function normalizeWorkflowTodoCandidates(value, maxItems = 200) {
  const source = Array.isArray(value) ? value : [];
  const byKey = new Map();
  for (const item of source.slice(0, maxItems)) {
    const todo = normalizeWorkflowTodoCandidate(item);
    if (!todo) continue;
    const key = todo.id ? `id:${todo.id}` : `title:${todo.title}`;
    if (!byKey.has(key)) byKey.set(key, todo);
  }
  return Array.from(byKey.values());
}

function normalizeMaterialRefs(value) {
  const source = Array.isArray(value) ? value : [];
  return source.slice(0, 24).map((item) => {
    const material = normalizeObject(item);
    const materialId = normalizeText(material.materialId || material.id, 120);
    const name = normalizeText(material.name || material.fileName || material.title, 240);
    if (!materialId && !name) return null;
    return {
      materialId,
      name,
      mimeType: normalizeText(material.mimeType || material.type, 120),
      sizeBytes: Math.max(0, Number.parseInt(String(material.sizeBytes || material.size || 0), 10) || 0),
      status: normalizeText(material.status || "available", 40),
      summary: normalizeText(material.summary, 2000),
      snippetRefs: normalizeIdList(material.snippetRefs || material.chunkIds, 24),
    };
  }).filter(Boolean);
}

function buildLatestScheduleDraftState(draftStore, fallback = {}) {
  const fallbackState = normalizeObject(fallback);
  if (!draftStore || typeof draftStore.listDrafts !== "function") return fallbackState;
  try {
    const latest = draftStore.listDrafts()[0];
    if (!latest) return fallbackState;
    return {
      draftId: normalizeText(latest.draftId, 120),
      status: normalizeText(latest.status, 40),
      summary: normalizeText(latest.summary, 240),
      changeCount: Array.isArray(latest.changes) ? latest.changes.length : 0,
      updatedAt: normalizeText(latest.updatedAt || latest.createdAt, 80),
    };
  } catch {
    return fallbackState;
  }
}

function normalizeCount(value) {
  const parsed = Number.parseInt(String(value || 0), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function normalizeDistribution(value) {
  const source = Array.isArray(value) ? value : [];
  return source
    .slice(0, 12)
    .map((item) => {
      const entry = normalizeObject(item);
      const label = normalizeText(entry.label || entry.name || entry.project || entry.tag || entry.category, 120);
      if (!label) return null;
      return {
        label,
        count: normalizeCount(entry.count),
      };
    })
    .filter(Boolean);
}

function normalizeStats(value) {
  const source = normalizeObject(value);
  const result = {};
  [
    "total",
    "unfinished",
    "completed",
    "overdue",
    "today",
    "next7Days",
    "unscheduled",
    "locked",
    "withoutProject",
    "withoutTags",
  ].forEach((key) => {
    if (source[key] !== undefined) result[key] = normalizeCount(source[key]);
  });
  return result;
}

function normalizeSelectedObjectsContext(value, fallback = {}) {
  const source = normalizeObject(value);
  const fallbackTodo = fallback.selectedTodo ? [fallback.selectedTodo] : [];
  const todosSource = Array.isArray(source.todos) ? source.todos : fallbackTodo;
  const todos = todosSource.slice(0, 5).map(summarizeTodo).filter((todo) => todo.id || todo.title);
  const selectedTodoIds = normalizeIdList(
    source.selectedTodoIds || source.todoIds || source.selection?.todoIds || todos.map((todo) => todo.id),
    10,
  );
  return {
    schema: normalizeText(source.schema || AI_SELECTED_OBJECTS_CONTEXT_SCHEMA, 80),
    surface: normalizeText(source.surface || fallback.viewContext?.surface || "unknown", 80),
    selectedTodoIds,
    todos,
    caps: {
      maxSelectedTodos: 5,
      noteMaxChars: 1500,
    },
    emptyReason: todos.length ? "" : normalizeText(source.emptyReason || "none_selected", 80),
  };
}

function normalizePageWorkContext(value, fallback = {}) {
  const source = normalizeObject(value);
  const fallbackTodos = Array.isArray(fallback.todos) ? fallback.todos : [];
  const fallbackEntries = Array.isArray(fallback.entries) ? fallback.entries : [];
  const fallbackBusyBlocks = Array.isArray(fallback.busyBlocks) ? fallback.busyBlocks : [];
  const rawTimeWindow = normalizeObject(source.timeWindow || source.visibleRange || source.range || fallback.referenceScope?.range);
  const timeWindow = normalizeDateRange(rawTimeWindow);
  const todos = (Array.isArray(source.todos) ? source.todos : fallbackTodos)
    .slice(0, 40)
    .map(summarizeTodoForPage)
    .filter((todo) => todo.id || todo.title);
  const entries = (Array.isArray(source.entries) ? source.entries : fallbackEntries)
    .slice(0, 30)
    .map(summarizeEntry)
    .filter((entry) => entry.id || entry.date);
  const busyBlocks = (Array.isArray(source.busyBlocks) ? source.busyBlocks : fallbackBusyBlocks)
    .slice(0, 40)
    .map(summarizeBusyBlock)
    .filter((block) => block.date || block.start || block.end);
  return {
    schema: normalizeText(source.schema || AI_PAGE_WORK_CONTEXT_SCHEMA, 80),
    surface: normalizeText(source.surface || fallback.viewContext?.surface || "unknown", 80),
    businessDataIncluded: source.businessDataIncluded !== false,
    timeWindow,
    listState: normalizeFilters(source.listState || source.filters || fallback.viewContext?.filters),
    stats: normalizeStats(source.stats),
    projectDistribution: normalizeDistribution(source.projectDistribution),
    tagDistribution: normalizeDistribution(source.tagDistribution),
    todos,
    entries,
    busyBlocks,
    caps: {
      maxTodos: 40,
      maxEntries: 30,
      maxBusyBlocks: 40,
      notePolicy: "summary_only_no_full_notes",
      calendarTitlePolicy: "busy_only_masked",
    },
  };
}

function normalizeGlobalRuntimeContext(value, fallbackRuntimeClock) {
  const source = normalizeObject(value);
  const clock = normalizeObject(source.runtimeClock || fallbackRuntimeClock);
  return {
    localDate: normalizeText(source.currentDate || clock.localDate, 20),
    localTime: normalizeText(source.localTime || clock.localTime, 8),
    displayText: normalizeText(source.displayText || clock.displayText, 80),
  };
}

function normalizeTimeWindowSummary(value) {
  const source = Array.isArray(value) ? value : [];
  return source
    .slice(0, 8)
    .map((item) => {
      const entry = normalizeObject(item);
      const date = normalizeText(entry.date, 20);
      if (!date) return null;
      return {
        date,
        todoCount: normalizeCount(entry.todoCount),
        lockedTodoCount: normalizeCount(entry.lockedTodoCount),
        busyBlockCount: normalizeCount(entry.busyBlockCount),
        estimatedTodoMinutes: normalizeCount(entry.estimatedTodoMinutes),
        busyMinutes: normalizeCount(entry.busyMinutes),
        pressure: normalizeText(entry.pressure, 20),
      };
    })
    .filter(Boolean);
}

function normalizeGlobalBackgroundContext(value, fallback = {}) {
  const source = normalizeObject(value);
  const defaultTimeWindow = normalizeObject(source.defaultTimeWindow || fallback.defaultTimeWindow);
  return {
    schema: normalizeText(source.schema || AI_GLOBAL_BACKGROUND_CONTEXT_SCHEMA, 80),
    businessDataIncluded: source.businessDataIncluded !== false,
    runtime: normalizeGlobalRuntimeContext(source, fallback.runtimeClock),
    defaultTimeWindow: {
      start: normalizeText(defaultTimeWindow.start, 20),
      end: normalizeText(defaultTimeWindow.end || defaultTimeWindow.start, 20),
      rule: normalizeText(defaultTimeWindow.rule || "default_past_2_future_3_days", 80),
    },
    timeWindowSummary: normalizeTimeWindowSummary(source.timeWindowSummary),
    pendingState: {
      pendingDraftCount: normalizeCount(source.pendingState?.pendingDraftCount),
      latestScheduleDraft: Object.keys(normalizeObject(source.pendingState?.latestScheduleDraft)).length
        ? {
          draftId: normalizeText(source.pendingState.latestScheduleDraft.draftId, 120),
          status: normalizeText(source.pendingState.latestScheduleDraft.status, 40),
          summary: normalizeText(source.pendingState.latestScheduleDraft.summary, 240),
          changeCount: normalizeCount(source.pendingState.latestScheduleDraft.changeCount),
          updatedAt: normalizeText(source.pendingState.latestScheduleDraft.updatedAt, 80),
        }
        : null,
    },
    caps: {
      noMemory: true,
      noTodoDetails: true,
      noCalendarTitles: true,
    },
  };
}

function normalizeIdList(value, maxItems = 20) {
  const source = Array.isArray(value) ? value : value ? [value] : [];
  return Array.from(new Set(source
    .map((item) => normalizeText(item, 120))
    .filter(Boolean)))
    .slice(0, Math.max(1, maxItems));
}

function normalizeFilters(value) {
  const source = normalizeObject(value);
  return {
    project: normalizeText(source.project, 120),
    category: normalizeText(source.category, 80),
    tag: normalizeText(source.tag, 80),
    status: normalizeText(source.status, 40),
    todoDimension: normalizeText(source.todoDimension, 40),
    currentRange: normalizeText(source.currentRange, 40),
    showHistory: source.showHistory === true,
    showRecurringOnly: source.showRecurringOnly === true,
  };
}

function normalizeViewContext(value) {
  const source = normalizeObject(value);
  const range = normalizeObject(source.visibleRange || source.range);
  const start = normalizeText(range.start || range.dateFrom || range.date, 20);
  const end = normalizeText(range.end || range.dateTo || start, 20);
  const selection = normalizeObject(source.selection);
  return {
    schema: normalizeText(source.schema || AI_VIEW_CONTEXT_SCHEMA, 80),
    source: normalizeText(source.source || "client", 40),
    activeView: normalizeText(source.activeView || source.view, 80),
    surface: normalizeText(source.surface || source.activeView || source.view || "unknown", 80),
    visibleRange: {
      start: /^\d{4}-\d{2}-\d{2}$/.test(start) ? start : "",
      end: /^\d{4}-\d{2}-\d{2}$/.test(end) ? end : "",
    },
    filters: normalizeFilters(source.filters),
    selection: {
      todoIds: normalizeIdList(selection.todoIds || selection.todoId),
      entryIds: normalizeIdList(selection.entryIds || selection.entryId),
      journalIds: normalizeIdList(selection.journalIds || selection.journalId),
    },
  };
}

function normalizeReferenceScope(input) {
  const scope = normalizeObject(input.referenceScope);
  const includes = normalizeObject(scope.includes);
  const range = normalizeObject(scope.range);
  const start = normalizeText(range.start || range.dateFrom || range.date, 20);
  const end = normalizeText(range.end || range.dateTo || start, 20);
  return {
    schema: normalizeText(scope.schema || AI_REFERENCE_SCOPE_SCHEMA, 80),
    requestedMode: normalizeText(scope.requestedMode || "unspecified", 80),
    resolvedMode: normalizeText(scope.resolvedMode || "unspecified", 80),
    source: normalizeText(scope.source || "unspecified", 40),
    label: normalizeText(scope.label || "", 80),
    range: start ? { start, end: end || start } : undefined,
    viewContext: normalizeViewContext(scope.viewContext || input.viewContext),
    includes: {
      selectedTodo: includes.selectedTodo === true,
      todos: includes.todos === true,
      busyBlocks: includes.busyBlocks === true,
      entries: includes.entries === true,
    },
  };
}

function resolveNowDate(now) {
  try {
    const value = typeof now === "function" ? now() : now;
    const date = value ? new Date(value) : new Date();
    if (Number.isFinite(date.getTime())) return date;
  } catch {
    // Fall back below.
  }
  return new Date();
}

function getZonedClockParts(date, timezone) {
  const safeTimezone = normalizeText(timezone, 80) || "Asia/Shanghai";
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
  try {
    return {
      timezone: safeTimezone,
      parts: new Intl.DateTimeFormat("en-US", formatterOptions).formatToParts(date),
    };
  } catch {
    return {
      timezone: "Asia/Shanghai",
      parts: new Intl.DateTimeFormat("en-US", {
        ...formatterOptions,
        timeZone: "Asia/Shanghai",
      }).formatToParts(date),
    };
  }
}

function buildRuntimeClock(request, options = {}) {
  const date = resolveNowDate(options.now);
  const { timezone, parts } = getZonedClockParts(date, request?.timezone || "Asia/Shanghai");
  const partMap = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const localDate = `${partMap.year}-${partMap.month}-${partMap.day}`;
  const localTime = `${partMap.hour}:${partMap.minute}`;
  const localTimeWithSeconds = `${localTime}:${partMap.second}`;
  const timezoneLabel = timezone === "Asia/Shanghai" ? "北京时间" : timezone;
  return {
    schema: AI_RUNTIME_CLOCK_SCHEMA,
    source: "server_received_at",
    utcIso: date.toISOString(),
    timezone,
    localDate,
    localTime,
    localTimeWithSeconds,
    localDateTime: `${localDate} ${localTime}`,
    localDateTimeWithSeconds: `${localDate} ${localTimeWithSeconds}`,
    displayText: `${timezoneLabel} ${localTime}`,
  };
}

function parseProgressNumber(summary, pattern) {
  const match = pattern.exec(summary);
  if (!match) return null;
  const value = Number.parseInt(match[1], 10);
  return Number.isFinite(value) ? value : null;
}

function buildProgressContext(input, request, hintedTool) {
  const raw = normalizeText(input.progressSummary, 800);
  const actionMatch = /动作：([^。；\n]+)/.exec(raw);
  return {
    schema: "guanshi-ai-progress-context-v1",
    contextAction: normalizeText(actionMatch?.[1] || hintedTool?.legacy_action || request.intentHint || "assistant", 80),
    unfinishedTodoCount: parseProgressNumber(raw, /当前未完成待办\s*(\d+)\s*个/),
    todayTodoCount: parseProgressNumber(raw, /今日待办\s*(\d+)\s*个/),
    todayBusyBlockCount: parseProgressNumber(raw, /今日已有记录\/忙碌块\s*(\d+)\s*个/),
    raw,
  };
}

function buildContextBundleForModel(request, toolCatalog, options = {}) {
  const input = normalizeObject(request.input);
  const contextCandidates = normalizeObject(input.contextCandidates);
  const executionCandidates = normalizeObject(contextCandidates.execution || input.executionContext);
  const hintedTool = resolveAssistantTool(toolCatalog, request.intentHint);
  const runtimeClock = buildRuntimeClock(request, options);
  const referenceScope = normalizeReferenceScope(input);
  const viewContext = normalizeViewContext(input.viewContext || referenceScope.viewContext);
  const todos = Array.isArray(input.todos) ? input.todos.slice(0, 20).map(summarizeTodo) : [];
  const busyBlocks = Array.isArray(input.busyBlocks) ? input.busyBlocks.slice(0, 20).map(summarizeBusyBlock) : [];
  const entries = Array.isArray(input.entries) ? input.entries.slice(0, 30).map(summarizeEntry) : [];
  const selectedObjectsSource = contextCandidates.selectedObjects || input.selectedObjects;
  const pageWorkContextSource = contextCandidates.pageWorkContext || input.pageWorkContext;
  const globalBackgroundContextSource = contextCandidates.globalBackgroundContext || input.globalBackgroundContext;
  const selectedObjects = normalizeSelectedObjectsContext(selectedObjectsSource, {
    selectedTodo: input.todo,
    viewContext,
  });
  const selectedTodo = input.todo ? summarizeTodo(input.todo) : selectedObjects.todos[0] || null;
  const pageWorkContext = normalizePageWorkContext(pageWorkContextSource, {
    todos,
    entries,
    busyBlocks,
    referenceScope,
    viewContext,
  });
  const globalBackgroundContext = normalizeGlobalBackgroundContext(globalBackgroundContextSource, {
    runtimeClock,
    defaultTimeWindow: buildDefaultContextWindow(normalizeText(input.currentDate, 20)),
  });
  const latestScheduleDraft = buildLatestScheduleDraftState(
    options.draftStore,
    globalBackgroundContext.pendingState.latestScheduleDraft,
  );
  globalBackgroundContext.pendingState.latestScheduleDraft = Object.keys(latestScheduleDraft).length
    ? latestScheduleDraft
    : null;
  const executionTodosSource = Array.isArray(executionCandidates.todos)
    ? executionCandidates.todos
    : [
      ...(Array.isArray(input.todos) ? input.todos : []),
      ...(Array.isArray(normalizeObject(pageWorkContextSource).todos) ? pageWorkContextSource.todos : []),
      ...(Array.isArray(normalizeObject(selectedObjectsSource).todos) ? selectedObjectsSource.todos : []),
    ];
  const executionBusyBlocksSource = Array.isArray(executionCandidates.busyBlocks)
    ? executionCandidates.busyBlocks
    : [
      ...(Array.isArray(input.busyBlocks) ? input.busyBlocks : []),
      ...(Array.isArray(normalizeObject(pageWorkContextSource).busyBlocks) ? pageWorkContextSource.busyBlocks : []),
    ];
  const executionTodos = normalizeWorkflowTodoCandidates(executionTodosSource, 200);
  const executionBusyBlocks = executionBusyBlocksSource.slice(0, 200).map(summarizeBusyBlock);
  const materials = normalizeMaterialRefs(contextCandidates.materials || input.materials);
  const dateReference = resolveDateReference({
    text: request.text,
    currentDate: normalizeText(input.currentDate, 20),
    defaultWindow: buildDefaultContextWindow(normalizeText(input.currentDate, 20)),
  });
  const progress = buildProgressContext(input, request, hintedTool);
  const contextAction = normalizeText(hintedTool?.legacy_action || request.intentHint || progress.contextAction || "assistant", 80);
  const memoryContext = buildModelMemoryContext({
    memoryStore: options.memoryStore,
    request,
    contextPolicy: request.contextPolicy,
    action: contextAction,
    selectedObjects,
    pageWorkContext,
    globalBackgroundContext,
  });
  const context = {
    schema: AI_CONTEXT_ENVELOPE_SCHEMA,
    currentDate: normalizeText(input.currentDate, 20),
    timezone: request.timezone,
    intentHint: hintedTool?.tool_id || request.intentHint || "none",
    runtimeClock,
    referenceScope,
    viewContext,
    dateReference,
    contextGrant: request.contextGrant,
    contextContinuation: request.contextContinuation,
    contextAccessPolicy: request.contextAccessPolicy,
    progress: {
      ...progress,
      contextAction,
    },
    selectedObjects,
    pageWorkContext,
    globalBackgroundContext,
    selectedTodo,
    todos,
    entries,
    busyBlocks,
    materials,
    constraints: {
      calendarTitles: "masked",
      writePolicy: "tools_create_drafts_only_user_confirms_in_ui",
    },
  };
  const turnContext = {
    schema: AI_TURN_CONTEXT_SCHEMA,
    requestId: request.requestId,
    contextCandidatesSchema: normalizeText(contextCandidates.schema || AI_CONTEXT_CANDIDATES_SCHEMA, 80),
    modelContext: context,
    execution: {
      todos: executionTodos,
      busyBlocks: executionBusyBlocks,
      source: Array.isArray(executionCandidates.todos) ? "context_candidates.execution" : "normalized_context_fallback",
    },
    materials,
  };
  return {
    context,
    turnContext,
    memoryContext,
    memoryPromptBlock: renderModelMemoryPromptBlock(memoryContext),
  };
}

function buildContextForModel(request, toolCatalog, options = {}) {
  return buildContextBundleForModel(request, toolCatalog, options).context;
}

function describeCatalogTool(tool) {
  const legacy = LEGACY_TOOL_DEFINITIONS[tool.legacy_action] || {};
  const confirmation = tool.requiresUserConfirmation
    ? "只创建待确认草稿/提案；必须等用户在 UI 确认后才可写入"
    : "只生成回答或洞察；不写入用户数据";
  const draftSchema = tool.draft_schema.length ? `；产物：${tool.draft_schema.join(", ")}` : "";
  return [
    `- ${tool.tool_id}｜${tool.label}`,
    `触发：${legacy.description || tool.label}`,
    `边界：${confirmation}${draftSchema}`,
  ].filter(Boolean).join("｜");
}

function buildSemanticAction(request, decision = {}) {
  const args = normalizeObject(decision.arguments);
  const supplied = normalizeObject(decision.semanticAction || decision.semantic || args.semanticAction || args.semantic || args.actionPlan);
  const suppliedArguments = normalizeObject(supplied.arguments);
  const action = decision.type === "tool"
    ? normalizeText(decision.legacyAction || decision.tool, 100)
    : normalizeText(supplied.action || decision.intent || "answer", 100);
  const sourceText = normalizeText(
    supplied.sourceText || args.sourceText || args.text || request.text,
    1200,
  );
  const normalizedGoal = sanitizeUserVisibleTaskText(
    supplied.normalizedGoal
      || args.normalizedGoal
      || args.goal
      || (decision.type === "tool" ? args.text || sourceText : "")
      || decision.handoff
      || decision.answer
      || sourceText,
    1200,
  );
  const confidence = Math.max(0, Math.min(1, normalizeNumber(supplied.confidence ?? args.confidence, decision.type === "tool" ? 0.72 : 0.68)));
  const contextRefs = normalizeStringList(
    supplied.contextRefs || args.contextRefs || decision.referenceKeys,
    12,
    80,
  );
  const memoryRefs = normalizeStringList(
    supplied.memoryRefs || args.memoryRefs || args.memoryIds,
    12,
    120,
  );
  const targetObjects = normalizeSemanticMessageList(
    supplied.targetObjects || args.targetObjects || args.todoRefs || args.selectedTodoIds || args.todoId,
    12,
    160,
  );
  const assumptions = normalizeSemanticMessageList(supplied.assumptions || args.assumptions, 6, 180);
  const missingFields = normalizeStringList(supplied.missingFields || args.missingFields, 8, 80);
  const warnings = normalizeSemanticMessageList(supplied.warnings || args.warnings, 6, 220);
  return {
    schema: AI_SEMANTIC_ACTION_SCHEMA,
    mode: normalizeText(decision.type || "answer", 40),
    action,
    tool: normalizeText(decision.tool, 100),
    intent: normalizeText(decision.intent || action, 100),
    sourceText,
    normalizedGoal,
    targetObjects,
    contextRefs,
    memoryRefs,
    assumptions,
    missingFields,
    warnings,
    confidence,
    requiresConfirmation: decision.requiresUserConfirmation === true || supplied.requiresConfirmation === true,
    arguments: normalizeSemanticArguments({
      ...suppliedArguments,
      ...args,
    }),
  };
}

function extractIsoDateFromText(value) {
  const match = /\b(\d{4}-\d{2}-\d{2})\b/.exec(normalizeText(value, 2000));
  return match ? match[1] : "";
}

function extractClockFromText(value) {
  const match = /\b(\d{1,2}):(\d{2})\b/.exec(normalizeText(value, 2000));
  if (!match) return "";
  const hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return "";
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function resolveRequestCurrentDate(request) {
  const fromInput = normalizeText(request?.input?.currentDate, 20);
  if (/^\d{4}-\d{2}-\d{2}$/.test(fromInput)) return fromInput;
  const date = new Date();
  return [
    String(date.getFullYear()).padStart(4, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function getDefaultContextWindow(request) {
  return buildDefaultContextWindow(resolveRequestCurrentDate(request));
}

function requestNeedsHistoricalContext(text) {
  return hasHistoricalContextIntent(text);
}

function shiftIsoDate(dateText, deltaDays) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalizeText(dateText, 20));
  if (!match) return "";
  const value = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (!Number.isFinite(value.getTime())) return "";
  value.setUTCDate(value.getUTCDate() + Number(deltaDays || 0));
  return value.toISOString().slice(0, 10);
}

function normalizeMinimumContext(value) {
  const source = normalizeObject(value);
  return {
    requiredCapabilities: normalizeContextCapabilities(source.required || source.requiredCapabilities),
    scopeMode: normalizeText(source.scope_mode || source.scopeMode, 80),
  };
}

function getDecisionMinimumContext(decision, toolCatalog) {
  if (decision?.type !== "tool" || !toolCatalog?.registry) return normalizeMinimumContext(null);
  const moduleId = normalizeText(decision.moduleId || decision.tool?.split?.(".")?.[0], 80);
  if (!moduleId) return normalizeMinimumContext(null);
  try {
    const bundle = toolCatalog.registry.getActionRegistry(moduleId);
    const actions = Array.isArray(bundle?.action_registry) ? bundle.action_registry : [];
    const action = actions.find((item) => item?.action_id === decision.tool || item?.legacy_action === decision.legacyAction);
    const minimum = normalizeMinimumContext(action?.minimum_context);
    const argumentsSource = normalizeObject(decision?.arguments);
    const explicitTodoRefs = normalizeIdList(
      argumentsSource.contextRefs
        || argumentsSource.todoRefs
        || argumentsSource.todoIds
        || argumentsSource.sourceTodoId,
      20,
    );
    if (minimum.requiredCapabilities.includes("selectedTodo") && explicitTodoRefs.length) {
      return {
        ...minimum,
        requiredCapabilities: minimum.requiredCapabilities.map((item) => item === "selectedTodo" ? "todos" : item),
      };
    }
    return minimum;
  } catch {
    return normalizeMinimumContext(null);
  }
}

function getCurrentContextCapabilities(request) {
  const input = normalizeObject(request?.input);
  const referenceScope = normalizeReferenceScope(input);
  const pageSource = normalizeObject(input.pageWorkContext || input.contextCandidates?.pageWorkContext);
  const pageWorkContext = normalizePageWorkContext(pageSource, { referenceScope, viewContext: referenceScope.viewContext });
  const selectedSource = input.selectedObjects || input.contextCandidates?.selectedObjects;
  const selectedObjects = normalizeSelectedObjectsContext(selectedSource, {
    selectedTodo: input.todo,
    viewContext: referenceScope.viewContext,
  });
  const available = [];
  if (pageWorkContext.businessDataIncluded) {
    if (referenceScope.includes.todos) available.push("todos");
    if (referenceScope.includes.entries) available.push("entries");
    if (referenceScope.includes.busyBlocks) available.push("busyBlocks");
  }
  if (referenceScope.includes.selectedTodo && selectedObjects.todos.length) available.push("selectedTodo");
  return {
    capabilities: Array.from(new Set(available)),
    referenceScope,
    pageWorkContext,
    selectedObjects,
    surface: normalizeText(referenceScope.viewContext?.surface || pageWorkContext.surface, 80),
    activeView: normalizeText(
      referenceScope.viewContext?.activeView
        || referenceScope.viewContext?.view
        || pageWorkContext.activeView
        || pageWorkContext.view,
      80,
    ),
  };
}

function getRequirementRange(request, requirement) {
  const explicit = normalizeDateRange(requirement?.range);
  if (explicit.start) return explicit;
  const currentDate = resolveRequestCurrentDate(request);
  const mode = normalizeText(requirement?.scopeMode, 80);
  if (["today", "selected_todo", "selected_with_today"].includes(mode)) {
    return { start: currentDate, end: currentDate };
  }
  if (mode === "week") return { start: currentDate, end: shiftIsoDate(currentDate, 6) };
  if (mode === "reflow_unfinished") return { start: currentDate, end: shiftIsoDate(currentDate, 1) };
  return { start: "", end: "" };
}

function isRequirementWithinLocalScope(request, requirement) {
  if (request?.contextAccessPolicy?.mode === "no_reference") return false;
  const requested = getRequirementRange(request, requirement);
  if (!requested.start) return true;
  const mode = normalizeText(requirement?.scopeMode, 80);
  if (["today", "week", "selected_todo", "selected_with_today", "reflow_unfinished"].includes(mode)) return true;
  const currentScope = normalizeReferenceScope(normalizeObject(request?.input));
  const currentRange = normalizeDateRange(currentScope.range || currentScope.viewContext?.visibleRange);
  if (currentRange.start) return requested.start >= currentRange.start && requested.end <= currentRange.end;
  const defaultWindow = getDefaultContextWindow(request);
  return Boolean(defaultWindow && requested.start >= defaultWindow.start && requested.end <= defaultWindow.end);
}

function listContextSurfaceEntries(toolCatalog) {
  const registry = toolCatalog?.registry;
  if (!registry || typeof registry.listModules !== "function") return [];
  const modules = registry.listModules()?.modules || [];
  return modules.flatMap((moduleInfo) => {
    try {
      const bundle = registry.getActionRegistry(moduleInfo.module_id);
      return (Array.isArray(bundle?.ui_registry) ? bundle.ui_registry : []).map((item) => ({
        surfaceRef: normalizeText(item?.ui_id, 120),
        view: normalizeText(item?.context_surface?.view, 80),
        provides: normalizeContextCapabilities(item?.context_surface?.provides),
        contextModes: normalizeStringList(item?.context_surface?.context_modes, 30, 80),
        actionRefs: normalizeStringList(item?.context_surface?.action_refs, 30, 120),
        priority: Number(item?.context_surface?.priority || 0) || 0,
      })).filter((item) => item.surfaceRef && item.view && item.provides.length);
    } catch {
      return [];
    }
  });
}

function resolveContextSurface(toolCatalog, requiredCapabilities, scopeMode, decision, currentContext) {
  if (requiredCapabilities.includes("selectedTodo") && !currentContext.selectedObjects.todos.length) return null;
  const actionRefs = new Set([decision?.tool, decision?.legacyAction].map((item) => normalizeText(item, 120)).filter(Boolean));
  return listContextSurfaceEntries(toolCatalog)
    .filter((entry) => requiredCapabilities.every((capability) => entry.provides.includes(capability)))
    .filter((entry) => !scopeMode || !entry.contextModes.length || entry.contextModes.includes(scopeMode))
    .map((entry) => ({
      ...entry,
      score: (entry.actionRefs.some((action) => actionRefs.has(action)) ? 100 : 0) + entry.priority,
    }))
    .sort((left, right) => right.score - left.score)[0] || null;
}

function buildContextRequirement(request, decision, toolCatalog) {
  const assessment = normalizePlannerContextAssessment(decision?.contextAssessment);
  const minimum = getDecisionMinimumContext(decision, toolCatalog);
  const contextRequest = normalizeContextRequest(decision?.contextRequest);
  const requiredCapabilities = Array.from(new Set([
    ...assessment.requiredCapabilities,
    ...minimum.requiredCapabilities,
    ...normalizeContextCapabilities(contextRequest?.include),
  ]));
  const scopeMode = assessment.scopeMode || minimum.scopeMode || normalizeReferenceScope(normalizeObject(request?.input)).resolvedMode;
  const range = contextRequest?.range?.start ? contextRequest.range : assessment.range;
  return {
    assessment,
    requiredCapabilities,
    scopeMode,
    range,
    detailLevel: contextRequest?.detailLevel || assessment.detailLevel,
    reason: assessment.reason || contextRequest?.reason || "当前上下文不足以完成本轮任务。",
  };
}

function createContextResolution(status, requirement, details = {}) {
  return {
    schema: AI_CONTEXT_RESOLUTION_SCHEMA,
    status,
    requiredCapabilities: requirement.requiredCapabilities,
    scopeMode: requirement.scopeMode,
    range: getRequirementRange(details.request, requirement),
    detailLevel: requirement.detailLevel,
    reason: sanitizeUserVisibleTaskText(details.reason || requirement.reason, 600),
    currentSurface: normalizeText(details.currentSurface, 80),
    surfaceRef: normalizeText(details.surfaceRef, 120),
    targetView: normalizeText(details.targetView, 80),
    authorization: status === "authorization_required" ? "per_turn_required" : "not_required",
    resolutionId: normalizeText(details.resolutionId, 120),
    rerunCount: Math.max(0, Math.min(1, Number(details.rerunCount || 0) || 0)),
    previousAction: normalizeText(details.previousAction, 120),
  };
}

function createAuthorizationDecision(request, previousDecision, requirement, reason) {
  const existing = normalizeContextRequest(previousDecision?.contextRequest);
  const range = getRequirementRange(request, requirement);
  const contextRequest = existing || {
    schema: AI_CONTEXT_REQUEST_SCHEMA,
    requestType: requirement.detailLevel ? "todo_detail_expand" : "time_window_expand",
    target: requirement.detailLevel ? "todo_detail" : "time_window",
    detailLevel: requirement.detailLevel,
    todoIds: [],
    project: "",
    category: "",
    tag: "",
    status: "",
    reason: sanitizeUserVisibleTaskText(reason || requirement.reason, 600),
    range,
    include: requirement.requiredCapabilities.length ? requirement.requiredCapabilities : ["todos"],
    maxItems: 80,
    authorization: "per_turn_required",
  };
  return createContextRequestDecision({
    contextRequest,
    reason: contextRequest.reason,
  }, "", previousDecision?.parseStatus === "json_context_request" ? "json_context_request" : "context_resolution_authorization");
}

function isDefaultContextScope(request) {
  const scope = normalizeReferenceScope(normalizeObject(request?.input));
  if (scope.resolvedMode === "default_2_3") return true;
  return scope.requestedMode === "auto" && scope.source === "auto" && scope.resolvedMode !== "granted_range";
}

function resolveOutOfDefaultContextRequest(request) {
  if (request?.contextGrant?.approved === true) return null;
  if (!isDefaultContextScope(request)) return null;
  const source = normalizeText(request?.text, 4000);
  if (!source || !requestNeedsHistoricalContext(source)) return null;
  const currentDate = resolveRequestCurrentDate(request);
  const defaultWindow = getDefaultContextWindow(request);
  if (!defaultWindow) return null;
  const dateReferenceResolution = resolveDateReference({
    text: source,
    currentDate,
    defaultWindow,
  });
  return dateReferenceResolution?.requiresExpandedContext === true ? dateReferenceResolution : null;
}

function enforceContextSufficiencyGuard(request, decision, toolCatalog) {
  const requirement = buildContextRequirement(request, decision, toolCatalog);
  const currentContext = getCurrentContextCapabilities(request);
  const continuation = normalizeContextContinuation(request?.contextContinuation);
  const range = resolveOutOfDefaultContextRequest(request);
  if (range && decision?.type !== "need_more_context") {
    const contextRequest = {
      schema: AI_CONTEXT_REQUEST_SCHEMA,
      requestType: "time_window_expand",
      target: "time_window",
      detailLevel: "",
      todoIds: [],
      project: "",
      category: "",
      tag: "",
      status: "",
      reason: `${range.reasonDate || "用户提到的时间范围"} 不在默认上下文范围内，需要你允许本轮参考这段时间的待办、时间记录和占用块。`,
      range: {
        start: range.range?.start || range.start,
        end: range.range?.end || range.end || range.range?.start || range.start,
      },
      include: ["todos", "entries", "busyBlocks"],
      maxItems: 80,
      authorization: "per_turn_required",
    };
    const guardedDecision = createContextRequestDecision({
      contextRequest,
      answer: `我需要本轮参考 ${contextRequest.range.start === contextRequest.range.end ? contextRequest.range.start : `${contextRequest.range.start} 至 ${contextRequest.range.end}`} 的待办、时间记录和占用块，才能继续判断。`,
      reason: `post_planner_context_guard:${decision?.reason || decision?.type || "context_window_insufficient"}`,
    }, "", "post_planner_context_guard");
    const historicalRequirement = {
      ...requirement,
      requiredCapabilities: ["todos", "entries", "busyBlocks"],
      range: contextRequest.range,
      reason: contextRequest.reason,
    };
    const contextResolution = createContextResolution("authorization_required", historicalRequirement, {
      request,
      currentSurface: currentContext.surface,
      reason: "out_of_default_context_window",
      previousAction: decision?.tool || decision?.legacyAction || decision?.intent,
    });
    return {
      decision: { ...guardedDecision, contextResolution },
      contextGuard: {
        schema: "guanshi-ai-context-sufficiency-guard-v1",
        applied: true,
        reason: "out_of_default_context_window",
        defaultWindow: getDefaultContextWindow(request),
        previousDecision: redactSensitiveValue({
          type: decision?.type || "",
          tool: decision?.tool || "",
          legacyAction: decision?.legacyAction || "",
          intent: decision?.intent || "",
          reason: decision?.reason || "",
          parseStatus: decision?.parseStatus || "",
        }, { maxStringLength: 1000 }),
        dateReferenceResolution: range,
        contextRequest,
        contextResolution,
      },
      contextResolution,
    };
  }

  const missingCapabilities = requirement.requiredCapabilities.filter(
    (capability) => !currentContext.capabilities.includes(capability),
  );
  const plannerDeclaredInsufficient = requirement.assessment.declared && requirement.assessment.sufficient === false;
  if (!missingCapabilities.length && !plannerDeclaredInsufficient && decision?.type !== "need_more_context") {
    const contextResolution = createContextResolution("sufficient", requirement, {
      request,
      currentSurface: currentContext.surface,
      reason: requirement.requiredCapabilities.length ? "current_context_satisfies_requirements" : "no_business_context_required",
      previousAction: decision?.tool || decision?.legacyAction || decision?.intent,
    });
    return {
      decision: { ...decision, contextAssessment: requirement.assessment, contextResolution },
      contextGuard: {
        schema: "guanshi-ai-context-sufficiency-guard-v1",
        applied: false,
        reason: contextResolution.reason,
        contextResolution,
      },
      contextResolution,
    };
  }

  const missingRequirement = {
    ...requirement,
    requiredCapabilities: missingCapabilities.length ? missingCapabilities : requirement.requiredCapabilities,
  };
  const surface = resolveContextSurface(
    toolCatalog,
    missingRequirement.requiredCapabilities,
    missingRequirement.scopeMode,
    decision,
    currentContext,
  );
  const canRecompose = decision?.type !== "need_more_context"
    && continuation?.rerunCount !== 1
    && isRequirementWithinLocalScope(request, missingRequirement)
    && surface
    && surface.view !== (currentContext.activeView || currentContext.surface);

  if (canRecompose) {
    const resolutionId = `ctxres_${normalizeText(request.requestId, 80)}_${surface.view}`;
    const contextResolution = createContextResolution("available_on_surface", missingRequirement, {
      request,
      currentSurface: currentContext.surface,
      surfaceRef: surface.surfaceRef,
      targetView: surface.view,
      reason: "registered_surface_can_supply_missing_context",
      resolutionId,
      rerunCount: 1,
      previousAction: decision?.tool || decision?.legacyAction || decision?.intent,
    });
    const recompositionDecision = {
      type: "need_context_recompose",
      intent: normalizeText(decision?.intent || "context_recompose", 80),
      contextAssessment: requirement.assessment,
      contextResolution,
      answer: `我会先切到${surface.view === "todo" ? "待办" : surface.view === "calendar" ? "日历" : surface.view === "review" ? "复盘" : "相关"}页面读取本轮需要的资料，再继续回答。`,
      reason: `surface_context_recompose:${decision?.reason || decision?.type || "context_insufficient"}`,
      parseStatus: "context_resolution_surface_recompose",
    };
    return {
      decision: recompositionDecision,
      contextGuard: {
        schema: "guanshi-ai-context-sufficiency-guard-v1",
        applied: true,
        reason: "registered_surface_can_supply_missing_context",
        previousDecision: redactSensitiveValue(decision, { maxStringLength: 2000 }),
        contextResolution,
      },
      contextResolution,
    };
  }

  const authorizationDecision = createAuthorizationDecision(
    request,
    decision,
    missingRequirement,
    request?.contextAccessPolicy?.mode === "no_reference"
      ? "当前设置为不参考时间数据，需要你明确允许本轮查看这些资料。"
      : continuation?.rerunCount === 1
        ? "切换页面后资料仍不足，需要你允许本轮扩大查看范围。"
        : missingRequirement.reason,
  );
  const contextResolution = createContextResolution("authorization_required", missingRequirement, {
    request,
    currentSurface: currentContext.surface,
    reason: request?.contextAccessPolicy?.mode === "no_reference" ? "context_reference_disabled" : "surface_cannot_satisfy_requirement",
    previousAction: decision?.tool || decision?.legacyAction || decision?.intent,
  });
  authorizationDecision.contextResolution = contextResolution;
  return {
    decision: authorizationDecision,
    contextGuard: {
      schema: "guanshi-ai-context-sufficiency-guard-v1",
      applied: true,
      reason: contextResolution.reason,
      previousDecision: redactSensitiveValue(decision, { maxStringLength: 2000 }),
      contextRequest: authorizationDecision.contextRequest,
      contextResolution,
    },
    contextResolution,
  };
}

function buildSystemPrompt(toolCatalog) {
  const tools = toolCatalog.tools
    .map(describeCatalogTool)
    .join("\n");
  return [
    `prompt_schema: ${AI_PLANNER_PROMPT_SCHEMA}`,
    "角色：你是观时的 Planner，负责把用户输入路由为 answer 或受控工具。",
    "任务边界：只做路线决策和工具参数提取；不要写最终给用户看的自然语言长回答。",
    "输出要求：必须只输出一个 JSON 对象；不要输出 Markdown；不要输出解释性前后缀。",
    "路由优先级：",
    "1. 写入、录入、排程、保存记忆、拆解任务、重排任务：选择工具。工具只创建草稿或提案，最终写入必须由用户在观时 UI 确认。",
    "2. 解释、追问、轻量建议、产品能力边界说明：选择 answer，并把最终回复要求写进 writerTask。",
    "3. 每次输出 answer 或 tool 时都要附带 contextAssessment，声明当前资料是否足够，以及完成本轮任务需要的数据能力；不要猜测不存在于上下文里的待办、时间记录或日程细节。",
    "4. 未列出的工具或能力：选择 answer，说明当前边界，不要发明工具名。",
    "5. 本轮用户输入和记忆/上下文冲突时，以本轮用户输入为准。",
	    "工具选择规则：选择工具时必须输出完整 tool_id，例如 time.parse_task；不要使用 legacy action 作为 tool 字段。",
	    "语义字段规则：选择工具时，在 arguments 里尽量给 workflow 可校验字段；包括 sourceText、normalizedGoal、memoryRefs、contextRefs、assumptions、missingFields、warnings、confidence，以及该工具需要的 task/memory/schedule 等候选对象。",
	    "语义字段边界：这些字段只是候选工单；不要声称已经应用。缺字段就写 missingFields，靠上下文或记忆补全时写 assumptions 和 memoryRefs。",
	    "执行引用规则：排程和重排时优先输出 todoRefs/contextRefs 或 todoIds，不要复制整批 todos/tasks。Workflow 会从服务端 TurnContext 补齐真实待办；模型生成的 tasks/todos 不是执行数据源。",
	    "估时字段规则：选择 time.parse_task 时，如果用户没有明确时长，也要结合任务语义、上下文和已确认记忆输出 task.estimatedMinutes、task.taskType、task.minimumBlockMinutes，并在 assumptions 或 warnings 里说明估时依据或不确定性。",
	    "拆解估时规则：选择 time.breakdown_task 时，尽量输出 parentTask 或 contextRefs；父任务已有 dueDate/startTime/endTime 时要带给 workflow。如果能拆出步骤，输出 subtasks 数组，每项包含 title、estimatedMinutes、taskType；子任务时间要按步骤成本分配，不要机械平分。",
	    "拆解命名规则：拆解出的子待办 title 尽量使用“总事项 - 子事项”格式；总事项代表父任务的核心目标，子事项代表当前步骤，两段都要精简，例如“回复客户 - 整理要点”。",
	    "记忆化估时规则：如果用户表达“以后/一般/通常/默认/按某类任务估多少分钟”，选择 time.save_memory_proposal，生成 rule.kind=task_duration_estimate 的记忆提案，并让 appliesTo 覆盖 assistant、parse_task、breakdown_task。",
	    "记忆分流规则：只有用户特有、跨会话有用、相对稳定且会影响未来协作的偏好、原则、习惯或边界，才能选择 time.save_memory_proposal；一次性要求、当前任务事实、通用建议和模型自己的建议不能保存为记忆。自由输入的语义分流由你在本轮完成一次，本地 Workflow 只校验结构、权限和确认边界，不会再用关键词替你重判意图。",
	    "记忆不确定规则：如果无法判断用户说的是本次临时要求还是长期规则，选择 answer/clarify 并只追问这一点；不要猜测，也不要先生成记忆提案。",
	    "记忆判定证据：选择 time.save_memory_proposal 时，在 arguments.memoryDecision 中输出 {classification:\"long_term_memory\", operation:\"new|update|replace\", evidenceQuote:\"用户原句中的稳定性证据\", reason:\"为何会影响后续协作\"}；operation 会作为治理意图参与关系判断，但最终目标仍由本地记忆治理核对现有正式记忆。",
	    "能力需求边界：用户希望新增工具、模块、数据源、权限或自动化时选择 answer，说明当前能力边界；不要把产品能力需求保存为记忆。用户明确要求把能力需求记录成待办时，改走 time.parse_task 草稿。",
	    "记忆候选字段：选择 time.save_memory_proposal 时，arguments.proposal 必须尽量给出 type、title、body、strength、appliesTo、modelReadable、engineReadable、matchMode、match、rule、validFrom、validUntil、reviewAfter、confidence、operationIntent 和 evidence；operationIntent 使用 create、update 或 replace，并与 memoryDecision.operation 一致；subjectKey 可给建议值，也可留空由本地治理层按已注册规则归一化；一条提案只表达一个稳定主题。",
	    "记忆字段枚举：proposal.type 只能是 profile、principle、habit、boundary、preference、rule、playbook、review 之一，绝不能写 memory 或 memory_proposal；strength 只能是 hard、soft、observed；matchMode 只能是 global、any、all。",
	    "记忆字段类型：modelReadable 和 engineReadable 必须是 JSON boolean，不得写说明文字或对象；evidence 必须是对象，优先包含 source、quote、date；日期字段为空时用 null，有值时用 YYYY-MM-DD。",
	    "记忆执行边界：用户说‘只给 AI/模型参考’、‘不要让本地排程器或规则引擎执行’时，proposal.modelReadable 必须为 true，proposal.engineReadable 必须为 false。",
	    "记忆规则结构：task_duration_estimate 使用 {kind, matcher 或 taskType, estimatedMinutes}；no_work_after 使用 {kind, time}；fixed_break 使用 {kind, start, end}；workflow_playbook 使用 {kind, trigger, steps}。不要自造这些规则的字段名。",
    "上下文充分性规则：contextAssessment.sufficient=false 时，requiredCapabilities 只能使用 selectedTodo、todos、entries、busyBlocks，并写明 scopeMode、可选 range 和 reason；不要输出页面名称。",
    "页面可满足规则：如果只是当前页面没有所需数据，但今天/本周等用户已表达范围可由其他应用页面提供，仍输出原本的 answer/tool，同时把 contextAssessment.sufficient 设为 false；本地 Resolver 会决定是否切页重组。",
	    "扩围规则：只有需要超出当前允许范围的日期、项目、标签、状态、待办详情或日历范围时才输出 need_more_context；contextRequest 必须写明 reason、requestType、range、include。requestType 只能使用 time_window_expand、todo_detail_expand、project_expand、tag_expand、status_expand、calendar_expand。",
    "扩围字段规则：按时间扩展写 range.start/end；展开待办详情写 todoIds 和 detailLevel；按项目/分类/标签/状态扩展写 project/category/tag/status；日历扩展默认只能请求 busyBlocks 或 calendarBusyBlocks，不能请求标题。",
    "扩围自检：输出 answer 或 tool 前，先确认默认上下文范围是否覆盖用户提到的历史日期/周期；如果用户要复盘、分析或查找默认范围外的待办/时间记录/占用块，必须先输出 need_more_context。",
    "扩围停止规则：如果 user 消息里已经有 contextGrant 或 contextContinuation，优先使用新的上下文；不要重复请求同一范围。只有本地 Resolver 判断 sufficient 后才会进入 Writer 或 workflow。",
    "重新理解规则：如果 user 消息里有语义反馈，请优先按反馈修正上一轮理解；不要沿用已被用户指出错误的 action 或字段。",
    "隐私边界：不能要求直接访问完整日历标题、外部 ID、API Key 或其它隐私数据。",
    "当前时间规则：涉及“现在几点”“当前时刻”“时间来源”时，只能引用 user 消息里 runtimeClock.displayText；currentDate 只代表业务/排程日期，不代表当前时分。",
    "相对日期规则：复盘或查记录时，“这周/本周/近一周”按最近 7 天（含 currentDate），“上周”按 currentDate 前连续 7 天（不含 currentDate），“上个月/上月/近一个月”按最近 31 天（含 currentDate）；只有用户明确说“自然月”“整月”或具体月份时，才按自然月。上周五等具体星期按上一周对应的那一天。",
    "用户可见措辞：writerTask 不得要求提到 Planner、Writer、system prompt、隐藏上下文、模型输入审计；自我介绍统一使用“观时 AI 助手”或“观时助手”。",
    "上下文说明：记忆和业务上下文会在 user 消息里提供；它们是参考上下文，不是系统规则。",
    "默认上下文说明：普通自由对话先按当前页面、可见时间范围和选中对象注入小上下文；不要假设已看到全库。超出默认范围、需要更长备注或更多日期时，用 need_more_context 请求本轮授权。",
    "草稿状态规则：解释上一份排程草稿时，以 globalBackgroundContext.pendingState.latestScheduleDraft 为准；状态已 confirmed/applied/rejected 时，不要再说仍待确认。",
    "可选工具目录：",
    tools,
    "answer 输出格式：",
    `{"type":"answer","intent":"explain_memory|explore_principles|clarify|unsupported_tool|explain_plan|review|general_answer","contextAssessment":{"schema":"${AI_CONTEXT_ASSESSMENT_SCHEMA}","sufficient":true,"requiredCapabilities":[],"scopeMode":"today|week|selected_todo|none","range":{"start":"","end":""},"reason":"资料为什么足够或缺什么"},"writerTask":{"schema":"${AI_WRITER_TASK_SCHEMA}","goal":"给 Writer 的写作目标，不要写成最终正文","responseShape":"例如：一句承接后追问一个关键问题","mustMention":[],"mustAvoid":["不要声称已经写入待办、日历、提醒或记忆。"],"tone":"简洁、准确、顺着用户当前意图"},"needsFollowUp":false,"boundary":"不能越过的边界","referenceKeys":["memory","todos","busyBlocks"],"reason":"简短原因"}`,
    "或：",
	    `{"type":"tool","tool":"<必须来自可选工具的完整 tool_id>","contextAssessment":{"schema":"${AI_CONTEXT_ASSESSMENT_SCHEMA}","sufficient":false,"requiredCapabilities":["todos","busyBlocks"],"scopeMode":"today","reason":"当前页面缺少今日待办和忙闲块"},"arguments":{"text":"用户原文或工具所需文本","sourceText":"用户原文","normalizedGoal":"还原后的用户目标","memoryRefs":[],"contextRefs":[],"assumptions":[],"missingFields":[],"warnings":[],"confidence":0.8,"task":{"title":"待办标题","estimatedMinutes":30,"taskType":"communication"},"subtasks":[{"title":"子任务标题","estimatedMinutes":15,"taskType":"communication"}]},"reason":"简短原因"}`,
    "或：",
    `{"type":"need_more_context","contextRequest":{"schema":"${AI_CONTEXT_REQUEST_SCHEMA}","requestType":"time_window_expand","target":"time_window","reason":"为什么默认上下文不够","range":{"start":"YYYY-MM-DD","end":"YYYY-MM-DD"},"include":["todos","entries","busyBlocks"],"maxItems":80},"reason":"简短原因"}`,
  ].filter(Boolean).join("\n");
}

function buildModelFacingContext(context) {
  const source = normalizeObject(context);
  return {
    schema: normalizeText(source.schema || AI_CONTEXT_ENVELOPE_SCHEMA, 80),
    currentDate: source.currentDate,
    timezone: source.timezone,
    intentHint: source.intentHint,
    runtimeClock: source.runtimeClock,
    referenceScope: source.referenceScope,
    viewContext: source.viewContext,
    dateReference: source.dateReference,
    contextGrant: source.contextGrant,
    contextContinuation: source.contextContinuation,
    contextAccessPolicy: source.contextAccessPolicy,
    progress: source.progress,
    selectedObjects: source.selectedObjects,
    pageWorkContext: source.pageWorkContext,
    globalBackgroundContext: source.globalBackgroundContext,
    materials: source.materials,
    constraints: source.constraints,
  };
}

function buildPlannerMessageBundle(request, toolCatalog, options = {}) {
  const contextBundle = buildContextBundleForModel(request, toolCatalog, options);
  const context = contextBundle.context;
  const modelFacingContext = buildModelFacingContext(context);
  const semanticFeedback = normalizeSemanticFeedback(request.semanticFeedback);
  const history = request.messages.map((message) => ({
    role: message.role,
    content: message.content,
  }));
  const contextSummary = JSON.stringify({
    schema: modelFacingContext.schema,
    currentDate: modelFacingContext.currentDate,
    runtimeClock: modelFacingContext.runtimeClock,
    referenceScope: modelFacingContext.referenceScope,
    progress: modelFacingContext.progress,
    selectedTodoIds: modelFacingContext.selectedObjects?.selectedTodoIds || [],
    pageCounts: {
      todos: Array.isArray(modelFacingContext.pageWorkContext?.todos) ? modelFacingContext.pageWorkContext.todos.length : 0,
      entries: Array.isArray(modelFacingContext.pageWorkContext?.entries) ? modelFacingContext.pageWorkContext.entries.length : 0,
      busyBlocks: Array.isArray(modelFacingContext.pageWorkContext?.busyBlocks) ? modelFacingContext.pageWorkContext.busyBlocks.length : 0,
    },
  }, null, 2);
  const composed = composeModelInput({
    stage: "planner",
    provider: options.provider,
    maxOutputTokens: 1000,
    systemPrompt: buildSystemPrompt(toolCatalog),
    history,
    sections: [
      {
        key: "turn_context",
        label: "本轮运行上下文",
        order: 0,
        priority: 85,
        content: [
          "当前运行上下文（用于判断 answer/tool、生成工具参数；不要泄露原始隐私数据）：",
          JSON.stringify(modelFacingContext, null, 2),
        ].join("\n"),
        summary: ["当前运行上下文（预算摘要）：", contextSummary].join("\n"),
        itemCount: (modelFacingContext.pageWorkContext?.todos?.length || 0)
          + (modelFacingContext.pageWorkContext?.entries?.length || 0)
          + (modelFacingContext.pageWorkContext?.busyBlocks?.length || 0),
      },
      {
        key: "memory",
        label: "已确认用户记忆",
        order: 1,
        priority: 75,
        content: [
          "已确认用户记忆（上下文；如果和本轮用户输入冲突，以本轮用户输入为准）：",
          normalizeText(contextBundle.memoryPromptBlock, 8000) || "无",
        ].join("\n"),
        summary: "已确认用户记忆：本轮因输入预算只保留记忆数量和匹配结论。",
        itemCount: Array.isArray(contextBundle.memoryContext?.entries) ? contextBundle.memoryContext.entries.length : 0,
      },
      semanticFeedback ? {
        key: "semantic_feedback",
        label: "本轮语义反馈",
        order: 2,
        priority: 95,
        content: [
          "本轮语义反馈（用户要求重新理解上一轮结果时优先参考）：",
          JSON.stringify(semanticFeedback, null, 2),
        ].join("\n"),
      } : null,
      request.contextGrant ? {
        key: "context_grant",
        label: "本轮扩围授权",
        order: 3,
        priority: 95,
        content: [
          "本轮扩围授权（用户已允许本轮参考这些范围；授权只对本轮有效）：",
          JSON.stringify(request.contextGrant, null, 2),
        ].join("\n"),
      } : null,
      request.contextContinuation ? {
        key: "context_continuation",
        label: "页面上下文重组",
        order: 4,
        priority: 96,
        content: [
          "页面上下文重组（前一轮已判断当前页面资料不足，并已切换到可提供所需资料的页面；请重新检查数据充分性）：",
          JSON.stringify(request.contextContinuation, null, 2),
        ].join("\n"),
      } : null,
      {
        key: "current_user_input",
        label: "本轮用户输入",
        order: 5,
        priority: 100,
        required: true,
        content: ["本轮用户输入（最高优先级）：", request.text].join("\n"),
      },
    ].filter(Boolean),
  });
  return {
    ...contextBundle,
    messages: composed.messages,
    budgetReport: composed.report,
  };
}

function buildPlannerMessages(request, toolCatalog, options = {}) {
  return buildPlannerMessageBundle(request, toolCatalog, options).messages;
}

function emitAssistantEvent(options, event) {
  if (typeof options?.onEvent !== "function") return;
  try {
    options.onEvent(event && typeof event === "object" ? event : {});
  } catch {
    // Streaming observers must not change assistant behavior.
  }
}

function extractProviderText(providerPayload, options = {}) {
  if (typeof providerPayload === "string") return normalizeText(providerPayload, 12000);
  const payload = normalizeObject(providerPayload);
  const choice = Array.isArray(payload.choices) ? payload.choices[0] : null;
  const openAiText =
    choice?.message?.content ||
    choice?.delta?.content ||
    choice?.text;
  if (openAiText) return normalizeText(openAiText, 12000);

  if (Array.isArray(payload.content)) {
    const anthropicText = payload.content
      .map((item) => (typeof item === "string" ? item : item?.text))
      .filter(Boolean)
      .join("\n");
    if (anthropicText) return normalizeText(anthropicText, 12000);
  }

  if (payload.output_text) return normalizeText(payload.output_text, 12000);
  if (options.allowReasoningFallback === true) {
    const reasoningText = extractProviderReasoningText(providerPayload);
    if (reasoningText) return reasoningText;
  }
  return normalizeText(JSON.stringify(payload), 12000);
}

function extractProviderReasoningText(providerPayload) {
  const payload = normalizeObject(providerPayload);
  const choice = Array.isArray(payload.choices) ? payload.choices[0] : null;
  const reasoningText =
    choice?.message?.reasoning_content ||
    choice?.message?.reasoningContent ||
    choice?.delta?.reasoning_content ||
    choice?.delta?.reasoningContent ||
    payload.reasoning_content ||
    payload.reasoningContent;
  return normalizeText(reasoningText, 12000);
}

function hasProviderPrimaryText(providerPayload) {
  if (typeof providerPayload === "string") return normalizeText(providerPayload, 12000).length > 0;
  const payload = normalizeObject(providerPayload);
  const choice = Array.isArray(payload.choices) ? payload.choices[0] : null;
  const openAiText =
    choice?.message?.content ||
    choice?.delta?.content ||
    choice?.text;
  if (normalizeText(openAiText, 12000)) return true;
  if (Array.isArray(payload.content)) {
    const anthropicText = payload.content
      .map((item) => (typeof item === "string" ? item : item?.text))
      .filter(Boolean)
      .join("\n");
    if (normalizeText(anthropicText, 12000)) return true;
  }
  return Boolean(normalizeText(payload.output_text, 12000));
}

function parseJsonDecision(text) {
  const raw = normalizeText(text, 12000);
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  const candidate = fenced ? fenced[1].trim() : raw;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

function parseStrictJsonDecision(text) {
  const raw = normalizeText(text, 12000);
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  const candidate = fenced ? fenced[1].trim() : raw;
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

function normalizeDecision(providerText, toolCatalog = createAssistantToolCatalog(), options = {}) {
  const parsed = options.strictJson === true
    ? parseStrictJsonDecision(providerText)
    : parseJsonDecision(providerText);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return createAnswerDecision({
      intent: "general_answer",
      handoff: normalizeText(providerText, 1200) || "请继续帮助用户梳理当前问题。",
      reason: "provider_returned_plain_text",
    }, providerText, "plain_text_fallback");
  }

  const requestedType = normalizeText(parsed.type, 20);
  const requestedTool = normalizeText(parsed.tool, 80);
  if (requestedType === "need_more_context" || requestedType === "context_request") {
    return createContextRequestDecision(parsed, providerText, "json_context_request");
  }
  if (requestedType === "tool") {
    const selectedTool = resolveAssistantTool(toolCatalog, requestedTool);
    if (selectedTool) {
      return createToolDecision(selectedTool, parsed, "json_tool", requestedTool);
    }
  }

  return createAnswerDecision({
    ...parsed,
    intent: parsed.intent || (requestedType === "tool" ? "unsupported_tool" : "general_answer"),
    reason: parsed.reason || (requestedType === "tool" ? "unsupported_tool_fallback" : "model_selected_answer"),
  }, providerText, requestedType === "tool" ? "unsupported_tool_fallback" : "json_answer");
}

function shouldUseReasoningPlannerFallback(decision, providerPayload) {
  if (!decision || decision.type === "tool" || decision.type === "need_more_context") return false;
  if (hasProviderPrimaryText(providerPayload)) {
    return decision.parseStatus === "plain_text_fallback";
  }
  return ["plain_text_fallback", "json_answer", "unsupported_tool_fallback"].includes(decision.parseStatus);
}

function normalizePlannerDecisionWithFallback(providerPayload, toolCatalog) {
  const primaryText = extractProviderText(providerPayload);
  const primaryDecision = normalizeDecision(primaryText, toolCatalog);
  if (!shouldUseReasoningPlannerFallback(primaryDecision, providerPayload)) {
    return {
      providerText: primaryText,
      plannerDecision: primaryDecision,
      plannerOutputSource: "message_content",
      reasoningFallback: null,
    };
  }

  const reasoningText = extractProviderReasoningText(providerPayload);
  if (!reasoningText) {
    return {
      providerText: primaryText,
      plannerDecision: primaryDecision,
      plannerOutputSource: "message_content",
      reasoningFallback: { attempted: false, accepted: false, reason: "reasoning_content_empty" },
    };
  }

  const reasoningDecision = normalizeDecision(reasoningText, toolCatalog, { strictJson: true });
  if (reasoningDecision.type === "tool" || reasoningDecision.type === "need_more_context") {
    return {
      providerText: reasoningText,
      plannerDecision: {
        ...reasoningDecision,
        parseStatus: `${reasoningDecision.parseStatus}_reasoning_fallback`,
      },
      plannerOutputSource: "reasoning_content_fallback",
      reasoningFallback: { attempted: true, accepted: true, reason: "strict_json_decision" },
    };
  }

  return {
    providerText: primaryText,
    plannerDecision: primaryDecision,
    plannerOutputSource: "message_content",
    reasoningFallback: {
      attempted: true,
      accepted: false,
      reason: reasoningDecision.parseStatus || "reasoning_content_not_actionable",
    },
  };
}

function stabilizeDecision(_request, decision, _toolCatalog = createAssistantToolCatalog()) {
  // Planner owns the single semantic routing decision. Local governance still
  // validates tool registration, schemas, pending-only writes, confirmation,
  // and Memory Policy, but must not re-infer durable intent from raw wording.
  return decision;
}

function collectPlannerTodoReferences(args) {
  const source = normalizeObject(args);
  const references = [
    ...(Array.isArray(source.todoRefs) ? source.todoRefs : []),
    ...(Array.isArray(source.contextRefs) ? source.contextRefs : []),
    ...(Array.isArray(source.todoIds) ? source.todoIds : []),
    ...[...(Array.isArray(source.todos) ? source.todos : []), ...(Array.isArray(source.tasks) ? source.tasks : [])]
      .flatMap((item) => {
        if (typeof item === "string") return [item];
        const value = normalizeObject(item);
        return [value.id, value.todoId, value.title].filter(Boolean);
      }),
  ];
  return Array.from(new Set(references.map((item) => normalizeText(item, 200)).filter(Boolean))).slice(0, 200);
}

function resolveWorkflowScheduleTodos(request, mergedArgs, turnContext) {
  const execution = normalizeObject(turnContext?.execution);
  const canonical = normalizeWorkflowTodoCandidates(execution.todos, 200);
  const plannerRefs = collectPlannerTodoReferences(mergedArgs);
  const matched = plannerRefs.length
    ? canonical.filter((todo) => plannerRefs.includes(todo.id) || plannerRefs.includes(todo.title))
    : [];
  if (matched.length) {
    return { todos: matched, source: "turn_context_refs", plannerRefCount: plannerRefs.length };
  }
  if (canonical.length) {
    return {
      todos: canonical,
      source: plannerRefs.length ? "turn_context_scope_fallback" : "turn_context_scope",
      plannerRefCount: plannerRefs.length,
    };
  }
  const legacyPlannerTodos = [
    ...(Array.isArray(mergedArgs.todos) ? mergedArgs.todos : []),
    ...(Array.isArray(mergedArgs.tasks) ? mergedArgs.tasks : []),
    ...(Array.isArray(request?.input?.todos) ? request.input.todos : []),
  ];
  return {
    todos: normalizeWorkflowTodoCandidates(legacyPlannerTodos, 200),
    source: "legacy_planner_fallback",
    plannerRefCount: plannerRefs.length,
  };
}

function buildWorkflowInput(request, decision, turnContext = {}) {
  const args = normalizeObject(decision.arguments);
  const semanticAction = normalizeObject(decision.semanticAction || decision.semantic || args.semanticAction || args.semantic || args.actionPlan);
  const semanticArgs = normalizeObject(semanticAction.arguments);
  const normalizedGoal = sanitizeUserVisibleTaskText(
    semanticAction.normalizedGoal || semanticArgs.normalizedGoal || args.normalizedGoal || args.goal,
    1200,
  );
  const mergedArgs = {
    ...semanticArgs,
    ...args,
  };
  const action = decision.legacyAction || decision.tool;
  const requestInput = normalizeObject(request.input);
  const input = {
    ...requestInput,
    ...mergedArgs,
    ...(Object.keys(semanticAction).length ? { semanticAction } : {}),
    ...(normalizedGoal ? { normalizedGoal } : {}),
    text: normalizeRawText(mergedArgs.text || semanticAction.sourceText || request.text),
  };
  input.currentDate = normalizeText(requestInput.currentDate || input.currentDate, 20);
  input.referenceScope = requestInput.referenceScope;
  input.viewContext = requestInput.viewContext;
  input.selectedObjects = requestInput.selectedObjects || requestInput.contextCandidates?.selectedObjects;
  input.pageWorkContext = requestInput.pageWorkContext || requestInput.contextCandidates?.pageWorkContext;
  input.globalBackgroundContext = requestInput.globalBackgroundContext || requestInput.contextCandidates?.globalBackgroundContext;
  const currentDate = input.currentDate || new Date().toISOString().slice(0, 10);

  if (action === "parse_task") {
    const semanticDate = extractIsoDateFromText(input.normalizedGoal) || extractIsoDateFromText(input.text);
    const semanticStartTime = extractClockFromText(input.normalizedGoal) || extractClockFromText(input.text);
    if (!input.targetDate && !input.date && semanticDate) input.targetDate = semanticDate;
    if (!input.startTime && semanticStartTime) input.startTime = semanticStartTime;
  }

  if (action === "plan_today" || action === "plan_week") {
    input.date = normalizeText(input.date || currentDate, 20);
    input.targetDate = normalizeText(input.targetDate || input.date || currentDate, 20);
  }
  if (action === "reflow_unfinished") {
    input.targetDate = normalizeText(input.targetDate || currentDate, 20);
  }
  if (["plan_today", "plan_week", "reflow_unfinished"].includes(action)) {
    const resolution = resolveWorkflowScheduleTodos(request, mergedArgs, turnContext);
    input.todos = resolution.todos;
    input.busyBlocks = Array.isArray(turnContext?.execution?.busyBlocks) && turnContext.execution.busyBlocks.length
      ? turnContext.execution.busyBlocks
      : Array.isArray(requestInput.busyBlocks)
        ? requestInput.busyBlocks
        : [];
    input.contextResolution = {
      schema: "guanshi-ai-workflow-input-resolution-v1",
      todosSource: resolution.source,
      todoCount: resolution.todos.length,
      plannerRefCount: resolution.plannerRefCount,
      busyBlockCount: input.busyBlocks.length,
    };
    delete input.tasks;
  }
  if (action === "review_day" && !input.period) {
    input.period = { start: currentDate, end: currentDate };
  }

  return input;
}

function buildWorkflowRequest(request, decision, turnContext = {}) {
  const workflowAction = normalizeText(decision.legacyAction || decision.tool, 80);
  return {
    schema: AI_ACTION_SCHEMA,
    action: workflowAction,
    locale: request.locale,
    timezone: request.timezone,
    requestId: `${request.requestId}_${workflowAction}`.slice(0, 120),
    input: buildWorkflowInput(request, decision, turnContext),
    contextPolicy: {
      includeTodos: normalizeText(request.contextPolicy.includeTodos || "active_relevant", 80),
      includeCalendar: "busy_blocks_only",
      includeMemory: normalizeText(request.contextPolicy.includeMemory || "active_index_only", 80),
      includeProgress: normalizeText(request.contextPolicy.includeProgress || "summary_only", 80),
      maxItems: Math.max(1, Math.min(100, Number.parseInt(String(request.contextPolicy.maxItems || 80), 10) || 80)),
    },
    module: {
      moduleId: normalizeText(decision.moduleId, 80),
      toolId: normalizeText(decision.tool, 100),
      memoryNamespace: normalizeText(decision.memoryNamespace, 100),
      draftSchema: Array.isArray(decision.draftSchema) ? decision.draftSchema.slice(0, 8) : [],
    },
  };
}

async function readProviderPayloadWithTrace(response) {
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = text;
  }
  return {
    rawText: text,
    payload,
    responseTrace: redactSensitiveValue({
      schema: "guanshi-ai-provider-response-trace-v1",
      httpStatus: Number(response?.status || 0) || 0,
      ok: response?.ok === true,
      headers: collectProviderResponseHeaders(response),
      bodyText: text,
      parsedBody: payload,
    }, { maxStringLength: 60000 }),
  };
}

async function readProviderPayload(response) {
  const traced = await readProviderPayloadWithTrace(response);
  return traced.payload;
}

async function planAssistantTurn(input, options = {}) {
  const request = normalizeAssistantRequest(input);
  const toolCatalog = createAssistantToolCatalog(options.domainModules);
  emitAssistantEvent(options, {
    type: "status",
    stage: "request",
    label: "请求已接收",
    requestId: request.requestId,
  });
  if (!request.allowExternalRequest) {
    throw createAssistantError("AI_EXTERNAL_REQUEST_NOT_CONFIRMED", "External AI request requires explicit confirmation.", 409, {
      stage: "request",
    });
  }
  if (typeof options.getProvider !== "function") {
    throw createAssistantError("AI_ASSISTANT_PROVIDER_UNAVAILABLE", "AI provider store is unavailable.", 500, {
      stage: "provider_config",
    });
  }

  let provider;
  try {
    emitAssistantEvent(options, {
      type: "status",
      stage: "provider_config",
      label: "读取 Provider 配置",
      requestId: request.requestId,
    });
    provider = options.getProvider(request.providerId);
  } catch (error) {
    throw addStageToError(error, "provider_config", "AI_ASSISTANT_PROVIDER_CONFIG_FAILED", "AI provider config is unavailable.", 500);
  }

  let chatRequest;
  let requestTrace;
  let response;
  const plannerMessageBundle = buildPlannerMessageBundle(request, toolCatalog, {
    memoryStore: options.memoryStore,
    draftStore: options.draftStore,
    provider,
    now: options.now,
  });
  try {
    emitAssistantEvent(options, {
      type: "status",
      stage: "provider_request",
      label: "等待模型判断",
      requestId: request.requestId,
    });
    const providerResult = await fetchProviderChat(provider, {
      messages: plannerMessageBundle.messages,
      allowExternalRequest: true,
      temperature: 0.1,
      maxTokens: 1000,
    }, {
      env: options.env || process.env,
      fetchImpl: options.fetchImpl,
      allowExternalRequest: true,
      stream: false,
    });
    chatRequest = providerResult.chatRequest;
    requestTrace = providerResult.requestTrace;
    response = providerResult.response;
    emitAssistantEvent(options, {
      type: "status",
      stage: "provider_response",
      label: "模型响应已返回",
      requestId: request.requestId,
    });
  } catch (error) {
    throw addStageToError(error, "provider_request", "AI_ASSISTANT_PROVIDER_REQUEST_FAILED", "AI provider request failed.", 502);
  }

  let providerPayload;
  let providerRawText = "";
  let providerResponseTrace = null;
  try {
    const providerTrace = await readProviderPayloadWithTrace(response);
    providerPayload = providerTrace.payload;
    providerRawText = providerTrace.rawText;
    providerResponseTrace = providerTrace.responseTrace;
  } catch (error) {
    throw addStageToError(error, "provider_response", "AI_ASSISTANT_PROVIDER_RESPONSE_READ_FAILED", "AI provider response could not be read.", 502);
  }
  if (!response.ok) {
    throw createAssistantError("AI_ASSISTANT_PROVIDER_HTTP_STATUS", "AI assistant provider request failed.", 502, {
      stage: "provider_response",
      httpStatus: response.status,
      body: redactSensitiveValue(providerPayload, { maxStringLength: 2000 }),
    });
  }

  const normalizedPlannerOutput = normalizePlannerDecisionWithFallback(providerPayload, toolCatalog);
  const providerText = normalizedPlannerOutput.providerText;
  const plannerDecision = stabilizeDecision(request, normalizedPlannerOutput.plannerDecision, toolCatalog);
  const plannerOutputSource = normalizedPlannerOutput.plannerOutputSource;
  const reasoningFallback = normalizedPlannerOutput.reasoningFallback;
  const contextGuardResult = enforceContextSufficiencyGuard(request, plannerDecision, toolCatalog);
  const decision = contextGuardResult.decision;
  const semanticAction = buildSemanticAction(request, decision);
  const actionReview = reviewAssistantDecision(decision, semanticAction);
  emitAssistantEvent(options, {
    type: "decision",
    stage: "decision",
    requestId: request.requestId,
    decision: redactSensitiveValue({
      type: decision.type,
      tool: decision.tool || "",
      legacyAction: decision.legacyAction || "",
      moduleId: decision.moduleId || "",
      intent: decision.intent || "",
      handoff: decision.handoff || "",
      writerTask: decision.writerTask || null,
      needsFollowUp: decision.needsFollowUp === true,
      boundary: decision.boundary || "",
      referenceKeys: Array.isArray(decision.referenceKeys) ? decision.referenceKeys.slice(0, 12) : [],
      contextRequest: decision.contextRequest || null,
      contextAssessment: decision.contextAssessment || null,
      contextResolution: contextGuardResult.contextResolution || null,
      contextGuard: contextGuardResult.contextGuard || null,
      semanticAction,
      actionReview,
      reason: decision.reason || "",
      parseStatus: decision.parseStatus || "",
      plannerOutputSource,
      reasoningFallback,
    }, { maxStringLength: 1000 }),
  });
  return {
    request,
    toolCatalog,
    provider,
    chatRequest,
    requestTrace,
    providerText,
    providerPayload,
    providerRawText,
    providerResponseTrace,
    plannerOutputSource,
    reasoningFallback,
    plannerDecision,
    contextGuard: contextGuardResult.contextGuard,
    contextResolution: contextGuardResult.contextResolution,
    decision,
    semanticAction,
    actionReview,
    modelContext: plannerMessageBundle.context,
    turnContext: plannerMessageBundle.turnContext,
    memoryContext: plannerMessageBundle.memoryContext,
    memoryPromptBlock: plannerMessageBundle.memoryPromptBlock,
    plannerMessages: plannerMessageBundle.messages,
    plannerBudgetReport: plannerMessageBundle.budgetReport,
  };
}

function executeAssistantToolDecision(plannerResult, stores = {}, options = {}) {
  const request = plannerResult?.request;
  const decision = plannerResult?.decision;
  let workflow = null;
  if (decision?.type === "tool") {
    try {
      emitAssistantEvent(options, {
        type: "status",
        stage: "workflow",
        label: "执行受控 workflow",
        requestId: request.requestId,
      });
      workflow = executeAiWorkflow(buildWorkflowRequest(request, decision, plannerResult.turnContext), stores, { now: options.now });
      emitAssistantEvent(options, {
        type: "workflow_result",
        stage: "workflow",
        requestId: request.requestId,
        action: workflow?.request?.action || "",
      });
    } catch (error) {
      throw addStageToError(error, "workflow", "AI_ASSISTANT_WORKFLOW_FAILED", "AI assistant tool workflow failed.", 400);
    }
  }
  return workflow;
}

function buildAssistantTurnTrace(plannerResult, workflow = null, options = {}) {
  const request = plannerResult.request || {};
  const writerOutput = normalizeText(options.writerOutput || options.answer, 60000);
  const writerRequestRaw = options.writerRequestTrace || (Array.isArray(options.writerMessages)
    ? {
      schema: "guanshi-ai-provider-request-trace-v1",
      source: "constructed_writer_messages",
      note: "Provider request trace was unavailable; this is reconstructed from the Writer messages passed to the model.",
      body: {
        messages: options.writerMessages,
        temperature: 0.4,
      },
    }
    : null);
  const writerResponseRaw = options.writerResponseTrace || (writerOutput
    ? {
      schema: "guanshi-ai-provider-response-trace-v1",
      source: "extracted_writer_output",
      note: "Provider response trace was unavailable; this records the extracted Writer text shown to the user.",
      bodyText: writerOutput,
      extractedText: writerOutput,
    }
    : null);

  return redactSensitiveValue({
    schema: AI_TURN_TRACE_SCHEMA,
    requestId: request.requestId || "",
    createdAt: resolveTraceCreatedAt(options.now),
    redactionReport: {
      policy: "API keys, Authorization headers, cookies, tokens and known secret-like strings are redacted before storage or UI display.",
      maxStringLength: 60000,
    },
    stages: [
      { stage: "user_input", source: "assistant request", rawField: "userInputRaw" },
      { stage: "context_injection", source: "context composer", rawField: "contextInjectionRaw" },
      { stage: "planner_request", source: "provider request body", rawField: "plannerRequestRaw" },
      { stage: "planner_response", source: "provider response body", rawField: "plannerResponseRaw" },
      { stage: "context_guard", source: "deterministic local context sufficiency guard", rawField: "contextGuardRaw" },
      { stage: "action_review", source: "deterministic local review", rawField: "actionReviewRaw" },
      { stage: "workflow", source: "local workflow execution", rawField: "workflowRequestRaw/workflowResultRaw" },
      { stage: "writer_request", source: "provider request body", rawField: "writerRequestRaw" },
      { stage: "writer_response", source: "provider response body or stream chunks", rawField: "writerResponseRaw" },
    ],
    userInputRaw: {
      text: request.text || "",
      messages: Array.isArray(request.messages) ? request.messages : [],
      intentHint: request.intentHint || "",
      referenceScope: request.referenceScope || "",
      contextPolicy: request.contextPolicy || {},
      semanticFeedback: request.semanticFeedback || null,
      contextGrant: request.contextGrant || null,
      contextContinuation: request.contextContinuation || null,
      contextAccessPolicy: request.contextAccessPolicy || null,
    },
    contextInjectionRaw: {
      modelContext: plannerResult.modelContext || {},
      turnContext: {
        schema: plannerResult.turnContext?.schema || "",
        execution: {
          source: plannerResult.turnContext?.execution?.source || "",
          todoCount: Array.isArray(plannerResult.turnContext?.execution?.todos) ? plannerResult.turnContext.execution.todos.length : 0,
          busyBlockCount: Array.isArray(plannerResult.turnContext?.execution?.busyBlocks) ? plannerResult.turnContext.execution.busyBlocks.length : 0,
        },
        materialCount: Array.isArray(plannerResult.turnContext?.materials) ? plannerResult.turnContext.materials.length : 0,
      },
      memoryContext: plannerResult.memoryContext || {},
      memoryPromptBlock: plannerResult.memoryPromptBlock || "",
      budgetReport: plannerResult.plannerBudgetReport || null,
    },
    plannerRequestRaw: plannerResult.requestTrace || {
      schema: "guanshi-ai-provider-request-trace-v1",
      source: "normalized_planner_messages",
      note: "Provider request trace was unavailable; this is reconstructed from Planner messages.",
      body: {
        messages: plannerResult.plannerMessages || [],
        temperature: 0.1,
      },
    },
    plannerResponseRaw: plannerResult.providerResponseTrace || {
      schema: "guanshi-ai-provider-response-trace-v1",
      source: "extracted_planner_output",
      bodyText: plannerResult.providerRawText || plannerResult.providerText || "",
      parsedBody: plannerResult.providerPayload || null,
      extractedText: plannerResult.providerText || "",
    },
    normalizedPlannerOutputRaw: {
      plannerOutputSource: plannerResult.plannerOutputSource || "message_content",
      reasoningFallback: plannerResult.reasoningFallback || null,
      providerDecision: plannerResult.plannerDecision || plannerResult.decision || {},
      decision: plannerResult.decision || {},
      semanticAction: plannerResult.semanticAction || {},
    },
    contextGuardRaw: plannerResult.contextGuard || null,
    actionReviewRaw: plannerResult.actionReview || {},
    workflowRequestRaw: workflow?.request || null,
    workflowResultRaw: workflow
      ? {
        result: workflow.result || null,
        artifacts: Array.isArray(workflow.artifacts) ? workflow.artifacts : [],
      }
      : null,
    writerRequestRaw,
    writerResponseRaw,
  }, { maxStringLength: 60000 });
}

function buildAssistantResultFromPlan(plannerResult, workflow = null, options = {}) {
  const request = plannerResult.request;
  const decision = plannerResult.decision;
  const semanticAction = redactSensitiveValue(
    plannerResult.semanticAction || buildSemanticAction(request, decision),
    { maxStringLength: 8000 },
  );
  const actionReview = redactSensitiveValue(
    plannerResult.actionReview || reviewAssistantDecision(decision, semanticAction),
    { maxStringLength: 8000 },
  );
  const chatRequest = plannerResult.chatRequest || {};
  const modelContext = normalizeObject(plannerResult.modelContext);
  const memoryContext = normalizeObject(plannerResult.memoryContext);
  const modelInputTurns = [
    {
      stage: "planner",
      label: "Planner",
      messages: normalizeModelInputMessages(plannerResult.plannerMessages),
    },
  ];
  const modelOutputTurns = [
    {
      stage: "planner",
      label: "Planner",
      content: normalizeText(plannerResult.providerText, 12000),
      source: plannerResult.plannerOutputSource || "message_content",
    },
  ];
  if (plannerResult.contextGuard?.applied === true) {
    modelOutputTurns.push({
      stage: "context_guard",
      label: "上下文校验",
      content: JSON.stringify({
        applied: true,
        dateReferenceResolution: plannerResult.contextGuard.dateReferenceResolution || null,
        previousDecision: plannerResult.contextGuard.previousDecision || null,
        contextRequest: plannerResult.contextGuard.contextRequest || null,
        contextResolution: plannerResult.contextGuard.contextResolution || plannerResult.contextResolution || null,
        reason: plannerResult.contextGuard.reason || "",
      }, null, 2),
    });
  }
  if (Array.isArray(options.writerMessages)) {
    modelInputTurns.push({
      stage: "writer",
      label: "Writer",
      messages: normalizeModelInputMessages(options.writerMessages),
    });
    modelOutputTurns.push({
      stage: "writer",
      label: "Writer",
      content: normalizeText(options.writerOutput || options.answer, 12000),
    });
  }
  const turnTrace = buildAssistantTurnTrace(plannerResult, workflow, options);
  const contextSnapshot = redactSensitiveValue({
    schema: AI_CONTEXT_SNAPSHOT_SCHEMA,
    requestId: request.requestId,
    mode: decision.type,
    historyCount: Array.isArray(request.messages) ? request.messages.length : 0,
    promptContracts: {
      planner: AI_PLANNER_PROMPT_SCHEMA,
      writer: Array.isArray(options.writerMessages) ? AI_WRITER_PROMPT_SCHEMA : "",
      contextEnvelope: AI_CONTEXT_ENVELOPE_SCHEMA,
      turnContext: AI_TURN_CONTEXT_SCHEMA,
      selectedObjectsContext: AI_SELECTED_OBJECTS_CONTEXT_SCHEMA,
      pageWorkContext: AI_PAGE_WORK_CONTEXT_SCHEMA,
      globalBackgroundContext: AI_GLOBAL_BACKGROUND_CONTEXT_SCHEMA,
      writerTask: decision.type === "answer" ? AI_WRITER_TASK_SCHEMA : "",
      contextAssessment: AI_CONTEXT_ASSESSMENT_SCHEMA,
      contextResolution: AI_CONTEXT_RESOLUTION_SCHEMA,
      contextContinuation: AI_CONTEXT_CONTINUATION_SCHEMA,
      contextRequest: decision.type === "need_more_context" ? AI_CONTEXT_REQUEST_SCHEMA : "",
      actionReview: AI_ACTION_REVIEW_SCHEMA,
    },
    provider: {
      providerType: chatRequest.providerType,
      stream: options.stream === true,
    },
    plannerOutput: {
      source: plannerResult.plannerOutputSource || "message_content",
      reasoningFallback: plannerResult.reasoningFallback || null,
    },
    memory: {
      schema: memoryContext.schema || "",
      included: memoryContext.included === true,
      reason: normalizeText(memoryContext.reason, 80),
      mode: normalizeText(memoryContext.mode, 80),
      action: normalizeText(memoryContext.action || request.intentHint, 100),
      count: Array.isArray(memoryContext.entries) ? memoryContext.entries.length : 0,
      entries: Array.isArray(memoryContext.entries)
        ? memoryContext.entries.map((entry) => ({
          memoryId: normalizeText(entry.memoryId, 100),
          type: normalizeText(entry.type, 40),
          typeLabel: normalizeText(entry.typeLabel, 40),
          title: normalizeText(entry.title, 160),
          strength: normalizeText(entry.strength, 40),
          appliesTo: Array.isArray(entry.appliesTo) ? entry.appliesTo.slice(0, 16).map((item) => normalizeText(item, 80)).filter(Boolean) : [],
          body: normalizeText(entry.body, 900),
          match: normalizeObject(entry.match),
          projection: normalizeText(entry.projection, 300),
          reason: normalizeText(entry.reason, 300),
          usedBy: normalizeText(entry.usedBy, 40),
          hasRule: entry.hasRule === true,
        }))
        : [],
      excluded: Array.isArray(memoryContext.excluded)
        ? memoryContext.excluded.slice(0, 24).map((entry) => ({
          memoryId: normalizeText(entry.memoryId, 100),
          type: normalizeText(entry.type, 40),
          title: normalizeText(entry.title, 160),
          reason: normalizeText(entry.reason, 120),
          usedBy: normalizeText(entry.usedBy, 40),
        }))
        : [],
      promptBlock: normalizeText(plannerResult.memoryPromptBlock, 8000),
    },
    semanticAction,
    actionReview,
    semanticFeedback: request.semanticFeedback || null,
    contextRequest: decision.contextRequest || null,
    contextGrant: request.contextGrant || null,
    contextContinuation: request.contextContinuation || null,
    contextGuard: plannerResult.contextGuard || null,
    contextResolution: {
      ...(plannerResult.contextResolution || {}),
      schema: plannerResult.contextResolution?.schema || AI_CONTEXT_RESOLUTION_SCHEMA,
      executionSource: plannerResult.turnContext?.execution?.source || "",
      executionTodoCount: Array.isArray(plannerResult.turnContext?.execution?.todos) ? plannerResult.turnContext.execution.todos.length : 0,
      executionBusyBlockCount: Array.isArray(plannerResult.turnContext?.execution?.busyBlocks) ? plannerResult.turnContext.execution.busyBlocks.length : 0,
      materialCount: Array.isArray(plannerResult.turnContext?.materials) ? plannerResult.turnContext.materials.length : 0,
    },
    uiTransition: redactSensitiveValue(normalizeObject(request.input?.uiTransition), { maxStringLength: 1000 }),
    modelInputBudget: {
      schema: MODEL_INPUT_BUDGET_REPORT_SCHEMA,
      planner: plannerResult.plannerBudgetReport || null,
      writer: options.writerBudgetReport || null,
    },
    context: {
      schema: normalizeText(modelContext.schema || AI_CONTEXT_ENVELOPE_SCHEMA, 80),
      currentDate: normalizeText(modelContext.currentDate, 20),
      timezone: normalizeText(modelContext.timezone || request.timezone, 80),
      intentHint: normalizeText(modelContext.intentHint || request.intentHint || "none", 100),
      runtimeClock: normalizeObject(modelContext.runtimeClock),
      referenceScope: normalizeObject(modelContext.referenceScope),
      viewContext: normalizeObject(modelContext.viewContext),
      dateReference: modelContext.dateReference || null,
      contextGrant: modelContext.contextGrant || request.contextGrant || null,
      contextContinuation: modelContext.contextContinuation || request.contextContinuation || null,
      contextAccessPolicy: modelContext.contextAccessPolicy || request.contextAccessPolicy || null,
      progress: normalizeObject(modelContext.progress),
      progressSummary: normalizeText(modelContext.progress?.raw || modelContext.progressSummary, 800),
      selectedObjects: normalizeObject(modelContext.selectedObjects),
      pageWorkContext: normalizeObject(modelContext.pageWorkContext),
      globalBackgroundContext: normalizeObject(modelContext.globalBackgroundContext),
      selectedTodo: modelContext.selectedTodo || null,
      todos: Array.isArray(modelContext.todos) ? modelContext.todos.slice(0, 20) : [],
      entries: Array.isArray(modelContext.entries) ? modelContext.entries.slice(0, 30) : [],
      busyBlocks: Array.isArray(modelContext.busyBlocks) ? modelContext.busyBlocks.slice(0, 20) : [],
      materials: Array.isArray(modelContext.materials) ? modelContext.materials.slice(0, 24) : [],
      constraints: normalizeObject(modelContext.constraints),
    },
    modelInput: {
      schema: AI_MODEL_INPUT_TRACE_SCHEMA,
      turns: modelInputTurns.filter((turn) => turn.messages.length),
    },
    modelOutput: {
      schema: AI_MODEL_OUTPUT_TRACE_SCHEMA,
      turns: modelOutputTurns.filter((turn) => turn.content),
    },
    turnTrace,
  }, { maxStringLength: 60000 });
  const finalAnswer = sanitizeAssistantAnswerText(options.answer);
  return {
    schema: AI_ASSISTANT_RESULT_SCHEMA,
    requestId: request.requestId,
    mode: decision.type,
    answer: finalAnswer || decision.answer || (
      decision.type === "tool"
        ? buildPendingToolAnswer(decision)
        : decision.handoff || plannerResult.providerText
    ),
    decision: redactSensitiveValue({
      type: decision.type,
      tool: decision.tool || "",
      legacyAction: decision.legacyAction || "",
      moduleId: decision.moduleId || "",
      toolMode: decision.toolMode || "",
      requiresUserConfirmation: decision.requiresUserConfirmation === true,
      memoryNamespace: decision.memoryNamespace || "",
      draftSchema: Array.isArray(decision.draftSchema) ? decision.draftSchema.slice(0, 8) : [],
      intent: decision.intent || "",
      handoff: decision.handoff || "",
      writerTask: decision.writerTask || null,
      needsFollowUp: decision.needsFollowUp === true,
      boundary: decision.boundary || "",
      referenceKeys: Array.isArray(decision.referenceKeys) ? decision.referenceKeys.slice(0, 12) : [],
      contextRequest: decision.contextRequest || null,
      contextAssessment: decision.contextAssessment || null,
      contextResolution: plannerResult.contextResolution || null,
      contextGuard: plannerResult.contextGuard || null,
      semanticAction,
      actionReview,
      reason: decision.reason || "",
      intentHint: request.intentHint || "",
      parseStatus: decision.parseStatus || "",
      requestedTool: decision.requestedTool || "",
      plannerOutputSource: plannerResult.plannerOutputSource || "message_content",
      reasoningFallback: plannerResult.reasoningFallback || null,
    }, { maxStringLength: 1000 }),
    provider: {
      providerType: chatRequest.providerType,
      stream: options.stream === true,
    },
    contextSnapshot,
    semanticAction,
    actionReview,
    contextRequest: decision.contextRequest || null,
    contextAssessment: decision.contextAssessment || null,
    contextResolution: plannerResult.contextResolution || null,
    contextGuard: plannerResult.contextGuard || null,
    workflow,
  };
}

function buildAnswerWriterMessageBundle(request, decision = {}, toolCatalog = createAssistantToolCatalog(), options = {}) {
  const context = normalizeObject(options.modelContext);
  const contextBundle = Object.keys(context).length
    ? {
      context,
      memoryPromptBlock: normalizeText(options.memoryPromptBlock, 8000),
    }
    : buildContextBundleForModel(request, toolCatalog, {
      memoryStore: options.memoryStore,
      now: options.now,
    });
  const modelContext = Object.keys(context).length ? context : contextBundle.context;
  const modelFacingContext = buildModelFacingContext(modelContext);
  const memoryPromptBlock = normalizeText(contextBundle.memoryPromptBlock, 8000);
  const writerTask = normalizeWriterTask(decision);
  const history = request.messages.map((message) => ({
    role: message.role,
    content: message.content,
  }));
  const systemPrompt = [
    `prompt_schema: ${AI_WRITER_PROMPT_SCHEMA}`,
    "角色：你是观时的 Writer，负责把 Planner 的 writerTask 写成用户可见的中文正文。",
    "任务边界：只执行 writerTask；不重新选择工具；不创建草稿；不声称已经写入待办、日历、提醒或记忆。answer 模式没有本轮 Workflow 产物，因此不得声称已创建、已生成、已保存或已更新待确认卡片、草稿、提案，也不得承诺稍后自动生成。",
    "写作规则：遵守 responseShape、mustMention、mustAvoid、tone 和 boundary；如果要求追问，只追问一个关键问题。",
    "最终输出：只输出用户会看到的正文；不要输出写作任务分析、字段复述、检查清单、过渡句或“好的，来写正文”。",
    "禁止词：不要出现 responseShape、mustMention、mustAvoid、tone、needsFollowUp、writerTask、Shape要求等内部字段描述。",
    "透明边界：不要提到 Planner、system prompt、隐藏上下文、内部流程或模型输入审计。",
    "草稿状态：涉及上一份排程草稿时，只引用上下文里的 latestScheduleDraft 状态；已确认或已应用的草稿不能再写成待确认。",
  ].filter(Boolean).join("\n\n");
  const writerTaskPayload = JSON.stringify({
          schema: AI_WRITER_TASK_SCHEMA,
          type: decision.type || "answer",
          intent: decision.intent || "general_answer",
          goal: writerTask.goal,
          responseShape: writerTask.responseShape,
          mustMention: writerTask.mustMention,
          mustAvoid: writerTask.mustAvoid,
          tone: writerTask.tone,
          legacyHandoff: decision.handoff || "",
          needsFollowUp: decision.needsFollowUp === true,
          boundary: decision.boundary || "",
          referenceKeys: Array.isArray(decision.referenceKeys) ? decision.referenceKeys.slice(0, 12) : [],
          reason: decision.reason || "",
          parseStatus: decision.parseStatus || "",
  }, null, 2);
  return composeModelInput({
    stage: "writer",
    provider: options.provider,
    maxOutputTokens: 1400,
    systemPrompt,
    history,
    sections: [
      {
        key: "writer_task",
        label: "写作任务",
        order: 0,
        priority: 95,
        content: ["写作任务（来自 Planner；只作为写作工单，不要重新规划路线）：", writerTaskPayload].join("\n"),
      },
      {
        key: "writer_context",
        label: "可参考上下文",
        order: 1,
        priority: 75,
        content: [
          "可参考上下文（仅用于写作，不要泄露原始隐私数据）：",
          JSON.stringify(modelFacingContext, null, 2),
        ].join("\n"),
        summary: JSON.stringify({
          currentDate: modelFacingContext.currentDate,
          runtimeClock: modelFacingContext.runtimeClock,
          referenceScope: modelFacingContext.referenceScope,
          progress: modelFacingContext.progress,
          latestScheduleDraft: modelFacingContext.globalBackgroundContext?.pendingState?.latestScheduleDraft || null,
        }, null, 2),
      },
      {
        key: "writer_memory",
        label: "已确认用户记忆",
        order: 2,
        priority: 70,
        content: [
          "已确认用户记忆（上下文；如果和本轮用户输入冲突，以本轮用户输入为准）：",
          memoryPromptBlock || "无",
        ].join("\n"),
        summary: "已确认用户记忆：本轮因输入预算只保留匹配结论。",
      },
      {
        key: "current_user_input",
        label: "本轮用户输入",
        order: 3,
        priority: 100,
        required: true,
        content: [
          "本轮用户输入（最高优先级）：",
          request.text,
          "请直接输出本轮给用户看的中文正文。",
        ].join("\n"),
      },
    ],
  });
}

function buildAnswerWriterMessages(request, decision = {}, toolCatalog = createAssistantToolCatalog(), options = {}) {
  return buildAnswerWriterMessageBundle(request, decision, toolCatalog, options).messages;
}

async function runAnswerWriterTurn(plannerResult, options = {}) {
  const writerMessageBundle = buildAnswerWriterMessageBundle(plannerResult.request, plannerResult.decision, plannerResult.toolCatalog, {
    modelContext: plannerResult.modelContext,
    memoryPromptBlock: plannerResult.memoryPromptBlock,
    memoryStore: options.memoryStore,
    provider: plannerResult.provider,
  });
  const writerMessages = writerMessageBundle.messages;
  let response;
  let writerRequestTrace = null;
  try {
    emitAssistantEvent(options, {
      type: "status",
      stage: "answer_writer",
      label: "生成回答",
      requestId: plannerResult.request.requestId,
    });
    const providerResult = await fetchProviderChat(plannerResult.provider, {
      messages: writerMessages,
      allowExternalRequest: true,
      temperature: 0.4,
      maxTokens: 1400,
    }, {
      env: options.env || process.env,
      fetchImpl: options.fetchImpl,
      allowExternalRequest: true,
      stream: false,
    });
    response = providerResult.response;
    writerRequestTrace = providerResult.requestTrace;
  } catch (error) {
    throw addStageToError(error, "answer_writer", "AI_ASSISTANT_WRITER_REQUEST_FAILED", "AI answer writer request failed.", 502);
  }

  let providerPayload;
  let providerRawText = "";
  let writerResponseTrace = null;
  try {
    const providerTrace = await readProviderPayloadWithTrace(response);
    providerPayload = providerTrace.payload;
    providerRawText = providerTrace.rawText;
    writerResponseTrace = providerTrace.responseTrace;
  } catch (error) {
    throw addStageToError(error, "answer_writer", "AI_ASSISTANT_WRITER_RESPONSE_READ_FAILED", "AI answer writer response could not be read.", 502);
  }
  if (!response.ok) {
    throw createAssistantError("AI_ASSISTANT_WRITER_HTTP_STATUS", "AI answer writer request failed.", 502, {
      stage: "answer_writer",
      httpStatus: response.status,
      body: redactSensitiveValue(providerPayload, { maxStringLength: 2000 }),
    });
  }
  const writerOutput = sanitizeAssistantAnswerText(extractProviderText(providerPayload));
  return {
    answer: writerOutput || plannerResult.decision.handoff || plannerResult.providerText,
    writerMessages,
    writerBudgetReport: writerMessageBundle.report,
    writerOutput,
    providerPayload,
    providerRawText,
    writerRequestTrace,
    writerResponseTrace,
  };
}

async function executeAiAssistantTurn(input, stores = {}, options = {}) {
  const plannerResult = await planAssistantTurn(input, {
    ...options,
    memoryStore: options.memoryStore || stores.memoryStore,
    draftStore: options.draftStore || stores.draftStore,
  });
  if (["need_more_context", "need_context_recompose"].includes(plannerResult.decision.type)) {
    return buildAssistantResultFromPlan(plannerResult, null, { stream: false, now: options.now });
  }
  if (plannerResult.decision.type === "answer") {
    const writerResult = await runAnswerWriterTurn(plannerResult, {
      ...options,
      memoryStore: options.memoryStore || stores.memoryStore,
    });
    return buildAssistantResultFromPlan(plannerResult, null, {
      answer: writerResult.answer,
      stream: false,
      writerOutput: writerResult.writerOutput || writerResult.answer,
      writerMessages: writerResult.writerMessages,
      writerBudgetReport: writerResult.writerBudgetReport,
      writerRequestTrace: writerResult.writerRequestTrace,
      writerResponseTrace: writerResult.writerResponseTrace,
      now: options.now,
    });
  }
  const workflow = executeAssistantToolDecision(plannerResult, stores, options);
  return buildAssistantResultFromPlan(plannerResult, workflow, { stream: false, now: options.now });
}

module.exports = {
  AI_ASSISTANT_REQUEST_SCHEMA,
  AI_ASSISTANT_RESULT_SCHEMA,
  AI_CONTEXT_SNAPSHOT_SCHEMA,
  AI_CONTEXT_ENVELOPE_SCHEMA,
  AI_CONTEXT_ASSESSMENT_SCHEMA,
  AI_CONTEXT_RESOLUTION_SCHEMA,
  AI_CONTEXT_CONTINUATION_SCHEMA,
  AI_TURN_CONTEXT_SCHEMA,
  AI_MODEL_INPUT_TRACE_SCHEMA,
  AI_TURN_TRACE_SCHEMA,
  AI_ACTION_REVIEW_SCHEMA,
  AI_PLANNER_PROMPT_SCHEMA,
  AI_RUNTIME_CLOCK_SCHEMA,
  AI_SEMANTIC_ACTION_SCHEMA,
  AI_SEMANTIC_FEEDBACK_SCHEMA,
  AI_WRITER_PROMPT_SCHEMA,
  AI_WRITER_TASK_SCHEMA,
  TOOL_DEFINITIONS,
  buildAnswerWriterMessageBundle,
  buildAnswerWriterMessages,
  buildAssistantResultFromPlan,
  buildSemanticAction,
  createAssistantAnswerStreamFilter,
  createAssistantToolCatalog,
  executeAiAssistantTurn,
  executeAssistantToolDecision,
  extractProviderText,
  normalizeDecision,
  planAssistantTurn,
  sanitizeAssistantAnswerText,
  stabilizeDecision,
};
