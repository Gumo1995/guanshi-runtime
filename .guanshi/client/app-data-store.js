/* global window */

(function attachDataStoreModule(globalScope) {
  "use strict";

  function assertFunction(name, value) {
    if (typeof value !== "function") {
      throw new Error(`TimeQualityDataStoreModule requires dependency: ${name}`);
    }
  }

  function createDataStoreModule(deps = {}) {
    const {
      STORAGE_KEY = "time_quality_journal_v1",
      TODO_STORAGE_KEY = "time_quality_todos_v1",
      TODO_REMINDER_DISABLE_QUEUE_STORAGE_KEY = "time_quality_todo_reminder_disable_queue_v1",
      SIDEBAR_WIDTH_STORAGE_KEY = "time_quality_sidebar_width_v1",
      SIDEBAR_COLLAPSED_STORAGE_KEY = "time_quality_sidebar_collapsed_v1",
      TODO_DETAIL_WIDTH_STORAGE_KEY = "time_quality_todo_detail_width_v1",
      EXTERNAL_CALENDAR_IGNORED_KEY = "time_quality_calendar_ignored_v1",
      CACHE_RESET_ONCE_KEY = "time_quality_cache_reset_once_v2",
      QUOTE_LIBRARY_KEY = "time_quality_quote_library_v1",
      QUOTE_POOL_KEY = "time_quality_quote_pool_v1",
      TODO_DELETE_QUEUE_STORAGE_KEY = "time_quality_todo_delete_queue_v1",
      CALENDAR_SAMPLE_16_SEEDED_KEY = "time_quality_calendar_sample_16_seeded_v2",
      SIDEBAR_MIN_WIDTH = 220,
      SIDEBAR_MAX_WIDTH = 420,
      TODO_DETAIL_MIN_WIDTH = 320,
      TODO_DETAIL_MAX_WIDTH = 640,
      TODO_PROJECT_LEVEL_SEPARATOR = " / ",
      localStorageRef = globalScope.localStorage || null,
      normalizeTodo,
      normalizeProjectName,
      commitUndoSnapshot,
      scheduleAutoBidirectionalSync,
      scheduleLocalDataBackup = () => {},
      getIsApplyingUndo = () => false,
      getPendingTodoReminderDisables = () => [],
      setPendingTodoReminderDisables = () => {},
    } = deps;

    [
      ["normalizeTodo", normalizeTodo],
      ["normalizeProjectName", normalizeProjectName],
      ["commitUndoSnapshot", commitUndoSnapshot],
      ["scheduleAutoBidirectionalSync", scheduleAutoBidirectionalSync],
      ["scheduleLocalDataBackup", scheduleLocalDataBackup],
      ["getIsApplyingUndo", getIsApplyingUndo],
      ["getPendingTodoReminderDisables", getPendingTodoReminderDisables],
      ["setPendingTodoReminderDisables", setPendingTodoReminderDisables],
    ].forEach(([name, value]) => assertFunction(name, value));

    // A write-ahead rollback record protects the two existing storage keys.
    // It deliberately lives outside the exportable time_quality_* namespace.
    const completionRecoveryKey = "guanshi_pending_completion_transaction_v1";
    let dataTransaction = null;

    function recoverDataTransaction() {
      const raw = localStorageRef.getItem(completionRecoveryKey);
      if (!raw) return;
      const record = JSON.parse(raw);
      const keys = [STORAGE_KEY, TODO_STORAGE_KEY];
      if (record.schema !== 1 || !record.before || keys.some((key) =>
        record.before[key] !== null && typeof record.before[key] !== "string")) {
        throw new Error("待办保存恢复记录无效，请勿继续编辑，请从本地备份恢复。");
      }
      for (const key of keys) {
        const value = record.before[key];
        if (localStorageRef.getItem(key) === value) continue;
        if (value === null) localStorageRef.removeItem(key);
        else localStorageRef.setItem(key, value);
      }
      localStorageRef.removeItem(completionRecoveryKey);
    }

    function deferDataEffect(effect) {
      if (!dataTransaction) return false;
      dataTransaction.effects.push(effect);
      return true;
    }

    function runDataTransaction(operation, collections) {
      // A caller such as Pomodoro may already protect the same completion chain.
      if (dataTransaction) return operation();
      recoverDataTransaction();
      const snapshots = collections.map((items) => ({
        items, refs: [...items], values: JSON.parse(JSON.stringify(items)),
      }));
      const transaction = { writes: new Map(), effects: [], sync: false, undo: false };
      dataTransaction = transaction;
      let result;
      let journalWritten = false;
      try {
        result = operation();
        if (result && typeof result.then === "function") throw new Error("待办保存操作必须同步完成。");
        if (transaction.writes.size) {
          const before = Object.fromEntries([STORAGE_KEY, TODO_STORAGE_KEY].map((key) => [key, localStorageRef.getItem(key)]));
          localStorageRef.setItem(completionRecoveryKey, JSON.stringify({ schema: 1, before }));
          journalWritten = true;
          for (const [key, value] of transaction.writes) localStorageRef.setItem(key, value);
          localStorageRef.removeItem(completionRecoveryKey);
          journalWritten = false;
        }
      } catch (cause) {
        let recoveryError = null;
        if (journalWritten) {
          try { recoverDataTransaction(); } catch (error) { recoveryError = error; }
        }
        for (const { items, refs, values } of snapshots) {
          refs.forEach((item, index) => {
            Object.keys(item).forEach((key) => delete item[key]);
            Object.assign(item, values[index]);
          });
          items.splice(0, items.length, ...refs);
        }
        const error = new Error(recoveryError
          ? "保存失败，恢复尚未完成。请释放浏览器存储空间后刷新，恢复完成前请勿继续编辑。"
          : "保存失败，本次修改已撤回，请释放浏览器存储空间后重试。");
        error.code = recoveryError ? "TODO_SAVE_RECOVERY_REQUIRED" : "TODO_SAVE_FAILED";
        error.cause = cause;
        throw error;
      } finally {
        dataTransaction = null;
      }
      // Persistence is committed. Presentation failures must never roll it back.
      const effects = transaction.writes.size ? [
        () => scheduleLocalDataBackup("todo-completion-save"),
        () => { if (transaction.sync) scheduleAutoBidirectionalSync("todo-completion-save"); },
        () => { if (transaction.undo) commitUndoSnapshot({ separate: true }); },
        ...transaction.effects,
      ] : transaction.effects;
      for (const effect of effects) {
        try { effect(); } catch (error) { globalScope.console?.error("待办已保存，后续刷新失败", error); }
      }
      return result;
    }

    function runOneTimeCacheResetIfNeeded() {
      if (!localStorageRef) return;
      try {
        if (localStorageRef.getItem(CACHE_RESET_ONCE_KEY) === "1") {
          return;
        }
        // Keep existing user data if storage already has real content.
        const hasExistingData =
          Boolean(localStorageRef.getItem(STORAGE_KEY))
          || Boolean(localStorageRef.getItem(TODO_STORAGE_KEY))
          || Boolean(localStorageRef.getItem(QUOTE_LIBRARY_KEY))
          || Boolean(localStorageRef.getItem(QUOTE_POOL_KEY));
        if (hasExistingData) {
          localStorageRef.setItem(CACHE_RESET_ONCE_KEY, "1");
          return;
        }
        const keysToClear = [
          STORAGE_KEY,
          TODO_STORAGE_KEY,
          TODO_DELETE_QUEUE_STORAGE_KEY,
          QUOTE_POOL_KEY,
          EXTERNAL_CALENDAR_IGNORED_KEY,
          CALENDAR_SAMPLE_16_SEEDED_KEY,
        ];
        for (const key of keysToClear) {
          localStorageRef.removeItem(key);
        }
        localStorageRef.setItem(CACHE_RESET_ONCE_KEY, "1");
      } catch {
        // ignore storage failures
      }
    }

    function normalizeTodoReminderDisableItem(raw) {
      const item = raw && typeof raw === "object" ? raw : {};
      const reminderId = String(item.reminderId || "").trim().slice(0, 240);
      if (!reminderId) return null;

      const taskId = String(item.taskId || "").trim().slice(0, 120);
      const queueIdRaw = String(item.queueId || taskId || "").trim();
      const queueIdFallback = `reminder_disable_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const queueId = (queueIdRaw || queueIdFallback).slice(0, 220);
      const createdMs = Date.parse(String(item.createdAt || ""));
      const createdAt = Number.isFinite(createdMs) ? new Date(createdMs).toISOString() : new Date().toISOString();

      return {
        queueId,
        taskId: taskId || queueId,
        reminderId,
        createdAt,
      };
    }

    function loadTodoReminderDisableQueue() {
      try {
        const raw = localStorageRef.getItem(TODO_REMINDER_DISABLE_QUEUE_STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.map(normalizeTodoReminderDisableItem).filter(Boolean);
      } catch {
        return [];
      }
    }

    function saveTodoReminderDisableQueue(value) {
      const normalized = Array.isArray(value)
        ? value.map(normalizeTodoReminderDisableItem).filter(Boolean)
        : [];
      setPendingTodoReminderDisables(normalized);
      try {
        localStorageRef.setItem(TODO_REMINDER_DISABLE_QUEUE_STORAGE_KEY, JSON.stringify(normalized));
        scheduleLocalDataBackup("todo-reminder-disable-queue-save");
      } catch {
        // ignore storage failures
      }
      return normalized;
    }

    function enqueueTodoReminderDisable(todo, timestampIso = new Date().toISOString()) {
      if (!todo || todo.completed) return false;
      const reminderId = String(todo.externalReminderId || "").trim();
      if (!reminderId) return false;

      const taskId = String(todo.id || "").trim() || `todo_deleted_${Date.now()}`;
      const queueId = `reminder_disable:${taskId}:${reminderId}`.slice(0, 220);
      const timestampMs = Date.parse(String(timestampIso || ""));
      const createdAt = Number.isFinite(timestampMs) ? new Date(timestampMs).toISOString() : new Date().toISOString();
      const queue = getPendingTodoReminderDisables();
      const next = Array.isArray(queue) ? [...queue] : [];
      const record = normalizeTodoReminderDisableItem({
        queueId,
        taskId,
        reminderId,
        createdAt,
      });
      if (!record) return false;

      const existingIndex = next.findIndex((item) => String(item.reminderId || "") === reminderId);
      if (existingIndex >= 0) {
        next.splice(existingIndex, 1, record);
      } else {
        next.push(record);
      }
      saveTodoReminderDisableQueue(next);
      return true;
    }

    function loadTodos() {
      try {
        const raw = localStorageRef.getItem(TODO_STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.map(normalizeTodo);
      } catch {
        return [];
      }
    }

    function loadCollapsedProjectPathSet(storageKey) {
      try {
        const raw = localStorageRef.getItem(storageKey);
        if (!raw) return new Set();
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return new Set();
        const normalized = parsed
          .map((item) => normalizeProjectName(item))
          .filter(Boolean);
        return new Set(normalized);
      } catch {
        return new Set();
      }
    }

    function saveCollapsedProjectPathSet(storageKey, valueSet) {
      const values = Array.from(valueSet || [])
        .map((item) => normalizeProjectName(item))
        .filter(Boolean);
      localStorageRef.setItem(storageKey, JSON.stringify(values));
    }

    function toggleCollapsedProjectPath(pathSet, storageKey, path) {
      const normalizedPath = normalizeProjectName(path);
      if (!normalizedPath) return;
      if (pathSet.has(normalizedPath)) {
        pathSet.delete(normalizedPath);
      } else {
        pathSet.add(normalizedPath);
      }
      saveCollapsedProjectPathSet(storageKey, pathSet);
    }

    function saveTodos(value, options = {}) {
      if (dataTransaction) {
        dataTransaction.writes.set(TODO_STORAGE_KEY, JSON.stringify(value.map(normalizeTodo)));
        dataTransaction.sync ||= !options.skipSyncSchedule && !getIsApplyingUndo();
        dataTransaction.undo ||= !options.skipUndoSnapshot;
        return;
      }
      recoverDataTransaction();
      const skipSyncSchedule = Boolean(options && options.skipSyncSchedule);
      const skipUndoSnapshot = Boolean(options && options.skipUndoSnapshot);
      localStorageRef.setItem(TODO_STORAGE_KEY, JSON.stringify(value.map(normalizeTodo)));
      scheduleLocalDataBackup("todos-save");
      if (!skipSyncSchedule && !getIsApplyingUndo()) {
        scheduleAutoBidirectionalSync("todos-save");
      }
      if (!skipUndoSnapshot) {
        commitUndoSnapshot({ separate: Boolean(options?.undoBoundary) });
      }
    }

    function loadSidebarWidth() {
      try {
        const raw = localStorageRef.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
        const parsed = Number.parseFloat(String(raw || ""));
        if (!Number.isFinite(parsed)) return 288;
        return clampSidebarWidth(parsed);
      } catch {
        return 288;
      }
    }

    function saveSidebarWidth(width) {
      localStorageRef.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(clampSidebarWidth(width)));
    }

    function clampSidebarWidth(width) {
      const parsed = Number(width);
      if (!Number.isFinite(parsed)) return 288;
      return Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, parsed));
    }

    function loadSidebarCollapsed() {
      try {
        return localStorageRef.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "1";
      } catch {
        return false;
      }
    }

    function saveSidebarCollapsed(value) {
      try {
        localStorageRef.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, value ? "1" : "0");
      } catch {
        // ignore storage failures
      }
    }

    function loadTodoDetailWidth() {
      try {
        const raw = localStorageRef.getItem(TODO_DETAIL_WIDTH_STORAGE_KEY);
        const parsed = Number.parseFloat(String(raw || ""));
        if (!Number.isFinite(parsed)) return 430;
        return clampTodoDetailWidth(parsed);
      } catch {
        return 430;
      }
    }

    function saveTodoDetailWidth(width) {
      try {
        localStorageRef.setItem(TODO_DETAIL_WIDTH_STORAGE_KEY, String(clampTodoDetailWidth(width)));
      } catch {
        // ignore storage failures
      }
    }

    function clampTodoDetailWidth(width) {
      const parsed = Number(width);
      if (!Number.isFinite(parsed)) return 430;
      return Math.max(TODO_DETAIL_MIN_WIDTH, Math.min(TODO_DETAIL_MAX_WIDTH, parsed));
    }

    function loadIgnoredExternalCalendarIds() {
      try {
        const raw = localStorageRef.getItem(EXTERNAL_CALENDAR_IGNORED_KEY);
        if (!raw) return new Set();
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return new Set();
        return new Set(parsed.map((item) => String(item)));
      } catch {
        return new Set();
      }
    }

    function saveIgnoredExternalCalendarIds(idSet) {
      localStorageRef.setItem(EXTERNAL_CALENDAR_IGNORED_KEY, JSON.stringify(Array.from(idSet)));
      scheduleLocalDataBackup("calendar-ignored-save");
    }

    function loadEntries() {
      try {
        const raw = localStorageRef.getItem(STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];

        return parsed.filter((item) => {
          if (!item) return false;
          const qualityValid =
            typeof item.quality === "number" || item.quality === null || typeof item.quality === "undefined";
          const happinessValid =
            typeof item.happiness === "number" || item.happiness === null || typeof item.happiness === "undefined";
          return (
            item.id &&
            item.date &&
            item.start &&
            item.end &&
            qualityValid &&
            happinessValid &&
            typeof item.duration === "number"
          );
        });
      } catch {
        return [];
      }
    }

    function saveEntries(value, options = {}) {
      if (dataTransaction) {
        dataTransaction.writes.set(STORAGE_KEY, JSON.stringify(value));
        dataTransaction.sync ||= !options.skipSyncSchedule && !getIsApplyingUndo();
        dataTransaction.undo ||= !options.skipUndoSnapshot;
        return;
      }
      recoverDataTransaction();
      const skipUndoSnapshot = Boolean(options && options.skipUndoSnapshot);
      const skipSyncSchedule = Boolean(options && options.skipSyncSchedule);
      localStorageRef.setItem(STORAGE_KEY, JSON.stringify(value));
      scheduleLocalDataBackup("entries-save");
      if (!skipSyncSchedule && !getIsApplyingUndo()) {
        scheduleAutoBidirectionalSync("entries-save");
      }
      if (!skipUndoSnapshot) {
        commitUndoSnapshot();
      }
    }

    return {
      runDataTransaction,
      recoverDataTransaction,
      deferDataEffect,
      runOneTimeCacheResetIfNeeded,
      normalizeTodoReminderDisableItem,
      loadTodoReminderDisableQueue,
      saveTodoReminderDisableQueue,
      enqueueTodoReminderDisable,
      loadTodos,
      loadCollapsedProjectPathSet,
      saveCollapsedProjectPathSet,
      toggleCollapsedProjectPath,
      saveTodos,
      loadSidebarWidth,
      saveSidebarWidth,
      clampSidebarWidth,
      loadSidebarCollapsed,
      saveSidebarCollapsed,
      loadTodoDetailWidth,
      saveTodoDetailWidth,
      clampTodoDetailWidth,
      loadIgnoredExternalCalendarIds,
      saveIgnoredExternalCalendarIds,
      loadEntries,
      saveEntries,
    };
  }

  globalScope.TimeQualityDataStoreModule = {
    createDataStoreModule,
  };
})(typeof window !== "undefined" ? window : globalThis);
