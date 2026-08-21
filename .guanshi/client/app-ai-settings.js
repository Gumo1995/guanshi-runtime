/* global window */

(function attachTimeQualityAiSettingsModule(globalScope) {
  "use strict";

  const DEFAULT_PROVIDER_TYPES = [
    {
      type: "openai-compatible",
      label: "OpenAI-compatible",
      defaultBaseUrl: "https://api.openai.com/v1",
      defaultModel: "gpt-4.1-mini",
      defaultContextWindowTokens: 128000,
      defaultPreferredInputBudgetTokens: 96000,
      envKeyNames: ["OPENAI_API_KEY"],
      requiresApiKey: true,
    },
    {
      type: "anthropic",
      label: "Anthropic",
      defaultBaseUrl: "https://api.anthropic.com",
      defaultModel: "claude-3-5-sonnet-latest",
      defaultContextWindowTokens: 200000,
      defaultPreferredInputBudgetTokens: 150000,
      envKeyNames: ["ANTHROPIC_API_KEY"],
      requiresApiKey: true,
    },
    {
      type: "hermes-webui",
      label: "Hermes WebUI",
      defaultBaseUrl: "http://127.0.0.1:8088",
      defaultModel: "",
      defaultContextWindowTokens: 128000,
      defaultPreferredInputBudgetTokens: 96000,
      envKeyNames: [],
      requiresApiKey: false,
    },
    {
      type: "ollama",
      label: "Ollama",
      defaultBaseUrl: "http://127.0.0.1:11434/v1",
      defaultModel: "llama3.1",
      defaultContextWindowTokens: 32768,
      defaultPreferredInputBudgetTokens: 24000,
      envKeyNames: [],
      requiresApiKey: false,
    },
    {
      type: "lm-studio",
      label: "LM Studio",
      defaultBaseUrl: "http://127.0.0.1:1234/v1",
      defaultModel: "local-model",
      defaultContextWindowTokens: 32768,
      defaultPreferredInputBudgetTokens: 24000,
      envKeyNames: [],
      requiresApiKey: false,
    },
    {
      type: "custom",
      label: "Custom Gateway",
      defaultBaseUrl: "",
      defaultModel: "",
      defaultContextWindowTokens: 128000,
      defaultPreferredInputBudgetTokens: 96000,
      envKeyNames: [],
      requiresApiKey: false,
    },
  ];

  const MEMORY_TYPE_LABELS = {
    profile: "画像",
    principle: "原则",
    habit: "习惯",
    boundary: "边界",
    preference: "偏好",
    rule: "规则",
    playbook: "经验方法",
    capability_request: "能力需求",
    review: "复盘观察",
  };

  const MEMORY_STRENGTH_LABELS = {
    hard: "硬规则",
    soft: "软偏好",
    observed: "观察",
  };

  const MEMORY_ACTION_LABELS = {
    assistant: "通用对话",
    parse_task: "任务录入",
    breakdown_task: "任务拆解",
    plan_today: "今日排程",
    plan_week: "周排程",
    reflow_unfinished: "重排未完成",
    review_day: "复盘",
    schedule_draft: "排程草稿",
  };

  const MEMORY_EXCLUSION_REASON_LABELS = {
    applies_to_mismatch: "场景不匹配",
    empty_body: "没有正文",
    model_read_disabled: "已禁止 AI 使用",
    engine_read_disabled: "已禁止本地规则使用",
    invalid_entry: "记录异常",
    match_required_not_hit: "匹配条件未命中",
    not_user_confirmed: "尚未确认",
    over_limit: "超过本轮上限",
    rule_target_unsupported: "当前场景没有对应的本地执行规则",
    rule_not_projectable: "没有可执行规则",
    status_not_active: "未启用",
    subject_conflict: "存在同主题冲突，需先处理",
    superseded: "已被更新版本替代",
    type_excluded: "类型默认不注入",
    validity_expired: "已过有效期",
    validity_not_started: "尚未到生效时间",
  };

  const DEFAULT_MEMORY_APPLIES_TO = ["plan_today", "plan_week", "reflow_unfinished", "schedule_draft"];
  const SCHEDULE_ACTIONS = new Set(["plan_today", "plan_week", "reflow_unfinished", "schedule_draft"]);
  const SCHEDULE_ACTION_ALIASES = new Set(["schedule_draft", "schedule_planning"]);
  const MEMORY_STATUS_FILTERS = {
    active: {
      label: "已启用",
      hint: "可能进入 AI 或排程",
      empty: "暂无已启用记忆。",
      loading: "正在读取已启用记忆。",
    },
    pending: {
      label: "待确认",
      hint: "确认后才会启用",
      empty: "暂无待确认提案。",
      loading: "正在读取待确认提案。",
    },
    disabled: {
      label: "已停用",
      hint: "保留但不注入",
      empty: "暂无已停用记忆。",
      loading: "正在读取已停用记忆。",
    },
  };

  const ACTION_KIND_LABELS = {
    answer: "回复",
    draft: "草稿",
    insight: "洞察",
  };

  const STEP_TYPE_LABELS = {
    deterministic: "本地规则",
    heuristic: "本地启发",
    planner_semantic: "Planner 语义",
    human_gate: "确认关卡",
    writer: "Writer",
    mcp_tool: "MCP Tool",
  };

  const ACTION_EXECUTION_LABELS = {
    registry_pipeline: "Registry pipeline",
    legacy_workflow: "Legacy workflow",
  };

  const FIELD_IDS = {
    providerBadge: "settings-ai-provider-badge",
    mcpBadge: "settings-ai-mcp-badge",
    actionsBadge: "settings-ai-actions-badge",
    providerForm: "settings-ai-provider-form",
    providerType: "settings-ai-provider-type",
    providerId: "settings-ai-provider-id",
    providerBaseUrl: "settings-ai-provider-base-url",
    providerModel: "settings-ai-provider-model",
    providerContextWindow: "settings-ai-provider-context-window",
    providerInputBudget: "settings-ai-provider-input-budget",
    providerEnv: "settings-ai-provider-env",
    providerApiKey: "settings-ai-provider-api-key",
    providerEnabled: "settings-ai-provider-enabled",
    providerSaveBtn: "settings-ai-provider-save-btn",
    providerTestBtn: "settings-ai-provider-test-btn",
    providerNetworkTestBtn: "settings-ai-provider-network-test-btn",
    providerUpdated: "settings-ai-provider-updated",
    providerSummary: "settings-ai-provider-summary",
    providerStatus: "settings-ai-provider-status",
    mcpSummary: "settings-ai-mcp-summary",
    mcpTools: "settings-ai-mcp-tools",
    mcpRefreshBtn: "settings-ai-mcp-refresh-btn",
    mcpCopyHttpBtn: "settings-ai-mcp-copy-http-btn",
    mcpCopyStdioBtn: "settings-ai-mcp-copy-stdio-btn",
    mcpStatus: "settings-ai-mcp-status",
    actionsSummary: "settings-ai-actions-summary",
    actionsRefreshBtn: "settings-ai-actions-refresh-btn",
    actionList: "settings-ai-action-list",
    stepList: "settings-ai-step-list",
    actionsStatus: "settings-ai-actions-status",
    memoryBadge: "settings-ai-memory-badge",
    memorySummary: "settings-ai-memory-summary",
    memoryStatusActiveBtn: "settings-ai-memory-status-active",
    memoryStatusPendingBtn: "settings-ai-memory-status-pending",
    memoryStatusDisabledBtn: "settings-ai-memory-status-disabled",
    memoryListTitle: "settings-ai-memory-list-title",
    memoryListHint: "settings-ai-memory-list-hint",
    memoryList: "settings-ai-memory-list",
    memoryDetail: "settings-ai-memory-detail",
    memoryRefreshBtn: "settings-ai-memory-refresh-btn",
    memoryNewBtn: "settings-ai-memory-new-btn",
    memoryEditor: "settings-ai-memory-editor",
    memoryEditorTitle: "settings-ai-memory-editor-title",
    memoryEditorHint: "settings-ai-memory-editor-hint",
    memoryTitleInput: "settings-ai-memory-title-input",
    memoryTypeSelect: "settings-ai-memory-type-select",
    memoryStrengthSelect: "settings-ai-memory-strength-select",
    memoryAppliesInput: "settings-ai-memory-applies-input",
    memoryBodyInput: "settings-ai-memory-body-input",
    memorySubjectInput: "settings-ai-memory-subject-input",
    memoryMatchModeSelect: "settings-ai-memory-match-mode-select",
    memoryConfidenceInput: "settings-ai-memory-confidence-input",
    memoryMatchInput: "settings-ai-memory-match-input",
    memoryRuleInput: "settings-ai-memory-rule-input",
    memoryValidFromInput: "settings-ai-memory-valid-from-input",
    memoryValidUntilInput: "settings-ai-memory-valid-until-input",
    memoryReviewAfterInput: "settings-ai-memory-review-after-input",
    memoryModelReadable: "settings-ai-memory-model-readable",
    memoryEngineReadable: "settings-ai-memory-engine-readable",
    memorySaveBtn: "settings-ai-memory-save-btn",
    memoryCancelBtn: "settings-ai-memory-cancel-btn",
    memoryPreviewAction: "settings-ai-memory-preview-action",
    memoryPreviewBtn: "settings-ai-memory-preview-btn",
    memoryPreviewSummary: "settings-ai-memory-preview-summary",
    memoryPreviewBody: "settings-ai-memory-preview-body",
    memoryStatus: "settings-ai-memory-status",
  };

  function normalizeText(value, maxLength = 500) {
    return String(value || "").trim().slice(0, maxLength);
  }

  function createAiSettingsModule(deps = {}) {
    const documentRef = deps.documentRef || globalScope.document || null;
    const windowRef = deps.windowRef || globalScope.window || globalScope;
    const locationRef = deps.locationRef || windowRef.location || {};
    const navigatorRef = deps.navigatorRef || windowRef.navigator || {};
    const fetchFn =
      typeof deps.fetchFn === "function"
        ? deps.fetchFn
        : typeof windowRef.fetch === "function"
          ? windowRef.fetch.bind(windowRef)
          : null;
    const confirmFn =
      typeof deps.confirmFn === "function"
        ? deps.confirmFn
        : typeof windowRef.confirm === "function"
          ? windowRef.confirm.bind(windowRef)
          : () => false;

    const refs = {};
    let eventsBound = false;
    let providerTypes = [...DEFAULT_PROVIDER_TYPES];
    let providerConfig = null;
    let mcpStatusPayload = null;
    let mcpToolsPayload = null;
    let actionRegistryPayload = null;
    let memoryEntries = [];
    let memoryProposals = [];
    let memoryConfig = null;
    let memoryHealth = null;
    let memoryRuleRegistry = null;
    let memoryStatusFilter = "active";
    let selectedMemoryRef = { kind: "", id: "" };
    let memoryEffectSelectionKey = "";
    let memoryEditorState = { mode: "new", id: "" };
    let providerLoaded = false;
    let mcpLoaded = false;
    let actionsLoaded = false;
    let memoryLoaded = false;
    let loadingProvider = false;
    let loadingMcp = false;
    let loadingActions = false;
    let loadingMemory = false;

    function collectRefs() {
      if (!documentRef || typeof documentRef.getElementById !== "function") return;
      for (const [key, id] of Object.entries(FIELD_IDS)) {
        refs[key] = documentRef.getElementById(id);
      }
    }

    function getRef(key) {
      if (!refs[key]) collectRefs();
      return refs[key] || null;
    }

    function setText(node, value) {
      if (node) node.textContent = String(value ?? "");
    }

    function setTone(node, tone = "normal") {
      if (node) node.dataset.tone = tone;
    }

    function setStatus(node, message, tone = "normal") {
      setText(node, message);
      setTone(node, tone);
    }

    function setBusy(button, busy) {
      if (!button) return;
      button.disabled = Boolean(busy);
      button.dataset.busy = busy ? "true" : "false";
    }

    function getProviderDefinition(type) {
      return providerTypes.find((item) => item.type === type) || providerTypes[0] || DEFAULT_PROVIDER_TYPES[0];
    }

    function getActiveProvider() {
      const providers = providerConfig?.providers && typeof providerConfig.providers === "object"
        ? providerConfig.providers
        : {};
      const activeId = normalizeText(providerConfig?.activeProviderId, 80);
      if (activeId && providers[activeId]) return providers[activeId];
      return Object.values(providers)[0] || null;
    }

    function getProviderLabel(provider) {
      const definition = getProviderDefinition(provider?.type || provider);
      return definition?.label || normalizeText(provider?.type || provider) || "--";
    }

    function createKvRow(label, value) {
      const row = documentRef.createElement("div");
      const dt = documentRef.createElement("dt");
      const dd = documentRef.createElement("dd");
      dt.textContent = label;
      dd.textContent = value || "--";
      row.append(dt, dd);
      return row;
    }

    function replaceKvRows(listNode, rows) {
      if (!listNode || !documentRef) return;
      listNode.replaceChildren(...rows.map(([label, value]) => createKvRow(label, value)));
    }

    function createNode(tagName, className = "", text = "") {
      const node = documentRef.createElement(tagName);
      if (className) node.className = className;
      if (text !== "") node.textContent = text;
      return node;
    }

    function formatMemoryType(type) {
      return MEMORY_TYPE_LABELS[type] || normalizeText(type, 40) || "记忆";
    }

    function formatMemoryStrength(strength) {
      const value = normalizeText(strength || "soft", 40);
      return MEMORY_STRENGTH_LABELS[value] || value || "软偏好";
    }

    function normalizeActionKey(value) {
      const action = normalizeText(value, 100);
      if (!action) return "";
      const parts = action.split(".");
      return parts[parts.length - 1] || action;
    }

    function formatMemoryAction(action) {
      const value = normalizeActionKey(action);
      return MEMORY_ACTION_LABELS[value] || value || "--";
    }

    function formatMemoryActionList(value) {
      const items = normalizeStringList(value, 16);
      return items.length ? items.map(formatMemoryAction).join("、") : "全部场景";
    }

    function memoryAppliesToAction(item = {}, action = "") {
      const actionName = normalizeActionKey(action);
      if (!actionName) return true;
      const appliesTo = normalizeStringList(item.appliesTo, 16).map(normalizeActionKey).filter(Boolean);
      if (!appliesTo.length) return true;
      if (appliesTo.includes(actionName)) return true;
      if (SCHEDULE_ACTIONS.has(actionName) && appliesTo.some((value) => SCHEDULE_ACTION_ALIASES.has(value))) return true;
      return false;
    }

    function hasMemoryMatch(item = {}) {
      const match = item.match && typeof item.match === "object" && !Array.isArray(item.match) ? item.match : {};
      return Object.values(match).some((value) => Array.isArray(value) ? value.length > 0 : Boolean(value));
    }

    function formatMemoryMatch(item = {}) {
      const match = item.match && typeof item.match === "object" && !Array.isArray(item.match) ? item.match : {};
      const rows = [
        ["关键词", match.keywords],
        ["任务类型", match.taskType],
        ["项目", match.project],
        ["分类", match.category],
        ["时间", match.timeHint],
      ].map(([label, value]) => {
        const values = normalizeStringList(value, 8);
        return values.length ? `${label} ${values.join("、")}` : "";
      }).filter(Boolean);
      return rows.join("；");
    }

    function getMemoryRuleKind(item = {}) {
      return normalizeText(item.rule?.kind, 80);
    }

    function canProjectMemoryToEngine(item = {}) {
      if (typeof item.effectiveEngineReadable === "boolean") return item.effectiveEngineReadable;
      return item.engineReadable === true && Boolean(getMemoryRuleKind(item));
    }

    function canEnterModelContext(item = {}) {
      if (typeof item.effectiveModelReadable === "boolean") return item.effectiveModelReadable;
      if (normalizeText(item.type, 40) === "capability_request") return false;
      return item.modelReadable !== false && normalizeText(item.type, 40) !== "review";
    }

    function formatMemoryExclusionReason(reason) {
      const value = normalizeText(reason, 120);
      return MEMORY_EXCLUSION_REASON_LABELS[value] || value || "未命中";
    }

    function formatMemoryStatus(status) {
      if (status === "active") return "已启用";
      if (status === "disabled") return "已停用";
      if (status === "deleted") return "已删除";
      if (status === "confirmed") return "已确认";
      if (status === "rejected") return "已拒绝";
      if (status === "expired") return "已过期";
      return "待确认";
    }

    function normalizeStringList(value, maxItems = 16) {
      if (Array.isArray(value)) {
        return value.map((item) => normalizeText(item, 80)).filter(Boolean).slice(0, maxItems);
      }
      return normalizeText(value, 1000)
        .split(/[,，、\s]+/)
        .map((item) => normalizeText(item, 80))
        .filter(Boolean)
        .slice(0, maxItems);
    }

    function formatList(value) {
      const items = normalizeStringList(value, 16);
      return items.length ? items.join(", ") : "--";
    }

    function formatDateTime(value) {
      const text = normalizeText(value, 80);
      return text ? text.slice(0, 16).replace("T", " ") : "--";
    }

    function getMemoryById(memoryId) {
      return memoryEntries.find((entry) => entry.id === memoryId) || null;
    }

    function getProposalById(proposalId) {
      return memoryProposals.find((proposal) => proposal.proposalId === proposalId) || null;
    }

    function normalizeMemoryStatusFilter(value) {
      const key = normalizeText(value, 40);
      return MEMORY_STATUS_FILTERS[key] ? key : "active";
    }

    function getMemoryStatusButton(filter) {
      if (filter === "pending") return getRef("memoryStatusPendingBtn");
      if (filter === "disabled") return getRef("memoryStatusDisabledBtn");
      return getRef("memoryStatusActiveBtn");
    }

    function getMemoryStatusCounts() {
      return {
        active: memoryEntries.filter((entry) => entry.status === "active").length,
        pending: memoryProposals.length,
        disabled: memoryEntries.filter((entry) => entry.status === "disabled").length,
      };
    }

    function getMemoryRecordId(record = {}) {
      return record.kind === "proposal" ? record.item?.proposalId || "" : record.item?.id || "";
    }

    function getMemoryRecords(filter = memoryStatusFilter) {
      const status = normalizeMemoryStatusFilter(filter);
      if (status === "pending") {
        return memoryProposals.map((proposal) => ({ kind: "proposal", item: proposal }));
      }
      const entryStatus = status === "disabled" ? "disabled" : "active";
      return memoryEntries
        .filter((entry) => entry.status === entryStatus)
        .map((entry) => ({ kind: "entry", item: entry }));
    }

    function getSelectedMemoryRecord() {
      const records = getMemoryRecords();
      if (!records.length) {
        selectedMemoryRef = { kind: "", id: "" };
        return null;
      }

      const selected = records.find((record) => {
        return selectedMemoryRef.kind === record.kind && selectedMemoryRef.id === getMemoryRecordId(record);
      });
      if (selected) return selected;

      const fallback = records[0];
      selectedMemoryRef = { kind: fallback.kind, id: getMemoryRecordId(fallback) };
      return fallback;
    }

    function setSelectedMemoryRecord(kind, id) {
      selectedMemoryRef = { kind: normalizeText(kind, 40), id: normalizeText(id, 120) };
      renderMemoryLists();
    }

    function setMemoryStatusFilter(filter, options = {}) {
      memoryStatusFilter = normalizeMemoryStatusFilter(filter);
      if (!options.preserveSelection) selectedMemoryRef = { kind: "", id: "" };
      renderMemoryLists();
    }

    function createMemoryChip(text, tone = "") {
      const chip = createNode("span", "settings-ai-memory-chip", text);
      if (tone) chip.dataset.tone = tone;
      return chip;
    }

    function createMemoryUseChips(item = {}, mode = "entry") {
      const chips = [];
      const healthItem = mode === "entry" && Array.isArray(memoryHealth?.items)
        ? memoryHealth.items.find((candidate) => candidate.memoryId === item.id)
        : null;
      if (healthItem?.issues?.includes("subject_conflict")) chips.push(createMemoryChip("与其他记忆冲突", "warning"));
      if (healthItem?.issues?.includes("subject_duplicate")) chips.push(createMemoryChip("存在重复记忆", "warning"));
      if (mode === "proposal") chips.push(createMemoryChip("确认后生效", "warning"));
      if (mode === "proposal" && item.relation?.kind === "duplicate") chips.push(createMemoryChip("重复：将复用现有记忆", "warning"));
      if (mode === "proposal" && item.relation?.kind === "update") chips.push(createMemoryChip("更新：确认后修改原记忆", "warning"));
      if (mode === "proposal" && item.relation?.kind === "conflict") {
        const count = normalizeStringList(item.relation.relatedMemoryIds, 24).length;
        chips.push(createMemoryChip(`冲突：将合并 ${count || "多"} 条旧记忆`, "warning"));
      }
      if (mode === "proposal" && item.relation?.kind === "unresolved_update") chips.push(createMemoryChip("未找到要更新的原记忆", "warning"));
      if (mode === "proposal" && item.relation?.kind === "parallel") chips.push(createMemoryChip("范围不同：可并存", "success"));
      if (canEnterModelContext(item)) {
        chips.push(createMemoryChip("可给模型", "success"));
      } else {
        chips.push(createMemoryChip("不进模型", "warning"));
      }
      if (canProjectMemoryToEngine(item)) {
        chips.push(createMemoryChip("本地规则可执行", "success"));
      } else if (getMemoryRuleKind(item)) {
        chips.push(createMemoryChip(item.engineReadable === true ? "仅供 AI 使用（暂无本地执行器）" : "仅供 AI 使用（未授权本地执行）"));
      } else {
        chips.push(createMemoryChip("仅供 AI 参考"));
      }
      return chips;
    }

    function createMemoryMetaLine(text) {
      const node = createNode("small", "settings-ai-memory-meta-line", text);
      return node;
    }

    function formatActionKind(kind) {
      const key = normalizeText(kind, 40);
      return ACTION_KIND_LABELS[key] || key || "--";
    }

    function formatStepType(type) {
      const key = normalizeText(type, 40);
      return STEP_TYPE_LABELS[key] || key || "--";
    }

    function formatActionExecutionMode(mode) {
      const key = normalizeText(mode, 60);
      return ACTION_EXECUTION_LABELS[key] || key || "--";
    }

    function getRegistryActions() {
      return Array.isArray(actionRegistryPayload?.action_registry) ? actionRegistryPayload.action_registry : [];
    }

    function getMemoryActionOptions() {
      const options = [{ value: "assistant", label: MEMORY_ACTION_LABELS.assistant || "通用对话" }];
      const registryActions = getRegistryActions();
      const sources = registryActions.length
        ? registryActions.map((action) => ({
          value: action.legacy_action || action.action_id,
          label: action.label || formatMemoryAction(action.legacy_action || action.action_id),
        }))
        : Object.entries(MEMORY_ACTION_LABELS)
          .filter(([value]) => value !== "assistant")
          .map(([value, label]) => ({ value, label }));
      const seen = new Set(options.map((item) => item.value));
      for (const source of sources) {
        const value = normalizeActionKey(source.value);
        if (!value || seen.has(value)) continue;
        seen.add(value);
        options.push({
          value,
          label: source.label || formatMemoryAction(value),
        });
      }
      return options;
    }

    function renderMemoryActionOptions() {
      const select = getRef("memoryPreviewAction");
      if (!select || !documentRef) return;
      const current = normalizeActionKey(select.value) || "assistant";
      const options = getMemoryActionOptions();
      const optionNodes = options.map((item) => {
        const option = documentRef.createElement("option");
        option.value = item.value;
        option.textContent = item.label;
        return option;
      });
      select.replaceChildren(...optionNodes);
      select.value = options.some((item) => item.value === current) ? current : options[0]?.value || "assistant";
    }

    function getRegistrySteps() {
      return Array.isArray(actionRegistryPayload?.step_registry) ? actionRegistryPayload.step_registry : [];
    }

    function getRegistryPolicies() {
      return Array.isArray(actionRegistryPayload?.policy_registry) ? actionRegistryPayload.policy_registry : [];
    }

    function getRegistryUiItems() {
      return Array.isArray(actionRegistryPayload?.ui_registry) ? actionRegistryPayload.ui_registry : [];
    }

    function getPolicyById(policyId) {
      return getRegistryPolicies().find((policy) => policy.policy_id === policyId) || null;
    }

    function getUiById(uiId) {
      return getRegistryUiItems().find((item) => item.ui_id === uiId) || null;
    }

    function createMemoryAction(label, action, kind, id, tone = "") {
      const button = createNode("button", `settings-ai-memory-action${tone ? ` is-${tone}` : ""}`, label);
      button.type = "button";
      button.dataset.aiMemoryAction = action;
      button.dataset.aiMemoryKind = kind;
      button.dataset.aiMemoryId = id;
      return button;
    }

    function renderProviderTypeOptions(selectedType = "") {
      const select = getRef("providerType");
      if (!select || !documentRef) return;
      const current = selectedType || select.value || "openai-compatible";
      const options = providerTypes.map((provider) => {
        const option = documentRef.createElement("option");
        option.value = provider.type;
        option.textContent = provider.label || provider.type;
        return option;
      });
      select.replaceChildren(...options);
      select.value = providerTypes.some((provider) => provider.type === current) ? current : providerTypes[0]?.type || "";
    }

    function applyDefinitionDefaults(type, { forceId = false } = {}) {
      const definition = getProviderDefinition(type);
      const providerId = getRef("providerId");
      const baseUrl = getRef("providerBaseUrl");
      const model = getRef("providerModel");
      const contextWindow = getRef("providerContextWindow");
      const inputBudget = getRef("providerInputBudget");
      const env = getRef("providerEnv");
      const enabled = getRef("providerEnabled");

      if (providerId && (forceId || !providerId.value.trim())) providerId.value = definition.type || "";
      if (baseUrl) baseUrl.value = definition.defaultBaseUrl || "";
      if (model) model.value = definition.defaultModel || "";
      if (contextWindow) contextWindow.value = definition.defaultContextWindowTokens || 128000;
      if (inputBudget) inputBudget.value = definition.defaultPreferredInputBudgetTokens || 96000;
      if (env) env.value = Array.isArray(definition.envKeyNames) ? definition.envKeyNames[0] || "" : "";
      if (enabled) enabled.checked = true;
    }

    function populateProviderForm(provider = null) {
      const definition = getProviderDefinition(provider?.type || "openai-compatible");
      renderProviderTypeOptions(definition.type);

      const providerId = getRef("providerId");
      const baseUrl = getRef("providerBaseUrl");
      const model = getRef("providerModel");
      const contextWindow = getRef("providerContextWindow");
      const inputBudget = getRef("providerInputBudget");
      const env = getRef("providerEnv");
      const apiKey = getRef("providerApiKey");
      const enabled = getRef("providerEnabled");

      if (providerId) providerId.value = provider?.id || definition.type || "";
      if (baseUrl) baseUrl.value = provider?.baseUrl || definition.defaultBaseUrl || "";
      if (model) model.value = provider?.model || definition.defaultModel || "";
      if (contextWindow) contextWindow.value = provider?.contextWindowTokens || definition.defaultContextWindowTokens || 128000;
      if (inputBudget) inputBudget.value = provider?.preferredInputBudgetTokens || definition.defaultPreferredInputBudgetTokens || 96000;
      if (env) env.value = provider?.apiKeyEnvName || definition.envKeyNames?.[0] || "";
      if (apiKey) {
        apiKey.value = "";
        apiKey.placeholder = provider?.apiKeyConfigured
          ? `已保存 Key，尾号 ${provider.apiKeyTail || "****"}；留空保持`
          : "留空则不保存本地 Key";
      }
      if (enabled) enabled.checked = provider ? Boolean(provider.enabled) : true;
    }

    function renderProviderSummary() {
      const provider = getActiveProvider();
      const badge = getRef("providerBadge");
      const updated = getRef("providerUpdated");
      const summary = getRef("providerSummary");

      if (!provider) {
        setText(badge, "未配置");
        setTone(badge, "warning");
        setText(updated, "--");
        replaceKvRows(summary, [
          ["当前 Provider", "未配置"],
          ["Key 状态", "未配置"],
          ["能力", "--"],
        ]);
        return;
      }

      setText(badge, provider.enabled ? "Provider 已启用" : "Provider 未启用");
      setTone(badge, provider.enabled ? "success" : "warning");
      setText(updated, provider.updatedAt ? `更新 ${provider.updatedAt.slice(0, 16).replace("T", " ")}` : "--");
      replaceKvRows(summary, [
        ["当前 Provider", `${provider.id || "--"} / ${getProviderLabel(provider)}`],
        ["Key 状态", provider.apiKeyConfigured ? `${provider.apiKeySource || "stored"} · ${provider.apiKeyTail || "****"}` : "未配置"],
        ["模型", provider.model || "--"],
        ["上下文", `${Number(provider.contextWindowTokens || 0).toLocaleString("zh-CN")} tokens`],
        ["本轮输入预算", `${Number(provider.preferredInputBudgetTokens || 0).toLocaleString("zh-CN")} tokens`],
        ["Base URL", provider.baseUrl || "--"],
        ["能力", `${provider.supportsStreaming ? "stream" : "no-stream"} / ${provider.supportsJsonMode ? "json" : "text"}`],
      ]);
    }

    function renderMcpSummary() {
      const badge = getRef("mcpBadge");
      const summary = getRef("mcpSummary");
      const toolsNode = getRef("mcpTools");
      const status = mcpStatusPayload || {};
      const tools = Array.isArray(mcpToolsPayload?.tools) ? mcpToolsPayload.tools : [];
      const data = status.data || {};
      const capabilities = status.mcp?.capabilities || {};
      const dataOk = Boolean(data.todosAvailable || data.busyBlocksAvailable || data.memoryAvailable || data.progressAvailable);

      setText(badge, mcpLoaded ? (dataOk ? "MCP 可用" : "MCP 部分可用") : "MCP 未加载");
      setTone(badge, mcpLoaded ? (dataOk ? "success" : "warning") : "warning");
      replaceKvRows(summary, [
        ["应用", `${status.app?.name || "Guanshi"} ${status.app?.version || ""}`.trim()],
        ["传输", status.mcp?.transport || "stdio-jsonrpc"],
        ["能力", `读 ${capabilities.readOnly ? "开" : "关"} / 草稿 ${capabilities.createDraft ? "开" : "关"} / 应用 ${capabilities.applyDraft ? "开" : "关"}`],
        ["数据", `待办 ${data.todosAvailable ? "可读" : "缺失"} / 记忆 ${data.memoryAvailable ? "可读" : "缺失"}`],
        ["工具", `${tools.length} 个`],
      ]);

      if (!toolsNode || !documentRef) return;
      const visibleTools = tools.slice(0, 10).map((tool) => {
        const item = documentRef.createElement("code");
        item.textContent = tool.name || "";
        return item;
      });
      toolsNode.replaceChildren(...visibleTools);
    }

    function createEmptyActionMessage(message) {
      return createNode("p", "settings-ai-memory-empty", message);
    }

    function createActionRegistryChip(text, tone = "") {
      return createMemoryChip(text, tone);
    }

    function renderActionRegistryItem(action) {
      const item = createNode("article", "settings-ai-action-item");
      const head = createNode("div", "settings-ai-memory-item-head");
      const titleWrap = createNode("div", "settings-ai-memory-title-wrap");
      const title = createNode("strong", "", action.label || action.action_id || "未命名 Action");
      const meta = createNode(
        "small",
        "",
        `${action.action_id || "--"}${action.legacy_action ? ` · ${action.legacy_action}` : ""}`,
      );
      titleWrap.append(title, meta);
      head.append(titleWrap, createActionRegistryChip(formatActionKind(action.action_kind), action.action_kind === "draft" ? "warning" : "success"));

      const intent = createNode("p", "settings-ai-memory-body", action.intent || "暂无说明。");
      const details = createNode("div", "settings-ai-memory-details");
      const policies = normalizeStringList(action.policy_refs || action.policyRefs, 8, 120)
        .map(getPolicyById)
        .filter(Boolean);
      const requiresConfirm = policies.some((policy) => policy.requires_confirmation === true);
      const ui = getUiById(action.ui_ref || action.uiRef);
      details.append(
        createActionRegistryChip(`${normalizeStringList(action.steps, 20, 120).length} 个 Step`),
        createActionRegistryChip(formatActionExecutionMode(action.execution_mode), action.execution_mode === "registry_pipeline" ? "success" : ""),
        createActionRegistryChip(requiresConfirm ? "需确认" : "不写入", requiresConfirm ? "warning" : "success"),
        createActionRegistryChip(ui?.label || action.ui_ref || "无 UI"),
      );
      if (ui?.post_apply_ui?.view) {
        details.append(createActionRegistryChip(`确认后 ${ui.post_apply_ui.view} / ${ui.post_apply_ui.highlight || "不高亮"}`));
      }
      if (action.output_schema) details.append(createActionRegistryChip(action.output_schema));

      const stepList = createNode("div", "settings-ai-action-steps");
      for (const stepId of normalizeStringList(action.steps, 20, 120)) {
        stepList.append(createNode("code", "settings-ai-step-code", stepId));
      }

      item.append(head, intent, details, stepList);
      return item;
    }

    function renderActionStepItem(step) {
      const item = createNode("article", "settings-ai-step-item");
      const head = createNode("div", "settings-ai-memory-item-head");
      const titleWrap = createNode("div", "settings-ai-memory-title-wrap");
      const title = createNode("strong", "", step.label || step.step_id || "未命名 Step");
      const meta = createNode("small", "", step.step_id || "--");
      titleWrap.append(title, meta);
      head.append(titleWrap, createActionRegistryChip(formatStepType(step.type), step.side_effect ? "warning" : "success"));

      const details = createNode("div", "settings-ai-memory-details");
      details.append(
        createActionRegistryChip(step.side_effect ? "有写入风险" : "无直接写入", step.side_effect ? "warning" : "success"),
        createActionRegistryChip(step.retryable === false ? "不可重试" : "可重试"),
      );
      if (step.input_schema) details.append(createActionRegistryChip(`输入 ${step.input_schema}`));
      if (step.output_schema) details.append(createActionRegistryChip(`输出 ${step.output_schema}`));

      item.append(head, details);
      return item;
    }

    function renderActionRegistrySummary() {
      const badge = getRef("actionsBadge");
      const summary = getRef("actionsSummary");
      const actions = getRegistryActions();
      const steps = getRegistrySteps();
      const prompts = Array.isArray(actionRegistryPayload?.prompt_registry) ? actionRegistryPayload.prompt_registry : [];
      const policies = getRegistryPolicies();
      const uiItems = getRegistryUiItems();

      setText(badge, actionsLoaded ? `Action ${actions.length}` : "Action 检测中");
      setTone(badge, actionsLoaded && actions.length ? "success" : "warning");
      setText(
        summary,
        actionsLoaded
          ? `当前模块 ${actionRegistryPayload?.module_id || "time"}：${actions.length} 个 Action，${steps.length} 个 Step，${prompts.length} 个 Prompt，${policies.length} 条 Policy，${uiItems.length} 个 UI 映射。`
          : "正在读取 Action Registry。",
      );
    }

    function renderActionRegistry() {
      renderActionRegistrySummary();
      renderMemoryActionOptions();
      const actionList = getRef("actionList");
      const stepList = getRef("stepList");
      if (!actionList || !stepList || !documentRef) return;
      const actions = getRegistryActions();
      const steps = getRegistrySteps();
      actionList.replaceChildren(
        ...(actions.length
          ? actions.map(renderActionRegistryItem)
          : [createEmptyActionMessage(actionsLoaded ? "暂无 Action Registry。" : "正在读取 Action Registry。")]),
      );
      stepList.replaceChildren(
        ...(steps.length
          ? steps.map(renderActionStepItem)
          : [createEmptyActionMessage(actionsLoaded ? "暂无 Step Registry。" : "正在读取 Step Registry。")]),
      );
    }

    function createEmptyMemoryMessage(message) {
      return createNode("p", "settings-ai-memory-empty", message);
    }

    function renderMemoryListItem(record) {
      const source = record.item || {};
      const id = getMemoryRecordId(record);
      const isSelected = selectedMemoryRef.kind === record.kind && selectedMemoryRef.id === id;
      const status = record.kind === "proposal" ? "pending" : source.status || "disabled";
      const item = createNode("button", `settings-ai-memory-list-item${isSelected ? " is-active" : ""}`);
      item.type = "button";
      item.dataset.status = status;
      item.dataset.aiMemorySelect = "true";
      item.dataset.aiMemoryKind = record.kind;
      item.dataset.aiMemoryId = id;
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", isSelected ? "true" : "false");

      const head = createNode("div", "settings-ai-memory-item-head");
      const titleWrap = createNode("div", "settings-ai-memory-title-wrap");
      const title = createNode("strong", "", source.title || (record.kind === "proposal" ? "未命名提案" : "未命名记忆"));
      const meta = createNode(
        "small",
        "",
        `${formatMemoryType(source.type)} · ${formatMemoryStrength(source.strength)} · ${formatDateTime(source.updatedAt || source.createdAt)}`,
      );
      titleWrap.append(title, meta);
      head.append(titleWrap, createMemoryChip(record.kind === "proposal" ? "待确认" : formatMemoryStatus(source.status), status === "active" ? "success" : "warning"));

      const body = createNode("p", "settings-ai-memory-body", source.body || "无内容。");
      const details = createNode("div", "settings-ai-memory-details");
      details.append(
        createMemoryChip(`场景 ${formatMemoryActionList(source.appliesTo)}`),
        ...createMemoryUseChips(source, record.kind),
      );
      if (source.rule) details.append(createMemoryChip("有结构化规则", "success"));
      if (hasMemoryMatch(source)) details.append(createMemoryChip("有匹配条件", "success"));

      item.append(head, body, details);
      return item;
    }

    function createMemoryDetailField(label, value, options = {}) {
      const field = createNode("div", "settings-ai-memory-detail-field");
      const dt = createNode("dt", "", label);
      const dd = options.pre
        ? createNode("pre", "settings-ai-memory-detail-pre", value || "无")
        : createNode("dd", "", value || "--");
      field.append(dt, dd);
      return field;
    }

    function formatMemoryJson(value) {
      if (!value || typeof value !== "object" || Array.isArray(value)) return "";
      try {
        return JSON.stringify(value, null, 2);
      } catch {
        return "";
      }
    }

    function getMemoryPreviewAction() {
      return normalizeActionKey(getRef("memoryPreviewAction")?.value) || "assistant";
    }

    function setMemoryPreviewAction(action) {
      const select = getRef("memoryPreviewAction");
      const value = normalizeActionKey(action) || "assistant";
      if (select) select.value = value;
      return value;
    }

    function getMemoryEffectRecordKey(record) {
      if (!record) return "";
      return `${record.kind}:${getMemoryRecordId(record)}`;
    }

    function getPreferredMemoryEffectAction(record) {
      const current = getMemoryPreviewAction();
      const source = record?.item || {};
      if (!record || memoryAppliesToAction(source, current)) return current;
      const firstAppliedAction = normalizeStringList(source.appliesTo, 16).map(normalizeActionKey).find(Boolean);
      return firstAppliedAction || current || "assistant";
    }

    function syncMemoryEffectActionForRecord(record) {
      const key = getMemoryEffectRecordKey(record);
      if (key === memoryEffectSelectionKey) return;
      memoryEffectSelectionKey = key;
      setMemoryPreviewAction(getPreferredMemoryEffectAction(record));
    }

    function findMemoryPreviewItem(memory = {}, key = "entries", record = null) {
      if (!record || record.kind !== "entry") return null;
      const memoryId = getMemoryRecordId(record);
      return (Array.isArray(memory[key]) ? memory[key] : []).find((item) => item.memoryId === memoryId) || null;
    }

    function getMemoryEffectBaseReasons(record, action) {
      if (!record) return [];
      if (record.kind === "proposal") return ["待确认", "确认后才会启用"];
      const source = record.item || {};
      const reasons = [];
      if (source.status === "active") reasons.push("已启用");
      if (source.userConfirmed === true) reasons.push("用户已确认");
      if (source.modelReadable !== false) reasons.push("允许 AI 使用");
      reasons.push(memoryAppliesToAction(source, action) ? "场景命中" : "场景不匹配");
      reasons.push(hasMemoryMatch(source) ? "有匹配条件" : "无匹配限制");
      return reasons;
    }

    function getMemoryEffectState(record, memory = null) {
      const action = getMemoryPreviewAction();
      const actionLabel = formatMemoryAction(action);
      if (!record) {
        return {
          tone: "neutral",
          title: "先选择一条记忆",
          message: "从左侧列表选择一条记忆后，再检查它在某个场景是否会进入 AI。",
          reasons: [],
        };
      }

      const source = record.item || {};
      const reasons = getMemoryEffectBaseReasons(record, action);
      const note = hasMemoryMatch(source)
        ? "带匹配条件的记忆在真实对话里还会结合用户输入、选中对象和页面上下文判断。"
        : "";

      if (record.kind === "proposal") {
        return {
          tone: "warning",
          title: "不会注入",
          message: "这还是待确认提案，确认后才可能进入 AI。",
          reasons,
        };
      }
      if (memoryConfig?.enabled === false) {
        return {
          tone: "warning",
          title: "不会注入",
          message: "记忆功能当前关闭。",
          reasons: ["记忆关闭", ...reasons],
          note,
        };
      }
      if (memoryConfig?.autoInject === false) {
        return {
          tone: "warning",
          title: "不会注入",
          message: "自动注入当前关闭。",
          reasons: ["自动注入关闭", ...reasons],
          note,
        };
      }
      if (source.status !== "active") {
        return {
          tone: "warning",
          title: "不会注入",
          message: "这条记忆已经停用，只保留在本地管理列表中。",
          reasons,
        };
      }
      if (source.userConfirmed !== true) {
        return {
          tone: "warning",
          title: "不会注入",
          message: "这条记忆还没有用户确认。",
          reasons,
        };
      }
      if (!canEnterModelContext(source)) {
        return {
          tone: "warning",
          title: "不会注入",
          message: source.modelReadable === false ? "这条记忆已禁止 AI 使用。" : "这个类型默认不进入模型上下文。",
          reasons,
        };
      }
      if (!memoryAppliesToAction(source, action)) {
        return {
          tone: "warning",
          title: "不会注入",
          message: `这条记忆不适用于「${actionLabel}」。`,
          reasons,
        };
      }

      if (memory) {
        const included = findMemoryPreviewItem(memory, "entries", record);
        const excluded = findMemoryPreviewItem(memory, "excluded", record);
        const includedCount = Array.isArray(memory.entries) ? memory.entries.length : 0;
        const excludedCount = Array.isArray(memory.excluded) ? memory.excluded.length : 0;
        if (included) {
          return {
            tone: "success",
            title: "会进入 AI",
            message: `在「${actionLabel}」场景会作为已确认记忆注入。`,
            reasons,
            counts: `同场景注入 ${includedCount} 条，未注入 ${excludedCount} 条`,
            note,
          };
        }
        if (excluded) {
          return {
            tone: "warning",
            title: "不会注入",
            message: formatMemoryExclusionReason(excluded.reason),
            reasons,
            counts: `同场景注入 ${includedCount} 条，未注入 ${excludedCount} 条`,
            note,
          };
        }
        return {
          tone: "warning",
          title: "本次结果未包含",
          message: "这条记忆没有出现在本次注入结果中，可能被数量上限或匹配策略排除。",
          reasons,
          counts: `同场景注入 ${includedCount} 条，未注入 ${excludedCount} 条`,
          note,
        };
      }

      return {
        tone: hasMemoryMatch(source) ? "warning" : "neutral",
        title: hasMemoryMatch(source) ? "需要结合本轮内容判断" : "可能进入 AI",
        message: `当前状态允许它进入「${actionLabel}」；点击“检查”可查看本次注入结果。`,
        reasons,
        note,
      };
    }

    function renderMemoryEffectCheck(record, memory = null, rawBody = "") {
      renderMemoryActionOptions();
      syncMemoryEffectActionForRecord(record);
      const summary = getRef("memoryPreviewSummary");
      const previewBody = getRef("memoryPreviewBody");
      if (!summary || !documentRef) return;

      const state = getMemoryEffectState(record, memory);
      const card = createNode("div", `settings-ai-memory-effect-card is-${state.tone || "neutral"}`);
      card.append(
        createNode("strong", "settings-ai-memory-effect-result", state.title),
        createNode("p", "settings-ai-memory-effect-message", state.message),
      );
      if (state.reasons?.length) {
        const reasons = createNode("div", "settings-ai-memory-effect-reasons");
        for (const reason of state.reasons.slice(0, 8)) {
          reasons.append(createMemoryChip(reason, state.tone === "success" ? "success" : "warning"));
        }
        card.append(reasons);
      }
      if (state.counts) card.append(createNode("small", "settings-ai-memory-effect-counts", state.counts));
      if (state.note) card.append(createNode("small", "settings-ai-memory-effect-note", state.note));
      summary.hidden = false;
      summary.replaceChildren(card);

      if (previewBody) {
        previewBody.textContent = rawBody || "";
        previewBody.hidden = !rawBody;
      }
    }

    function renderMemoryDetail(record) {
      const detail = getRef("memoryDetail");
      if (!detail || !documentRef) return;
      if (!record) {
        detail.replaceChildren(createEmptyMemoryMessage(memoryLoaded ? "当前状态下没有记忆。" : "正在读取记忆。"));
        renderMemoryEffectCheck(null);
        return;
      }

      const source = record.item || {};
      const id = getMemoryRecordId(record);
      const status = record.kind === "proposal" ? "pending_confirmation" : source.status || "disabled";
      const head = createNode("div", "settings-ai-memory-detail-head");
      const titleWrap = createNode("div", "settings-ai-memory-title-wrap");
      titleWrap.append(
        createNode("strong", "", source.title || (record.kind === "proposal" ? "未命名提案" : "未命名记忆")),
        createNode("small", "", record.kind === "proposal" ? `提案 ${id}` : `记忆 ${id}`),
      );
      head.append(titleWrap, createMemoryChip(record.kind === "proposal" ? "待确认" : formatMemoryStatus(source.status), status === "active" ? "success" : "warning"));

      const body = createNode("p", "settings-ai-memory-detail-body", source.body || "无内容。");
      const details = createNode("dl", "settings-ai-memory-detail-grid");
      const modelText = canEnterModelContext(source) ? "允许进入模型上下文" : "默认不进入模型上下文";
      const engineText = canProjectMemoryToEngine(source)
        ? "当前场景存在可执行本地规则"
        : getMemoryRuleKind(source)
          ? source.engineReadable === true ? "可供 AI 使用；当前版本暂无对应本地执行器" : "可供 AI 使用；未授权本地自动执行"
          : "仅供 AI 参考";
      const evidence = source.evidence && typeof source.evidence === "object" ? source.evidence : {};
      const createdBy = source.createdBy && typeof source.createdBy === "object" ? source.createdBy : {};
      const healthItem = Array.isArray(memoryHealth?.items)
        ? memoryHealth.items.find((item) => item.memoryId === source.id)
        : null;
      const repairSuggestion = Array.isArray(memoryHealth?.repairPlan?.suggestions)
        ? memoryHealth.repairPlan.suggestions.find((item) => normalizeStringList(item.memoryIds, 24).includes(source.id))
        : null;
      details.append(
        createMemoryDetailField("类型", formatMemoryType(source.type)),
        createMemoryDetailField("强度", formatMemoryStrength(source.strength)),
        createMemoryDetailField("状态", record.kind === "proposal" ? "待确认" : formatMemoryStatus(source.status)),
        createMemoryDetailField("适用场景", formatMemoryActionList(source.appliesTo)),
        createMemoryDetailField("主题标识", source.subjectKey || "--"),
        createMemoryDetailField("匹配方式", source.matchMode === "all" ? "全部命中" : source.matchMode === "any" ? "任一命中" : "无条件"),
        createMemoryDetailField("模型使用", modelText),
        createMemoryDetailField("引擎使用", engineText),
        createMemoryDetailField("创建来源", createdBy.name || createdBy.kind || evidence.source || "--"),
        createMemoryDetailField("更新时间", formatDateTime(source.updatedAt || source.createdAt)),
      );
      if (source.validFrom || source.validUntil) details.append(createMemoryDetailField("有效期", `${source.validFrom || "现在"} 至 ${source.validUntil || "长期"}`));
      if (source.reviewAfter) details.append(createMemoryDetailField("复核日期", source.reviewAfter));
      if (source.confidence !== null && source.confidence !== undefined) details.append(createMemoryDetailField("可信度", String(source.confidence)));
      if (healthItem?.issues?.length) {
        const issueLabels = {
          subject_conflict: "与其他已启用记忆冲突",
          subject_duplicate: "存在内容重复的已启用记忆",
          review_due: "已到复核日期",
          validity_expired: "已超过有效期",
          legacy_subject_missing: "旧格式缺少主题标识",
          legacy_capability_request: "旧版能力需求记录",
        };
        details.append(createMemoryDetailField("需要检查", healthItem.issues.map((issue) => issueLabels[issue] || issue).join("、")));
      }
      if (repairSuggestion?.titles?.length) {
        details.append(createMemoryDetailField("关联的冲突记忆", repairSuggestion.titles.join("、")));
      }
      if (evidence.quote) details.append(createMemoryDetailField("证据", evidence.quote));
      if (source.relation?.kind && source.relation.kind !== "unique") {
        details.append(createMemoryDetailField("与现有记忆关系", source.relation.kind));
        const relatedItems = Array.isArray(source.relation.relatedMemories) ? source.relation.relatedMemories : [];
        const relatedLabels = relatedItems.length
          ? relatedItems.map((item) => item.title || item.id).filter(Boolean)
          : normalizeStringList(source.relation.relatedMemoryIds, 24);
        if (relatedLabels.length) details.append(createMemoryDetailField("涉及的原记忆", relatedLabels.join("、")));
      }
      details.append(
        createMemoryDetailField("匹配条件", formatMemoryJson(source.match), { pre: true }),
        createMemoryDetailField("结构化规则", formatMemoryJson(source.rule), { pre: true }),
      );

      const actions = createNode("div", "settings-ai-memory-actions settings-ai-memory-detail-actions");
      if (record.kind === "proposal") {
        if (source.type === "capability_request") {
          actions.append(createMemoryAction("删除旧提案", "reject", "proposal", id, "danger"));
        } else {
          const relatedCount = normalizeStringList(source.relation?.relatedMemoryIds, 24).length;
          const confirmLabel = source.relation?.kind === "conflict" ? `合并并更新 ${relatedCount || "多"} 条` : "确认";
          actions.append(
            createMemoryAction(confirmLabel, "confirm", "proposal", id, "primary"),
            createMemoryAction("编辑", "edit", "proposal", id),
            createMemoryAction("拒绝", "reject", "proposal", id, "danger"),
          );
        }
      } else {
        if (source.type !== "capability_request") actions.append(createMemoryAction("编辑", "edit", "entry", id));
        if (source.status === "active") {
          actions.append(createMemoryAction("停用", "disable", "entry", id));
        } else {
          actions.append(createMemoryAction("启用", "restore", "entry", id, "primary"));
        }
        actions.append(createMemoryAction("删除", "delete", "entry", id, "danger"));
      }

      detail.replaceChildren(head, body, details, actions);
      renderMemoryEffectCheck(record);
    }

    function renderMemorySummary() {
      const badge = getRef("memoryBadge");
      const summary = getRef("memorySummary");
      const counts = getMemoryStatusCounts();
      const injectText = memoryConfig?.enabled === false
        ? "记忆关闭"
        : memoryConfig?.autoInject === false
          ? "自动注入关闭"
          : "自动注入开启";

      setText(badge, memoryLoaded ? `记忆 ${counts.active}/${counts.pending}` : "记忆检测中");
      setTone(badge, memoryLoaded ? (counts.active || counts.pending ? "success" : "warning") : "warning");
      const healthText = memoryHealth?.issueCount ? `；${memoryHealth.issueCount} 条关系或内容需要检查` : "";
      const capabilityText = memoryHealth?.capabilityCount ? `；${memoryHealth.capabilityCount} 条仅由 AI 使用` : "";
      setText(summary, `已启用 ${counts.active} 条，已停用 ${counts.disabled} 条，待确认 ${counts.pending} 条；${injectText}${healthText}${capabilityText}。`);
    }

    function renderMemoryStatusTabs() {
      const counts = getMemoryStatusCounts();
      for (const filter of Object.keys(MEMORY_STATUS_FILTERS)) {
        const button = getMemoryStatusButton(filter);
        if (!button) continue;
        const active = filter === memoryStatusFilter;
        setText(button, `${MEMORY_STATUS_FILTERS[filter].label} ${counts[filter] || 0}`);
        button.dataset.aiMemoryStatusTab = filter;
        button.classList?.toggle("is-active", active);
        button.setAttribute("aria-selected", active ? "true" : "false");
        button.setAttribute("tabindex", active ? "0" : "-1");
      }
    }

    function renderMemoryLists() {
      const list = getRef("memoryList");
      if (!list || !documentRef) return;

      memoryStatusFilter = normalizeMemoryStatusFilter(memoryStatusFilter);
      renderMemoryStatusTabs();
      setText(getRef("memoryListTitle"), MEMORY_STATUS_FILTERS[memoryStatusFilter].label);
      setText(getRef("memoryListHint"), MEMORY_STATUS_FILTERS[memoryStatusFilter].hint);

      const records = getMemoryRecords();
      const selectedRecord = getSelectedMemoryRecord();
      list.replaceChildren(
        ...(records.length
          ? records.map(renderMemoryListItem)
          : [createEmptyMemoryMessage(memoryLoaded ? MEMORY_STATUS_FILTERS[memoryStatusFilter].empty : MEMORY_STATUS_FILTERS[memoryStatusFilter].loading)]),
      );
      renderMemoryDetail(selectedRecord);
    }

    function renderMemory() {
      renderMemorySummary();
      renderMemoryLists();
    }

    function render() {
      renderProviderSummary();
      renderMcpSummary();
      renderActionRegistry();
      renderMemory();
    }

    async function requestJson(url, options = {}) {
      if (!fetchFn) throw new Error("当前运行环境不支持 fetch。");
      const response = await fetchFn(url, {
        ...options,
        headers: {
          ...(options.headers || {}),
          ...(options.body ? { "Content-Type": "application/json" } : {}),
        },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok === false) {
        throw new Error(payload?.message || payload?.error || `请求失败：${response.status}`);
      }
      return payload.result ?? payload;
    }

    async function loadProviderConfig({ manual = false } = {}) {
      if (loadingProvider) return;
      loadingProvider = true;
      const testBtn = getRef("providerTestBtn");
      setBusy(testBtn, true);
      try {
        const result = await requestJson("/api/ai/providers");
        providerTypes = Array.isArray(result.providerTypes) && result.providerTypes.length
          ? result.providerTypes
          : [...DEFAULT_PROVIDER_TYPES];
        providerConfig = result.config || null;
        providerLoaded = true;
        populateProviderForm(getActiveProvider());
        renderProviderSummary();
        if (manual) setStatus(getRef("providerStatus"), "Provider 配置已刷新。", "success");
      } catch (error) {
        setStatus(getRef("providerStatus"), error instanceof Error ? error.message : "Provider 配置读取失败。", "danger");
      } finally {
        loadingProvider = false;
        setBusy(testBtn, false);
      }
    }

    function getProviderFormPayload() {
      const type = normalizeText(getRef("providerType")?.value, 80) || "openai-compatible";
      const id = normalizeText(getRef("providerId")?.value, 80) || type;
      const apiKey = normalizeText(getRef("providerApiKey")?.value, 500);
      const provider = {
        id,
        type,
        enabled: Boolean(getRef("providerEnabled")?.checked),
        baseUrl: normalizeText(getRef("providerBaseUrl")?.value, 500),
        model: normalizeText(getRef("providerModel")?.value, 160),
        contextWindowTokens: Math.max(8192, Math.min(2000000, Number.parseInt(String(getRef("providerContextWindow")?.value || 128000), 10) || 128000)),
        preferredInputBudgetTokens: Math.max(4096, Number.parseInt(String(getRef("providerInputBudget")?.value || 96000), 10) || 96000),
        apiKeyEnvName: normalizeText(getRef("providerEnv")?.value, 100),
      };
      provider.preferredInputBudgetTokens = Math.min(provider.preferredInputBudgetTokens, provider.contextWindowTokens - 4096);
      if (apiKey) provider.apiKey = apiKey;
      return {
        providerId: id,
        payload: {
          activeProviderId: id,
          providers: {
            [id]: provider,
          },
        },
      };
    }

    async function saveProvider({ quiet = false } = {}) {
      const saveBtn = getRef("providerSaveBtn");
      setBusy(saveBtn, true);
      try {
        const { providerId, payload } = getProviderFormPayload();
        providerConfig = await requestJson("/api/ai/config", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        providerLoaded = true;
        populateProviderForm(getActiveProvider());
        renderProviderSummary();
        if (!quiet) setStatus(getRef("providerStatus"), "Provider 已保存。", "success");
        return providerId;
      } catch (error) {
        setStatus(getRef("providerStatus"), error instanceof Error ? error.message : "Provider 保存失败。", "danger");
        throw error;
      } finally {
        setBusy(saveBtn, false);
      }
    }

    async function testProvider({ network = false } = {}) {
      const testBtn = network ? getRef("providerNetworkTestBtn") : getRef("providerTestBtn");
      setBusy(testBtn, true);
      try {
        const providerId = await saveProvider({ quiet: true });
        const result = await requestJson("/api/ai/providers/test", {
          method: "POST",
          body: JSON.stringify({ providerId, network }),
        });
        const diagnostics = Array.isArray(result.diagnostics) ? result.diagnostics : [];
        const details = diagnostics.map((item) => item.message).filter(Boolean).join("；");
        const tone = result.ok ? "success" : "warning";
        setStatus(
          getRef("providerStatus"),
          `${network ? "网络测试" : "本地校验"}${result.ok ? "通过" : "未通过"}${details ? `：${details}` : "。"}`,
          tone,
        );
      } catch (error) {
        setStatus(getRef("providerStatus"), error instanceof Error ? error.message : "Provider 测试失败。", "danger");
      } finally {
        setBusy(testBtn, false);
      }
    }

    function extractMcpStructuredContent(result) {
      if (result?.structuredContent && typeof result.structuredContent === "object") return result.structuredContent;
      const text = result?.content?.[0]?.text;
      if (typeof text === "string") {
        try {
          return JSON.parse(text);
        } catch {
          return {};
        }
      }
      return result && typeof result === "object" ? result : {};
    }

    async function loadMcpStatus({ manual = false } = {}) {
      if (loadingMcp) return;
      loadingMcp = true;
      const refreshBtn = getRef("mcpRefreshBtn");
      setBusy(refreshBtn, true);
      try {
        const [statusResult, toolsResult] = await Promise.all([
          requestJson("/api/ai/mcp/status"),
          requestJson("/api/ai/mcp/tools"),
        ]);
        mcpStatusPayload = extractMcpStructuredContent(statusResult);
        mcpToolsPayload = toolsResult || {};
        mcpLoaded = true;
        renderMcpSummary();
        setStatus(getRef("mcpStatus"), manual ? "MCP 状态已刷新。" : "", manual ? "success" : "normal");
      } catch (error) {
        setStatus(getRef("mcpStatus"), error instanceof Error ? error.message : "MCP 状态读取失败。", "danger");
      } finally {
        loadingMcp = false;
        setBusy(refreshBtn, false);
      }
    }

    async function loadActionRegistry({ manual = false } = {}) {
      if (loadingActions) return;
      loadingActions = true;
      const refreshBtn = getRef("actionsRefreshBtn");
      setBusy(refreshBtn, true);
      try {
        actionRegistryPayload = await requestJson("/api/ai/action-registry?module=time");
        actionsLoaded = true;
        renderActionRegistry();
        if (manual) setStatus(getRef("actionsStatus"), "Action Registry 已刷新。", "success");
      } catch (error) {
        setStatus(getRef("actionsStatus"), error instanceof Error ? error.message : "Action Registry 读取失败。", "danger");
      } finally {
        loadingActions = false;
        setBusy(refreshBtn, false);
      }
    }

    async function loadMemory({ manual = false } = {}) {
      if (loadingMemory) return;
      loadingMemory = true;
      const refreshBtn = getRef("memoryRefreshBtn");
      setBusy(refreshBtn, true);
      try {
        const [memoryResult, proposalResult, healthResult, registryResult] = await Promise.all([
          requestJson("/api/ai/memory"),
          requestJson("/api/ai/memory/proposals?status=pending_confirmation"),
          requestJson("/api/ai/memory/health"),
          requestJson("/api/ai/memory/rule-registry"),
        ]);
        memoryEntries = Array.isArray(memoryResult.entries) ? memoryResult.entries : [];
        memoryConfig = memoryResult.config || null;
        memoryProposals = Array.isArray(proposalResult.proposals) ? proposalResult.proposals : [];
        memoryHealth = healthResult || null;
        memoryRuleRegistry = registryResult || null;
        memoryLoaded = true;
        renderMemory();
        if (manual) setStatus(getRef("memoryStatus"), "AI 记忆已刷新。", "success");
      } catch (error) {
        setStatus(getRef("memoryStatus"), error instanceof Error ? error.message : "AI 记忆读取失败。", "danger");
      } finally {
        loadingMemory = false;
        setBusy(refreshBtn, false);
      }
    }

    function setMemoryEditorVisible(visible) {
      const editor = getRef("memoryEditor");
      if (!editor) return;
      editor.hidden = !visible;
    }

    function setMemoryEditorMode(mode, id = "") {
      memoryEditorState = { mode, id };
      const isEntry = mode === "entry";
      const isProposal = mode === "proposal";
      setText(getRef("memoryEditorTitle"), isEntry ? "编辑正式记忆" : isProposal ? "编辑待确认提案" : "新增记忆");
      setText(
        getRef("memoryEditorHint"),
        isEntry ? "保存后立即更新这条本地记忆。" : "保存后会留在待确认区，确认后才会启用。",
      );
      const saveBtn = getRef("memorySaveBtn");
      if (saveBtn) saveBtn.textContent = isEntry ? "保存修改" : isProposal ? "更新提案" : "保存为待确认";
      const typeSelect = getRef("memoryTypeSelect");
      if (typeSelect) typeSelect.disabled = isEntry;
    }

    function setMemoryEditorValues(source = {}) {
      const type = normalizeText(source.type || "principle", 40);
      const modelReadableDefault = type !== "review";
      const engineReadableDefault = false;
      const titleInput = getRef("memoryTitleInput");
      const typeSelect = getRef("memoryTypeSelect");
      const strengthSelect = getRef("memoryStrengthSelect");
      const appliesInput = getRef("memoryAppliesInput");
      const bodyInput = getRef("memoryBodyInput");
      const subjectInput = getRef("memorySubjectInput");
      const matchModeSelect = getRef("memoryMatchModeSelect");
      const confidenceInput = getRef("memoryConfidenceInput");
      const matchInput = getRef("memoryMatchInput");
      const ruleInput = getRef("memoryRuleInput");
      const validFromInput = getRef("memoryValidFromInput");
      const validUntilInput = getRef("memoryValidUntilInput");
      const reviewAfterInput = getRef("memoryReviewAfterInput");
      const modelReadable = getRef("memoryModelReadable");
      const engineReadable = getRef("memoryEngineReadable");

      if (titleInput) titleInput.value = source.title || "";
      if (typeSelect) typeSelect.value = MEMORY_TYPE_LABELS[type] ? type : "principle";
      if (strengthSelect) strengthSelect.value = source.strength || "soft";
      if (appliesInput) appliesInput.value = formatList(source.appliesTo || DEFAULT_MEMORY_APPLIES_TO);
      if (bodyInput) bodyInput.value = source.body || "";
      if (subjectInput) subjectInput.value = source.subjectKey || "";
      if (matchModeSelect) matchModeSelect.value = source.matchMode || (hasMemoryMatch(source) ? "any" : "global");
      if (confidenceInput) confidenceInput.value = source.confidence === null || source.confidence === undefined ? "" : String(source.confidence);
      if (matchInput) matchInput.value = hasMemoryMatch(source) ? JSON.stringify(source.match, null, 2) : "";
      if (ruleInput) ruleInput.value = source.rule ? JSON.stringify(source.rule, null, 2) : "";
      if (validFromInput) validFromInput.value = normalizeText(source.validFrom, 10);
      if (validUntilInput) validUntilInput.value = normalizeText(source.validUntil, 10);
      if (reviewAfterInput) reviewAfterInput.value = normalizeText(source.reviewAfter, 10);
      if (modelReadable) modelReadable.checked = source.modelReadable === undefined ? modelReadableDefault : source.modelReadable !== false;
      if (engineReadable) engineReadable.checked = source.engineReadable === undefined ? engineReadableDefault : source.engineReadable !== false;
    }

    function openNewMemoryEditor() {
      setMemoryEditorMode("new", "");
      setMemoryEditorValues({
        type: "principle",
        strength: "soft",
        appliesTo: DEFAULT_MEMORY_APPLIES_TO,
        modelReadable: true,
        engineReadable: false,
      });
      setMemoryEditorVisible(true);
      getRef("memoryTitleInput")?.focus?.();
      setStatus(getRef("memoryStatus"), "填写后会先保存为待确认提案。", "normal");
    }

    function openEntryEditor(entry) {
      if (!entry) return;
      setMemoryEditorMode("entry", entry.id);
      setMemoryEditorValues(entry);
      setMemoryEditorVisible(true);
      getRef("memoryTitleInput")?.focus?.();
    }

    function openProposalEditor(proposal) {
      if (!proposal) return;
      setMemoryEditorMode("proposal", proposal.proposalId);
      setMemoryEditorValues(proposal);
      setMemoryEditorVisible(true);
      getRef("memoryTitleInput")?.focus?.();
    }

    function closeMemoryEditor() {
      setMemoryEditorVisible(false);
      memoryEditorState = { mode: "new", id: "" };
    }

    function parseMemoryRuleInput() {
      const raw = normalizeText(getRef("memoryRuleInput")?.value, 4000);
      if (!raw) return null;
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error("结构化规则 JSON 格式不正确。");
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("结构化规则必须是 JSON 对象。");
      }
      return parsed;
    }

    function parseMemoryMatchInput() {
      const raw = normalizeText(getRef("memoryMatchInput")?.value, 4000);
      if (!raw) return {};
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error("匹配条件 JSON 格式不正确。");
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("匹配条件必须是 JSON 对象。");
      }
      return parsed;
    }

    function getMemoryEditorPayload() {
      const title = normalizeText(getRef("memoryTitleInput")?.value, 160);
      const body = normalizeText(getRef("memoryBodyInput")?.value, 4000);
      if (!title) {
        getRef("memoryTitleInput")?.focus?.();
        throw new Error("请填写记忆标题。");
      }
      if (!body) {
        getRef("memoryBodyInput")?.focus?.();
        throw new Error("请填写记忆内容。");
      }
      const confidenceRaw = normalizeText(getRef("memoryConfidenceInput")?.value, 20);
      const confidence = confidenceRaw === "" ? null : Number(confidenceRaw);
      if (confidence !== null && (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)) {
        throw new Error("可信度必须是 0 到 1 之间的数字。");
      }
      const match = parseMemoryMatchInput();
      const requestedMatchMode = normalizeText(getRef("memoryMatchModeSelect")?.value, 40) || "global";
      const matchMode = requestedMatchMode === "global" && Object.keys(match).length ? "any" : requestedMatchMode;
      return {
        title,
        body,
        type: normalizeText(getRef("memoryTypeSelect")?.value, 40) || "principle",
        strength: normalizeText(getRef("memoryStrengthSelect")?.value, 40) || "soft",
        appliesTo: normalizeStringList(getRef("memoryAppliesInput")?.value, 16),
        subjectKey: normalizeText(getRef("memorySubjectInput")?.value, 160),
        modelReadable: Boolean(getRef("memoryModelReadable")?.checked),
        engineReadable: Boolean(getRef("memoryEngineReadable")?.checked),
        matchMode,
        match,
        rule: parseMemoryRuleInput(),
        validFrom: normalizeText(getRef("memoryValidFromInput")?.value, 40),
        validUntil: normalizeText(getRef("memoryValidUntilInput")?.value, 40),
        reviewAfter: normalizeText(getRef("memoryReviewAfterInput")?.value, 40),
        confidence,
      };
    }

    function buildMemoryProposalPayload(payload) {
      const existing = memoryEditorState.mode === "proposal" ? getProposalById(memoryEditorState.id) : null;
      const now = new Date().toISOString();
      const proposalId = existing?.proposalId || `proposal_settings_${Date.now()}`;
      return {
        schema: "guanshi-ai-memory-proposal-v1",
        proposalId,
        status: "pending_confirmation",
        type: payload.type,
        title: payload.title,
        body: payload.body,
        strength: payload.strength,
        appliesTo: payload.appliesTo,
        subjectKey: payload.subjectKey,
        modelReadable: payload.modelReadable,
        engineReadable: payload.engineReadable,
        matchMode: payload.matchMode,
        match: payload.match,
        rule: payload.rule,
        validFrom: payload.validFrom,
        validUntil: payload.validUntil,
        reviewAfter: payload.reviewAfter,
        confidence: payload.confidence,
        evidence: existing?.evidence || {
          source: "settings_memory_editor",
          quote: payload.body.slice(0, 240),
          date: now.slice(0, 10),
        },
        createdBy: existing?.createdBy || {
          kind: "user_manual",
          name: "settings",
        },
        createdAt: existing?.createdAt || now,
      };
    }

    async function saveMemoryEditor() {
      const saveBtn = getRef("memorySaveBtn");
      setBusy(saveBtn, true);
      try {
        const payload = getMemoryEditorPayload();
        if (memoryEditorState.mode === "entry") {
          await requestJson(`/api/ai/memory/${encodeURIComponent(memoryEditorState.id)}`, {
            method: "PATCH",
            body: JSON.stringify({
              title: payload.title,
              body: payload.body,
              strength: payload.strength,
              appliesTo: payload.appliesTo,
              subjectKey: payload.subjectKey,
              modelReadable: payload.modelReadable,
              engineReadable: payload.engineReadable,
              matchMode: payload.matchMode,
              match: payload.match,
              rule: payload.rule,
              validFrom: payload.validFrom,
              validUntil: payload.validUntil,
              reviewAfter: payload.reviewAfter,
              confidence: payload.confidence,
            }),
          });
          selectedMemoryRef = { kind: "entry", id: memoryEditorState.id };
          setStatus(getRef("memoryStatus"), "正式记忆已更新。", "success");
        } else {
          const proposalPayload = buildMemoryProposalPayload(payload);
          await requestJson("/api/ai/memory/proposals", {
            method: "POST",
            body: JSON.stringify(proposalPayload),
          });
          memoryStatusFilter = "pending";
          selectedMemoryRef = { kind: "proposal", id: proposalPayload.proposalId };
          setStatus(getRef("memoryStatus"), memoryEditorState.mode === "proposal" ? "记忆提案已更新。" : "已保存为待确认记忆提案。", "success");
        }
        closeMemoryEditor();
        await loadMemory();
      } catch (error) {
        setStatus(getRef("memoryStatus"), error instanceof Error ? error.message : "记忆保存失败。", "danger");
      } finally {
        setBusy(saveBtn, false);
      }
    }

    async function handleEntryAction(action, memoryId) {
      const entry = getMemoryById(memoryId);
      if (!entry) return;
      if (action === "edit") {
        openEntryEditor(entry);
        return;
      }
      if (action === "delete" && !confirmFn(`永久删除「${entry.title || "这条记忆"}」吗？删除后不会再进入 AI 上下文。`)) {
        return;
      }
      const path = `/api/ai/memory/${encodeURIComponent(memoryId)}`;
      if (action === "disable") {
        await requestJson(`${path}/disable`, { method: "POST" });
        memoryStatusFilter = "disabled";
        selectedMemoryRef = { kind: "entry", id: memoryId };
        setStatus(getRef("memoryStatus"), "记忆已停用。", "success");
      } else if (action === "restore") {
        await requestJson(`${path}/restore`, { method: "POST" });
        memoryStatusFilter = "active";
        selectedMemoryRef = { kind: "entry", id: memoryId };
        setStatus(getRef("memoryStatus"), "记忆已启用。", "success");
      } else if (action === "delete") {
        await requestJson(path, {
          method: "DELETE",
          body: JSON.stringify({ permanent: true }),
        });
        selectedMemoryRef = { kind: "", id: "" };
        setStatus(getRef("memoryStatus"), "记忆已删除。", "success");
      }
      await loadMemory();
    }

    async function handleProposalAction(action, proposalId) {
      const proposal = getProposalById(proposalId);
      if (!proposal) return;
      if (action === "edit") {
        openProposalEditor(proposal);
        return;
      }
      const path = `/api/ai/memory/proposals/${encodeURIComponent(proposalId)}`;
      if (action === "confirm") {
        const relation = proposal.relation && typeof proposal.relation === "object" ? proposal.relation : {};
        const replaceTargets = relation.kind === "conflict" ? normalizeStringList(relation.relatedMemoryIds, 24) : [];
        if (relation.kind === "unresolved_update") {
          setStatus(getRef("memoryStatus"), "未找到要更新的原记忆，请先编辑提案并选择正确主题。", "error");
          return;
        }
        if (replaceTargets.length && !confirmFn(`这条提案与 ${replaceTargets.length} 条现有记忆冲突。确认后会合并为一个版本，其余版本停用并保留归档，是否继续？`)) {
          return;
        }
        const result = await requestJson(`${path}/confirm`, {
          method: "POST",
          body: JSON.stringify({
            confirmedBy: "settings",
            resolution: replaceTargets.length ? { mode: "replace_existing", targetMemoryIds: replaceTargets } : undefined,
          }),
        });
        memoryStatusFilter = "active";
        selectedMemoryRef = { kind: "entry", id: result.entry?.id || "" };
        setStatus(
          getRef("memoryStatus"),
          relation.kind === "update"
            ? "原记忆已更新，旧版本已归档。"
            : replaceTargets.length
              ? `已合并并更新 ${replaceTargets.length} 条相关记忆，旧版本已归档。`
              : "记忆提案已确认并启用。",
          "success",
        );
      } else if (action === "reject") {
        await requestJson(`${path}/reject`, {
          method: "POST",
          body: JSON.stringify({ rejectedBy: "settings" }),
        });
        selectedMemoryRef = { kind: "", id: "" };
        setStatus(getRef("memoryStatus"), "记忆提案已拒绝。", "success");
      }
      await loadMemory();
    }

    async function handleMemoryActionClick(event) {
      const button = event.target?.closest?.("[data-ai-memory-action][data-ai-memory-id]");
      if (!button || loadingMemory) return;
      const action = button.dataset.aiMemoryAction || "";
      const kind = button.dataset.aiMemoryKind || "";
      const id = button.dataset.aiMemoryId || "";
      setBusy(button, true);
      try {
        if (kind === "entry") await handleEntryAction(action, id);
        if (kind === "proposal") await handleProposalAction(action, id);
      } catch (error) {
        setStatus(getRef("memoryStatus"), error instanceof Error ? error.message : "记忆操作失败。", "danger");
      } finally {
        setBusy(button, false);
      }
    }

    function handleMemoryListClick(event) {
      const button = event.target?.closest?.("[data-ai-memory-select][data-ai-memory-id]");
      if (!button) return;
      setSelectedMemoryRecord(button.dataset.aiMemoryKind || "", button.dataset.aiMemoryId || "");
    }

    function getMemoryStatusTabs() {
      return [
        getRef("memoryStatusActiveBtn"),
        getRef("memoryStatusPendingBtn"),
        getRef("memoryStatusDisabledBtn"),
      ].filter(Boolean);
    }

    function handleMemoryStatusTabClick(event) {
      const button = event.currentTarget || event.target?.closest?.("[data-ai-memory-status-tab]");
      if (!button) return;
      setMemoryStatusFilter(button.dataset.aiMemoryStatusTab || "");
    }

    function handleMemoryStatusTabKeydown(event) {
      const key = String(event?.key || "");
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(key)) return;
      const tabs = getMemoryStatusTabs();
      if (!tabs.length) return;
      const currentIndex = Math.max(0, tabs.indexOf(event.currentTarget));
      let nextIndex = currentIndex;
      if (key === "Home") nextIndex = 0;
      if (key === "End") nextIndex = tabs.length - 1;
      if (key === "ArrowLeft") nextIndex = (currentIndex + tabs.length - 1) % tabs.length;
      if (key === "ArrowRight") nextIndex = (currentIndex + 1) % tabs.length;
      event.preventDefault?.();
      const next = tabs[nextIndex];
      setMemoryStatusFilter(next?.dataset?.aiMemoryStatusTab || "");
      next?.focus?.();
    }

    async function loadMemoryPreview() {
      const previewBtn = getRef("memoryPreviewBtn");
      const previewSummary = getRef("memoryPreviewSummary");
      const previewBody = getRef("memoryPreviewBody");
      const action = getMemoryPreviewAction();
      setBusy(previewBtn, true);
      try {
        if (previewSummary) {
          previewSummary.hidden = false;
          previewSummary.replaceChildren(createNode("div", "settings-ai-memory-effect-card is-neutral", "正在检查这条记忆的注入结果。"));
        }
        const result = await requestJson(`/api/ai/memory/system-prompt?action=${encodeURIComponent(action)}`);
        const body = result.body || "当前场景没有可注入的已确认记忆。";
        renderMemoryEffectCheck(getSelectedMemoryRecord(), result.memory || {}, body);
        if (previewBody) {
          previewBody.hidden = false;
          previewBody.textContent = body;
        }
        const count = result.memory?.count ?? 0;
        const excludedCount = Array.isArray(result.memory?.excluded) ? result.memory.excluded.length : 0;
        setStatus(getRef("memoryStatus"), `生效检查已更新，同场景注入 ${count} 条，未注入 ${excludedCount} 条。`, "success");
      } catch (error) {
        if (previewSummary) previewSummary.hidden = true;
        if (previewBody) previewBody.hidden = true;
        setStatus(getRef("memoryStatus"), error instanceof Error ? error.message : "生效检查失败。", "danger");
      } finally {
        setBusy(previewBtn, false);
      }
    }

    function getOrigin() {
      if (locationRef.origin) return String(locationRef.origin);
      const protocol = locationRef.protocol || "http:";
      const host = locationRef.host || "127.0.0.1:8081";
      return `${protocol}//${host}`;
    }

    function buildHttpMcpConfig() {
      return JSON.stringify(
        {
          mcpServers: {
            guanshi: {
              type: "http",
              url: `${getOrigin()}/api/ai/mcp/jsonrpc`,
            },
          },
        },
        null,
        2,
      );
    }

    function buildStdioMcpConfig() {
      return JSON.stringify(
        {
          mcpServers: {
            guanshi: {
              command: "node",
              args: [".guanshi/mcp-server.js"],
              env: {
                GUANSHI_MCP_CLIENT_ID: "guanshi-local-agent",
              },
            },
          },
        },
        null,
        2,
      );
    }

    async function copyText(text, successMessage) {
      if (navigatorRef.clipboard && typeof navigatorRef.clipboard.writeText === "function") {
        await navigatorRef.clipboard.writeText(text);
      } else if (documentRef?.body && typeof documentRef.createElement === "function") {
        const textarea = documentRef.createElement("textarea");
        textarea.value = text;
        textarea.setAttribute("readonly", "readonly");
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        documentRef.body.appendChild(textarea);
        textarea.select();
        documentRef.execCommand("copy");
        textarea.remove();
      } else {
        throw new Error("当前运行环境不支持复制。");
      }
      setStatus(getRef("mcpStatus"), successMessage, "success");
    }

    function ensureLoadedForSettingsView() {
      render();
      if (!providerLoaded && !loadingProvider) void loadProviderConfig();
      if (!mcpLoaded && !loadingMcp) void loadMcpStatus();
      if (!actionsLoaded && !loadingActions) void loadActionRegistry();
      if (!memoryLoaded && !loadingMemory) void loadMemory();
    }

    function init() {
      collectRefs();
      renderProviderTypeOptions("openai-compatible");
      applyDefinitionDefaults("openai-compatible", { forceId: true });
      render();
      void loadProviderConfig();
      void loadMcpStatus();
      void loadActionRegistry();
      void loadMemory();
    }

    function bindEvents() {
      if (eventsBound) return;
      eventsBound = true;
      collectRefs();

      getRef("providerType")?.addEventListener("change", (event) => {
        applyDefinitionDefaults(event.target?.value || "openai-compatible", { forceId: true });
        renderProviderSummary();
      });

      getRef("providerForm")?.addEventListener("submit", (event) => {
        event.preventDefault();
        void saveProvider();
      });

      getRef("providerTestBtn")?.addEventListener("click", () => {
        void testProvider({ network: false });
      });

      getRef("providerNetworkTestBtn")?.addEventListener("click", () => {
        void testProvider({ network: true });
      });

      getRef("mcpRefreshBtn")?.addEventListener("click", () => {
        void loadMcpStatus({ manual: true });
      });

      getRef("mcpCopyHttpBtn")?.addEventListener("click", () => {
        void copyText(buildHttpMcpConfig(), "HTTP MCP 配置已复制。");
      });

      getRef("mcpCopyStdioBtn")?.addEventListener("click", () => {
        void copyText(buildStdioMcpConfig(), "stdio MCP 配置已复制。");
      });

      getRef("actionsRefreshBtn")?.addEventListener("click", () => {
        void loadActionRegistry({ manual: true });
      });

      getRef("memoryRefreshBtn")?.addEventListener("click", () => {
        void loadMemory({ manual: true });
      });

      getRef("memoryNewBtn")?.addEventListener("click", () => {
        openNewMemoryEditor();
      });

      getRef("memoryList")?.addEventListener("click", (event) => {
        handleMemoryListClick(event);
      });

      getRef("memoryDetail")?.addEventListener("click", (event) => {
        void handleMemoryActionClick(event);
      });

      for (const tab of getMemoryStatusTabs()) {
        tab.addEventListener("click", handleMemoryStatusTabClick);
        tab.addEventListener("keydown", handleMemoryStatusTabKeydown);
      }

      getRef("memoryEditor")?.addEventListener("submit", (event) => {
        event.preventDefault();
        void saveMemoryEditor();
      });

      getRef("memoryCancelBtn")?.addEventListener("click", () => {
        closeMemoryEditor();
      });

      getRef("memoryPreviewBtn")?.addEventListener("click", () => {
        void loadMemoryPreview();
      });

      getRef("memoryPreviewAction")?.addEventListener("change", () => {
        renderMemoryEffectCheck(getSelectedMemoryRecord());
      });

      getRef("memoryTypeSelect")?.addEventListener("change", (event) => {
        const type = normalizeText(event.target?.value, 40);
        if (memoryEditorState.mode === "entry") return;
        const modelReadable = getRef("memoryModelReadable");
        const engineReadable = getRef("memoryEngineReadable");
        if (modelReadable && type === "review") modelReadable.checked = false;
        if (engineReadable && type === "review") engineReadable.checked = false;
      });
    }

    return {
      bindEvents,
      ensureLoadedForSettingsView,
      init,
      render,
    };
  }

  globalScope.TimeQualityAiSettingsModule = { createAiSettingsModule };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = globalScope.TimeQualityAiSettingsModule;
  }
})(typeof window !== "undefined" ? window : globalThis);
