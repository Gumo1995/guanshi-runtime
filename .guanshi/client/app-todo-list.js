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

    const todoFilterBar = deps.todoFilterBar || null;
    const todoGroups = deps.todoGroups || null;
    const todoHistoryGroups = deps.todoHistoryGroups || null;
    const todoHistoryToggleBtn = deps.todoHistoryToggleBtn || null;
    const todoRecurringToggleBtn = deps.todoRecurringToggleBtn || null;

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
    const compactTodoNotePreview = requireFunction(deps, "compactTodoNotePreview");
    const getIncompleteTodosByDate = requireFunction(deps, "getIncompleteTodosByDate");
    const getVisibleTodos = requireFunction(deps, "getVisibleTodos");
    const getTodoHistoryRecords = requireFunction(deps, "getTodoHistoryRecords");
    const getGlobalSearchTerm = requireFunction(deps, "getGlobalSearchTerm");
    const renderTodoDetail = requireFunction(deps, "renderTodoDetail");
    const getSelectedTodoId = requireFunction(deps, "getSelectedTodoId");
    const setSelectedTodoId = requireFunction(deps, "setSelectedTodoId");
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

    let eventsBound = false;
    let todoPendingScrollToTodayGroup = false;
    let todoListDragState = null;

    function bindEvents() {
      if (eventsBound) return;
      eventsBound = true;

      if (todoFilterBar) {
        todoFilterBar.addEventListener("click", handleFilterClick);
      }
      if (todoHistoryToggleBtn) {
        todoHistoryToggleBtn.addEventListener("click", handleHistoryToggleClick);
      }
      if (todoRecurringToggleBtn) {
        todoRecurringToggleBtn.addEventListener("click", handleRecurringToggleClick);
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

    function syncFilterBarButtons() {
      if (todoFilterBar) {
        const buttons = Array.from(todoFilterBar.querySelectorAll("button[data-dimension]"));
        for (const node of buttons) {
          const dimension = String(node.dataset.dimension || "");
          const isActive = dimension === getCurrentTodoDimension();
          node.classList.toggle("is-active", isActive);
          node.disabled = false;
          node.removeAttribute("aria-disabled");
        }
      }

      if (todoRecurringToggleBtn) {
        const recurringOnly = getShowRecurringReminderOnlyInMainList();
        todoRecurringToggleBtn.classList.toggle("is-active", recurringOnly);
        todoRecurringToggleBtn.setAttribute("aria-pressed", recurringOnly ? "true" : "false");
      }
    }

    function syncHistoryToggleButton() {
      if (!todoHistoryToggleBtn) return;
      const showHistory = getShowTodoHistoryInMainList();
      todoHistoryToggleBtn.classList.toggle("is-active", showHistory);
      todoHistoryToggleBtn.setAttribute("aria-pressed", showHistory ? "true" : "false");
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

    function handleHistoryToggleClick() {
      const nextShowHistory = !getShowTodoHistoryInMainList();
      setShowTodoHistoryInMainList(nextShowHistory);
      if (nextShowHistory) {
        if (getShowRecurringReminderOnlyInMainList()) {
          setShowRecurringReminderOnlyInMainList(false);
        }
        if (getCurrentTodoDimension() === "time") {
          requestScrollToTodayGroup();
        }
        clearAllRecentlyCompletedForDisplay();
      }
      syncHistoryToggleButton();
      syncFilterBarButtons();
      renderTodos();
    }

    function handleRecurringToggleClick() {
      const nextRecurringOnly = !getShowRecurringReminderOnlyInMainList();
      setShowRecurringReminderOnlyInMainList(nextRecurringOnly);
      if (nextRecurringOnly && getShowTodoHistoryInMainList()) {
        setShowTodoHistoryInMainList(false);
      }
      syncHistoryToggleButton();
      syncFilterBarButtons();
      renderTodos();
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
      renderTodos();
    }

    function clearDragVisualState({ keepDragging = true } = {}) {
      if (!todoGroups) return;
      const dropTargets = todoGroups.querySelectorAll(".todo-item.is-drop-before, .todo-item.is-drop-after");
      for (const node of dropTargets) {
        node.classList.remove("is-drop-before", "is-drop-after");
      }
      if (!keepDragging) {
        const draggingNodes = todoGroups.querySelectorAll(".todo-item.is-dragging");
        for (const node of draggingNodes) {
          node.classList.remove("is-dragging");
        }
      }
    }

    function getDragTargetMeta(event) {
      if (!(event.target instanceof Element)) return null;
      const rowNode = event.target.closest(".todo-item[data-id][data-date][data-order-index]");
      if (!(rowNode instanceof HTMLElement)) return null;
      const dueDate = String(rowNode.dataset.date || "");
      const orderIndex = Number.parseInt(String(rowNode.dataset.orderIndex || "-1"), 10);
      if (!isValidDateInput(dueDate) || !Number.isInteger(orderIndex) || orderIndex < 0) return null;
      const rect = rowNode.getBoundingClientRect();
      const insertBefore = event.clientY < rect.top + rect.height / 2;
      return {
        rowNode,
        dueDate,
        orderIndex,
        insertBefore,
      };
    }

    function getDragGroupDate(event) {
      if (!(event.target instanceof Element)) return "";
      const groupNode = event.target.closest(".todo-group[data-todo-date]");
      if (!(groupNode instanceof HTMLElement)) return "";
      const dueDate = String(groupNode.dataset.todoDate || "").trim();
      return isValidDateInput(dueDate) ? dueDate : "";
    }

    function normalizeDragDropOrder(fromOrder, slotIndex, isSameDate) {
      if (!Number.isInteger(fromOrder) || !Number.isInteger(slotIndex) || slotIndex < 0) return null;
      const nextOrder = isSameDate && slotIndex > fromOrder ? slotIndex - 1 : slotIndex;
      return nextOrder >= 0 ? nextOrder : null;
    }

    function getDragDropOrder(fromOrder, targetMeta, isSameDate) {
      if (!targetMeta) return null;
      const slotIndex = targetMeta.insertBefore ? targetMeta.orderIndex : targetMeta.orderIndex + 1;
      return normalizeDragDropOrder(fromOrder, slotIndex, isSameDate);
    }

    function getDragDropPayload(event, state) {
      if (!state) return null;
      const rowTarget = getDragTargetMeta(event);
      if (rowTarget) {
        const dueDate = rowTarget.dueDate;
        const nextOrder = getDragDropOrder(state.fromOrder, rowTarget, dueDate === state.dueDate);
        if (Number.isInteger(nextOrder)) {
          return {
            dueDate,
            nextOrder,
            rowTarget,
          };
        }
      }

      const groupDate = getDragGroupDate(event);
      if (!groupDate) return null;
      const dayTodoCount = getIncompleteTodosByDate(groupDate).length;
      const nextOrder = normalizeDragDropOrder(
        state.fromOrder,
        dayTodoCount,
        groupDate === state.dueDate,
      );
      if (!Number.isInteger(nextOrder)) return null;
      return {
        dueDate: groupDate,
        nextOrder,
        rowTarget: null,
      };
    }

    function handleGroupDragStart(event) {
      if (!(event.target instanceof Element)) return;
      const rowNode = event.target.closest(".todo-item[draggable=\"true\"][data-id][data-date][data-order-index]");
      if (!(rowNode instanceof HTMLElement)) return;
      const todoId = String(rowNode.dataset.id || "");
      const dueDate = String(rowNode.dataset.date || "");
      const fromOrder = Number.parseInt(String(rowNode.dataset.orderIndex || "-1"), 10);
      if (!todoId || !isValidDateInput(dueDate) || !Number.isInteger(fromOrder) || fromOrder < 0) return;

      todoListDragState = {
        todoId,
        dueDate,
        fromOrder,
        targetDueDate: dueDate,
        targetOrder: fromOrder,
      };
      clearDragVisualState({ keepDragging: false });
      rowNode.classList.add("is-dragging");

      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", todoId);
      }
    }

    function handleGroupDragOver(event) {
      if (!todoListDragState) return;
      const dropPayload = getDragDropPayload(event, todoListDragState);
      if (!dropPayload) return;

      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "move";
      }

      clearDragVisualState({ keepDragging: true });
      const isOriginalSlot =
        dropPayload.dueDate === todoListDragState.dueDate &&
        dropPayload.nextOrder === todoListDragState.fromOrder;
      if (dropPayload.rowTarget && !isOriginalSlot) {
        dropPayload.rowTarget.rowNode.classList.add(dropPayload.rowTarget.insertBefore ? "is-drop-before" : "is-drop-after");
      }
      todoListDragState.targetDueDate = dropPayload.dueDate;
      todoListDragState.targetOrder = dropPayload.nextOrder;
    }

    function handleGroupDrop(event) {
      if (!todoListDragState) return;
      event.preventDefault();

      const dropPayload = getDragDropPayload(event, todoListDragState);
      if (dropPayload) {
        todoListDragState.targetDueDate = dropPayload.dueDate;
        todoListDragState.targetOrder = dropPayload.nextOrder;
      }

      const { todoId, dueDate, fromOrder, targetDueDate, targetOrder } = todoListDragState;
      clearDragVisualState({ keepDragging: false });
      todoListDragState = null;

      if (!isValidDateInput(targetDueDate) || !Number.isInteger(targetOrder)) return;
      if (targetDueDate === dueDate && targetOrder === fromOrder) return;

      if (targetDueDate === dueDate) {
        moveTodoToOrder(todoId, targetOrder);
        return;
      }
      moveTodoToDateOrder(todoId, targetDueDate, targetOrder);
    }

    function handleGroupDragEnd() {
      clearDragVisualState({ keepDragging: false });
      todoListDragState = null;
    }

    function handleGroupDragLeave(event) {
      if (!todoListDragState || !todoGroups) return;
      const nextTarget = event.relatedTarget;
      if (nextTarget instanceof Node && todoGroups.contains(nextTarget)) return;
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
      if (todo.calendarSynced || todo.syncState === "synced") {
        return `
      <span class="todo-badge synced todo-sync-icon-badge" aria-label="已同步" title="已同步">
        <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path d="M6 10.4 8.4 12.8 14.2 7" />
        </svg>
      </span>
    `;
      }
      return "";
    }

    function renderTodoRowHtml(todo, { allowTimeOrder = false, timeReorderIndexMap = null } = {}) {
      const selectedClass = String(todo.id) === String(getSelectedTodoId()) ? " is-selected" : "";
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
      const projectText = normalizeProjectName(todo.project || "") || "未设置项目";
      const reminderText = formatTodoReminderLabel(todo.reminder, todo.repeat, {
        startTime: todo.startTime,
      });
      const durationMinutes = getTodoDurationMinutes(todo, TODO_PLAN_NEW_TODO_DURATION_MINUTES);
      const hasNote = Boolean(String(todo.note || "").trim());
      const notePart = hasNote
        ? '<span class="todo-subline-sep" aria-hidden="true">·</span><span class="todo-subline-text">有备注</span>'
        : "";
      const detailTextHtml = `<span class="todo-subline-text">${escapeHtml(categoryText)}</span><span class="todo-subline-sep" aria-hidden="true">·</span><span class="todo-subline-text">持续${escapeHtml(formatTodoDurationMinutesLabel(durationMinutes))}</span>${notePart}`;
      const reorderIndex = allowTimeOrder && timeReorderIndexMap instanceof Map
        ? timeReorderIndexMap.get(String(todo.id))
        : null;
      const canDragReorder = allowTimeOrder && !todo.completed && !todo.planLocked;
      const rowDragClass = canDragReorder ? " is-draggable" : "";
      const rowOrderAttrs = allowTimeOrder && Number.isInteger(reorderIndex)
        ? ` data-date=\"${escapeHtml(String(todo.dueDate || ""))}\" data-order-index=\"${reorderIndex}\"`
        : "";
      const rowDragAttrs = canDragReorder ? ' draggable="true"' : "";

      return `
    <li class=\"todo-item${selectedClass}${completedClass}${rowDragClass}\" data-id=\"${escapeHtml(String(todo.id))}\"${rowOrderAttrs}${rowDragAttrs}>
      <button class=\"todo-check${checkClass}\" data-id=\"${escapeHtml(String(todo.id))}\" type=\"button\">${todo.completed ? "✓" : ""}</button>
      <div class=\"todo-item-main\">
        <p class=\"todo-item-title\">${escapeHtml(todo.title)}</p>
        <p class=\"todo-item-subline\">${detailTextHtml}</p>
      </div>
      <div class=\"todo-item-context\">
        <p class=\"todo-item-context-project\">${escapeHtml(projectText)}</p>
        <p class=\"todo-item-context-score\">${escapeHtml(reminderText)}</p>
      </div>
      <div class=\"todo-badges\">${timeBadge}${dateBadge}${tagBadges}${lockBadge}${syncedBadge}</div>
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
      const notePreview = compactTodoNotePreview(item.note, 34);
      const tagBadges = (item.tags || [])
        .slice(0, 2)
        .map((tag) => `<span class=\"todo-badge tag\">#${escapeHtml(tag)}</span>`)
        .join("");
      return `
    <li class=\"todo-item todo-item-history\" data-source=\"${escapeHtml(item.source)}\" data-history-id=\"${escapeHtml(recordId)}\">
      <button
        class=\"todo-check is-completed todo-history-restore-btn\"
        type=\"button\"
        data-history-source=\"${escapeHtml(historySource)}\"
        data-history-id=\"${escapeHtml(recordId)}\"
        aria-label=\"恢复为未完成待办\"
        title=\"恢复为未完成待办\"${restoreDisabledAttr}
      ></button>
      <div class=\"todo-item-main\">
        <p class=\"todo-item-title\">${escapeHtml(item.title)}</p>
        <p class=\"todo-item-subline\">${escapeHtml(notePreview || "历史记录")}</p>
      </div>
      <div class=\"todo-item-context\">
        <p class=\"todo-item-context-project\">${escapeHtml(item.project || "记录")}</p>
        <p class=\"todo-item-context-score\">${escapeHtml(reminderText)}</p>
      </div>
      <div class=\"todo-badges\">
        <span class=\"todo-badge due-future\">${escapeHtml(timeText)}</span>
        <span class=\"todo-badge due-future\">${escapeHtml(dateText)}</span>
        ${tagBadges}
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
      sortChildren(roots);
      return roots;
    }

    function renderProjectTreeNode(node, { includeHistory = false } = {}) {
      const level = Math.max(1, Math.min(3, Number(node.level) || 1));
      const hasChildren = Array.isArray(node.children) && node.children.length > 0;
      const totalCount = node.totalTodoCount + (includeHistory ? node.totalHistoryCount : 0);
      const summaryParts = [];
      if (level === 1) {
        summaryParts.push(`剩余 ${node.pendingTodoCount} 项`);
        if (includeHistory && node.totalHistoryCount > 0) {
          summaryParts.push(`历史 ${node.totalHistoryCount} 条`);
        }
      }
      const todoRows = node.todos.map((todo) => renderTodoRowHtml(todo)).join("");
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

      const summaryHtml = summaryParts.length
        ? `<p class="todo-project-tree-summary">${escapeHtml(summaryParts.join(" · "))}</p>`
        : "";

      return `
    <section class="todo-project-tree-node todo-project-tree-level-${level}" data-project-path="${escapeHtml(node.path)}">
      <header class="todo-project-tree-head">
        <div class="todo-project-tree-title-wrap">
          ${toggleHtml}
          <h3>${escapeHtml(node.name)}</h3>
          ${summaryHtml}
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
        const pendingCount = todoList.filter((todo) => !todo.completed).length;
        const overdueCount = todoList.filter(
          (todo) => !todo.completed && isValidDateInput(todo.dueDate) && String(todo.dueDate) < today,
        ).length;
        const summaryText = pendingCount
          ? `剩余 ${pendingCount} 项`
          : (todoList.length ? "已全部完成" : (isTodayGroup ? "今天暂无待办" : "无待办"));
        const summaryHint = overdueCount ? ` · ${overdueCount} 逾期` : "";
        const historySummary = getShowTodoHistoryInMainList() && historyList.length ? ` · 历史 ${historyList.length} 条` : "";
        const groupTitleClass = isDateGroup ? "todo-group-title-date" : "";
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
          .map((todo) => renderTodoRowHtml(todo, { allowTimeOrder, timeReorderIndexMap }))
          .join("");
        const historyRows = historyList
          .map((item) => renderTodoHistoryRowHtml(item))
          .join("");
        const itemRows = `${todoRows}${historyRows}`;
        const totalCount = todoList.length + historyList.length;
        const dateGroupValue = isDateGroup ? key.slice(5) : "";
        const dateGroupAttr =
          isValidDateInput(dateGroupValue) ? ` data-todo-date=\"${escapeHtml(dateGroupValue)}\"` : "";

        parts.push(`
      <section class=\"todo-group\" data-group-key=\"${escapeHtml(key)}\"${dateGroupAttr}>
        <header class=\"todo-group-head\">
          <div class=\"todo-group-title-wrap\">
            <h3 class=\"${groupTitleClass}\">${escapeHtml(groupTitle)}${todayBadgeHtml}</h3>
            <p class=\"todo-group-summary\">${escapeHtml(summaryText + summaryHint + historySummary)}</p>
          </div>
          <span class=\"todo-group-count\">${totalCount} 项</span>
        </header>
        <ul class=\"todo-list\">${itemRows}</ul>
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
        const rows = list
          .map((item) => {
            const sourceText = item.source === "todo" ? "待办完成" : "日历记录";
            const timeText = item.start && item.end ? `${item.start}-${item.end}` : "时间未知";
            const recordId = item.entryId || item.todoId || "";
            const dateText = item.date ? formatDate(item.date) : "--";
            const reminderText = formatTodoReminderLabel(item.reminder, item.repeat, {
              startTime: item.startTime || item.start,
            });
            const notePreviewRaw = String(item.note || "").trim();
            const notePreview = notePreviewRaw.length > 34 ? `${notePreviewRaw.slice(0, 34)}…` : notePreviewRaw;
            const tagBadge = item.tags?.[0] ? `<span class=\"todo-badge tag\">#${escapeHtml(item.tags[0])}</span>` : "";
            return `
          <li class=\"todo-history-item\" data-source=\"${escapeHtml(item.source)}\" data-id=\"${escapeHtml(recordId)}\">
            <div class=\"todo-history-item-main\">
              <p class=\"todo-history-item-title\">${escapeHtml(item.title)}</p>
              <p class=\"todo-history-item-note\">${escapeHtml(notePreview || "无备注")}</p>
            </div>
            <p class=\"todo-history-item-project\">${escapeHtml(item.project || "记录")}</p>
            <div class=\"todo-history-item-right\">
              <span class=\"todo-badge due-future\">${escapeHtml(timeText)}</span>
              <span class=\"todo-badge due-future\">${escapeHtml(dateText)}</span>
              ${tagBadge}
              <span class=\"todo-badge synced\">${escapeHtml(sourceText)}</span>
              <span class=\"todo-history-item-score\">${escapeHtml(reminderText)}</span>
            </div>
          </li>
        `;
          })
          .join("");

        sections.push(`
      <section class=\"todo-group todo-history-group\">
        <header class=\"todo-group-head\">
          <div class=\"todo-group-title-wrap\">
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
      const item = event.target.closest(".todo-history-item[data-source][data-id]");
      if (!item) return;
      const source = String(item.dataset.source || "");
      const id = String(item.dataset.id || "");
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
