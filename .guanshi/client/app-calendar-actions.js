/* global window */

(function attachCalendarActionsModule(globalScope) {
  "use strict";

  function assertFunction(name, value) {
    if (typeof value !== "function") {
      throw new Error(`TimeQualityCalendarActionsModule requires dependency: ${name}`);
    }
  }

  function createCalendarActionsModule(deps = {}) {
    const {
      calendarEventEditCategory = null,
      calendarEventEditDate = null,
      calendarEventEditStart = null,
      calendarEventEditEnd = null,
      calendarEventEditQuality = null,
      calendarEventEditHappiness = null,
      calendarEventEditNote = null,
      pomodoroCategory = null,
      alertFn = globalScope.alert ? globalScope.alert.bind(globalScope) : () => {},
      getEntries,
      setEntries,
      getTodos,
      getCategories,
      getEditingCalendarEntryId,
      getIgnoredExternalCalendarIds,
      setCalendarWeekStart,
      setCalendarPendingFocusMinutes,
      setCalendarNeedsViewportReset,
      getCalendarUiRenderEntries,
      findCalendarRenderableById,
      getTodoIdFromPlanEntryId,
      deleteTodoByTaskId,
      closeCalendarEventModal,
      saveTodos,
      saveEntries,
      render,
      renderCalendar,
      isImportedExternalEntry,
      saveIgnoredExternalCalendarIds,
      todoPlanModule = {},
      shouldCalendarEntryEditUpdateLinkedTodo,
      markTodoPlanningDirty,
      getCalendarEventModalTitleValue,
      isCalendarModalScoreLockedForEntry,
      normalizeScoreForInput,
      createUniqueEntryId,
      normalizeEntryTitle,
      normalizeProjectName,
      normalizeTodoTags,
      calcDurationHours,
      buildEntryDateRange,
      getCalendarRenderEntries,
      formatDate,
      getEntryDisplayTitle,
      formatDateForInput,
      formatTimeForInput,
      getStartOfWeek,
    } = deps;

    [
      ["getEntries", getEntries],
      ["setEntries", setEntries],
      ["getTodos", getTodos],
      ["getCategories", getCategories],
      ["getEditingCalendarEntryId", getEditingCalendarEntryId],
      ["getIgnoredExternalCalendarIds", getIgnoredExternalCalendarIds],
      ["setCalendarWeekStart", setCalendarWeekStart],
      ["setCalendarPendingFocusMinutes", setCalendarPendingFocusMinutes],
      ["setCalendarNeedsViewportReset", setCalendarNeedsViewportReset],
      ["getCalendarUiRenderEntries", getCalendarUiRenderEntries],
      ["findCalendarRenderableById", findCalendarRenderableById],
      ["getTodoIdFromPlanEntryId", getTodoIdFromPlanEntryId],
      ["deleteTodoByTaskId", deleteTodoByTaskId],
      ["closeCalendarEventModal", closeCalendarEventModal],
      ["saveTodos", saveTodos],
      ["saveEntries", saveEntries],
      ["render", render],
      ["renderCalendar", renderCalendar],
      ["isImportedExternalEntry", isImportedExternalEntry],
      ["saveIgnoredExternalCalendarIds", saveIgnoredExternalCalendarIds],
      ["shouldCalendarEntryEditUpdateLinkedTodo", shouldCalendarEntryEditUpdateLinkedTodo],
      ["markTodoPlanningDirty", markTodoPlanningDirty],
      ["getCalendarEventModalTitleValue", getCalendarEventModalTitleValue],
      ["isCalendarModalScoreLockedForEntry", isCalendarModalScoreLockedForEntry],
      ["normalizeScoreForInput", normalizeScoreForInput],
      ["createUniqueEntryId", createUniqueEntryId],
      ["normalizeEntryTitle", normalizeEntryTitle],
      ["normalizeProjectName", normalizeProjectName],
      ["normalizeTodoTags", normalizeTodoTags],
      ["calcDurationHours", calcDurationHours],
      ["buildEntryDateRange", buildEntryDateRange],
      ["getCalendarRenderEntries", getCalendarRenderEntries],
      ["formatDate", formatDate],
      ["getEntryDisplayTitle", getEntryDisplayTitle],
      ["formatDateForInput", formatDateForInput],
      ["formatTimeForInput", formatTimeForInput],
      ["getStartOfWeek", getStartOfWeek],
    ].forEach(([name, value]) => assertFunction(name, value));

    if (typeof todoPlanModule.applyDirectEditDraftForTodoPlan !== "function") {
      throw new Error("TimeQualityCalendarActionsModule requires dependency: todoPlanModule.applyDirectEditDraftForTodoPlan");
    }

    let entries = [];
    let todos = [];
    let categories = [];

    function refreshDataRefs() {
      const nextEntries = getEntries();
      const nextTodos = getTodos();
      const nextCategories = getCategories();
      entries = Array.isArray(nextEntries) ? nextEntries : [];
      todos = Array.isArray(nextTodos) ? nextTodos : [];
      categories = Array.isArray(nextCategories) ? nextCategories : [];
    }

    function deleteCalendarRenderableById(idToken, { closeModal = false } = {}) {
      refreshDataRefs();
      const ignoredExternalCalendarIds = getIgnoredExternalCalendarIds();
      const token = String(idToken || "").trim();
      if (!token) return false;

      const resolved = findCalendarRenderableById(token, getCalendarUiRenderEntries());
      if (!resolved) return false;

      const nowIso = new Date().toISOString();
      const isTodoPlan = resolved.kind === "todo-plan";
      if (isTodoPlan) {
        const todoId = String(
          resolved.todo?.id ||
          resolved.entry?.linkedTodoId ||
          getTodoIdFromPlanEntryId(token) ||
          "",
        ).trim();
        if (!todoId) return false;

        const removed = deleteTodoByTaskId(todoId, {
          queueRemoteDelete: true,
          timestampIso: nowIso,
        });
        if (!removed) return false;
        if (closeModal) {
          closeCalendarEventModal();
        }
        saveTodos(todos);
        render();
        return true;
      }

      const targetEntry = resolved.entry || entries.find((item) => String(item.id) === token);
      if (!targetEntry) return false;
      const entryId = String(targetEntry.id || token);

      if (isImportedExternalEntry(targetEntry) && targetEntry.externalId) {
        ignoredExternalCalendarIds.add(String(targetEntry.externalId));
        saveIgnoredExternalCalendarIds(ignoredExternalCalendarIds);
      }

      const linkedTodoId = String(targetEntry.linkedTodoId || "");
      if (linkedTodoId) {
        const linkedTodo = todos.find((item) => String(item.id) === linkedTodoId);
        if (linkedTodo && String(linkedTodo.completionEntryId || "") === entryId) {
          linkedTodo.completionEntryId = "";
          saveTodos(todos);
        }
      }

      setEntries(entries.filter((item) => String(item.id) !== entryId));
      refreshDataRefs();
      if (closeModal) {
        closeCalendarEventModal();
      }
      saveEntries(entries);
      render();
      return true;
    }

    function commitCalendarDirectEditDraft(state, draft) {
      refreshDataRefs();
      const todoPlanDirectEditResult = todoPlanModule.applyDirectEditDraftForTodoPlan(state, draft);
      if (todoPlanDirectEditResult?.handled) {
        if (!todoPlanDirectEditResult.applied) {
          renderCalendar(entries);
        }
        return true;
      }

      const entryIndex = entries.findIndex((item) => String(item.id) === String(state.entryId));
      if (entryIndex < 0) {
        renderCalendar(entries);
        return true;
      }

      const previousEntry = entries[entryIndex];
      entries[entryIndex] = {
        ...previousEntry,
        date: draft.date,
        start: draft.start,
        end: draft.end,
        duration: draft.duration,
        needsReview: Boolean(previousEntry?.needsReview),
        updatedAt: new Date().toISOString(),
      };

      const linkedTodoId = String(previousEntry?.linkedTodoId || "");
      if (linkedTodoId) {
        const linkedTodo = todos.find((item) => String(item.id) === linkedTodoId);
        if (shouldCalendarEntryEditUpdateLinkedTodo(previousEntry, linkedTodo)) {
          linkedTodo.dueDate = draft.date;
          linkedTodo.startTime = draft.start;
          linkedTodo.endTime = draft.end;
          linkedTodo.estimatedMinutes = Math.max(5, Math.round(draft.duration * 60));
          markTodoPlanningDirty(linkedTodo, new Date().toISOString());
          saveTodos(todos);
        }
      }

      saveEntries(entries);
      render();
      return true;
    }

    function handleCalendarEventFormSubmit(event) {
      refreshDataRefs();
      const editingCalendarEntryId = getEditingCalendarEntryId();
      event.preventDefault();
      if (
        !calendarEventEditCategory ||
        !calendarEventEditDate ||
        !calendarEventEditStart ||
        !calendarEventEditEnd ||
        !calendarEventEditQuality ||
        !calendarEventEditHappiness ||
        !calendarEventEditNote
      ) {
        return;
      }

      const date = String(calendarEventEditDate.value || "");
      const start = String(calendarEventEditStart.value || "");
      const end = String(calendarEventEditEnd.value || "");
      const category = categories.includes(calendarEventEditCategory.value)
        ? calendarEventEditCategory.value
        : categories[0];
      const note = String(calendarEventEditNote.value || "").trim();
      const normalizedTitle = getCalendarEventModalTitleValue(category);
      const editingTargetIndex =
      editingCalendarEntryId === null ? -1 : entries.findIndex((item) => item.id === editingCalendarEntryId);
      const editingTarget = editingTargetIndex >= 0 ? entries[editingTargetIndex] : null;
      const skipScoreForFutureEntry = Boolean(editingTarget && isCalendarModalScoreLockedForEntry(editingTarget));
      let quality = Number.parseInt(calendarEventEditQuality.value, 10);
      let happiness = Number.parseInt(calendarEventEditHappiness.value, 10);

      if (skipScoreForFutureEntry) {
        quality = Number(editingTarget?.quality) || 0;
        happiness = Number(editingTarget?.happiness) || 0;
      }

      if (!skipScoreForFutureEntry && (!Number.isInteger(quality) || quality < 1 || quality > 10)) {
        alertFn("质量评分需为 1 到 10 的整数。");
        calendarEventEditQuality.focus();
        return;
      }

      if (!skipScoreForFutureEntry && (!Number.isInteger(happiness) || happiness < 1 || happiness > 10)) {
        alertFn("幸福感评分需为 1 到 10 的整数。");
        calendarEventEditHappiness.focus();
        return;
      }

      const validation = validateEntryInput(date, start, end, { allowFutureRange: skipScoreForFutureEntry });
      if (!validation.ok) {
        alertFn(validation.message);
        return;
      }

      const overlapping = findOverlappingEntry(date, start, end, editingCalendarEntryId);
      if (overlapping) {
        alertFn(getOverlapMessage(overlapping));
        return;
      }

      if (editingCalendarEntryId === null) {
        closeCalendarEventModal();
        addEntry({
          title: normalizedTitle,
          date,
          start,
          end,
          category,
          quality,
          happiness,
          note,
          duration: validation.duration,
        });
        return;
      }

      const targetIndex = editingTargetIndex;
      if (targetIndex < 0) {
        closeCalendarEventModal();
        render();
        return;
      }

      entries[targetIndex] = {
        ...entries[targetIndex],
        title: normalizedTitle,
        date,
        start,
        end,
        category,
        quality,
        happiness,
        note,
        duration: validation.duration,
        needsReview: skipScoreForFutureEntry ? true : false,
      };

      const linkedTodoId = String(entries[targetIndex].linkedTodoId || "");
      if (linkedTodoId) {
        const linkedTodo = todos.find((item) => String(item.id) === linkedTodoId);
        if (shouldCalendarEntryEditUpdateLinkedTodo(entries[targetIndex], linkedTodo)) {
          linkedTodo.title = normalizedTitle;
          linkedTodo.dueDate = date;
          linkedTodo.startTime = start;
          linkedTodo.endTime = end;
          linkedTodo.project = category;
          linkedTodo.note = note;
          linkedTodo.qualityScore = normalizeScoreForInput(quality);
          linkedTodo.happinessScore = normalizeScoreForInput(happiness);
          linkedTodo.estimatedMinutes = Math.max(5, Math.round(validation.duration * 60));
          markTodoPlanningDirty(linkedTodo, new Date().toISOString());
          saveTodos(todos);
        }
      }

      saveEntries(entries);
      closeCalendarEventModal();
      render();
    }

    function addEntry({
      title,
      date,
      start,
      end,
      category,
      project = "",
      tags = [],
      quality,
      happiness,
      note,
      duration,
      source = "",
      linkedTodoId = "",
      needsReview = false,
      externalId = "",
      externalTitle = "",
      calendarGroup = "",
    }) {
      refreshDataRefs();
      const entry = {
        id: createUniqueEntryId(),
        title: normalizeEntryTitle(title, category),
        date,
        start,
        end,
        category,
        project: normalizeProjectName(project),
        tags: normalizeTodoTags(tags),
        quality,
        happiness,
        note,
        duration,
        createdAt: new Date().toISOString(),
        source: source ? String(source) : undefined,
        linkedTodoId: linkedTodoId ? String(linkedTodoId) : undefined,
        needsReview: Boolean(needsReview),
        externalId: externalId ? String(externalId) : undefined,
        externalTitle: externalTitle ? String(externalTitle) : undefined,
        calendarGroup: calendarGroup ? String(calendarGroup) : undefined,
      };

      entries.unshift(entry);
      saveEntries(entries);
      render();
      return entry;
    }

    function validateEntryInput(date, start, end, options = {}) {
      refreshDataRefs();
      void options;
      if (!date || !start || !end) {
        return { ok: false, message: "请完整填写日期、开始和结束时间。" };
      }

      const duration = calcDurationHours(start, end);
      if (!duration || duration <= 0) {
        return { ok: false, message: "结束时间需要晚于开始时间，或跨天时长不能超过 24 小时。" };
      }

      const dateOnly = new Date(`${date}T00:00:00`);
      if (Number.isNaN(dateOnly.getTime())) {
        return { ok: false, message: "日期格式无效，请重新选择。" };
      }

      const range = buildEntryDateRange(date, start, end);
      if (!range) {
        return { ok: false, message: "时间格式无效，请重新输入。" };
      }

      return { ok: true, duration };
    }

    function isLockedTodoPlanEntry(entry) {
      refreshDataRefs();
      if (!entry || !entry.todoPending) return false;
      const todoId = String(entry.linkedTodoId || getTodoIdFromPlanEntryId(entry.id) || "").trim();
      if (!todoId) return false;
      const linkedTodo = todos.find((item) => String(item.id) === todoId);
      return Boolean(linkedTodo?.planLocked);
    }

    function canDirectEditEntry(entry) {
      refreshDataRefs();
      if (!entry) return false;
      if (isLockedTodoPlanEntry(entry)) return false;
      return true;
    }

    function findOverlappingEntry(date, start, end, excludedId = null, { includeTodoPlans = true } = {}) {
      refreshDataRefs();
      const targetRange = buildEntryDateRange(date, start, end);
      if (!targetRange) return null;
      const excluded = excludedId === null ? "" : String(excludedId);
      const source = includeTodoPlans ? getCalendarRenderEntries(entries) : entries;

      for (const item of source) {
        if (!item || !item.id) continue;
        if (excluded && String(item.id) === excluded) continue;

        const currentRange = buildEntryDateRange(item.date, item.start, item.end);
        if (!currentRange) continue;

        const isOverlapping =
          targetRange.startDate < currentRange.endDate && targetRange.endDate > currentRange.startDate;
        if (isOverlapping) {
          return item;
        }
      }

      return null;
    }

    function getOverlapMessage(overlapEntry) {
      refreshDataRefs();
      return `时间与已有记录重叠：${formatDate(overlapEntry.date)} ${overlapEntry.start}-${overlapEntry.end}（${getEntryDisplayTitle(overlapEntry, overlapEntry.category || "记录")}）。请调整后再保存。`;
    }

    function savePomodoroEntry({
      endDate,
      durationSeconds,
      title,
      quality,
      happiness,
      note = "",
      source = "",
      categoryOverride = "",
      includeTodoPlans = true,
    }) {
      refreshDataRefs();
      const startDate = new Date(endDate.getTime() - durationSeconds * 1000);

      const date = formatDateForInput(startDate);
      const start = formatTimeForInput(startDate);
      const end = formatTimeForInput(endDate);

      const validation = validateEntryInput(date, start, end);
      if (!validation.ok) {
        alertFn(validation.message);
        return null;
      }

      const overlapping = findOverlappingEntry(date, start, end, null, { includeTodoPlans });
      if (overlapping) {
        alertFn(`番茄钟记录与已有事件冲突。${getOverlapMessage(overlapping)}`);
        return null;
      }

      const focusMinutes = Math.round(durationSeconds / 60);
      const category = String(categoryOverride || pomodoroCategory.value || categories[0] || "工作");
      const defaultTitle = `番茄钟：${category}`;
      const normalizedTitle = normalizeEntryTitle(title, defaultTitle);
      setCalendarWeekStart(getStartOfWeek(startDate));
      setCalendarPendingFocusMinutes(startDate.getHours() * 60 + startDate.getMinutes());
      setCalendarNeedsViewportReset(true);

      return addEntry({
        title: normalizedTitle,
        date,
        start,
        end,
        category,
        quality,
        happiness,
        note: String(note || "").trim() || `番茄钟专注完成（${focusMinutes} 分钟）`,
        source: source ? String(source) : "",
        duration: validation.duration,
      });
    }

    return {
      deleteCalendarRenderableById,
      commitCalendarDirectEditDraft,
      handleCalendarEventFormSubmit,
      addEntry,
      validateEntryInput,
      isLockedTodoPlanEntry,
      canDirectEditEntry,
      findOverlappingEntry,
      getOverlapMessage,
      savePomodoroEntry,
    };
  }

  globalScope.TimeQualityCalendarActionsModule = {
    createCalendarActionsModule,
  };
})(typeof window !== "undefined" ? window : globalThis);
