(function attachTimeQualityAiSidebarModule(globalScope) {
  "use strict";

  const AI_ASSISTANT_SCHEMA = "guanshi-ai-assistant-request-v1";
  const AI_CONTEXT_SNAPSHOT_SCHEMA = "guanshi-ai-context-snapshot-v1";
  const AI_SEMANTIC_FEEDBACK_SCHEMA = "guanshi-ai-semantic-feedback-v1";

  const ACTION_CONFIG = {
    assistant: {
      workflow: "",
      label: "AI 对话",
      prompt: "",
      requiresInput: true,
    },
    "smart-next": {
      workflow: "plan_today",
      label: "智能匹配下一步",
      prompt: "请根据当前待办、忙闲块和已确认的时间管理原则，匹配今天最合适的下一步。",
      requiresInput: false,
    },
    "plan-today": {
      workflow: "plan_today",
      label: "规划今天",
      prompt: "请规划今天，生成一个需要我确认的排程草稿。",
      requiresInput: false,
    },
    "plan-week": {
      workflow: "plan_week",
      label: "规划本周",
      prompt: "请规划本周，生成一个需要我确认的排程草稿。",
      requiresInput: false,
    },
    "parse-task": {
      workflow: "parse_task",
      label: "解析为待办",
      prompt: "",
      requiresInput: true,
    },
    "breakdown-task": {
      workflow: "breakdown_task",
      label: "拆解任务",
      prompt: "请拆解当前选中的任务，生成需要我确认的子任务草稿。",
      requiresInput: false,
    },
    "reflow-unfinished": {
      workflow: "reflow_unfinished",
      label: "重排未完成",
      prompt: "请把未完成任务按最小变更原则重排到最近可用时间。",
      requiresInput: false,
    },
    "deadline-risk": {
      workflow: "review_day",
      label: "查看风险",
      prompt: "请检查今天的截止风险，并指出需要调整的事项。",
      requiresInput: false,
    },
    "explore-principles": {
      workflow: "explore_principles",
      label: "探索原则",
      prompt: "请引导我梳理自己的生活时间管理原则。",
      requiresInput: false,
    },
    "save-memory": {
      workflow: "save_memory_proposal",
      label: "把原则记下来",
      prompt: "",
      requiresInput: true,
    },
  };

  const AI_REFERENCE_SCOPE_SCHEMA = "guanshi-ai-reference-scope-v1";
  const AI_CONTEXT_SCOPE_OPTIONS = [
    {
      mode: "ask_each_time",
      label: "每次",
      buttonLabel: "每次",
      description: "需要更多时间数据时先问我",
    },
    {
      mode: "allow_conversation",
      label: "本对话",
      buttonLabel: "本对话",
      description: "本对话确认一次后自动参考",
    },
    {
      mode: "auto_allow",
      label: "允许",
      buttonLabel: "允许",
      description: "按需自动参考必要时间数据",
    },
    {
      mode: "none",
      label: "不参考",
      buttonLabel: "不参考",
      description: "不带本地待办和时间记录",
    },
  ];
  const AI_CONTEXT_SCOPE_LABELS = AI_CONTEXT_SCOPE_OPTIONS.reduce((result, option) => {
    result[option.mode] = option.label;
    return result;
  }, {});
  const AI_CONTEXT_SCOPE_RESOLVED_LABELS = {
    ...AI_CONTEXT_SCOPE_LABELS,
    auto: "自动",
    default_2_3: "默认 2+3 天",
    granted_range: "本轮授权范围",
    selected_with_today: "当前待办+今天",
    reflow_unfinished: "重排未完成",
  };
  const AI_CONTEXT_RERUN_MAX = 2;
  const AI_CONTEXT_CONVERSATION_TTL_MS = 60 * 60 * 1000;

  const AI_DISPLAY_FLUSH_INTERVAL_MS = 40;
  const AI_DISPLAY_MIN_CHARS = 8;
  const AI_DISPLAY_MAX_CHARS = 28;
  const AI_DISPLAY_BACKLOG_CHARS = 120;
  const AI_DISPLAY_SENTENCE_BOUNDARY = /[。！？；\n]/;
  const AI_TURN_ANCHOR_TOP_OFFSET_PX = 40;
  const AI_TURN_SCROLL_ANIMATION_MS = 220;
  const AI_TURN_SCROLL_STEP_MS = 16;
  const AI_TURN_SCROLL_MIN_DELTA_PX = 6;
  const AI_NEXT_ACTION_IDLE_DELAY_MS = 5000;
  const AI_NEXT_ACTION_VISIBLE_MARGIN_PX = 12;
  const AI_PROVIDER_LOGO_BASE = "./assets/ai-providers/";
  const AI_PROVIDER_LOGO_FILES = {
    generic: "generic.svg",
    openai: "openai.png",
    deepseek: "deepseek.png",
    anthropic: "anthropic.png",
    qwen: "qwen.png",
    ollama: "ollama.png",
  };

  function createAiSidebarModule(deps = {}) {
    const documentRef = deps.documentRef || globalScope.document || null;
    const windowRef = deps.windowRef || globalScope.window || globalScope;
    const sidebar = deps.sidebar || null;
    const dockButton = deps.sidebarAiDockButton || null;
    const panel = deps.sidebarAiPanel || null;
    const closeButton = deps.sidebarAiCloseBtn || null;
    const form = deps.sidebarAiForm || null;
    const input = deps.sidebarAiInput || null;
    const status = deps.sidebarAiStatus || null;
    const actionButtons = Array.isArray(deps.sidebarAiActionButtons) ? deps.sidebarAiActionButtons : [];
    const fetchFn =
      typeof deps.fetchFn === "function"
        ? deps.fetchFn
        : typeof windowRef.fetch === "function"
          ? windowRef.fetch.bind(windowRef)
          : null;
    const nextActionIdleDelayMs = Number.isFinite(Number(deps.nextActionIdleDelayMs))
      ? Math.max(0, Number(deps.nextActionIdleDelayMs))
      : AI_NEXT_ACTION_IDLE_DELAY_MS;

    const getTodos = typeof deps.getTodos === "function" ? deps.getTodos : () => [];
    const getEntries = typeof deps.getEntries === "function" ? deps.getEntries : () => [];
    const getSelectedTodo = typeof deps.getSelectedTodo === "function" ? deps.getSelectedTodo : () => null;
    const getCategories = typeof deps.getCategories === "function" ? deps.getCategories : () => [];
    const getTodayDateInputValue =
      typeof deps.getTodayDateInputValue === "function"
        ? deps.getTodayDateInputValue
        : () => new Date().toISOString().slice(0, 10);
    const createTodoDraft =
      typeof deps.createTodoDraft === "function"
        ? deps.createTodoDraft
        : () => ({ id: `todo_${Date.now()}`, title: "新待办事项" });
    const normalizeTodo = typeof deps.normalizeTodo === "function" ? deps.normalizeTodo : (todo) => todo;
    const getNextTodoOrderForDate =
      typeof deps.getNextTodoOrderForDate === "function" ? deps.getNextTodoOrderForDate : () => null;
    const markTodoPlanningDirty =
      typeof deps.markTodoPlanningDirty === "function"
        ? deps.markTodoPlanningDirty
        : (todo, timestampIso = new Date().toISOString()) => {
          todo.updatedAt = timestampIso;
          todo.calendarSynced = false;
          todo.syncState = "dirty";
          todo.lastSyncError = "";
        };
    const normalizeTodoOrderByClockForDate =
      typeof deps.normalizeTodoOrderByClockForDate === "function" ? deps.normalizeTodoOrderByClockForDate : () => false;
    const saveTodos = typeof deps.saveTodos === "function" ? deps.saveTodos : () => {};
    const setTodos = typeof deps.setTodos === "function" ? deps.setTodos : () => {};
    const setSelectedTodoId = typeof deps.setSelectedTodoId === "function" ? deps.setSelectedTodoId : () => {};
    const setActiveView = typeof deps.setActiveView === "function" ? deps.setActiveView : () => {};
    const render = typeof deps.render === "function" ? deps.render : () => {};
    const setAiHighlightedTodoIds =
      typeof deps.setAiHighlightedTodoIds === "function" ? deps.setAiHighlightedTodoIds : () => {};
    const postApplyHighlightMs = Math.max(
      800,
      Math.min(12000, Number.parseInt(String(deps.postApplyHighlightMs || 4500), 10) || 4500),
    );

    const embedded = Boolean(panel && !dockButton && !closeButton);
    const threadViewport = panel?.querySelector("[data-ai-thread-viewport]") || null;
    const thread = panel?.querySelector("[data-ai-thread]") || null;
    const generatedCard = panel?.querySelector("[data-ai-generated-card]") || null;
    const generatedList = panel?.querySelector("[data-ai-generated-list]") || null;
    const generatedEmpty = panel?.querySelector("[data-ai-generated-empty]") || null;
    const generatedCount = panel?.querySelector("[data-ai-generated-count]") || null;
    const pendingCard = panel?.querySelector("[data-ai-pending-card]") || null;
    const pendingList = panel?.querySelector("[data-ai-pending-list]") || null;
    const pendingEmpty = panel?.querySelector("[data-ai-pending-empty]") || null;
    const pendingCount = panel?.querySelector("[data-ai-pending-count]") || null;
    const composerShell = panel?.querySelector("[data-ai-composer-shell]") || form?.querySelector(".sidebar-ai-composer-shell") || null;
    const contextScopeButton = panel?.querySelector("[data-ai-context-scope-button]") || null;
    const contextScopeLabel = panel?.querySelector("[data-ai-context-scope-label]") || null;
    const providerSwitchButton = panel?.querySelector("[data-ai-provider-switch]") || null;
    const providerSwitchLogo = panel?.querySelector("[data-ai-provider-switch-logo]") || null;

    let eventsBound = false;
    let isBusy = false;
    const deltaBuffers = new Map();
    let currentProviderIdentity = { label: "模型", logoKey: "generic" };
    let activeTurnScroll = null;
    let threadScrollAnimation = null;
    let nextActionsTimer = null;
    let postApplyHighlightTimer = null;
    let actionRegistryPayload = null;
    let actionRegistryRequest = null;
    let nextActionsPendingMessageId = "";
    let contextDrawer = null;
    let contextScopeMenu = null;
    let contextScopeMode = "ask_each_time";
    const contextConversationId = `ctx_conv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    let conversationContextAccessGrant = null;
    let activeContextMessageId = "";
    let contextDetailMode = "readable";
    let activeContextStepId = "";
    let messages = [
      {
        id: "welcome",
        role: "assistant",
        state: "ready",
        paragraphs: ["今天想先怎么安排？我可以直接在这里生成计划草稿，你确认后再应用。"],
        showActions: true,
      },
    ];
    let generatedItems = [];
    let pendingItems = [];
    let pendingSemanticFeedback = null;

    function escapeHtml(value) {
      return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    function renderInlineMarkdown(text) {
      const placeholders = [];
      const reserve = (html) => {
        const key = `\u0000${placeholders.length}\u0000`;
        placeholders.push([key, html]);
        return key;
      };
      let value = escapeHtml(text);
      value = value.replace(/`([^`\n]+)`/g, (_, code) => reserve(`<code>${code}</code>`));
      value = value.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
      value = value.replace(/__([^_\n]+)__/g, "<strong>$1</strong>");
      for (const [key, html] of placeholders) {
        value = value.split(key).join(html);
      }
      return value;
    }

    function renderAssistantMarkdown(paragraphs) {
      const source = (Array.isArray(paragraphs) ? paragraphs : [paragraphs])
        .map((paragraph) => String(paragraph || ""))
        .join("\n\n");
      const blocks = [];
      let current = [];
      let inCodeBlock = false;
      for (const rawLine of source.split(/\n/)) {
        const line = String(rawLine || "");
        if (/^```/.test(line.trim())) {
          current.push(line);
          inCodeBlock = !inCodeBlock;
          continue;
        }
        if (!inCodeBlock && !line.trim()) {
          if (current.length) {
            blocks.push(current.join("\n").trim());
            current = [];
          }
          continue;
        }
        current.push(line);
      }
      if (current.length) blocks.push(current.join("\n").trim());
      const html = [];
      for (const block of blocks) {
        const codeMatch = /^```[^\n]*\n?([\s\S]*?)```$/.exec(block);
        if (codeMatch) {
          html.push(`<pre class="sidebar-ai-code-block"><code>${escapeHtml(codeMatch[1].trim())}</code></pre>`);
          continue;
        }
        const lines = block.split(/\n/).map((line) => line.trim()).filter(Boolean);
        const unorderedItems = lines.map((line) => /^[-*]\s+(.+)$/.exec(line));
        if (lines.length && unorderedItems.every(Boolean)) {
          html.push(`<ul>${unorderedItems.map((match) => `<li>${renderInlineMarkdown(match[1])}</li>`).join("")}</ul>`);
          continue;
        }
        const orderedItems = lines.map((line) => /^\d+[.)]\s+(.+)$/.exec(line));
        if (lines.length && orderedItems.every(Boolean)) {
          html.push(`<ol>${orderedItems.map((match) => `<li>${renderInlineMarkdown(match[1])}</li>`).join("")}</ol>`);
          continue;
        }
        if (block.startsWith("```")) {
          html.push(`<pre class="sidebar-ai-code-block"><code>${escapeHtml(block.replace(/^```[^\n]*\n?/, ""))}</code></pre>`);
          continue;
        }
        if (/^([-*_])(?:\s*\1){2,}$/.test(block)) {
          html.push('<hr class="sidebar-ai-markdown-rule" />');
          continue;
        }
        const headingMatch = /^(#{1,3})\s+(.+)$/.exec(block);
        if (headingMatch) {
          html.push(`<p class="sidebar-ai-markdown-heading">${renderInlineMarkdown(headingMatch[2])}</p>`);
          continue;
        }
        html.push(`<p>${renderInlineMarkdown(block)}</p>`);
      }
      return html.join("");
    }

    function hasContextSnapshot(message) {
      return message?.role === "assistant"
        && message.contextSnapshot
        && typeof message.contextSnapshot === "object"
        && message.contextSnapshot.schema === AI_CONTEXT_SNAPSHOT_SCHEMA;
    }

    function renderContextTrigger(message) {
      if (!hasContextSnapshot(message)) return "";
      const activeClass = activeContextMessageId === message.id ? " is-active" : "";
      return `
        <button class="sidebar-ai-context-trigger${activeClass}" type="button" data-ai-context-message-id="${escapeHtml(message.id)}" aria-label="查看本轮模型输入" title="查看本轮模型输入">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <path d="M14 2v6h6"></path>
            <path d="M9 14h6"></path>
            <path d="M9 18h4"></path>
          </svg>
        </button>
      `;
    }

    function appendInlineContextTrigger(html, triggerHtml) {
      const trigger = normalizeText(triggerHtml);
      if (!trigger) return html;
      const source = String(html || "");
      if (!source) return trigger;
      const lastParagraphIndex = source.lastIndexOf("</p>");
      if (lastParagraphIndex >= 0) {
        return `${source.slice(0, lastParagraphIndex)}${trigger}${source.slice(lastParagraphIndex)}`;
      }
      const lastListItemIndex = source.lastIndexOf("</li>");
      if (lastListItemIndex >= 0) {
        return `${source.slice(0, lastListItemIndex)}${trigger}${source.slice(lastListItemIndex)}`;
      }
      return `${source}${trigger}`;
    }

    function renderMessageParagraphs(message) {
      const paragraphs = Array.isArray(message.paragraphs) ? message.paragraphs : [message.text || ""];
      const html = message.role === "assistant"
        ? renderAssistantMarkdown(paragraphs)
        : paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("");
      return appendInlineContextTrigger(html, renderContextTrigger(message));
    }

    function normalizeText(value, fallback = "") {
      return String(value || fallback).trim();
    }

    function trimDisplayText(value, maxLength = 160) {
      const text = normalizeText(value);
      const limit = Math.max(20, Number.parseInt(String(maxLength), 10) || 160);
      return text.length > limit ? `${text.slice(0, limit - 1)}...` : text;
    }

    function normalizeDisplayList(value, maxItems = 4, maxLength = 90) {
      const source = Array.isArray(value)
        ? value
        : normalizeText(value)
          ? [value]
          : [];
      return Array.from(new Set(
        source
          .map((item) => {
            if (item && typeof item === "object") {
              return trimDisplayText(item.title || item.name || item.message || item.summary || item.reason || item.id || JSON.stringify(item), maxLength);
            }
            return trimDisplayText(item, maxLength);
          })
          .filter(Boolean),
      )).slice(0, maxItems);
    }

    function normalizeSemanticAction(value) {
      const source = value && typeof value === "object" && !Array.isArray(value) ? value : null;
      if (!source) return null;
      const confidence = Number(source.confidence);
      const action = trimDisplayText(source.action || source.tool || source.intent, 80);
      const tool = trimDisplayText(source.tool, 100);
      const normalizedGoal = trimDisplayText(source.normalizedGoal || source.goal || source.sourceText, 220);
      const semantic = {
        mode: trimDisplayText(source.mode, 40),
        action,
        tool,
        sourceText: trimDisplayText(source.sourceText, 260),
        normalizedGoal,
        contextRefs: normalizeDisplayList(source.contextRefs, 4, 60),
        memoryRefs: normalizeDisplayList(source.memoryRefs, 3, 70),
        assumptions: normalizeDisplayList(source.assumptions, 3, 90),
        missingFields: normalizeDisplayList(source.missingFields, 3, 60),
        warnings: normalizeDisplayList(source.warnings, 3, 100),
        confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : null,
        requiresConfirmation: source.requiresConfirmation === true,
      };
      const hasVisibleContent = semantic.normalizedGoal
        || semantic.tool
        || semantic.action
        || semantic.assumptions.length
        || semantic.missingFields.length
        || semantic.warnings.length;
      if (!hasVisibleContent) return null;
      if (semantic.mode && semantic.mode !== "tool" && !semantic.tool && !semantic.requiresConfirmation) return null;
      return semantic;
    }

    function normalizeActionReview(value) {
      const source = value && typeof value === "object" && !Array.isArray(value) ? value : null;
      if (!source) return null;
      const status = trimDisplayText(source.status, 40);
      if (!status) return null;
      return {
        status,
        tool: trimDisplayText(source.tool, 100),
        action: trimDisplayText(source.action, 100),
        toolMode: trimDisplayText(source.toolMode, 40),
        requiresConfirmation: source.requiresConfirmation === true || source.permissions?.requiresGuanshiUiConfirmation === true,
        canExecuteWithoutConfirmation: source.canExecuteWithoutConfirmation === true,
        guardrails: normalizeDisplayList(source.guardrails, 4, 80),
        reasons: normalizeDisplayList(source.reasons, 4, 80),
      };
    }

    function nowLabel() {
      const date = new Date();
      return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
    }

    function createId(prefix) {
      return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    }

    function getContextScopeOption(mode) {
      const normalizedMode = normalizeContextScopeMode(mode);
      return AI_CONTEXT_SCOPE_OPTIONS.find((option) => option.mode === normalizedMode) || AI_CONTEXT_SCOPE_OPTIONS[0];
    }

    function normalizeContextScopeMode(mode) {
      const value = normalizeText(mode, "ask_each_time");
      if (value === "auto") return "ask_each_time";
      return AI_CONTEXT_SCOPE_LABELS[value] ? value : "ask_each_time";
    }

    function getReferenceScopeRequestMode() {
      return normalizeContextScopeMode(contextScopeMode) === "none" ? "none" : "auto";
    }

    function renderContextScopeOptions() {
      return `
        <div class="sidebar-ai-context-scope-menu-head">
          <strong>时间数据参考</strong>
          <span>控制 AI 是否可读取待办、时间记录和占用块</span>
        </div>
        ${AI_CONTEXT_SCOPE_OPTIONS.map((option) => {
        const isActive = option.mode === contextScopeMode;
        return `
          <button class="sidebar-ai-context-scope-option${isActive ? " is-active" : ""}" type="button" role="menuitemradio" aria-checked="${isActive ? "true" : "false"}" data-ai-context-scope-option="${escapeHtml(option.mode)}">
            <span class="sidebar-ai-context-scope-check">${isActive ? "✓" : ""}</span>
            <span class="sidebar-ai-context-scope-copy">
              <strong>${escapeHtml(option.label)}</strong>
              <span>${escapeHtml(option.description)}</span>
            </span>
          </button>
        `;
      }).join("")}
      `;
    }

    function updateContextScopeControl() {
      const option = getContextScopeOption(contextScopeMode);
      if (contextScopeLabel) contextScopeLabel.textContent = option.buttonLabel || option.label;
      if (contextScopeButton) {
        contextScopeButton.setAttribute("aria-label", `时间数据参考：${option.label}`);
        contextScopeButton.title = `时间数据参考：${option.label}`;
      }
      if (contextScopeMenu) contextScopeMenu.innerHTML = renderContextScopeOptions();
    }

    function ensureContextScopeMenu() {
      if (contextScopeMenu) return contextScopeMenu;
      if (!documentRef || typeof documentRef.createElement !== "function") return null;
      const host = composerShell || form || panel;
      if (!host || typeof host.appendChild !== "function") return null;
      contextScopeMenu = documentRef.createElement("div");
      contextScopeMenu.className = "sidebar-ai-context-scope-menu";
      contextScopeMenu.setAttribute("role", "menu");
      contextScopeMenu.setAttribute("aria-label", "时间数据参考");
      contextScopeMenu.hidden = true;
      contextScopeMenu.innerHTML = renderContextScopeOptions();
      contextScopeMenu.addEventListener("click", (event) => {
        const option = event.target?.closest?.("[data-ai-context-scope-option]");
        if (!option) return;
        event.preventDefault?.();
        setContextScopeMode(option.dataset.aiContextScopeOption);
        closeContextScopeMenu();
        input?.focus?.();
      });
      host.appendChild(contextScopeMenu);
      return contextScopeMenu;
    }

    function setContextScopeMode(mode) {
      contextScopeMode = normalizeContextScopeMode(mode);
      updateContextScopeControl();
    }

    function openContextScopeMenu() {
      const menu = ensureContextScopeMenu();
      if (!menu) return;
      menu.hidden = false;
      contextScopeButton?.classList?.toggle?.("is-open", true);
      contextScopeButton?.setAttribute?.("aria-expanded", "true");
      updateContextScopeControl();
    }

    function closeContextScopeMenu() {
      if (!contextScopeMenu) return;
      contextScopeMenu.hidden = true;
      contextScopeButton?.classList?.toggle?.("is-open", false);
      contextScopeButton?.setAttribute?.("aria-expanded", "false");
    }

    function isNodeInside(parent, target) {
      if (!parent || !target) return false;
      if (parent === target) return true;
      if (typeof parent.contains === "function") return parent.contains(target);
      let current = target;
      while (current) {
        if (current === parent) return true;
        current = current.parentNode || null;
      }
      return false;
    }

    function toggleContextScopeMenu() {
      const menu = ensureContextScopeMenu();
      if (!menu) return;
      if (menu.hidden) openContextScopeMenu();
      else closeContextScopeMenu();
    }

    function getContextModelInputTurns(snapshot) {
      const turns = Array.isArray(snapshot?.modelInput?.turns) ? snapshot.modelInput.turns : [];
      return turns
        .map((turn, turnIndex) => {
          const stage = normalizeText(turn?.stage, `turn-${turnIndex + 1}`);
          const messages = Array.isArray(turn?.messages) ? turn.messages : [];
          return {
            stage,
            label: normalizeText(turn?.label, stage),
            messages: messages
              .map((message, messageIndex) => ({
                index: Number(message?.index) || messageIndex + 1,
                role: normalizeText(message?.role, "user"),
                content: typeof message?.content === "string" ? message.content : normalizeText(message?.content),
              }))
              .filter((message) => message.role && message.content),
          };
        })
        .filter((turn) => turn.stage && turn.messages.length);
    }

    function getContextModelOutputTurns(snapshot) {
      const turns = Array.isArray(snapshot?.modelOutput?.turns) ? snapshot.modelOutput.turns : [];
      return turns
        .map((turn, turnIndex) => ({
          stage: normalizeText(turn?.stage, `turn-${turnIndex + 1}`),
          label: normalizeText(turn?.label, turn?.stage || `turn-${turnIndex + 1}`),
          content: typeof turn?.content === "string" ? turn.content : normalizeText(turn?.content),
        }))
        .filter((turn) => turn.stage && turn.content);
    }

    function getContextTurnTrace(snapshot) {
      return snapshot?.turnTrace && typeof snapshot.turnTrace === "object" ? snapshot.turnTrace : {};
    }

    function safeJsonStringify(value) {
      try {
        return JSON.stringify(value ?? null, null, 2);
      } catch (error) {
        return JSON.stringify({ error: "无法序列化", message: normalizeText(error?.message) }, null, 2);
      }
    }

    function getPreviousUserMessage(messageId) {
      const index = messages.findIndex((message) => message.id === messageId);
      if (index <= 0) return null;
      for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
        if (messages[cursor]?.role === "user") return messages[cursor];
      }
      return null;
    }

    function getStageOutput(snapshot, stage) {
      return getContextModelOutputTurns(snapshot).find((turn) => turn.stage === stage) || null;
    }

    function getReferenceScopeLabel(referenceScope) {
      const resolved = normalizeText(referenceScope?.resolvedMode || referenceScope?.requestedMode || "none");
      return AI_CONTEXT_SCOPE_RESOLVED_LABELS[resolved] || AI_CONTEXT_SCOPE_LABELS[resolved] || resolved || "未记录";
    }

    function countList(value) {
      return Array.isArray(value) ? value.length : 0;
    }

    function formatConfirmableText(actionReview) {
      if (!actionReview) return "未记录";
      if (actionReview.status === "blocked") return "已拦截";
      if (actionReview.requiresConfirmation || actionReview.permissions?.requiresGuanshiUiConfirmation) return "需要用户确认";
      return actionReview.canExecuteWithoutConfirmation ? "允许直接执行" : actionReview.status || "未记录";
    }

    function getWorkflowReadableRows(workflow) {
      const action = normalizeText(workflow?.request?.action, "workflow");
      const requestInput = workflow?.request?.input && typeof workflow.request.input === "object" ? workflow.request.input : {};
      const result = workflow?.result && typeof workflow.result === "object" ? workflow.result : {};
      const artifacts = Array.isArray(workflow?.artifacts) ? workflow.artifacts : [];
      if (action === "parse_task") {
        const items = Array.isArray(result.items) ? result.items : [];
        const first = items[0] || {};
        return [
          ["类型", "待办录入草稿"],
          ["workflow 输入", trimDisplayText(requestInput.normalizedGoal || requestInput.text || "未记录", 220)],
          ["输出数量", `${items.length} 条待办草稿`],
          ["草稿时间", first.startTime && first.endTime ? `${first.startTime}-${first.endTime}` : first.dueDate || "未识别"],
          ["草稿标题", first.title || "未识别"],
        ];
      }
      if (action === "breakdown_task") {
        const children = Array.isArray(result.children) ? result.children : [];
        return [
          ["类型", "任务拆解草稿"],
          ["workflow 输入", trimDisplayText(requestInput.text || requestInput.parentTitle || "未记录", 220)],
          ["输出数量", `${children.length} 个子任务`],
          ["总时长", `${result.rollup?.totalEstimatedMinutes || 0} 分钟`],
          ["状态", "待确认"],
        ];
      }
      if (action === "plan_today" || action === "plan_week" || action === "reflow_unfinished") {
        const scheduleDraft = artifacts.find((artifact) => artifact?.kind === "schedule_draft")?.draft;
        const changes = Array.isArray(scheduleDraft?.changes) ? scheduleDraft.changes : [];
        return [
          ["类型", action === "plan_week" ? "本周排程草稿" : action === "reflow_unfinished" ? "重排草稿" : "今日排程草稿"],
          ["workflow 输入", requestInput.date || requestInput.targetDate || "未记录"],
          ["输出变化", `${changes.length} 个时间块`],
          ["冲突", `${Array.isArray(scheduleDraft?.conflicts) ? scheduleDraft.conflicts.length : 0} 个`],
          ["状态", scheduleDraft?.status || "待确认"],
        ];
      }
      if (action === "save_memory_proposal" || artifacts.some((artifact) => artifact?.kind === "memory_proposal")) {
        const proposal = artifacts.find((artifact) => artifact?.kind === "memory_proposal")?.proposal;
        return [
          ["类型", "记忆提案"],
          ["workflow 输入", trimDisplayText(requestInput.text || proposal?.body || "未记录", 220)],
          ["提案标题", proposal?.title || "未记录"],
          ["保存状态", proposal?.status || "pending_confirmation"],
          ["确认前", "不会进入正式记忆"],
        ];
      }
      if (action === "review_day") {
        return [
          ["类型", "复盘洞察"],
          ["workflow 输入", requestInput.period ? `${requestInput.period.start || ""} 至 ${requestInput.period.end || ""}` : requestInput.text || "未记录"],
          ["输出", result.summary || "洞察结果"],
          ["状态", "不直接写入记忆"],
        ];
      }
      return [
        ["类型", action],
        ["workflow 输入", trimDisplayText(requestInput.text || requestInput.normalizedGoal || "未记录", 220)],
        ["输出", result.schema || `${Object.keys(result).length} 个字段`],
        ["产物", `${artifacts.length} 个`],
      ];
    }

    function buildContextDetailSteps(message) {
      const snapshot = message?.contextSnapshot || {};
      const turnTrace = getContextTurnTrace(snapshot);
      const previousUser = getPreviousUserMessage(message?.id);
      const inputTurns = getContextModelInputTurns(snapshot);
      const steps = [];

      steps.push({
        id: "user-input",
        tag: "用户输入",
        title: "用户说了什么",
        summary: "本轮进入 AI 的用户原话。",
        rows: [
          ["本轮输入", getMessageText(previousUser) || "未记录"],
          ["历史轮数", `${Number(snapshot.historyCount || 0) || 0} 条`],
        ],
        raw: {
          currentUserMessage: previousUser ? { role: previousUser.role, content: getMessageText(previousUser) } : null,
          messageId: message?.id || "",
        },
        traceSource: "assistant request",
        traceNote: "这是本轮进入后端 assistant request 的用户输入字段；旧消息没有 turnTrace 时会回退为前端消息文本。",
        traceRaw: turnTrace.userInputRaw || {
          currentUserMessage: previousUser ? { role: previousUser.role, content: getMessageText(previousUser) } : null,
          messageId: message?.id || "",
        },
      });

      steps.push({
        id: "context-injection",
        tag: "上下文注入",
        title: "注入模型前的上下文",
        summary: "这里能看到本轮到底带了哪些上下文，而不是只听模型自述。",
        rows: [
          ["业务日期", snapshot.context?.currentDate || "未记录"],
          ["参考范围", getReferenceScopeLabel(snapshot.context?.referenceScope)],
          ["时间数据参考", snapshot.context?.contextAccessPolicy?.label || snapshot.context?.contextAccessPolicy?.mode || "未记录"],
          ["已确认记忆", `${Number(snapshot.memory?.count || 0) || 0} 条`],
          ["待办上下文", `${countList(snapshot.context?.todos)} 条`],
          ["时间记录", `${countList(snapshot.context?.entries)} 条`],
          ["忙碌块", `${countList(snapshot.context?.busyBlocks)} 条`],
        ],
        raw: {
          context: snapshot.context || {},
          memory: snapshot.memory || {},
          semanticFeedback: snapshot.semanticFeedback || null,
          contextRequest: snapshot.contextRequest || null,
          contextGrant: snapshot.contextGrant || null,
        },
        traceSource: "context composer",
        traceNote: "这是注入模型前由本地上下文整理出的原始上下文包和记忆块。",
        traceRaw: turnTrace.contextInjectionRaw || {
          context: snapshot.context || {},
          memory: snapshot.memory || {},
          semanticFeedback: snapshot.semanticFeedback || null,
          contextRequest: snapshot.contextRequest || null,
          contextGrant: snapshot.contextGrant || null,
        },
      });

      for (const turn of inputTurns) {
        const output = getStageOutput(snapshot, turn.stage);
        const requestTrace = turn.stage === "planner" ? turnTrace.plannerRequestRaw : turn.stage === "writer" ? turnTrace.writerRequestRaw : null;
        const responseTrace = turn.stage === "planner" ? turnTrace.plannerResponseRaw : turn.stage === "writer" ? turnTrace.writerResponseRaw : null;
        steps.push({
          id: `model-input-${turn.stage}`,
          tag: "模型输入",
          title: `${turn.label} 收到的输入`,
          summary: "按真实 provider messages 顺序展示。",
          rows: [
            ["阶段", turn.label],
            ["消息数", `${turn.messages.length} 条`],
            ["角色顺序", turn.messages.map((item) => item.role).join(" → ")],
          ],
          raw: turn,
          traceSource: requestTrace?.source || "provider request body",
          traceNote: requestTrace
            ? "这是 Provider 调用时记录的请求 trace，包含实际发送的 body；敏感请求头已脱敏。"
            : "旧消息没有 Provider 请求 trace，这里回退展示整理后的 modelInput.turns。",
          traceRaw: requestTrace || turn,
        });

        if (output || turn.stage === "planner") {
          const isPlanner = turn.stage === "planner";
          steps.push({
            id: `model-output-${turn.stage}`,
            tag: "模型输出",
            title: `${turn.label} 的输出`,
            summary: isPlanner ? "先保留模型原始输出，再展示系统规范化后的理解。" : "Writer 生成的用户可见回复原文。",
            rows: isPlanner
              ? [
                ["原始输出", trimDisplayText(output?.content || "未记录", 260)],
                ["选择能力", message.decision?.tool || snapshot.semanticAction?.tool || "未记录"],
                ["还原目标", snapshot.semanticAction?.normalizedGoal || "未记录"],
                ["扩围请求", snapshot.contextRequest?.reason || message.contextRequest?.reason || "无"],
                ["上下文校验", snapshot.contextGuard?.applied ? (snapshot.contextGuard.reason || "已触发") : "未触发"],
                ["置信度", snapshot.semanticAction?.confidence != null ? `${Math.round(Number(snapshot.semanticAction.confidence) * 100)}%` : "未记录"],
              ]
              : [
                ["原始输出", trimDisplayText(output?.content || message.paragraphs?.join(" ") || "", 260)],
                ["用户可见", trimDisplayText(message.paragraphs?.join(" "), 260)],
              ],
            raw: isPlanner
              ? {
                rawModelOutput: output?.content || "",
                normalizedDecision: message.decision || {},
                semanticAction: snapshot.semanticAction || message.semanticAction || {},
                contextRequest: snapshot.contextRequest || message.contextRequest || null,
                contextGuard: snapshot.contextGuard || message.contextGuard || null,
              }
              : {
                rawModelOutput: output?.content || "",
                visibleAnswer: message.paragraphs || [],
              },
            traceSource: responseTrace?.source || "provider response body",
            traceNote: responseTrace
              ? "这是 Provider 返回后记录的响应 trace；流式 Writer 会包含 rawChunks 和解析出的 delta。"
              : "旧消息没有 Provider 响应 trace，这里回退展示提取后的模型输出。",
            traceRaw: isPlanner
              ? {
                providerResponse: responseTrace || { bodyText: output?.content || "" },
                normalizedPlannerOutput: turnTrace.normalizedPlannerOutputRaw || {
                  decision: message.decision || {},
                  semanticAction: snapshot.semanticAction || message.semanticAction || {},
                },
              }
              : {
                providerResponse: responseTrace || { bodyText: output?.content || "" },
                visibleAnswer: message.paragraphs || [],
              },
          });
        }

        if (turn.stage === "planner" && (snapshot.actionReview || message.actionReview)) {
          const review = snapshot.actionReview || message.actionReview;
          steps.push({
            id: "action-review",
            tag: "审查",
            title: "权限和风险审查",
            summary: "这一步不重新理解语义，只判断能不能执行、是否需要确认。",
            rows: [
              ["审查结果", formatConfirmableText(review)],
              ["直接写入", review.permissions?.canApply || review.canApply ? "允许" : "不允许"],
              ["保护规则", normalizeDisplayList(review.guardrails, 4, 80).join("、") || "未记录"],
            ],
            raw: review,
            traceSource: "deterministic local review",
            traceNote: "这是本地规则审查结果，不是模型再次理解；它只判断能否执行、是否需要确认。",
            traceRaw: turnTrace.actionReviewRaw || review,
          });
        }
      }

      if (message.workflow) {
        steps.push({
          id: "workflow",
          tag: "workflow",
          title: "workflow 输入 → 输出",
          summary: "不同 action 的 workflow 会展示不同的输入和产物。",
          rows: getWorkflowReadableRows(message.workflow),
          raw: {
            request: message.workflow.request || {},
            result: message.workflow.result || {},
            artifacts: message.workflow.artifacts || [],
          },
          traceSource: "local workflow execution",
          traceNote: "这是 workflow 执行时收到的请求和产物结果；workflow 本身不再做大模型语义理解。",
          traceRaw: {
            request: turnTrace.workflowRequestRaw || message.workflow.request || {},
            result: turnTrace.workflowResultRaw?.result || message.workflow.result || {},
            artifacts: turnTrace.workflowResultRaw?.artifacts || message.workflow.artifacts || [],
          },
        });
      }

      steps.push({
        id: "ui-output",
        tag: "界面输出",
        title: "这轮最终给用户看到什么",
        summary: "主对话区只保留用户决策所需的信息。",
        rows: [
          ["回复状态", message.state || "完成"],
          ["主回复", trimDisplayText(getMessageText(message), 260)],
          ["待确认草稿", `${Array.isArray(message.pendingIds) ? message.pendingIds.length : 0} 个`],
          ["生成项", `${Array.isArray(message.generatedIds) ? message.generatedIds.length : 0} 个`],
        ],
        raw: {
          paragraphs: message.paragraphs || [],
          pendingIds: message.pendingIds || [],
          generatedIds: message.generatedIds || [],
          meta: message.meta || "",
        },
        traceSource: "client message render",
        traceNote: "这是最终进入主对话 UI 的消息状态和待确认引用。",
        traceRaw: {
          paragraphs: message.paragraphs || [],
          pendingIds: message.pendingIds || [],
          generatedIds: message.generatedIds || [],
          meta: message.meta || "",
        },
      });

      return steps;
    }

    function buildContextRelations(message) {
      const snapshot = message?.contextSnapshot || {};
      const relations = [
        ["用户输入", "本轮用户原话", "模型输入", "messages 最后一条 user 内容"],
      ];
      if (snapshot.semanticAction?.normalizedGoal) {
        relations.push(["模型输出", "semanticAction.normalizedGoal", "workflow 输入", "input.normalizedGoal"]);
      }
      if (snapshot.contextRequest || message.contextRequest) {
        const request = snapshot.contextRequest || message.contextRequest;
        const range = request.range || {};
        const rangeText = range.start && range.end ? `${range.start} 至 ${range.end}` : "未记录";
        if (snapshot.contextGuard?.applied) {
          relations.push(["Planner 输出", "contextGuard", "模型输出", "转为 contextRequest"]);
        }
        relations.push(["模型输出", "contextRequest", "待确认授权", `${rangeText} · ${(request.include || []).join("、")}`]);
      }
      if (message.workflow?.result?.items?.[0]) {
        const item = message.workflow.result.items[0];
        relations.push(["workflow 输出", "items[0]", "待确认草稿", `${item.startTime || "--"}${item.endTime ? `-${item.endTime}` : ""} ${item.title || ""}`.trim()]);
      } else if (message.workflow?.artifacts?.length) {
        relations.push(["workflow 输出", "artifacts", "待确认看板", `${message.workflow.artifacts.length} 个待确认产物`]);
      } else {
        relations.push(["模型输出", "Writer 输出", "主回复", trimDisplayText(getMessageText(message), 80)]);
      }
      return relations;
    }

    function renderContextRows(rows) {
      return `
        <dl class="sidebar-ai-context-kv">
          ${(Array.isArray(rows) ? rows : []).map(([label, value]) => `
            <dt>${escapeHtml(label)}</dt>
            <dd>${escapeHtml(value)}</dd>
          `).join("")}
        </dl>
      `;
    }

    function getAuditValueType(value) {
      if (Array.isArray(value)) return `array(${value.length})`;
      if (value === null) return "null";
      return typeof value;
    }

    const AI_AUDIT_FIELD_DESCRIPTIONS = {
      traceRaw: "这一块的原始记录。",
      raw: "旧版保存的原始记录。",
      userInputRaw: "用户这一轮说了什么。",
      contextInjectionRaw: "系统准备给模型参考的资料。",
      plannerRequestRaw: "发给理解模型的内容。",
      plannerResponseRaw: "理解模型返回的内容。",
      writerRequestRaw: "发给写回复模型的内容。",
      writerResponseRaw: "写回复模型返回的内容。",
      workflowRequestRaw: "交给本地流程处理的内容。",
      workflowResultRaw: "本地流程处理后的结果。",
      normalizedPlannerOutputRaw: "系统整理后的模型理解结果。",
      actionReviewRaw: "系统检查这件事能不能做、要不要确认。",
      providerResponse: "模型服务返回的完整记录。",
      modelContext: "模型参考的当前资料。",
      memoryContext: "这轮用到的记忆。",
      memoryPromptBlock: "放进模型输入里的记忆文字。",
      body: "实际发送或接收的主要内容。",
      bodyText: "完整原文。",
      parsedBody: "把原文拆成字段后的内容。",
      extractedText: "从返回结果里取出的正文。",
      headers: "请求或返回的附加信息，密钥会隐藏。",
      authorization: "登录或鉴权信息，这里必须隐藏。",
      method: "执行方式或请求方式。",
      url: "发送到的地址。",
      providerType: "使用的模型服务类型。",
      httpStatus: "请求成功或失败的状态码。",
      ok: "这次请求是否成功。",
      model: "使用的是哪个模型。",
      messages: "按顺序给模型看的消息。",
      role: "这条消息是谁说的。",
      content: "消息正文。",
      temperature: "回答自由度，越高越发散。",
      stream: "是否边生成边返回。",
      max_tokens: "最多允许模型写多长。",
      maxTokens: "最多允许模型写多长。",
      choices: "模型返回的候选答案。",
      message: "其中一条返回消息。",
      delta: "流式返回的一小段文字。",
      rawChunks: "流式返回的原始小段。",
      parsedDeltas: "从流式小段里取出的文字。",
      decision: "模型理解后给出的决定。",
      semanticAction: "模型理解出的要做的事。",
      contextRequest: "模型申请本轮查看更多数据的范围。",
      contextGrant: "用户已同意的本轮数据范围。",
      contextGuard: "Planner 后本地校验上下文范围是否足够。",
      contextAccessPolicy: "本轮时间数据参考策略。",
      type: "这条数据的类别。",
      tool: "模型选中的能力。",
      action: "本地实际要走的动作。",
      legacyAction: "为了兼容旧流程保留的动作名。",
      moduleId: "属于哪个能力模块。",
      normalizedGoal: "整理后的目标。",
      arguments: "准备交给工具使用的参数。",
      assumptions: "模型默认补上的信息。",
      missingFields: "还缺哪些信息。",
      warnings: "需要注意的问题。",
      confidence: "模型有多确定。",
      requiresConfirmation: "是否要你确认后才生效。",
      status: "当前状态。",
      permissions: "权限检查结果。",
      guardrails: "命中的保护规则。",
      canApply: "能不能直接写入。",
      canExecuteWithoutConfirmation: "能不能不确认直接执行。",
      request: "请求内容。",
      result: "处理结果。",
      artifacts: "生成的待确认内容。",
      items: "生成的待办条目。",
      title: "标题。",
      text: "原文。",
      targetDate: "目标日期。",
      range: "申请或授权的数据日期范围。",
      include: "申请或授权参考的数据类型。",
      entries: "实际时间记录。",
      dueDate: "待办日期。",
      startTime: "开始时间。",
      endTime: "结束时间。",
      customer: "客户或联系人。",
      priority: "优先级。",
      schema: "这份数据的版本标记。",
      requestId: "这轮请求的编号。",
      createdAt: "记录时间。",
      redactionReport: "哪些内容被隐藏了。",
      policy: "使用的规则说明。",
      maxStringLength: "最长显示多少字。",
      stages: "这轮经过的步骤。",
      stage: "当前步骤。",
      source: "来自哪里。",
      rawField: "对应的原始字段。",
    };

    function normalizeAuditPathForDescription(path) {
      return String(path || "")
        .replace(/\[\d+\]/g, "[]")
        .replace(/^(traceRaw|raw)\./, "");
    }

    function getAuditFieldDescription(path) {
      const normalizedPath = normalizeAuditPathForDescription(path);
      const segments = normalizedPath.split(".").filter(Boolean);
      const exact = AI_AUDIT_FIELD_DESCRIPTIONS[normalizedPath] || AI_AUDIT_FIELD_DESCRIPTIONS[String(path || "")];
      if (exact) return exact;
      for (let index = segments.length - 1; index >= 0; index -= 1) {
        const segment = segments[index].replace(/\[\]$/g, "");
        if (AI_AUDIT_FIELD_DESCRIPTIONS[segment]) return AI_AUDIT_FIELD_DESCRIPTIONS[segment];
      }
      return "";
    }

    function renderAuditDescription(path) {
      const description = getAuditFieldDescription(path);
      return description ? `<em>${escapeHtml(description)}</em>` : "";
    }

    function renderAuditPrimitive(path, value) {
      if (typeof value === "string") {
        const isLong = value.length > 520 || value.includes("\n");
        if (isLong) {
          return `
            <details class="sidebar-ai-context-audit-text">
              <summary>
                <code>${escapeHtml(path)}</code>
                <span>string · ${value.length} chars</span>
                ${renderAuditDescription(path)}
              </summary>
              <pre>${escapeHtml(value)}</pre>
            </details>
          `;
        }
        return `
          <div class="sidebar-ai-context-audit-field">
            <div class="sidebar-ai-context-audit-key">
              <code>${escapeHtml(path)}</code>
              ${renderAuditDescription(path)}
            </div>
            <span>${escapeHtml(value)}</span>
          </div>
        `;
      }
      return `
        <div class="sidebar-ai-context-audit-field">
          <div class="sidebar-ai-context-audit-key">
            <code>${escapeHtml(path)}</code>
            ${renderAuditDescription(path)}
          </div>
          <span>${escapeHtml(value === undefined ? "undefined" : JSON.stringify(value))}</span>
        </div>
      `;
    }

    function renderAuditValue(value, path = "root", depth = 0) {
      if (!value || typeof value !== "object") return renderAuditPrimitive(path, value);
      const entries = Array.isArray(value)
        ? value.map((item, index) => [`${path}[${index}]`, item])
        : Object.entries(value).map(([key, child]) => [`${path}.${key}`, child]);
      const emptyText = Array.isArray(value) ? "[]" : "{}";
      const openAttribute = depth < 2 ? " open" : "";
      return `
        <details class="sidebar-ai-context-audit-node"${openAttribute}>
          <summary>
            <code>${escapeHtml(path)}</code>
            <span>${escapeHtml(getAuditValueType(value))}</span>
            ${renderAuditDescription(path)}
          </summary>
          <div class="sidebar-ai-context-audit-children">
            ${entries.length
              ? entries.map(([childPath, child]) => renderAuditValue(child, childPath, depth + 1)).join("")
              : `<div class="sidebar-ai-context-audit-empty">${escapeHtml(emptyText)}</div>`}
          </div>
        </details>
      `;
    }

    function renderContextAuditBody(step) {
      const rawValue = step?.traceRaw !== undefined ? step.traceRaw : step?.raw;
      const sourcePath = step?.traceRaw !== undefined ? "traceRaw" : "raw";
      return `
        <div class="sidebar-ai-context-audit">
          <div class="sidebar-ai-context-audit-head">
            <span>${escapeHtml(sourcePath)}</span>
            <code>${escapeHtml(step?.id || "step")}</code>
          </div>
          ${renderAuditValue(rawValue, sourcePath)}
        </div>
      `;
    }

    function renderContextTraceBody(step) {
      const source = normalizeText(step?.traceSource || "本轮链路");
      const note = normalizeText(step?.traceNote || "这里展示更接近系统实际处理的数据；敏感字段会在后端写入前脱敏。", 600);
      const rawValue = step?.traceRaw !== undefined ? step.traceRaw : step?.raw;
      return `
        <p class="sidebar-ai-context-step-summary"><strong>${escapeHtml(source)}</strong> · ${escapeHtml(note)}</p>
        <pre class="sidebar-ai-context-raw">${escapeHtml(safeJsonStringify(rawValue))}</pre>
      `;
    }

    function renderContextDetailBody(step) {
      if (!step) return "";
      if (contextDetailMode === "audit") {
        return renderContextAuditBody(step);
      }
      if (contextDetailMode === "trace") return renderContextTraceBody(step);
      return `
        <p class="sidebar-ai-context-step-summary">${escapeHtml(step.summary || "")}</p>
        ${renderContextRows(step.rows)}
      `;
    }

    function renderContextRelations(message) {
      return buildContextRelations(message).map(([source, sourceValue, target, targetValue]) => `
        <div class="sidebar-ai-context-relation">
          <span><strong>${escapeHtml(source)}</strong>${escapeHtml(sourceValue)}</span>
          <i aria-hidden="true">→</i>
          <span><strong>${escapeHtml(target)}</strong>${escapeHtml(targetValue)}</span>
        </div>
      `).join("");
    }

    function renderContextDrawerContent(message) {
      const drawer = ensureContextDrawer();
      if (!drawer || !message) return;
      const body = drawer.querySelector?.("[data-ai-context-body]");
      if (!body) return;
      const steps = buildContextDetailSteps(message);
      if (!steps.some((step) => step.id === activeContextStepId)) {
        activeContextStepId = steps[0]?.id || "";
      }
      const activeStep = steps.find((step) => step.id === activeContextStepId) || steps[0] || null;
      body.innerHTML = `
        <div class="sidebar-ai-context-layout">
          <section class="sidebar-ai-context-flow" aria-label="本轮顺序链路">
            <div class="sidebar-ai-context-section-head">
              <span>输入到输出的顺序</span>
            </div>
            <div class="sidebar-ai-context-steps">
              ${steps.map((step, index) => `
                <button class="sidebar-ai-context-step${step.id === activeContextStepId ? " is-active" : ""}" type="button" data-ai-context-step="${escapeHtml(step.id)}">
                  <span>${index + 1}</span>
                  <strong>${escapeHtml(step.title)}</strong>
                  <small>${escapeHtml(step.tag)}</small>
                </button>
              `).join("")}
            </div>
          </section>
          <section class="sidebar-ai-context-detail" aria-label="当前步骤详情">
            <div class="sidebar-ai-context-detail-head">
              <span>${escapeHtml(activeStep?.tag || "")}</span>
              <strong>${escapeHtml(activeStep?.title || "本轮详情")}</strong>
            </div>
            ${renderContextDetailBody(activeStep)}
          </section>
        </div>
        <section class="sidebar-ai-context-relations" aria-label="关键字段流向">
          <div class="sidebar-ai-context-section-head">
            <span>关键字段流向</span>
          </div>
          ${renderContextRelations(message)}
        </section>
      `;
      drawer.querySelectorAll?.("[data-ai-context-mode]").forEach((button) => {
        button.classList.toggle("is-active", button.dataset.aiContextMode === contextDetailMode);
      });
    }

    function ensureContextDrawer() {
      if (contextDrawer) return contextDrawer;
      if (!documentRef || typeof documentRef.createElement !== "function") return null;
      const host = documentRef.body || sidebar || panel;
      if (!host || typeof host.appendChild !== "function") return null;
      contextDrawer = documentRef.createElement("aside");
      contextDrawer.className = "sidebar-ai-context-drawer";
      contextDrawer.setAttribute("aria-label", "本轮详情");
      contextDrawer.setAttribute("aria-hidden", "true");
      contextDrawer.hidden = true;
      contextDrawer.innerHTML = `
        <div class="sidebar-ai-context-drawer-head">
          <div>
            <strong data-ai-context-title>本轮详情</strong>
            <span data-ai-context-subtitle>按真实发生顺序展示输入、模型输出和 workflow 产物</span>
          </div>
          <div class="sidebar-ai-context-mode" aria-label="显示模式">
            <button class="is-active" type="button" data-ai-context-mode="readable">解读模式</button>
            <button type="button" data-ai-context-mode="audit">审计数据</button>
            <button type="button" data-ai-context-mode="trace">原始链路</button>
          </div>
          <button class="sidebar-ai-context-close" type="button" data-ai-context-close aria-label="关闭模型输入预览">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
              <path d="M18 6 6 18"></path>
              <path d="m6 6 12 12"></path>
            </svg>
          </button>
        </div>
        <div class="sidebar-ai-context-body" data-ai-context-body></div>
      `;
      contextDrawer.addEventListener("click", (event) => {
        const close = event.target?.closest?.("[data-ai-context-close]");
        if (close) {
          closeContextDrawer();
          return;
        }
        const mode = event.target?.closest?.("[data-ai-context-mode]");
        if (mode) {
          contextDetailMode = ["readable", "audit", "trace"].includes(mode.dataset.aiContextMode)
            ? mode.dataset.aiContextMode
            : "readable";
          renderContextDrawerContent(getMessageById(activeContextMessageId));
          return;
        }
        const step = event.target?.closest?.("[data-ai-context-step]");
        if (step) selectContextStep(step.dataset.aiContextStep);
      });
      host.appendChild(contextDrawer);
      return contextDrawer;
    }

    function selectContextStep(stepId) {
      const nextStepId = normalizeText(stepId);
      if (!nextStepId) return;
      activeContextStepId = nextStepId;
      renderContextDrawerContent(getMessageById(activeContextMessageId));
    }

    function closeContextDrawer() {
      const drawer = ensureContextDrawer();
      if (!drawer) return;
      drawer.hidden = true;
      drawer.setAttribute("aria-hidden", "true");
      activeContextMessageId = "";
      activeContextStepId = "";
      renderMessages({ scroll: "preserve" });
    }

    function openContextDrawer(messageId) {
      const message = getMessageById(messageId);
      if (!hasContextSnapshot(message)) return;
      const drawer = ensureContextDrawer();
      if (!drawer) return;
      const snapshot = message.contextSnapshot;
      activeContextMessageId = message.id;
      activeContextStepId = "";
      drawer.hidden = false;
      drawer.setAttribute("aria-hidden", "false");
      const title = drawer.querySelector?.("[data-ai-context-title]");
      const subtitle = drawer.querySelector?.("[data-ai-context-subtitle]");
      const turns = getContextModelInputTurns(snapshot);
      if (title) title.textContent = "本轮详情";
      if (subtitle) subtitle.textContent = `${snapshot.requestId || message.id} · ${turns.map((turn) => turn.label).join(" + ") || "无模型输入"} · ${message.workflow ? "含 workflow" : "无 workflow"}`;
      renderContextDrawerContent(message);
      renderMessages({ scroll: "preserve" });
    }

    function setStatus(message) {
      if (!status) return;
      status.textContent = String(message || "AI 工作台准备中。");
    }

    function setBusy(nextValue) {
      isBusy = Boolean(nextValue);
      for (const button of actionButtons) {
        button.disabled = isBusy;
      }
      const submitButton = form?.querySelector("button[type='submit']");
      if (submitButton) submitButton.disabled = isBusy;
      if (contextScopeButton) contextScopeButton.disabled = isBusy;
    }

    function scheduleTimeout(handler, delay) {
      const timeoutFn = typeof windowRef.setTimeout === "function" ? windowRef.setTimeout.bind(windowRef) : setTimeout;
      return timeoutFn(handler, delay);
    }

    function clearScheduledTimeout(timer) {
      if (!timer) return;
      const clearTimeoutFn =
        typeof windowRef.clearTimeout === "function" ? windowRef.clearTimeout.bind(windowRef) : clearTimeout;
      clearTimeoutFn(timer);
    }

    function getAnimationTime() {
      return Number(windowRef.performance?.now?.() || Date.now());
    }

    function formatAssistantElapsedTime(startedAt, endedAt = getAnimationTime()) {
      const elapsedMs = Math.max(0, Number(endedAt || 0) - Number(startedAt || 0));
      const totalSeconds = Math.max(1, Math.round(elapsedMs / 1000));
      if (totalSeconds < 60) return `${totalSeconds}s`;
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;
      return seconds ? `${minutes}min ${seconds}s` : `${minutes}min`;
    }

    function startActiveTurnScroll(userMessageId, assistantMessageId) {
      cancelThreadScrollAnimation();
      activeTurnScroll = {
        userMessageId,
        assistantMessageId,
        mode: "anchor-start",
      };
    }

    function finishActiveTurnScroll() {
      activeTurnScroll = null;
    }

    function clearNextActionsTimer() {
      clearScheduledTimeout(nextActionsTimer);
      nextActionsTimer = null;
    }

    function revealPendingNextActions() {
      const messageId = nextActionsPendingMessageId;
      clearNextActionsTimer();
      if (!messageId) return;
      let didReveal = false;
      messages = messages.map((message) => {
        if (message.id === messageId && message.actionsPending) {
          didReveal = true;
          return { ...message, actionsPending: false, showActions: true };
        }
        if (message.role === "assistant") {
          return { ...message, actionsPending: false, showActions: false };
        }
        return message;
      });
      nextActionsPendingMessageId = "";
      if (didReveal) {
        renderMessages();
        ensureNextActionsVisible(messageId);
      }
    }

    function resetNextActionsIdleTimer() {
      if (!nextActionsPendingMessageId) return;
      clearNextActionsTimer();
      nextActionsTimer = scheduleTimeout(revealPendingNextActions, nextActionIdleDelayMs);
    }

    function queueNextActionsForMessage(messageId) {
      if (!messageId) return;
      clearNextActionsTimer();
      nextActionsPendingMessageId = messageId;
      let didQueue = false;
      messages = messages.map((message) => {
        if (message.id === messageId) {
          didQueue = true;
          return { ...message, actionsPending: true, showActions: false };
        }
        if (message.role === "assistant") {
          return { ...message, actionsPending: false, showActions: false };
        }
        return message;
      });
      if (!didQueue) {
        nextActionsPendingMessageId = "";
        return;
      }
      renderMessages();
      resetNextActionsIdleTimer();
    }

    function handleAiPageActivity() {
      resetNextActionsIdleTimer();
    }

    function isOpen() {
      return Boolean(panel && (embedded || !panel.hidden));
    }

    function open({ focusInput = true } = {}) {
      if (!panel) return;
      panel.hidden = false;
      panel.setAttribute("aria-hidden", "false");
      if (!embedded) {
        sidebar?.classList.add("is-ai-open");
      }
      dockButton?.setAttribute("aria-expanded", "true");

      if (focusInput && input && typeof input.focus === "function") {
        scheduleTimeout(() => input.focus(), 0);
      }
    }

    function close({ focusDock = false } = {}) {
      if (!panel) return;
      if (embedded) {
        panel.hidden = false;
        panel.setAttribute("aria-hidden", "false");
        return;
      }
      panel.hidden = true;
      panel.setAttribute("aria-hidden", "true");
      sidebar?.classList.remove("is-ai-open");
      dockButton?.setAttribute("aria-expanded", "false");

      if (focusDock && dockButton && typeof dockButton.focus === "function") {
        dockButton.focus();
      }
    }

    function toggle() {
      if (isOpen()) {
        close({ focusDock: true });
        return;
      }
      open();
    }

    function getPendingStatusLabel(item) {
      if (item.status === "confirmed") return "已确认";
      if (item.status === "rejected") return "已拒绝";
      if (item.type === "context_request") return "授权";
      if (item.type === "memory_proposal") return getMemoryProposalLabel(item.payload);
      if (item.type === "schedule_draft") return "draft";
      return "todo";
    }

    function getMemoryProposalLabel(proposal = {}) {
      const type = normalizeText(proposal.type);
      if (type === "capability_request") return "能力需求";
      if (type === "playbook") return "经验方法";
      if (type === "boundary") return "时间边界";
      if (type === "rule") return "执行规则";
      if (type === "habit") return "习惯";
      if (type === "preference") return "偏好";
      if (type === "principle") return "原则";
      return "记忆";
    }

    function getMemoryProposalPendingEffect(proposal = {}) {
      const type = normalizeText(proposal.type);
      if (type === "capability_request") {
        return "现在只是能力需求提案；确认后会进入需求池，不代表功能已经可用，也不会注入给模型当作执行规则。";
      }
      if (type === "playbook") {
        return "现在只是经验方法提案；确认后会进入 active memory，帮助后续拆解任务、复盘和对话表达。";
      }
      return "现在只是记忆提案，确认后才会进入 active memory，并指导后续任务录入和排程。";
    }

    function getMemoryProposalConfirmedMessage(proposal = {}) {
      const type = normalizeText(proposal.type);
      if (type === "capability_request") {
        return "这条能力需求已经进入需求池；它不会作为已启用功能执行，也不会注入给模型当作规则。";
      }
      if (type === "playbook") {
        return "这条经验方法已经进入 active memory，会用于后续拆解任务、复盘和相关对话。";
      }
      return "这条记忆已经进入 active memory，会用于后续任务录入和排程建议。";
    }

    function renderGeneratedBlock(items) {
      if (!items.length) return "";
      return `
        <section class="sidebar-ai-generated" aria-label="AI 生成草稿">
          <div class="sidebar-ai-section-head">
            <span>本轮生成</span>
            <span class="sidebar-ai-count">${escapeHtml(items.length)}</span>
          </div>
          <div class="sidebar-ai-generated-list">
            ${items.map((item) => `
              <div class="sidebar-ai-generated-row">
                <span class="sidebar-ai-file-icon" aria-hidden="true">${escapeHtml(item.icon || "稿")}</span>
                <span class="sidebar-ai-row-main">
                  <strong>${escapeHtml(item.title)}</strong>
                  <small>${escapeHtml(item.detail || "")}</small>
                </span>
                <button type="button" data-ai-generated-id="${escapeHtml(item.id)}">查看</button>
              </div>
            `).join("")}
          </div>
        </section>
      `;
    }

    function renderPendingBlock(items) {
      const activeItems = items.filter((item) => item.status === "pending");
      if (!activeItems.length) return "";
      return `
        <section class="sidebar-ai-pending-card" aria-label="待确认草稿">
          <div class="sidebar-ai-section-head">
            <span>待确认</span>
            <span class="sidebar-ai-count">${escapeHtml(activeItems.length)}</span>
          </div>
          <div class="sidebar-ai-pending-list">
            ${activeItems
              .map((item) => {
                const preview = Array.isArray(item.preview) && item.preview.length
                  ? `<div class="sidebar-ai-mini-timeline">${item.preview
                    .map((preview) => `
                      <span class="sidebar-ai-mini-block">
                        <strong>${escapeHtml(preview.time || "")}</strong>
                        <span>${escapeHtml(preview.text || "")}</span>
                      </span>
                    `)
                    .join("")}</div>`
                  : "";
                return `
                  <article class="sidebar-ai-pending-item" data-ai-pending-item="${escapeHtml(item.id)}">
                    <div class="sidebar-ai-pending-top">
                      <span>
                        <span class="sidebar-ai-pending-title">${escapeHtml(item.title)}</span>
                        <span class="sidebar-ai-pending-detail">${escapeHtml(item.detail || "")}</span>
                      </span>
                      <span class="sidebar-ai-chip ${item.type === "schedule_draft" ? "is-accent" : ""}">${escapeHtml(getPendingStatusLabel(item))}</span>
                    </div>
                    ${preview}
                    <div class="sidebar-ai-confirm-actions">
                      <button class="primary" type="button" data-ai-pending-action="confirm" data-ai-pending-id="${escapeHtml(item.id)}">${item.type === "context_request" ? "允许" : "确认"}</button>
                      <button class="secondary" type="button" data-ai-pending-action="edit" data-ai-pending-id="${escapeHtml(item.id)}">${item.type === "context_request" ? "修改问题" : "编辑"}</button>
                      <button class="danger" type="button" data-ai-pending-action="reject" data-ai-pending-id="${escapeHtml(item.id)}">${item.type === "context_request" ? "不允许" : "拒绝"}</button>
                    </div>
                  </article>
                `;
              })
              .join("")}
          </div>
        </section>
      `;
    }

    function renderSemanticRow(label, value) {
      const text = trimDisplayText(value, 220);
      if (!text) return "";
      return `
        <div class="sidebar-ai-semantic-row">
          <span class="sidebar-ai-semantic-label">${escapeHtml(label)}</span>
          <span class="sidebar-ai-semantic-value">${escapeHtml(text)}</span>
        </div>
      `;
    }

    function renderSemanticChipRow(label, items, tone = "") {
      const list = normalizeDisplayList(items, 5, 90);
      if (!list.length) return "";
      const toneClass = tone ? ` ${tone}` : "";
      return `
        <div class="sidebar-ai-semantic-row">
          <span class="sidebar-ai-semantic-label">${escapeHtml(label)}</span>
          <span class="sidebar-ai-semantic-chip-row">
            ${list.map((item) => `<span class="sidebar-ai-semantic-chip${toneClass}">${escapeHtml(item)}</span>`).join("")}
          </span>
        </div>
      `;
    }

    function getActionReviewLabel(review) {
      if (!review) return "";
      if (review.status === "blocked") return "已阻止";
      if (review.status === "needs_confirmation") return "需确认";
      if (review.status === "needs_review") return "需复核";
      if (review.status === "allowed") return review.canExecuteWithoutConfirmation ? "可执行" : "已审查";
      return review.status;
    }

    function getActionReviewDetail(review) {
      if (!review) return "";
      if (review.status === "blocked") return "系统审查已阻止这次操作。";
      if (review.status === "needs_confirmation") return "只会生成待确认草稿，确认前不会写入本地数据。";
      if (review.status === "needs_review") return "存在缺字段或提醒，建议确认理解后再继续。";
      if (review.status === "allowed") return "这次不需要写入本地数据。";
      return "";
    }

    function getMissingFieldLabel(review) {
      return review?.status === "blocked" || review?.status === "needs_review" ? "缺字段" : "可补充";
    }

    function getWarningLabel(review) {
      return review?.status === "blocked" ? "风险" : "提示";
    }

    function renderSemanticActionBlock(value, reviewValue, messageId = "") {
      const semantic = normalizeSemanticAction(value);
      const review = normalizeActionReview(reviewValue);
      if (!semantic) return "";
      const execution = semantic.tool || semantic.action;
      const refs = [
        ...semantic.contextRefs,
        ...semantic.memoryRefs.map((item) => `记忆：${item}`),
      ];
      const confidenceText = semantic.confidence === null ? "" : `${Math.round(semantic.confidence * 100)}%`;
      const reviewLabel = getActionReviewLabel(review);
      const rows = [
        renderSemanticRow("我理解为", semantic.normalizedGoal),
        renderSemanticRow("将执行", execution),
        renderSemanticRow("审查", reviewLabel ? `${reviewLabel}：${getActionReviewDetail(review)}` : ""),
        renderSemanticChipRow("参考", refs),
        renderSemanticChipRow("假设", semantic.assumptions),
        renderSemanticChipRow(getMissingFieldLabel(review), semantic.missingFields, "is-warning"),
        renderSemanticChipRow(getWarningLabel(review), semantic.warnings, review?.status === "blocked" ? "is-danger" : "is-warning"),
        renderSemanticRow("可信度", confidenceText),
      ].filter(Boolean);
      if (!rows.length) return "";
      return `
        <section class="sidebar-ai-semantic-card" aria-label="AI 理解与操作">
          <div class="sidebar-ai-section-head">
            <span>理解与操作</span>
            <span class="sidebar-ai-count">${escapeHtml(reviewLabel || (semantic.requiresConfirmation ? "需确认" : "建议"))}</span>
          </div>
          <div class="sidebar-ai-semantic-list">
            ${rows.join("")}
          </div>
          <div class="sidebar-ai-semantic-actions">
            <button type="button" data-ai-semantic-retry="${escapeHtml(messageId)}">重新理解</button>
          </div>
        </section>
      `;
    }

    function renderActionBlock() {
      const actions = [
        ["smart-next", "智", "智能匹配下一步", "按当前待办和时间原则生成建议"],
        ["plan-today", "今", "规划今天", "生成今日排程草稿"],
        ["explore-principles", "问", "探索原则", "引导梳理时间管理偏好"],
        ["save-memory", "记", "把原则记下来", "先进入 memory proposal"],
      ];
      return `
        <section class="sidebar-ai-next-card" aria-label="快捷动作">
          <div class="sidebar-ai-section-head">
            <span>下一步</span>
            <span aria-hidden="true">›</span>
          </div>
          <div class="sidebar-ai-action-list">
            ${actions.map(([action, icon, title, detail]) => `
              <button class="sidebar-ai-action-row" data-ai-action="${escapeHtml(action)}" type="button">
                <span class="sidebar-ai-action-icon" aria-hidden="true">${escapeHtml(icon)}</span>
                <span>
                  <strong>${escapeHtml(title)}</strong>
                  <small>${escapeHtml(detail)}</small>
                </span>
                <span aria-hidden="true">›</span>
              </button>
            `).join("")}
          </div>
        </section>
      `;
    }

    function renderMessageBlocks(message) {
      if (message.role !== "assistant") return "";
      const generatedIds = Array.isArray(message.generatedIds) ? message.generatedIds : [];
      const pendingIds = Array.isArray(message.pendingIds) ? message.pendingIds : [];
      const generated = generatedIds
        .map((id) => generatedItems.find((item) => item.id === id))
        .filter(Boolean);
      const pending = pendingIds
        .map((id) => pendingItems.find((item) => item.id === id))
        .filter(Boolean);
      const blocks = [
        renderSemanticActionBlock(
          message.semanticAction || message.contextSnapshot?.semanticAction,
          message.actionReview || message.contextSnapshot?.actionReview,
          message.id,
        ),
        renderGeneratedBlock(generated),
        renderPendingBlock(pending),
        message.showActions ? renderActionBlock() : "",
      ].filter(Boolean);
      return blocks.length ? `<div class="sidebar-ai-message-block">${blocks.join("")}</div>` : "";
    }

    function getCurrentProviderIdentity() {
      const logoKey = AI_PROVIDER_LOGO_FILES[currentProviderIdentity.logoKey]
        ? currentProviderIdentity.logoKey
        : "generic";
      return {
        label: normalizeText(currentProviderIdentity.label, "模型"),
        logoKey,
      };
    }

    function renderMessageAuthor(message) {
      if (message.role !== "assistant") {
        return `<span class="sidebar-ai-message-author">${escapeHtml("你")}</span>`;
      }
      const identity = getCurrentProviderIdentity();
      const logoFile = AI_PROVIDER_LOGO_FILES[identity.logoKey] || AI_PROVIDER_LOGO_FILES.generic;
      return `
        <span class="sidebar-ai-message-author sidebar-ai-message-author--model">
          <img class="sidebar-ai-message-model-logo" src="${escapeHtml(`${AI_PROVIDER_LOGO_BASE}${logoFile}`)}" alt="" aria-hidden="true" />
          <span>${escapeHtml(identity.label)}</span>
        </span>
      `;
    }

    function getAssistantStateIcon(state) {
      const text = normalizeText(state, "完成");
      if (text === "完成" || text === "已确认") return "✓";
      if (text === "生成中" || text === "运行中") return "✦";
      if (text === "失败") return "!";
      if (text === "已拒绝") return "×";
      if (text === "需要输入") return "?";
      if (text === "待确认") return "!";
      if (text === "草稿") return "◇";
      return "•";
    }

    function renderMessageState(message, state) {
      const text = normalizeText(state, message.role === "user" ? "刚刚" : "完成");
      if (message.role !== "assistant") {
        return `<span class="sidebar-ai-message-state sidebar-ai-message-state--user">${escapeHtml(text)}</span>`;
      }
      if (text === "连接中") {
        return `<span class="sidebar-ai-message-state sidebar-ai-message-state--thinking" aria-label="正在连接">connecting......</span>`;
      }
      const icon = getAssistantStateIcon(text);
      const tone = text === "失败" || text === "已拒绝"
        ? "danger"
        : text === "需要输入" || text === "待确认"
          ? "attention"
          : text === "生成中" || text === "运行中"
            ? "active"
            : "done";
      return `<span class="sidebar-ai-message-state sidebar-ai-message-state--icon sidebar-ai-message-state--${tone}" aria-label="${escapeHtml(text)}" title="${escapeHtml(text)}">${escapeHtml(icon)}</span>`;
    }

    function shouldRenderActiveTurnSpacer(message) {
      if (!activeTurnScroll) return false;
      if (activeTurnScroll.assistantMessageId) {
        return message.id === activeTurnScroll.assistantMessageId;
      }
      return message.id === activeTurnScroll.userMessageId;
    }

    function renderActiveTurnSpacer(message) {
      if (!shouldRenderActiveTurnSpacer(message)) return "";
      return `<div class="sidebar-ai-turn-spacer" data-ai-turn-spacer="${escapeHtml(message.id)}" aria-hidden="true"></div>`;
    }

    function findThreadNodeByMessageId(messageId) {
      if (!thread || !messageId || typeof thread.querySelector !== "function") return null;
      return thread.querySelector(`[data-ai-message-id="${messageId}"]`);
    }

    function findActiveTurnSpacer() {
      if (!thread || !activeTurnScroll || typeof thread.querySelector !== "function") return null;
      const spacerId = activeTurnScroll.assistantMessageId || activeTurnScroll.userMessageId;
      return thread.querySelector(`[data-ai-turn-spacer="${spacerId}"]`);
    }

    function getElementTop(element) {
      return Number(element?.offsetTop || 0);
    }

    function getElementBottom(element) {
      return getElementTop(element) + Number(element?.offsetHeight || 0);
    }

    function getThreadViewportHeight() {
      return Number(threadViewport?.clientHeight || 0);
    }

    function getClampedThreadScrollTop(value) {
      if (!threadViewport) return 0;
      const maxScrollTop = Math.max(
        0,
        Number(threadViewport.scrollHeight || 0) - Number(threadViewport.clientHeight || 0),
      );
      return Math.max(0, Math.min(Number(value || 0), maxScrollTop));
    }

    function writeThreadScrollTop(value) {
      if (!threadViewport) return 0;
      const nextScrollTop = getClampedThreadScrollTop(value);
      threadViewport.scrollTop = nextScrollTop;
      return nextScrollTop;
    }

    function cancelThreadScrollAnimation() {
      if (!threadScrollAnimation) return;
      clearScheduledTimeout(threadScrollAnimation.timer);
      threadScrollAnimation = null;
    }

    function easeOutCubic(progress) {
      return 1 - ((1 - progress) ** 3);
    }

    function stepThreadScrollAnimation() {
      if (!threadScrollAnimation || !threadViewport) return;
      const now = getAnimationTime();
      const elapsed = Math.max(0, now - threadScrollAnimation.startedAt);
      const progress = Math.min(1, elapsed / AI_TURN_SCROLL_ANIMATION_MS);
      const eased = easeOutCubic(progress);
      const nextScrollTop = threadScrollAnimation.from
        + ((threadScrollAnimation.target - threadScrollAnimation.from) * eased);
      writeThreadScrollTop(nextScrollTop);
      if (progress >= 1) {
        writeThreadScrollTop(threadScrollAnimation.target);
        threadScrollAnimation = null;
        return;
      }
      threadScrollAnimation.timer = scheduleTimeout(stepThreadScrollAnimation, AI_TURN_SCROLL_STEP_MS);
    }

    function setThreadScrollTop(value, options = {}) {
      if (!threadViewport) return;
      const nextScrollTop = getClampedThreadScrollTop(value);
      const currentScrollTop = Number(threadViewport.scrollTop || 0);
      if (!options.animate || Math.abs(nextScrollTop - currentScrollTop) < AI_TURN_SCROLL_MIN_DELTA_PX) {
        cancelThreadScrollAnimation();
        writeThreadScrollTop(nextScrollTop);
        return;
      }
      if (threadScrollAnimation) {
        threadScrollAnimation.target = nextScrollTop;
        return;
      }
      threadScrollAnimation = {
        from: currentScrollTop,
        target: nextScrollTop,
        startedAt: getAnimationTime(),
        timer: null,
      };
      stepThreadScrollAnimation();
    }

    function ensureNextActionsVisible(messageId) {
      if (!threadViewport || !messageId) return;
      const messageNode = findThreadNodeByMessageId(messageId);
      const viewportHeight = getThreadViewportHeight();
      if (!messageNode || !viewportHeight) return;
      const viewportBottom = Number(threadViewport.scrollTop || 0) + viewportHeight;
      const requiredBottom = getElementBottom(messageNode) + AI_NEXT_ACTION_VISIBLE_MARGIN_PX;
      if (requiredBottom <= viewportBottom) {
        if (threadViewport.dataset) threadViewport.dataset.aiNextActionVisibilityAdjusted = "0";
        return;
      }
      const overflow = requiredBottom - viewportBottom;
      setThreadScrollTop(Number(threadViewport.scrollTop || 0) + overflow, { animate: true });
      if (threadViewport.dataset) threadViewport.dataset.aiNextActionVisibilityAdjusted = "1";
    }

    function syncActiveTurnSpacer() {
      const spacer = findActiveTurnSpacer();
      if (!spacer || !activeTurnScroll) return;
      const viewportHeight = getThreadViewportHeight();
      const userNode = findThreadNodeByMessageId(activeTurnScroll.userMessageId);
      const assistantNode = findThreadNodeByMessageId(activeTurnScroll.assistantMessageId);
      const endNode = assistantNode || userNode;
      const activeHeight = userNode && endNode ? getElementBottom(endNode) - getElementTop(userNode) : 0;
      const spacerHeight = viewportHeight > 0 ? Math.max(0, viewportHeight - activeHeight - 8) : 0;
      if (spacer.style) spacer.style.height = `${Math.round(spacerHeight)}px`;
    }

    function setActiveTurnScrollDataset(mode, turnHeight, viewportHeight) {
      if (!threadViewport?.dataset || !activeTurnScroll) return;
      threadViewport.dataset.aiScrollMode = mode;
      threadViewport.dataset.aiScrollAnchor = activeTurnScroll.userMessageId;
      threadViewport.dataset.aiScrollAnchorTopOffset = String(AI_TURN_ANCHOR_TOP_OFFSET_PX);
      threadViewport.dataset.aiScrollTurnHeight = String(Math.round(turnHeight));
      threadViewport.dataset.aiScrollViewportHeight = String(Math.round(viewportHeight));
    }

    function applyActiveTurnScroll() {
      if (!threadViewport || !activeTurnScroll) return false;
      const userNode = findThreadNodeByMessageId(activeTurnScroll.userMessageId);
      const assistantNode = findThreadNodeByMessageId(activeTurnScroll.assistantMessageId);
      const endNode = assistantNode || userNode;
      if (!userNode || !endNode) return false;
      const viewportHeight = getThreadViewportHeight();
      const turnTop = getElementTop(userNode);
      const turnBottom = getElementBottom(endNode);
      const turnHeight = Math.max(0, turnBottom - turnTop);
      const shouldFollowOutput = viewportHeight && turnHeight > viewportHeight;
      if (activeTurnScroll.mode === "anchor-start" && activeTurnScroll.assistantMessageId && !assistantNode) {
        setActiveTurnScrollDataset("anchor-start", turnHeight, viewportHeight);
        return true;
      }
      if (shouldFollowOutput || activeTurnScroll.mode === "stream-follow") {
        activeTurnScroll.mode = "stream-follow";
        setThreadScrollTop(turnBottom - viewportHeight);
        setActiveTurnScrollDataset("stream-follow", turnHeight, viewportHeight);
        return true;
      }
      if (activeTurnScroll.mode === "anchor-start") {
        activeTurnScroll.mode = "stream-stable";
        setThreadScrollTop(turnTop - AI_TURN_ANCHOR_TOP_OFFSET_PX, { animate: true });
      }
      setActiveTurnScrollDataset(activeTurnScroll.mode || "stream-stable", turnHeight, viewportHeight);
      return true;
    }

    function applyThreadScroll(options = {}) {
      if (!threadViewport) return;
      const scrollMode = options.scroll || (activeTurnScroll ? "active-turn" : "preserve");
      if (scrollMode === "active-turn" && applyActiveTurnScroll()) return;
      if (scrollMode === "bottom") {
        setThreadScrollTop(threadViewport.scrollHeight || 0);
        if (threadViewport.dataset) threadViewport.dataset.aiScrollMode = "bottom";
      }
    }

    function renderMessages(options = {}) {
      if (!thread) return;
      thread.innerHTML = messages
        .slice(-24)
        .map((message) => {
          const state = message.state || (message.role === "user" ? "刚刚" : "完成");
          const paragraphs = renderMessageParagraphs(message);
          const meta = message.meta
            ? `<div class="sidebar-ai-message-meta"><span>${escapeHtml(message.meta)}</span></div>`
            : "";
          return `
            <article class="sidebar-ai-message sidebar-ai-message--${message.role}" data-ai-message-id="${escapeHtml(message.id)}" data-ai-message-role="${escapeHtml(message.role)}">
              <div class="sidebar-ai-message-head">
                ${renderMessageAuthor(message)}
                ${renderMessageState(message, state)}
              </div>
              ${paragraphs}
              ${meta}
              ${renderMessageBlocks(message)}
            </article>
            ${renderActiveTurnSpacer(message)}
          `;
        })
        .join("");
      syncActiveTurnSpacer();
      applyThreadScroll(options);
    }

    function appendMessage(message, options = {}) {
      const normalized = {
        id: message.id || createId("msg"),
        role: message.role || "assistant",
        state: message.state || "",
        paragraphs: Array.isArray(message.paragraphs) ? message.paragraphs : [message.text || ""],
        meta: message.meta || "",
        generatedIds: Array.isArray(message.generatedIds) ? message.generatedIds : [],
        pendingIds: Array.isArray(message.pendingIds) ? message.pendingIds : [],
        semanticAction: message.semanticAction && typeof message.semanticAction === "object" ? message.semanticAction : null,
        actionReview: message.actionReview && typeof message.actionReview === "object" ? message.actionReview : null,
        decision: message.decision && typeof message.decision === "object" ? message.decision : null,
        workflow: message.workflow && typeof message.workflow === "object" ? message.workflow : null,
        showActions: Boolean(message.showActions),
        actionsPending: Boolean(message.actionsPending),
        streamText: message.streamText || "",
        contextSnapshot: message.contextSnapshot && typeof message.contextSnapshot === "object" ? message.contextSnapshot : null,
      };
      if (normalized.role === "assistant") {
        clearNextActionsTimer();
        nextActionsPendingMessageId = "";
        messages = messages.map((current) => ({ ...current, actionsPending: false, showActions: false }));
      }
      messages.push(normalized);
      if (messages.length > 24) messages = messages.slice(-24);
      if (options.render !== false) {
        renderMessages({ scroll: options.scroll || (activeTurnScroll ? "active-turn" : "bottom") });
      }
      return normalized;
    }

    function getMessageText(message) {
      const paragraphs = Array.isArray(message?.paragraphs) ? message.paragraphs : [message?.text || ""];
      return paragraphs.map((paragraph) => normalizeText(paragraph)).filter(Boolean).join("\n");
    }

    function buildAssistantHistory(options = {}) {
      const excludeLatestUserText = normalizeText(options.excludeLatestUserText, "");
      const history = [];
      let excludedCurrentUserText = false;
      for (let index = messages.length - 1; index >= 0 && history.length < 8; index -= 1) {
        const message = messages[index];
        if (!message || message.id === "welcome") continue;
        const role = message.role === "assistant" ? "assistant" : "user";
        const content = getMessageText(message);
        if (!content) continue;
        if (
          !excludedCurrentUserText &&
          excludeLatestUserText &&
          role === "user" &&
          content === excludeLatestUserText
        ) {
          excludedCurrentUserText = true;
          continue;
        }
        history.push({ role, content });
      }
      return history.reverse();
    }

    function renderGeneratedItems() {
      renderMessages();
    }

    function renderPendingItems() {
      renderMessages();
    }

    function updateMessage(messageId, updater) {
      if (!messageId || typeof updater !== "function") return null;
      let nextMessage = null;
      messages = messages.map((message) => {
        if (message.id !== messageId) return message;
        nextMessage = updater(message) || message;
        return nextMessage;
      });
      renderMessages();
      return nextMessage;
    }

    function setMessageState(messageId, state) {
      updateMessage(messageId, (message) => ({ ...message, state: state || message.state }));
    }

    function getMessageById(messageId) {
      return messages.find((message) => message.id === messageId) || null;
    }

    function getDeltaBuffer(messageId) {
      if (!deltaBuffers.has(messageId)) {
        deltaBuffers.set(messageId, { text: "", timer: null });
      }
      return deltaBuffers.get(messageId);
    }

    function takeReadableDeltaChunk(text, force = false) {
      const value = String(text || "");
      if (!value || force) return value;
      const limit =
        value.length > AI_DISPLAY_BACKLOG_CHARS
          ? Math.min(value.length, AI_DISPLAY_MAX_CHARS * 2)
          : Math.min(value.length, AI_DISPLAY_MAX_CHARS);
      const minLength = Math.min(value.length, AI_DISPLAY_MIN_CHARS);
      const candidate = value.slice(0, limit);
      for (let index = minLength - 1; index < candidate.length; index += 1) {
        if (AI_DISPLAY_SENTENCE_BOUNDARY.test(candidate[index])) {
          return candidate.slice(0, index + 1);
        }
      }
      return candidate;
    }

    function applyAssistantDelta(messageId, delta) {
      const text = String(delta || "");
      if (!text) return;
      updateMessage(messageId, (message) => {
        const streamText = `${message.streamText || ""}${text}`;
        return {
          ...message,
          state: "生成中",
          streamText,
          paragraphs: splitAssistantAnswer(streamText),
        };
      });
    }

    function scheduleAssistantDeltaFlush(messageId) {
      const buffer = getDeltaBuffer(messageId);
      if (buffer.timer) return;
      buffer.timer = scheduleTimeout(() => {
        buffer.timer = null;
        flushAssistantDeltaBuffer(messageId);
      }, AI_DISPLAY_FLUSH_INTERVAL_MS);
    }

    function flushAssistantDeltaBuffer(messageId, options = {}) {
      const buffer = deltaBuffers.get(messageId);
      if (!buffer) return;
      clearScheduledTimeout(buffer.timer);
      buffer.timer = null;

      if (!buffer.text) {
        deltaBuffers.delete(messageId);
        return;
      }

      const chunk = takeReadableDeltaChunk(buffer.text, Boolean(options.force));
      buffer.text = buffer.text.slice(chunk.length);
      applyAssistantDelta(messageId, chunk);

      if (buffer.text && options.force) {
        applyAssistantDelta(messageId, buffer.text);
        deltaBuffers.delete(messageId);
        return;
      }
      if (buffer.text) {
        scheduleAssistantDeltaFlush(messageId);
        return;
      }
      deltaBuffers.delete(messageId);
    }

    function appendAssistantDelta(messageId, delta) {
      const text = String(delta || "");
      if (!text) return;
      const buffer = getDeltaBuffer(messageId);
      buffer.text += text;
      if (!getMessageById(messageId)?.streamText) {
        flushAssistantDeltaBuffer(messageId);
        return;
      }
      scheduleAssistantDeltaFlush(messageId);
    }

    function addGeneratedItem(item, options = {}) {
      const normalized = {
        id: item.id || createId("generated"),
        icon: item.icon || "稿",
        title: item.title || "AI 草稿",
        detail: item.detail || "",
        payload: item.payload || null,
      };
      generatedItems.unshift(normalized);
      generatedItems = generatedItems.slice(0, 12);
      if (options.render !== false) renderGeneratedItems();
      return normalized.id;
    }

    function upsertPendingItem(item, options = {}) {
      const normalized = {
        id: item.id || createId("pending"),
        type: item.type || "local",
        title: item.title || "待确认项",
        detail: item.detail || "",
        preview: Array.isArray(item.preview) ? item.preview : [],
        status: item.status || "pending",
        payload: item.payload || null,
        editText: item.editText || "",
      };
      const existingIndex = pendingItems.findIndex((current) => current.id === normalized.id);
      if (existingIndex >= 0) {
        pendingItems[existingIndex] = { ...pendingItems[existingIndex], ...normalized };
      } else {
        pendingItems.unshift(normalized);
      }
      pendingItems = pendingItems.slice(0, 20);
      if (options.render !== false) renderPendingItems();
      return normalized.id;
    }

    async function requestJson(url, options = {}) {
      if (!fetchFn) throw new Error("浏览器暂不支持 fetch，无法连接本地 AI 接口。");
      const response = await fetchFn(url, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...(options.headers || {}),
        },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok === false) {
        const error = new Error(payload?.message || payload?.error || `请求失败：${response.status}`);
        error.code = payload?.error || "";
        error.stage = payload?.stage || payload?.details?.stage || "";
        error.details = payload?.details || {};
        error.statusCode = response.status;
        throw error;
      }
      return payload;
    }

    async function refreshActionRegistry() {
      if (!fetchFn) return null;
      if (actionRegistryPayload) return actionRegistryPayload;
      if (!actionRegistryRequest) {
        actionRegistryRequest = requestJson("/api/ai/action-registry?module=time")
          .then((payload) => {
            const result = payload?.result;
            actionRegistryPayload = result && typeof result === "object" && !Array.isArray(result) ? result : null;
            return actionRegistryPayload;
          })
          .catch(() => null)
          .finally(() => {
            actionRegistryRequest = null;
          });
      }
      return actionRegistryRequest;
    }

    function parseSseFrame(frame) {
      const lines = String(frame || "").split(/\r?\n/);
      let event = "message";
      const dataLines = [];
      for (const line of lines) {
        if (line.startsWith("event:")) {
          event = normalizeText(line.slice(6), "message");
          continue;
        }
        if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).replace(/^ /, ""));
        }
      }
      const rawData = dataLines.join("\n");
      let data = {};
      if (rawData) {
        try {
          data = JSON.parse(rawData);
        } catch {
          data = { raw: rawData };
        }
      }
      return { event, data };
    }

    async function requestAssistantStream(assistantRequest, handlers = {}) {
      if (!fetchFn) throw new Error("浏览器暂不支持 fetch，无法连接本地 AI 接口。");
      const response = await fetchFn("/api/ai/assistant/stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(assistantRequest),
      });
      if (!response.ok) {
        const payload = typeof response.json === "function" ? await response.json().catch(() => ({})) : {};
        const error = new Error(payload?.message || payload?.error || `请求失败：${response.status}`);
        error.code = payload?.error || "AI_STREAM_HTTP_FAILED";
        error.statusCode = response.status;
        error.details = payload?.details || {};
        throw error;
      }
      if (!response.body || typeof response.body.getReader !== "function") {
        const error = new Error("当前浏览器暂不支持 AI 流式响应。");
        error.code = "AI_STREAM_UNSUPPORTED";
        throw error;
      }

      const Decoder = windowRef.TextDecoder || globalScope.TextDecoder;
      if (typeof Decoder !== "function") {
        const error = new Error("当前浏览器缺少 TextDecoder，无法读取 AI 流式响应。");
        error.code = "AI_STREAM_UNSUPPORTED";
        throw error;
      }

      const reader = response.body.getReader();
      const decoder = new Decoder("utf-8");
      let buffer = "";
      let finalResult = null;

      function handleFrame(frame) {
        const parsed = parseSseFrame(frame);
        const eventType = parsed.data?.type || parsed.event;
        if (eventType === "error") {
          const error = new Error(parsed.data?.message || "AI 助手执行失败。");
          error.code = parsed.data?.error || "AI_ASSISTANT_STREAM_FAILED";
          error.stage = parsed.data?.stage || "";
          error.details = parsed.data?.details || {};
          error.statusCode = parsed.data?.status || 500;
          throw error;
        }
        if (eventType === "done") {
          finalResult = parsed.data?.result || null;
        }
        handlers.onEvent?.({ ...parsed.data, type: eventType, event: parsed.event });
      }

      try {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          buffer += decoder.decode(next.value || new Uint8Array(), { stream: true });
          const frames = buffer.split(/\n\n/);
          buffer = frames.pop() || "";
          for (const frame of frames) {
            if (frame.trim()) handleFrame(frame);
          }
        }
        buffer += decoder.decode();
        if (buffer.trim()) handleFrame(buffer);
      } finally {
        if (typeof reader.releaseLock === "function") reader.releaseLock();
      }

      return finalResult;
    }

    function getAssistantErrorMessage(error) {
      const code = String(error?.code || "");
      const stage = String(error?.stage || error?.details?.stage || "");
      const providerBody = String(error?.details?.body || "");
      let providerMessage = "";
      if (providerBody) {
        try {
          const parsed = JSON.parse(providerBody);
          providerMessage = normalizeText(parsed?.error?.message || parsed?.message, 300);
        } catch {
          providerMessage = normalizeText(providerBody, 300);
        }
      }
      if (code === "AI_PROVIDER_NOT_CONFIGURED" || code === "AI_PROVIDER_NOT_FOUND" || code === "AI_ACTIVE_PROVIDER_NOT_FOUND") {
        return "还没有可用的 AI Provider。请到设置页的「AI 接入」区保存并启用一个 Provider。";
      }
      if (code === "AI_PROVIDER_NOT_READY" || code === "AI_PROVIDER_API_KEY_REQUIRED") {
        return "当前 AI Provider 还没准备好。请检查设置页「AI 接入」里的模型、Base URL 和 API Key。";
      }
      if (code === "AI_PROVIDER_DISABLED") {
        return "当前 AI Provider 已保存但未启用。请到设置页「AI 接入」区启用它。";
      }
      if (code === "AI_EXTERNAL_REQUEST_NOT_CONFIRMED") {
        return "这次请求需要明确允许调用外部 AI Provider。请重新发送，或先检查 AI 接入设置。";
      }
      if (code === "AI_ASSISTANT_PROVIDER_HTTP_STATUS" || stage === "provider_response") {
        const httpStatus = error?.details?.httpStatus;
        if (httpStatus === 503 && /busy|service_unavailable|too busy|繁忙|不可用/i.test(providerMessage || providerBody)) {
          return "当前 AI Provider 服务繁忙，模型请求没有成功。可以稍后重试，或到设置页「AI 接入」临时切换到另一个 Provider。";
        }
        return httpStatus
          ? `AI Provider 返回 HTTP ${httpStatus}。请检查 API Key、模型名称、余额或服务状态。`
          : "AI Provider 返回了异常响应。请检查 API Key、模型名称、余额或服务状态。";
      }
      if (stage === "provider_request" || code === "AI_PROVIDER_FETCH_UNAVAILABLE") {
        return "暂时无法连接 AI Provider。请检查网络、Base URL 或本地模型服务是否启动。";
      }
      if (stage === "workflow") {
        return "模型已经选择了工具，但工具执行失败。请补充更具体的信息后再试，或者改用快捷动作。";
      }
      if (stage === "provider_config") {
        return "AI Provider 配置读取失败。请到设置页「AI 接入」区重新保存配置。";
      }
      if (code === "AI_STREAM_UNSUPPORTED") {
        return "当前浏览器暂不支持 AI 流式响应。";
      }
      return error instanceof Error ? error.message : "AI 助手执行失败。";
    }

    function isValidDate(value) {
      return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
    }

    function isValidClock(value) {
      return /^\d{1,2}:\d{2}$/.test(String(value || ""));
    }

    function parseClockToMinutes(value) {
      const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || "").trim());
      if (!match) return null;
      const hours = Number.parseInt(match[1], 10);
      const minutes = Number.parseInt(match[2], 10);
      if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
      return hours * 60 + minutes;
    }

    function addDays(dateText, days) {
      const date = new Date(`${dateText}T12:00:00`);
      if (!Number.isFinite(date.getTime())) return dateText;
      date.setDate(date.getDate() + days);
      return date.toISOString().slice(0, 10);
    }

    function hasSelectedTodoReference(text) {
      return /((当前|选中)(的)?(任务|待办|事项))|((这个|这项|这条|这件|这一个|刚才那个|上面那个|该)(任务|待办|事项))|(this\s+(todo|task))/i.test(String(text || ""));
    }

    function hasWeekReference(text) {
      return /(本周|这周|一周|未来\s*7\s*天|7\s*天|周计划|week)/i.test(String(text || ""));
    }

    function hasNearDayReference(text) {
      return /(今天|今日|明天|后天|今晚|上午|下午|晚上|接下来|下一步|现在先|today|tomorrow)/i.test(String(text || ""));
    }

    function hasTodoReference(text) {
      return /(待办|任务|事项|优先级|优先|接下来|下一步|先做|做什么|有哪些|梳理|复盘|延期|截止|风险|拆解|重排|安排|排程|todo|task|deadline)/i.test(String(text || ""));
    }

    function hasScheduleReference(text) {
      return /(安排|排程|日程|时间块|时间段|空档|忙|冲突|今天|今日|明天|后天|本周|这周|接下来|下一步|schedule|calendar)/i.test(String(text || ""));
    }

    function isCurrentTimeOnlyText(text) {
      const source = normalizeText(text).replace(/\s+/g, "");
      if (!source) return false;
      if (!/(几点|当前时间|现在时间|现在几时|现在几点|北京时间|time)/i.test(source)) return false;
      return !/(待办|任务|安排|日程|排程|今天做|接下来|下一步|空档|会议|todo|task|schedule|calendar)/i.test(source);
    }

    function inferAutomaticContextScopeMode(action, text) {
      if (action === "assistant") {
        return isCurrentTimeOnlyText(text) ? "none" : "default_2_3";
      }
      if (action === "plan_today" || action === "review_day") return "today";
      if (action === "plan_week") return "week";
      if (action === "reflow_unfinished") return "reflow_unfinished";
      if (action === "breakdown_task") return "selected_todo";
      if (action === "parse_task" || action === "save_memory_proposal" || action === "explore_principles") return "none";
      if (isCurrentTimeOnlyText(text)) return "none";
      const selectedRef = hasSelectedTodoReference(text);
      const scheduleRef = hasScheduleReference(text);
      const todoRef = hasTodoReference(text);
      if (selectedRef && scheduleRef) return "selected_with_today";
      if (selectedRef) return "selected_todo";
      if (hasWeekReference(text) && (todoRef || scheduleRef)) return "week";
      if (/(明天|后天|tomorrow)/i.test(String(text || "")) && (todoRef || scheduleRef)) return "week";
      if (hasNearDayReference(text) && (todoRef || scheduleRef)) return "today";
      if (todoRef) return "unfinished";
      return "none";
    }

    function getReferenceScopeIncludes(resolvedMode) {
      const mode = normalizeText(resolvedMode);
      if (mode === "selected_todo") {
        return { selectedTodo: true, todos: false, busyBlocks: false, entries: false };
      }
      if (mode === "selected_with_today") {
        return { selectedTodo: true, todos: false, busyBlocks: true, entries: false };
      }
      if (mode === "today" || mode === "week") {
        return { selectedTodo: false, todos: true, busyBlocks: true, entries: false };
      }
      if (mode === "unfinished") {
        return { selectedTodo: false, todos: true, busyBlocks: false, entries: false };
      }
      if (mode === "reflow_unfinished") {
        return { selectedTodo: false, todos: true, busyBlocks: true, entries: false };
      }
      if (mode === "default_2_3") {
        return { selectedTodo: false, todos: true, busyBlocks: true, entries: true };
      }
      if (mode === "granted_range") {
        return { selectedTodo: false, todos: true, busyBlocks: true, entries: true };
      }
      return { selectedTodo: false, todos: false, busyBlocks: false, entries: false };
    }

    function normalizeContextIncludeList(value) {
      const source = Array.isArray(value) ? value : [];
      const allowed = new Set(["todos", "entries", "busyBlocks", "memory", "progress", "selectedTodo"]);
      return Array.from(new Set(source
        .map((item) => normalizeText(item))
        .map((item) => (item === "busy_blocks" ? "busyBlocks" : item))
        .filter((item) => allowed.has(item))));
    }

    function normalizeContextGrant(value) {
      const source = value && typeof value === "object" && !Array.isArray(value) ? value : null;
      const request = source?.request || source?.contextRequest || source;
      if (!request || typeof request !== "object" || Array.isArray(request)) return null;
      const range = request.range || request.dateRange || {};
      const start = normalizeText(range.start || range.dateFrom || range.date);
      const end = normalizeText(range.end || range.dateTo || start);
      const include = normalizeContextIncludeList(request.include || request.includes || request.dataTypes);
      if (!start && !end && !include.length) return null;
      return {
        schema: "guanshi-ai-context-grant-v1",
        approved: source.approved !== false,
        sourceRequestId: normalizeText(source.sourceRequestId || source.requestId),
        rerunCount: Math.max(0, Math.min(AI_CONTEXT_RERUN_MAX, Number.parseInt(String(source.rerunCount || 0), 10) || 0)),
        grantSource: normalizeText(source.grantSource || source.source || "user_confirmed"),
        request: {
          schema: "guanshi-ai-context-request-v1",
          reason: trimDisplayText(request.reason || source.reason || "用户同意本轮参考更多上下文。", 600),
          range: { start, end: end || start },
          include: include.length ? include : ["todos"],
          maxItems: Math.max(1, Math.min(200, Number.parseInt(String(request.maxItems || request.limit || 80), 10) || 80)),
        },
      };
    }

    function getContextAccessPolicy() {
      const mode = normalizeContextScopeMode(contextScopeMode);
      const option = getContextScopeOption(mode);
      return {
        schema: "guanshi-ai-context-access-policy-v1",
        mode: mode === "none" ? "no_reference" : mode,
        label: option.label,
        conversationId: contextConversationId,
        sessionTtlMinutes: Math.round(AI_CONTEXT_CONVERSATION_TTL_MS / 60000),
        allowedIncludes: ["todos", "entries", "busyBlocks"],
        maxAutoReruns: AI_CONTEXT_RERUN_MAX,
      };
    }

    function resolveReferenceScope(action, text, options = {}) {
      const contextGrant = normalizeContextGrant(options.contextGrant);
      if (contextGrant?.approved) {
        const include = new Set(contextGrant.request.include);
        return {
          schema: AI_REFERENCE_SCOPE_SCHEMA,
          requestedMode: "granted_range",
          resolvedMode: "granted_range",
          source: "grant",
          label: "本轮授权范围",
          range: contextGrant.request.range,
          maxItems: contextGrant.request.maxItems,
          includes: {
            selectedTodo: include.has("selectedTodo") && Boolean(getSelectedTodo()),
            todos: include.has("todos"),
            busyBlocks: include.has("busyBlocks"),
            entries: include.has("entries"),
          },
        };
      }
      const requestedMode = getReferenceScopeRequestMode();
      const isManual = requestedMode !== "auto";
      const resolvedMode = isManual ? requestedMode : inferAutomaticContextScopeMode(action, text);
      const includes = getReferenceScopeIncludes(resolvedMode);
      const selectedTodo = getSelectedTodo();
      const policyOption = getContextScopeOption(contextScopeMode);
      return {
        schema: AI_REFERENCE_SCOPE_SCHEMA,
        requestedMode,
        resolvedMode,
        source: isManual ? "manual" : "auto",
        label: isManual
          ? policyOption.label
          : AI_CONTEXT_SCOPE_RESOLVED_LABELS[resolvedMode] || policyOption.label,
        includes: {
          selectedTodo: includes.selectedTodo && Boolean(selectedTodo),
          todos: includes.todos,
          busyBlocks: includes.busyBlocks,
          entries: includes.entries,
        },
      };
    }

    function getDateListFromRange(start, end, maxDays = 31) {
      const startText = normalizeText(start);
      const endText = normalizeText(end || start);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(startText) || !/^\d{4}-\d{2}-\d{2}$/.test(endText)) return [];
      const dates = [];
      let current = startText;
      for (let index = 0; index < maxDays; index += 1) {
        dates.push(current);
        if (current >= endText) break;
        const next = addDays(current, 1);
        if (!next || next === current) break;
        current = next;
      }
      return dates;
    }

    function getTargetDates(scopeOrAction) {
      const today = normalizeText(getTodayDateInputValue(), new Date().toISOString().slice(0, 10));
      const mode = typeof scopeOrAction === "string"
        ? scopeOrAction
        : normalizeText(scopeOrAction?.resolvedMode || scopeOrAction?.mode);
      if (mode === "granted_range") {
        const range = typeof scopeOrAction === "object" ? scopeOrAction.range || {} : {};
        return getDateListFromRange(range.start, range.end, 31);
      }
      if (mode === "default_2_3") return getDateListFromRange(addDays(today, -2), addDays(today, 3), 6);
      const count = mode === "week" ? 7 : mode === "reflow_unfinished" ? 2 : 1;
      return Array.from({ length: count }, (_, index) => addDays(today, index));
    }

    function getRecentEntryDates(scope) {
      const today = normalizeText(getTodayDateInputValue(), new Date().toISOString().slice(0, 10));
      if (scope?.resolvedMode === "granted_range") return getTargetDates(scope);
      if (scope?.resolvedMode === "default_2_3") return getDateListFromRange(addDays(today, -2), addDays(today, 3), 6);
      return Array.from({ length: 1 }, (_, index) => addDays(today, index)).filter(Boolean);
    }

    function pickTodo(todo) {
      return {
        id: normalizeText(todo?.id),
        title: normalizeText(todo?.title, "未命名待办"),
        category: normalizeText(todo?.category),
        project: normalizeText(todo?.project),
        tags: Array.isArray(todo?.tags) ? todo.tags.slice(0, 8) : [],
        dueDate: normalizeText(todo?.dueDate),
        startTime: normalizeText(todo?.startTime),
        endTime: normalizeText(todo?.endTime),
        estimatedMinutes: Number(todo?.estimatedMinutes) || 45,
        remainingMinutes: Number(todo?.remainingMinutes) || Number(todo?.estimatedMinutes) || 45,
        priority: normalizeText(todo?.priority, "P2"),
        importance: Number(todo?.importance) || 0,
        urgency: Number(todo?.urgency) || 0,
        taskType: normalizeText(todo?.taskType, "other"),
        energyLevel: normalizeText(todo?.energyLevel, "medium"),
        splittable: Boolean(todo?.splittable),
        minimumBlockMinutes: Number(todo?.minimumBlockMinutes) || 30,
        dependencies: Array.isArray(todo?.dependencies) ? todo.dependencies.slice(0, 20) : [],
        planLocked: Boolean(todo?.planLocked),
        repeat: normalizeText(todo?.repeat, "none"),
        orderInDay: Number.isFinite(Number(todo?.orderInDay)) ? Number(todo.orderInDay) : null,
        completed: Boolean(todo?.completed),
      };
    }

    function getTodoSortKey(todo) {
      const priorityRanks = { P0: 0, P1: 1, P2: 2, P3: 3, urgent: 0, high: 1, medium: 2, low: 3 };
      const priority = priorityRanks[normalizeText(todo?.priority, "P2")] ?? 4;
      const dueDate = normalizeText(todo?.dueDate) || "9999-12-31";
      const startTime = normalizeText(todo?.startTime) || "99:99";
      const order = Number.isFinite(Number(todo?.orderInDay)) ? String(Number(todo.orderInDay)).padStart(6, "0") : "999999";
      return `${dueDate}|${priority}|${startTime}|${order}|${normalizeText(todo?.title)}`;
    }

    function buildTodosContext(scope) {
      if (!scope?.includes?.todos) return [];
      const dates = new Set(getTargetDates(scope));
      const mode = normalizeText(scope.resolvedMode);
      const maxItems = Math.max(1, Math.min(200, Number.parseInt(String(scope.maxItems || scope.range?.maxItems || 80), 10) || 80));
      return (Array.isArray(getTodos()) ? getTodos() : [])
        .filter((todo) => todo)
        .filter((todo) => {
          if (mode === "unfinished" || mode === "reflow_unfinished") return true;
          if (mode !== "granted_range" && !todo.completed && !todo.dueDate) return true;
          return dates.has(String(todo.dueDate || ""));
        })
        .filter((todo) => mode === "granted_range" ? true : !todo.completed)
        .sort((left, right) => getTodoSortKey(left).localeCompare(getTodoSortKey(right), "zh-Hans-CN"))
        .slice(0, maxItems)
        .map(pickTodo);
    }

    function buildBusyBlocks(scope) {
      if (!scope?.includes?.busyBlocks) return [];
      const dates = new Set(getTargetDates(scope));
      return (Array.isArray(getEntries()) ? getEntries() : [])
        .filter((entry) => entry && dates.has(String(entry.date || "")))
        .filter((entry) => isValidClock(entry.start) && isValidClock(entry.end))
        .slice(0, 80)
        .map((entry, index) => ({
          id: normalizeText(entry.id, `entry_${index}`),
          source: normalizeText(entry.source || entry.externalSource || entry.provider, "entry_busy_block"),
          date: String(entry.date),
          start: String(entry.start),
          end: String(entry.end),
          isHard: true,
        }));
    }

    function pickEntry(entry, index = 0) {
      return {
        id: normalizeText(entry?.id, `entry_${index}`),
        source: normalizeText(entry?.source || entry?.externalSource || entry?.provider),
        date: normalizeText(entry?.date),
        start: normalizeText(entry?.start || entry?.startTime),
        end: normalizeText(entry?.end || entry?.endTime),
        durationMinutes: Number(entry?.durationMinutes) || 0,
        title: trimDisplayText(entry?.title || entry?.name || entry?.summary || "时间记录", 120),
        category: normalizeText(entry?.category),
        project: normalizeText(entry?.project),
        todoId: normalizeText(entry?.todoId || entry?.sourceTodoId),
      };
    }

    function buildEntriesContext(scope) {
      if (!scope?.includes?.entries) return [];
      const dates = new Set(scope?.resolvedMode === "granted_range" ? getTargetDates(scope) : getRecentEntryDates(scope));
      const maxItems = Math.max(1, Math.min(200, Number.parseInt(String(scope.maxItems || scope.range?.maxItems || 80), 10) || 80));
      return (Array.isArray(getEntries()) ? getEntries() : [])
        .filter((entry) => entry && dates.has(String(entry.date || "")))
        .filter((entry) => isValidClock(entry.start || entry.startTime) && isValidClock(entry.end || entry.endTime))
        .slice(0, maxItems)
        .map(pickEntry);
    }

    function buildProgressSummary(action) {
      const todos = Array.isArray(getTodos()) ? getTodos() : [];
      const entries = Array.isArray(getEntries()) ? getEntries() : [];
      const today = normalizeText(getTodayDateInputValue(), new Date().toISOString().slice(0, 10));
      const unfinished = todos.filter((todo) => !todo.completed).length;
      const todayTodos = todos.filter((todo) => !todo.completed && todo.dueDate === today).length;
      const todayEntries = entries.filter((entry) => entry.date === today).length;
      return `当前未完成待办 ${unfinished} 个；今日待办 ${todayTodos} 个；今日已有记录/忙碌块 ${todayEntries} 个；动作：${action}。`;
    }

    function buildWorkflowInput(action, text, options = {}) {
      const today = normalizeText(getTodayDateInputValue(), new Date().toISOString().slice(0, 10));
      const selectedTodo = getSelectedTodo();
      const contextGrant = normalizeContextGrant(options.contextGrant);
      const referenceScope = resolveReferenceScope(action, text, { contextGrant });
      const contextAccessPolicy = getContextAccessPolicy();
      const payload = {
        text,
        currentDate: today,
        referenceScope,
        contextAccessPolicy,
        ...(contextGrant ? { contextGrant } : {}),
        todos: buildTodosContext(referenceScope),
        entries: buildEntriesContext(referenceScope),
        busyBlocks: buildBusyBlocks(referenceScope),
        progressSummary: buildProgressSummary(action),
        todo: referenceScope.includes.selectedTodo && selectedTodo ? pickTodo(selectedTodo) : null,
        workingWindows: [{ start: "09:30", end: "21:30" }],
        defaultGapMinutes: 5,
        strategy: action === "reflow_unfinished" ? "minimal_change" : "balanced",
        allowMoveExistingUnlocked: true,
        allowSplitLongTasks: true,
      };
      if (action === "plan_today" || action === "plan_week") {
        payload.date = today;
        payload.targetDate = today;
      }
      if (action === "reflow_unfinished") {
        payload.targetDate = addDays(today, 1);
      }
      if (action === "review_day") {
        payload.period = { start: today, end: today };
      }
      return payload;
    }

    function buildAssistantRequest(actionKey, text, options = {}) {
      const config = ACTION_CONFIG[actionKey] || ACTION_CONFIG.assistant;
      const contextAction = config.workflow || "assistant";
      const semanticFeedback = options.semanticFeedback && typeof options.semanticFeedback === "object"
        ? options.semanticFeedback
        : null;
      const contextGrant = normalizeContextGrant(options.contextGrant);
      return {
        schema: AI_ASSISTANT_SCHEMA,
        requestId: createId("assistant"),
        locale: "zh-CN",
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai",
        text,
        intentHint: config.workflow || "",
        messages: buildAssistantHistory({
          excludeLatestUserText: options.excludeCurrentTextFromHistory ? text : "",
        }),
        input: {
          ...buildWorkflowInput(contextAction, text, { contextGrant }),
          ...(semanticFeedback ? { semanticFeedback } : {}),
          ...(contextGrant ? { contextGrant } : {}),
        },
        ...(semanticFeedback ? { semanticFeedback } : {}),
        ...(contextGrant ? { contextGrant } : {}),
        contextAccessPolicy: getContextAccessPolicy(),
        contextPolicy: {
          includeTodos: "active_relevant",
          includeCalendar: "busy_blocks_only",
          includeMemory: "active_index_only",
          includeProgress: "summary_only",
          maxItems: 80,
        },
        allowExternalRequest: true,
      };
    }

    function summarizeScheduleDraft(draft) {
      const changes = Array.isArray(draft?.changes) ? draft.changes : [];
      const conflicts = Array.isArray(draft?.conflicts) ? draft.conflicts : [];
      const preview = changes.slice(0, 3).map((change) => ({
        time: `${change.after?.startTime || "--"}-${change.after?.endTime || "--"}`,
        text: change.title || change.todoId || "排程变更",
      }));
      return {
        title: draft?.source?.action === "plan_week" ? "本周排程草稿" : "今日排程草稿",
        detail: `${draft?.summary || `安排 ${changes.length} 个时间块`}；冲突 ${conflicts.length} 个。`,
        preview,
      };
    }

    function buildAssistantParagraphs(workflow, text) {
      const action = workflow?.request?.action || "";
      const result = workflow?.result || {};
      const artifacts = Array.isArray(workflow?.artifacts) ? workflow.artifacts : [];
      if (action === "explore_principles") {
        const prompts = Array.isArray(result.prompts) ? result.prompts : [];
        return [
          "可以，我们先不急着排程，先把你的时间管理原则说清楚。你可以从下面任意一个问题开始回答。",
          prompts.map((prompt, index) => `${index + 1}. ${prompt}`).join("\n"),
        ].filter(Boolean);
      }
      if (action === "save_memory_proposal") {
        const proposal = artifacts.find((item) => item.kind === "memory_proposal")?.proposal || result;
        const proposalLabel = getMemoryProposalLabel(proposal);
        return [
          `我提炼出一条可能值得保存的${proposalLabel}：${proposal.title || proposalLabel}。`,
          `${proposal.body || text} ${getMemoryProposalPendingEffect(proposal)}`,
        ];
      }
      if (action === "parse_task") {
        const items = Array.isArray(result.items) ? result.items : [];
        return [
          `我解析出 ${items.length || 0} 个待办草稿。`,
          "这些草稿已经放到待确认区；确认后会写入本地待办，仍不会直接同步到日历或提醒。",
        ];
      }
      if (action === "breakdown_task") {
        const children = Array.isArray(result.children) ? result.children : [];
        return [
          `我把任务拆成 ${children.length || 0} 个子任务草稿。`,
          "先进入待确认区，你可以确认写入待办，也可以编辑后再重新生成。",
        ];
      }
      if (action === "plan_today" || action === "plan_week" || action === "reflow_unfinished") {
        const draft = artifacts.find((item) => item.kind === "schedule_draft")?.draft;
        return [
          `我已经生成一个可确认的排程草稿：${draft?.summary || "等待确认"}`,
          "它现在只在左侧待确认区，不会直接写入待办、日历或提醒。确认后会标记为已确认，实际应用排程会在后续应用事务里处理。",
        ];
      }
      if (action === "review_day") {
        return [
          "我已经根据当前上下文生成一条复盘/风险洞察。",
          result.summary || "",
          "这类内容先作为建议展示，不会自动变更任何本地数据。",
        ].filter(Boolean);
      }
      return ["我已经完成处理，相关草稿会先进入待确认区。"];
    }

    function splitAssistantAnswer(text) {
      const normalized = normalizeText(text, "我可以继续帮你梳理。");
      return normalized
        .split(/\n{2,}/)
        .map((paragraph) => normalizeText(paragraph))
        .filter(Boolean)
        .slice(0, 16);
    }

    function normalizeContextRequestForUi(value) {
      const request = value && typeof value === "object" && !Array.isArray(value) ? value : null;
      if (!request) return null;
      const range = request.range || {};
      const include = normalizeContextIncludeList(request.include || request.includes || request.dataTypes);
      return {
        schema: "guanshi-ai-context-request-v1",
        reason: trimDisplayText(request.reason || "默认上下文不足，需要本轮参考更多数据。", 600),
        range: {
          start: normalizeText(range.start || range.dateFrom || range.date),
          end: normalizeText(range.end || range.dateTo || range.start || range.dateFrom || range.date),
        },
        include: include.length ? include : ["todos"],
        maxItems: Math.max(1, Math.min(200, Number.parseInt(String(request.maxItems || request.limit || 80), 10) || 80)),
      };
    }

    function formatContextRequestDetail(request) {
      const normalized = normalizeContextRequestForUi(request);
      if (!normalized) return "需要本轮授权查看更多上下文。";
      const start = normalized.range.start || "未指定";
      const end = normalized.range.end || start;
      const rangeText = start === end ? start : `${start} 至 ${end}`;
      const includeLabels = {
        todos: "待办",
        entries: "时间记录",
        busyBlocks: "忙碌时间",
        memory: "记忆",
        progress: "进度摘要",
        selectedTodo: "当前待办",
      };
      const dataText = normalized.include.map((item) => includeLabels[item] || item).join("、") || "相关数据";
      return `${rangeText} · ${dataText}`;
    }

    function getContextRequestRerunCount(assistantResult) {
      return Math.max(0, Math.min(AI_CONTEXT_RERUN_MAX, Number.parseInt(String(
        assistantResult?.contextGrant?.rerunCount
          || assistantResult?.contextSnapshot?.contextGrant?.rerunCount
          || 0,
      ), 10) || 0));
    }

    function isConversationContextAccessActive() {
      if (!conversationContextAccessGrant) return false;
      if (conversationContextAccessGrant.expiresAtMs <= Date.now()) {
        conversationContextAccessGrant = null;
        return false;
      }
      return true;
    }

    function rememberConversationContextAccess(contextRequest) {
      if (normalizeContextScopeMode(contextScopeMode) !== "allow_conversation") return;
      conversationContextAccessGrant = {
        schema: "guanshi-ai-conversation-context-access-v1",
        conversationId: contextConversationId,
        approvedAt: new Date().toISOString(),
        expiresAtMs: Date.now() + AI_CONTEXT_CONVERSATION_TTL_MS,
        include: normalizeContextIncludeList(contextRequest?.include),
      };
    }

    function buildAutoContextGrant(assistantResult) {
      const contextRequest = normalizeContextRequestForUi(assistantResult?.contextRequest || assistantResult?.decision?.contextRequest);
      if (!contextRequest) return null;
      const rerunCount = getContextRequestRerunCount(assistantResult);
      if (rerunCount >= AI_CONTEXT_RERUN_MAX) return null;
      const mode = normalizeContextScopeMode(contextScopeMode);
      if (mode !== "auto_allow" && !(mode === "allow_conversation" && isConversationContextAccessActive())) return null;
      return {
        schema: "guanshi-ai-context-grant-v1",
        approved: true,
        sourceRequestId: assistantResult?.requestId || "",
        rerunCount: rerunCount + 1,
        grantSource: mode === "auto_allow" ? "time_data_reference_default_allow" : "time_data_reference_conversation_allow",
        request: contextRequest,
      };
    }

    function buildAssistantTurnParagraphs(assistantResult, text) {
      const paragraphs = [];
      if (assistantResult?.answer) {
        paragraphs.push(...splitAssistantAnswer(assistantResult.answer));
      }
      if (assistantResult?.mode === "need_more_context" || assistantResult?.contextRequest) {
        const detail = formatContextRequestDetail(assistantResult.contextRequest || assistantResult.decision?.contextRequest);
        paragraphs.push(`需要你允许本轮参考：${detail}。`);
      }
      if (assistantResult?.workflow) {
        paragraphs.push(...buildAssistantParagraphs(assistantResult.workflow, text));
      }
      return paragraphs.length ? paragraphs : ["我已经处理完这次请求。"];
    }

    function normalizeWorkflowActionId(action) {
      const value = normalizeText(action);
      if (!value) return "";
      return value.includes(".") ? value : `time.${value}`;
    }

    function getActionRegistryActions() {
      return Array.isArray(actionRegistryPayload?.action_registry) ? actionRegistryPayload.action_registry : [];
    }

    function getUiRegistryItems() {
      return Array.isArray(actionRegistryPayload?.ui_registry) ? actionRegistryPayload.ui_registry : [];
    }

    function findActionRegistryEntry(action) {
      const legacyAction = normalizeText(action);
      const actionId = normalizeWorkflowActionId(legacyAction);
      if (!legacyAction && !actionId) return null;
      return getActionRegistryActions().find((entry) => {
        const entryActionId = normalizeText(entry?.action_id);
        const entryLegacyAction = normalizeText(entry?.legacy_action);
        return (
          (actionId && entryActionId === actionId) ||
          (legacyAction && entryActionId === legacyAction) ||
          (legacyAction && entryLegacyAction === legacyAction)
        );
      }) || null;
    }

    function findUiRegistryEntry(uiRef) {
      const normalizedUiRef = normalizeText(uiRef);
      if (!normalizedUiRef) return null;
      return getUiRegistryItems().find((entry) => normalizeText(entry?.ui_id) === normalizedUiRef) || null;
    }

    function resolveRegistryPostApplyUi(action, uiRef = "") {
      const actionEntry = findActionRegistryEntry(action);
      const resolvedUiRef = normalizeText(uiRef || actionEntry?.ui_ref || actionEntry?.uiRef);
      const uiEntry = findUiRegistryEntry(resolvedUiRef);
      const postApplyUi = uiEntry?.post_apply_ui || uiEntry?.postApplyUi;
      return postApplyUi && typeof postApplyUi === "object" && !Array.isArray(postApplyUi) ? postApplyUi : null;
    }

    function withWorkflowUiPayload(payload, workflowAction) {
      const source = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
      const action = normalizeText(
        workflowAction ||
          source.sourceAction ||
          source.action ||
          source.source?.action ||
          source.actionId,
      );
      const actionEntry = findActionRegistryEntry(action);
      const uiRef = normalizeText(source.uiRef || actionEntry?.ui_ref || actionEntry?.uiRef);
      const postApplyUi = resolveRegistryPostApplyUi(action, uiRef);
      return {
        ...source,
        ...(action ? { sourceAction: action, actionId: normalizeWorkflowActionId(action) } : {}),
        ...(uiRef ? { uiRef } : {}),
        ...(postApplyUi ? { postApplyUi } : {}),
      };
    }

    function addWorkflowArtifacts(workflow, text, options = {}) {
      const result = workflow?.result || {};
      const artifacts = Array.isArray(workflow?.artifacts) ? workflow.artifacts : [];
      const workflowAction = workflow?.request?.action || "";
      const pendingIds = [];
      const generatedIds = [];
      for (const artifact of artifacts) {
        if (artifact.kind === "schedule_draft" && artifact.draft) {
          const summary = summarizeScheduleDraft(artifact.draft);
          pendingIds.push(upsertPendingItem({
            id: `schedule:${artifact.draft.draftId}`,
            type: "schedule_draft",
            title: summary.title,
            detail: summary.detail,
            preview: summary.preview,
            payload: withWorkflowUiPayload(artifact.draft, workflowAction),
            editText: `请调整这个排程草稿：${artifact.draft.summary || text}`,
          }, { render: false }));
        }
        if (artifact.kind === "memory_proposal" && artifact.proposal) {
          pendingIds.push(upsertPendingItem({
            id: `memory:${artifact.proposal.proposalId}`,
            type: "memory_proposal",
            title: artifact.proposal.title || "记忆提案",
            detail: artifact.proposal.body || "",
            payload: artifact.proposal,
            editText: artifact.proposal.body || text,
          }, { render: false }));
        }
      }

      if (workflow?.request?.action === "parse_task" && Array.isArray(result.items) && result.items.length) {
        pendingIds.push(upsertPendingItem({
          id: createId("todo"),
          type: "todo_draft",
          title: "待办录入草稿",
          detail: result.items.map((item) => item.title).filter(Boolean).join("、"),
          preview: result.items.slice(0, 3).map((item) => ({
            time: item.startTime && item.endTime ? `${item.startTime}-${item.endTime}` : item.dueDate || "--",
            text: item.title || "待办草稿",
          })),
          payload: {
            items: result.items,
            originalText: workflow?.request?.input?.sourceText || workflow?.request?.input?.text || text,
            normalizedGoal: workflow?.request?.input?.normalizedGoal || "",
            ...withWorkflowUiPayload({}, workflowAction),
          },
          editText: text,
        }, { render: false }));
      }

      if (workflow?.request?.action === "breakdown_task" && Array.isArray(result.children) && result.children.length) {
        pendingIds.push(upsertPendingItem({
          id: createId("breakdown"),
          type: "todo_draft",
          title: "任务拆解草稿",
          detail: result.children.map((item) => item.title).filter(Boolean).join("、"),
          preview: result.children.slice(0, 3).map((item) => ({
            time: `${item.estimatedMinutes || 0} 分钟`,
            text: item.title || "子任务草稿",
          })),
          payload: {
            items: result.children,
            originalText: workflow?.request?.input?.sourceText || workflow?.request?.input?.text || text,
            normalizedGoal: workflow?.request?.input?.normalizedGoal || "",
            parentTitle: result.parentTitle || "",
            sourceTodoId: result.sourceTodoId || "",
            ...withWorkflowUiPayload({}, workflowAction),
          },
          editText: text,
        }, { render: false }));
      }
      if (options.render !== false) renderMessages();
      return { pendingIds, generatedIds };
    }

    function addContextRequestPending(assistantResult, text, options = {}) {
      const contextRequest = normalizeContextRequestForUi(assistantResult?.contextRequest || assistantResult?.decision?.contextRequest);
      if (!contextRequest) return { pendingIds: [], generatedIds: [] };
      const rerunCount = Math.max(0, Math.min(AI_CONTEXT_RERUN_MAX, Number.parseInt(String(assistantResult?.contextGrant?.rerunCount || assistantResult?.contextSnapshot?.contextGrant?.rerunCount || 0), 10) || 0));
      if (rerunCount >= AI_CONTEXT_RERUN_MAX) return { pendingIds: [], generatedIds: [] };
      const pendingId = upsertPendingItem({
        id: `context:${assistantResult.requestId || createId("context")}`,
        type: "context_request",
        title: "允许本轮参考更多数据？",
        detail: contextRequest.reason,
        preview: [
          {
            time: formatContextRequestDetail(contextRequest),
            text: `剩余补跑 ${Math.max(0, AI_CONTEXT_RERUN_MAX - rerunCount)} 次`,
          },
        ],
        payload: {
          contextRequest,
          originalText: text,
          sourceRequestId: assistantResult.requestId || "",
          rerunCount,
        },
        editText: text,
      }, { render: false });
      if (options.render !== false) renderMessages();
      return { pendingIds: [pendingId], generatedIds: [] };
    }

    function mergeArtifactRefsToMessage(messageId, artifactRefs = {}) {
      const pendingIds = Array.isArray(artifactRefs.pendingIds) ? artifactRefs.pendingIds : [];
      const generatedIds = Array.isArray(artifactRefs.generatedIds) ? artifactRefs.generatedIds : [];
      if (!pendingIds.length && !generatedIds.length) return;
      updateMessage(messageId, (message) => ({
        ...message,
        pendingIds: Array.from(new Set([...(message.pendingIds || []), ...pendingIds])),
        generatedIds: Array.from(new Set([...(message.generatedIds || []), ...generatedIds])),
      }));
    }

    function getAssistantDecisionMeta(decision, config, phase = "done") {
      if (decision?.type === "need_more_context" || decision?.contextRequest) {
        return phase === "pending" ? "需要授权" : "请求授权";
      }
      const tool = normalizeText(decision?.tool || config?.workflow);
      if (!tool) return phase === "pending" ? "正在回复" : "";
      return phase === "pending"
        ? `选择Tool · ${tool}`
        : `已用Tool · ${tool}`;
    }

    function getAssistantResultMeta(assistantResult, config, startedAt) {
      const elapsed = formatAssistantElapsedTime(startedAt);
      return assistantResult?.mode === "need_more_context"
        ? `请求授权 · ${elapsed}`
        : assistantResult?.mode === "tool"
        ? `${getAssistantDecisionMeta(assistantResult.decision, config)} · ${elapsed}`
        : elapsed;
    }

    function getRequiredInputMeta(actionKey) {
      if (actionKey === "save-memory") return "等待你补充时间管理原则";
      if (actionKey === "parse-task") return "等待你补充任务内容";
      return "等待你补充内容";
    }

    function resolveProviderLogoKey(provider, activeId) {
      const signature = [
        activeId,
        provider?.id,
        provider?.type,
        provider?.model,
        provider?.baseUrl,
        provider?.provider,
      ]
        .map((item) => normalizeText(item).toLowerCase())
        .filter(Boolean)
        .join(" ");

      if (signature.includes("deepseek")) return "deepseek";
      if (signature.includes("anthropic") || signature.includes("claude")) return "anthropic";
      if (signature.includes("qwen") || signature.includes("tongyi") || signature.includes("dashscope")) return "qwen";
      if (signature.includes("ollama") || signature.includes("llama")) return "ollama";
      if (signature.includes("openai") || signature.includes("gpt") || signature.includes("chatgpt")) return "openai";
      return "generic";
    }

    function setProviderSwitchIdentity(identity) {
      const text = normalizeText(identity?.label, "模型");
      const logoKey = AI_PROVIDER_LOGO_FILES[identity?.logoKey] ? identity.logoKey : "generic";
      const shouldRenderMessages =
        currentProviderIdentity.label !== text || currentProviderIdentity.logoKey !== logoKey;
      currentProviderIdentity = { label: text, logoKey };
      if (providerSwitchLogo) {
        providerSwitchLogo.dataset.logoFallback = "0";
        providerSwitchLogo.src = `${AI_PROVIDER_LOGO_BASE}${AI_PROVIDER_LOGO_FILES[logoKey]}`;
        providerSwitchLogo.alt = `${text} logo`;
      }
      if (providerSwitchButton) {
        providerSwitchButton.title = `切换 Provider 或 CLI：${text}`;
        providerSwitchButton.setAttribute("aria-label", `切换 Provider 或 CLI：${text}`);
        providerSwitchButton.dataset.providerLogo = logoKey;
      }
      if (shouldRenderMessages) renderMessages();
    }

    function resolveActiveProviderIdentity(config) {
      const activeId = normalizeText(config?.activeProviderId);
      const providers = config?.providers && typeof config.providers === "object" ? config.providers : {};
      const provider = activeId ? providers[activeId] : null;
      return {
        label: normalizeText(provider?.model || provider?.id || activeId || "模型", "模型"),
        logoKey: resolveProviderLogoKey(provider, activeId),
      };
    }

    async function refreshProviderSwitchIdentity() {
      if ((!providerSwitchButton && !providerSwitchLogo) || !fetchFn) return;
      try {
        const payload = await requestJson("/api/ai/config");
        setProviderSwitchIdentity(resolveActiveProviderIdentity(payload?.result));
      } catch {
        setProviderSwitchIdentity({ label: "模型", logoKey: "generic" });
      }
    }

    async function runAction(actionKey = "assistant", options = {}) {
      if (isBusy) return;
      const config = ACTION_CONFIG[actionKey] || ACTION_CONFIG.assistant;
      const rawText = normalizeText(options.text ?? input?.value);
      const text = rawText || config.prompt;

      open({ focusInput: false });
      if (config.requiresInput && !rawText) {
        const hint =
          actionKey === "save-memory"
            ? "请先输入你想记住的时间管理原则，例如：会议后留 15 分钟缓冲。"
            : "请先输入要录入或解析的任务内容。";
        appendMessage({ role: "assistant", state: "需要输入", paragraphs: [hint], meta: getRequiredInputMeta(actionKey) });
        setStatus(hint);
        input?.focus();
        return;
      }

      closeContextScopeMenu();
      const semanticFeedback = actionKey === "assistant" && pendingSemanticFeedback && typeof pendingSemanticFeedback === "object"
        ? pendingSemanticFeedback
        : null;
      pendingSemanticFeedback = null;
      const suppressUserEcho = options.suppressUserEcho === true;
      const assistantRequest = buildAssistantRequest(actionKey, text, {
        semanticFeedback: semanticFeedback ? { ...semanticFeedback, userFeedback: text } : null,
        contextGrant: options.contextGrant || null,
        excludeCurrentTextFromHistory: suppressUserEcho,
      });
      const assistantMessageId = createId("msg");
      const userMessageId = suppressUserEcho ? assistantMessageId : createId("msg");
      startActiveTurnScroll(userMessageId, assistantMessageId);
      if (!suppressUserEcho) {
        appendMessage({ id: userMessageId, role: "user", state: nowLabel(), paragraphs: [text] }, { render: false });
      }
      if (input && rawText && !suppressUserEcho) input.value = "";
      const assistantMessage = appendMessage({
        id: assistantMessageId,
        role: "assistant",
        state: "连接中",
        paragraphs: ["Thinking......"],
        meta: "",
        streamText: "",
      });
      const assistantStartedAt = getAnimationTime();
      setBusy(true);
      setStatus(`${config.label}：思考中。`);
      let deferredContextRerun = null;

      try {
        let artifactRefs = { pendingIds: [], generatedIds: [] };
        let streamWorkflowHandled = false;
        const assistantResult = await requestAssistantStream(assistantRequest, {
          onEvent(event) {
            if (event.type === "status") {
              setMessageState(assistantMessage.id, event.label || "运行中");
              setStatus(`${config.label}：${event.label || "运行中"}。`);
              return;
            }
            if (event.type === "text_delta") {
              appendAssistantDelta(assistantMessage.id, event.delta || "");
              return;
            }
            if (event.type === "decision") {
              const semanticAction = event.decision?.semanticAction || event.semanticAction || null;
              const actionReview = event.decision?.actionReview || event.actionReview || null;
              updateMessage(assistantMessage.id, (message) => ({
                ...message,
                meta: getAssistantDecisionMeta(event.decision, config, "pending"),
                decision: event.decision && typeof event.decision === "object" ? event.decision : message.decision || null,
                contextRequest: event.decision?.contextRequest || event.contextRequest || message.contextRequest || null,
                contextGuard: event.decision?.contextGuard || event.contextGuard || message.contextGuard || null,
                semanticAction: semanticAction && typeof semanticAction === "object" ? semanticAction : message.semanticAction || null,
                actionReview: actionReview && typeof actionReview === "object" ? actionReview : message.actionReview || null,
              }));
              return;
            }
            if (event.type === "workflow_result" && event.workflow) {
              flushAssistantDeltaBuffer(assistantMessage.id, { force: true });
              artifactRefs = addWorkflowArtifacts(event.workflow, text, { render: false });
              streamWorkflowHandled = true;
              updateMessage(assistantMessage.id, (message) => ({
                ...message,
                workflow: event.workflow && typeof event.workflow === "object" ? event.workflow : message.workflow || null,
              }));
              mergeArtifactRefsToMessage(assistantMessage.id, artifactRefs);
            }
          },
        });
        flushAssistantDeltaBuffer(assistantMessage.id, { force: true });
        const finalResult = assistantResult || {};
        if (finalResult.workflow && !streamWorkflowHandled) {
          artifactRefs = addWorkflowArtifacts(finalResult.workflow, text, { render: false });
          mergeArtifactRefsToMessage(assistantMessage.id, artifactRefs);
        }
        if (finalResult.mode === "need_more_context" || finalResult.contextRequest || finalResult.decision?.contextRequest) {
          const autoContextGrant = buildAutoContextGrant(finalResult);
          if (autoContextGrant) {
            const contextRequest = autoContextGrant.request;
            const sourceLabel = autoContextGrant.grantSource === "time_data_reference_default_allow" ? "允许" : "本对话";
            updateMessage(assistantMessage.id, (message) => ({
              ...message,
              state: "已授权",
              paragraphs: [`已按「${sourceLabel}」自动参考：${formatContextRequestDetail(contextRequest)}。我会重新理解这句话。`],
              meta: getAssistantResultMeta(finalResult, config, assistantStartedAt),
              decision: finalResult.decision && typeof finalResult.decision === "object" ? finalResult.decision : message.decision || null,
              contextRequest: finalResult.contextRequest || finalResult.decision?.contextRequest || message.contextRequest || null,
              contextGuard: finalResult.contextGuard || finalResult.contextSnapshot?.contextGuard || finalResult.decision?.contextGuard || message.contextGuard || null,
              contextSnapshot: finalResult.contextSnapshot && typeof finalResult.contextSnapshot === "object"
                ? finalResult.contextSnapshot
                : message.contextSnapshot || null,
              pendingIds: message.pendingIds || [],
              generatedIds: message.generatedIds || [],
              streamText: "",
              showActions: false,
            }));
            queueNextActionsForMessage(assistantMessage.id);
            setStatus(`已按「${sourceLabel}」自动参考更多时间数据。`);
            deferredContextRerun = {
              text,
              contextGrant: autoContextGrant,
              suppressUserEcho: true,
            };
            return;
          }
          const contextRefs = addContextRequestPending(finalResult, text, { render: false });
          artifactRefs = {
            pendingIds: Array.from(new Set([...(artifactRefs.pendingIds || []), ...(contextRefs.pendingIds || [])])),
            generatedIds: Array.from(new Set([...(artifactRefs.generatedIds || []), ...(contextRefs.generatedIds || [])])),
          };
          mergeArtifactRefsToMessage(assistantMessage.id, contextRefs);
        }
        const finalSemanticAction = finalResult.semanticAction
          || finalResult.decision?.semanticAction
          || finalResult.contextSnapshot?.semanticAction
          || null;
        const finalActionReview = finalResult.actionReview
          || finalResult.decision?.actionReview
          || finalResult.contextSnapshot?.actionReview
          || null;
        updateMessage(assistantMessage.id, (message) => ({
          ...message,
          state: "完成",
          paragraphs: buildAssistantTurnParagraphs(finalResult, text),
          meta: getAssistantResultMeta(finalResult, config, assistantStartedAt),
          decision: finalResult.decision && typeof finalResult.decision === "object" ? finalResult.decision : message.decision || null,
          contextRequest: finalResult.contextRequest || finalResult.decision?.contextRequest || message.contextRequest || null,
          contextGuard: finalResult.contextGuard || finalResult.contextSnapshot?.contextGuard || finalResult.decision?.contextGuard || message.contextGuard || null,
          workflow: finalResult.workflow && typeof finalResult.workflow === "object" ? finalResult.workflow : message.workflow || null,
          contextSnapshot: finalResult.contextSnapshot && typeof finalResult.contextSnapshot === "object"
            ? finalResult.contextSnapshot
            : message.contextSnapshot || null,
          semanticAction: finalSemanticAction && typeof finalSemanticAction === "object" ? finalSemanticAction : message.semanticAction || null,
          actionReview: finalActionReview && typeof finalActionReview === "object" ? finalActionReview : message.actionReview || null,
          pendingIds: Array.from(new Set([...(message.pendingIds || []), ...(artifactRefs.pendingIds || [])])),
          generatedIds: Array.from(new Set([...(message.generatedIds || []), ...(artifactRefs.generatedIds || [])])),
          showActions: false,
        }));
        queueNextActionsForMessage(assistantMessage.id);
        setStatus(finalResult.mode === "need_more_context" || finalResult.contextRequest ? "需要你允许本轮参考更多数据。" : finalResult.workflow ? "已生成，等待你确认。" : "AI 已回复。");
      } catch (error) {
        flushAssistantDeltaBuffer(assistantMessage.id, { force: true });
        const message = getAssistantErrorMessage(error);
        updateMessage(assistantMessage.id, (current) => ({
          ...current,
          state: "失败",
          paragraphs: [message],
          meta: "",
          showActions: false,
        }));
        queueNextActionsForMessage(assistantMessage.id);
        setStatus(message);
      } finally {
        setBusy(false);
        finishActiveTurnScroll();
        if (deferredContextRerun) {
          await runAction("assistant", deferredContextRerun);
        }
      }
    }

    function buildAiTodoNote(item, context = {}) {
      const direct = normalizeText(item.notes || item.note || item.description);
      if (direct) return direct;
      const sourceText = normalizeText(item.sourceText || item.originalText || context.originalText || context.editText);
      const understanding = normalizeText(item.normalizedGoal || item.summary || context.normalizedGoal);
      const lines = [];
      if (sourceText) lines.push(`原文：${sourceText}`);
      if (understanding) lines.push(`理解：${understanding}`);
      return lines.join("\n");
    }

    function createTodoFromAiItem(item, context = {}) {
      const categories = Array.isArray(getCategories()) ? getCategories() : [];
      const category = normalizeText(item.category, categories[0] || "工作");
      const base = createTodoDraft();
      const priorityMap = {
        urgent: "P0",
        high: "P1",
        medium: "P2",
        low: "P3",
      };
      return normalizeTodo({
        ...base,
        id: createId("todo"),
        title: normalizeText(item.title, "待确认任务"),
        dueDate: isValidDate(item.dueDate) ? item.dueDate : base.dueDate,
        project: normalizeText(item.project),
        category,
        tags: Array.isArray(item.tags) ? item.tags : [],
        note: buildAiTodoNote(item, context),
        startTime: isValidClock(item.startTime) ? item.startTime : "",
        endTime: isValidClock(item.endTime) ? item.endTime : "",
        estimatedMinutes: Number(item.estimatedMinutes) || Number(item.remainingMinutes) || base.estimatedMinutes,
        remainingMinutes: Number(item.remainingMinutes) || Number(item.estimatedMinutes) || base.estimatedMinutes,
        priority: priorityMap[item.priority] || item.priority || "P2",
        importance: item.importance,
        urgency: item.urgency,
        taskType: item.taskType || "other",
        energyLevel: item.energyLevel || "medium",
        splittable: Boolean(item.splittable),
        minimumBlockMinutes: Number(item.minimumBlockMinutes) || 30,
        dependencies: Array.isArray(item.dependencies) ? item.dependencies : [],
        calendarSynced: false,
        syncState: "dirty",
        aiMeta: {
          source: "ai_sidebar",
          draftId: item.draftTodoId || item.childDraftId || "",
          confirmedAt: new Date().toISOString(),
        },
        updatedAt: new Date().toISOString(),
      });
    }

    function resolveScheduleChangeFields(change, draft) {
      const source = change && typeof change === "object" && !Array.isArray(change) ? change : {};
      const after = source.after && typeof source.after === "object" && !Array.isArray(source.after) ? source.after : {};
      const todoId = normalizeText(source.todoId || source.parentTodoId || source.target?.id || source.todo?.id);
      const dueDate = normalizeText(after.dueDate || source.dueDate || draft?.dateRange?.start);
      const startTime = normalizeText(after.startTime || after.start || source.startTime || source.start);
      const endTime = normalizeText(after.endTime || after.end || source.endTime || source.end);
      const startMinutes = parseClockToMinutes(startTime);
      const endMinutes = parseClockToMinutes(endTime);
      const durationMinutes = Number(source.durationMinutes) || (startMinutes !== null && endMinutes !== null ? endMinutes - startMinutes : 0);
      if (!todoId || !isValidDate(dueDate) || startMinutes === null || endMinutes === null || endMinutes <= startMinutes) {
        return null;
      }
      return {
        todoId,
        dueDate,
        startTime,
        endTime,
        durationMinutes: Math.max(5, Math.min(24 * 60, Math.round(durationMinutes || endMinutes - startMinutes))),
      };
    }

    function cloneTodoForSplitBlock(baseTodo, fields, change, draft, nowIso) {
      const blockIndex = Number.isFinite(Number(change?.blockIndex)) ? Number(change.blockIndex) : 1;
      const blockCount = Number.isFinite(Number(change?.blockCount)) ? Number(change.blockCount) : 2;
      return normalizeTodo({
        ...baseTodo,
        id: createId("todo"),
        title: blockCount > 1 ? `${baseTodo.title}（${blockIndex + 1}/${blockCount}）` : baseTodo.title,
        dueDate: fields.dueDate,
        startTime: fields.startTime,
        endTime: fields.endTime,
        estimatedMinutes: fields.durationMinutes,
        remainingMinutes: fields.durationMinutes,
        completed: false,
        calendarSynced: false,
        syncState: "dirty",
        externalCalendarId: "",
        aiMeta: {
          ...(baseTodo.aiMeta || {}),
          source: "ai_schedule_draft",
          sourceTodoId: baseTodo.id,
          scheduleDraftId: draft?.draftId || "",
          scheduleChangeId: change?.changeId || "",
          scheduleAppliedAt: nowIso,
        },
        createdAt: nowIso,
        updatedAt: nowIso,
      });
    }

    function normalizeTodoIdList(value) {
      const source = Array.isArray(value) ? value : value ? [value] : [];
      return Array.from(new Set(source.map((item) => normalizeText(item, 120)).filter(Boolean)));
    }

    function getPostApplyReaction(item, fallback = {}) {
      const payload = item?.payload && typeof item.payload === "object" && !Array.isArray(item.payload)
        ? item.payload
        : {};
      const registrySource = resolveRegistryPostApplyUi(
        payload.sourceAction || payload.source?.action || payload.action || payload.actionId,
        payload.uiRef,
      );
      const source = payload.postApplyUi && typeof payload.postApplyUi === "object"
        ? payload.postApplyUi
        : registrySource || {};
      if (item?.type === "schedule_draft") {
        return {
          view: "todo",
          select: "first_applied",
          highlight: "applied_items",
          scroll: "first_applied",
          ...fallback,
          ...source,
        };
      }
      if (item?.type === "todo_draft") {
        return {
          view: "todo",
          select: "first_created",
          highlight: "created_items",
          scroll: "first_created",
          ...fallback,
          ...source,
        };
      }
      return { ...fallback, ...source };
    }

    function resolvePostApplyTargetIds(reaction = {}, applyResult = {}) {
      const highlight = normalizeText(reaction.highlight, 80);
      if (highlight === "applied_items") return normalizeTodoIdList(applyResult.appliedIds);
      if (highlight === "updated_items") return normalizeTodoIdList(applyResult.updatedIds);
      if (highlight === "created_items") return normalizeTodoIdList(applyResult.createdIds);
      return normalizeTodoIdList(applyResult.targetIds || applyResult.appliedIds || applyResult.createdIds);
    }

    function resolvePostApplySelectedId(reaction = {}, applyResult = {}, targetIds = []) {
      const select = normalizeText(reaction.select, 80);
      if (select === "first_applied") return normalizeTodoIdList(applyResult.appliedIds)[0] || targetIds[0] || "";
      if (select === "first_updated") return normalizeTodoIdList(applyResult.updatedIds)[0] || targetIds[0] || "";
      if (select === "first_created") return normalizeTodoIdList(applyResult.createdIds)[0] || targetIds[0] || "";
      return targetIds[0] || "";
    }

    function findTodoRowNode(todoId) {
      const nodes = documentRef?.querySelectorAll?.(".todo-item[data-id]");
      if (!nodes || !todoId) return null;
      return Array.from(nodes).find((node) => String(node?.dataset?.id || "") === String(todoId)) || null;
    }

    function runPostApplyUiReaction(reaction = {}, applyResult = {}) {
      const targetIds = resolvePostApplyTargetIds(reaction, applyResult);
      const selectedId = resolvePostApplySelectedId(reaction, applyResult, targetIds);
      if (normalizeText(reaction.view, 40) === "todo") setActiveView("todo");
      if (selectedId) setSelectedTodoId(selectedId);

      clearScheduledTimeout(postApplyHighlightTimer);
      if (targetIds.length) {
        setAiHighlightedTodoIds(targetIds);
      } else {
        setAiHighlightedTodoIds([]);
      }

      render();

      const scrollMode = normalizeText(reaction.scroll, 80);
      if (scrollMode && scrollMode !== "none") {
        const scrollTargetId = scrollMode === "first_created"
          ? normalizeTodoIdList(applyResult.createdIds)[0]
          : scrollMode === "first_applied"
            ? normalizeTodoIdList(applyResult.appliedIds)[0]
            : selectedId;
        scheduleTimeout(() => {
          findTodoRowNode(scrollTargetId || selectedId)?.scrollIntoView?.({ block: "center", behavior: "smooth" });
        }, 0);
      }

      if (targetIds.length) {
        postApplyHighlightTimer = scheduleTimeout(() => {
          setAiHighlightedTodoIds([]);
          render();
          postApplyHighlightTimer = null;
        }, postApplyHighlightMs);
      }
    }

    function applyScheduleDraftToTodos(draft) {
      const changes = Array.isArray(draft?.changes) ? draft.changes : [];
      const currentTodos = Array.isArray(getTodos()) ? getTodos() : [];
      if (!changes.length || !currentTodos.length) {
        return { applied: 0, created: 0, missing: changes.length, invalid: 0, appliedIds: [], createdIds: [], updatedIds: [] };
      }

      const nowIso = new Date().toISOString();
      const nextTodos = currentTodos.map((todo) => ({
        ...todo,
        tags: Array.isArray(todo.tags) ? [...todo.tags] : todo.tags,
        dependencies: Array.isArray(todo.dependencies) ? [...todo.dependencies] : todo.dependencies,
        aiMeta: todo.aiMeta && typeof todo.aiMeta === "object" && !Array.isArray(todo.aiMeta) ? { ...todo.aiMeta } : todo.aiMeta,
      }));
      const todoById = new Map(nextTodos.map((todo) => [String(todo.id), todo]));
      const appliedOriginalTodoIds = new Set();
      const touchedDates = new Set();
      const appliedIds = [];
      const createdIds = [];
      const updatedIds = [];
      let created = 0;
      let missing = 0;
      let invalid = 0;

      for (const change of changes) {
        const fields = resolveScheduleChangeFields(change, draft);
        if (!fields) {
          invalid += 1;
          continue;
        }
        const baseTodo = todoById.get(fields.todoId);
        if (!baseTodo || baseTodo.completed) {
          missing += 1;
          continue;
        }

        const targetTodo = appliedOriginalTodoIds.has(fields.todoId)
          ? cloneTodoForSplitBlock(baseTodo, fields, change, draft, nowIso)
          : baseTodo;
        if (targetTodo !== baseTodo) {
          const order = Number(getNextTodoOrderForDate(fields.dueDate));
          if (Number.isFinite(order)) targetTodo.orderInDay = order + created;
          nextTodos.push(targetTodo);
          todoById.set(String(targetTodo.id), targetTodo);
          createdIds.push(String(targetTodo.id));
          created += 1;
        } else {
          updatedIds.push(String(targetTodo.id));
        }

        targetTodo.dueDate = fields.dueDate;
        targetTodo.startTime = fields.startTime;
        targetTodo.endTime = fields.endTime;
        targetTodo.estimatedMinutes = fields.durationMinutes;
        targetTodo.remainingMinutes = Math.min(
          Math.max(0, Number(targetTodo.remainingMinutes) || fields.durationMinutes),
          fields.durationMinutes,
        );
        targetTodo.aiMeta = {
          ...(targetTodo.aiMeta || {}),
          source: targetTodo.aiMeta?.source || "ai_schedule_draft",
          scheduleSource: "ai_schedule_draft",
          scheduleDraftId: draft?.draftId || "",
          scheduleChangeId: change?.changeId || "",
          scheduleAppliedAt: nowIso,
        };
        markTodoPlanningDirty(targetTodo, nowIso);
        touchedDates.add(fields.dueDate);
        appliedOriginalTodoIds.add(fields.todoId);
        appliedIds.push(String(targetTodo.id));
      }

      if (!appliedIds.length) {
        return { applied: 0, created, missing, invalid, appliedIds: [], createdIds, updatedIds };
      }

      setTodos(nextTodos);
      for (const date of touchedDates) {
        normalizeTodoOrderByClockForDate(date);
      }
      const finalTodos = Array.isArray(getTodos()) ? getTodos() : nextTodos;
      saveTodos(finalTodos);
      return { applied: appliedIds.length, created, missing, invalid, appliedIds, createdIds, updatedIds };
    }

    function findPendingItem(id) {
      return pendingItems.find((item) => item.id === id) || null;
    }

    function setPendingStatus(id, nextStatus) {
      pendingItems = pendingItems.map((item) => (item.id === id ? { ...item, status: nextStatus } : item));
      renderPendingItems();
    }

    async function confirmPending(item) {
      if (!item || item.status !== "pending") return;
      setStatus("正在确认。");
      if (item.type === "context_request") {
        const contextRequest = normalizeContextRequestForUi(item.payload?.contextRequest);
        const originalText = normalizeText(item.payload?.originalText || item.editText || item.detail || item.title);
        const rerunCount = Math.max(0, Math.min(AI_CONTEXT_RERUN_MAX, Number.parseInt(String(item.payload?.rerunCount || 0), 10) || 0));
        if (!contextRequest || !originalText) throw new Error("扩围授权缺少原请求或范围。");
        if (rerunCount >= AI_CONTEXT_RERUN_MAX) {
          setPendingStatus(item.id, "rejected");
          appendMessage({ role: "assistant", state: "已停止", paragraphs: ["本轮自动补跑次数已用完。你可以直接补充信息后重新发送。"] });
          setStatus("本轮自动补跑已达上限。");
          return;
        }
        setPendingStatus(item.id, "confirmed");
        rememberConversationContextAccess(contextRequest);
        appendMessage({
          role: "assistant",
          state: "已授权",
          paragraphs: [`已允许本轮参考：${formatContextRequestDetail(contextRequest)}。我会重新理解这句话。`],
        });
        setBusy(false);
        await runAction("assistant", {
          text: originalText,
          suppressUserEcho: true,
          contextGrant: {
            schema: "guanshi-ai-context-grant-v1",
            approved: true,
            sourceRequestId: item.payload?.sourceRequestId || "",
            rerunCount: rerunCount + 1,
            request: contextRequest,
          },
        });
        return;
      }
      if (item.type === "memory_proposal") {
        const proposalId = item.payload?.proposalId;
        if (!proposalId) throw new Error("记忆提案缺少 proposalId。");
        await requestJson(`/api/ai/memory/proposals/${encodeURIComponent(proposalId)}/confirm`, {
          method: "POST",
          body: JSON.stringify({ confirmedBy: "sidebar" }),
        });
        setPendingStatus(item.id, "confirmed");
        appendMessage({ role: "assistant", state: "已确认", paragraphs: [getMemoryProposalConfirmedMessage(item.payload)] });
        setStatus("记忆提案已确认。");
        return;
      }
      if (item.type === "schedule_draft") {
        const draftId = item.payload?.draftId;
        if (!draftId) throw new Error("排程草稿缺少 draftId。");
        const confirmPayload = await requestJson(`/api/ai/schedule-drafts/${encodeURIComponent(draftId)}/confirm`, {
          method: "POST",
          body: JSON.stringify({ confirmedBy: "sidebar" }),
        });
        const responseDraft = confirmPayload?.result?.draft;
        const confirmedDraft = Array.isArray(responseDraft?.changes) && responseDraft.changes.length
          ? responseDraft
          : { ...(item.payload || {}), ...(responseDraft || {}), changes: item.payload?.changes || [] };
        const applyResult = applyScheduleDraftToTodos(confirmedDraft);
        setPendingStatus(item.id, "confirmed");
        if (applyResult.applied > 0) {
          runPostApplyUiReaction(getPostApplyReaction(item), {
            ...applyResult,
            targetIds: applyResult.appliedIds,
          });
          const extra = applyResult.created > 0 ? `，其中新增 ${applyResult.created} 个拆分时间块` : "";
          const skipped = applyResult.missing || applyResult.invalid ? `；${applyResult.missing + applyResult.invalid} 个变更未应用` : "";
          appendMessage({
            role: "assistant",
            state: "已确认",
            paragraphs: [`排程草稿已确认，并已应用 ${applyResult.applied} 个时间块到本地待办${extra}${skipped}。这些待办已标记为待同步，日历/提醒仍走现有同步流程。`],
          });
          setStatus("排程草稿已应用到本地待办。");
        } else {
          appendMessage({
            role: "assistant",
            state: "已确认",
            paragraphs: ["排程草稿已确认，但没有匹配到可写入的本地待办，所以界面不会发生排程变化。请重新生成包含待办引用的排程草稿。"],
          });
          setStatus("排程草稿已确认，但未应用。");
        }
        return;
      }
      if (item.type === "todo_draft") {
        const draftItems = Array.isArray(item.payload?.items) ? item.payload.items : [];
        const createdTodos = draftItems.map((draftItem) => createTodoFromAiItem(draftItem, {
          originalText: item.payload?.originalText || item.editText || item.detail || item.title,
          normalizedGoal: item.payload?.normalizedGoal || item.payload?.parentTitle || "",
          editText: item.editText,
        }));
        const currentTodos = Array.isArray(getTodos()) ? [...getTodos()] : [];
        setTodos([...createdTodos, ...currentTodos]);
        saveTodos([...createdTodos, ...currentTodos]);
        runPostApplyUiReaction(getPostApplyReaction(item), {
          createdIds: createdTodos.map((todo) => todo.id).filter(Boolean),
          appliedIds: createdTodos.map((todo) => todo.id).filter(Boolean),
          targetIds: createdTodos.map((todo) => todo.id).filter(Boolean),
          count: createdTodos.length,
        });
        setPendingStatus(item.id, "confirmed");
        appendMessage({ role: "assistant", state: "已确认", paragraphs: [`已写入 ${createdTodos.length} 个本地待办。`] });
        setStatus("待办草稿已写入。");
      }
    }

    async function rejectPending(item) {
      if (!item || item.status !== "pending") return;
      setStatus("正在拒绝。");
      if (item.type === "memory_proposal" && item.payload?.proposalId) {
        await requestJson(`/api/ai/memory/proposals/${encodeURIComponent(item.payload.proposalId)}/reject`, {
          method: "POST",
          body: JSON.stringify({ rejectedBy: "sidebar" }),
        });
      }
      if (item.type === "schedule_draft" && item.payload?.draftId) {
        await requestJson(`/api/ai/schedule-drafts/${encodeURIComponent(item.payload.draftId)}/reject`, {
          method: "POST",
          body: JSON.stringify({ rejectedBy: "sidebar" }),
        });
      }
      setPendingStatus(item.id, "rejected");
      appendMessage({ role: "assistant", state: "已拒绝", paragraphs: [item.type === "context_request" ? "本轮不会参考这部分额外数据。" : `已拒绝：${item.title}`] });
      setStatus("待确认项已拒绝。");
    }

    function editPending(item) {
      if (!item || !input) return;
      input.value = item.type === "context_request"
        ? item.payload?.originalText || item.editText || item.detail || item.title
        : item.editText || item.detail || item.title;
      input.focus();
      setStatus("已把草稿内容放回输入框，你可以修改后重新发送。");
    }

    async function handlePendingClick(event) {
      handleAiPageActivity();
      const button = event.target?.closest?.("[data-ai-pending-action][data-ai-pending-id]");
      if (!button || isBusy) return;
      const action = button.dataset.aiPendingAction;
      const item = findPendingItem(button.dataset.aiPendingId);
      if (!item) return;
      try {
        setBusy(true);
        if (action === "confirm") await confirmPending(item);
        if (action === "reject") await rejectPending(item);
        if (action === "edit") editPending(item);
      } catch (error) {
        const message = error instanceof Error ? error.message : "待确认操作失败。";
        appendMessage({ role: "assistant", state: "失败", paragraphs: [message] });
        setStatus(message);
      } finally {
        setBusy(false);
      }
    }

    function handleGeneratedClick(event) {
      handleAiPageActivity();
      const button = event.target?.closest?.("[data-ai-generated-id]");
      if (!button) return;
      const item = generatedItems.find((current) => current.id === button.dataset.aiGeneratedId);
      if (!item) return;
      appendMessage({
        role: "assistant",
        state: "草稿",
        paragraphs: [item.title, item.detail || "这个草稿已经在待确认区。"],
      });
    }

    function buildSemanticRetryPrompt(message) {
      const semantic = message?.semanticAction || message?.contextSnapshot?.semanticAction || {};
      const originalText = trimDisplayText(semantic.sourceText || semantic.arguments?.text || getMessageText(message), 900);
      const previousGoal = trimDisplayText(semantic.normalizedGoal || semantic.goal || originalText, 900);
      return [
        "请重新理解上一轮请求，并按我的修正重新生成。",
        originalText ? `原请求：${originalText}` : "",
        previousGoal ? `上次理解：${previousGoal}` : "",
        "我的修正：",
      ].filter(Boolean).join("\n");
    }

    function handleSemanticRetryClick(event) {
      handleAiPageActivity();
      const button = event.target?.closest?.("[data-ai-semantic-retry]");
      if (!button || !input) return;
      const message = getMessageById(button.dataset.aiSemanticRetry);
      if (!message) return;
      const semantic = message.semanticAction || message.contextSnapshot?.semanticAction || {};
      const prompt = buildSemanticRetryPrompt(message);
      pendingSemanticFeedback = {
        schema: AI_SEMANTIC_FEEDBACK_SCHEMA,
        mode: "regenerate",
        sourceMessageId: message.id,
        originalText: semantic.sourceText || semantic.arguments?.text || "",
        previousNormalizedGoal: semantic.normalizedGoal || "",
        previousSemanticAction: semantic,
        prompt,
      };
      input.value = prompt;
      input.focus();
      setStatus("已放入重新理解提示，补一句修正后发送即可重新生成。");
    }

    function handleActionClick(event) {
      handleAiPageActivity();
      const target = event.target?.closest?.("[data-ai-action]") || event.currentTarget;
      const actionKey = String(target?.dataset?.aiAction || "");
      if (!actionKey) return;
      event.preventDefault();
      const rawText = normalizeText(input?.value);
      void runAction(actionKey, { text: rawText });
    }

    function handleThreadClick(event) {
      handleAiPageActivity();
      const contextButton = event.target?.closest?.("[data-ai-context-message-id]");
      if (contextButton) {
        openContextDrawer(contextButton.dataset.aiContextMessageId);
        return;
      }
      if (event.target?.closest?.("[data-ai-pending-action][data-ai-pending-id]")) {
        void handlePendingClick(event);
        return;
      }
      if (event.target?.closest?.("[data-ai-generated-id]")) {
        handleGeneratedClick(event);
        return;
      }
      if (event.target?.closest?.("[data-ai-semantic-retry]")) {
        handleSemanticRetryClick(event);
        return;
      }
      if (event.target?.closest?.("[data-ai-action]")) {
        handleActionClick(event);
      }
    }

    function handleSubmit(event) {
      event.preventDefault();
      handleAiPageActivity();
      open({ focusInput: false });
      const text = normalizeText(input?.value);
      if (!text) {
        const message = "请输入要规划、录入或记忆的内容。";
        setStatus(message);
        appendMessage({ role: "assistant", state: "需要输入", paragraphs: [message], meta: getRequiredInputMeta("assistant") });
        input?.focus();
        return;
      }
      void runAction("assistant", { text });
    }

    function handleProviderSwitchClick(event) {
      event.preventDefault();
      handleAiPageActivity();
      setActiveView("settings");
      render();
      setStatus("已打开设置页 AI 接入，可切换 Provider / CLI。");
      scheduleTimeout(() => {
        const target =
          documentRef?.querySelector?.(".settings-card-ai") ||
          documentRef?.getElementById?.("settings-ai-title");
        target?.scrollIntoView?.({ block: "start", behavior: "smooth" });
        documentRef?.getElementById?.("settings-ai-provider-type")?.focus?.();
      }, 0);
    }

    function handleContextScopeClick(event) {
      event.preventDefault();
      event.stopPropagation?.();
      handleAiPageActivity();
      toggleContextScopeMenu();
    }

    function handleDocumentClick(event) {
      if (!contextScopeMenu || contextScopeMenu.hidden) return;
      const target = event.target || null;
      if (isNodeInside(contextScopeMenu, target) || isNodeInside(contextScopeButton, target)) return;
      closeContextScopeMenu();
    }

    function handleInputKeydown(event) {
      handleAiPageActivity();
      if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
      event.preventDefault();
      form?.requestSubmit?.();
    }

    function handleInputChange() {
      handleAiPageActivity();
      if (!pendingSemanticFeedback || !input) return;
      const value = normalizeText(input.value);
      const marker = normalizeText(pendingSemanticFeedback.prompt).slice(0, 24);
      if (!value || (marker && !value.includes(marker))) {
        pendingSemanticFeedback = null;
      }
    }

    function handleKeydown(event) {
      if (event.key !== "Escape") return;
      if (contextScopeMenu && !contextScopeMenu.hidden) {
        closeContextScopeMenu();
        return;
      }
      if (contextDrawer && !contextDrawer.hidden) {
        closeContextDrawer();
        return;
      }
      if (embedded || !isOpen()) return;
      close({ focusDock: true });
    }

    async function refreshPendingFromServer() {
      if (!fetchFn) return;
      try {
        const [draftPayload, proposalPayload] = await Promise.all([
          requestJson("/api/ai/schedule-drafts?status=pending"),
          requestJson("/api/ai/memory/proposals?status=pending_confirmation"),
        ]);
        const drafts = Array.isArray(draftPayload?.result?.drafts) ? draftPayload.result.drafts : [];
        const proposals = Array.isArray(proposalPayload?.result?.proposals) ? proposalPayload.result.proposals : [];
        const pendingIds = [];
        for (const draft of drafts.slice(0, 8)) {
          const summary = summarizeScheduleDraft(draft);
          pendingIds.push(upsertPendingItem({
            id: `schedule:${draft.draftId}`,
            type: "schedule_draft",
            title: summary.title,
            detail: summary.detail,
            preview: summary.preview,
            payload: withWorkflowUiPayload(draft, draft?.source?.action || "plan_today"),
            editText: `请调整这个排程草稿：${draft.summary || ""}`,
          }, { render: false }));
        }
        for (const proposal of proposals.slice(0, 8)) {
          pendingIds.push(upsertPendingItem({
            id: `memory:${proposal.proposalId}`,
            type: "memory_proposal",
            title: proposal.title || "记忆提案",
            detail: proposal.body || "",
            payload: proposal,
            editText: proposal.body || "",
          }, { render: false }));
        }
        if (pendingIds.length) {
          appendMessage({
            role: "assistant",
            state: "待确认",
            paragraphs: [`读取到 ${pendingIds.length} 个待确认 AI 草稿。`],
            pendingIds,
            showActions: true,
          });
        } else {
          renderMessages();
        }
        setStatus(drafts.length || proposals.length ? "已读取待确认 AI 草稿。" : "AI 工作台准备中。");
      } catch {
        setStatus("AI 工作台准备中，本地接口启动后会读取待确认草稿。");
      }
    }

    function bindEvents() {
      if (eventsBound) return;
      eventsBound = true;

      if (embedded) {
        open({ focusInput: false });
      }

      renderMessages();
      renderGeneratedItems();
      renderPendingItems();
      updateContextScopeControl();
      setStatus("AI 工作台准备中。");

      dockButton?.addEventListener("click", toggle);
      closeButton?.addEventListener("click", () => close({ focusDock: true }));
      panel?.addEventListener("pointerdown", handleAiPageActivity);
      panel?.addEventListener("keydown", handleAiPageActivity);
      panel?.addEventListener("input", handleAiPageActivity);
      panel?.addEventListener("wheel", handleAiPageActivity);
      panel?.addEventListener("touchstart", handleAiPageActivity);
      form?.addEventListener("submit", handleSubmit);
      form?.addEventListener("input", handleAiPageActivity);
      input?.addEventListener("input", handleInputChange);
      input?.addEventListener("keydown", handleInputKeydown);
      contextScopeButton?.addEventListener("click", handleContextScopeClick);
      providerSwitchButton?.addEventListener("click", handleProviderSwitchClick);
      providerSwitchLogo?.addEventListener("error", () => {
        if (!providerSwitchLogo || providerSwitchLogo.dataset.logoFallback === "1") return;
        providerSwitchLogo.dataset.logoFallback = "1";
        providerSwitchLogo.src = `${AI_PROVIDER_LOGO_BASE}${AI_PROVIDER_LOGO_FILES.generic}`;
      });
      thread?.addEventListener("click", handleThreadClick);
      pendingList?.addEventListener("click", (event) => {
        void handlePendingClick(event);
      });
      generatedList?.addEventListener("click", handleGeneratedClick);

      for (const button of actionButtons) {
        button.addEventListener("click", handleActionClick);
      }

      documentRef?.addEventListener("keydown", handleKeydown);
      documentRef?.addEventListener("click", handleDocumentClick);
      void refreshActionRegistry();
      void refreshProviderSwitchIdentity();
      void refreshPendingFromServer();
    }

    return {
      bindEvents,
      close,
      open,
      isOpen,
    };
  }

  globalScope.TimeQualityAiSidebarModule = { createAiSidebarModule };
})(typeof window !== "undefined" ? window : globalThis);
