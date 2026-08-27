/* global window */

(function attachTodoActionsModule(globalScope) {
  "use strict";

  function assertFunction(name, value) {
    if (typeof value !== "function") {
      throw new Error(`TimeQualityTodoActionsModule requires dependency: ${name}`);
    }
  }

  function createTodoActionsModule(deps = {}) {
    const {
      TODO_PLAN_NEW_TODO_DURATION_MINUTES = 30,
      TODO_PLAN_DAY_FIRST_START_MINUTES = 9 * 60,
      TODO_PLAN_DAY_GAP_MINUTES = 10,
      DEFAULT_POMODORO_MINUTES = 25,
      todoTitleInput = null,
      pomodoroModule = {},
      todoDetailModule = {},
      getTodos,
      getEntries,
      getCategories,
      getSelectedTodoId,
      getSelectedTodoIds,
      setSelectedTodoId,
      getShowTodoHistoryInMainList,
      createTodoDraft,
      assignScheduleForNewTodo,
      saveTodos,
      saveEntries,
      setActiveView,
      render,
      renderTodos,
      getSelectedTodo,
      collectTodoFormInput,
      commitTodoDetailIfDirty,
      normalizeTodo,
      normalizeProjectName,
      normalizeTodoCategoryValue,
      normalizeTodoTags,
      parseOptionalScore,
      normalizeEntryTitle,
      getEntryDisplayTitle,
      getTodoCategory,
      normalizeTodoReminderRepeatValue,
      isRecurringTodoRepeatMode,
      resolveNextRecurringDueDate,
      parseTodoReminderDateTime,
      isTodoEligibleForReminderSync,
      buildEntryDateRange,
      calcDurationHours,
      formatDateForInput,
      formatTimeForInput,
      getTodayDateInputValue,
      isValidDateInput,
      isValidClockInput,
      parseClockToMinutes,
      formatMinutesForInput,
      getTodoDurationMinutes,
      getTodoClockRange,
      setTodoRangeByStartAndDuration,
      getIncompleteTodosByDate,
      normalizeTodoOrderForDate,
      getNextTodoOrderForDate,
      moveTodoToOrder,
      markTodoPlanningDirty,
      reflowTodoDayFromIndex,
      reflowTodoDayAfterAnchor,
      reflowTodoDayFromStart,
      enqueueTodoCalendarDelete,
      enqueueTodoReminderDisable,
      addEntry,
      createUniqueEntryId,
      clearTodoRecentlyCompletedForDisplay,
      markTodoRecentlyCompletedForDisplay,
      buildTodoReminderCompleteRequest,
      completeTodoTasksInMacReminders,
      applyTodoReminderCompleteItems,
      scheduleAutoBidirectionalSync,
      setCalendarSyncStatus,
    } = deps;

    [
      ["getTodos", getTodos],
      ["getEntries", getEntries],
      ["getCategories", getCategories],
      ["getSelectedTodoId", getSelectedTodoId],
      ["getSelectedTodoIds", getSelectedTodoIds],
      ["setSelectedTodoId", setSelectedTodoId],
      ["getShowTodoHistoryInMainList", getShowTodoHistoryInMainList],
      ["createTodoDraft", createTodoDraft],
      ["assignScheduleForNewTodo", assignScheduleForNewTodo],
      ["saveTodos", saveTodos],
      ["saveEntries", saveEntries],
      ["setActiveView", setActiveView],
      ["render", render],
      ["renderTodos", renderTodos],
      ["getSelectedTodo", getSelectedTodo],
      ["collectTodoFormInput", collectTodoFormInput],
      ["commitTodoDetailIfDirty", commitTodoDetailIfDirty],
      ["normalizeTodo", normalizeTodo],
      ["normalizeProjectName", normalizeProjectName],
      ["normalizeTodoCategoryValue", normalizeTodoCategoryValue],
      ["normalizeTodoTags", normalizeTodoTags],
      ["parseOptionalScore", parseOptionalScore],
      ["normalizeEntryTitle", normalizeEntryTitle],
      ["getEntryDisplayTitle", getEntryDisplayTitle],
      ["getTodoCategory", getTodoCategory],
      ["normalizeTodoReminderRepeatValue", normalizeTodoReminderRepeatValue],
      ["isRecurringTodoRepeatMode", isRecurringTodoRepeatMode],
      ["resolveNextRecurringDueDate", resolveNextRecurringDueDate],
      ["parseTodoReminderDateTime", parseTodoReminderDateTime],
      ["isTodoEligibleForReminderSync", isTodoEligibleForReminderSync],
      ["buildEntryDateRange", buildEntryDateRange],
      ["calcDurationHours", calcDurationHours],
      ["formatDateForInput", formatDateForInput],
      ["formatTimeForInput", formatTimeForInput],
      ["getTodayDateInputValue", getTodayDateInputValue],
      ["isValidDateInput", isValidDateInput],
      ["isValidClockInput", isValidClockInput],
      ["parseClockToMinutes", parseClockToMinutes],
      ["formatMinutesForInput", formatMinutesForInput],
      ["getTodoDurationMinutes", getTodoDurationMinutes],
      ["getTodoClockRange", getTodoClockRange],
      ["setTodoRangeByStartAndDuration", setTodoRangeByStartAndDuration],
      ["getIncompleteTodosByDate", getIncompleteTodosByDate],
      ["normalizeTodoOrderForDate", normalizeTodoOrderForDate],
      ["getNextTodoOrderForDate", getNextTodoOrderForDate],
      ["moveTodoToOrder", moveTodoToOrder],
      ["markTodoPlanningDirty", markTodoPlanningDirty],
      ["reflowTodoDayFromIndex", reflowTodoDayFromIndex],
      ["reflowTodoDayAfterAnchor", reflowTodoDayAfterAnchor],
      ["reflowTodoDayFromStart", reflowTodoDayFromStart],
      ["enqueueTodoCalendarDelete", enqueueTodoCalendarDelete],
      ["enqueueTodoReminderDisable", enqueueTodoReminderDisable],
      ["addEntry", addEntry],
      ["createUniqueEntryId", createUniqueEntryId],
      ["clearTodoRecentlyCompletedForDisplay", clearTodoRecentlyCompletedForDisplay],
      ["markTodoRecentlyCompletedForDisplay", markTodoRecentlyCompletedForDisplay],
      ["buildTodoReminderCompleteRequest", buildTodoReminderCompleteRequest],
      ["completeTodoTasksInMacReminders", completeTodoTasksInMacReminders],
      ["applyTodoReminderCompleteItems", applyTodoReminderCompleteItems],
      ["scheduleAutoBidirectionalSync", scheduleAutoBidirectionalSync],
      ["setCalendarSyncStatus", setCalendarSyncStatus],
    ].forEach(([name, value]) => assertFunction(name, value));

    let todos = [];
    let entries = [];
    let categories = [];
    let showTodoHistoryInMainList = false;

    function refreshDataRefs() {
      const nextTodos = getTodos();
      const nextEntries = getEntries();
      const nextCategories = getCategories();
      todos = Array.isArray(nextTodos) ? nextTodos : [];
      entries = Array.isArray(nextEntries) ? nextEntries : [];
      categories = Array.isArray(nextCategories) ? nextCategories : [];
      showTodoHistoryInMainList = Boolean(getShowTodoHistoryInMainList());
    }

    function handleTodoCreate() {
      refreshDataRefs();
      const todo = createTodoDraft();
      assignScheduleForNewTodo(todo);
      todos.unshift(todo);
      setSelectedTodoId(todo.id);
      saveTodos(todos);
      setActiveView("todo");
      renderTodos();
      requestAnimationFrame(() => {
        if (todoTitleInput) {
          todoTitleInput.focus();
          todoTitleInput.select();
        }
      });
    }

    function handleTodoCreateAfterSelected() {
      refreshDataRefs();
      const anchor = getSelectedTodo();
      if (!anchor || anchor.completed || !isValidDateInput(anchor.dueDate)) {
        handleTodoCreate();
        return;
      }

      const anchorDueDate = String(anchor.dueDate || "").trim();
      normalizeTodoOrderForDate(anchorDueDate);
      const dayTodos = getIncompleteTodosByDate(anchorDueDate);
      const anchorIndex = dayTodos.findIndex((item) => String(item.id) === String(anchor.id));
      if (anchorIndex < 0) {
        handleTodoCreate();
        return;
      }

      const todo = createTodoDraft();
      todo.dueDate = anchorDueDate;
      assignScheduleForNewTodo(todo);
      todos.push(todo);
      setSelectedTodoId(todo.id);

      const inserted = moveTodoToOrder(todo.id, anchorIndex + 1);
      if (!inserted) {
        saveTodos(todos);
        render();
      }

      requestAnimationFrame(() => {
        if (todoTitleInput) {
          todoTitleInput.focus();
          todoTitleInput.select();
        }
      });
    }

    function restoreHistoryItemToTodo(source, id) {
      refreshDataRefs();
      const sourceType = String(source || "").trim();
      const targetId = String(id || "").trim();
      if (!sourceType || !targetId) return;

      if (sourceType === "todo") {
        const todo = todos.find((item) => String(item.id) === targetId);
        if (!todo) {
          window.alert("对应待办不存在，无法恢复。");
          return;
        }
        setSelectedTodoId(String(todo.id));
        if (todo.completed) {
          toggleTodoCompleted(todo.id);
          return;
        }
        renderTodos();
        return;
      }

      if (sourceType !== "entry") return;

      const entry = entries.find((item) => String(item.id) === targetId);
      if (!entry) {
        window.alert("对应记录不存在，无法恢复。");
        return;
      }

      const linkedTodoId = String(entry.linkedTodoId || "").trim();
      if (linkedTodoId) {
        const linkedTodo = todos.find((item) => String(item.id) === linkedTodoId);
        if (linkedTodo) {
          setSelectedTodoId(String(linkedTodo.id));
          if (linkedTodo.completed) {
            toggleTodoCompleted(linkedTodo.id);
            return;
          }
          renderTodos();
          return;
        }
      }

      const nowIso = new Date().toISOString();
      const dueDate = isValidDateInput(entry.date) ? String(entry.date) : getTodayDateInputValue();
      const startTime = isValidClockInput(entry.start) ? String(entry.start) : "";
      const endTime = isValidClockInput(entry.end) ? String(entry.end) : "";
      const startMinutes = parseClockToMinutes(startTime);
      const endMinutes = parseClockToMinutes(endTime);
      const rawDurationHours = Number.parseFloat(String(entry.duration || ""));
      const minutesFromDuration =
        Number.isFinite(rawDurationHours) && rawDurationHours > 0 ? Math.round(rawDurationHours * 60) : null;
      const estimatedMinutes =
        Number.isInteger(startMinutes) && Number.isInteger(endMinutes) && endMinutes > startMinutes
          ? Math.max(5, endMinutes - startMinutes)
          : Math.max(5, minutesFromDuration ?? TODO_PLAN_NEW_TODO_DURATION_MINUTES);
      const project = normalizeProjectName(entry.project || entry.category || "未分组项目") || "未分组项目";
      const category = normalizeTodoCategoryValue(entry.category, project);
      const restoredTodo = normalizeTodo({
        id: `todo_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        title: getEntryDisplayTitle(entry, project),
        dueDate,
        project,
        category,
        tags: [],
        note: String(entry.note || "").trim() || "从记录恢复",
        qualityScore: null,
        happinessScore: null,
        startTime,
        endTime,
        estimatedMinutes,
        reminder: "",
        repeat: "none",
        calendarSynced: false,
        syncState: "dirty",
        completed: false,
        orderInDay: getNextTodoOrderForDate(dueDate),
        createdAt: nowIso,
        updatedAt: nowIso,
      });

      todos.unshift(restoredTodo);
      entry.linkedTodoId = String(restoredTodo.id);
      entry.updatedAt = nowIso;
      saveEntries(entries);
      saveTodos(todos);
      setSelectedTodoId(String(restoredTodo.id));
      renderTodos();
    }

    function handleTodoFocusStart() {
      refreshDataRefs();
      const selected = getSelectedTodo();
      if (!selected || selected.completed) return;
      const committed = commitTodoDetailIfDirty({
        showValidationAlert: true,
        focusInvalidField: true,
        skipRender: false,
      });
      if (!committed) return;

      const todo = getSelectedTodo();
      if (!todo || todo.completed) return;
      if (pomodoroModule.isBusy()) {
        window.alert("当前有番茄钟进行中，请先结束当前番茄后再开始新任务。");
        return;
      }

      const sessionDurationMinutes = pomodoroModule.normalizeMinutes(getTodoDurationMinutes(todo, DEFAULT_POMODORO_MINUTES));
      const resolvedCategory = getTodoCategory(todo, categories[0] || "工作");
      const now = new Date();
      setActiveView("overview");
      pomodoroModule.beginLinkedSession({
        todoId: todo.id,
        category: categories.includes(resolvedCategory) ? resolvedCategory : (categories[0] || "工作"),
        minutes: sessionDurationMinutes,
        startedAt: now,
      });
    }

    function handleTodoDelete() {
      refreshDataRefs();
      const rawSelectedIds = getSelectedTodoIds();
      const selectedIds = new Set(
        (Array.isArray(rawSelectedIds) ? rawSelectedIds : [])
          .map((id) => String(id || "").trim())
          .filter(Boolean),
      );
      const selected = getSelectedTodo();
      if (!selectedIds.size && selected?.id) {
        selectedIds.add(String(selected.id));
      }

      const targetIndices = todos
        .map((item, index) => (selectedIds.has(String(item.id)) ? index : -1))
        .filter((index) => index >= 0);
      if (!targetIndices.length) return 0;

      const firstTargetIndex = Math.min(...targetIndices);
      const nextSelectedTodo =
        todos.slice(firstTargetIndex).find((item) => !selectedIds.has(String(item.id)))
        || [...todos.slice(0, firstTargetIndex)].reverse().find((item) => !selectedIds.has(String(item.id)))
        || null;
      const timestampIso = new Date().toISOString();
      let deletedCount = 0;

      for (const index of [...targetIndices].sort((a, b) => b - a)) {
        if (deleteTodoByIndex(index, { queueRemoteDelete: true, timestampIso })) {
          deletedCount += 1;
        }
      }

      if (!deletedCount) return 0;
      setSelectedTodoId(nextSelectedTodo ? String(nextSelectedTodo.id) : null);
      saveTodos(todos);
      render();
      return deletedCount;
    }

    function deleteTodoByTaskId(todoId, { queueRemoteDelete = false, timestampIso = new Date().toISOString() } = {}) {
      refreshDataRefs();
      const id = String(todoId || "").trim();
      if (!id) return false;
      const index = todos.findIndex((item) => String(item.id) === id);
      if (index < 0) return false;
      return deleteTodoByIndex(index, { queueRemoteDelete, timestampIso });
    }

    function deleteTodoByIndex(index, { queueRemoteDelete = false, timestampIso = new Date().toISOString() } = {}) {
      refreshDataRefs();
      if (!Number.isInteger(index) || index < 0 || index >= todos.length) return false;
      const target = todos[index];
      if (!target) return false;

      const deletedDueDate = String(target.dueDate || "").trim();
      const deletedCompleted = Boolean(target.completed);
      const deletedIndex =
        !deletedCompleted && isValidDateInput(deletedDueDate)
          ? getIncompleteTodosByDate(deletedDueDate).findIndex((item) => String(item.id) === String(target.id))
          : -1;

      if (queueRemoteDelete) {
        enqueueTodoCalendarDelete(target, timestampIso);
      }
      if (!target.completed) {
        enqueueTodoReminderDisable(target, timestampIso);
      }

      removeTodoCompletionEntry(target.id);
      pomodoroModule.clearLinkedTodo(target.id);
      todos.splice(index, 1);
      if (!todos.length) {
        setSelectedTodoId(null);
      } else if (String(getSelectedTodoId()) === String(target.id)) {
        const next = todos[index] || todos[index - 1] || todos[0];
        setSelectedTodoId(next ? String(next.id) : null);
      }

      if (!deletedCompleted && isValidDateInput(deletedDueDate)) {
        reflowTodoDayFromIndex(deletedDueDate, deletedIndex, { markDirty: true, timestampIso });
      }

      return true;
    }

    function buildClockRangeFromStartAndDuration(startMinutes, durationMinutes) {
      refreshDataRefs();
      const temp = { startTime: "", endTime: "" };
      const next = setTodoRangeByStartAndDuration(temp, startMinutes, durationMinutes);
      return {
        startTime: temp.startTime,
        endTime: temp.endTime,
        durationMinutes: Math.max(5, next.durationMinutes),
        endMinutes: next.endMinutes,
      };
    }

    function getDefaultStartMinutesForTodoDate(date, excludedTodoId = null) {
      refreshDataRefs();
      const key = String(date || "").trim();
      if (!isValidDateInput(key)) {
        return TODO_PLAN_DAY_FIRST_START_MINUTES;
      }
      normalizeTodoOrderForDate(key);
      const excludedId = excludedTodoId === null ? "" : String(excludedTodoId);
      const dayTodos = getIncompleteTodosByDate(key).filter((todo) => String(todo.id) !== excludedId);
      if (!dayTodos.length) {
        return TODO_PLAN_DAY_FIRST_START_MINUTES;
      }
      const last = dayTodos[dayTodos.length - 1];
      const range = getTodoClockRange(last);
      if (!range) return TODO_PLAN_DAY_FIRST_START_MINUTES;
      return range.endMinutes + TODO_PLAN_DAY_GAP_MINUTES;
    }

    function resolveTodoTimeInputForSubmit(selected, nextValue) {
      refreshDataRefs();
      const dueDate = String(nextValue.dueDate || "").trim();
      const startText = String(nextValue.startTime || "").trim();
      const endText = String(nextValue.endTime || "").trim();
      const requestedDurationRaw = Number.parseInt(String(nextValue.estimatedMinutes ?? ""), 10);
      const requestedDuration =
        Number.isInteger(requestedDurationRaw) && requestedDurationRaw >= 5
          ? Math.min(24 * 60, requestedDurationRaw)
          : null;

      const selectedStartText = String(selected?.startTime || "").trim();
      const selectedEndText = String(selected?.endTime || "").trim();
      const selectedRange = getTodoClockRange(selected);
      const selectedDuration = selectedRange
        ? Math.max(5, selectedRange.endMinutes - selectedRange.startMinutes)
        : getTodoDurationMinutes(selected, TODO_PLAN_NEW_TODO_DURATION_MINUTES);

      const startChanged = startText !== selectedStartText;
      const endChanged = endText !== selectedEndText;
      const durationChanged = requestedDuration !== null && requestedDuration !== selectedDuration;

      const startMinutes = parseClockToMinutes(startText);
      const endMinutes = parseClockToMinutes(endText);
      const durationBase = requestedDuration ?? selectedDuration;

      if (startText && startMinutes === null) {
        return { ok: false, message: "开始时间格式无效，请使用 HH:MM。" };
      }
      if (endText && endMinutes === null) {
        return { ok: false, message: "结束时间格式无效，请使用 HH:MM。" };
      }

      const buildRangeFromStartDuration = (startAtMinutes, durationMinutes, overflowMessage) => {
        const normalizedDuration = Math.max(5, Math.min(24 * 60, Math.floor(durationMinutes)));
        const built = buildClockRangeFromStartAndDuration(startAtMinutes, normalizedDuration);
        if (built.durationMinutes !== normalizedDuration) {
          return { ok: false, message: overflowMessage };
        }
        return {
          ok: true,
          startTime: built.startTime,
          endTime: built.endTime,
          estimatedMinutes: built.durationMinutes,
        };
      };

      // 规则1：只改开始时间 -> 预计时长保持不变，自动调整结束时间
      if (startChanged && !endChanged && !durationChanged && startMinutes !== null) {
        return buildRangeFromStartDuration(startMinutes, selectedDuration, "开始时间过晚，无法保持当前预计时长。");
      }

      if (!startChanged && endChanged && !durationChanged && endMinutes !== null) {
        if (startMinutes !== null) {
          if (endMinutes <= startMinutes) {
            return { ok: false, message: "结束时间需要晚于开始时间。" };
          }
          return {
            ok: true,
            startTime: formatMinutesForInput(startMinutes),
            endTime: formatMinutesForInput(endMinutes),
            estimatedMinutes: Math.max(5, endMinutes - startMinutes),
          };
        }
        const fallbackStart = endMinutes - selectedDuration;
        if (fallbackStart < 0) {
          return { ok: false, message: "结束时间过早，且缺少开始时间作为锚点。" };
        }
        return {
          ok: true,
          startTime: formatMinutesForInput(fallbackStart),
          endTime: formatMinutesForInput(endMinutes),
          estimatedMinutes: selectedDuration,
        };
      }

      // 规则2：只改预计时长 -> 开始时间保持不变，自动调整结束时间
      if (!startChanged && !endChanged && durationChanged) {
        const anchorStart =
          startMinutes !== null
            ? startMinutes
            : parseClockToMinutes(selectedStartText) ?? getDefaultStartMinutesForTodoDate(dueDate, selected?.id);
        return buildRangeFromStartDuration(anchorStart, requestedDuration, "预计时长过长，结束时间超出当天范围。");
      }

      // 其余组合按“任意两者确定第三者”处理
      if (startChanged && endChanged && startMinutes !== null && endMinutes !== null) {
        if (endMinutes <= startMinutes) {
          return { ok: false, message: "结束时间需要晚于开始时间。" };
        }
        return {
          ok: true,
          startTime: startText,
          endTime: endText,
          estimatedMinutes: Math.max(5, endMinutes - startMinutes),
        };
      }

      if (startChanged && durationChanged && startMinutes !== null) {
        return buildRangeFromStartDuration(startMinutes, durationBase, "开始时间过晚，无法匹配当前预计时长。");
      }

      if (endChanged && durationChanged && endMinutes !== null) {
        const resolvedStart = endMinutes - durationBase;
        if (resolvedStart < 0) {
          return { ok: false, message: "结束时间过早，无法匹配当前预计时长。" };
        }
        return {
          ok: true,
          startTime: formatMinutesForInput(resolvedStart),
          endTime: formatMinutesForInput(endMinutes),
          estimatedMinutes: durationBase,
        };
      }

      if (startMinutes !== null && endMinutes !== null) {
        if (endMinutes <= startMinutes) {
          return { ok: false, message: "结束时间需要晚于开始时间。" };
        }
        return {
          ok: true,
          startTime: startText,
          endTime: endText,
          estimatedMinutes: Math.max(5, endMinutes - startMinutes),
        };
      }

      if (startMinutes !== null) {
        const built = buildClockRangeFromStartAndDuration(startMinutes, durationBase);
        return {
          ok: true,
          startTime: built.startTime,
          endTime: built.endTime,
          estimatedMinutes: built.durationMinutes,
        };
      }

      if (endMinutes !== null) {
        const resolvedStart = Math.max(0, endMinutes - durationBase);
        const built = buildClockRangeFromStartAndDuration(resolvedStart, durationBase);
        return {
          ok: true,
          startTime: built.startTime,
          endTime: built.endTime,
          estimatedMinutes: built.durationMinutes,
        };
      }

      const selectedDueDate = String(selected?.dueDate || "").trim();
      if (selectedRange && selectedDueDate === dueDate) {
        return {
          ok: true,
          startTime: String(selected.startTime || ""),
          endTime: String(selected.endTime || ""),
          estimatedMinutes: Math.max(5, selectedRange.endMinutes - selectedRange.startMinutes),
        };
      }

      const defaultStart = getDefaultStartMinutesForTodoDate(dueDate, selected?.id);
      const built = buildClockRangeFromStartAndDuration(defaultStart, durationBase);
      return {
        ok: true,
        startTime: built.startTime,
        endTime: built.endTime,
        estimatedMinutes: built.durationMinutes,
      };
    }

    function submitTodoDetailFromForm({
      showValidationAlert = true,
      focusInvalidField = true,
      skipRender = false,
      lenientRequired = false,
    } = {}) {
      refreshDataRefs();
      const selected = getSelectedTodo();
      const newTodoFallback = !selected && lenientRequired ? createTodoDraft() : null;

      const result = collectTodoFormInput({
        fallbackTodo: lenientRequired ? (selected || newTodoFallback) : null,
        lenientRequired,
      });
      if (!result.ok) {
        if (showValidationAlert) {
          window.alert(result.message);
        }
        if (focusInvalidField && result.field && typeof result.field.focus === "function") {
          result.field.focus();
        }
        return false;
      }

      const next = result.value;
      if (!selected) {
        const todo = newTodoFallback || createTodoDraft();
        const resolvedTime = resolveTodoTimeInputForSubmit(todo, next);
        if (!resolvedTime.ok) {
          if (showValidationAlert) {
            window.alert(resolvedTime.message || "待办时间输入无效，请重新调整。");
          }
          return false;
        }

        const nowIso = new Date().toISOString();
        const nextReminderRepeat = normalizeTodoReminderRepeatValue(next.repeat, "none");
        const inputPlanLocked = Boolean(next.planLocked);
        const nextPlanLockExplicit = Boolean(todoDetailModule.isPlanLockTouched());
        const nextPlanLocked = nextPlanLockExplicit ? inputPlanLocked : isRecurringTodoRepeatMode(nextReminderRepeat);
        const created = normalizeTodo({
          ...todo,
          ...next,
          startTime: resolvedTime.startTime,
          endTime: resolvedTime.endTime,
          estimatedMinutes: resolvedTime.estimatedMinutes,
          completed: false,
          calendarSynced: false,
          syncState: "dirty",
          lastSyncError: "",
          reminderLastSyncError: "",
          reminderCompletedAt: null,
          reminderPendingCompleteAt: null,
          planLocked: nextPlanLocked,
          planLockExplicit: nextPlanLockExplicit,
          createdAt: todo.createdAt || nowIso,
          updatedAt: nowIso,
        });
        created.orderInDay = getNextTodoOrderForDate(created.dueDate, created.id);
        const reminderEligible = isTodoEligibleForReminderSync(created);
        created.reminderSynced = !reminderEligible;
        created.reminderSyncState = reminderEligible ? "dirty" : "synced";

        todos.unshift(created);
        setSelectedTodoId(created.id);
        saveTodos(todos);
        todoDetailModule.clearSubmitState();
        if (!skipRender) {
          render();
        }
        return true;
      }

      const oldDueDate = String(selected.dueDate || "").trim();
      const oldStartTime = String(selected.startTime || "").trim();
      const oldEndTime = String(selected.endTime || "").trim();
      const oldEstimate = Number(selected.estimatedMinutes || 0);
      const oldOrderInDay = Number.isFinite(Number(selected.orderInDay)) ? Number(selected.orderInDay) : null;
      const oldDayIndex =
        !selected.completed && isValidDateInput(oldDueDate)
          ? getIncompleteTodosByDate(oldDueDate).findIndex((item) => String(item.id) === String(selected.id))
          : -1;
      const resolvedTime = resolveTodoTimeInputForSubmit(selected, next);
      if (!resolvedTime.ok) {
        if (showValidationAlert) {
          window.alert(resolvedTime.message || "待办时间输入无效，请重新调整。");
        }
        return false;
      }
      next.startTime = resolvedTime.startTime;
      next.endTime = resolvedTime.endTime;
      next.estimatedMinutes = resolvedTime.estimatedMinutes;

      if (!selected.completed && next.dueDate !== oldDueDate) {
        next.orderInDay = getNextTodoOrderForDate(next.dueDate, selected.id);
      } else if (!selected.completed) {
        next.orderInDay = oldOrderInDay;
      }

      const nowIso = new Date().toISOString();
      const selectedReminderRepeat = normalizeTodoReminderRepeatValue(selected.repeat, "none");
      const nextReminderRepeat = normalizeTodoReminderRepeatValue(next.repeat, "none");
      const oldPlanLocked = Boolean(selected.planLocked);
      const oldPlanLockExplicit = Boolean(selected.planLockExplicit);
      const inputPlanLocked = Boolean(next.planLocked);
      let nextPlanLockExplicit = Boolean(selected.planLockExplicit);
      let nextPlanLocked = inputPlanLocked;
      if (todoDetailModule.isPlanLockTouched()) {
        nextPlanLockExplicit = true;
        nextPlanLocked = inputPlanLocked;
      } else if (!nextPlanLockExplicit) {
        nextPlanLocked = isRecurringTodoRepeatMode(nextReminderRepeat);
      }
      next.planLocked = nextPlanLocked;
      next.planLockExplicit = nextPlanLockExplicit;
      const lockStateChanged = oldPlanLocked !== nextPlanLocked;
      const lockChanged = lockStateChanged || oldPlanLockExplicit !== nextPlanLockExplicit;
      const changedForSync =
        selected.title !== next.title ||
        selected.dueDate !== next.dueDate ||
        selected.project !== next.project ||
        getTodoCategory(selected, selected.project) !== next.category ||
        selected.note !== next.note ||
        selected.qualityScore !== next.qualityScore ||
        selected.happinessScore !== next.happinessScore ||
        selected.startTime !== next.startTime ||
        selected.endTime !== next.endTime ||
        selected.estimatedMinutes !== next.estimatedMinutes ||
        selected.reminder !== next.reminder ||
        selectedReminderRepeat !== nextReminderRepeat ||
        Number(selected.orderInDay ?? -1) !== Number(next.orderInDay ?? -1) ||
        selected.tags.join(",") !== next.tags.join(",");
      const reminderEligibleAfterChange = !selected.completed && (
        nextReminderRepeat !== "none" ||
        String(selected.externalReminderId || "").trim()
      );
      const reminderChangedForSync = Boolean(changedForSync && reminderEligibleAfterChange);
      const reminderSyncState = reminderChangedForSync
        ? "dirty"
        : (reminderEligibleAfterChange ? selected.reminderSyncState : "synced");
      const reminderSynced = reminderChangedForSync
        ? false
        : (reminderEligibleAfterChange ? selected.reminderSynced : true);
      const reminderLastSyncError = reminderChangedForSync
        ? ""
        : (reminderEligibleAfterChange ? selected.reminderLastSyncError : "");

      Object.assign(selected, next, {
        updatedAt: nowIso,
        calendarSynced: changedForSync ? false : selected.calendarSynced,
        syncState: changedForSync ? "dirty" : selected.syncState,
        lastSyncError: changedForSync ? "" : selected.lastSyncError,
        reminderSynced,
        reminderSyncState,
        reminderLastSyncError,
        reminderCompletedAt: null,
      });

      if (selected.completed && changedForSync) {
        const completionSnapshot = buildTodoCompletionSnapshot(selected);
        if (completionSnapshot) {
          let completionEntryIndex = findEntryIndexByLinkedTodoId(selected.id);
          if (completionEntryIndex >= 0) {
            entries[completionEntryIndex] = {
              ...entries[completionEntryIndex],
              ...completionSnapshot,
              updatedAt: nowIso,
            };
          } else {
            entries.unshift({
              id: createUniqueEntryId(),
              ...completionSnapshot,
              createdAt: String(selected.completedAt || nowIso),
              updatedAt: nowIso,
            });
            completionEntryIndex = 0;
          }
          selected.completionEntryId = String(entries[completionEntryIndex].id || "");
          // Completed todos are historical mirrors. Their Calendar ownership has moved to the entry.
          selected.calendarSynced = true;
          selected.syncState = "synced";
          selected.lastSyncError = "";
          saveEntries(entries, { skipUndoSnapshot: true });
        }
      }

      if (!selected.completed && oldDueDate && oldDueDate !== selected.dueDate) {
        reflowTodoDayFromIndex(oldDueDate, oldDayIndex, { markDirty: true, timestampIso: nowIso });
      }

      const timeChanged =
        oldStartTime !== selected.startTime ||
        oldEndTime !== selected.endTime ||
        Number(oldEstimate) !== Number(selected.estimatedMinutes);

      if (!selected.completed && lockStateChanged && isValidDateInput(selected.dueDate)) {
        reflowTodoDayFromStart(selected.dueDate, {
          markDirty: true,
          timestampIso: nowIso,
        });
      } else if (!selected.completed && timeChanged && isValidDateInput(selected.dueDate)) {
        reflowTodoDayAfterAnchor(selected.dueDate, selected.id, { markDirty: true, timestampIso: nowIso });
      } else if (selected.completed && timeChanged && isValidDateInput(selected.dueDate)) {
        const completedEndMinutes = parseClockToMinutes(selected.endTime);
        if (Number.isInteger(completedEndMinutes)) {
          reflowTodoDayFromStart(selected.dueDate, {
            markDirty: true,
            timestampIso: nowIso,
            minStartMinutes: completedEndMinutes,
          });
        }
      }

      if (changedForSync || lockChanged) {
        saveTodos(todos);
      }
      todoDetailModule.clearSubmitState();
      if (!skipRender) {
        render();
      }
      return true;
    }

    function findEntryIndexByLinkedTodoId(todoId) {
      refreshDataRefs();
      const id = String(todoId || "");
      if (!id) return -1;
      return entries.findIndex((entry) => {
        if (String(entry.linkedTodoId || "") !== id) return false;
        const source = String(entry.source || "").trim();
        // Keep recurring completion history independent from one-shot todo completion snapshots.
        return !source || source === "todo-completed";
      });
    }

    function shouldCalendarEntryEditUpdateLinkedTodo(entry, linkedTodo) {
      refreshDataRefs();
      if (!entry || !linkedTodo) return false;
      if (entry.todoPending) return !linkedTodo.completed;

      const source = String(entry.source || "").trim();
      if (source === "todo-recurring-completed") return false;
      if (source === "todo-completed") return Boolean(linkedTodo.completed);

      const entryId = String(entry.id || "");
      return Boolean(linkedTodo.completed && entryId && String(linkedTodo.completionEntryId || "") === entryId);
    }

    function resolveTodoCompletionWindow(todo, referenceDate = new Date()) {
      refreshDataRefs();
      if (!todo) return null;
      const nowDate = referenceDate instanceof Date && !Number.isNaN(referenceDate.getTime())
        ? referenceDate
        : new Date();
      const fallbackDurationMinutes = getTodoDurationMinutes(todo, Math.max(5, Number(todo.estimatedMinutes) || 60));
      const plannedRange = buildEntryDateRange(
        String(todo.dueDate || "").trim(),
        String(todo.startTime || "").trim(),
        String(todo.endTime || "").trim(),
      );
      const startDate = plannedRange
        ? plannedRange.startDate
        : new Date(nowDate.getTime() - fallbackDurationMinutes * 60 * 1000);
      if (!(startDate instanceof Date) || Number.isNaN(startDate.getTime())) {
        return null;
      }

      let endDate = plannedRange && plannedRange.endDate <= nowDate
        ? plannedRange.endDate
        : nowDate;
      if (!(endDate instanceof Date) || Number.isNaN(endDate.getTime())) {
        endDate = new Date(startDate.getTime() + fallbackDurationMinutes * 60 * 1000);
      }
      if (endDate <= startDate) {
        endDate = new Date(startDate.getTime() + 5 * 60 * 1000);
      }

      const date = formatDateForInput(startDate);
      const start = formatTimeForInput(startDate);
      const end = formatTimeForInput(endDate);
      const duration = calcDurationHours(start, end);
      if (!(duration > 0)) return null;

      return {
        date,
        start,
        end,
        duration,
        durationMinutes: Math.max(5, Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60))),
      };
    }

    function normalizeTodoCompletionWindowOverride(value) {
      const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
      const date = String(source.date || "").trim();
      const start = String(source.start || "").trim();
      const end = String(source.end || "").trim();
      const startMinutes = parseClockToMinutes(start);
      const endMinutes = parseClockToMinutes(end);
      if (!isValidDateInput(date) || !Number.isInteger(startMinutes) || !Number.isInteger(endMinutes) || endMinutes <= startMinutes) {
        return null;
      }
      return {
        date,
        start,
        end,
        duration: calcDurationHours(start, end),
        durationMinutes: endMinutes - startMinutes,
      };
    }

    function appendRecurringTodoCompletionEntry(todo, completionWindow, timestampIso = new Date().toISOString()) {
      refreshDataRefs();
      if (!todo || !completionWindow) return "";
      const linkedTodoId = String(todo.id || "").trim();
      if (!linkedTodoId) return "";

      const qualityScore = parseOptionalScore(todo.qualityScore);
      const happinessScore = parseOptionalScore(todo.happinessScore);
      const hasBothScores = qualityScore !== null && happinessScore !== null;
      const entry = {
        id: createUniqueEntryId(),
        title: normalizeEntryTitle(todo.title, todo.project || categories[0]),
        date: completionWindow.date,
        start: completionWindow.start,
        end: completionWindow.end,
        category: getTodoCategory(todo, todo.project),
        project: normalizeProjectName(todo.project),
        tags: normalizeTodoTags(todo.tags),
        quality: qualityScore,
        happiness: happinessScore,
        note: `[周期完成] ${todo.note || todo.title}`,
        duration: completionWindow.duration,
        createdAt: timestampIso,
        updatedAt: timestampIso,
        source: "todo-recurring-completed",
        linkedTodoId,
        needsReview: !hasBothScores,
        calendarSynced: false,
        calendarSyncState: "dirty",
        calendarLastSyncError: "",
        calendarSyncedAt: null,
      };

      entries.unshift(entry);
      saveEntries(entries, { skipUndoSnapshot: true });
      return String(entry.id || "");
    }

    function upsertTodoCompletionEntry(todo, { date, start, end, duration }) {
      refreshDataRefs();
      if (!todo) return "";
      const linkedTodoId = String(todo.id || "");
      if (!linkedTodoId) return "";
      const qualityScore = parseOptionalScore(todo.qualityScore);
      const happinessScore = parseOptionalScore(todo.happinessScore);
      const hasBothScores = qualityScore !== null && happinessScore !== null;

      const completionPayload = {
        title: normalizeEntryTitle(todo.title, todo.project || categories[0]),
        date,
        start,
        end,
        category: getTodoCategory(todo, todo.project),
        project: normalizeProjectName(todo.project),
        tags: normalizeTodoTags(todo.tags),
        quality: qualityScore,
        happiness: happinessScore,
        note: `[待办完成] ${todo.note || todo.title}`,
        duration,
        source: "todo-completed",
        linkedTodoId,
        needsReview: !hasBothScores,
        calendarSynced: false,
        calendarSyncState: "dirty",
        calendarLastSyncError: "",
        calendarSyncedAt: null,
      };
      const externalCalendarId = String(todo.externalCalendarId || "").trim();
      if (externalCalendarId) {
        completionPayload.externalId = externalCalendarId;
      }

      const existingIndex = findEntryIndexByLinkedTodoId(linkedTodoId);
      if (existingIndex >= 0) {
        entries[existingIndex] = {
          ...entries[existingIndex],
          ...completionPayload,
          updatedAt: new Date().toISOString(),
        };
        saveEntries(entries);
        return String(entries[existingIndex].id);
      }

      const created = addEntry(completionPayload);
      return created ? String(created.id) : "";
    }

    function removeTodoCompletionEntry(todoId) {
      refreshDataRefs();
      const index = findEntryIndexByLinkedTodoId(todoId);
      if (index < 0) return false;
      entries.splice(index, 1);
      saveEntries(entries);
      return true;
    }

    function buildTodoCompletionSnapshot(todo) {
      refreshDataRefs();
      if (!todo || !todo.completed) return null;
      const completedAt = todo.completedAt ? new Date(todo.completedAt) : new Date();
      const completionWindow = resolveTodoCompletionWindow(todo, completedAt);
      if (!completionWindow) return null;
      const qualityScore = parseOptionalScore(todo.qualityScore);
      const happinessScore = parseOptionalScore(todo.happinessScore);
      const hasBothScores = qualityScore !== null && happinessScore !== null;

      return {
        title: normalizeEntryTitle(todo.title, todo.project || categories[0]),
        date: completionWindow.date,
        start: completionWindow.start,
        end: completionWindow.end,
        category: getTodoCategory(todo, todo.project),
        project: normalizeProjectName(todo.project),
        tags: normalizeTodoTags(todo.tags),
        quality: qualityScore,
        happiness: happinessScore,
        note: `[待办完成] ${todo.note || todo.title}`,
        duration: completionWindow.duration,
        source: "todo-completed",
        linkedTodoId: String(todo.id),
        needsReview: !hasBothScores,
        ...(String(todo.externalCalendarId || "").trim()
          ? { externalId: String(todo.externalCalendarId).trim() }
          : {}),
        calendarSynced: false,
        calendarSyncState: "dirty",
        calendarLastSyncError: "",
        calendarSyncedAt: null,
      };
    }

    function ensureCompletedTodoEntries() {
      refreshDataRefs();
      let entriesChanged = false;
      let todosChanged = false;

      for (const todo of todos) {
        if (!todo.completed) continue;
        const snapshot = buildTodoCompletionSnapshot(todo);
        if (!snapshot) continue;

        let index = findEntryIndexByLinkedTodoId(todo.id);
        if (index < 0) {
          entries.unshift({
            id: createUniqueEntryId(),
            ...snapshot,
            createdAt: String(todo.completedAt || todo.updatedAt || todo.createdAt || new Date().toISOString()),
          });
          index = 0;
          entriesChanged = true;
        } else {
          const current = entries[index];
          const shouldRefreshCompletionSnapshot =
            String(current.source || "") === "todo-completed" &&
            (current.quality !== snapshot.quality ||
              current.happiness !== snapshot.happiness ||
              Boolean(current.needsReview) !== Boolean(snapshot.needsReview));
          if (shouldRefreshCompletionSnapshot) {
            entries[index] = {
              ...current,
              ...snapshot,
              updatedAt: new Date().toISOString(),
            };
            entriesChanged = true;
          }
        }

        const linkedEntryId = String(entries[index].id);
        if (String(todo.completionEntryId || "") !== linkedEntryId) {
          todo.completionEntryId = linkedEntryId;
          todosChanged = true;
        }
      }

      return { entriesChanged, todosChanged };
    }

    function toggleTodoCompleted(todoId, options = {}) {
      refreshDataRefs();
      const skipLinkedPomodoroInterception = Boolean(options && options.skipLinkedPomodoroInterception);
      const requestedCompletionWindow = normalizeTodoCompletionWindowOverride(options?.completionWindow);
      const todo = todos.find((item) => String(item.id) === String(todoId));
      if (!todo) return;
      if (!skipLinkedPomodoroInterception && pomodoroModule.hasLinkedTodoProgress(todo.id)) {
        void pomodoroModule.finish({ forcedAction: "complete" });
        return;
      }

      const todoIdText = String(todo.id || "");
      const preCompleteSnapshot = {
        dueDate: String(todo.dueDate || "").trim(),
        startTime: String(todo.startTime || "").trim(),
        endTime: String(todo.endTime || "").trim(),
        estimatedMinutes: Number.isFinite(Number(todo.estimatedMinutes))
          ? Number(todo.estimatedMinutes)
          : TODO_PLAN_NEW_TODO_DURATION_MINUTES,
        orderInDay: Number.isFinite(Number(todo.orderInDay)) ? Number(todo.orderInDay) : null,
      };
      const nextCompleted = !todo.completed;
      const oldDueDate = String(todo.dueDate || "").trim();
      const oldDayIndex =
        !todo.completed && isValidDateInput(oldDueDate)
          ? getIncompleteTodosByDate(oldDueDate).findIndex((item) => String(item.id) === String(todo.id))
          : -1;
      const nowIso = new Date().toISOString();
      const reminderRepeat = normalizeTodoReminderRepeatValue(todo.repeat, "none");
      const shouldRollRecurringTodo = !todo.completed && nextCompleted && isRecurringTodoRepeatMode(reminderRepeat);

      if (shouldRollRecurringTodo) {
        const completionWindow = requestedCompletionWindow || resolveTodoCompletionWindow(todo, new Date());
        if (completionWindow) {
          appendRecurringTodoCompletionEntry(todo, completionWindow, nowIso);
        }

        const completionBaseDate = completionWindow?.date || (isValidDateInput(oldDueDate) ? oldDueDate : getTodayDateInputValue());
        const nextDueDate = resolveNextRecurringDueDate(completionBaseDate, reminderRepeat);
        if (isValidDateInput(nextDueDate)) {
          todo.dueDate = nextDueDate;
          const parsedReminder = parseTodoReminderDateTime(todo.reminder);
          // If reminder was set via explicit datetime input, carry its clock to next recurrence date.
          if (parsedReminder && isValidClockInput(parsedReminder.time)) {
            todo.reminder = `${nextDueDate}T${parsedReminder.time}`;
          }
        }
        if (isValidClockInput(preCompleteSnapshot.startTime)) {
          todo.startTime = preCompleteSnapshot.startTime;
        }
        if (isValidClockInput(preCompleteSnapshot.endTime)) {
          todo.endTime = preCompleteSnapshot.endTime;
        }
        if (Number.isFinite(preCompleteSnapshot.estimatedMinutes)) {
          todo.estimatedMinutes = Math.max(5, Math.min(24 * 60, Number(preCompleteSnapshot.estimatedMinutes)));
        }

        todo.completed = false;
        todo.completedAt = null;
        todo.completionEntryId = "";
        markTodoPlanningDirty(todo, nowIso);
        todo.reminderLastSyncError = "";
        todo.reminderCompletedAt = null;
        const hasExternalReminderId = Boolean(String(todo.externalReminderId || "").trim());
        if (hasExternalReminderId) {
          // For recurring completion, finish the current reminder first to avoid repeated alerts today.
          todo.reminderPendingCompleteAt = nowIso;
          todo.reminderSynced = true;
          todo.reminderSyncState = "synced";
        } else {
          todo.reminderPendingCompleteAt = null;
          const reminderEligibleAfterRoll = isTodoEligibleForReminderSync(todo);
          todo.reminderSynced = !reminderEligibleAfterRoll;
          todo.reminderSyncState = reminderEligibleAfterRoll ? "dirty" : "synced";
        }

        if (isValidDateInput(todo.dueDate)) {
          todo.orderInDay = getNextTodoOrderForDate(todo.dueDate, todo.id);
        } else {
          todo.orderInDay = null;
        }

        if (isValidDateInput(oldDueDate) && oldDueDate !== todo.dueDate) {
          reflowTodoDayFromIndex(oldDueDate, oldDayIndex, { markDirty: true, timestampIso: nowIso });
        }
        if (isValidDateInput(todo.dueDate)) {
          const minStartMinutes = parseClockToMinutes(todo.startTime);
          reflowTodoDayAfterAnchor(todo.dueDate, todo.id, {
            markDirty: true,
            timestampIso: nowIso,
            minStartMinutes: Number.isInteger(minStartMinutes) ? minStartMinutes : undefined,
          });
        }

        clearTodoRecentlyCompletedForDisplay(todoIdText);
        saveTodos(todos, {
          skipSyncSchedule: hasExternalReminderId,
        });
        render();
        if (hasExternalReminderId) {
          // Complete today's reminder immediately, then schedule next occurrence sync.
          void syncRecurringTodoReminderNow(String(todo.id || ""));
        }
        return;
      }

      todo.completed = nextCompleted;
      todo.completedAt = nextCompleted ? nowIso : null;
      todo.updatedAt = nowIso;
      todo.calendarSynced = false;
      todo.syncState = "dirty";
      todo.lastSyncError = "";
      todo.reminderLastSyncError = "";
      todo.reminderPendingCompleteAt = null;

      if (nextCompleted) {
        // Keep reminder id so completion can be propagated to Reminders on next sync tick.
        todo.reminderSynced = true;
        todo.reminderSyncState = "synced";
        todo.reminderCompletedAt = null;

        const completionWindow = requestedCompletionWindow || resolveTodoCompletionWindow(todo, new Date());
        if (completionWindow) {
          todo.dueDate = completionWindow.date;
          todo.startTime = completionWindow.start;
          todo.endTime = completionWindow.end;
          todo.estimatedMinutes = completionWindow.durationMinutes;
          todo.completionEntryId = upsertTodoCompletionEntry(todo, {
            date: completionWindow.date,
            start: completionWindow.start,
            end: completionWindow.end,
            duration: completionWindow.duration,
          });
          // The actual record takes ownership of the same Calendar event. The Todo stops syncing as a plan.
          todo.externalCalendarId = "";
          todo.calendarSynced = true;
          todo.syncState = "synced";
          todo.syncedAt = nowIso;
        }
        const completedEndMinutes = parseClockToMinutes(String(completionWindow?.end || ""));
        if (isValidDateInput(oldDueDate) && completionWindow && oldDueDate !== completionWindow.date) {
          reflowTodoDayFromIndex(oldDueDate, oldDayIndex, { markDirty: true, timestampIso: nowIso });
        }
        if (completionWindow && isValidDateInput(completionWindow.date) && Number.isInteger(completedEndMinutes)) {
          reflowTodoDayFromStart(completionWindow.date, {
            markDirty: true,
            timestampIso: nowIso,
            minStartMinutes: completedEndMinutes,
          });
        }
        if (!showTodoHistoryInMainList) {
          markTodoRecentlyCompletedForDisplay(todoIdText, preCompleteSnapshot);
        } else {
          clearTodoRecentlyCompletedForDisplay(todoIdText);
        }
      } else {
        clearTodoRecentlyCompletedForDisplay(todoIdText);
        const completionEntryIndex = findEntryIndexByLinkedTodoId(todo.id);
        const completionExternalId = completionEntryIndex >= 0
          ? String(entries[completionEntryIndex]?.externalId || "").trim()
          : "";
        removeTodoCompletionEntry(todo.id);
        todo.completionEntryId = "";
        if (completionExternalId) {
          todo.externalCalendarId = completionExternalId;
          todo.calendarSynced = false;
          todo.syncState = "dirty";
        }
        const reminderEligibleAfterRestore = Boolean(
          String(todo.reminder || "").trim() || String(todo.externalReminderId || "").trim(),
        );
        todo.reminderSynced = !reminderEligibleAfterRestore;
        todo.reminderSyncState = reminderEligibleAfterRestore ? "dirty" : "synced";
        todo.reminderCompletedAt = null;
        if (isValidDateInput(todo.dueDate)) {
          todo.orderInDay = getNextTodoOrderForDate(todo.dueDate, todo.id);
          reflowTodoDayAfterAnchor(todo.dueDate, todo.id, { markDirty: true, timestampIso: nowIso });
        }
      }

      saveTodos(todos);
      render();
    }

    async function syncRecurringTodoReminderNow(todoId) {
      refreshDataRefs();
      const taskId = String(todoId || "").trim();
      if (!taskId) return false;
      const todo = todos.find((item) => String(item.id) === taskId);
      if (!todo) return false;
      const completeRequest = buildTodoReminderCompleteRequest(todo, { action: "complete" });
      if (!completeRequest.ok) return false;

      try {
        const completeResult = await completeTodoTasksInMacReminders([completeRequest.value]);
        const summary = applyTodoReminderCompleteItems(completeResult.items);
        if (summary.succeeded > 0) {
          // Run a quick follow-up sync so the next recurring reminder is upserted with new dueDate.
          scheduleAutoBidirectionalSync("recurring-reminder-complete-now", 240);
        }
        render();
        return summary.succeeded > 0;
      } catch (error) {
        const message = error instanceof Error ? error.message : "提醒完成同步失败";
        const latest = todos.find((item) => String(item.id) === taskId);
        if (latest) {
          latest.reminderPendingCompleteAt = String(latest.reminderPendingCompleteAt || new Date().toISOString());
          latest.reminderSynced = false;
          latest.reminderSyncState = "error";
          latest.reminderLastSyncError = `提醒完成同步失败：${message}`;
          saveTodos(todos, { skipSyncSchedule: true });
        }
        setCalendarSyncStatus(`提醒完成失败：${message}`, "warning");
        render();
        return false;
      }
    }

    return {
      handleTodoCreate,
      handleTodoCreateAfterSelected,
      restoreHistoryItemToTodo,
      handleTodoFocusStart,
      handleTodoDelete,
      deleteTodoByTaskId,
      deleteTodoByIndex,
      buildClockRangeFromStartAndDuration,
      getDefaultStartMinutesForTodoDate,
      resolveTodoTimeInputForSubmit,
      submitTodoDetailFromForm,
      findEntryIndexByLinkedTodoId,
      shouldCalendarEntryEditUpdateLinkedTodo,
      resolveTodoCompletionWindow,
      appendRecurringTodoCompletionEntry,
      upsertTodoCompletionEntry,
      removeTodoCompletionEntry,
      buildTodoCompletionSnapshot,
      ensureCompletedTodoEntries,
      toggleTodoCompleted,
      syncRecurringTodoReminderNow,
    };
  }

  globalScope.TimeQualityTodoActionsModule = {
    createTodoActionsModule,
  };
})(typeof window !== "undefined" ? window : globalThis);
