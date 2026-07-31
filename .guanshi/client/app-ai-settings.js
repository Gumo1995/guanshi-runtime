/* global window */

(function attachTimeQualityAiSettingsModule(globalScope) {
  "use strict";

  const DEFAULT_PROVIDER_TYPES = [
    {
      type: "openai-compatible",
      label: "OpenAI-compatible",
      defaultBaseUrl: "https://api.openai.com/v1",
      defaultModel: "gpt-4.1-mini",
      envKeyNames: ["OPENAI_API_KEY"],
      requiresApiKey: true,
    },
    {
      type: "anthropic",
      label: "Anthropic",
      defaultBaseUrl: "https://api.anthropic.com",
      defaultModel: "claude-3-5-sonnet-latest",
      envKeyNames: ["ANTHROPIC_API_KEY"],
      requiresApiKey: true,
    },
    {
      type: "hermes-webui",
      label: "Hermes WebUI",
      defaultBaseUrl: "http://127.0.0.1:8088",
      defaultModel: "",
      envKeyNames: [],
      requiresApiKey: false,
    },
    {
      type: "ollama",
      label: "Ollama",
      defaultBaseUrl: "http://127.0.0.1:11434/v1",
      defaultModel: "llama3.1",
      envKeyNames: [],
      requiresApiKey: false,
    },
    {
      type: "lm-studio",
      label: "LM Studio",
      defaultBaseUrl: "http://127.0.0.1:1234/v1",
      defaultModel: "local-model",
      envKeyNames: [],
      requiresApiKey: false,
    },
    {
      type: "custom",
      label: "Custom Gateway",
      defaultBaseUrl: "",
      defaultModel: "",
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

  const DEFAULT_MEMORY_APPLIES_TO = ["plan_today", "plan_week", "reflow_unfinished", "schedule_draft"];

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
    memoryList: "settings-ai-memory-list",
    memoryProposalList: "settings-ai-memory-proposal-list",
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
    memoryRuleInput: "settings-ai-memory-rule-input",
    memoryEngineReadable: "settings-ai-memory-engine-readable",
    memorySaveBtn: "settings-ai-memory-save-btn",
    memoryCancelBtn: "settings-ai-memory-cancel-btn",
    memoryPreviewAction: "settings-ai-memory-preview-action",
    memoryPreviewBtn: "settings-ai-memory-preview-btn",
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

    function createMemoryChip(text, tone = "") {
      const chip = createNode("span", "settings-ai-memory-chip", text);
      if (tone) chip.dataset.tone = tone;
      return chip;
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
      const env = getRef("providerEnv");
      const enabled = getRef("providerEnabled");

      if (providerId && (forceId || !providerId.value.trim())) providerId.value = definition.type || "";
      if (baseUrl) baseUrl.value = definition.defaultBaseUrl || "";
      if (model) model.value = definition.defaultModel || "";
      if (env) env.value = Array.isArray(definition.envKeyNames) ? definition.envKeyNames[0] || "" : "";
      if (enabled) enabled.checked = true;
    }

    function populateProviderForm(provider = null) {
      const definition = getProviderDefinition(provider?.type || "openai-compatible");
      renderProviderTypeOptions(definition.type);

      const providerId = getRef("providerId");
      const baseUrl = getRef("providerBaseUrl");
      const model = getRef("providerModel");
      const env = getRef("providerEnv");
      const apiKey = getRef("providerApiKey");
      const enabled = getRef("providerEnabled");

      if (providerId) providerId.value = provider?.id || definition.type || "";
      if (baseUrl) baseUrl.value = provider?.baseUrl || definition.defaultBaseUrl || "";
      if (model) model.value = provider?.model || definition.defaultModel || "";
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

    function renderMemoryEntry(entry) {
      const item = createNode("article", "settings-ai-memory-item");
      item.dataset.status = entry.status || "disabled";
      const head = createNode("div", "settings-ai-memory-item-head");
      const titleWrap = createNode("div", "settings-ai-memory-title-wrap");
      const title = createNode("strong", "", entry.title || "未命名记忆");
      const meta = createNode(
        "small",
        "",
        `${formatMemoryType(entry.type)} · ${entry.strength || "soft"} · 更新 ${formatDateTime(entry.updatedAt)}`,
      );
      titleWrap.append(title, meta);
      const statusTone = entry.status === "active" ? "success" : "warning";
      head.append(titleWrap, createMemoryChip(formatMemoryStatus(entry.status), statusTone));

      const body = createNode("p", "settings-ai-memory-body", entry.body || "无内容。");
      const details = createNode("div", "settings-ai-memory-details");
      details.append(
        createMemoryChip(`场景 ${formatList(entry.appliesTo)}`),
        createMemoryChip(entry.engineReadable ? "可注入" : "不注入", entry.engineReadable ? "success" : "warning"),
      );
      if (entry.rule) details.append(createMemoryChip("有结构化规则", "success"));

      const actions = createNode("div", "settings-ai-memory-actions");
      actions.append(createMemoryAction("编辑", "edit", "entry", entry.id));
      if (entry.status === "active") {
        actions.append(createMemoryAction("停用", "disable", "entry", entry.id));
      } else {
        actions.append(createMemoryAction("启用", "restore", "entry", entry.id, "primary"));
      }
      actions.append(createMemoryAction("删除", "delete", "entry", entry.id, "danger"));

      item.append(head, body, details, actions);
      return item;
    }

    function renderMemoryProposal(proposal) {
      const item = createNode("article", "settings-ai-memory-item");
      item.dataset.status = "pending";
      const head = createNode("div", "settings-ai-memory-item-head");
      const titleWrap = createNode("div", "settings-ai-memory-title-wrap");
      const title = createNode("strong", "", proposal.title || "未命名提案");
      const source = proposal.createdBy?.name || proposal.createdBy?.kind || "guanshi";
      const meta = createNode(
        "small",
        "",
        `${formatMemoryType(proposal.type)} · ${proposal.strength || "soft"} · 来源 ${source}`,
      );
      titleWrap.append(title, meta);
      head.append(titleWrap, createMemoryChip("待确认", "warning"));

      const body = createNode("p", "settings-ai-memory-body", proposal.body || "无内容。");
      const details = createNode("div", "settings-ai-memory-details");
      details.append(
        createMemoryChip(`场景 ${formatList(proposal.appliesTo)}`),
        createMemoryChip(proposal.engineReadable === false ? "不注入" : "可注入", proposal.engineReadable === false ? "warning" : "success"),
      );
      if (proposal.rule) details.append(createMemoryChip("有结构化规则", "success"));

      const actions = createNode("div", "settings-ai-memory-actions");
      actions.append(
        createMemoryAction("确认", "confirm", "proposal", proposal.proposalId, "primary"),
        createMemoryAction("编辑", "edit", "proposal", proposal.proposalId),
        createMemoryAction("拒绝", "reject", "proposal", proposal.proposalId, "danger"),
      );

      item.append(head, body, details, actions);
      return item;
    }

    function renderMemorySummary() {
      const badge = getRef("memoryBadge");
      const summary = getRef("memorySummary");
      const activeCount = memoryEntries.filter((entry) => entry.status === "active").length;
      const disabledCount = memoryEntries.filter((entry) => entry.status === "disabled").length;
      const pendingCount = memoryProposals.length;
      const injectText = memoryConfig?.enabled === false
        ? "记忆关闭"
        : memoryConfig?.autoInject === false
          ? "自动注入关闭"
          : "自动注入开启";

      setText(badge, memoryLoaded ? `记忆 ${activeCount}/${pendingCount}` : "记忆检测中");
      setTone(badge, memoryLoaded ? (activeCount || pendingCount ? "success" : "warning") : "warning");
      setText(summary, `已启用 ${activeCount} 条，已停用 ${disabledCount} 条，待确认 ${pendingCount} 条；${injectText}。`);
    }

    function renderMemoryLists() {
      const list = getRef("memoryList");
      const proposalList = getRef("memoryProposalList");
      if (!list || !proposalList || !documentRef) return;

      const entries = memoryEntries.filter((entry) => entry.status !== "deleted");
      list.replaceChildren(
        ...(entries.length
          ? entries.map(renderMemoryEntry)
          : [createEmptyMemoryMessage(memoryLoaded ? "暂无正式记忆。" : "正在读取正式记忆。")]),
      );
      proposalList.replaceChildren(
        ...(memoryProposals.length
          ? memoryProposals.map(renderMemoryProposal)
          : [createEmptyMemoryMessage(memoryLoaded ? "暂无待确认提案。" : "正在读取待确认提案。")]),
      );
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
        apiKeyEnvName: normalizeText(getRef("providerEnv")?.value, 100),
      };
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
        const [memoryResult, proposalResult] = await Promise.all([
          requestJson("/api/ai/memory"),
          requestJson("/api/ai/memory/proposals?status=pending_confirmation"),
        ]);
        memoryEntries = Array.isArray(memoryResult.entries) ? memoryResult.entries : [];
        memoryConfig = memoryResult.config || null;
        memoryProposals = Array.isArray(proposalResult.proposals) ? proposalResult.proposals : [];
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
      const engineReadableDefault = !["review", "capability_request"].includes(type);
      const titleInput = getRef("memoryTitleInput");
      const typeSelect = getRef("memoryTypeSelect");
      const strengthSelect = getRef("memoryStrengthSelect");
      const appliesInput = getRef("memoryAppliesInput");
      const bodyInput = getRef("memoryBodyInput");
      const ruleInput = getRef("memoryRuleInput");
      const engineReadable = getRef("memoryEngineReadable");

      if (titleInput) titleInput.value = source.title || "";
      if (typeSelect) typeSelect.value = MEMORY_TYPE_LABELS[type] ? type : "principle";
      if (strengthSelect) strengthSelect.value = source.strength || "soft";
      if (appliesInput) appliesInput.value = formatList(source.appliesTo || DEFAULT_MEMORY_APPLIES_TO);
      if (bodyInput) bodyInput.value = source.body || "";
      if (ruleInput) ruleInput.value = source.rule ? JSON.stringify(source.rule, null, 2) : "";
      if (engineReadable) engineReadable.checked = source.engineReadable === undefined ? engineReadableDefault : source.engineReadable !== false;
    }

    function openNewMemoryEditor() {
      setMemoryEditorMode("new", "");
      setMemoryEditorValues({
        type: "principle",
        strength: "soft",
        appliesTo: DEFAULT_MEMORY_APPLIES_TO,
        engineReadable: true,
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
      return {
        title,
        body,
        type: normalizeText(getRef("memoryTypeSelect")?.value, 40) || "principle",
        strength: normalizeText(getRef("memoryStrengthSelect")?.value, 40) || "soft",
        appliesTo: normalizeStringList(getRef("memoryAppliesInput")?.value, 16),
        engineReadable: Boolean(getRef("memoryEngineReadable")?.checked),
        rule: parseMemoryRuleInput(),
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
        engineReadable: payload.engineReadable,
        rule: payload.rule,
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
              engineReadable: payload.engineReadable,
              rule: payload.rule,
            }),
          });
          setStatus(getRef("memoryStatus"), "正式记忆已更新。", "success");
        } else {
          await requestJson("/api/ai/memory/proposals", {
            method: "POST",
            body: JSON.stringify(buildMemoryProposalPayload(payload)),
          });
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
        setStatus(getRef("memoryStatus"), "记忆已停用。", "success");
      } else if (action === "restore") {
        await requestJson(`${path}/restore`, { method: "POST" });
        setStatus(getRef("memoryStatus"), "记忆已启用。", "success");
      } else if (action === "delete") {
        await requestJson(path, {
          method: "DELETE",
          body: JSON.stringify({ permanent: true }),
        });
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
        await requestJson(`${path}/confirm`, {
          method: "POST",
          body: JSON.stringify({ confirmedBy: "settings" }),
        });
        setStatus(getRef("memoryStatus"), "记忆提案已确认并启用。", "success");
      } else if (action === "reject") {
        await requestJson(`${path}/reject`, {
          method: "POST",
          body: JSON.stringify({ rejectedBy: "settings" }),
        });
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

    async function loadMemoryPreview() {
      const previewBtn = getRef("memoryPreviewBtn");
      const previewBody = getRef("memoryPreviewBody");
      const action = normalizeText(getRef("memoryPreviewAction")?.value, 80) || "assistant";
      setBusy(previewBtn, true);
      try {
        const result = await requestJson(`/api/ai/memory/system-prompt?action=${encodeURIComponent(action)}`);
        const body = result.body || "当前场景没有可注入的已确认记忆。";
        if (previewBody) {
          previewBody.hidden = false;
          previewBody.textContent = body;
        }
        const count = result.memory?.count ?? 0;
        setStatus(getRef("memoryStatus"), `调用预览已生成，包含 ${count} 条记忆。`, "success");
      } catch (error) {
        setStatus(getRef("memoryStatus"), error instanceof Error ? error.message : "调用预览读取失败。", "danger");
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
        void handleMemoryActionClick(event);
      });

      getRef("memoryProposalList")?.addEventListener("click", (event) => {
        void handleMemoryActionClick(event);
      });

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

      getRef("memoryTypeSelect")?.addEventListener("change", (event) => {
        const type = normalizeText(event.target?.value, 40);
        if (memoryEditorState.mode === "entry") return;
        const engineReadable = getRef("memoryEngineReadable");
        if (engineReadable && ["review", "capability_request"].includes(type)) engineReadable.checked = false;
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
