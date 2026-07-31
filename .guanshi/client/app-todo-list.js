(function attachTimeQualityTodoListModule(globalScope) {
  if (!globalScope) return;

  function requireFunction(deps, key) {
    const value = deps[key];
    if (typeof value !== "function") {
      throw new Error(`TimeQualityTodoListModule missing required function dependency: ${key}`);
    }
    return value;
  }

  function createTodoListModule(deps = {}) {
    const TODO_PROJECT_MAX_LEVEL = Number.isFinite(Number(deps.TODO_PROJECT_MAX_LEVEL))
      ? Number(deps.TODO_PROJECT_MAX_LEVEL)
      : 3;
    const TODO_PLAN_NEW_TODO_DURATION_MINUTES = Number.isFinite(Number(deps.TODO_PLAN_NEW_TODO_DURATION_MINUTES))
      ? Number(deps.TODO_PLAN_NEW_TODO_DURATION_MINUTES)
      : 45;
    const TODO_PROJECT_LEVEL_SEPARATOR = String(deps.TODO_PROJECT_LEVEL_SEPARATOR || " / ");

    const TODO_DIMENSION_LABELS = {
      time: "时间",
      project: "项目",
      tag: "标签",
    };
    const TODO_SCOPE_LABELS = {
      all: "全部",
      history: "历史",
      recurring: "周期",
    };
    const TODO_UNSET_PROJECT_LABEL = "未设置项目";
    const TODO_UNTAGGED_LABEL = "未标记";
    const TODO_DRAG_EXPAND_DELAY_MS = 450;

    const todoSortMenu = deps.todoSortMenu || null;
    const todoSortCurrent = deps.todoSortCurrent || null;
    const todoFilterBar = deps.todoFilterBar || null;
    const todoScopeMenu = deps.todoScopeMenu || null;
    const todoScopeCurrent = deps.todoScopeCurrent || null;
    const todoScopeAllBtn = deps.todoScopeAllBtn || null;
    const todoGroups = deps.todoGroups || null;
    const todoHistoryGroups = deps.todoHistoryGroups || null;
    const todoHistoryToggleBtn = deps.todoHistoryToggleBtn || null;
    const todoRecurringToggleBtn = deps.todoRecurringToggleBtn || null;

    const getTodos = requireFunction(deps, "getTodos");
    const saveTodos = requireFunction(deps, "saveTodos");
    const normalizeTodoTags = requireFunction(deps, "normalizeTodoTags");
    const markTodoPlanningDirty = requireFunction(deps, "markTodoPlanningDirty");
    const escapeHtml = requireFunction(deps, "escapeHtml");
    const formatDate = requireFunction(deps, "formatDate");
    const getTodayDateInputValue = requireFunction(deps, "getTodayDateInputValue");
    const getWeekdayLabelForDate = requireFunction(deps, "getWeekdayLabelForDate");
    const isValidDateInput = requireFunction(deps, "isValidDateInput");
    const normalizeProjectName = requireFunction(deps, "normalizeProjectName");
    const normalizeProjectSegmentName = requireFunction(deps, "normalizeProjectSegmentName");
    const buildProjectPathFromSegments = requireFunction(deps, "buildProjectPathFromSegments");
    const getProjectPathSegments = requireFunction(deps, "getProjectPathSegments");
    const getTodoCategory = requireFunction(deps, "getTodoCategory");
    const getTodoDurationMinutes = requireFunction(deps, "getTodoDurationMinutes");
    const formatTodoDurationMinutesLabel = requireFunction(deps, "formatTodoDurationMinutesLabel");
    const formatTodoReminderLabel = requireFunction(deps, "formatTodoReminderLabel");
    const getIncompleteTodosByDate = requireFunction(deps, "getIncompleteTodosByDate");
    const getVisibleTodos = requireFunction(deps, "getVisibleTodos");
    const getTodoHistoryRecords = requireFunction(deps, "getTodoHistoryRecords");
    const getGlobalSearchTerm = requireFunction(deps, "getGlobalSearchTerm");
    const renderTodoDetail = requireFunction(deps, "renderTodoDetail");
    const getSelectedTodoId = requireFunction(deps, "getSelectedTodoId");
    const setSelectedTodoId = requireFunction(deps, "setSelectedTodoId");
    const isTodoAiHighlighted =
      typeof deps.isTodoAiHighlighted === "function" ? deps.isTodoAiHighlighted : () => false;
    const getCurrentTodoDimension = requireFunction(deps, "getCurrentTodoDimension");
    const setCurrentTodoDimension = requireFunction(deps, "setCurrentTodoDimension");
    const getShowTodoHistoryInMainList = requireFunction(deps, "getShowTodoHistoryInMainList");
    const setShowTodoHistoryInMainList = requireFunction(deps, "setShowTodoHistoryInMainList");
    const getShowRecurringReminderOnlyInMainList = requireFunction(deps, "getShowRecurringReminderOnlyInMainList");
    const setShowRecurringReminderOnlyInMainList = requireFunction(deps, "setShowRecurringReminderOnlyInMainList");
    const getTodoProjectTreeCollapsedPaths = requireFunction(deps, "getTodoProjectTreeCollapsedPaths");
    const clearAllRecentlyCompletedForDisplay = requireFunction(deps, "clearAllRecentlyCompletedForDisplay");
    const toggleCollapsedTodoProjectPath = requireFunction(deps, "toggleCollapsedTodoProjectPath");
    const moveTodoOrder = requireFunction(deps, "moveTodoOrder");
    const moveTodoToOrder = requireFunction(deps, "moveTodoToOrder");
    const moveTodoToDateOrder = requireFunction(deps, "moveTodoToDateOrder");
    const restoreHistoryItemToTodo = requireFunction(deps, "restoreHistoryItemToTodo");
    const openTodoHistoryRecord = requireFunction(deps, "openTodoHistoryRecord");
    const toggleTodoCompleted = requireFunction(deps, "toggleTodoCompleted");

    const documentRef = globalScope.document || null;

    let eventsBound = false;
    let todoPendingScrollToTodayGroup = false;
    let todoListDragState = null;
    let todoDragGhost = null;
    let todoDragImageShim = null;
    let todoDropLine = null;
    let todoDragExpandTimer = null;
    let todoDragExpandKey = "";

    function bindEvents() {
      if (eventsBound) return;
      eventsBound = true;

      if (todoFilterBar) {
        todoFilterBar.addEventListener("click", handleFilterClick);
      }
      if (todoSortMenu) {
        todoSortMenu.addEventListener("toggle", () => {
          if (todoSortMenu.open) closeToolbarMenu(todoScopeMenu);
        });
      }
      if (todoScopeMenu) {
        todoScopeMenu.addEventListener("toggle", () => {
          if (todoScopeMenu.open) closeToolbarMenu(todoSortMenu);
        });
      }
      if (todoScopeAllBtn) {
        todoScopeAllBtn.addEventListener("click", () => setTodoScope("all"));
      }
      if (todoHistoryToggleBtn) {
        todoHistoryToggleBtn.addEventListener("click", handleHistoryToggleClick);
      }
      if (todoRecurringToggleBtn) {
        todoRecurringToggleBtn.addEventListener("click", handleRecurringToggleClick);
      }
      if (documentRef) {
        documentRef.addEventListener("click", handleToolbarDocumentClick);
        documentRef.addEventListener("keydown", handleToolbarDocumentKeydown);
      }
      if (todoGroups) {
        todoGroups.addEventListener("click", handleGroupClick);
        todoGroups.addEventListener("dragstart", handleGroupDragStart);
        todoGroups.addEventListener("dragover", handleGroupDragOver);
        todoGroups.addEventListener("drop", handleGroupDrop);
        todoGroups.addEventListener("dragend", handleGroupDragEnd);
        todoGroups.addEventListener("dragleave", handleGroupDragLeave);
        todoGroups.addEventListener(
          "wheel",
          (event) => {
            const canScroll = todoGroups.scrollHeight > todoGroups.clientHeight + 1;
            if (canScroll) {
              event.stopPropagation();
            }
          },
          { passive: true },
        );
      }
      if (todoHistoryGroups) {
        todoHistoryGroups.addEventListener("click", handleHistoryClick);
      }
    }

    function closeToolbarMenu(menu) {
      if (menu && menu.open) {
        menu.open = false;
      }
    }

    function handleToolbarDocumentClick(event) {
      const target = event.target;
      if (todoSortMenu && todoSortMenu.open && !todoSortMenu.contains(target)) {
        closeToolbarMenu(todoSortMenu);
      }
      if (todoScopeMenu && todoScopeMenu.open && !todoScopeMenu.contains(target)) {
        closeToolbarMenu(todoScopeMenu);
      }
    }

    function handleToolbarDocumentKeydown(event) {
      if (event.key !== "Escape") return;
      closeToolbarMenu(todoSortMenu);
      closeToolbarMenu(todoScopeMenu);
    }

    function getTodoScope() {
      if (getShowRecurringReminderOnlyInMainList()) return "recurring";
      if (getShowTodoHistoryInMainList()) return "history";
      return "all";
    }

    function syncTodoScopeButtons() {
      const scope = getTodoScope();
      if (todoScopeCurrent) {
        todoScopeCurrent.textContent = TODO_SCOPE_LABELS[scope] || TODO_SCOPE_LABELS.all;
      }

      const scopeButtons = [
        [todoScopeAllBtn, "all"],
        [todoHistoryToggleBtn, "history"],
        [todoRecurringToggleBtn, "recurring"],
      ];
      for (const [button, value] of scopeButtons) {
        if (!button) continue;
        const isActive = scope === value;
        button.classList.toggle("is-active", isActive);
        button.setAttribute("aria-checked", isActive ? "true" : "false");
      }
    }

    function syncFilterBarButtons() {
      const currentDimension = getCurrentTodoDimension();
      if (todoSortCurrent) {
        todoSortCurrent.textContent = TODO_DIMENSION_LABELS[currentDimension] || TODO_DIMENSION_LABELS.time;
      }
      if (todoFilterBar) {
        const buttons = Array.from(todoFilterBar.querySelectorAll("button[data-dimension]"));
        for (const node of buttons) {
          const dimension = String(node.dataset.dimension || "");
          const isActive = dimension === currentDimension;
          node.classList.toggle("is-active", isActive);
          node.setAttribute("aria-checked", isActive ? "true" : "false");
          node.disabled = false;
          node.removeAttribute("aria-disabled");
        }
      }

      syncTodoScopeButtons();
    }

    function syncHistoryToggleButton() {
      syncTodoScopeButtons();
    }

    function requestScrollToTodayGroup() {
      todoPendingScrollToTodayGroup = true;
    }

    function getNearestTimeGroupToToday(groupNodes, today) {
      if (!Array.isArray(groupNodes) || !groupNodes.length || !isValidDateInput(today)) return null;
      const todayDate = new Date(`${today}T00:00:00`);
      if (Number.isNaN(todayDate.getTime())) return null;
      const dayMs = 24 * 60 * 60 * 1000;
      let bestNode = null;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (const node of groupNodes) {
        const key = String(node.dataset.groupKey || "");
        if (!key.startsWith("date:")) continue;
        const dateText = key.slice(5);
        if (!isValidDateInput(dateText)) continue;
        const date = new Date(`${dateText}T00:00:00`);
        if (Number.isNaN(date.getTime())) continue;
        const distance = Math.abs(Math.round((date.getTime() - todayDate.getTime()) / dayMs));
        if (distance < bestDistance) {
          bestDistance = distance;
          bestNode = node;
        }
      }
      return bestNode;
    }

    function maybeScrollToTodayGroup() {
      if (!todoPendingScrollToTodayGroup || !todoGroups) return;
      todoPendingScrollToTodayGroup = false;
      if (!getShowTodoHistoryInMainList() || getCurrentTodoDimension() !== "time") return;

      const today = getTodayDateInputValue();
      const groupNodes = Array.from(todoGroups.querySelectorAll(".todo-group[data-group-key]"));
      if (!groupNodes.length) return;

      let targetNode = todoGroups.querySelector(`.todo-group[data-group-key="date:${today}"]`);
      if (!(targetNode instanceof HTMLElement)) {
        targetNode = getNearestTimeGroupToToday(groupNodes, today);
      }
      if (!(targetNode instanceof HTMLElement)) return;

      const containerRect = todoGroups.getBoundingClientRect();
      const targetRect = targetNode.getBoundingClientRect();
      const deltaTop = targetRect.top - containerRect.top;
      const top = Math.max(0, todoGroups.scrollTop + deltaTop - 2);
      todoGroups.scrollTop = top;
    }

    function setTodoScope(scope) {
      const nextScope = TODO_SCOPE_LABELS[scope] ? scope : "all";
      const wasHistory = getShowTodoHistoryInMainList();
      setShowTodoHistoryInMainList(nextScope === "history");
      setShowRecurringReminderOnlyInMainList(nextScope === "recurring");
      if (nextScope === "history") {
        if (!wasHistory && getCurrentTodoDimension() === "time") {
          requestScrollToTodayGroup();
        }
        clearAllRecentlyCompletedForDisplay();
      }
      syncHistoryToggleButton();
      syncFilterBarButtons();
      closeToolbarMenu(todoScopeMenu);
      renderTodos();
    }

    function handleHistoryToggleClick() {
      setTodoScope("history");
    }

    function handleRecurringToggleClick() {
      setTodoScope("recurring");
    }

    function handleFilterClick(event) {
      const button = event.target.closest("button[data-dimension]");
      if (!button) return;

      const dimension = String(button.dataset.dimension || "time");
      setCurrentTodoDimension(dimension);
      if (getShowTodoHistoryInMainList() && getCurrentTodoDimension() === "time") {
        requestScrollToTodayGroup();
      }
      syncFilterBarButtons();
      closeToolbarMenu(todoSortMenu);
      renderTodos();
    }

    function getTodoProjectDragGroupKey(todo) {
      return normalizeProjectName(todo?.project || "") || TODO_UNSET_PROJECT_LABEL;
    }

    function getTodoProjectValueFromDragGroup(groupKey) {
      const normalized = normalizeProjectName(groupKey);
      if (!normalized || normalized === TODO_UNSET_PROJECT_LABEL || normalized === "未分组项目") return "";
      return normalized;
    }

    function getTodoTagDragGroupKey(todo) {
      const tags = Array.isArray(todo?.tags) ? todo.tags : normalizeTodoTags(todo?.tags || []);
      const firstTag = String(tags[0] || "").trim();
      return firstTag || TODO_UNTAGGED_LABEL;
    }

    function getTodoTagsForDragGroup(currentTags, groupKey) {
      const targetTag = String(groupKey || "").trim().replace(/^#/, "");
      if (!targetTag || targetTag === TODO_UNTAGGED_LABEL) return [];
      const tags = normalizeTodoTags(currentTags || []);
      return [
        targetTag,
        ...tags.filter((tag) => tag !== targetTag),
      ].slice(0, 8);
    }

    function getTodoDragGroupKey(todo, mode) {
      if (mode === "project") return getTodoProjectDragGroupKey(todo);
      if (mode === "tag") return getTodoTagDragGroupKey(todo);
      if (mode === "time") {
        const dueDate = String(todo?.dueDate || "");
        return isValidDateInput(dueDate) ? dueDate : "";
      }
      return "";
    }

    function getTodoDragOrderField(mode) {
      if (mode === "project") return "projectOrder";
      if (mode === "tag") return "tagOrder";
      return "";
    }

    function getFiniteOrderValue(value) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }

    function compareTodosByFallbackOrder(a, b) {
      const aDate = String(a?.dueDate || "9999-12-31");
      const bDate = String(b?.dueDate || "9999-12-31");
      if (aDate !== bDate) return aDate.localeCompare(bDate);
      const aDayOrder = getFiniteOrderValue(a?.orderInDay);
      const bDayOrder = getFiniteOrderValue(b?.orderInDay);
      const safeADayOrder = aDayOrder === null ? Number.MAX_SAFE_INTEGER : aDayOrder;
      const safeBDayOrder = bDayOrder === null ? Number.MAX_SAFE_INTEGER : bDayOrder;
      if (safeADayOrder !== safeBDayOrder) return safeADayOrder - safeBDayOrder;
      const aStart = String(a?.startTime || "");
      const bStart = String(b?.startTime || "");
      if (aStart !== bStart) return aStart.localeCompare(bStart);
      const aCreated = String(a?.createdAt || "");
      const bCreated = String(b?.createdAt || "");
      if (aCreated !== bCreated) return aCreated.localeCompare(bCreated);
      return String(a?.id || "").localeCompare(String(b?.id || ""));
    }

    function compareTodosByDragOrder(a, b, mode) {
      const orderField = getTodoDragOrderField(mode);
      if (orderField) {
        const aOrder = getFiniteOrderValue(a?.[orderField]);
        const bOrder = getFiniteOrderValue(b?.[orderField]);
        if (aOrder !== null && bOrder !== null && aOrder !== bOrder) return aOrder - bOrder;
        if (aOrder !== null && bOrder === null) return -1;
        if (aOrder === null && bOrder !== null) return 1;
      }
      return compareTodosByFallbackOrder(a, b);
    }

    function sortTodosByDragOrder(list, mode) {
      return [...(Array.isArray(list) ? list : [])].sort((a, b) => compareTodosByDragOrder(a, b, mode));
    }

    function getTodoDragGroupItems(mode, groupKey, excludedTodoId = "") {
      const normalizedGroupKey = String(groupKey || "");
      const excludedId = String(excludedTodoId || "");
      if (mode === "time") {
        return getIncompleteTodosByDate(normalizedGroupKey)
          .filter((todo) => String(todo?.id || "") !== excludedId);
      }

      if (mode !== "project" && mode !== "tag") return [];
      return sortTodosByDragOrder(
        getTodos().filter((todo) => {
          if (!todo || todo.completed) return false;
          if (excludedId && String(todo.id || "") === excludedId) return false;
          return getTodoDragGroupKey(todo, mode) === normalizedGroupKey;
        }),
        mode,
      );
    }

    function getTodoDragGroupItemCount(mode, groupKey) {
      return getTodoDragGroupItems(mode, groupKey).length;
    }

    function assignTodoDragOrder(items, orderField, timestampIso) {
      if (!orderField) return;
      for (let index = 0; index < items.length; index += 1) {
        const todo = items[index];
        if (!todo) continue;
        if (todo[orderField] !== index) {
          todo[orderField] = index;
          markTodoPlanningDirty(todo, timestampIso);
        }
      }
    }

    function moveTodoToGroupedOrder(mode, todoId, targetGroupKey, targetOrder) {
      if (mode !== "project" && mode !== "tag") return;
      const todos = getTodos();
      const todo = todos.find((item) => String(item?.id || "") === String(todoId || ""));
      if (!todo || todo.completed) return;

      const orderField = getTodoDragOrderField(mode);
      const sourceGroupKey = getTodoDragGroupKey(todo, mode);
      const sourceItems = getTodoDragGroupItems(mode, sourceGroupKey, todo.id);

      if (mode === "project") {
        todo.project = getTodoProjectValueFromDragGroup(targetGroupKey);
      } else {
        todo.tags = getTodoTagsForDragGroup(todo.tags, targetGroupKey);
      }

      const resolvedTargetGroupKey = getTodoDragGroupKey(todo, mode);
      const targetItems = getTodoDragGroupItems(mode, resolvedTargetGroupKey, todo.id);
      const safeTargetOrder = Number.isInteger(targetOrder) ? targetOrder : targetItems.length;
      const insertIndex = Math.max(0, Math.min(targetItems.length, safeTargetOrder));
      targetItems.splice(insertIndex, 0, todo);

      const timestampIso = new Date().toISOString();
      markTodoPlanningDirty(todo, timestampIso);
      if (sourceGroupKey !== resolvedTargetGroupKey) {
        assignTodoDragOrder(sourceItems, orderField, timestampIso);
      }
      assignTodoDragOrder(targetItems, orderField, timestampIso);
      saveTodos(todos);
      renderTodos();
    }

    function moveTodoToProjectGroup(todoId, targetGroupKey, targetOrder) {
      moveTodoToGroupedOrder("project", todoId, targetGroupKey, targetOrder);
    }

    function moveTodoToTagGroup(todoId, targetGroupKey, targetOrder) {
      moveTodoToGroupedOrder("tag", todoId, targetGroupKey, targetOrder);
    }

    function clearDragVisualState({ keepDragging = true } = {}) {
      if (!todoGroups) return;
      const dropTargets = todoGroups.querySelectorAll(".todo-item.is-drop-before, .todo-item.is-drop-after");
      for (const node of dropTargets) {
        node.classList.remove("is-drop-before", "is-drop-after");
      }
      clearTodoDropLine();
      if (!keepDragging) {
        clearTodoDragExpandTimer();
        clearTodoDragGhost();
        const draggingNodes = todoGroups.querySelectorAll(".todo-item.is-dragging");
        for (const node of draggingNodes) {
          node.classList.remove("is-dragging");
        }
      }
    }

    function clearTodoDropLine() {
      if (todoDropLine && todoDropLine.parentNode) {
        todoDropLine.parentNode.removeChild(todoDropLine);
      }
      todoDropLine = null;
    }

    function clearTodoDragExpandTimer() {
      if (todoDragExpandTimer) {
        globalScope.clearTimeout(todoDragExpandTimer);
      }
      todoDragExpandTimer = null;
      todoDragExpandKey = "";
    }

    function clearTodoDragGhost() {
      if (todoDragGhost && todoDragGhost.parentNode) {
        todoDragGhost.parentNode.removeChild(todoDragGhost);
      }
      if (todoDragImageShim && todoDragImageShim.parentNode) {
        todoDragImageShim.parentNode.removeChild(todoDragImageShim);
      }
      todoDragGhost = null;
      todoDragImageShim = null;
    }

    function createTodoDragGhost(rowNode, event) {
      if (!documentRef || !todoGroups) return;
      clearTodoDragGhost();
      const listRect = todoGroups.getBoundingClientRect();
      const rowRect = rowNode.getBoundingClientRect();
      const ghost = rowNode.cloneNode(true);
      ghost.classList.remove("is-dragging", "is-drop-before", "is-drop-after");
      ghost.classList.add("todo-drag-ghost");
      ghost.style.left = `${listRect.left}px`;
      ghost.style.top = `${rowRect.top}px`;
      ghost.style.width = `${listRect.width}px`;
      ghost.style.height = `${rowRect.height}px`;
      documentRef.body.appendChild(ghost);

      todoDragGhost = ghost;
      todoListDragState.dragOffsetY = event.clientY - rowRect.top;
      updateTodoDragGhost(event);

      if (event.dataTransfer && typeof event.dataTransfer.setDragImage === "function") {
        const shim = documentRef.createElement("div");
        shim.style.width = "1px";
        shim.style.height = "1px";
        shim.style.opacity = "0";
        shim.style.position = "fixed";
        shim.style.left = "-1000px";
        shim.style.top = "-1000px";
        documentRef.body.appendChild(shim);
        event.dataTransfer.setDragImage(shim, 0, 0);
        todoDragImageShim = shim;
      }
    }

    function updateTodoDragGhost(event) {
      if (!todoDragGhost || !todoGroups || !todoListDragState) return;
      const listRect = todoGroups.getBoundingClientRect();
      const ghostRect = todoDragGhost.getBoundingClientRect();
      const offsetY = Number.isFinite(todoListDragState.dragOffsetY) ? todoListDragState.dragOffsetY : ghostRect.height / 2;
      const top = Math.min(
        Math.max(event.clientY - offsetY, listRect.top),
        Math.max(listRect.top, listRect.bottom - ghostRect.height),
      );
      todoDragGhost.style.left = `${listRect.left}px`;
      todoDragGhost.style.top = `${top}px`;
      todoDragGhost.style.width = `${listRect.width}px`;
    }

    function getDropLineTopForGroup(groupNode, dropPayload = null) {
      if (!(groupNode instanceof HTMLElement)) return null;
      const listNode = groupNode.querySelector(":scope > .todo-list");
      if (listNode instanceof HTMLElement) {
        const rowNodes = listNode.querySelectorAll(":scope > .todo-item");
        const firstRow = rowNodes[0];
        if (dropPayload?.nextOrder === 0 && firstRow instanceof HTMLElement) {
          return firstRow.getBoundingClientRect().top;
        }
        const lastRow = rowNodes[rowNodes.length - 1];
        if (lastRow instanceof HTMLElement) {
          return lastRow.getBoundingClientRect().bottom;
        }
        return listNode.getBoundingClientRect().top;
      }
      const headerNode = groupNode.querySelector(":scope > .todo-group-head, :scope > .todo-project-tree-head");
      if (headerNode instanceof HTMLElement) {
        return headerNode.getBoundingClientRect().bottom;
      }
      return groupNode.getBoundingClientRect().bottom;
    }

    function showTodoDropLine(dropPayload) {
      if (!dropPayload || !documentRef || !todoGroups) return;
      const isOriginalSlot =
        dropPayload.mode === todoListDragState?.mode &&
        dropPayload.groupKey === todoListDragState?.groupKey &&
        dropPayload.nextOrder === todoListDragState?.fromOrder;
      if (isOriginalSlot) {
        clearTodoDropLine();
        return;
      }

      const listRect = todoGroups.getBoundingClientRect();
      let top = null;
      if (dropPayload.rowTarget?.rowNode instanceof HTMLElement) {
        const rowRect = dropPayload.rowTarget.rowNode.getBoundingClientRect();
        top = dropPayload.rowTarget.insertBefore ? rowRect.top : rowRect.bottom;
      } else if (dropPayload.groupTarget?.groupNode instanceof HTMLElement) {
        top = getDropLineTopForGroup(dropPayload.groupTarget.groupNode, dropPayload);
      }
      if (!Number.isFinite(top)) {
        clearTodoDropLine();
        return;
      }

      if (!todoDropLine) {
        todoDropLine = documentRef.createElement("div");
        todoDropLine.className = "todo-drop-line";
        documentRef.body.appendChild(todoDropLine);
      }
      const horizontalInset = Math.min(16, Math.max(8, listRect.width * 0.02));
      todoDropLine.style.left = `${listRect.left + horizontalInset}px`;
      todoDropLine.style.top = `${top - 1}px`;
      todoDropLine.style.width = `${Math.max(24, listRect.width - horizontalInset * 2)}px`;
    }

    function getDragExpandCollapseKey(event) {
      if (!(event.target instanceof Element) || !todoGroups) return "";
      const groupNode = event.target.closest(".todo-group");
      if (groupNode instanceof HTMLElement && todoGroups.contains(groupNode)) {
        const toggleNode = groupNode.querySelector("button.todo-group-toggle.is-collapsed[data-group-collapse-key]");
        if (toggleNode instanceof HTMLElement) return String(toggleNode.dataset.groupCollapseKey || "");
      }

      const projectNode = event.target.closest(".todo-project-tree-node");
      if (projectNode instanceof HTMLElement && todoGroups.contains(projectNode)) {
        const toggleNode = projectNode.querySelector("button.todo-project-tree-toggle.is-collapsed[data-project-path]");
        if (toggleNode instanceof HTMLElement) return String(toggleNode.dataset.projectPath || "");
      }
      return "";
    }

    function scheduleCollapsedGroupExpand(event) {
      if (!todoListDragState) return;
      const key = getDragExpandCollapseKey(event);
      if (!key) {
        clearTodoDragExpandTimer();
        return;
      }
      if (todoDragExpandKey === key && todoDragExpandTimer) return;

      clearTodoDragExpandTimer();
      todoDragExpandKey = key;
      todoDragExpandTimer = globalScope.setTimeout(() => {
        todoDragExpandTimer = null;
        const pendingKey = todoDragExpandKey;
        todoDragExpandKey = "";
        if (!todoListDragState || !pendingKey) return;
        if (!getTodoProjectTreeCollapsedPaths().has(pendingKey)) return;
        toggleCollapsedTodoProjectPath(pendingKey);
        renderTodos();
      }, TODO_DRAG_EXPAND_DELAY_MS);
    }

    function getDragTargetMeta(event, state = null) {
      if (!(event.target instanceof Element)) return null;
      const rowNode = event.target.closest(".todo-item[data-id][data-drag-mode][data-drag-group-key][data-order-index]");
      if (!(rowNode instanceof HTMLElement) || (todoGroups && !todoGroups.contains(rowNode))) return null;
      const mode = String(rowNode.dataset.dragMode || "");
      const groupKey = String(rowNode.dataset.dragGroupKey || "");
      if (!mode || !groupKey) return null;
      if (state?.mode && mode !== state.mode) return null;
      const orderIndex = Number.parseInt(String(rowNode.dataset.orderIndex || "-1"), 10);
      if (!Number.isInteger(orderIndex) || orderIndex < 0) return null;
      const dueDate = String(rowNode.dataset.date || "");
      if (mode === "time" && !isValidDateInput(dueDate)) return null;
      const rect = rowNode.getBoundingClientRect();
      const insertBefore = event.clientY < rect.top + rect.height / 2;
      return {
        rowNode,
        mode,
        groupKey,
        dueDate,
        orderIndex,
        insertBefore,
      };
    }

    function getDragGroupMeta(event, state = null) {
      if (!(event.target instanceof Element)) return null;
      const mode = state?.mode ? String(state.mode) : "";
      const groupSelector = mode === "project"
        ? ".todo-project-tree-node[data-group-dimension][data-drag-group-key]"
        : ".todo-group[data-group-dimension][data-drag-group-key]";
      const groupNode = event.target.closest(groupSelector);
      if (!(groupNode instanceof HTMLElement) || (todoGroups && !todoGroups.contains(groupNode))) return null;
      const groupMode = String(groupNode.dataset.groupDimension || "");
      if (mode && groupMode !== mode) return null;
      const groupKey = String(groupNode.dataset.dragGroupKey || "");
      if (!groupMode || !groupKey) return null;
      const dueDate = String(groupNode.dataset.todoDate || "").trim();
      if (groupMode === "time" && !isValidDateInput(dueDate)) return null;
      const headerSelector = groupMode === "project" ? ".todo-project-tree-head" : ".todo-group-head";
      const headerNode = groupNode.querySelector(`:scope > ${headerSelector}`);
      const headerRect = headerNode instanceof HTMLElement ? headerNode.getBoundingClientRect() : null;
      const isHeaderTarget = Boolean(
        headerRect &&
        event.clientY >= headerRect.top &&
        event.clientY <= headerRect.bottom,
      );
      const firstRow = groupNode.querySelector(":scope > .todo-list > .todo-item");
      const firstRowRect = firstRow instanceof HTMLElement ? firstRow.getBoundingClientRect() : null;
      const isBeforeFirstItem = Boolean(firstRowRect && event.clientY <= firstRowRect.top);
      return {
        groupNode,
        mode: groupMode,
        groupKey,
        dueDate,
        isHeaderTarget,
        isBeforeFirstItem,
      };
    }

    function getDragGroupDate(event) {
      const groupMeta = getDragGroupMeta(event, { mode: "time" });
      return groupMeta?.dueDate || "";
    }

    function normalizeDragDropOrder(fromOrder, slotIndex, isSameGroup) {
      if (!Number.isInteger(fromOrder) || !Number.isInteger(slotIndex) || slotIndex < 0) return null;
      const nextOrder = isSameGroup && slotIndex > fromOrder ? slotIndex - 1 : slotIndex;
      return nextOrder >= 0 ? nextOrder : null;
    }

    function getDragDropOrder(fromOrder, targetMeta, isSameGroup) {
      if (!targetMeta) return null;
      const slotIndex = targetMeta.insertBefore ? targetMeta.orderIndex : targetMeta.orderIndex + 1;
      return normalizeDragDropOrder(fromOrder, slotIndex, isSameGroup);
    }

    function getDragDropPayload(event, state) {
      if (!state) return null;
      const rowTarget = getDragTargetMeta(event, state);
      if (rowTarget) {
        const nextOrder = getDragDropOrder(
          state.fromOrder,
          rowTarget,
          rowTarget.groupKey === state.groupKey,
        );
        if (Number.isInteger(nextOrder)) {
          return {
            mode: rowTarget.mode,
            groupKey: rowTarget.groupKey,
            dueDate: rowTarget.dueDate,
            nextOrder,
            rowTarget,
            groupTarget: null,
          };
        }
      }

      const groupTarget = getDragGroupMeta(event, state);
      if (!groupTarget) return null;
      const groupTodoCount = getTodoDragGroupItemCount(groupTarget.mode, groupTarget.groupKey);
      const shouldInsertAtGroupStart =
        groupTarget.mode === "time" &&
        (groupTarget.isHeaderTarget || groupTarget.isBeforeFirstItem);
      const slotIndex = shouldInsertAtGroupStart ? 0 : groupTodoCount;
      const nextOrder = normalizeDragDropOrder(
        state.fromOrder,
        slotIndex,
        groupTarget.groupKey === state.groupKey,
      );
      if (!Number.isInteger(nextOrder)) return null;
      return {
        mode: groupTarget.mode,
        groupKey: groupTarget.groupKey,
        dueDate: groupTarget.dueDate,
        nextOrder,
        rowTarget: null,
        groupTarget,
      };
    }

    function handleGroupDragStart(event) {
      if (!(event.target instanceof Element)) return;
      const rowNode = event.target.closest(".todo-item[draggable=\"true\"][data-id][data-drag-mode][data-drag-group-key][data-order-index]");
      if (!(rowNode instanceof HTMLElement)) return;
      const todoId = String(rowNode.dataset.id || "");
      const mode = String(rowNode.dataset.dragMode || "");
      const groupKey = String(rowNode.dataset.dragGroupKey || "");
      const dueDate = String(rowNode.dataset.date || "");
      const fromOrder = Number.parseInt(String(rowNode.dataset.orderIndex || "-1"), 10);
      if (!todoId || !mode || !groupKey || !Number.isInteger(fromOrder) || fromOrder < 0) return;
      if (mode === "time" && !isValidDateInput(dueDate)) return;

      todoListDragState = {
        todoId,
        mode,
        groupKey,
        dueDate,
        fromOrder,
        targetMode: mode,
        targetGroupKey: groupKey,
        targetDueDate: dueDate,
        targetOrder: fromOrder,
        lastDropPayload: null,
        dragOffsetY: 0,
      };
      clearDragVisualState({ keepDragging: false });
      setSelectedTodoId(todoId);
      const selectedNodes = todoGroups.querySelectorAll(".todo-item.is-selected");
      for (const node of selectedNodes) {
        node.classList.remove("is-selected");
      }
      rowNode.classList.add("is-selected");
      rowNode.classList.add("is-dragging");
      renderTodoDetail();

      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", todoId);
      }
      createTodoDragGhost(rowNode, event);
    }

    function handleGroupDragOver(event) {
      if (!todoListDragState) return;
      updateTodoDragGhost(event);
      scheduleCollapsedGroupExpand(event);
      const dropPayload = getDragDropPayload(event, todoListDragState);
      if (!dropPayload) return;

      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "move";
      }

      clearDragVisualState({ keepDragging: true });
      showTodoDropLine(dropPayload);
      todoListDragState.targetMode = dropPayload.mode;
      todoListDragState.targetGroupKey = dropPayload.groupKey;
      todoListDragState.targetDueDate = dropPayload.dueDate;
      todoListDragState.targetOrder = dropPayload.nextOrder;
      todoListDragState.lastDropPayload = dropPayload;
    }

    function handleGroupDrop(event) {
      if (!todoListDragState) return;
      event.preventDefault();

      const {
        todoId,
        mode,
        groupKey,
        dueDate,
        fromOrder,
        lastDropPayload,
      } = todoListDragState;
      clearDragVisualState({ keepDragging: false });
      todoListDragState = null;

      const dropPayload = lastDropPayload;
      if (!dropPayload || dropPayload.mode !== mode) return;
      const targetGroupKey = dropPayload.groupKey;
      const targetDueDate = dropPayload.dueDate;
      const targetOrder = dropPayload.nextOrder;
      if (mode !== "time") {
        if (!targetGroupKey || !Number.isInteger(targetOrder)) return;
        if (targetGroupKey === groupKey && targetOrder === fromOrder) return;
        if (mode === "project") {
          moveTodoToProjectGroup(todoId, targetGroupKey, targetOrder);
          return;
        }
        if (mode === "tag") {
          moveTodoToTagGroup(todoId, targetGroupKey, targetOrder);
        }
        return;
      }

      if (!isValidDateInput(targetDueDate) || !Number.isInteger(targetOrder)) return;
      if (targetDueDate === dueDate && targetOrder === fromOrder) return;
      if (targetDueDate === dueDate) {
        moveTodoToOrder(todoId, targetOrder);
        return;
      }
      moveTodoToDateOrder(todoId, targetDueDate, targetOrder);
    }

    function handleGroupDragEnd() {
      clearTodoDragExpandTimer();
      clearDragVisualState({ keepDragging: false });
      todoListDragState = null;
    }

    function handleGroupDragLeave(event) {
      if (!todoListDragState || !todoGroups) return;
      const nextTarget = event.relatedTarget;
      if (nextTarget instanceof Node && todoGroups.contains(nextTarget)) return;
      clearTodoDragExpandTimer();
      clearDragVisualState({ keepDragging: true });
    }

    function handleGroupClick(event) {
      const projectTreeToggleBtn = event.target.closest("button.todo-project-tree-toggle[data-project-path]");
      if (projectTreeToggleBtn) {
        const path = String(projectTreeToggleBtn.dataset.projectPath || "");
        if (path) {
          toggleCollapsedTodoProjectPath(path);
          renderTodos();
        }
        return;
      }

      const groupToggleBtn = event.target.closest("button.todo-group-toggle[data-group-collapse-key]");
      if (groupToggleBtn) {
        const key = String(groupToggleBtn.dataset.groupCollapseKey || "");
        if (key) {
          toggleCollapsedTodoProjectPath(key);
          renderTodos();
        }
        return;
      }

      const orderBtn = event.target.closest("button.todo-order-btn[data-id][data-dir]");
      if (orderBtn) {
        const id = String(orderBtn.dataset.id || "");
        const dir = Number.parseInt(String(orderBtn.dataset.dir || "0"), 10);
        if (id && Number.isInteger(dir) && dir !== 0) {
          moveTodoOrder(id, dir);
        }
        return;
      }

      const restoreBtn = event.target.closest("button.todo-history-restore-btn[data-history-source][data-history-id]");
      if (restoreBtn) {
        const source = String(restoreBtn.dataset.historySource || "");
        const id = String(restoreBtn.dataset.historyId || "");
        if (source && id) {
          restoreHistoryItemToTodo(source, id);
        }
        return;
      }

      const historyItem = event.target.closest(".todo-item-history[data-source][data-history-id]");
      if (historyItem) {
        const source = String(historyItem.dataset.source || "");
        const id = String(historyItem.dataset.historyId || "");
        if (source && id) {
          openTodoHistoryRecord(source, id);
        }
        return;
      }

      const checkBtn = event.target.closest("button.todo-check[data-id]");
      if (checkBtn) {
        const id = String(checkBtn.dataset.id || "");
        if (id) toggleTodoCompleted(id);
        return;
      }

      const itemNode = event.target.closest(".todo-item[data-id]");
      if (!itemNode) return;
      const id = String(itemNode.dataset.id || "");
      if (!id) return;
      setSelectedTodoId(id);
      renderTodos();
    }

    function buildDueBadge(todo) {
      if (!todo.dueDate) {
        return '<span class="todo-badge due-future">未排期</span>';
      }

      const today = getTodayDateInputValue();
      let tone = "due-future";
      if (todo.dueDate < today && !todo.completed) {
        tone = "due-overdue";
      } else if (todo.dueDate === today && !todo.completed) {
        tone = "due-today";
      }

      return `<span class=\"todo-badge ${tone}\">${escapeHtml(formatDate(todo.dueDate))}</span>`;
    }

    function buildSyncBadge(todo) {
      if (todo.syncState === "conflict") {
        return '<span class="todo-badge conflict">冲突</span>';
      }
      if (todo.syncState === "error") {
        return '<span class="todo-badge error">失败</span>';
      }
      return "";
    }

    function renderTodoRowHtml(
      todo,
      {
        allowTimeOrder = false,
        timeReorderIndexMap = null,
        dragMode = "",
        dragGroupKey = "",
        groupOrderIndex = null,
      } = {},
    ) {
      const selectedClass = String(todo.id) === String(getSelectedTodoId()) ? " is-selected" : "";
      const aiHighlightClass = isTodoAiHighlighted(todo.id) ? " is-ai-highlighted" : "";
      const completedClass = todo.completed ? " is-completed" : "";
      const checkClass = todo.completed ? " is-completed" : "";
      const dateBadge = buildDueBadge(todo);
      const tagBadges = (todo.tags || [])
        .slice(0, 2)
        .map((tag) => `<span class=\"todo-badge tag\">#${escapeHtml(tag)}</span>`)
        .join("");
      const syncedBadge = buildSyncBadge(todo);
      const timeBadge =
        todo.startTime && todo.endTime
          ? `<span class=\"todo-badge due-future\">${escapeHtml(todo.startTime)}-${escapeHtml(todo.endTime)}</span>`
          : "";
      const lockBadge = todo.planLocked
        ? `
      <span class="todo-badge lock todo-lock-icon-badge" aria-label="已锁定排期" title="已锁定排期">
        <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <rect x="5.3" y="9.2" width="9.4" height="6.7" rx="1.6"></rect>
          <path d="M7.4 9.2V7.5a2.6 2.6 0 0 1 5.2 0v1.7"></path>
        </svg>
      </span>
    `
        : "";
      const categoryText = getTodoCategory(todo, todo.project) || "未分类";
      const projectText = normalizeProjectName(todo.project || "");
      const reminderText = formatTodoReminderLabel(todo.reminder, todo.repeat, {
        startTime: todo.startTime,
      });
      const reminderLabel = String(reminderText || "").trim();
      const projectContextHtml = projectText
        ? `<p class=\"todo-item-context-project\">${escapeHtml(projectText)}</p>`
        : "";
      const reminderContextHtml = reminderLabel && reminderLabel !== "不提醒"
        ? `<p class=\"todo-item-context-score\">${escapeHtml(reminderLabel)}</p>`
        : "";
      const contextHtml = projectContextHtml || reminderContextHtml
        ? `<div class=\"todo-item-context\">${projectContextHtml}${reminderContextHtml}</div>`
        : "";
      const rowContextClass = contextHtml ? "" : " has-no-context";
      const durationMinutes = getTodoDurationMinutes(todo, TODO_PLAN_NEW_TODO_DURATION_MINUTES);
      const hasNote = Boolean(String(todo.note || "").trim());
      const titleMetaHtml = [
        categoryText,
        formatTodoDurationMinutesLabel(durationMinutes),
        hasNote ? "备注" : "",
      ]
        .filter(Boolean)
        .map((item) => `<span class=\"todo-item-title-meta-item\">${escapeHtml(item)}</span>`)
        .join('<span class=\"todo-subline-sep\" aria-hidden=\"true\">·</span>');
      const effectiveDragMode = dragMode || (allowTimeOrder ? "time" : "");
      const effectiveDragGroupKey = String(dragGroupKey || (allowTimeOrder ? todo.dueDate || "" : ""));
      const reorderIndex = effectiveDragMode === "time" && timeReorderIndexMap instanceof Map
        ? timeReorderIndexMap.get(String(todo.id))
        : groupOrderIndex;
      const hasDragOrder = Number.isInteger(reorderIndex) && effectiveDragMode && effectiveDragGroupKey;
      const canDragReorder =
        hasDragOrder &&
        !todo.completed &&
        (effectiveDragMode !== "time" || !todo.planLocked);
      const rowDragClass = canDragReorder ? " is-draggable" : "";
      const rowOrderAttrs = hasDragOrder
        ? ` data-drag-mode=\"${escapeHtml(effectiveDragMode)}\" data-drag-group-key=\"${escapeHtml(effectiveDragGroupKey)}\" data-order-index=\"${reorderIndex}\"${effectiveDragMode === "time" ? ` data-date=\"${escapeHtml(String(todo.dueDate || ""))}\"` : ""}`
        : "";
      const rowDragAttrs = canDragReorder ? ' draggable="true"' : "";

      return `
    <li class=\"todo-item${selectedClass}${aiHighlightClass}${completedClass}${rowDragClass}${rowContextClass}\" data-id=\"${escapeHtml(String(todo.id))}\"${rowOrderAttrs}${rowDragAttrs}>
      <button class=\"todo-check${checkClass}\" data-id=\"${escapeHtml(String(todo.id))}\" type=\"button\">${todo.completed ? "✓" : ""}</button>
      <div class=\"todo-item-main\">
        <p class=\"todo-item-title\">
          <span class=\"todo-item-title-text\">${escapeHtml(todo.title)}</span>
          <span class=\"todo-item-title-meta\">${titleMetaHtml}</span>
        </p>
      </div>
      ${contextHtml}
      <div class=\"todo-badges\">${tagBadges}${timeBadge}${dateBadge}${lockBadge}${syncedBadge}</div>
    </li>
  `;
    }

    function renderTodoHistoryRowHtml(item) {
      const sourceText = item.source === "todo" ? "待办完成" : "日历记录";
      const timeText = item.start && item.end ? `${item.start}-${item.end}` : "时间未知";
      const recordId = item.entryId || item.todoId || "";
      const historySource = String(item.source || "").trim();
      const canRestore = Boolean(historySource && recordId);
      const restoreDisabledAttr = canRestore ? "" : " disabled";
      const dateText = item.date ? formatDate(item.date) : "--";
      const reminderText = formatTodoReminderLabel(item.reminder, item.repeat, {
        startTime: item.startTime || item.start,
      });
      const projectText = normalizeProjectName(item.project || "");
      const reminderLabel = String(reminderText || "").trim();
      const projectContextHtml = projectText
        ? `<p class=\"todo-item-context-project\">${escapeHtml(projectText)}</p>`
        : "";
      const reminderContextHtml = reminderLabel && reminderLabel !== "不提醒"
        ? `<p class=\"todo-item-context-score\">${escapeHtml(reminderLabel)}</p>`
        : "";
      const contextHtml = projectContextHtml || reminderContextHtml
        ? `<div class=\"todo-item-context\">${projectContextHtml}${reminderContextHtml}</div>`
        : "";
      const rowContextClass = contextHtml ? "" : " has-no-context";
      const tagBadges = (item.tags || [])
        .slice(0, 2)
        .map((tag) => `<span class=\"todo-badge tag\">#${escapeHtml(tag)}</span>`)
        .join("");
      return `
    <li class=\"todo-item todo-item-history${rowContextClass}\" data-source=\"${escapeHtml(item.source)}\" data-id=\"${escapeHtml(recordId)}\" data-history-id=\"${escapeHtml(recordId)}\">
      <button
        class=\"todo-check is-completed todo-history-restore-btn\"
        type=\"button\"
        data-history-source=\"${escapeHtml(historySource)}\"
        data-history-id=\"${escapeHtml(recordId)}\"
        aria-label=\"恢复为未完成待办\"
        title=\"恢复为未完成待办\"${restoreDisabledAttr}
      ></button>
      <div class=\"todo-item-main\">
        <p class=\"todo-item-title\">
          <span class=\"todo-item-title-text\">${escapeHtml(item.title)}</span>
        </p>
      </div>
      ${contextHtml}
      <div class=\"todo-badges\">
        ${tagBadges}
        <span class=\"todo-badge due-future\">${escapeHtml(timeText)}</span>
        <span class=\"todo-badge due-future\">${escapeHtml(dateText)}</span>
        <span class=\"todo-badge synced\">${escapeHtml(sourceText)}</span>
      </div>
    </li>
  `;
    }

    function buildProjectTree(todoList = [], historyList = []) {
      const nodeMap = new Map();
      const ensureNode = (path, name, level, parentPath) => {
        if (nodeMap.has(path)) return nodeMap.get(path);
        const node = {
          path,
          name,
          level,
          parentPath,
          children: [],
          todos: [],
          history: [],
          totalTodoCount: 0,
          pendingTodoCount: 0,
          totalHistoryCount: 0,
        };
        nodeMap.set(path, node);
        return node;
      };

      const ensureChain = (projectPath, fallbackLabel = "未设置项目") => {
        const normalizedPath = normalizeProjectName(projectPath) || fallbackLabel;
        const parts = getProjectPathSegments(normalizedPath);
        const fallbackParts = parts.length ? parts : [normalizeProjectSegmentName(normalizedPath) || fallbackLabel];
        const chain = [];
        for (let index = 0; index < fallbackParts.length; index += 1) {
          const partial = fallbackParts.slice(0, index + 1);
          const path = buildProjectPathFromSegments(partial) || fallbackParts[index];
          const parentPath = index > 0 ? buildProjectPathFromSegments(fallbackParts.slice(0, index)) : "";
          chain.push(ensureNode(path, fallbackParts[index], index + 1, parentPath));
        }
        return chain;
      };

      for (const todo of todoList) {
        const chain = ensureChain(todo.project || "未设置项目", "未设置项目");
        const leaf = chain[chain.length - 1];
        leaf.todos.push(todo);
        for (const node of chain) {
          node.totalTodoCount += 1;
          if (!todo.completed) {
            node.pendingTodoCount += 1;
          }
        }
      }

      for (const item of historyList) {
        const chain = ensureChain(item.project || "记录", "记录");
        const leaf = chain[chain.length - 1];
        leaf.history.push(item);
        for (const node of chain) {
          node.totalHistoryCount += 1;
        }
      }

      for (const node of nodeMap.values()) {
        if (!node.parentPath) continue;
        const parent = nodeMap.get(node.parentPath);
        if (parent) {
          parent.children.push(node);
        }
      }

      const sorter = (a, b) => {
        if (b.pendingTodoCount !== a.pendingTodoCount) return b.pendingTodoCount - a.pendingTodoCount;
        if (b.totalTodoCount !== a.totalTodoCount) return b.totalTodoCount - a.totalTodoCount;
        if (b.totalHistoryCount !== a.totalHistoryCount) return b.totalHistoryCount - a.totalHistoryCount;
        return String(a.name || "").localeCompare(String(b.name || ""), "zh-CN");
      };
      const roots = Array.from(nodeMap.values()).filter((node) => !node.parentPath);
      const sortChildren = (items) => {
        items.sort(sorter);
        for (const item of items) {
          sortChildren(item.children);
        }
      };
      for (const node of nodeMap.values()) {
        node.todos = sortTodosByDragOrder(node.todos, "project");
      }
      sortChildren(roots);
      return roots;
    }

    function renderProjectTreeNode(node, { includeHistory = false } = {}) {
      const level = Math.max(1, Math.min(3, Number(node.level) || 1));
      const hasChildren = Array.isArray(node.children) && node.children.length > 0;
      const totalCount = node.totalTodoCount + (includeHistory ? node.totalHistoryCount : 0);
      const todoRows = node.todos
        .map((todo, index) => renderTodoRowHtml(todo, {
          dragMode: "project",
          dragGroupKey: node.path,
          groupOrderIndex: index,
        }))
        .join("");
      const historyRows = includeHistory
        ? node.history.map((item) => renderTodoHistoryRowHtml(item)).join("")
        : "";
      const hasRows = Boolean(todoRows || historyRows);
      const canToggle = hasChildren || hasRows;
      const isCollapsed = canToggle && getTodoProjectTreeCollapsedPaths().has(node.path);
      const toggleHtml = canToggle
        ? `<button
        class="todo-project-tree-toggle${isCollapsed ? " is-collapsed" : ""}"
        type="button"
        data-project-path="${escapeHtml(node.path)}"
        aria-label="${isCollapsed ? "展开项目" : "收起项目"}"
        title="${isCollapsed ? "展开项目" : "收起项目"}"
      ></button>`
        : '<span class="todo-project-tree-toggle-placeholder" aria-hidden="true"></span>';
      const rowsHtml = !isCollapsed && hasRows
        ? `<ul class="todo-list">${todoRows}${historyRows}</ul>`
        : "";
      const childrenHtml = !isCollapsed && hasChildren
        ? `
      <div class="todo-project-tree-children">
        ${node.children.map((child) => renderProjectTreeNode(child, { includeHistory })).join("")}
      </div>
    `
        : "";

      return `
    <section class="todo-project-tree-node todo-project-tree-level-${level}" data-project-path="${escapeHtml(node.path)}" data-group-dimension="project" data-drag-group-key="${escapeHtml(node.path)}">
      <header class="todo-project-tree-head">
        <div class="todo-project-tree-title-wrap">
          ${toggleHtml}
          <h3>${escapeHtml(node.name)}</h3>
        </div>
        <span class="todo-group-count">${totalCount} 项</span>
      </header>
      ${!isCollapsed ? rowsHtml : ""}
      ${childrenHtml}
    </section>
  `;
    }

    function renderProjectTreeView(todoList = [], historyList = []) {
      const roots = buildProjectTree(todoList, historyList);
      if (!roots.length) {
        todoGroups.innerHTML = getShowTodoHistoryInMainList()
          ? '<p class="todo-empty">当前排序下没有待办或历史事件。</p>'
          : '<p class="todo-empty">当前筛选下没有待办。</p>';
        renderTodoDetail();
        return;
      }
      const includeHistory = Boolean(getShowTodoHistoryInMainList());
      todoGroups.innerHTML = roots
        .map((node) => renderProjectTreeNode(node, { includeHistory }))
        .join("");
      renderTodoDetail();
    }

    function groupTodosByDimension(todoList, dimension) {
      const grouped = new Map();

      for (const todo of todoList) {
        let key = "";
        if (dimension === "project") {
          key = todo.project || "未分组项目";
        } else if (dimension === "tag") {
          key = todo.tags[0] || "未标记";
        } else {
          key = getTodoTimeKey(todo);
        }

        if (!grouped.has(key)) {
          grouped.set(key, []);
        }
        grouped.get(key).push(todo);
      }

      if (dimension === "project" || dimension === "tag") {
        for (const [key, items] of grouped) {
          grouped.set(key, sortTodosByDragOrder(items, dimension));
        }
      }

      return grouped;
    }

    function getTodoGroupOrder(dimension, grouped) {
      const keys = Array.from(grouped.keys());
      if (dimension !== "time") {
        if (dimension === "tag") {
          return keys.sort((a, b) => {
            if (a === "未标记" && b !== "未标记") return -1;
            if (b === "未标记" && a !== "未标记") return 1;
            return a.localeCompare(b, "zh-CN");
          });
        }
        return keys.sort((a, b) => a.localeCompare(b, "zh-CN"));
      }

      const ordered = [];
      const dateKeys = keys
        .filter((key) => key.startsWith("date:"))
        .sort((a, b) => a.slice(5).localeCompare(b.slice(5)));
      ordered.push(...dateKeys);
      if (grouped.has("unscheduled")) ordered.push("unscheduled");
      if (grouped.has("done")) ordered.push("done");
      if (grouped.has("undated")) ordered.push("undated");
      return ordered;
    }

    function getTodoGroupLabel(key, dimension) {
      if (dimension === "project" || dimension === "tag") return key;
      if (key.startsWith("date:")) {
        const rawDate = key.slice(5);
        const weekday = getWeekdayLabelForDate(rawDate);
        return weekday ? `${formatDate(rawDate)} ${weekday}` : formatDate(rawDate);
      }

      const labels = {
        unscheduled: "未排期",
        done: "已完成",
        undated: "未标注日期",
      };
      return labels[key] || key;
    }

    function getTodoTimeKey(todo) {
      if (todo.completed && !todo.__recentlyCompleted) return "done";
      if (!todo.dueDate) return "unscheduled";
      return `date:${todo.dueDate}`;
    }

    function getTodoGroupCollapseKey(dimension, key) {
      const safeKey = encodeURIComponent(String(key || ""));
      return buildProjectPathFromSegments(["分组", dimension, safeKey]);
    }

    function renderTodos() {
      if (!todoGroups) return;

      const effectiveDimension = getCurrentTodoDimension();
      const visibleTodos = getVisibleTodos();
      const searchTerm = getGlobalSearchTerm();
      const historyRecords = getShowTodoHistoryInMainList()
        ? getTodoHistoryRecords().filter((item) => {
          if (!searchTerm) return true;
          const haystack = `${item.title} ${item.project} ${item.note}`.toLowerCase();
          return haystack.includes(searchTerm);
        })
        : [];
      if (effectiveDimension === "project") {
        renderProjectTreeView(visibleTodos, historyRecords);
        return;
      }
      const grouped = groupTodosByDimension(visibleTodos, effectiveDimension);
      const historyGrouped = getShowTodoHistoryInMainList()
        ? groupHistoryByDimension(historyRecords, effectiveDimension)
        : new Map();
      const mergedGrouped = getShowTodoHistoryInMainList()
        ? new Map([...grouped, ...Array.from(historyGrouped.keys()).map((key) => [key, []])])
        : grouped;
      const today = getTodayDateInputValue();
      const todayKey = `date:${today}`;
      const shouldAlwaysShowTodayGroup = effectiveDimension === "time";
      if (shouldAlwaysShowTodayGroup && !mergedGrouped.has(todayKey)) {
        mergedGrouped.set(todayKey, []);
      }
      const groupKeys = getTodoGroupOrder(effectiveDimension, mergedGrouped);

      if (!groupKeys.length) {
        todoGroups.innerHTML = getShowTodoHistoryInMainList()
          ? '<p class="todo-empty">当前排序下没有待办或历史事件。</p>'
          : '<p class="todo-empty">当前筛选下没有待办。</p>';
        renderTodoDetail();
        return;
      }

      const parts = [];
      for (const key of groupKeys) {
        const todoList = grouped.get(key) || [];
        const historyList = (historyGrouped.get(key) || []).sort((a, b) => b.timestamp - a.timestamp);
        const isTodayGroup = shouldAlwaysShowTodayGroup && key === todayKey;
        if (!todoList.length && !historyList.length && !isTodayGroup) continue;
        const allowTimeOrder = effectiveDimension === "time" && key.startsWith("date:");
        const isDateGroup = effectiveDimension === "time" && key.startsWith("date:");
        const groupTitleClass = isDateGroup ? "todo-group-title-date" : "";
        const groupHeadClass = "todo-group-head is-compact-group";
        const todayBadgeHtml = isTodayGroup ? '<span class="todo-group-today-chip">今天</span>' : "";
        const groupTitle = getTodoGroupLabel(key, effectiveDimension);
        const timeReorderIndexMap = new Map();
        if (allowTimeOrder) {
          let reorderIndex = 0;
          for (const todo of todoList) {
            if (todo.completed) continue;
            timeReorderIndexMap.set(String(todo.id), reorderIndex);
            reorderIndex += 1;
          }
        }

        const todoRows = todoList
          .map((todo, index) => {
            const groupDragMode = allowTimeOrder ? "time" : effectiveDimension === "tag" ? "tag" : "";
            const groupDragKey = allowTimeOrder ? key.slice(5) : effectiveDimension === "tag" ? key : "";
            return renderTodoRowHtml(todo, {
              allowTimeOrder,
              timeReorderIndexMap,
              dragMode: groupDragMode,
              dragGroupKey: groupDragKey,
              groupOrderIndex: index,
            });
          })
          .join("");
        const historyRows = historyList
          .map((item) => renderTodoHistoryRowHtml(item))
          .join("");
        const itemRows = `${todoRows}${historyRows}`;
        const totalCount = todoList.length + historyList.length;
        const dateGroupValue = isDateGroup ? key.slice(5) : "";
        const dateGroupAttr =
          isValidDateInput(dateGroupValue) ? ` data-todo-date=\"${escapeHtml(dateGroupValue)}\"` : "";
        const dragGroupKey = isDateGroup ? dateGroupValue : effectiveDimension === "tag" ? key : "";
        const dragGroupAttr = dragGroupKey
          ? ` data-group-dimension=\"${escapeHtml(isDateGroup ? "time" : effectiveDimension)}\" data-drag-group-key=\"${escapeHtml(dragGroupKey)}\"`
          : "";
        const collapseKey = getTodoGroupCollapseKey(effectiveDimension, key);
        const canToggle = Boolean(itemRows && collapseKey);
        const isCollapsed = canToggle && getTodoProjectTreeCollapsedPaths().has(collapseKey);
        const toggleHtml = canToggle
          ? `<button
              class=\"todo-group-toggle${isCollapsed ? " is-collapsed" : ""}\"
              type=\"button\"
              data-group-collapse-key=\"${escapeHtml(collapseKey)}\"
              aria-label=\"${isCollapsed ? "展开分组" : "收起分组"}\"
              title=\"${isCollapsed ? "展开分组" : "收起分组"}\"
            ></button>`
          : '<span class=\"todo-group-toggle-placeholder\" aria-hidden=\"true\"></span>';
        const rowsHtml = !isCollapsed && itemRows ? `<ul class=\"todo-list\">${itemRows}</ul>` : "";

        parts.push(`
      <section class=\"todo-group\" data-group-key=\"${escapeHtml(key)}\"${dateGroupAttr}${dragGroupAttr}>
        <header class=\"${groupHeadClass}\">
          <div class=\"todo-group-title-wrap\">
            ${toggleHtml}
            <h3 class=\"${groupTitleClass}\">${escapeHtml(groupTitle)}${todayBadgeHtml}</h3>
          </div>
          <span class=\"todo-group-count\">${totalCount} 项</span>
        </header>
        ${rowsHtml}
      </section>
    `);
      }

      todoGroups.innerHTML = parts.join("");
      maybeScrollToTodayGroup();
      renderTodoDetail();
    }

    function groupHistoryByDimension(records, dimension) {
      const grouped = new Map();
      for (const item of records) {
        let key = "";
        if (dimension === "project") {
          key = item.project || "未分组项目";
        } else if (dimension === "tag") {
          key = item.tags?.[0] || "未标记";
        } else {
          key = isValidDateInput(item.date) ? `date:${item.date}` : "undated";
        }
        if (!grouped.has(key)) {
          grouped.set(key, []);
        }
        grouped.get(key).push(item);
      }
      return grouped;
    }

    function getHistoryGroupOrder(grouped, dimension) {
      const keys = Array.from(grouped.keys());
      if (dimension !== "time") {
        if (dimension === "tag") {
          return keys.sort((a, b) => {
            if (a === "未标记" && b !== "未标记") return -1;
            if (b === "未标记" && a !== "未标记") return 1;
            return a.localeCompare(b, "zh-CN");
          });
        }
        return keys.sort((a, b) => a.localeCompare(b, "zh-CN"));
      }
      const dated = keys.filter((key) => key.startsWith("date:")).sort((a, b) => b.localeCompare(a));
      if (keys.includes("undated")) {
        dated.push("undated");
      }
      return dated;
    }

    function getHistoryGroupLabel(key, dimension) {
      if (dimension === "project" || dimension === "tag") return key;
      if (key === "undated") return "未标注日期";
      if (key.startsWith("date:")) {
        const date = key.slice(5);
        const weekday = getWeekdayLabelForDate(date);
        return weekday ? `${formatDate(date)} ${weekday}` : formatDate(date);
      }
      return key;
    }

    function renderHistory() {
      if (!todoHistoryGroups) return;
      const searchTerm = getGlobalSearchTerm();
      const records = getTodoHistoryRecords().filter((item) => {
        if (!searchTerm) return true;
        const haystack = `${item.title} ${item.project} ${item.note}`.toLowerCase();
        return haystack.includes(searchTerm);
      });

      if (!records.length) {
        todoHistoryGroups.innerHTML = '<p class="todo-empty">暂无历史事件。</p>';
        return;
      }

      const dimension = getCurrentTodoDimension();
      const grouped = groupHistoryByDimension(records, dimension);
      const orderedKeys = getHistoryGroupOrder(grouped, dimension);
      const sections = [];

      for (const key of orderedKeys) {
        const list = (grouped.get(key) || []).sort((a, b) => b.timestamp - a.timestamp);
        if (!list.length) continue;
        const rows = list.map((item) => renderTodoHistoryRowHtml(item)).join("");

        sections.push(`
      <section class=\"todo-group todo-history-group\">
        <header class=\"todo-group-head\">
          <div class=\"todo-group-title-wrap\">
            <span class=\"todo-group-toggle-placeholder\" aria-hidden=\"true\"></span>
            <h3>${escapeHtml(getHistoryGroupLabel(key, dimension))}</h3>
            <p class=\"todo-group-summary\">历史 ${list.length} 条</p>
          </div>
          <span class=\"todo-group-count\">${list.length} 条</span>
        </header>
        <ul class=\"todo-list todo-history-list\">${rows}</ul>
      </section>
    `);
      }

      todoHistoryGroups.innerHTML = sections.join("");
    }

    function handleHistoryClick(event) {
      const item = event.target.closest(".todo-item-history[data-source][data-id], .todo-history-item[data-source][data-id]");
      if (!item) return;
      const source = String(item.dataset.source || "");
      const id = String(item.dataset.id || item.dataset.historyId || "");
      if (!source || !id) return;
      openTodoHistoryRecord(source, id);
    }

    function hasSelectedListItem() {
      if (!todoGroups) return false;
      return Boolean(todoGroups.querySelector(".todo-item.is-selected[data-id]"));
    }

    return {
      bindEvents,
      syncFilterBarButtons,
      syncHistoryToggleButton,
      requestScrollToTodayGroup,
      getNearestTimeGroupToToday,
      maybeScrollToTodayGroup,
      handleHistoryToggleClick,
      handleRecurringToggleClick,
      handleFilterClick,
      clearDragVisualState,
      getDragTargetMeta,
      getDragGroupDate,
      normalizeDragDropOrder,
      getDragDropOrder,
      getDragDropPayload,
      handleGroupDragStart,
      handleGroupDragOver,
      handleGroupDrop,
      handleGroupDragEnd,
      handleGroupDragLeave,
      handleGroupClick,
      renderTodoRowHtml,
      renderTodoHistoryRowHtml,
      buildProjectTree,
      renderProjectTreeNode,
      renderProjectTreeView,
      renderTodos,
      groupTodosByDimension,
      getTodoGroupOrder,
      getTodoGroupLabel,
      groupHistoryByDimension,
      getHistoryGroupOrder,
      getHistoryGroupLabel,
      renderHistory,
      handleHistoryClick,
      buildDueBadge,
      buildSyncBadge,
      hasSelectedListItem,
    };
  }

  globalScope.TimeQualityTodoListModule = {
    createTodoListModule,
  };
})(typeof window !== "undefined" ? window : globalThis);
