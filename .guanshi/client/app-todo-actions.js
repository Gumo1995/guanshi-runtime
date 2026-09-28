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
      revealPomodoro = () => {},
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
      insertTodoAfterAnchor,
      prepareTodoInsertionContext = () => ({}),
      focusCreatedTodo = () => {},
      showTodoNotice = () => {},
      validateTodoEdit = () => ({ feasible: true }),
      validateTodoScheduleChanges = () => ({ feasible: true }),
      showTodoInProject = () => {},
      runDataTransaction,
      deferDataEffect = () => false,
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

    const copySchema = "guanshi.todo-copy.v1";
    const copyFields = ["todoKind", "title", "note", "project", "category", "tags", "priority", "estimatedMinutes",
      "importance", "urgency", "taskType", "energyLevel", "splittable", "minimumBlockMinutes"];
    const aiSnapshotFields = ["id", "updatedAt", "title", "todoKind", "containerTodoId", "project", "dueDate", "startTime", "endTime", "estimatedMinutes", "scheduleState", "planLocked", "repeat", "completed"];
    const aiEditableFields = new Set(["title", "project", "category", "priority", "note", "reminder", "repeat",
      "scheduleState", "targetDate", "tags", "dueDate", "startTime", "endTime", "estimatedMinutes", "planLocked"]);

    function serializeSelectedTodo() {
      refreshDataRefs();
      const selected = getSelectedTodo();
      if (!selected || (selected.completed && selected.todoKind !== "group")) return null;
      const data = {};
      for (const key of copyFields) {
        if (selected[key] !== undefined) data[key] = key === "tags" ? [...selected.tags] : selected[key];
      }
      if (selected.todoKind === "group") { data.estimatedMinutes = TODO_PLAN_NEW_TODO_DURATION_MINUTES; showTodoNotice("已复制父待办内容，不含子待办。"); }
      return JSON.stringify({ schema: copySchema, todo: data });
    }

    function parseTodoClipboard(text) {
      if (typeof text !== "string" || text.length > 200000) return null;
      try {
        const payload = JSON.parse(text);
        const source = payload?.todo;
        if (payload?.schema !== copySchema || !source || typeof source !== "object" || Array.isArray(source) ||
            typeof source.title !== "string" || !source.title.trim() ||
            !Number.isInteger(source.estimatedMinutes) || source.estimatedMinutes < 5 || source.estimatedMinutes > 1440) return null;
        const result = {};
        for (const key of copyFields) {
          if (!(key in source)) continue;
          const value = source[key];
          if (key === "tags") {
            if (!Array.isArray(value) || value.some((tag) => typeof tag !== "string")) return null;
            result[key] = [...value];
          } else if (value === null || ["string", "number", "boolean"].includes(typeof value)) result[key] = value;
          else return null;
        }
        if (result.todoKind && !["task", "group"].includes(result.todoKind)) return null;
        return result;
      } catch { return null; }
    }

    function createTodoAtSelection(copy = null) {
      // Commit an edited title/time before resolving the insertion anchor.
      if (!commitTodoDetailIfDirty({ showValidationAlert: true, focusInvalidField: true, skipRender: true })) return false;
      refreshDataRefs();
      const selectedId = getSelectedTodoId();
      const anchor = getSelectedTodo();
      if (selectedId && !anchor) {
        showTodoNotice("选中待办已变化，请重新选择位置。", true);
        return false;
      }
      const base = createTodoDraft();
      const todo = normalizeTodo({ ...base, ...(copy || {}),
        remainingMinutes: copy?.estimatedMinutes ?? base.estimatedMinutes,
        planLocked: false, planLockExplicit: true,
      });
      if (copy?.todoKind === "group" && anchor?.containerTodoId) {
        showTodoNotice("父待办只能粘贴到项目的同级位置，请选择父项或独立待办。", true); return false;
      }
      todo.containerTodoId = todo.todoKind === "group" ? null : (anchor?.containerTodoId || null);
      if (todo.containerTodoId) todo.project = anchor.project;
      const context = prepareTodoInsertionContext(todo, anchor, { isCopy: Boolean(copy) });
      if (todo.todoKind === "group" || anchor?.todoKind === "group" || anchor?.scheduleState === "unplanned") {
        if (anchor?.completed) { showTodoNotice("已完成待办不能作为新增位置。", true); return false; }
        todo.scheduleState = todo.todoKind === "group" ? null : "unplanned";
        todo.dueDate = ""; todo.startTime = ""; todo.endTime = "";
        const ok = commitHierarchyChange(() => { todos.push(normalizeTodo(todo)); context.prepareGroupOrder?.(todos); });
        if (!ok) return false;
        setSelectedTodoId(todo.id); setActiveView("todo"); showTodoInProject(todo.id); render();
        focusCreatedTodo(todo.id, { editTitle: !copy });
        if (copy) showTodoNotice(todo.todoKind === "group" ? "已粘贴父待办内容，不含子待办。" : "已粘贴未排期待办。");
        return true;
      }
      const result = insertTodoAfterAnchor(todo, anchor?.id || "", context);
      if (!result.feasible) {
        showTodoNotice(result.message, true);
        return false;
      }
      setSelectedTodoId(todo.id);
      setActiveView("todo");
      render();
      focusCreatedTodo(todo.id, { editTitle: !copy });
      if (copy) showTodoNotice("已粘贴待办，可按 ⌘Z 撤销。");
      return true;
    }

    function commitHierarchyChange(mutate) {
      const beforeRefs = [...todos];
      const before = todos.map((item) => JSON.parse(JSON.stringify(item)));
      const selectedBefore = getSelectedTodoId();
      try {
        const apply = () => { mutate(); saveTodos(todos, { undoBoundary: true }); };
        if (typeof runDataTransaction === "function") runDataTransaction(apply, [todos, entries]);
        else apply();
        return true;
      } catch (error) {
        beforeRefs.forEach((item, index) => {
          Object.keys(item).forEach((key) => delete item[key]);
          Object.assign(item, before[index]);
        });
        todos.splice(0, todos.length, ...beforeRefs); setSelectedTodoId(selectedBefore);
        showTodoNotice(`保存失败，未修改待办：${error.message}`, true); return false;
      }
    }

    function createAiMutationFailure(code, message, extra = {}) {
      return {
        feasible: false,
        applied: 0,
        created: 0,
        updated: 0,
        createdIds: [],
        updatedIds: [],
        appliedIds: [],
        code,
        message,
        ...extra,
      };
    }

    function snapshotTodoForAi(todo) {
      if (!todo) return null;
      const snapshot = {};
      for (const key of aiSnapshotFields) {
        if (todo[key] !== undefined) snapshot[key] = Array.isArray(todo[key]) ? [...todo[key]] : todo[key];
      }
      return snapshot;
    }

    function isAiSnapshotCurrent(todo, snapshot) {
      if (!todo || !snapshot || typeof snapshot !== "object") return Boolean(todo);
      return aiSnapshotFields.every((key) => {
        if (!Object.prototype.hasOwnProperty.call(snapshot, key)) return true;
        return JSON.stringify(todo[key] ?? null) === JSON.stringify(snapshot[key] ?? null);
      });
    }

    function buildTodoFromAiDraft(item = {}, context = {}) {
      const base = createTodoDraft();
      const priorityMap = { urgent: "P0", high: "P1", medium: "P2", low: "P3" };
      const estimatedMinutes = Math.max(5, Number(item.estimatedMinutes || item.remainingMinutes || base.estimatedMinutes) || TODO_PLAN_NEW_TODO_DURATION_MINUTES);
      const explicitDate = isValidDateInput(String(item.dueDate || ""));
      const explicitStart = isValidClockInput(String(item.startTime || ""));
      const explicitEnd = isValidClockInput(String(item.endTime || ""));
      const note = String(item.notes || item.note || item.description || "").trim() || String(context.note || "").trim();
      const todo = normalizeTodo({
        ...base,
        title: String(item.title || "待确认任务").trim() || "待确认任务",
        note,
        project: normalizeProjectName(item.project || ""),
        category: normalizeTodoCategoryValue(item.category || getCategories()[0] || "工作"),
        tags: normalizeTodoTags(Array.isArray(item.tags) ? item.tags : []),
        priority: priorityMap[item.priority] || item.priority || "P2",
        estimatedMinutes,
        remainingMinutes: estimatedMinutes,
        importance: item.importance,
        urgency: item.urgency,
        taskType: item.taskType || "other",
        energyLevel: item.energyLevel || "medium",
        splittable: Boolean(item.splittable),
        minimumBlockMinutes: Number(item.minimumBlockMinutes) || Math.min(estimatedMinutes, 30),
        todoKind: item.todoKind === "group" ? "group" : "task",
        containerTodoId: item.containerTodoId || null,
        scheduleState: explicitDate && explicitStart && explicitEnd ? "planned" : (base.scheduleState || "planned"),
        dueDate: explicitDate ? item.dueDate : base.dueDate,
        startTime: explicitStart ? item.startTime : "",
        endTime: explicitEnd ? item.endTime : "",
        targetDate: isValidDateInput(String(item.targetDate || "")) ? item.targetDate : "",
        planLocked: item.planLocked === true && explicitDate && explicitStart && explicitEnd,
        planLockExplicit: item.planLocked === true,
        reminder: item.reminder || "none",
        repeat: item.repeat || "none",
        dependencies: Array.isArray(item.dependencies) ? [...item.dependencies] : [],
        calendarSynced: false,
        reminderSynced: false,
        syncState: "dirty",
        aiMeta: {
          source: "ai_sidebar",
          draftId: String(item.draftTodoId || item.childDraftId || context.draftId || ""),
          confirmedAt: new Date().toISOString(),
        },
        updatedAt: new Date().toISOString(),
      });
      if (todo.todoKind === "group") {
        todo.scheduleState = null;
        todo.dueDate = "";
        todo.startTime = "";
        todo.endTime = "";
        todo.planLocked = false;
        todo.reminder = "none";
        todo.repeat = "none";
      }
      return todo;
    }

    function commitAiTodoMutation(mutate) {
      const beforeRefs = [...todos];
      const before = todos.map((item) => JSON.parse(JSON.stringify(item)));
      const selectedBefore = getSelectedTodoId();
      try {
        const apply = () => {
          mutate();
          saveTodos(todos, { undoBoundary: true });
        };
        if (typeof runDataTransaction === "function") runDataTransaction(apply, [todos, entries]);
        else apply();
        return { ok: true };
      } catch (error) {
        beforeRefs.forEach((item, index) => {
          Object.keys(item).forEach((key) => delete item[key]);
          Object.assign(item, before[index]);
        });
        todos.splice(0, todos.length, ...beforeRefs);
        setSelectedTodoId(selectedBefore);
        return { ok: false, error };
      }
    }

    function getAiDraftTarget(draft = {}) {
      const targetId = String(draft.targetTodoId || draft.sourceTodoId || draft.todoId || "").trim();
      const target = todos.find((item) => String(item.id) === targetId) || null;
      if (!target) return { error: createAiMutationFailure("todo_target_missing", "目标待办不存在或已被删除，请重新生成草稿。") };
      if (!isAiSnapshotCurrent(target, draft.targetSnapshot || draft.sourceSnapshot)) {
        return { error: createAiMutationFailure("todo_target_changed", "目标待办在预览后发生了变化，请重新生成草稿。") };
      }
      return { target };
    }

    function validateAiPlannedTodos(baseTodos, finalTodos) {
      const baseById = new Map(baseTodos.map((todo) => [String(todo.id), todo]));
      const validationTodos = baseTodos.map((todo) => ({ ...todo }));
      const changes = [];
      for (const finalTodo of finalTodos) {
        if (finalTodo.todoKind === "group" || finalTodo.scheduleState === "unplanned") continue;
        const base = baseById.get(String(finalTodo.id));
        if (!base) {
          validationTodos.push({
            ...finalTodo,
            dueDate: "",
            startTime: "",
            endTime: "",
            scheduleState: "unplanned",
            planLocked: false,
          });
        }
        changes.push({
          operation: "schedule_todo_block",
          todoId: finalTodo.id,
          after: {
            dueDate: finalTodo.dueDate,
            startTime: finalTodo.startTime,
            endTime: finalTodo.endTime,
          },
        });
      }
      return changes.length ? validateTodoScheduleChanges(validationTodos, changes) : { feasible: true };
    }

    function applyAiCreateDraft(draft = {}) {
      const item = Array.isArray(draft.items) ? draft.items[0] : draft.item;
      if (!item) return createAiMutationFailure("todo_draft_empty", "待办草稿为空，未创建待办。");
      const todo = buildTodoFromAiDraft(item, { draftId: draft.draftId });
      const placement = draft.placement && typeof draft.placement === "object" ? draft.placement : {};
      const parentId = String(placement.parentTodoId || item.containerTodoId || "").trim();
      const anchorId = String(placement.anchorTodoId || "").trim();
      const parent = parentId ? todos.find((current) => String(current.id) === parentId && current.todoKind === "group") : null;
      const anchor = anchorId ? todos.find((current) => String(current.id) === anchorId) : null;
      if (parentId && !parent) return createAiMutationFailure("todo_parent_missing", "目标父待办不存在或已变化，请重新生成草稿。");
      if (anchorId && !anchor) return createAiMutationFailure("todo_anchor_missing", "插入位置已经变化，请重新生成草稿。");
      if (placement.anchorSnapshot && !isAiSnapshotCurrent(anchor, placement.anchorSnapshot)) {
        return createAiMutationFailure("todo_anchor_changed", "插入位置在预览后发生变化，请重新生成草稿。");
      }
      if (parent) {
        todo.containerTodoId = parent.id;
        todo.project = parent.project;
        if (isRecurringTodoRepeatMode(todo.repeat)) return createAiMutationFailure("todo_child_repeat_invalid", "子待办暂不支持重复规则。");
      }
      const hasExplicitSchedule = todo.scheduleState === "planned" && isValidDateInput(todo.dueDate) && isValidClockInput(todo.startTime) && isValidClockInput(todo.endTime);
      if (hasExplicitSchedule) {
        const validation = validateAiPlannedTodos(todos, [todo]);
        if (!validation.feasible) return createAiMutationFailure(validation.code || "schedule_invalid", validation.message || "待办时间不可用，未创建。");
        const result = commitAiTodoMutation(() => {
          todo.projectOrder = Math.max(-1, ...todos.filter((current) => (current.containerTodoId || null) === (todo.containerTodoId || null) && current.project === todo.project).map((current) => Number(current.projectOrder) || 0)) + 1;
          todos.push(todo);
        });
        if (!result.ok) return createAiMutationFailure("todo_save_failed", `保存失败，未创建待办：${result.error?.message || "本地存储异常"}`);
      } else if (parent || anchor?.todoKind === "group" || anchor?.scheduleState === "unplanned") {
        todo.scheduleState = "unplanned";
        todo.dueDate = "";
        todo.startTime = "";
        todo.endTime = "";
        todo.planLocked = false;
        todo.containerTodoId = parent?.id || anchor?.containerTodoId || null;
        if (todo.containerTodoId) todo.project = (parent || anchor).project;
        const context = prepareTodoInsertionContext(todo, anchor, { isCopy: false });
        const result = commitAiTodoMutation(() => {
          todos.push(todo);
          context.prepareGroupOrder?.(todos);
        });
        if (!result.ok) return createAiMutationFailure("todo_save_failed", `保存失败，未创建待办：${result.error?.message || "本地存储异常"}`);
      } else {
        const context = prepareTodoInsertionContext(todo, anchor, { isCopy: false });
        const result = insertTodoAfterAnchor(todo, anchor?.id || "", context);
        if (!result.feasible) return createAiMutationFailure(result.code || "schedule_no_space", result.message || "没有可用时间，未创建待办。");
      }
      setSelectedTodoId(todo.id);
      return { feasible: true, applied: 1, created: 1, updated: 0, createdIds: [todo.id], updatedIds: [], appliedIds: [todo.id], targetIds: [todo.id] };
    }

    function applyAiCopyDraft(draft = {}) {
      const resolved = getAiDraftTarget(draft);
      if (resolved.error) return resolved.error;
      const source = resolved.target;
      if (source.completed && source.todoKind !== "group") return createAiMutationFailure("todo_copy_completed", "已完成待办不能直接复制，请先恢复或新建待办。");
      const data = {};
      for (const key of copyFields) {
        if (source[key] !== undefined) data[key] = key === "tags" ? [...source.tags] : source[key];
      }
      const todo = normalizeTodo({
        ...createTodoDraft(),
        ...data,
        remainingMinutes: data.estimatedMinutes || TODO_PLAN_NEW_TODO_DURATION_MINUTES,
        planLocked: false,
        planLockExplicit: true,
        reminder: "none",
        repeat: "none",
        externalCalendarId: "",
        externalReminderId: "",
        completionEntryId: "",
        calendarSynced: false,
        reminderSynced: false,
        syncState: "dirty",
        containerTodoId: source.todoKind === "group" ? null : (source.containerTodoId || null),
        scheduleState: source.todoKind === "group" || source.scheduleState === "unplanned" ? (source.todoKind === "group" ? null : "unplanned") : "planned",
      });
      const context = prepareTodoInsertionContext(todo, source, { isCopy: true });
      if (source.todoKind === "group" || source.scheduleState === "unplanned") {
        todo.dueDate = "";
        todo.startTime = "";
        todo.endTime = "";
        const result = commitAiTodoMutation(() => {
          todos.push(todo);
          context.prepareGroupOrder?.(todos);
        });
        if (!result.ok) return createAiMutationFailure("todo_save_failed", `保存失败，未复制待办：${result.error?.message || "本地存储异常"}`);
      } else {
        const result = insertTodoAfterAnchor(todo, source.id, context);
        if (!result.feasible) return createAiMutationFailure(result.code || "schedule_no_space", result.message || "源待办之后没有可用空间，未复制。");
      }
      setSelectedTodoId(todo.id);
      return { feasible: true, applied: 1, created: 1, updated: 0, createdIds: [todo.id], updatedIds: [], appliedIds: [todo.id], targetIds: [todo.id] };
    }

    function applyAiBreakdownDraft(draft = {}) {
      const resolved = getAiDraftTarget(draft);
      if (resolved.error) return resolved.error;
      const source = resolved.target;
      const items = Array.isArray(draft.items) ? draft.items : [];
      if (!items.length) return createAiMutationFailure("todo_breakdown_empty", "拆解草稿没有子待办，未修改数据。");
      if (source.completed || (source.todoKind !== "group" && isRecurringTodoRepeatMode(source.repeat))) {
        return createAiMutationFailure("todo_breakdown_target_invalid", "已完成或重复待办暂不支持拆解。");
      }
      const nowIso = new Date().toISOString();
      let parent = source.todoKind === "group" ? source : null;
      const newChildren = [];
      let sourcePatch = null;
      const startIndex = parent ? 0 : 1;
      if (!parent) {
        const first = buildTodoFromAiDraft(items[0], { draftId: draft.draftId });
        sourcePatch = {
          title: first.title,
          estimatedMinutes: source.planLocked ? source.estimatedMinutes : first.estimatedMinutes,
          remainingMinutes: source.planLocked
            ? source.remainingMinutes
            : Math.min(Math.max(0, Number(source.remainingMinutes) || first.estimatedMinutes), first.estimatedMinutes),
          taskType: first.taskType,
          priority: first.priority,
          dependencies: first.dependencies,
          ...(first.note && !String(source.note || "").trim() ? { note: first.note } : {}),
        };
        if (!source.planLocked && isValidDateInput(String(items[0]?.dueDate || "")) && isValidClockInput(String(items[0]?.startTime || "")) && isValidClockInput(String(items[0]?.endTime || ""))) {
          Object.assign(sourcePatch, {
            scheduleState: "planned",
            dueDate: first.dueDate,
            startTime: first.startTime,
            endTime: first.endTime,
          });
        }
      }
      for (let index = startIndex; index < items.length; index += 1) {
        const child = buildTodoFromAiDraft(items[index], { draftId: draft.draftId });
        child.todoKind = "task";
        child.repeat = "none";
        child.reminder = "none";
        child.planLocked = false;
        child.planLockExplicit = false;
        child.project = source.project;
        if (source.planLocked || !isValidDateInput(String(items[index]?.dueDate || "")) || !isValidClockInput(String(items[index]?.startTime || "")) || !isValidClockInput(String(items[index]?.endTime || ""))) {
          child.scheduleState = "unplanned";
          child.dueDate = "";
          child.startTime = "";
          child.endTime = "";
        }
        newChildren.push(child);
      }
      const finalPlanned = [...newChildren];
      if (sourcePatch) finalPlanned.push({ ...source, ...sourcePatch });
      const validation = validateAiPlannedTodos(todos, finalPlanned);
      if (!validation.feasible) return createAiMutationFailure(validation.code || "schedule_invalid", validation.message || "拆解后的时间安排不可用，未修改待办。");
      const result = commitAiTodoMutation(() => {
        if (!parent) {
          parent = normalizeTodo({
            ...createTodoDraft(),
            todoKind: "group",
            title: source.title,
            note: source.note,
            project: source.project,
            category: source.category,
            tags: [...(source.tags || [])],
            priority: source.priority,
            targetDate: source.dueDate || "",
            projectOrder: source.projectOrder,
            scheduleState: null,
          });
          const orderContext = prepareTodoInsertionContext(parent, source, { isCopy: true });
          todos.push(parent);
          orderContext.prepareGroupOrder?.(todos);
          Object.assign(source, sourcePatch, {
            containerTodoId: parent.id,
            projectOrder: 0,
            updatedAt: nowIso,
          });
          markTodoPlanningDirty(source, nowIso);
        }
        const offset = Math.max(-1, ...todos.filter((current) => String(current.containerTodoId || "") === String(parent.id)).map((current) => Number(current.projectOrder) || 0)) + 1;
        newChildren.forEach((child, index) => {
          child.containerTodoId = parent.id;
          child.project = parent.project;
          child.projectOrder = offset + index;
          child.updatedAt = nowIso;
          todos.push(child);
        });
      });
      if (!result.ok) return createAiMutationFailure("todo_save_failed", `保存失败，未拆解待办：${result.error?.message || "本地存储异常"}`);
      const createdIds = [source.todoKind === "group" ? "" : parent.id, ...newChildren.map((child) => child.id)].filter(Boolean);
      const updatedIds = source.todoKind === "group" ? [source.id] : [source.id];
      const selectedId = newChildren[0]?.id || source.id;
      setSelectedTodoId(selectedId);
      return {
        feasible: true,
        applied: createdIds.length + updatedIds.length,
        created: createdIds.length,
        updated: updatedIds.length,
        createdIds,
        updatedIds,
        appliedIds: [...updatedIds, ...createdIds],
        targetIds: [parent.id, source.id, ...newChildren.map((child) => child.id)],
        parentId: parent.id,
        selectedId,
      };
    }

    function applyAiEditDraft(draft = {}) {
      const resolved = getAiDraftTarget(draft);
      if (resolved.error) return resolved.error;
      const todo = resolved.target;
      const suppliedPatch = draft.patch && typeof draft.patch === "object" && !Array.isArray(draft.patch) ? draft.patch : {};
      const patch = Object.fromEntries(Object.entries(suppliedPatch).filter(([key]) => aiEditableFields.has(key)));
      if (!Object.keys(patch).length) return createAiMutationFailure("todo_edit_empty", "没有需要修改的字段。");
      const forbiddenGroupFields = ["dueDate", "startTime", "endTime", "estimatedMinutes", "scheduleState", "planLocked", "reminder", "repeat"];
      if (todo.todoKind === "group" && forbiddenGroupFields.some((key) => Object.prototype.hasOwnProperty.call(patch, key))) {
        return createAiMutationFailure("todo_group_field_invalid", "父待办不能设置执行时间、锁定、提醒或重复规则。");
      }
      if (todo.containerTodoId && patch.repeat && isRecurringTodoRepeatMode(patch.repeat)) {
        return createAiMutationFailure("todo_child_repeat_invalid", "子待办暂不支持重复规则。");
      }
      const candidate = normalizeTodo({ ...todo, ...patch });
      if (patch.scheduleState === "unplanned") {
        candidate.scheduleState = "unplanned";
        candidate.dueDate = "";
        candidate.startTime = "";
        candidate.endTime = "";
        candidate.planLocked = false;
        candidate.reminder = "none";
      }
      if (todo.containerTodoId) {
        const parent = todos.find((current) => String(current.id) === String(todo.containerTodoId));
        if (parent) candidate.project = parent.project;
      }
      if (candidate.todoKind !== "group" && candidate.scheduleState !== "unplanned") {
        const validation = validateAiPlannedTodos(todos, [candidate]);
        if (!validation.feasible) return createAiMutationFailure(validation.code || "schedule_invalid", validation.message || "修改后的时间不可用，未修改待办。");
      }
      const oldProject = todo.project;
      const result = commitAiTodoMutation(() => {
        Object.assign(todo, candidate, { updatedAt: new Date().toISOString() });
        markTodoPlanningDirty(todo, todo.updatedAt);
        if (todo.todoKind === "group" && todo.project !== oldProject) {
          for (const child of todos.filter((current) => String(current.containerTodoId || "") === String(todo.id))) {
            child.project = todo.project;
            child.updatedAt = todo.updatedAt;
            if (!child.completed) markTodoPlanningDirty(child, todo.updatedAt);
          }
        }
      });
      if (!result.ok) return createAiMutationFailure("todo_save_failed", `保存失败，未修改待办：${result.error?.message || "本地存储异常"}`);
      setSelectedTodoId(todo.id);
      return { feasible: true, applied: 1, created: 0, updated: 1, createdIds: [], updatedIds: [todo.id], appliedIds: [todo.id], targetIds: [todo.id] };
    }

    function applyAiMoveDraft(draft = {}) {
      const resolved = getAiDraftTarget(draft);
      if (resolved.error) return resolved.error;
      const structure = draft.structure && typeof draft.structure === "object" ? { ...draft.structure } : {};
      const anchorId = String(structure.anchorTodoId || "").trim();
      if (anchorId && !Number.isInteger(structure.order)) {
        const anchor = todos.find((item) => String(item.id) === anchorId);
        if (!anchor) return createAiMutationFailure("todo_anchor_missing", "目标位置不存在或已变化，请重新生成草稿。");
        if (structure.kind === "reparent" && structure.parentId === undefined) structure.parentId = anchor.containerTodoId || "";
        if (structure.projectId === undefined) structure.projectId = anchor.project || "";
        const siblings = todos
          .filter((item) => String(item.id) !== String(resolved.target.id) && String(item.project || "") === String(structure.projectId || "") && String(item.containerTodoId || "") === String(structure.parentId || ""))
          .sort((a, b) => (Number(a.projectOrder) || 0) - (Number(b.projectOrder) || 0));
        const index = siblings.findIndex((item) => String(item.id) === anchorId);
        structure.order = index < 0 ? siblings.length : index + 1;
      }
      const moved = moveTodoStructure({
        ...structure,
        todoId: resolved.target.id,
        expectedSnapshot: draft.targetSnapshot || draft.sourceSnapshot,
        skipUserConfirm: true,
      });
      if (!moved) return createAiMutationFailure("todo_move_failed", "待办结构已变化或目标位置无效，未执行移动。");
      setSelectedTodoId(resolved.target.id);
      return { feasible: true, applied: 1, created: 0, updated: 1, createdIds: [], updatedIds: [resolved.target.id], appliedIds: [resolved.target.id], targetIds: [resolved.target.id] };
    }

    function applyAiTodoMutationDraft(draft = {}) {
      if (!commitTodoDetailIfDirty({ showValidationAlert: true, skipRender: true })) {
        return createAiMutationFailure("todo_detail_invalid", "当前详情有未通过校验的修改，请先处理后再确认 AI 草稿。");
      }
      refreshDataRefs();
      const operation = String(draft.operation || "create");
      if (operation === "create") return applyAiCreateDraft(draft);
      if (operation === "copy") return applyAiCopyDraft(draft);
      if (operation === "breakdown") return applyAiBreakdownDraft(draft);
      if (operation === "edit") return applyAiEditDraft(draft);
      if (operation === "move") return applyAiMoveDraft(draft);
      return createAiMutationFailure("todo_mutation_unsupported", "不支持的 AI 待办操作。");
    }

    function addTodoChild() {
      if (!commitTodoDetailIfDirty({ showValidationAlert: true, skipRender: true })) return false;
      refreshDataRefs();
      const selected = getSelectedTodo();
      if (!selected) return false;
      let parent = selected.containerTodoId ? todos.find((t) => t.id === selected.containerTodoId) : selected;
      if (!parent || (parent.todoKind !== "group" && (parent.completed || isRecurringTodoRepeatMode(parent.repeat)))) {
        showTodoNotice("已完成或重复待办暂不支持拆分，请新建普通待办。", true); return false;
      }
      const child = normalizeTodo({ ...createTodoDraft(), title: "新子待办", project: parent.project,
        category: parent.category, tags: [...parent.tags], scheduleState: "unplanned", planLockExplicit: true });
      const ok = commitHierarchyChange(() => {
        if (parent.todoKind !== "group") {
          const original = parent;
          parent = normalizeTodo({ ...createTodoDraft(), todoKind: "group", title: original.title,
            project: original.project, category: original.category, tags: [...original.tags], note: original.note,
            projectOrder: original.projectOrder });
          const orderContext = prepareTodoInsertionContext(parent, original, { isCopy: true });
          todos.push(parent); orderContext.prepareGroupOrder?.(todos);
          original.containerTodoId = parent.id; original.projectOrder = 0;
          original.updatedAt = new Date().toISOString();
        }
        child.containerTodoId = parent.id;
        child.projectOrder = Math.max(-1, ...todos.filter((t) => t.containerTodoId === parent.id).map((t) => Number(t.projectOrder) || 0)) + 1;
        todos.push(child);
      });
      if (!ok) return false;
      setSelectedTodoId(child.id); setActiveView("todo"); showTodoInProject(child.id); render();
      focusCreatedTodo(child.id, { editTitle: true }); return true;
    }

    function setTodoParent(parentId) {
      if (!commitTodoDetailIfDirty({ showValidationAlert: true, skipRender: true })) return false;
      refreshDataRefs(); const selected = getSelectedTodo();
      const parent = parentId ? todos.find((t) => t.id === parentId && t.todoKind === "group") : null;
      if (!selected || selected.todoKind === "group" || (parentId && !parent) || isRecurringTodoRepeatMode(selected.repeat)) {
        showTodoNotice("该待办不能加入此父项。", true); return false;
      }
      if (parent && parent.project !== selected.project && !window.confirm(`加入“${parent.title}”后，项目将改为“${parent.project || "未设置项目"}”，保留原时间。是否继续？`)) return false;
      const ok = commitHierarchyChange(() => {
        const oldProject = selected.project;
        selected.containerTodoId = parent?.id || null;
        if (parent) selected.project = parent.project;
        if (selected.project !== oldProject && !selected.completed) markTodoPlanningDirty(selected);
        selected.projectOrder = Math.max(-1, ...todos.filter((t) => t.id !== selected.id && t.project === selected.project && (t.containerTodoId || null) === selected.containerTodoId).map((t) => Number(t.projectOrder) || 0)) + 1;
        selected.updatedAt = new Date().toISOString();
      });
      if (ok) { showTodoInProject(selected.id); render(); } return ok;
    }

    function getStructureDescendantIds(todoId) {
      const childIds = todos
        .filter((item) => String(item.containerTodoId || "") === String(todoId))
        .map((item) => String(item.id));
      const ids = [];
      for (const id of childIds) {
        ids.push(id, ...getStructureDescendantIds(id));
      }
      return ids;
    }

    function normalizeStructureIdList(value) {
      const source = Array.isArray(value) ? value : [value];
      return [...new Set(source.map((item) => String(item || "").trim()).filter(Boolean))];
    }

    function assignStructureOrder(items, movingIds, requestedOrder) {
      const ordered = items.filter((item) => !movingIds.has(String(item.id)));
      const order = Number.isInteger(requestedOrder)
        ? Math.max(0, Math.min(ordered.length, requestedOrder))
        : ordered.length;
      ordered.splice(order, 0, ...items.filter((item) => movingIds.has(String(item.id))));
      ordered.forEach((item, index) => {
        if (item.projectOrder !== index) {
          item.projectOrder = index;
          item.updatedAt = new Date().toISOString();
        }
      });
    }

    function moveTodoStructure(operation = {}) {
      if (!commitTodoDetailIfDirty({ showValidationAlert: true, skipRender: true })) return false;
      refreshDataRefs();
      const structureKind = String(operation.kind || "");
      if (!["reorder", "project", "reparent"].includes(structureKind)) {
        showTodoNotice("不支持的结构操作。", true); return false;
      }
      const todo = todos.find((item) => String(item.id || "") === String(operation.todoId || ""));
      if (!todo) { showTodoNotice("待移动的待办不存在或已变化。", true); return false; }
      if (operation.expectedSnapshot && !isAiSnapshotCurrent(todo, operation.expectedSnapshot)) {
        showTodoNotice("待移动的待办在预览后发生了变化，请重新操作。", true); return false;
      }
      const oldProject = String(todo.project || "");
      const targetProject = normalizeProjectName(operation.projectId ?? operation.project ?? "");
      const targetParentId = structureKind === "reparent" ? String(operation.parentId || "") : "";
      const targetParent = targetParentId
        ? todos.find((item) => String(item.id) === targetParentId && item.todoKind === "group")
        : null;
      if (targetParentId && !targetParent) { showTodoNotice("目标父项不存在或已变化。", true); return false; }
      if (targetParent && getStructureDescendantIds(todo.id).includes(targetParent.id)) {
        showTodoNotice("父项不能嵌套到自己的子项中。", true); return false;
      }
      if (todo.todoKind === "group" && targetParent) {
        showTodoNotice("父项只能在项目根层排序或移动项目。", true); return false;
      }
      if (structureKind === "project" && todo.todoKind !== "group" && todo.containerTodoId) {
        showTodoNotice("子待办请先移出父待办，或使用父项操作调整项目。", true); return false;
      }
      if (todo.todoKind !== "group" && isRecurringTodoRepeatMode(todo.repeat) && operation.kind === "reparent") {
        showTodoNotice("重复任务暂不支持调整父项。", true); return false;
      }
      if (Array.isArray(getSelectedTodoIds?.()) &&
          normalizeStructureIdList(getSelectedTodoIds()).length > 1) {
        showTodoNotice("混合多选不能执行结构变更。", true); return false;
      }
      const descendants = targetParent ? [] : getStructureDescendantIds(todo.id);
      const hasExplicitProject = operation.projectId !== undefined && operation.projectId !== null ||
        operation.project !== undefined;
      const nextProject = structureKind === "reorder" ? oldProject
        : targetParent ? String(targetParent.project || "")
        : structureKind === "reparent" && !hasExplicitProject ? oldProject
        : targetProject;
      const projectChanged = nextProject !== oldProject;
      if (projectChanged &&
          operation.skipUserConfirm !== true &&
          !window.confirm(nextProject
            ? `项目将改为“${nextProject}”，日期和时间保持不变。是否继续？`
            : "项目将改为未设置项目，日期和时间保持不变。是否继续？")) return false;

      const beforeRefs = [...todos];
      const before = todos.map((item) => JSON.parse(JSON.stringify(item)));
      const selectedBefore = getSelectedTodoId();
      const timestampIso = new Date().toISOString();
      try {
        const apply = () => {
          if (operation.kind === "reparent") {
            todo.containerTodoId = targetParentId || null;
          }
          if (nextProject !== todo.project) {
            todo.project = nextProject;
            for (const id of descendants) {
              const child = todos.find((item) => String(item.id) === id);
              if (child) {
                child.project = nextProject;
                child.updatedAt = timestampIso;
                if (!child.completed) markTodoPlanningDirty(child, timestampIso);
              }
            }
          }
          if (!todo.completed) markTodoPlanningDirty(todo, timestampIso);
          const parentId = todo.containerTodoId || null;
          const siblingProject = parentId ? String(todo.project || "") : String(nextProject || "");
          const siblings = todos
            .filter((item) => (item.containerTodoId || null) === parentId &&
              String(item.project || "") === siblingProject)
            .sort((a, b) => (Number(a.projectOrder) || 0) - (Number(b.projectOrder) || 0));
          assignStructureOrder(siblings, new Set([String(todo.id)]), operation.order);
          saveTodos(todos, { undoBoundary: true });
        };
        if (typeof runDataTransaction === "function") runDataTransaction(apply, [todos, entries]);
        else apply();
        return true;
      } catch (error) {
        beforeRefs.forEach((item, index) => {
          Object.keys(item).forEach((key) => delete item[key]);
          Object.assign(item, before[index]);
        });
        todos.splice(0, todos.length, ...beforeRefs);
        setSelectedTodoId(selectedBefore);
        showTodoNotice(`保存失败，结构未修改：${error.message}`, true);
        return false;
      }
    }

    function dissolveTodoGroup(todoId) {
      if (!commitTodoDetailIfDirty({ showValidationAlert: true, skipRender: true })) return false;
      refreshDataRefs();
      const parent = todos.find((item) => String(item.id || "") === String(todoId || ""));
      if (!parent || parent.todoKind !== "group") { showTodoNotice("父待办不存在或已变化。", true); return false; }
      const beforeRefs = [...todos];
      const before = todos.map((item) => JSON.parse(JSON.stringify(item)));
      const selectedBefore = getSelectedTodoId();
      const timestampIso = new Date().toISOString();
      try {
        const apply = () => {
          const children = todos
            .filter((item) => String(item.containerTodoId || "") === String(parent.id))
            .sort((a, b) => (Number(a.projectOrder) || 0) - (Number(b.projectOrder) || 0));
          for (const item of children) {
            item.containerTodoId = null;
            item.updatedAt = timestampIso;
            if (!item.completed) markTodoPlanningDirty(item, timestampIso);
          }
          const childIds = new Set(children.map((item) => item.id));
          const rootSiblings = todos.filter((item) => !item.containerTodoId && !childIds.has(item.id) && String(item.project || "") === String(parent.project || ""))
            .sort((a, b) => (Number(a.projectOrder) || 0) - (Number(b.projectOrder) || 0));
          const parentIndex = rootSiblings.findIndex((item) => item.id === parent.id);
          rootSiblings.splice(Math.max(0, parentIndex), parentIndex >= 0 ? 1 : 0, ...children);
          rootSiblings.forEach((item, index) => { item.projectOrder = index; });
          deleteTodoByTaskId(parent.id);
          saveTodos(todos, { undoBoundary: true });
        };
        if (typeof runDataTransaction === "function") runDataTransaction(apply, [todos, entries]);
        else apply();
        return true;
      } catch (error) {
        beforeRefs.forEach((item, index) => {
          Object.keys(item).forEach((key) => delete item[key]);
          Object.assign(item, before[index]);
        });
        todos.splice(0, todos.length, ...beforeRefs);
        setSelectedTodoId(selectedBefore);
        showTodoNotice(`保存失败，结构未修改：${error.message}`, true);
        return false;
      }
    }

    function deleteTodoGroupWithChildren() {
      refreshDataRefs(); const parent = getSelectedTodo();
      if (!parent || parent.todoKind !== "group") return false;
      const children = todos.filter((t) => t.containerTodoId === parent.id);
      const pending = children.filter((t) => !t.completed);
      const locked = pending.filter((t) => t.planLocked).length;
      if (!window.confirm(`删除父待办和 ${pending.length} 个未完成子项${locked ? `（含 ${locked} 个锁定项）` : ""}？已完成子项和记录保留；关联日历计划将清理，可按 ⌘Z 撤销本地修改。`)) return false;
      const ok = commitHierarchyChange(() => {
        for (const child of pending) deleteTodoByTaskId(child.id, { queueRemoteDelete: true });
        deleteTodoByTaskId(parent.id); setSelectedTodoId(null);
      });
      if (ok) render(); return ok;
    }

    function pasteTodoClipboard(text) {
      const data = parseTodoClipboard(text);
      return data ? createTodoAtSelection(data) : false;
    }

    function handleTodoCreate() {
      return createTodoAtSelection();
    }

    function handleTodoCreateAfterSelected() {
      return handleTodoCreate();
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
      if (!selected || selected.todoKind === "group" || selected.scheduleState === "unplanned" || selected.completed) return;
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
      const started = pomodoroModule.beginLinkedSession({
        todoId: todo.id,
        category: categories.includes(resolvedCategory) ? resolvedCategory : (categories[0] || "工作"),
        minutes: sessionDurationMinutes,
        startedAt: now,
      });
      if (started) revealPomodoro();
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

      if (targetIndices.some((i) => todos[i].todoKind === "group" || todos[i].containerTodoId)) {
        const count = targetIndices.length;
        const ok = commitHierarchyChange(() => {
          for (const id of selectedIds) deleteTodoByTaskId(id, { queueRemoteDelete: true });
          setSelectedTodoId(null);
        });
        if (ok) render(); return ok ? count : 0;
      }
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

      if (target.todoKind === "group") {
        for (const child of todos.filter((t) => t.containerTodoId === target.id)) {
          child.containerTodoId = null; child.updatedAt = timestampIso;
        }
        todos.splice(index, 1); return true;
      }
      const deletedDueDate = String(target.dueDate || "").trim();
      const deletedCompleted = Boolean(target.completed);
      const deletedIndex =
        !deletedCompleted && isValidDateInput(deletedDueDate)
          ? getIncompleteTodosByDate(deletedDueDate).findIndex((item) => String(item.id) === String(target.id))
          : -1;

      const deletionSnapshot = { ...target };
      const queueDeletes = () => {
        if (queueRemoteDelete) enqueueTodoCalendarDelete(deletionSnapshot, timestampIso);
        if (!deletionSnapshot.completed) enqueueTodoReminderDisable(deletionSnapshot, timestampIso);
      };
      if (!deferDataEffect(queueDeletes)) queueDeletes();

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
      if (selected?.containerTodoId && (next.project !== selected.project || isRecurringTodoRepeatMode(next.repeat))) {
        showTodoNotice("子待办需与父项共用项目，且暂不支持重复规则。", true); return false;
      }
      if (selected && (selected.todoKind === "group" || (!selected.completed && (selected.containerTodoId || selected.scheduleState === "unplanned")))) {
        const group = selected.todoKind === "group";
        if (selected.containerTodoId && next.project !== selected.project) {
          showTodoNotice("子待办与父项共用项目，请修改父项项目或先移出父项。", true); return false;
        }
        if (!group && isRecurringTodoRepeatMode(next.repeat)) {
          showTodoNotice("子待办首版不支持重复规则。", true); return false;
        }
        if (!group && todoDetailModule.isPlanLockTouched()) next.planLockExplicit = true;
        let candidate;
        if (group) candidate = normalizeTodo({ ...selected, ...next, targetDate: next.dueDate });
        else if (!next.dueDate) {
          if (selected.planLocked) { showTodoNotice("请先解除锁定再取消排期。", true); return false; }
          candidate = normalizeTodo({ ...selected, ...next, scheduleState: "unplanned" });
        } else {
          const resolved = resolveTodoTimeInputForSubmit(selected, next);
          if (!resolved.ok) { showTodoNotice(resolved.message, true); return false; }
          candidate = normalizeTodo({ ...selected, ...next, ...resolved, scheduleState: "planned" });
          if (!selected.completed) {
            const check = validateTodoEdit(selected, candidate);
            if (!check.feasible) { showTodoNotice(check.message, true); return false; }
          }
        }
        const ok = commitHierarchyChange(() => {
          Object.assign(selected, candidate, { updatedAt: new Date().toISOString() });
          if (!group && !selected.completed) markTodoPlanningDirty(selected);
          if (group) for (const child of todos.filter((t) => t.containerTodoId === selected.id)) {
            if (child.project !== selected.project) { child.project = selected.project; child.updatedAt = selected.updatedAt;
              if (!child.completed) markTodoPlanningDirty(child); }
          }
        });
        if (!ok) return false;
        todoDetailModule.clearSubmitState(); if (!skipRender) render(); return true;
      }
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

      // A lock toggle only changes protection; it must not reschedule the day.
      if (!selected.completed && timeChanged && isValidDateInput(selected.dueDate)) {
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
        if (!todo.completed || todo.todoKind === "group") continue;
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
      if (!todo || todo.todoKind === "group") return;
      if (!skipLinkedPomodoroInterception && pomodoroModule.hasLinkedTodoProgress(todo.id)) {
        void pomodoroModule.finish({ forcedAction: "complete" });
        return;
      }

      if (typeof runDataTransaction !== "function") throw new Error("待办保存保护模块不可用，未修改数据。");
      return runDataTransaction(() => completeTodoWithPersistence(todo, requestedCompletionWindow), [todos, entries]);
    }

    function completeTodoWithPersistence(todo, requestedCompletionWindow) {
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
          const sync = () => { void syncRecurringTodoReminderNow(String(todo.id || "")); };
          if (!deferDataEffect(sync)) sync();
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
          todo.scheduleState = "planned";
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
      addTodoChild,
      applyAiTodoMutationDraft,
      deleteTodoGroupWithChildren,
      dissolveTodoGroup,
      setTodoParent,
      moveTodoStructure,
      handleTodoCreate,
      handleTodoCreateAfterSelected,
      serializeSelectedTodo,
      parseTodoClipboard,
      pasteTodoClipboard,
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
