(function attachTimeQualitySyncRuntimeModule(globalScope) {
  if (!globalScope) return;

  function requireFunction(deps, key) {
    const value = deps[key];
    if (typeof value !== "function") {
      throw new Error(`TimeQualitySyncRuntimeModule missing required function dependency: ${key}`);
    }
    return value;
  }

  function normalizeArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function createSyncRuntimeModule(deps = {}) {
    const AUTO_BIDIRECTIONAL_SYNC_ENABLED = Boolean(deps.AUTO_BIDIRECTIONAL_SYNC_ENABLED);
    const AUTO_BIDIRECTIONAL_SYNC_DEBOUNCE_MS = Number(deps.AUTO_BIDIRECTIONAL_SYNC_DEBOUNCE_MS) || 0;
    const AUTO_BIDIRECTIONAL_SYNC_PULL_INTERVAL_MS = Number(deps.AUTO_BIDIRECTIONAL_SYNC_PULL_INTERVAL_MS) || 60000;
    const AUTO_BIDIRECTIONAL_SYNC_START_DELAY_MS = Number(deps.AUTO_BIDIRECTIONAL_SYNC_START_DELAY_MS) || 0;
    const EXTERNAL_CALENDAR_SYNC_URL = String(deps.EXTERNAL_CALENDAR_SYNC_URL || "");
    const EXTERNAL_CALENDAR_SYNC_TRIGGER_URL = String(deps.EXTERNAL_CALENDAR_SYNC_TRIGGER_URL || "");
    const EXTERNAL_CALENDAR_SOURCE = String(deps.EXTERNAL_CALENDAR_SOURCE || "mac-calendar");
    const EXTERNAL_CALENDAR_DEFAULT_CATEGORY = String(deps.EXTERNAL_CALENDAR_DEFAULT_CATEGORY || "工作");
    const EXTERNAL_CALENDAR_AUTO_TODO_ENABLED = Boolean(deps.EXTERNAL_CALENDAR_AUTO_TODO_ENABLED);
    const EXTERNAL_CALENDAR_AUTO_TODO_MAX_DURATION_HOURS = Number(deps.EXTERNAL_CALENDAR_AUTO_TODO_MAX_DURATION_HOURS) || 12;

    const calendarSyncStatus = deps.calendarSyncStatus || null;
    const syncErrorModal = deps.syncErrorModal || null;
    const syncErrorSummary = deps.syncErrorSummary || null;
    const syncErrorDetail = deps.syncErrorDetail || null;
    const syncErrorCopyStatus = deps.syncErrorCopyStatus || null;
    const topSyncRefreshBtn = deps.topSyncRefreshBtn || null;

    const syncSettingsModule = {
      init: requireFunction(deps, "initSyncSettings"),
      getCalendarTarget: requireFunction(deps, "getSyncCalendarTarget"),
      normalizeCalendarTarget: requireFunction(deps, "normalizeSyncCalendarTarget"),
    };

    const createExternalCalendarImportModule = requireFunction(deps, "createExternalCalendarImportModule");
    const getEntries = requireFunction(deps, "getEntries");
    const getTodos = requireFunction(deps, "getTodos");
    const getIgnoredExternalCalendarIds = requireFunction(deps, "getIgnoredExternalCalendarIds");
    const getSelectedTodoId = requireFunction(deps, "getSelectedTodoId");
    const setSelectedTodoId = requireFunction(deps, "setSelectedTodoId");
    const getSyncCalendarTargetPayload = requireFunction(deps, "getSyncCalendarTargetPayload");
    const buildTodoSyncRequest = requireFunction(deps, "buildTodoSyncRequest");
    const buildTodoReminderSyncRequest = requireFunction(deps, "buildTodoReminderSyncRequest");
    const buildTodoReminderCompleteRequest = requireFunction(deps, "buildTodoReminderCompleteRequest");
    const buildTodoReminderDisableSyncRequestsFromQueue = requireFunction(deps, "buildTodoReminderDisableSyncRequestsFromQueue");
    const buildTodoDeleteSyncRequests = requireFunction(deps, "buildTodoDeleteSyncRequests");
    const completeTodoTasksInMacReminders = requireFunction(deps, "completeTodoTasksInMacReminders");
    const applyTodoReminderCompleteItems = requireFunction(deps, "applyTodoReminderCompleteItems");
    const deleteTodoTasksFromMacCalendar = requireFunction(deps, "deleteTodoTasksFromMacCalendar");
    const applyTodoTaskDeleteSyncItems = requireFunction(deps, "applyTodoTaskDeleteSyncItems");
    const syncTodoTasksToMacCalendar = requireFunction(deps, "syncTodoTasksToMacCalendar");
    const applyTodoTaskSyncItems = requireFunction(deps, "applyTodoTaskSyncItems");
    const syncTodoTasksToMacReminders = requireFunction(deps, "syncTodoTasksToMacReminders");
    const applyTodoReminderSyncItems = requireFunction(deps, "applyTodoReminderSyncItems");
    const applyQueuedTodoReminderDisableSyncItems = requireFunction(deps, "applyQueuedTodoReminderDisableSyncItems");
    const pullTodosFromMacCalendar = requireFunction(deps, "pullTodosFromMacCalendar");
    const saveTodos = requireFunction(deps, "saveTodos");
    const saveEntries = requireFunction(deps, "saveEntries");
    const render = requireFunction(deps, "render");
    const renderTopTodoSyncHub = requireFunction(deps, "renderTopTodoSyncHub");
    const getSelectedTodo = requireFunction(deps, "getSelectedTodo");
    const isTodoEligibleForReminderSync = requireFunction(deps, "isTodoEligibleForReminderSync");
    const normalizeTodoReminderRepeatValue = requireFunction(deps, "normalizeTodoReminderRepeatValue");
    const isRecurringTodoRepeatMode = requireFunction(deps, "isRecurringTodoRepeatMode");
    const normalizeTodoCategoryValue = requireFunction(deps, "normalizeTodoCategoryValue");
    const normalizeProjectName = requireFunction(deps, "normalizeProjectName");
    const normalizeEntryTitle = requireFunction(deps, "normalizeEntryTitle");
    const normalizeTodoNoteValue = requireFunction(deps, "normalizeTodoNoteValue");
    const getTodoCategory = requireFunction(deps, "getTodoCategory");
    const isValidDateInput = requireFunction(deps, "isValidDateInput");
    const getNextTodoOrderForDate = requireFunction(deps, "getNextTodoOrderForDate");
    const normalizeTodo = requireFunction(deps, "normalizeTodo");
    const normalizeTodoOrderForDate = requireFunction(deps, "normalizeTodoOrderForDate");
    const buildEntryDateRange = requireFunction(deps, "buildEntryDateRange");
    const formatDateForInput = requireFunction(deps, "formatDateForInput");
    const formatTimeForInput = requireFunction(deps, "formatTimeForInput");
    const isImportedExternalEntry = requireFunction(deps, "isImportedExternalEntry");
    const createUniqueEntryId = requireFunction(deps, "createUniqueEntryId");
    const updateBodyModalState = requireFunction(deps, "updateBodyModalState");
    const normalizeExternalCalendarGroupValue = requireFunction(deps, "normalizeExternalCalendarGroupValue");

    let entries = [];
    let todos = [];
    let ignoredExternalCalendarIds = new Set();
    let isMacCalendarSyncRunning = false;
    let autoBidirectionalSyncTimerId = 0;
    let autoBidirectionalSyncIntervalId = 0;
    let autoBidirectionalSyncRunning = false;
    let autoBidirectionalSyncPending = false;
    let topSyncRuntimeMessage = "";
    let topSyncRuntimeTone = "normal";
    let lastSyncErrorDetailText = "";
    let lastRuntimeSyncCompletedAt = "";

    const externalCalendarImportModule = createExternalCalendarImportModule({
      EXTERNAL_CALENDAR_SOURCE,
      EXTERNAL_CALENDAR_DEFAULT_CATEGORY,
      EXTERNAL_CALENDAR_AUTO_TODO_ENABLED,
      EXTERNAL_CALENDAR_AUTO_TODO_MAX_DURATION_HOURS,
      getEntries: () => entries,
      getTodos: () => todos,
      getIgnoredExternalCalendarIds: () => ignoredExternalCalendarIds,
      getSelectedTodoId,
      setSelectedTodoId,
      getSyncCalendarTarget: () => syncSettingsModule.getCalendarTarget(),
      normalizeSyncCalendarTarget: (target) => syncSettingsModule.normalizeCalendarTarget(target),
      normalizeTodoCategoryValue,
      normalizeProjectName,
      normalizeEntryTitle,
      normalizeTodoNoteValue,
      getTodoCategory,
      isValidDateInput,
      getNextTodoOrderForDate,
      normalizeTodo,
      normalizeTodoOrderForDate,
      buildEntryDateRange,
      formatDateForInput,
      formatTimeForInput,
      isImportedExternalEntry,
      createUniqueEntryId,
      normalizeExternalCalendarGroupValue,
    });

    function refreshDataRefs() {
      entries = normalizeArray(getEntries());
      todos = normalizeArray(getTodos());
      const ignored = getIgnoredExternalCalendarIds();
      ignoredExternalCalendarIds = ignored instanceof Set ? ignored : new Set();
    }

    async function runManualTopRefreshSync() {
      if (autoBidirectionalSyncRunning) {
        window.alert("同步正在进行中，请稍候再试。");
        return;
      }
    
      if (topSyncRefreshBtn) {
        topSyncRefreshBtn.disabled = true;
      }
      topSyncRuntimeMessage = "正在刷新同步…";
      topSyncRuntimeTone = "normal";
      renderTopTodoSyncHub(getSelectedTodo());
    
      const syncWork = collectDirtyTodoSyncWork();
    
      try {
        let reminderCompleteSummary = { succeeded: 0, failed: 0 };
        if (syncWork.reminderCompleteTasks.length) {
          try {
            const reminderCompleteResult = await completeTodoTasksInMacReminders(syncWork.reminderCompleteTasks);
            reminderCompleteSummary = applyTodoReminderCompleteItems(reminderCompleteResult.items);
          } catch (error) {
            reminderCompleteSummary = { succeeded: 0, failed: syncWork.reminderCompleteTasks.length };
            const message = error instanceof Error ? error.message : "提醒完成同步失败";
            setCalendarSyncStatus(`提醒完成同步失败：${message}`, "warning");
          }
        }
    
        let deleteSummary = { succeeded: 0, failed: 0, remaining: syncWork.deletePayloads.length };
        if (syncWork.deletePayloads.length) {
          const deleteResult = await deleteTodoTasksFromMacCalendar(syncWork.deletePayloads);
          deleteSummary = applyTodoTaskDeleteSyncItems(deleteResult.items);
        }
    
        let summary = { succeeded: 0, failed: 0 };
        if (syncWork.preparedTasks.length) {
          const result = await syncTodoTasksToMacCalendar(syncWork.preparedTasks);
          summary = applyTodoTaskSyncItems(result.items);
        }
        let reminderSummary = { succeeded: 0, failed: 0 };
        if (syncWork.preparedReminderTasks.length) {
          const reminderResult = await syncTodoTasksToMacReminders(syncWork.preparedReminderTasks);
          reminderSummary = applyTodoReminderSyncItems(reminderResult.items);
        }
        let reminderDisableSummary = { succeeded: 0, failed: 0 };
        if (syncWork.reminderDisableTasks.length) {
          const reminderDisableResult = await completeTodoTasksInMacReminders(syncWork.reminderDisableTasks);
          reminderDisableSummary = applyTodoReminderCompleteItems(reminderDisableResult.items);
          applyQueuedTodoReminderDisableSyncItems(reminderDisableResult.items);
        }
    
        const pullResult = await pullTodosFromMacCalendar({ manual: true, triggerExport: true });
        if (pullResult.fallback) {
          const legacyResult = await syncMacCalendarEvents({ manual: true, triggerExport: true });
          render();
          markRuntimeSyncCompleted();
          topSyncRuntimeMessage = "";
          topSyncRuntimeTone = "normal";
          renderTopTodoSyncHub(getSelectedTodo());
          window.alert(
            `刷新完成（兼容模式）：日历上传成功 ${summary.succeeded} 项，失败 ${summary.failed} 项；提醒上传成功 ${reminderSummary.succeeded} 项，失败 ${reminderSummary.failed} 项；提醒完成成功 ${reminderCompleteSummary.succeeded} 项，失败 ${reminderCompleteSummary.failed} 项；提醒关闭成功 ${reminderDisableSummary.succeeded} 项，失败 ${reminderDisableSummary.failed} 项；删除成功 ${deleteSummary.succeeded} 项，删除失败 ${deleteSummary.failed} 项；日历新增 ${Number(legacyResult?.added || 0)} 条，更新 ${Number(legacyResult?.updated || 0)} 条。`,
          );
          return;
        }
    
        const calendarSyncResult = await syncMacCalendarEvents({ manual: false, triggerExport: false });
        if (pullResult.conflicts > 0) {
          setCalendarSyncStatus(`检测到 ${pullResult.conflicts} 项待办冲突，请在待办中确认。`, "warning");
        }
        render();
    
        markRuntimeSyncCompleted();
        topSyncRuntimeMessage = "";
        topSyncRuntimeTone = "normal";
        renderTopTodoSyncHub(getSelectedTodo());
    
        const uploadText = `日历上传成功 ${summary.succeeded} 项，失败 ${summary.failed} 项`;
        const reminderText = `提醒上传成功 ${reminderSummary.succeeded} 项，失败 ${reminderSummary.failed} 项`;
        const reminderCompleteText =
          `提醒完成成功 ${reminderCompleteSummary.succeeded} 项，失败 ${reminderCompleteSummary.failed} 项`;
        const reminderDisableText =
          `提醒关闭成功 ${reminderDisableSummary.succeeded} 项，失败 ${reminderDisableSummary.failed} 项`;
        const deleteText = `删除成功 ${deleteSummary.succeeded} 项，删除失败 ${deleteSummary.failed} 项`;
        const skippedText = syncWork.skipped > 0 ? `，跳过 ${syncWork.skipped} 项` : "";
        const reminderSkippedText = syncWork.reminderSkipped > 0 ? `，提醒跳过 ${syncWork.reminderSkipped} 项` : "";
        const reminderCompleteSkippedText =
          syncWork.reminderCompleteSkipped > 0 ? `，提醒完成跳过 ${syncWork.reminderCompleteSkipped} 项` : "";
        const reminderDisableSkippedText =
          syncWork.reminderDisableSkipped > 0 ? `，提醒关闭跳过 ${syncWork.reminderDisableSkipped} 项` : "";
        const autoTodoText =
          Number(calendarSyncResult?.todoAdded || 0) > 0 || Number(calendarSyncResult?.todoUpdated || 0) > 0
            ? `；外部事件转待办：新增 ${Number(calendarSyncResult?.todoAdded || 0)} 项，更新 ${Number(calendarSyncResult?.todoUpdated || 0)} 项`
            : "";
        window.alert(
          `刷新完成：${uploadText}${skippedText}；${reminderText}${reminderSkippedText}；${reminderCompleteText}${reminderCompleteSkippedText}；${reminderDisableText}${reminderDisableSkippedText}；${deleteText}；回拉更新待办 ${pullResult.updated} 项，删除待办 ${pullResult.deleted} 项，冲突 ${pullResult.conflicts} 项，未匹配 ${pullResult.unmatched} 项${autoTodoText}。`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "未知错误";
        topSyncRuntimeMessage = `同步失败：${message}`;
        topSyncRuntimeTone = "danger";
        renderTopTodoSyncHub(getSelectedTodo());
        void showSyncErrorDetails(message, "刷新同步失败");
      } finally {
        if (topSyncRefreshBtn) {
          topSyncRefreshBtn.disabled = false;
        }
      }
    }

    function markRuntimeSyncCompleted(timestampIso = new Date().toISOString()) {
      const timestamp = String(timestampIso || "").trim();
      lastRuntimeSyncCompletedAt = timestamp || new Date().toISOString();
    }
    
    async function handleTopRefreshSyncAction() {
      await runManualTopRefreshSync();
    }
    
    async function handleTopUploadAction() {
      await runManualTopRefreshSync();
    }
    
    async function handleTopPullAction() {
      await runManualTopRefreshSync();
    }
    
    function setCalendarSyncStatus(message, tone = "normal") {
      if (!calendarSyncStatus) return;
      const text = String(message || "").trim();
      calendarSyncStatus.textContent = text;
      calendarSyncStatus.hidden = !text;
      calendarSyncStatus.dataset.tone = tone;
    }
    
    function normalizeSyncErrorDetail(message) {
      const text = String(message || "未知错误").trim();
      if (!text) return "未知错误";
      if (text.startsWith("TRIGGER_SWIFT_UNAVAILABLE:") || text.startsWith("TRIGGER_FAILED:")) {
        const detail = text.split(":").slice(1).join(":").trim();
        return detail || text;
      }
      if (text === "TRIGGER_SWIFT_UNAVAILABLE") {
        return "Mac 日历导出失败，请检查系统权限与同步服务。";
      }
      if (text === "TRIGGER_FAILED") {
        return "导出失败，请检查系统权限与日历访问。";
      }
      return text;
    }
    
    async function copyTextToClipboard(text) {
      const content = String(text || "");
      if (!content) return false;
      if (navigator?.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(content);
          return true;
        } catch {
          // fallback below
        }
      }
      try {
        const textarea = document.createElement("textarea");
        textarea.value = content;
        textarea.setAttribute("readonly", "true");
        textarea.style.position = "fixed";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.select();
        textarea.setSelectionRange(0, textarea.value.length);
        const copied = document.execCommand("copy");
        textarea.remove();
        return Boolean(copied);
      } catch {
        return false;
      }
    }
    
    function closeSyncErrorModal() {
      if (!syncErrorModal || syncErrorModal.hidden) return;
      syncErrorModal.hidden = true;
      updateBodyModalState();
    }
    
    async function showSyncErrorDetails(rawMessage, title = "同步失败") {
      const summary = String(title || "同步失败").trim() || "同步失败";
      const detail = normalizeSyncErrorDetail(rawMessage);
      lastSyncErrorDetailText = `${summary}：${detail}`;
      const copied = await copyTextToClipboard(lastSyncErrorDetailText);
    
      if (syncErrorSummary && syncErrorDetail && syncErrorModal) {
        syncErrorSummary.textContent = summary;
        syncErrorDetail.value = detail;
        if (syncErrorCopyStatus) {
          syncErrorCopyStatus.textContent = copied
            ? "完整错误信息已自动复制到剪贴板。"
            : "自动复制失败，可点击“复制错误信息”手动复制。";
          syncErrorCopyStatus.dataset.tone = copied ? "success" : "warning";
        }
        syncErrorModal.hidden = false;
        updateBodyModalState();
        window.setTimeout(() => {
          if (syncErrorDetail) {
            syncErrorDetail.focus();
            syncErrorDetail.select();
          }
        }, 0);
        return;
      }
    
      if (copied) {
        window.alert(`${summary}：${detail}\n\n完整信息已复制到剪贴板。`);
        return;
      }
      window.prompt(`${summary}（可复制）`, detail);
    }
    
    async function handleSyncErrorCopyClick() {
      const text = String(lastSyncErrorDetailText || "").trim();
      if (!text) return;
      const copied = await copyTextToClipboard(text);
      if (syncErrorCopyStatus) {
        syncErrorCopyStatus.textContent = copied
          ? "已复制到剪贴板。"
          : "复制失败，请手动复制文本框内容。";
        syncErrorCopyStatus.dataset.tone = copied ? "success" : "warning";
      }
    }
    
    function initMacCalendarSync() {
      setCalendarSyncStatus("");
      syncSettingsModule.init();
    }
    
    function initAutoBidirectionalSync() {
      if (!AUTO_BIDIRECTIONAL_SYNC_ENABLED) return;
      if (typeof window === "undefined") return;
      if (window.location.protocol === "file:") return;
    
      scheduleAutoBidirectionalSync("startup", AUTO_BIDIRECTIONAL_SYNC_START_DELAY_MS);
    
      if (autoBidirectionalSyncIntervalId) {
        window.clearInterval(autoBidirectionalSyncIntervalId);
      }
      autoBidirectionalSyncIntervalId = window.setInterval(() => {
        void runAutoBidirectionalSync("interval");
      }, AUTO_BIDIRECTIONAL_SYNC_PULL_INTERVAL_MS);
    
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden) {
          void runAutoBidirectionalSync("resume");
        }
      });
    }
    
    function scheduleAutoBidirectionalSync(reason = "change", delayMs = AUTO_BIDIRECTIONAL_SYNC_DEBOUNCE_MS) {
      if (!AUTO_BIDIRECTIONAL_SYNC_ENABLED) return;
      if (typeof window === "undefined") return;
      if (autoBidirectionalSyncTimerId) {
        window.clearTimeout(autoBidirectionalSyncTimerId);
      }
      autoBidirectionalSyncTimerId = window.setTimeout(() => {
        autoBidirectionalSyncTimerId = 0;
        void runAutoBidirectionalSync(reason);
      }, Math.max(0, Number(delayMs) || 0));
    }
    
    function collectDirtyTodoSyncWork() {
      refreshDataRefs();
      const candidates = todos.filter(
        (todo) =>
          !todo.completed &&
          String(todo.syncState || "").trim() === "dirty" &&
          String(todo.dueDate || "").trim(),
      );
      const reminderCandidates = todos.filter(
        (todo) =>
          !todo.completed &&
          isTodoEligibleForReminderSync(todo) &&
          !String(todo.reminderPendingCompleteAt || "").trim() &&
          normalizeTodoReminderRepeatValue(todo.repeat) !== "none" &&
          String(todo.reminderSyncState || "").trim() === "dirty" &&
          String(todo.dueDate || "").trim(),
      );
      const reminderCompleteCandidates = todos.filter(
        (todo) => {
          const reminderId = String(todo.externalReminderId || "").trim();
          if (!reminderId) return false;
          if (todo.completed && !String(todo.reminderCompletedAt || "").trim()) return true;
          return (
            !todo.completed &&
            isRecurringTodoRepeatMode(todo.repeat) &&
            Boolean(String(todo.reminderPendingCompleteAt || "").trim())
          );
        },
      );
      const reminderDisableCandidates = todos.filter(
        (todo) =>
          !todo.completed &&
          normalizeTodoReminderRepeatValue(todo.repeat) === "none" &&
          String(todo.externalReminderId || "").trim(),
      );
      const queuedReminderDisableWork = buildTodoReminderDisableSyncRequestsFromQueue();
      const preparedTasks = [];
      const preparedReminderTasks = [];
      const reminderCompleteTasks = [];
      const reminderDisableTasks = [...queuedReminderDisableWork.tasks];
      let skipped = 0;
      let reminderSkipped = 0;
      let reminderCompleteSkipped = 0;
      let reminderDisableSkipped = queuedReminderDisableWork.skipped;
      let reminderStatePatched = false;
      const nowIso = new Date().toISOString();
      for (const todo of candidates) {
        const normalized = buildTodoSyncRequest(todo);
        if (normalized.ok) {
          preparedTasks.push(normalized.value);
        } else {
          skipped += 1;
        }
      }
      for (const todo of reminderCandidates) {
        const normalized = buildTodoReminderSyncRequest(todo);
        if (normalized.ok) {
          preparedReminderTasks.push(normalized.value);
        } else {
          reminderSkipped += 1;
          if (String(normalized.code || "") === "REMINDER_TIME_IN_PAST") {
            todo.reminderSynced = true;
            todo.reminderSyncState = "synced";
            todo.reminderLastSyncError = "";
            todo.reminderSyncedAt = nowIso;
            todo.reminderCompletedAt = null;
            reminderStatePatched = true;
    
            if (String(todo.externalReminderId || "").trim()) {
              const disable = buildTodoReminderCompleteRequest(todo, { action: "disable" });
              if (disable.ok) {
                reminderDisableTasks.push(disable.value);
              } else {
                reminderDisableSkipped += 1;
              }
            }
          }
        }
      }
      for (const todo of reminderCompleteCandidates) {
        const normalized = buildTodoReminderCompleteRequest(todo, { action: "complete" });
        if (normalized.ok) {
          reminderCompleteTasks.push(normalized.value);
        } else {
          reminderCompleteSkipped += 1;
        }
      }
      for (const todo of reminderDisableCandidates) {
        const normalized = buildTodoReminderCompleteRequest(todo, { action: "disable" });
        if (normalized.ok) {
          reminderDisableTasks.push(normalized.value);
        } else {
          reminderDisableSkipped += 1;
        }
      }
      if (reminderStatePatched) {
        saveTodos(todos, { skipSyncSchedule: true, skipUndoSnapshot: true });
      }
      const deletePayloads = buildTodoDeleteSyncRequests();
      return {
        preparedTasks,
        preparedReminderTasks,
        reminderCompleteTasks,
        reminderDisableTasks,
        deletePayloads,
        skipped,
        reminderSkipped,
        reminderCompleteSkipped,
        reminderDisableSkipped,
      };
    }
    
    async function runAutoBidirectionalSync(reason = "auto") {
      if (!AUTO_BIDIRECTIONAL_SYNC_ENABLED) return;
      if (typeof window !== "undefined" && window.location.protocol === "file:") return;
      if (autoBidirectionalSyncRunning) {
        autoBidirectionalSyncPending = true;
        return;
      }
    
      autoBidirectionalSyncRunning = true;
      let syncSucceeded = false;
      try {
        const syncWork = collectDirtyTodoSyncWork();
    
        if (syncWork.reminderCompleteTasks.length > 0) {
          try {
            const reminderCompleteResult = await completeTodoTasksInMacReminders(syncWork.reminderCompleteTasks);
            applyTodoReminderCompleteItems(reminderCompleteResult.items);
          } catch (error) {
            const message = error instanceof Error ? error.message : "提醒完成同步失败";
            setCalendarSyncStatus(`自动提醒完成同步失败：${message}`, "warning");
          }
        }
    
        if (syncWork.deletePayloads.length > 0) {
          const deleteResult = await deleteTodoTasksFromMacCalendar(syncWork.deletePayloads);
          applyTodoTaskDeleteSyncItems(deleteResult.items);
        }
    
        if (syncWork.preparedTasks.length > 0) {
          const syncResult = await syncTodoTasksToMacCalendar(syncWork.preparedTasks);
          applyTodoTaskSyncItems(syncResult.items);
        }
        if (syncWork.preparedReminderTasks.length > 0) {
          const reminderResult = await syncTodoTasksToMacReminders(syncWork.preparedReminderTasks);
          applyTodoReminderSyncItems(reminderResult.items);
        }
        if (syncWork.reminderDisableTasks.length > 0) {
          const reminderDisableResult = await completeTodoTasksInMacReminders(syncWork.reminderDisableTasks);
          applyTodoReminderCompleteItems(reminderDisableResult.items);
          applyQueuedTodoReminderDisableSyncItems(reminderDisableResult.items);
        }
    
        const pullResult = await pullTodosFromMacCalendar({ manual: false, triggerExport: true });
        if (!pullResult.fallback) {
          await syncMacCalendarEvents({ manual: false, triggerExport: false });
        }
        syncSucceeded = true;
      } catch (error) {
        const message = error instanceof Error ? error.message : "未知错误";
        setCalendarSyncStatus(`自动同步失败：${message}`, "warning");
        topSyncRuntimeMessage = `自动同步失败：${message}`;
        topSyncRuntimeTone = "warning";
        renderTopTodoSyncHub(getSelectedTodo());
      } finally {
        if (syncSucceeded) {
          markRuntimeSyncCompleted();
          topSyncRuntimeMessage = "";
          topSyncRuntimeTone = "normal";
          renderTopTodoSyncHub(getSelectedTodo());
        }
        autoBidirectionalSyncRunning = false;
        if (autoBidirectionalSyncPending) {
          autoBidirectionalSyncPending = false;
          scheduleAutoBidirectionalSync(`${reason}-queued`, 300);
        }
      }
    }
    
    async function triggerMacCalendarExportOnce() {
      const response = await fetch(EXTERNAL_CALENDAR_SYNC_TRIGGER_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          targetCalendar: getSyncCalendarTargetPayload(),
        }),
      });
    
      if (!response.ok) {
        if (response.status === 404) {
          throw new Error("TRIGGER_ENDPOINT_NOT_FOUND");
        }
    
        let detail = "";
        try {
          const payload = await response.json();
          detail = String(payload?.message || payload?.error || "").trim();
        } catch {
          detail = "";
        }
    
        if (response.status === 503) {
          throw new Error(detail ? `TRIGGER_SWIFT_UNAVAILABLE:${detail}` : "TRIGGER_SWIFT_UNAVAILABLE");
        }
    
        throw new Error(detail ? `TRIGGER_FAILED:${detail}` : "TRIGGER_FAILED");
      }
    }
    
    async function syncMacCalendarEvents({ manual = false, triggerExport = false } = {}) {
      refreshDataRefs();
      if (isMacCalendarSyncRunning) {
        return {
          added: 0,
          updated: 0,
          ignored: 0,
          todoAdded: 0,
          todoUpdated: 0,
          todoSkipped: 0,
          changed: false,
          busy: true,
        };
      }
      isMacCalendarSyncRunning = true;
    
      setCalendarSyncStatus("正在同步 Mac 日历…");
    
      try {
        if (triggerExport) {
          await triggerMacCalendarExportOnce();
        }
    
        const response = await fetch(`${EXTERNAL_CALENDAR_SYNC_URL}?t=${Date.now()}`, {
          cache: "no-store",
        });
    
        if (!response.ok) {
          const statusMessage = response.status === 404 ? "NOT_FOUND" : `HTTP_${response.status}`;
          throw new Error(statusMessage);
        }
    
        const payload = await response.json();
        const importedEvents = normalizeExternalCalendarPayload(payload, getSyncCalendarTargetPayload());
        const todoSyncResult = EXTERNAL_CALENDAR_AUTO_TODO_ENABLED
          ? syncFutureExternalEventsToTodos(importedEvents)
          : { changed: false, added: 0, updated: 0, skipped: 0 };
        const result = applyImportedCalendarEvents(importedEvents);
    
        if (todoSyncResult.changed) {
          saveTodos(todos, { skipSyncSchedule: true, skipUndoSnapshot: true });
        }
        if (result.changed || todoSyncResult.changed) {
          saveEntries(entries, { skipUndoSnapshot: true });
          render();
        }
    
        if (importedEvents.length === 0 && !todoSyncResult.added && !todoSyncResult.updated) {
          setCalendarSyncStatus("同步完成：未发现可导入日程", "muted");
        } else {
          const todoSummary =
            todoSyncResult.added || todoSyncResult.updated
              ? `；待办新增 ${todoSyncResult.added}，更新 ${todoSyncResult.updated}`
              : "";
          setCalendarSyncStatus(
            `同步完成：新增 ${result.added}，更新 ${result.updated}，忽略 ${result.ignored}${todoSummary}`,
            "success",
          );
        }
        return {
          added: result.added,
          updated: result.updated,
          ignored: result.ignored,
          todoAdded: todoSyncResult.added,
          todoUpdated: todoSyncResult.updated,
          todoSkipped: todoSyncResult.skipped,
          changed: Boolean(result.changed || todoSyncResult.changed),
          busy: false,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "UNKNOWN";
        if (message === "TRIGGER_ENDPOINT_NOT_FOUND") {
          setCalendarSyncStatus("未检测到同步服务，请用 node server.js 启动", "warning");
          if (manual) {
            void showSyncErrorDetails("未检测到同步服务。请在项目目录运行 node server.js 后再点击同步。", "刷新同步失败");
          }
        } else if (message.startsWith("TRIGGER_SWIFT_UNAVAILABLE")) {
          setCalendarSyncStatus("Swift 环境不可用，导出失败", "danger");
          if (manual) {
            const detail = message.split(":").slice(1).join(":").trim();
            void showSyncErrorDetails(
              detail
                ? `Mac 日历导出失败：${detail}`
                : "Mac 日历导出失败，请确认本机可执行 swift scripts/export-mac-calendar.swift。",
              "刷新同步失败",
            );
          }
        } else if (message.startsWith("TRIGGER_FAILED")) {
          setCalendarSyncStatus("导出失败，请检查系统权限与日历访问", "danger");
          if (manual) {
            const detail = message.split(":").slice(1).join(":").trim();
            void showSyncErrorDetails(detail ? `导出失败：${detail}` : "导出失败，请检查系统权限与日历访问。", "刷新同步失败");
          }
        } else if (message === "NOT_FOUND") {
          setCalendarSyncStatus("未检测到 calendar_sync.json", "warning");
          if (manual) {
            void showSyncErrorDetails(
              "未检测到 calendar_sync.json，请先点击同步按钮触发导出，或检查导出权限。",
              "刷新同步失败",
            );
          }
        } else if (window.location.protocol === "file:") {
          setCalendarSyncStatus("请通过本地服务器打开项目后再同步", "warning");
          if (manual) {
            void showSyncErrorDetails(
              "当前是 file:// 打开页面，浏览器可能拦截本地 JSON 读取。请用本地静态服务器启动项目。",
              "刷新同步失败",
            );
          }
        } else {
          setCalendarSyncStatus("同步失败，请检查导出脚本与文件格式", "danger");
          if (manual) {
            void showSyncErrorDetails(
              `同步失败，请确认导出脚本已运行且 calendar_sync.json 格式正确。\n\n原始错误：${message}`,
              "刷新同步失败",
            );
          }
        }
        return {
          added: 0,
          updated: 0,
          ignored: 0,
          todoAdded: 0,
          todoUpdated: 0,
          todoSkipped: 0,
          changed: false,
          busy: false,
        };
      } finally {
        isMacCalendarSyncRunning = false;
      }
    }
    
    function normalizeExternalCalendarPayload(payload, targetCalendar = syncSettingsModule.getCalendarTarget()) {
      return externalCalendarImportModule.normalizeExternalCalendarPayload(payload, targetCalendar);
    }

    function extractTimeQualityTaskIdFromUrl(urlText) {
      return externalCalendarImportModule.extractTimeQualityTaskIdFromUrl(urlText);
    }

    function hasTimeQualityMetaUrl(urlText) {
      return externalCalendarImportModule.hasTimeQualityMetaUrl(urlText);
    }

    function extractTimeQualityTaskIdFromNote(noteText, urlText = "") {
      return externalCalendarImportModule.extractTimeQualityTaskIdFromNote(noteText, urlText);
    }

    function isEventInSyncCalendarTarget(event, targetCalendar = syncSettingsModule.getCalendarTarget()) {
      return externalCalendarImportModule.isEventInSyncCalendarTarget(event, targetCalendar);
    }

    function findTodoByExternalCalendarId(externalId) {
      return externalCalendarImportModule.findTodoByExternalCalendarId(externalId);
    }

    function hasDirtyLocalChanges(todo) {
      return externalCalendarImportModule.hasDirtyLocalChanges(todo);
    }

    function isExternalEventEligibleForAutoTodo(imported, nowDate = new Date()) {
      return externalCalendarImportModule.isExternalEventEligibleForAutoTodo(imported, nowDate);
    }

    function syncFutureExternalEventsToTodos(importedEvents) {
      return externalCalendarImportModule.syncFutureExternalEventsToTodos(importedEvents);
    }

    function normalizeExternalCalendarEvent(rawEvent) {
      return externalCalendarImportModule.normalizeExternalCalendarEvent(rawEvent);
    }

    function mapExternalCalendarCategory(rawEvent) {
      return externalCalendarImportModule.mapExternalCalendarCategory(rawEvent);
    }

    function parseExternalDateValue(value) {
      return externalCalendarImportModule.parseExternalDateValue(value);
    }

    function parseExternalDateAndTime(rawDate, rawTime) {
      return externalCalendarImportModule.parseExternalDateAndTime(rawDate, rawTime);
    }

    function applyImportedCalendarEvents(importedEvents) {
      return externalCalendarImportModule.applyImportedCalendarEvents(importedEvents);
    }

    function isSameImportedSnapshot(prev, next) {
      return externalCalendarImportModule.isSameImportedSnapshot(prev, next);
    }

    function createImportedCalendarEntry(imported) {
      return externalCalendarImportModule.createImportedCalendarEntry(imported);
    }

    function getTopSyncRuntimeMessage() {
      return topSyncRuntimeMessage;
    }

    function getTopSyncRuntimeTone() {
      return topSyncRuntimeTone;
    }

    function getLastRuntimeSyncCompletedAt() {
      return lastRuntimeSyncCompletedAt;
    }

    function isSyncRunning() {
      return Boolean(autoBidirectionalSyncRunning || isMacCalendarSyncRunning);
    }

    function cancelPendingAutoSync() {
      if (autoBidirectionalSyncTimerId) {
        globalScope.clearTimeout(autoBidirectionalSyncTimerId);
        autoBidirectionalSyncTimerId = 0;
      }
      autoBidirectionalSyncPending = false;
    }

    return {
      runManualTopRefreshSync,
      handleTopRefreshSyncAction,
      handleTopUploadAction,
      handleTopPullAction,
      setCalendarSyncStatus,
      normalizeSyncErrorDetail,
      copyTextToClipboard,
      closeSyncErrorModal,
      showSyncErrorDetails,
      handleSyncErrorCopyClick,
      initMacCalendarSync,
      initAutoBidirectionalSync,
      scheduleAutoBidirectionalSync,
      collectDirtyTodoSyncWork,
      runAutoBidirectionalSync,
      triggerMacCalendarExportOnce,
      syncMacCalendarEvents,
      normalizeExternalCalendarPayload,
      extractTimeQualityTaskIdFromUrl,
      hasTimeQualityMetaUrl,
      extractTimeQualityTaskIdFromNote,
      isEventInSyncCalendarTarget,
      findTodoByExternalCalendarId,
      hasDirtyLocalChanges,
      isExternalEventEligibleForAutoTodo,
      syncFutureExternalEventsToTodos,
      normalizeExternalCalendarEvent,
      mapExternalCalendarCategory,
      parseExternalDateValue,
      parseExternalDateAndTime,
      applyImportedCalendarEvents,
      isSameImportedSnapshot,
      createImportedCalendarEntry,
      getTopSyncRuntimeMessage,
      getTopSyncRuntimeTone,
      getLastRuntimeSyncCompletedAt,
      isSyncRunning,
      cancelPendingAutoSync,
    };
  }

  globalScope.TimeQualitySyncRuntimeModule = { createSyncRuntimeModule };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = globalScope.TimeQualitySyncRuntimeModule;
  }
})(typeof window !== "undefined" ? window : globalThis);
