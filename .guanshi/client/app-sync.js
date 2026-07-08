(function attachTimeQualitySyncModule(globalScope) {
  if (!globalScope) return;

  function requireFunction(deps, key) {
    const value = deps[key];
    if (typeof value !== "function") {
      throw new Error(`TimeQualitySyncModule missing required function dependency: ${key}`);
    }
    return value;
  }

  function createSyncModule(deps = {}) {
    const createTodoSyncBridgeModule = requireFunction(deps, "createTodoSyncBridgeModule");
    const getSyncCalendarTargetPayload = requireFunction(deps, "getSyncCalendarTargetPayload");
    const getTodoCategory = requireFunction(deps, "getTodoCategory");
    const isValidDateInput = requireFunction(deps, "isValidDateInput");
    const isValidClockInput = requireFunction(deps, "isValidClockInput");
    const normalizeScoreForInput = requireFunction(deps, "normalizeScoreForInput");
    const buildTodoCalendarNote = requireFunction(deps, "buildTodoCalendarNote");
    const deleteTodoByTaskId = requireFunction(deps, "deleteTodoByTaskId");
    const hasDirtyLocalChanges = requireFunction(deps, "hasDirtyLocalChanges");
    const saveTodos = requireFunction(deps, "saveTodos");
    const render = requireFunction(deps, "render");
    const setCalendarSyncStatus = requireFunction(deps, "setCalendarSyncStatus");
    const getTodos = requireFunction(deps, "getTodos");
    const normalizeTodoOrderByClockForDate =
      typeof deps.normalizeTodoOrderByClockForDate === "function"
        ? deps.normalizeTodoOrderByClockForDate
        : null;

    const EXTERNAL_TASK_PULL_URL = String(deps.EXTERNAL_TASK_PULL_URL || "").trim();
    const EXTERNAL_CALENDAR_PUSH_URL = String(deps.EXTERNAL_CALENDAR_PUSH_URL || "").trim();

    function resolveFetch() {
      if (typeof deps.fetchFn === "function") return deps.fetchFn;
      if (typeof globalScope.fetch === "function") return globalScope.fetch.bind(globalScope);
      throw new Error("Fetch API is unavailable in current runtime.");
    }

    function isStaleRemoteTodoUpdate(todo, remote) {
      if (String(todo?.syncState || "").trim() !== "synced") return false;
      if (hasDirtyLocalChanges(todo)) return false;
      const syncedMs = Date.parse(String(todo?.syncedAt || "").trim());
      const remoteModifiedMs = Date.parse(String(remote?.modifiedAt || "").trim());
      if (!Number.isFinite(syncedMs) || !Number.isFinite(remoteModifiedMs)) return false;
      return remoteModifiedMs < syncedMs;
    }

    async function pullTodosFromMacCalendar({ manual = false, triggerExport = true } = {}) {
      const todos = getTodos();
      const fetchFn = resolveFetch();
      let response = null;
      try {
        response = await fetchFn(EXTERNAL_TASK_PULL_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            triggerExport,
            todos,
            targetCalendar: getSyncCalendarTargetPayload(),
          }),
        });
      } catch {
        throw new Error("无法连接本地同步服务，请先运行 node server.js。");
      }

      if (response.status === 404 || response.status === 405) {
        return { updated: 0, deleted: 0, conflicts: 0, unmatched: 0, fallback: true };
      }

      let data = null;
      try {
        data = await response.json();
      } catch {
        data = null;
      }

      if (!response.ok || !data?.ok) {
        const detail = String(data?.message || data?.error || `HTTP_${response.status || 500}`);
        throw new Error(detail);
      }

      const result = data?.result || {};
      const updates = Array.isArray(result.updates) ? result.updates : [];
      const conflicts = Array.isArray(result.conflicts) ? result.conflicts : [];
      const deleted = Array.isArray(result.deleted) ? result.deleted : [];
      const pulledAt = String(result.generatedAt || new Date().toISOString());
      let updated = 0;
      let conflictCount = 0;
      let deletedCount = 0;
      const touchedDates = new Set();

      for (const item of updates) {
        const todo = todos.find((entry) => String(entry.id) === String(item.taskId || ""));
        if (!todo) continue;

        const remote = item.remote || {};
        const remoteTitle = String(remote.title || "").trim();
        const remoteDate = String(remote.dueDate || "").trim();
        const remoteStart = String(remote.startTime || "").trim();
        const remoteEnd = String(remote.endTime || "").trim();
        const remoteNote = String(remote.note ?? "").trim();
        const remoteExternalId = String(remote.externalCalendarId || "").trim();

        if (isStaleRemoteTodoUpdate(todo, remote)) {
          continue;
        }

        if (remoteTitle) {
          todo.title = remoteTitle;
        }
        if (isValidDateInput(remoteDate)) {
          todo.dueDate = remoteDate;
        }
        if (isValidClockInput(remoteStart)) {
          todo.startTime = remoteStart;
        }
        if (isValidClockInput(remoteEnd)) {
          todo.endTime = remoteEnd;
        }
        if (Object.prototype.hasOwnProperty.call(remote, "note")) {
          todo.note = remoteNote;
        }
        if (Number.isInteger(remote.qualityScore)) {
          todo.qualityScore = normalizeScoreForInput(remote.qualityScore);
        }
        if (Number.isInteger(remote.happinessScore)) {
          todo.happinessScore = normalizeScoreForInput(remote.happinessScore);
        }
        if (remoteExternalId) {
          todo.externalCalendarId = remoteExternalId;
        }

        todo.calendarSynced = true;
        todo.syncState = "synced";
        todo.lastSyncError = "";
        todo.syncedAt = pulledAt;
        todo.updatedAt = pulledAt;
        if (isValidDateInput(todo.dueDate)) {
          touchedDates.add(String(todo.dueDate));
        }
        updated += 1;
      }

      for (const item of conflicts) {
        const todo = todos.find((entry) => String(entry.id) === String(item.taskId || ""));
        if (!todo) continue;
        todo.calendarSynced = false;
        todo.syncState = "conflict";
        todo.lastSyncError = "检测到本地与日历冲突，请手动确认后再同步。";
        conflictCount += 1;
      }

      for (const item of deleted) {
        const taskId = String(item?.taskId || "").trim();
        if (!taskId) continue;
        const todo = todos.find((entry) => String(entry.id) === taskId);
        if (!todo) continue;
        if (todo.completed) continue;
        if (todo.syncState !== "synced") continue;
        if (hasDirtyLocalChanges(todo)) continue;
        const removed = deleteTodoByTaskId(taskId, { queueRemoteDelete: false, timestampIso: pulledAt });
        if (removed) {
          deletedCount += 1;
        }
      }

      let orderNormalized = false;
      if (normalizeTodoOrderByClockForDate && touchedDates.size > 0) {
        for (const date of touchedDates) {
          if (normalizeTodoOrderByClockForDate(date)) {
            orderNormalized = true;
          }
        }
      }

      if (updated > 0 || conflictCount > 0 || deletedCount > 0 || orderNormalized) {
        saveTodos(todos, { skipSyncSchedule: true, skipUndoSnapshot: true });
        render();
      }

      if (manual && conflictCount > 0) {
        setCalendarSyncStatus(`检测到 ${conflictCount} 项待办冲突，请在待办中确认。`, "warning");
      }

      return {
        updated,
        deleted: deletedCount,
        conflicts: conflictCount,
        unmatched: Number(result.unmatched || 0),
        fallback: false,
      };
    }

    async function pushCalendarEventPayload(payload) {
      const fetchFn = resolveFetch();
      const syncTarget = getSyncCalendarTargetPayload();
      const requestPayload = {
        ...payload,
        calendarId: String(payload?.calendarId || syncTarget.calendarId || ""),
        calendarName: String(payload?.calendarName || syncTarget.calendarName || ""),
      };

      let response = null;
      try {
        response = await fetchFn(EXTERNAL_CALENDAR_PUSH_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestPayload),
        });
      } catch {
        throw new Error("无法连接本地同步服务，请先运行 node server.js。");
      }

      let data = null;
      try {
        data = await response.json();
      } catch {
        data = null;
      }

      if (!response.ok || !data?.ok) {
        const detail = String(data?.message || data?.error || `HTTP_${response.status || 500}`);
        throw new Error(detail);
      }

      return data;
    }

    async function pushTodoToMacCalendar({ todo, date, start, end }) {
      const syncTarget = getSyncCalendarTargetPayload();
      const payload = {
        title: String(todo.title || "待办事项").trim(),
        date,
        start,
        end,
        category: getTodoCategory(todo, todo.project),
        quality: normalizeScoreForInput(todo.qualityScore),
        happiness: normalizeScoreForInput(todo.happinessScore),
        sourceId: String(todo.id || ""),
        note: buildTodoCalendarNote(todo),
        calendarId: String(syncTarget.calendarId || ""),
        calendarName: String(syncTarget.calendarName || ""),
      };

      return pushCalendarEventPayload(payload);
    }

    const todoSyncBridgeModule = createTodoSyncBridgeModule({
      ...deps,
      pushCalendarEventPayload,
    });

    return {
      buildTodoSyncRequest: todoSyncBridgeModule.buildTodoSyncRequest,
      buildTodoReminderSyncRequest: todoSyncBridgeModule.buildTodoReminderSyncRequest,
      buildTodoReminderCompleteRequest: todoSyncBridgeModule.buildTodoReminderCompleteRequest,
      syncTodoTasksByLegacyPushApi: todoSyncBridgeModule.syncTodoTasksByLegacyPushApi,
      syncTodoTasksToMacCalendar: todoSyncBridgeModule.syncTodoTasksToMacCalendar,
      deleteTodoTasksFromMacCalendar: todoSyncBridgeModule.deleteTodoTasksFromMacCalendar,
      syncTodoTasksToMacReminders: todoSyncBridgeModule.syncTodoTasksToMacReminders,
      completeTodoTasksInMacReminders: todoSyncBridgeModule.completeTodoTasksInMacReminders,
      applyTodoTaskSyncItems: todoSyncBridgeModule.applyTodoTaskSyncItems,
      applyTodoReminderSyncItems: todoSyncBridgeModule.applyTodoReminderSyncItems,
      applyTodoReminderCompleteItems: todoSyncBridgeModule.applyTodoReminderCompleteItems,
      pullTodosFromMacCalendar,
      pushCalendarEventPayload,
      pushTodoToMacCalendar,
      normalizeTodoCalendarDeleteItem: todoSyncBridgeModule.normalizeTodoCalendarDeleteItem,
      loadTodoCalendarDeleteQueue: todoSyncBridgeModule.loadTodoCalendarDeleteQueue,
      saveTodoCalendarDeleteQueue: todoSyncBridgeModule.saveTodoCalendarDeleteQueue,
      enqueueTodoCalendarDelete: todoSyncBridgeModule.enqueueTodoCalendarDelete,
      buildTodoDeleteSyncRequests: todoSyncBridgeModule.buildTodoDeleteSyncRequests,
      applyTodoTaskDeleteSyncItems: todoSyncBridgeModule.applyTodoTaskDeleteSyncItems,
      buildTodoReminderDisableSyncRequestsFromQueue:
        todoSyncBridgeModule.buildTodoReminderDisableSyncRequestsFromQueue,
      applyQueuedTodoReminderDisableSyncItems: todoSyncBridgeModule.applyQueuedTodoReminderDisableSyncItems,
    };
  }

  const existing = globalScope.TimeQualitySyncModule || {};
  globalScope.TimeQualitySyncModule = {
    ...existing,
    createSyncModule,
  };
})(typeof window !== "undefined" ? window : globalThis);
