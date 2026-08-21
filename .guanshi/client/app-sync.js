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
    const isTodoOverdue = typeof deps.isTodoOverdue === "function" ? deps.isTodoOverdue : () => false;
    const normalizeTodoOrderByClockForDate =
      typeof deps.normalizeTodoOrderByClockForDate === "function"
        ? deps.normalizeTodoOrderByClockForDate
        : null;

    const EXTERNAL_TASK_PULL_URL = String(deps.EXTERNAL_TASK_PULL_URL || "").trim();
    const EXTERNAL_CALENDAR_PUSH_URL = String(deps.EXTERNAL_CALENDAR_PUSH_URL || "").trim();
    const REMOTE_DELETE_COUNT_GUARD = 5;
    const REMOTE_DELETE_RATIO_GUARD = 0.2;

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

    function countRemoteDeleteEligibleTodos(todos) {
      return todos.filter((todo) => {
        if (!todo || typeof todo !== "object") return false;
        if (todo.completed) return false;
        if (isTodoOverdue(todo)) return false;
        if (String(todo.syncState || "").trim() !== "synced") return false;
        if (!String(todo.externalCalendarId || "").trim()) return false;
        return !hasDirtyLocalChanges(todo);
      }).length;
    }

    function resolveRemoteDeleteGuard({ manual, candidates, filteredEvents, todos }) {
      const candidateCount = Array.isArray(candidates) ? candidates.length : 0;
      const syncedTodoCount = countRemoteDeleteEligibleTodos(Array.isArray(todos) ? todos : []);
      const missingRatio = syncedTodoCount > 0 ? candidateCount / syncedTodoCount : 0;

      if (candidateCount === 0) {
        return { blocked: false, reason: "", candidateCount, syncedTodoCount, missingRatio };
      }
      if (!manual) {
        return { blocked: true, reason: "automatic-sync", candidateCount, syncedTodoCount, missingRatio };
      }
      if (!Number.isFinite(Number(filteredEvents)) || Number(filteredEvents) <= 0) {
        return { blocked: true, reason: "empty-export", candidateCount, syncedTodoCount, missingRatio };
      }
      if (candidateCount >= REMOTE_DELETE_COUNT_GUARD || missingRatio >= REMOTE_DELETE_RATIO_GUARD) {
        return { blocked: true, reason: "suspicious-volume", candidateCount, syncedTodoCount, missingRatio };
      }
      return { blocked: false, reason: "", candidateCount, syncedTodoCount, missingRatio };
    }

    function formatRemoteDeleteGuardMessage(guard) {
      if (!guard?.blocked) return "";
      if (guard.reason === "automatic-sync") {
        return `自动同步发现 ${guard.candidateCount} 个 Calendar 远端缺失待办，已保留本地数据。`;
      }
      if (guard.reason === "empty-export") {
        return `Calendar 本次未读取到目标日历事件，已阻止删除 ${guard.candidateCount} 个本地待办。`;
      }
      const ratio = Math.round(Number(guard.missingRatio || 0) * 100);
      return `检测到异常同步：${guard.candidateCount}/${guard.syncedTodoCount} 个已同步待办在 Calendar 中缺失（${ratio}%），已停止删除。`;
    }

    async function pullTodosFromMacCalendar({ manual = false, triggerExport = true } = {}) {
      const todos = getTodos();
      const activeTodos = todos.filter((todo) => !todo?.completed && !isTodoOverdue(todo));
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
            todos: activeTodos,
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
      const remoteDeleteGuard = resolveRemoteDeleteGuard({
        manual,
        candidates: deleted,
        filteredEvents: result.filteredEvents,
        todos: activeTodos,
      });
      const pulledAt = String(result.generatedAt || new Date().toISOString());
      let updated = 0;
      let conflictCount = 0;
      let deletedCount = 0;
      const touchedDates = new Set();

      for (const item of updates) {
        const todo = todos.find((entry) => String(entry.id) === String(item.taskId || ""));
        if (!todo) continue;
        if (todo.completed) continue;
        if (isTodoOverdue(todo)) continue;

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
        if (todo.completed) continue;
        if (isTodoOverdue(todo)) continue;
        todo.calendarSynced = false;
        todo.syncState = "conflict";
        todo.lastSyncError = "检测到本地与日历冲突，请手动确认后再同步。";
        conflictCount += 1;
      }

      if (!remoteDeleteGuard.blocked) {
        for (const item of deleted) {
          const taskId = String(item?.taskId || "").trim();
          if (!taskId) continue;
          const todo = todos.find((entry) => String(entry.id) === taskId);
          if (!todo) continue;
          if (isTodoOverdue(todo)) continue;
          if (todo.completed) continue;
          if (todo.syncState !== "synced") continue;
          if (hasDirtyLocalChanges(todo)) continue;
          const removed = deleteTodoByTaskId(taskId, { queueRemoteDelete: false, timestampIso: pulledAt });
          if (removed) {
            deletedCount += 1;
          }
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

      if (remoteDeleteGuard.blocked) {
        setCalendarSyncStatus(formatRemoteDeleteGuardMessage(remoteDeleteGuard), "warning");
      } else if (manual && conflictCount > 0) {
        setCalendarSyncStatus(`检测到 ${conflictCount} 项待办冲突，请在待办中确认。`, "warning");
      }

      return {
        updated,
        deleted: deletedCount,
        conflicts: conflictCount,
        conflictItems: conflicts.map((item) => ({
          taskId: String(item?.taskId || ""),
          changedFields: Array.isArray(item?.changedFields) ? [...item.changedFields] : [],
          remote: item?.remote && typeof item.remote === "object" ? { ...item.remote } : {},
        })),
        unmatched: Number(result.unmatched || 0),
        fallback: false,
        deleteCandidates: remoteDeleteGuard.candidateCount,
        deleteItems: deleted.map((item) => ({
          taskId: String(item?.taskId || ""),
          externalCalendarId: String(item?.externalCalendarId || item?.eventId || ""),
        })),
        deleteBlocked: remoteDeleteGuard.blocked,
        deleteBlockReason: remoteDeleteGuard.reason,
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
