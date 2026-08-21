(function attachTimeQualityTodoDetailModule(globalScope) {
  if (!globalScope) return;

  function requireFunction(deps, key) {
    const value = deps[key];
    if (typeof value !== "function") {
      throw new Error(`TimeQualityTodoDetailModule missing required function dependency: ${key}`);
    }
    return value;
  }

  function createTodoDetailModule(deps = {}) {
    const documentRef = deps.documentRef || globalScope.document || null;
    const windowRef = deps.windowRef || globalScope.window || globalScope;
    const setTimeoutFn =
      typeof deps.setTimeoutFn === "function"
        ? deps.setTimeoutFn
        : typeof windowRef.setTimeout === "function"
          ? windowRef.setTimeout.bind(windowRef)
          : globalScope.setTimeout.bind(globalScope);
    const clearTimeoutFn =
      typeof deps.clearTimeoutFn === "function"
        ? deps.clearTimeoutFn
        : typeof windowRef.clearTimeout === "function"
          ? windowRef.clearTimeout.bind(windowRef)
          : globalScope.clearTimeout.bind(globalScope);

    const TODO_NOTE_HELPER_TEXT = String(deps.TODO_NOTE_HELPER_TEXT || "");
    const escapeHtml = requireFunction(deps, "escapeHtml");
    const normalizeProjectName = requireFunction(deps, "normalizeProjectName");
    const normalizeTodoCategoryValue = requireFunction(deps, "normalizeTodoCategoryValue");
    const normalizeTodoTags = requireFunction(deps, "normalizeTodoTags");
    const normalizeTodoNoteValue = requireFunction(deps, "normalizeTodoNoteValue");
    const parseOptionalScore = requireFunction(deps, "parseOptionalScore");
    const isValidDateInput = requireFunction(deps, "isValidDateInput");
    const getTodoCategory = requireFunction(deps, "getTodoCategory");
    const normalizeTodoReminderRepeatValue = requireFunction(deps, "normalizeTodoReminderRepeatValue");
    const isRecurringTodoRepeatMode = requireFunction(deps, "isRecurringTodoRepeatMode");
    const renderTopTodoSyncHub = requireFunction(deps, "renderTopTodoSyncHub");
    const render = requireFunction(deps, "render");
    const getSelectedTodo = requireFunction(deps, "getSelectedTodo");
    const getTodos = requireFunction(deps, "getTodos");
    const setSelectedTodoId = requireFunction(deps, "setSelectedTodoId");
    const getActiveView = requireFunction(deps, "getActiveView");
    const submitForm = requireFunction(deps, "submitTodoDetailFromForm");
    const handleTodoFocusStart = requireFunction(deps, "handleTodoFocusStart");
    const handleTodoDelete = requireFunction(deps, "handleTodoDelete");
    const getCategories = typeof deps.getCategories === "function" ? deps.getCategories : () => [];
    const getProjectLibrary = typeof deps.getProjectLibrary === "function" ? deps.getProjectLibrary : () => [];
    const getTagLibrary = typeof deps.getTagLibrary === "function" ? deps.getTagLibrary : () => [];

    const todoNativeInputIcons = Array.isArray(deps.todoNativeInputIcons) ? deps.todoNativeInputIcons : [];
    const todoDetailForm = deps.todoDetailForm || null;
    const todoDetailPanel = deps.todoDetailPanel || null;
    const todoDetailId = deps.todoDetailId || null;
    const todoTitleInput = deps.todoTitleInput || null;
    const todoDueDateInput = deps.todoDueDateInput || null;
    const todoProjectSuggestWrap = deps.todoProjectSuggestWrap || null;
    const todoProjectInput = deps.todoProjectInput || null;
    const todoProjectSuggestionMenu = deps.todoProjectSuggestionMenu || null;
    const todoCategorySuggestWrap = deps.todoCategorySuggestWrap || null;
    const todoCategoryTrigger = deps.todoCategoryTrigger || null;
    const todoCategoryTriggerLabel = deps.todoCategoryTriggerLabel || null;
    const todoCategorySuggestionMenu = deps.todoCategorySuggestionMenu || null;
    const todoCategoryInput = deps.todoCategoryInput || null;
    const todoRepeatSuggestWrap = deps.todoRepeatSuggestWrap || null;
    const todoRepeatTrigger = deps.todoRepeatTrigger || null;
    const todoRepeatTriggerLabel = deps.todoRepeatTriggerLabel || null;
    const todoRepeatSuggestionMenu = deps.todoRepeatSuggestionMenu || null;
    const todoTagSuggestWrap = deps.todoTagSuggestWrap || null;
    const todoTagsInput = deps.todoTagsInput || null;
    const todoTagSuggestionMenu = deps.todoTagSuggestionMenu || null;
    const todoPriorityInput = deps.todoPriorityInput || null;
    const todoNoteInput = deps.todoNoteInput || null;
    const todoQualityInput = deps.todoQualityInput || null;
    const todoHappinessInput = deps.todoHappinessInput || null;
    const todoStartTimeInput = deps.todoStartTimeInput || null;
    const todoEndTimeInput = deps.todoEndTimeInput || null;
    const todoEstimateInput = deps.todoEstimateInput || null;
    const todoReminderInput = deps.todoReminderInput || null;
    const todoRepeatInput = deps.todoRepeatInput || null;
    const todoPlanLockBtn = deps.todoPlanLockBtn || null;
    const todoFocusBtn = deps.todoFocusBtn || null;
    const todoDeleteBtn = deps.todoDeleteBtn || null;
    const scoreWheelPopover = deps.scoreWheelPopover || null;

    let eventsBound = false;
    let todoDetailDirty = false;
    let todoPlanLockTouched = false;
    let todoProjectSuggestionItems = [];
    let todoTagSuggestionItems = [];
    let todoProjectSuggestionActiveIndex = -1;
    let todoTagSuggestionActiveIndex = -1;
    let todoCategorySuggestionActiveIndex = -1;
    let todoRepeatSuggestionActiveIndex = -1;
    let todoReminderConfigCommitTimerId = 0;

    function isNode(node) {
      return typeof globalScope.Node !== "undefined" && node instanceof globalScope.Node;
    }

    function normalizeTodoPriorityValue(value) {
      const text = String(value || "").trim().toUpperCase();
      return ["P0", "P1", "P2", "P3", "P4"].includes(text) ? text : "P3";
    }

    function isElement(node) {
      return typeof globalScope.Element !== "undefined" && node instanceof globalScope.Element;
    }

    function isHtmlInput(node) {
      return typeof globalScope.HTMLInputElement !== "undefined" && node instanceof globalScope.HTMLInputElement;
    }

    function isHtmlButton(node) {
      return typeof globalScope.HTMLButtonElement !== "undefined" && node instanceof globalScope.HTMLButtonElement;
    }

    function isHtmlSelect(node) {
      return typeof globalScope.HTMLSelectElement !== "undefined" && node instanceof globalScope.HTMLSelectElement;
    }

    function isHtmlTextArea(node) {
      return typeof globalScope.HTMLTextAreaElement !== "undefined" && node instanceof globalScope.HTMLTextAreaElement;
    }

    function dispatchNativeInputEvent(target, eventName) {
      if (!target || typeof target.dispatchEvent !== "function") return;
      const EventCtor = globalScope.Event || windowRef.Event;
      if (typeof EventCtor !== "function") return;
      target.dispatchEvent(new EventCtor(eventName, { bubbles: true }));
    }

    function markDirty() {
      todoDetailDirty = true;
    }

    function clearSubmitState() {
      todoDetailDirty = false;
      todoPlanLockTouched = false;
    }

    function clearDirtyForDeferredRender() {
      todoDetailDirty = false;
      if (todoDetailForm) {
        todoDetailForm.dataset.boundTodoId = "";
      }
    }

    function isDirty() {
      return todoDetailDirty;
    }

    function isPlanLockTouched() {
      return todoPlanLockTouched;
    }

    function scheduleReminderConfigAutoCommit() {
      if (todoReminderConfigCommitTimerId) {
        clearTimeoutFn(todoReminderConfigCommitTimerId);
      }
      todoReminderConfigCommitTimerId = setTimeoutFn(() => {
        todoReminderConfigCommitTimerId = 0;
        if (getActiveView() !== "todo") return;
        const selected = getSelectedTodo();
        if (!selected) return;
        const hasPendingChanges = todoDetailDirty || hasPendingChangesFor(selected);
        if (!hasPendingChanges) return;
        submitForm({
          showValidationAlert: false,
          focusInvalidField: false,
          skipRender: false,
          lenientRequired: true,
        });
      }, 0);
    }

    function openNativeInputPicker(input) {
      if (!isHtmlInput(input)) return;
      try {
        input.focus({ preventScroll: true });
      } catch {
        input.focus();
      }

      if (typeof input.showPicker === "function") {
        try {
          input.showPicker();
          return;
        } catch {
          // Fall back below when showPicker is not allowed for this event.
        }
      }

      input.click();
    }

    function handleNativeInputIconClick(event) {
      const icon = event.currentTarget;
      if (!isElement(icon)) return;
      const targetId = String(icon.dataset.targetInput || "").trim();
      if (!targetId || !documentRef) return;
      const targetInput = documentRef.getElementById(targetId);
      if (!isHtmlInput(targetInput)) return;
      openNativeInputPicker(targetInput);
    }

    function handleTodoNoteInputFocus() {
      if (!todoNoteInput) return;
      const current = String(todoNoteInput.value || "").trim();
      if (current !== TODO_NOTE_HELPER_TEXT) return;
      todoNoteInput.value = "";
      markDirty();
    }

    function hasPendingChangesFor(selected) {
      if (!selected) return false;
      const selectedTags = Array.isArray(selected.tags) ? selected.tags : [];

      const title = String(todoTitleInput?.value || "").trim();
      if (title !== String(selected.title || "").trim()) return true;

      const dueDate = String(todoDueDateInput?.value || "").trim();
      if (dueDate !== String(selected.dueDate || "").trim()) return true;

      const project = normalizeProjectName(todoProjectInput?.value || "");
      if (project !== normalizeProjectName(selected.project || "")) return true;

      const category = normalizeTodoCategoryValue(todoCategoryInput?.value, project || selected.project);
      if (category !== getTodoCategory(selected, selected.project)) return true;

      const tags = normalizeTodoTags(todoTagsInput?.value || "");
      if (tags.join(",") !== selectedTags.join(",")) return true;

      const priority = normalizeTodoPriorityValue(todoPriorityInput?.value);
      if (priority !== normalizeTodoPriorityValue(selected.priority)) return true;

      const note = String(todoNoteInput?.value || "").trim();
      if (note !== String(selected.note || "").trim()) return true;

      const quality = parseOptionalScore(todoQualityInput?.value);
      if (quality !== parseOptionalScore(selected.qualityScore)) return true;

      const happiness = parseOptionalScore(todoHappinessInput?.value);
      if (happiness !== parseOptionalScore(selected.happinessScore)) return true;

      const startTime = String(todoStartTimeInput?.value || "").trim();
      if (startTime !== String(selected.startTime || "").trim()) return true;

      const endTime = String(todoEndTimeInput?.value || "").trim();
      if (endTime !== String(selected.endTime || "").trim()) return true;

      const estimateRaw = Number.parseInt(String(todoEstimateInput?.value || ""), 10);
      const estimate = Number.isFinite(estimateRaw) && estimateRaw > 0 ? estimateRaw : null;
      const selectedEstimateRaw = Number.parseInt(String(selected.estimatedMinutes ?? ""), 10);
      const selectedEstimate =
        Number.isFinite(selectedEstimateRaw) && selectedEstimateRaw > 0 ? selectedEstimateRaw : null;
      if (estimate !== selectedEstimate) return true;

      const reminder = String(todoReminderInput?.value || "").trim();
      if (reminder !== String(selected.reminder || "").trim()) return true;

      const repeat = normalizeTodoReminderRepeatValue(todoRepeatInput?.value, "none");
      if (repeat !== normalizeTodoReminderRepeatValue(selected.repeat, "none")) return true;

      const planLocked = isTodoPlanLockControlEnabled();
      if (planLocked !== Boolean(selected.planLocked)) return true;

      return false;
    }

    function collectFormInput({ fallbackTodo = null, lenientRequired = false } = {}) {
      let title = String(todoTitleInput?.value || "").trim();
      let dueDate = String(todoDueDateInput?.value || "").trim();
      let project = normalizeProjectName(todoProjectInput?.value || "");
      let category = normalizeTodoCategoryValue(todoCategoryInput?.value, project);
      let tags = normalizeTodoTags(todoTagsInput?.value || "");
      const priority = normalizeTodoPriorityValue(todoPriorityInput?.value);
      let note = String(todoNoteInput?.value || "").trim();
      const qualityRaw = String(todoQualityInput?.value || "").trim();
      const happinessRaw = String(todoHappinessInput?.value || "").trim();
      const qualityScore = qualityRaw ? Number.parseInt(qualityRaw, 10) : null;
      const happinessScore = happinessRaw ? Number.parseInt(happinessRaw, 10) : null;
      const startTime = String(todoStartTimeInput?.value || "").trim();
      const endTime = String(todoEndTimeInput?.value || "").trim();
      const estimatedMinutes = Number.parseInt(String(todoEstimateInput?.value || "0"), 10);
      const reminder = String(todoReminderInput?.value || "").trim();
      const repeat = normalizeTodoReminderRepeatValue(todoRepeatInput?.value, "none");
      const planLocked = isTodoPlanLockControlEnabled();

      const fallback = fallbackTodo && typeof fallbackTodo === "object" ? fallbackTodo : null;
      if (lenientRequired && fallback) {
        if (!title) {
          title = String(fallback.title || "").trim();
        }
        if (!dueDate) {
          dueDate = String(fallback.dueDate || "").trim();
        }
        category = normalizeTodoCategoryValue(todoCategoryInput?.value, fallback.category || fallback.project);
      }

      if (!title) {
        return { ok: false, message: "标题为必填项。", field: todoTitleInput };
      }
      if (!dueDate || !isValidDateInput(dueDate)) {
        return { ok: false, message: "截止日期为必填项且格式需为 YYYY-MM-DD。", field: todoDueDateInput };
      }
      project = project || "";
      category = normalizeTodoCategoryValue(category, project);
      if (qualityRaw && (!Number.isInteger(qualityScore) || qualityScore < 1 || qualityScore > 10)) {
        return { ok: false, message: "质量评分需在 1-10。", field: todoQualityInput };
      }
      if (happinessRaw && (!Number.isInteger(happinessScore) || happinessScore < 1 || happinessScore > 10)) {
        return { ok: false, message: "幸福评分需在 1-10。", field: todoHappinessInput };
      }

      return {
        ok: true,
        value: {
          title,
          dueDate,
          project,
          category,
          tags,
          priority,
          note: normalizeTodoNoteValue(note),
          qualityScore,
          happinessScore,
          startTime,
          endTime,
          estimatedMinutes: Number.isFinite(estimatedMinutes) && estimatedMinutes > 0 ? estimatedMinutes : null,
          reminder,
          repeat,
          planLocked,
        },
      };
    }

    function commitIfDirty({
      showValidationAlert = true,
      focusInvalidField = true,
      skipRender = false,
    } = {}) {
      if (!todoDetailDirty) return true;
      const selected = getSelectedTodo();
      return submitForm({
        showValidationAlert,
        focusInvalidField,
        skipRender,
        lenientRequired: !selected,
      });
    }

    function handleOutsidePointerDown(event) {
      if (getActiveView() !== "todo" || !todoDetailForm) return;
      const target = event.target;
      if (!isNode(target)) return;
      if (todoDetailPanel && todoDetailPanel.contains(target)) return;
      if (scoreWheelPopover && scoreWheelPopover.contains(target)) return;
      const selected = getSelectedTodo();
      const hasPendingChanges = selected ? (todoDetailDirty || hasPendingChangesFor(selected)) : todoDetailDirty;
      if (!hasPendingChanges) return;

      const committed = submitForm({
        showValidationAlert: false,
        focusInvalidField: false,
        skipRender: true,
        lenientRequired: true,
      });
      if (!committed) return;

      clearDirtyForDeferredRender();
      setTimeoutFn(() => {
        render();
      }, 0);
    }

    function handleSubmit(event) {
      event.preventDefault();
      const selected = getSelectedTodo();
      if (!selected && !todoDetailDirty) return;
      submitForm({
        showValidationAlert: true,
        focusInvalidField: true,
        skipRender: false,
        lenientRequired: !selected,
      });
    }

    function renderTodoDetail() {
      if (!todoDetailForm) return;

      const selected = getSelectedTodo();
      if (!selected) {
        clearSubmitState();
        todoDetailForm.reset();
        todoDetailForm.dataset.boundTodoId = "";
        syncTodoCategoryTriggerLabel();
        syncTodoRepeatTriggerLabel();
        hideTodoCategorySuggestionMenu();
        hideTodoRepeatSuggestionMenu();
        if (todoPriorityInput) todoPriorityInput.value = "P3";
        if (todoDetailId) todoDetailId.textContent = "todo_";
        if (todoFocusBtn) todoFocusBtn.disabled = true;
        if (todoPlanLockBtn) todoPlanLockBtn.disabled = true;
        if (todoDeleteBtn) todoDeleteBtn.disabled = true;
        setTodoPlanLockControlEnabled(false);
        renderTopTodoSyncHub(null);
        return;
      }

      const selectedId = String(selected.id || "");
      const boundTodoId = String(todoDetailForm.dataset.boundTodoId || "");
      if (todoDetailDirty && boundTodoId && boundTodoId === selectedId) {
        renderTopTodoSyncHub(selected);
        return;
      }

      if (todoDetailId) {
        todoDetailId.textContent = String(selected.id);
      }
      if (todoFocusBtn) {
        todoFocusBtn.disabled = Boolean(selected.completed);
      }
      if (todoPlanLockBtn) {
        todoPlanLockBtn.disabled = Boolean(selected.completed);
      }
      if (todoDeleteBtn) {
        todoDeleteBtn.disabled = false;
      }

      if (todoTitleInput) todoTitleInput.value = selected.title || "";
      if (todoDueDateInput) todoDueDateInput.value = selected.dueDate || "";
      if (todoProjectInput) todoProjectInput.value = selected.project || "";
      if (todoCategoryInput) todoCategoryInput.value = getTodoCategory(selected, selected.project);
      syncTodoCategoryTriggerLabel();
      updateTodoCategorySuggestionOptions({ forceShow: false });
      if (todoTagsInput) todoTagsInput.value = Array.isArray(selected.tags) ? selected.tags.join(", ") : "";
      if (todoPriorityInput) todoPriorityInput.value = normalizeTodoPriorityValue(selected.priority);
      if (todoNoteInput) todoNoteInput.value = selected.note || "";
      if (todoQualityInput) {
        const quality = parseOptionalScore(selected.qualityScore);
        todoQualityInput.value = quality === null ? "" : String(quality);
      }
      if (todoHappinessInput) {
        const happiness = parseOptionalScore(selected.happinessScore);
        todoHappinessInput.value = happiness === null ? "" : String(happiness);
      }
      if (todoStartTimeInput) todoStartTimeInput.value = selected.startTime || "";
      if (todoEndTimeInput) todoEndTimeInput.value = selected.endTime || "";
      if (todoEstimateInput) todoEstimateInput.value = selected.estimatedMinutes ? String(selected.estimatedMinutes) : "";
      if (todoReminderInput) todoReminderInput.value = selected.reminder || "";
      if (todoRepeatInput) {
        todoRepeatInput.value = normalizeTodoReminderRepeatValue(selected.repeat, "none");
      }
      setTodoPlanLockControlEnabled(Boolean(selected.planLocked));
      syncTodoRepeatTriggerLabel();
      updateTodoRepeatSuggestionOptions({ forceShow: false });
      todoDetailForm.dataset.boundTodoId = selectedId;
      clearSubmitState();
      renderTopTodoSyncHub(selected);
    }

    function renderProjectTagSuggestions() {
      updateTodoCategorySuggestionOptions({ forceShow: isTodoCategorySuggestionMenuOpen() });
      updateTodoProjectSuggestionOptions(todoProjectInput?.value || "", { forceShow: isTodoProjectSuggestionMenuOpen() });
      updateTodoTagSuggestionOptions(todoTagsInput?.value || "", { forceShow: isTodoTagSuggestionMenuOpen() });
    }

    function buildTodoTagInputSuggestionValues(rawInput) {
      const raw = String(rawInput || "");
      const parts = raw.split(/[，,]/);
      const tail = parts.pop();
      const prefix = String(tail || "").trim().replace(/^#/, "");
      const baseTags = normalizeTodoTags(parts);
      const used = new Set(baseTags);
      const loweredPrefix = prefix.toLowerCase();

      const candidates = getTagLibrary()
        .map((item) => item.name)
        .filter((name) => !used.has(name))
        .filter((name) => {
          if (!loweredPrefix) return true;
          return name.toLowerCase().includes(loweredPrefix);
        })
        .slice(0, 12);

      if (!candidates.length) return [];
      return candidates.map((name) => [...baseTags, name].join(", "));
    }

    function updateTodoProjectSuggestionOptions(rawInput = "", { forceShow = false } = {}) {
      const query = normalizeProjectName(rawInput).toLowerCase();
      const rawCompact = String(rawInput || "").trim().replace(/\s+/g, " ");
      const normalizedInput = normalizeProjectName(rawInput);
      const candidates = getProjectLibrary()
        .map((item) => item.name)
        .filter(Boolean)
        .filter((name) => !query || name.toLowerCase().includes(query))
        .slice(0, 12);
      if (normalizedInput && normalizedInput !== rawCompact && !candidates.includes(normalizedInput)) {
        candidates.unshift(normalizedInput);
      }
      const items = Array.from(new Set(candidates)).slice(0, 12);

      todoProjectSuggestionItems = items;
      todoProjectSuggestionActiveIndex = items.length ? 0 : -1;
      renderTodoProjectSuggestionMenu(forceShow);
    }

    function updateTodoTagSuggestionOptions(rawInput = "", { forceShow = false } = {}) {
      const suggestionValues = buildTodoTagInputSuggestionValues(rawInput);
      todoTagSuggestionItems = suggestionValues;
      todoTagSuggestionActiveIndex = suggestionValues.length ? 0 : -1;
      renderTodoTagSuggestionMenu(forceShow);
    }

    function getResolvedTodoCategoryValue() {
      const categories = getCategories();
      const fallback = categories[0] || "工作";
      const current = String(todoCategoryInput?.value || "").trim();
      return categories.includes(current) ? current : fallback;
    }

    function syncTodoCategoryTriggerLabel() {
      const value = getResolvedTodoCategoryValue();
      if (todoCategoryInput && todoCategoryInput.value !== value) {
        todoCategoryInput.value = value;
      }
      if (todoCategoryTriggerLabel) {
        todoCategoryTriggerLabel.textContent = value;
      }
    }

    function isTodoCategorySuggestionMenuOpen() {
      return Boolean(todoCategorySuggestionMenu && !todoCategorySuggestionMenu.hidden);
    }

    function getTodoRepeatOptions() {
      if (!isHtmlSelect(todoRepeatInput)) {
        return [];
      }
      return Array.from(todoRepeatInput.options).map((option) => ({
        value: String(option.value || ""),
        label: String(option.textContent || option.value || "").trim() || String(option.value || ""),
      }));
    }

    function getResolvedTodoRepeatValue() {
      const options = getTodoRepeatOptions();
      const fallback = options[0]?.value || "none";
      const current = String(todoRepeatInput?.value || "").trim();
      return options.some((item) => item.value === current) ? current : fallback;
    }

    function syncTodoRepeatTriggerLabel() {
      const options = getTodoRepeatOptions();
      const value = getResolvedTodoRepeatValue();
      if (todoRepeatInput && todoRepeatInput.value !== value) {
        todoRepeatInput.value = value;
      }
      const matched = options.find((item) => item.value === value);
      if (todoRepeatTriggerLabel) {
        todoRepeatTriggerLabel.textContent = matched?.label || "不提醒";
      }
    }

    function isTodoPlanLockControlEnabled() {
      if (!isHtmlButton(todoPlanLockBtn)) return false;
      return todoPlanLockBtn.getAttribute("aria-pressed") === "true";
    }

    function setTodoPlanLockControlEnabled(locked) {
      if (!isHtmlButton(todoPlanLockBtn)) return;
      const pressed = Boolean(locked);
      todoPlanLockBtn.setAttribute("aria-pressed", pressed ? "true" : "false");
      todoPlanLockBtn.classList.toggle("is-active", pressed);
      todoPlanLockBtn.setAttribute("aria-label", pressed ? "已锁定排期" : "锁定排期");
      todoPlanLockBtn.setAttribute("title", pressed ? "已锁定排期" : "锁定排期");
    }

    function syncTodoPlanLockControlByRepeatSelection() {
      if (!isHtmlButton(todoPlanLockBtn)) return;
      if (todoPlanLockTouched) return;
      const selected = getSelectedTodo();
      if (selected && Boolean(selected.planLockExplicit)) return;
      const repeat = normalizeTodoReminderRepeatValue(todoRepeatInput?.value, "none");
      setTodoPlanLockControlEnabled(isRecurringTodoRepeatMode(repeat));
    }

    function isTodoRepeatSuggestionMenuOpen() {
      return Boolean(todoRepeatSuggestionMenu && !todoRepeatSuggestionMenu.hidden);
    }

    function isTodoProjectSuggestionMenuOpen() {
      return Boolean(todoProjectSuggestionMenu && !todoProjectSuggestionMenu.hidden);
    }

    function isTodoTagSuggestionMenuOpen() {
      return Boolean(todoTagSuggestionMenu && !todoTagSuggestionMenu.hidden);
    }

    function hideTodoProjectSuggestionMenu() {
      if (!todoProjectSuggestionMenu) return;
      todoProjectSuggestionMenu.hidden = true;
    }

    function hideTodoTagSuggestionMenu() {
      if (!todoTagSuggestionMenu) return;
      todoTagSuggestionMenu.hidden = true;
    }

    function hideTodoCategorySuggestionMenu() {
      if (!todoCategorySuggestionMenu) return;
      todoCategorySuggestionMenu.hidden = true;
      if (todoCategoryTrigger) {
        todoCategoryTrigger.setAttribute("aria-expanded", "false");
      }
    }

    function hideTodoRepeatSuggestionMenu() {
      if (!todoRepeatSuggestionMenu) return;
      todoRepeatSuggestionMenu.hidden = true;
      if (todoRepeatTrigger) {
        todoRepeatTrigger.setAttribute("aria-expanded", "false");
      }
    }

    function updateTodoCategorySuggestionOptions({ forceShow = false } = {}) {
      const categories = getCategories();
      syncTodoCategoryTriggerLabel();
      const current = getResolvedTodoCategoryValue();
      const index = categories.findIndex((name) => name === current);
      todoCategorySuggestionActiveIndex = index >= 0 ? index : (categories.length ? 0 : -1);
      renderTodoCategorySuggestionMenu(forceShow);
    }

    function updateTodoRepeatSuggestionOptions({ forceShow = false } = {}) {
      syncTodoRepeatTriggerLabel();
      const options = getTodoRepeatOptions();
      const current = getResolvedTodoRepeatValue();
      const index = options.findIndex((item) => item.value === current);
      todoRepeatSuggestionActiveIndex = index >= 0 ? index : (options.length ? 0 : -1);
      renderTodoRepeatSuggestionMenu(forceShow);
    }

    function syncTodoSuggestionMenuActiveState(menu, activeIndex) {
      if (!menu) return;
      const items = Array.from(menu.querySelectorAll("button.todo-suggestion-item[data-index]"));
      for (const item of items) {
        const index = Number.parseInt(String(item.dataset.index || "-1"), 10);
        const isActive = index === activeIndex;
        item.classList.toggle("is-active", isActive);
        if (isActive) {
          item.scrollIntoView({ block: "nearest" });
        }
      }
    }

    function renderTodoCategorySuggestionMenu(forceShow = false) {
      const categories = getCategories();
      if (!todoCategorySuggestionMenu) return;
      const shouldShow = forceShow || documentRef?.activeElement === todoCategoryTrigger;
      if (!categories.length || !shouldShow) {
        hideTodoCategorySuggestionMenu();
        return;
      }

      todoCategorySuggestionMenu.innerHTML = categories
        .map((item, index) => {
          const activeClass = index === todoCategorySuggestionActiveIndex ? " is-active" : "";
          return `<button class="todo-suggestion-item${activeClass}" type="button" data-index="${index}" role="option">${escapeHtml(item)}</button>`;
        })
        .join("");
      syncTodoSuggestionMenuActiveState(todoCategorySuggestionMenu, todoCategorySuggestionActiveIndex);
      todoCategorySuggestionMenu.hidden = false;
      if (todoCategoryTrigger) {
        todoCategoryTrigger.setAttribute("aria-expanded", "true");
      }
    }

    function renderTodoRepeatSuggestionMenu(forceShow = false) {
      if (!todoRepeatSuggestionMenu) return;
      const options = getTodoRepeatOptions();
      const shouldShow = forceShow || documentRef?.activeElement === todoRepeatTrigger;
      if (!options.length || !shouldShow) {
        hideTodoRepeatSuggestionMenu();
        return;
      }

      todoRepeatSuggestionMenu.innerHTML = options
        .map((item, index) => {
          const activeClass = index === todoRepeatSuggestionActiveIndex ? " is-active" : "";
          return `<button class="todo-suggestion-item${activeClass}" type="button" data-index="${index}" role="option">${escapeHtml(item.label)}</button>`;
        })
        .join("");
      syncTodoSuggestionMenuActiveState(todoRepeatSuggestionMenu, todoRepeatSuggestionActiveIndex);
      todoRepeatSuggestionMenu.hidden = false;
      if (todoRepeatTrigger) {
        todoRepeatTrigger.setAttribute("aria-expanded", "true");
      }
    }

    function renderTodoProjectSuggestionMenu(forceShow = false) {
      if (!todoProjectSuggestionMenu || !todoProjectInput) return;
      if (!todoProjectSuggestionItems.length || (!forceShow && documentRef?.activeElement !== todoProjectInput)) {
        hideTodoProjectSuggestionMenu();
        return;
      }

      todoProjectSuggestionMenu.innerHTML = todoProjectSuggestionItems
        .map((item, index) => {
          const activeClass = index === todoProjectSuggestionActiveIndex ? " is-active" : "";
          return `<button class="todo-suggestion-item${activeClass}" type="button" data-index="${index}">${escapeHtml(item)}</button>`;
        })
        .join("");
      syncTodoSuggestionMenuActiveState(todoProjectSuggestionMenu, todoProjectSuggestionActiveIndex);
      todoProjectSuggestionMenu.hidden = false;
    }

    function renderTodoTagSuggestionMenu(forceShow = false) {
      if (!todoTagSuggestionMenu || !todoTagsInput) return;
      if (!todoTagSuggestionItems.length || (!forceShow && documentRef?.activeElement !== todoTagsInput)) {
        hideTodoTagSuggestionMenu();
        return;
      }

      todoTagSuggestionMenu.innerHTML = todoTagSuggestionItems
        .map((item, index) => {
          const activeClass = index === todoTagSuggestionActiveIndex ? " is-active" : "";
          return `<button class="todo-suggestion-item${activeClass}" type="button" data-index="${index}">${escapeHtml(item)}</button>`;
        })
        .join("");
      syncTodoSuggestionMenuActiveState(todoTagSuggestionMenu, todoTagSuggestionActiveIndex);
      todoTagSuggestionMenu.hidden = false;
    }

    function applyTodoProjectSuggestion(index, options = {}) {
      if (!todoProjectInput) return;
      const item = todoProjectSuggestionItems[index];
      if (!item) return;
      const keepFocus = options.keepFocus !== false;
      todoProjectInput.value = item;
      markDirty();
      hideTodoProjectSuggestionMenu();
      if (keepFocus) {
        todoProjectInput.focus();
      }
    }

    function applyTodoTagSuggestion(index, options = {}) {
      if (!todoTagsInput) return;
      const item = todoTagSuggestionItems[index];
      if (!item) return;
      const keepFocus = options.keepFocus !== false;
      todoTagsInput.value = item;
      markDirty();
      hideTodoTagSuggestionMenu();
      if (keepFocus) {
        todoTagsInput.focus();
      }
    }

    function applyTodoCategorySuggestion(index, options = {}) {
      const categories = getCategories();
      if (!isHtmlSelect(todoCategoryInput)) return;
      const item = categories[index];
      if (!item) return;

      const keepFocus = options.keepFocus !== false;
      const previous = String(todoCategoryInput.value || "");
      todoCategoryInput.value = item;
      syncTodoCategoryTriggerLabel();
      hideTodoCategorySuggestionMenu();

      if (previous !== item) {
        dispatchNativeInputEvent(todoCategoryInput, "input");
        dispatchNativeInputEvent(todoCategoryInput, "change");
      }

      if (keepFocus && todoCategoryTrigger) {
        todoCategoryTrigger.focus();
      }
    }

    function applyTodoRepeatSuggestion(index, options = {}) {
      if (!isHtmlSelect(todoRepeatInput)) return;
      const items = getTodoRepeatOptions();
      const selected = items[index];
      if (!selected) return;

      const keepFocus = options.keepFocus !== false;
      const previous = String(todoRepeatInput.value || "");
      todoRepeatInput.value = selected.value;
      syncTodoRepeatTriggerLabel();
      hideTodoRepeatSuggestionMenu();

      if (previous !== selected.value) {
        dispatchNativeInputEvent(todoRepeatInput, "input");
        dispatchNativeInputEvent(todoRepeatInput, "change");
      }

      if (keepFocus && todoRepeatTrigger) {
        todoRepeatTrigger.focus();
      }
    }

    function handleTodoCategoryTriggerClick() {
      if (isTodoCategorySuggestionMenuOpen()) {
        hideTodoCategorySuggestionMenu();
        return;
      }
      updateTodoCategorySuggestionOptions({ forceShow: true });
    }

    function handleTodoCategorySuggestionMenuClick(event) {
      const target = event.target;
      if (!isElement(target)) return;
      const button = target.closest("button.todo-suggestion-item[data-index]");
      if (!button) return;
      const index = Number.parseInt(String(button.dataset.index || "-1"), 10);
      if (!Number.isInteger(index) || index < 0) return;
      applyTodoCategorySuggestion(index);
    }

    function handleTodoCategorySuggestionMenuPointerMove(event) {
      const target = event.target;
      if (!isElement(target)) return;
      const button = target.closest("button.todo-suggestion-item[data-index]");
      if (!button || !todoCategorySuggestionMenu) return;
      const index = Number.parseInt(String(button.dataset.index || "-1"), 10);
      if (!Number.isInteger(index) || index < 0 || index === todoCategorySuggestionActiveIndex) return;
      todoCategorySuggestionActiveIndex = index;
      syncTodoSuggestionMenuActiveState(todoCategorySuggestionMenu, todoCategorySuggestionActiveIndex);
    }

    function handleTodoRepeatTriggerClick() {
      if (isTodoRepeatSuggestionMenuOpen()) {
        hideTodoRepeatSuggestionMenu();
        return;
      }
      updateTodoRepeatSuggestionOptions({ forceShow: true });
    }

    function handleTodoRepeatSuggestionMenuClick(event) {
      const target = event.target;
      if (!isElement(target)) return;
      const button = target.closest("button.todo-suggestion-item[data-index]");
      if (!button) return;
      const index = Number.parseInt(String(button.dataset.index || "-1"), 10);
      if (!Number.isInteger(index) || index < 0) return;
      applyTodoRepeatSuggestion(index);
    }

    function handleTodoRepeatSuggestionMenuPointerMove(event) {
      const target = event.target;
      if (!isElement(target)) return;
      const button = target.closest("button.todo-suggestion-item[data-index]");
      if (!button || !todoRepeatSuggestionMenu) return;
      const index = Number.parseInt(String(button.dataset.index || "-1"), 10);
      if (!Number.isInteger(index) || index < 0 || index === todoRepeatSuggestionActiveIndex) return;
      todoRepeatSuggestionActiveIndex = index;
      syncTodoSuggestionMenuActiveState(todoRepeatSuggestionMenu, todoRepeatSuggestionActiveIndex);
    }

    function handleTodoCategorySuggestionKeydown(event) {
      const categories = getCategories();
      if (!categories.length) return;

      if (event.key === "ArrowDown") {
        event.preventDefault();
        if (!isTodoCategorySuggestionMenuOpen()) {
          updateTodoCategorySuggestionOptions({ forceShow: true });
          return;
        }
        todoCategorySuggestionActiveIndex = Math.min(
          categories.length - 1,
          Math.max(0, todoCategorySuggestionActiveIndex + 1),
        );
        renderTodoCategorySuggestionMenu(true);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        if (!isTodoCategorySuggestionMenuOpen()) {
          updateTodoCategorySuggestionOptions({ forceShow: true });
          return;
        }
        todoCategorySuggestionActiveIndex = Math.max(0, todoCategorySuggestionActiveIndex - 1);
        renderTodoCategorySuggestionMenu(true);
        return;
      }
      if ((event.key === "Enter" || event.key === " ") && isTodoCategorySuggestionMenuOpen()) {
        event.preventDefault();
        applyTodoCategorySuggestion(Math.max(0, todoCategorySuggestionActiveIndex));
        return;
      }
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        updateTodoCategorySuggestionOptions({ forceShow: true });
        return;
      }
      if (event.key === "Tab" && isTodoCategorySuggestionMenuOpen()) {
        const index = Math.max(0, todoCategorySuggestionActiveIndex);
        applyTodoCategorySuggestion(index, { keepFocus: false });
        return;
      }
      if (event.key === "Escape") {
        hideTodoCategorySuggestionMenu();
      }
    }

    function handleTodoRepeatSuggestionKeydown(event) {
      const options = getTodoRepeatOptions();
      if (!options.length) return;

      if (event.key === "ArrowDown") {
        event.preventDefault();
        if (!isTodoRepeatSuggestionMenuOpen()) {
          updateTodoRepeatSuggestionOptions({ forceShow: true });
          return;
        }
        todoRepeatSuggestionActiveIndex = Math.min(
          options.length - 1,
          Math.max(0, todoRepeatSuggestionActiveIndex + 1),
        );
        renderTodoRepeatSuggestionMenu(true);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        if (!isTodoRepeatSuggestionMenuOpen()) {
          updateTodoRepeatSuggestionOptions({ forceShow: true });
          return;
        }
        todoRepeatSuggestionActiveIndex = Math.max(0, todoRepeatSuggestionActiveIndex - 1);
        renderTodoRepeatSuggestionMenu(true);
        return;
      }
      if ((event.key === "Enter" || event.key === " ") && isTodoRepeatSuggestionMenuOpen()) {
        event.preventDefault();
        applyTodoRepeatSuggestion(Math.max(0, todoRepeatSuggestionActiveIndex));
        return;
      }
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        updateTodoRepeatSuggestionOptions({ forceShow: true });
        return;
      }
      if (event.key === "Tab" && isTodoRepeatSuggestionMenuOpen()) {
        const index = Math.max(0, todoRepeatSuggestionActiveIndex);
        applyTodoRepeatSuggestion(index, { keepFocus: false });
        return;
      }
      if (event.key === "Escape") {
        hideTodoRepeatSuggestionMenu();
      }
    }

    function handleTodoProjectSuggestionMenuClick(event) {
      const target = event.target;
      if (!isElement(target)) return;
      const button = target.closest("button.todo-suggestion-item[data-index]");
      if (!button) return;
      const index = Number.parseInt(String(button.dataset.index || "-1"), 10);
      if (!Number.isInteger(index) || index < 0) return;
      applyTodoProjectSuggestion(index);
    }

    function handleTodoTagSuggestionMenuClick(event) {
      const target = event.target;
      if (!isElement(target)) return;
      const button = target.closest("button.todo-suggestion-item[data-index]");
      if (!button) return;
      const index = Number.parseInt(String(button.dataset.index || "-1"), 10);
      if (!Number.isInteger(index) || index < 0) return;
      applyTodoTagSuggestion(index);
    }

    function handleTodoProjectSuggestionMenuPointerMove(event) {
      const target = event.target;
      if (!isElement(target)) return;
      const button = target.closest("button.todo-suggestion-item[data-index]");
      if (!button || !todoProjectSuggestionMenu) return;
      const index = Number.parseInt(String(button.dataset.index || "-1"), 10);
      if (!Number.isInteger(index) || index < 0 || index === todoProjectSuggestionActiveIndex) return;
      todoProjectSuggestionActiveIndex = index;
      syncTodoSuggestionMenuActiveState(todoProjectSuggestionMenu, todoProjectSuggestionActiveIndex);
    }

    function handleTodoTagSuggestionMenuPointerMove(event) {
      const target = event.target;
      if (!isElement(target)) return;
      const button = target.closest("button.todo-suggestion-item[data-index]");
      if (!button || !todoTagSuggestionMenu) return;
      const index = Number.parseInt(String(button.dataset.index || "-1"), 10);
      if (!Number.isInteger(index) || index < 0 || index === todoTagSuggestionActiveIndex) return;
      todoTagSuggestionActiveIndex = index;
      syncTodoSuggestionMenuActiveState(todoTagSuggestionMenu, todoTagSuggestionActiveIndex);
    }

    function handleTodoProjectSuggestionKeydown(event) {
      if (!todoProjectSuggestionItems.length) return;
      if (event.key === "Tab" && isTodoProjectSuggestionMenuOpen()) {
        const index = Math.max(0, todoProjectSuggestionActiveIndex);
        applyTodoProjectSuggestion(index, { keepFocus: false });
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        todoProjectSuggestionActiveIndex = Math.min(
          todoProjectSuggestionItems.length - 1,
          Math.max(0, todoProjectSuggestionActiveIndex + 1),
        );
        renderTodoProjectSuggestionMenu(true);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        todoProjectSuggestionActiveIndex = Math.max(0, todoProjectSuggestionActiveIndex - 1);
        renderTodoProjectSuggestionMenu(true);
        return;
      }
      if (event.key === "Enter" && isTodoProjectSuggestionMenuOpen()) {
        event.preventDefault();
        applyTodoProjectSuggestion(Math.max(0, todoProjectSuggestionActiveIndex));
        return;
      }
      if (event.key === "Escape") {
        hideTodoProjectSuggestionMenu();
      }
    }

    function handleTodoTagSuggestionKeydown(event) {
      if (!todoTagSuggestionItems.length) return;
      if (event.key === "Tab" && isTodoTagSuggestionMenuOpen()) {
        const index = Math.max(0, todoTagSuggestionActiveIndex);
        applyTodoTagSuggestion(index, { keepFocus: false });
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        todoTagSuggestionActiveIndex = Math.min(
          todoTagSuggestionItems.length - 1,
          Math.max(0, todoTagSuggestionActiveIndex + 1),
        );
        renderTodoTagSuggestionMenu(true);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        todoTagSuggestionActiveIndex = Math.max(0, todoTagSuggestionActiveIndex - 1);
        renderTodoTagSuggestionMenu(true);
        return;
      }
      if (event.key === "Enter" && isTodoTagSuggestionMenuOpen()) {
        event.preventDefault();
        applyTodoTagSuggestion(Math.max(0, todoTagSuggestionActiveIndex));
        return;
      }
      if (event.key === "Escape") {
        hideTodoTagSuggestionMenu();
      }
    }

    function handleSuggestionOutsidePointerDown(event) {
      const target = event.target;
      if (!isNode(target)) return;
      if (todoProjectSuggestWrap && todoProjectSuggestWrap.contains(target)) return;
      if (todoCategorySuggestWrap && todoCategorySuggestWrap.contains(target)) return;
      if (todoRepeatSuggestWrap && todoRepeatSuggestWrap.contains(target)) return;
      if (todoTagSuggestWrap && todoTagSuggestWrap.contains(target)) return;
      hideTodoCategorySuggestionMenu();
      hideTodoRepeatSuggestionMenu();
      hideTodoProjectSuggestionMenu();
      hideTodoTagSuggestionMenu();
    }

    function handleFormEnterKeydown(event) {
      if (event.defaultPrevented) return;
      if (event.isComposing) return;
      if (event.key !== "Enter") return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const target = event.target;
      if (!isElement(target)) return;
      if (isHtmlTextArea(target)) return;
      if (!(isHtmlInput(target) || isHtmlSelect(target))) return;

      event.preventDefault();
      const selected = getSelectedTodo();
      if (!selected && !todoDetailDirty) return;
      submitForm({
        showValidationAlert: true,
        focusInvalidField: true,
        skipRender: false,
        lenientRequired: !selected,
      });
    }

    function bindEvents() {
      if (eventsBound) return;
      eventsBound = true;

      for (const icon of todoNativeInputIcons) {
        icon.addEventListener("pointerdown", (event) => {
          event.preventDefault();
        });
        icon.addEventListener("click", handleNativeInputIconClick);
      }

      if (todoProjectSuggestionMenu) {
        todoProjectSuggestionMenu.addEventListener("pointerdown", (event) => {
          event.preventDefault();
        });
        todoProjectSuggestionMenu.addEventListener("pointermove", handleTodoProjectSuggestionMenuPointerMove);
        todoProjectSuggestionMenu.addEventListener("click", handleTodoProjectSuggestionMenuClick);
      }
      if (todoCategorySuggestionMenu) {
        todoCategorySuggestionMenu.addEventListener("pointerdown", (event) => {
          event.preventDefault();
        });
        todoCategorySuggestionMenu.addEventListener("pointermove", handleTodoCategorySuggestionMenuPointerMove);
        todoCategorySuggestionMenu.addEventListener("click", handleTodoCategorySuggestionMenuClick);
      }
      if (todoRepeatSuggestionMenu) {
        todoRepeatSuggestionMenu.addEventListener("pointerdown", (event) => {
          event.preventDefault();
        });
        todoRepeatSuggestionMenu.addEventListener("pointermove", handleTodoRepeatSuggestionMenuPointerMove);
        todoRepeatSuggestionMenu.addEventListener("click", handleTodoRepeatSuggestionMenuClick);
      }
      if (todoTagSuggestionMenu) {
        todoTagSuggestionMenu.addEventListener("pointerdown", (event) => {
          event.preventDefault();
        });
        todoTagSuggestionMenu.addEventListener("pointermove", handleTodoTagSuggestionMenuPointerMove);
        todoTagSuggestionMenu.addEventListener("click", handleTodoTagSuggestionMenuClick);
      }

      if (todoProjectInput) {
        todoProjectInput.addEventListener("input", () => {
          updateTodoProjectSuggestionOptions(todoProjectInput.value, { forceShow: true });
        });
        todoProjectInput.addEventListener("focus", () => {
          updateTodoProjectSuggestionOptions(todoProjectInput.value, { forceShow: true });
        });
        todoProjectInput.addEventListener("keydown", handleTodoProjectSuggestionKeydown);
        todoProjectInput.addEventListener("blur", () => {
          setTimeoutFn(() => {
            const raw = String(todoProjectInput.value || "");
            const trimmed = raw.trim();
            const normalized = normalizeProjectName(trimmed);
            if (normalized && normalized !== trimmed) {
              todoProjectInput.value = normalized;
              markDirty();
            }
            hideTodoProjectSuggestionMenu();
          }, 120);
        });
      }

      if (todoCategoryTrigger) {
        todoCategoryTrigger.addEventListener("click", handleTodoCategoryTriggerClick);
        todoCategoryTrigger.addEventListener("keydown", handleTodoCategorySuggestionKeydown);
        todoCategoryTrigger.addEventListener("blur", () => {
          setTimeoutFn(hideTodoCategorySuggestionMenu, 120);
        });
      }
      if (todoCategoryInput) {
        todoCategoryInput.addEventListener("change", syncTodoCategoryTriggerLabel);
      }

      if (todoRepeatTrigger) {
        todoRepeatTrigger.addEventListener("click", handleTodoRepeatTriggerClick);
        todoRepeatTrigger.addEventListener("keydown", handleTodoRepeatSuggestionKeydown);
        todoRepeatTrigger.addEventListener("blur", () => {
          setTimeoutFn(hideTodoRepeatSuggestionMenu, 120);
        });
      }
      if (todoRepeatInput) {
        todoRepeatInput.addEventListener("change", () => {
          syncTodoPlanLockControlByRepeatSelection();
          syncTodoRepeatTriggerLabel();
          scheduleReminderConfigAutoCommit();
        });
      }
      if (todoReminderInput) {
        todoReminderInput.addEventListener("change", () => {
          scheduleReminderConfigAutoCommit();
        });
      }
      if (todoPlanLockBtn) {
        todoPlanLockBtn.addEventListener("click", () => {
          const next = !isTodoPlanLockControlEnabled();
          setTodoPlanLockControlEnabled(next);
          todoPlanLockTouched = true;
          markDirty();
          scheduleReminderConfigAutoCommit();
        });
      }

      if (todoTagsInput) {
        todoTagsInput.addEventListener("input", () => {
          updateTodoTagSuggestionOptions(todoTagsInput.value, { forceShow: true });
        });
        todoTagsInput.addEventListener("focus", () => {
          updateTodoTagSuggestionOptions(todoTagsInput.value, { forceShow: true });
        });
        todoTagsInput.addEventListener("keydown", handleTodoTagSuggestionKeydown);
        todoTagsInput.addEventListener("blur", () => {
          setTimeoutFn(hideTodoTagSuggestionMenu, 120);
        });
      }

      if (todoDetailForm) {
        todoDetailForm.addEventListener("submit", handleSubmit);
        todoDetailForm.addEventListener("input", markDirty);
        todoDetailForm.addEventListener("change", markDirty);
        todoDetailForm.addEventListener("keydown", handleFormEnterKeydown);
      }
      if (todoNoteInput) {
        todoNoteInput.addEventListener("focus", handleTodoNoteInputFocus);
      }
      if (todoFocusBtn) {
        todoFocusBtn.addEventListener("click", handleTodoFocusStart);
      }
      if (todoDeleteBtn) {
        todoDeleteBtn.addEventListener("click", () => {
          handleTodoDelete();
        });
      }

      if (documentRef) {
        documentRef.addEventListener("pointerdown", handleOutsidePointerDown, { capture: true });
        documentRef.addEventListener("pointerdown", handleSuggestionOutsidePointerDown, { capture: true });
      }
    }

    return {
      bindEvents,
      markDirty,
      isDirty,
      clearSubmitState,
      clearDirtyForDeferredRender,
      isPlanLockTouched,
      hasPendingChanges: hasPendingChangesFor,
      collectFormInput,
      commitIfDirty,
      renderTodoDetail,
      renderProjectTagSuggestions,
      getResolvedTodoCategoryValue,
      syncTodoCategoryTriggerLabel,
      updateTodoCategorySuggestionOptions,
      updateTodoProjectSuggestionOptions,
      updateTodoTagSuggestionOptions,
      isTodoCategorySuggestionMenuOpen,
      getTodoRepeatOptions,
      getResolvedTodoRepeatValue,
      syncTodoRepeatTriggerLabel,
      updateTodoRepeatSuggestionOptions,
      isTodoRepeatSuggestionMenuOpen,
      isTodoProjectSuggestionMenuOpen,
      isTodoTagSuggestionMenuOpen,
      isTodoPlanLockControlEnabled,
      setTodoPlanLockControlEnabled,
      syncTodoPlanLockControlByRepeatSelection,
      hideTodoProjectSuggestionMenu,
      hideTodoTagSuggestionMenu,
      hideTodoCategorySuggestionMenu,
      hideTodoRepeatSuggestionMenu,
    };
  }

  globalScope.TimeQualityTodoDetailModule = {
    createTodoDetailModule,
  };
  globalScope.createTodoDetailModule = createTodoDetailModule;
})(typeof window !== "undefined" ? window : globalThis);
