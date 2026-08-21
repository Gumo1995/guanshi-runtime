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

  function formatRemoteDeleteGuardNotice(pullResult) {
    if (!pullResult?.deleteBlocked) return "";
    const candidateCount = Math.max(0, Number(pullResult.deleteCandidates || 0));
    if (pullResult.deleteBlockReason === "automatic-sync") {
      return `自动同步发现 ${candidateCount} 个 Calendar 远端缺失待办，已保留本地数据。`;
    }
    if (pullResult.deleteBlockReason === "empty-export") {
      return `Calendar 本次未读取到目标日历事件，已阻止删除 ${candidateCount} 个本地待办。`;
    }
    return `检测到异常同步，已阻止删除 ${candidateCount} 个本地待办。`;
  }

  function formatSyncGovernanceNotice(trigger, issueCount) {
    const count = Math.max(0, Number(issueCount || 0));
    if (!count) return "";
    return `${trigger === "manual" ? "同步发现" : "自动同步发现"} ${count} 个问题，点击处理`;
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
    const openSyncGovernance = requireFunction(deps, "openSyncGovernance");
    const deleteTodoByTaskId = requireFunction(deps, "deleteTodoByTaskId");
    const enqueueTodoCalendarDelete = requireFunction(deps, "enqueueTodoCalendarDelete");
    const pushCalendarEventPayload = requireFunction(deps, "pushCalendarEventPayload");
    const isTodoOverdue = typeof deps.isTodoOverdue === "function" ? deps.isTodoOverdue : () => false;

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
    let pendingSyncGovernanceIssues = [];
    let pendingSyncGovernanceCompletedCount = 0;

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

    function createIssueId(type, token = "") {
      const suffix = String(token || "general").trim().replace(/[^a-zA-Z0-9_-]+/g, "-") || "general";
      return `${type}-${suffix}`;
    }

    function snapshotTodoForGovernance(todo) {
      if (!todo || typeof todo !== "object") return {};
      return {
        title: String(todo.title || "").trim(),
        dueDate: String(todo.dueDate || "").trim(),
        startTime: String(todo.startTime || "").trim(),
        endTime: String(todo.endTime || "").trim(),
        note: String(todo.note || "").trim(),
        qualityScore: todo.qualityScore ?? "",
        happinessScore: todo.happinessScore ?? "",
        updatedAt: String(todo.updatedAt || "").trim(),
        syncedAt: String(todo.syncedAt || "").trim(),
        externalCalendarId: String(todo.externalCalendarId || "").trim(),
      };
    }

    function snapshotEntryForGovernance(entry) {
      if (!entry || typeof entry !== "object") return {};
      return {
        title: String(entry.title || "").trim(),
        dueDate: String(entry.date || "").trim(),
        startTime: String(entry.start || "").trim(),
        endTime: String(entry.end || "").trim(),
        note: String(entry.note || "").trim(),
        qualityScore: entry.quality ?? "",
        happinessScore: entry.happiness ?? "",
        updatedAt: String(entry.updatedAt || entry.createdAt || "").trim(),
        syncedAt: String(entry.calendarSyncedAt || "").trim(),
        externalCalendarId: String(entry.externalId || "").trim(),
      };
    }

    function buildCalendarEntrySyncRequest(entry) {
      if (!entry || !String(entry.id || "").trim()) {
        return { ok: false, message: "日历记录无效，请重新保存后再同步。" };
      }
      const date = String(entry.date || "").trim();
      const start = String(entry.start || "").trim();
      const end = String(entry.end || "").trim();
      const range = buildEntryDateRange(date, start, end);
      if (!range) {
        return { ok: false, message: "日历记录的日期或时间段无效。" };
      }
      const target = getSyncCalendarTargetPayload();
      return {
        ok: true,
        value: {
          entryId: String(entry.id),
          title: normalizeEntryTitle(entry.title, entry.category || "记录"),
          date,
          start,
          end,
          category: String(entry.category || "").trim(),
          quality: entry.quality,
          happiness: entry.happiness,
          sourceId: String(entry.id),
          eventId: String(entry.externalId || ""),
          note: String(entry.note || "").trim(),
          calendarId: String(target?.calendarId || ""),
          calendarName: String(target?.calendarName || ""),
        },
      };
    }

    function isLocalOnlyCalendarEntry(entry) {
      const source = String(entry?.source || "").trim().toLowerCase();
      return source.includes("sample");
    }

    function collectDirtyCalendarEntrySyncWork({ includeLegacy = false, nowDate = new Date() } = {}) {
      refreshDataRefs();
      const preparedEntries = [];
      const validationIssues = [];
      for (const entry of entries) {
        if (!entry || entry.todoPending) continue;
        if (isLocalOnlyCalendarEntry(entry)) continue;
        const range = buildEntryDateRange(entry.date, entry.start, entry.end);
        if (!range || range.endDate > nowDate) continue;
        const state = String(entry.calendarSyncState || "").trim();
        const isLegacyLocalRecord =
          includeLegacy && !state && String(entry.source || "").trim() !== EXTERNAL_CALENDAR_SOURCE;
        if (state !== "dirty" && !isLegacyLocalRecord) continue;
        const normalized = buildCalendarEntrySyncRequest(entry);
        if (normalized.ok) {
          preparedEntries.push(normalized.value);
          continue;
        }
        validationIssues.push({
          id: createIssueId("failure", `entry-validation-${entry.id}`),
          type: "failure",
          source: "entry-calendar",
          entryId: String(entry.id || ""),
          subject: String(entry.title || "日历记录"),
          heading: "观时记录暂时无法同步到 Calendar",
          local: snapshotEntryForGovernance(entry),
          remote: {},
          changedFields: [],
          message: String(normalized.message || "日历记录数据不完整。"),
          recommendation: {
            title: "先保留观时记录，修正时间后重试",
            reason: "本地记录没有丢失，修正后可以继续同步。",
            fields: {},
          },
        });
      }
      return { preparedEntries, validationIssues };
    }

    async function syncCalendarEntriesToMacCalendar(payloads) {
      const items = [];
      for (const payload of normalizeArray(payloads)) {
        try {
          const data = await pushCalendarEventPayload(payload);
          items.push({
            entryId: String(payload.entryId || ""),
            taskId: String(payload.entryId || ""),
            title: String(payload.title || ""),
            ok: true,
            eventId: String(data?.result?.eventId || payload.eventId || ""),
            syncedAt: new Date().toISOString(),
          });
        } catch (error) {
          items.push({
            entryId: String(payload.entryId || ""),
            taskId: String(payload.entryId || ""),
            title: String(payload.title || ""),
            ok: false,
            error: error instanceof Error ? error.message : "Calendar 写入失败",
          });
        }
      }
      return { items };
    }

    function applyCalendarEntrySyncItems(items) {
      refreshDataRefs();
      const itemMap = new Map(normalizeArray(items).map((item) => [String(item?.entryId || item?.taskId || ""), item]));
      let succeeded = 0;
      let failed = 0;
      const nowIso = new Date().toISOString();
      for (const entry of entries) {
        const item = itemMap.get(String(entry?.id || ""));
        if (!item) continue;
        if (item.ok) {
          const syncedAt = String(item.syncedAt || nowIso);
          entry.externalId = String(item.eventId || entry.externalId || "");
          entry.calendarSynced = true;
          entry.calendarSyncState = "synced";
          entry.calendarLastSyncError = "";
          entry.calendarSyncedAt = syncedAt;
          entry.updatedAt = syncedAt;
          succeeded += 1;
        } else {
          entry.calendarSynced = false;
          entry.calendarSyncState = "error";
          entry.calendarLastSyncError = String(item.error || "同步失败");
          failed += 1;
        }
      }
      if (succeeded || failed) {
        saveEntries(entries, { skipSyncSchedule: true, skipUndoSnapshot: true });
      }
      return { succeeded, failed };
    }

    function buildConflictRecommendationFields(changedFields, local, remote) {
      const fields = {};
      for (const field of normalizeArray(changedFields)) {
        const localText = String(local?.[field] ?? "").trim();
        const remoteText = String(remote?.[field] ?? "").trim();
        if ((field === "title" || field === "note") && remoteText.length > localText.length) {
          fields[field] = "remote";
        } else {
          fields[field] = "local";
        }
      }
      return fields;
    }

    function buildPullGovernanceIssues(pullResult) {
      refreshDataRefs();
      const issues = [];
      for (const item of normalizeArray(pullResult?.conflictItems)) {
        const taskId = String(item?.taskId || "").trim();
        const todo = todos.find((entry) => String(entry?.id || "") === taskId);
        if (!todo) continue;
        const local = snapshotTodoForGovernance(todo);
        const remote = item?.remote && typeof item.remote === "object" ? { ...item.remote } : {};
        const changedFields = normalizeArray(item?.changedFields).filter((field) => field !== "externalCalendarId");
        issues.push({
          id: createIssueId("conflict", taskId),
          type: "conflict",
          taskId,
          subject: String(todo.title || remote.title || "待办事项"),
          local,
          remote,
          changedFields,
          message: "本地与 Calendar 都发生过修改，系统无法安全判断哪一侧应覆盖另一侧。",
          recommendation: {
            title: "优先保留 Todo 的当前内容，再写回 Calendar",
            reason: "Todo 是当前可见、可核对的数据；你也可以逐项选择 Calendar 的字段。",
            fields: buildConflictRecommendationFields(changedFields, local, remote),
          },
        });
      }

      if (pullResult?.deleteBlocked) {
        for (const item of normalizeArray(pullResult?.deleteItems)) {
          const taskId = String(item?.taskId || "").trim();
          const todo = todos.find((entry) => String(entry?.id || "") === taskId);
          if (!todo) continue;
          issues.push({
            id: createIssueId("missing", taskId),
            type: "missing",
            taskId,
            subject: String(todo.title || "待办事项"),
            local: snapshotTodoForGovernance(todo),
            remote: {},
            changedFields: [],
            message: formatRemoteDeleteGuardNotice(pullResult),
            recommendation: {
              title: "保留 Todo，并重新创建 Calendar 事件",
              reason: "当前无法确认这是主动删除还是读取不完整，先保留本地数据更安全。",
              fields: {},
            },
          });
        }
      }
      return issues;
    }

    function buildEntryImportGovernanceIssues(calendarSyncResult) {
      return normalizeArray(calendarSyncResult?.conflictItems).map((item, index) => {
        const entryId = String(item?.entryId || "").trim();
        const entry = entries.find((candidate) => String(candidate?.id || "") === entryId);
        const local = item?.local && typeof item.local === "object"
          ? { ...item.local }
          : snapshotEntryForGovernance(entry);
        const remote = item?.remote && typeof item.remote === "object" ? { ...item.remote } : {};
        const changedFields = normalizeArray(item?.changedFields).filter((field) => field !== "externalCalendarId");
        return {
          id: createIssueId("entry-conflict", entryId || index + 1),
          type: "conflict",
          source: "entry-calendar",
          entryId,
          subject: String(entry?.title || local.title || remote.title || "日历记录"),
          localLabel: "观时记录",
          remoteLabel: "Calendar",
          local,
          remote,
          changedFields,
          message: "观时记录与 Calendar 都发生过修改，未确认前不会覆盖任何一侧。",
          recommendation: {
            title: "优先保留观时记录，再写回 Calendar",
            reason: "观时保存了完成后的实际记录；你也可以逐项采用 Calendar 的内容。",
            fields: buildConflictRecommendationFields(changedFields, local, remote),
          },
        };
      });
    }

    function buildEntryFailureIssues(items, heading = "观时记录未能同步到 Calendar") {
      refreshDataRefs();
      return normalizeArray(items)
        .filter((item) => item && !item.ok)
        .map((item, index) => {
          const entryId = String(item?.entryId || item?.taskId || "").trim();
          const entry = entries.find((candidate) => String(candidate?.id || "") === entryId);
          return {
            id: createIssueId("failure", `entry-calendar-${entryId || index + 1}`),
            type: "failure",
            source: "entry-calendar",
            entryId,
            subject: String(entry?.title || item?.title || "日历记录"),
            heading,
            local: snapshotEntryForGovernance(entry),
            remote: {},
            changedFields: [],
            message: String(item?.error || "Calendar 写入失败"),
            recommendation: {
              title: "先保留观时记录，稍后重新同步",
              reason: "实际记录仍安全保存在观时中。",
              fields: {},
            },
          };
        });
    }

    function buildItemFailureIssues(
      items,
      {
        source = "calendar",
        heading = "这项数据未能完成同步",
        fallbackMessage = "同步失败",
        recommendationTitle = "先保留本地内容，处理原因后重新同步",
        recommendationReason = "本地数据没有丢失，重试成功后会继续同步到目标位置。",
      } = {},
    ) {
      refreshDataRefs();
      return normalizeArray(items)
        .filter((item) => item && !item.ok)
        .map((item, index) => {
          const taskId = String(item?.taskId || "").trim();
          const todo = todos.find((entry) => String(entry?.id || "") === taskId);
          return {
            id: createIssueId("failure", `${source}-${taskId || index + 1}`),
            type: "failure",
            source,
            taskId,
            subject: String(todo?.title || item?.title || "同步项目"),
            heading,
            local: snapshotTodoForGovernance(todo),
            remote: {},
            changedFields: [],
            message: String(item?.error || fallbackMessage),
            recommendation: {
              title: recommendationTitle,
              reason: recommendationReason,
              fields: {},
            },
          };
        });
    }

    function buildSystemFailureIssue(message, { source = "system", title = "同步服务异常" } = {}) {
      const detail = normalizeSyncErrorDetail(message);
      return {
        id: createIssueId("failure", source),
        type: "failure",
        source,
        taskId: "",
        subject: title,
        heading: title,
        local: {},
        remote: {},
        changedFields: [],
        message: detail,
        recommendation: {
          title: "保留现有数据，修复连接或权限后再同步",
          reason: "本次失败没有删除本地 Todo 或 Calendar 数据。",
          fields: {},
        },
      };
    }

    function dedupeGovernanceIssues(rawIssues) {
      const map = new Map();
      for (const issue of normalizeArray(rawIssues)) {
        if (!issue || typeof issue !== "object") continue;
        const id = String(issue.id || createIssueId(issue.type || "failure", map.size + 1));
        map.set(id, { ...issue, id });
      }
      return Array.from(map.values());
    }

    function publishSyncGovernanceIssues(rawIssues, { trigger = "automatic", completedCount = 0, open = false } = {}) {
      pendingSyncGovernanceIssues = dedupeGovernanceIssues(rawIssues);
      pendingSyncGovernanceCompletedCount = Math.max(0, Number(completedCount || 0));
      if (pendingSyncGovernanceIssues.length > 0) {
        topSyncRuntimeMessage = formatSyncGovernanceNotice(trigger, pendingSyncGovernanceIssues.length);
        topSyncRuntimeTone = "warning";
      } else {
        topSyncRuntimeMessage = "";
        topSyncRuntimeTone = "normal";
      }
      renderTopTodoSyncHub(getSelectedTodo());
      if (open && pendingSyncGovernanceIssues.length > 0) {
        openSyncGovernance({
          issues: pendingSyncGovernanceIssues,
          completedCount: pendingSyncGovernanceCompletedCount,
          trigger,
        });
      }
      return pendingSyncGovernanceIssues.length;
    }

    function hasPendingSyncGovernanceIssues() {
      return pendingSyncGovernanceIssues.length > 0;
    }

    function openPendingSyncGovernanceIssues() {
      if (!pendingSyncGovernanceIssues.length) return false;
      return openSyncGovernance({
        issues: pendingSyncGovernanceIssues,
        completedCount: pendingSyncGovernanceCompletedCount,
        trigger: "automatic",
      });
    }

    function removePendingSyncGovernanceIssue(issueId) {
      const id = String(issueId || "").trim();
      pendingSyncGovernanceIssues = pendingSyncGovernanceIssues.filter((issue) => String(issue.id) !== id);
      if (pendingSyncGovernanceIssues.length > 0) {
        topSyncRuntimeMessage = `仍有 ${pendingSyncGovernanceIssues.length} 个同步问题，点击处理`;
        topSyncRuntimeTone = "warning";
      } else {
        topSyncRuntimeMessage = "";
        topSyncRuntimeTone = "normal";
        markRuntimeSyncCompleted();
      }
      renderTopTodoSyncHub(getSelectedTodo());
    }

    function applyRemoteChoicesToTodo(todo, remote, choices) {
      const allowedFields = ["title", "dueDate", "startTime", "endTime", "note", "qualityScore", "happinessScore"];
      for (const field of allowedFields) {
        if (String(choices?.[field] || "local") !== "remote") continue;
        if (!Object.prototype.hasOwnProperty.call(remote || {}, field)) continue;
        todo[field] = remote[field];
      }
      todo.syncState = "dirty";
      todo.calendarSynced = false;
      todo.lastSyncError = "";
      todo.updatedAt = new Date().toISOString();
    }

    function applyRemoteChoicesToEntry(entry, remote, choices) {
      const fieldMap = {
        title: "title",
        dueDate: "date",
        startTime: "start",
        endTime: "end",
        note: "note",
        qualityScore: "quality",
        happinessScore: "happiness",
      };
      for (const [field, entryField] of Object.entries(fieldMap)) {
        if (String(choices?.[field] || "local") !== "remote") continue;
        if (!Object.prototype.hasOwnProperty.call(remote || {}, field)) continue;
        entry[entryField] = remote[field];
      }
      entry.calendarSynced = false;
      entry.calendarSyncState = "dirty";
      entry.calendarLastSyncError = "";
      entry.updatedAt = new Date().toISOString();
    }

    async function syncSingleTodoToCalendar(todo) {
      const normalized = buildTodoSyncRequest(todo);
      if (!normalized.ok) return { resolved: false, message: normalized.message || "待办数据不完整。" };
      const result = await syncTodoTasksToMacCalendar([normalized.value]);
      applyTodoTaskSyncItems(result.items);
      const item = normalizeArray(result.items).find((entry) => String(entry?.taskId || "") === String(todo.id));
      if (!item?.ok) return { resolved: false, message: String(item?.error || "Calendar 写入失败") };
      return { resolved: true };
    }

    async function syncSingleEntryToCalendar(entry) {
      const normalized = buildCalendarEntrySyncRequest(entry);
      if (!normalized.ok) return { resolved: false, message: normalized.message || "日历记录数据不完整。" };
      const result = await syncCalendarEntriesToMacCalendar([normalized.value]);
      applyCalendarEntrySyncItems(result.items);
      const item = normalizeArray(result.items)[0];
      if (!item?.ok) return { resolved: false, message: String(item?.error || "Calendar 写入失败") };
      return { resolved: true };
    }

    function buildOverdueCalendarCleanupTasks() {
      refreshDataRefs();
      return todos
        .filter(
          (todo) =>
            !todo?.completed &&
            isTodoOverdue(todo) &&
            String(todo.externalCalendarId || "").trim(),
        )
        .map((todo) => ({
          taskId: String(todo.id || "").trim(),
          eventId: String(todo.externalCalendarId || "").trim(),
        }))
        .filter((item) => item.taskId && item.eventId);
    }

    function stageOverdueCalendarCleanup() {
      const cleanupTasks = buildOverdueCalendarCleanupTasks();
      if (!cleanupTasks.length) return { staged: 0, tasks: [] };
      const nowIso = new Date().toISOString();
      const stagedTasks = [];

      for (const task of cleanupTasks) {
        const todo = todos.find((candidate) => String(candidate?.id || "") === task.taskId);
        if (!todo || !enqueueTodoCalendarDelete(todo, nowIso)) continue;
        todo.externalCalendarId = "";
        todo.calendarSynced = true;
        todo.syncState = "synced";
        todo.lastSyncError = "";
        todo.syncedAt = nowIso;
        todo.updatedAt = nowIso;
        stagedTasks.push(task);
      }

      if (stagedTasks.length) {
        saveTodos(todos, { skipSyncSchedule: true, skipUndoSnapshot: true });
      }
      return { staged: stagedTasks.length, tasks: stagedTasks };
    }

    async function resolveSyncGovernanceIssue({ action, issue, choices } = {}) {
      const taskId = String(issue?.taskId || "").trim();
      const entryId = String(issue?.entryId || "").trim();
      refreshDataRefs();
      const todo = todos.find((entry) => String(entry?.id || "") === taskId);
      const calendarEntry = entries.find((entry) => String(entry?.id || "") === entryId);

      if (action === "copy-error") {
        const copied = await copyTextToClipboard(`${issue?.heading || issue?.subject || "同步失败"}：${issue?.message || "未知错误"}`);
        return { resolved: false, message: copied ? "错误信息已复制。" : "复制失败。" };
      }

      if (action === "delete-local") {
        if (!taskId || !todo) return { resolved: false, message: "未找到对应 Todo。" };
        const removed = deleteTodoByTaskId(taskId, { queueRemoteDelete: false, timestampIso: new Date().toISOString() });
        if (!removed) return { resolved: false, message: "Todo 删除失败，请刷新后重试。" };
        removePendingSyncGovernanceIssue(issue.id);
        render();
        return { resolved: true };
      }

      if (action === "recreate-calendar") {
        if (!todo) return { resolved: false, message: "未找到对应 Todo。" };
        todo.externalCalendarId = "";
        todo.syncState = "dirty";
        todo.calendarSynced = false;
        todo.updatedAt = new Date().toISOString();
        saveTodos(todos, { skipSyncSchedule: true, skipUndoSnapshot: true });
        const result = await syncSingleTodoToCalendar(todo);
        if (result.resolved) removePendingSyncGovernanceIssue(issue.id);
        render();
        return result;
      }

      if (action === "apply-recommendation" || action === "keep-todo") {
        if (calendarEntry) {
          applyRemoteChoicesToEntry(calendarEntry, issue?.remote || {}, choices || {});
          saveEntries(entries, { skipSyncSchedule: true, skipUndoSnapshot: true });
          const result = await syncSingleEntryToCalendar(calendarEntry);
          if (result.resolved) removePendingSyncGovernanceIssue(issue.id);
          render();
          return result;
        }
        if (!todo) return { resolved: false, message: "未找到对应 Todo。" };
        applyRemoteChoicesToTodo(todo, issue?.remote || {}, choices || {});
        saveTodos(todos, { skipSyncSchedule: true, skipUndoSnapshot: true });
        const result = await syncSingleTodoToCalendar(todo);
        if (result.resolved) removePendingSyncGovernanceIssue(issue.id);
        render();
        return result;
      }

      if (action === "retry") {
        if (calendarEntry) {
          calendarEntry.calendarSyncState = "dirty";
          calendarEntry.calendarSynced = false;
          const result = await syncSingleEntryToCalendar(calendarEntry);
          if (result.resolved) removePendingSyncGovernanceIssue(issue.id);
          render();
          return result;
        }
        if (todo && String(issue?.source || "") === "reminder") {
          const normalized = buildTodoReminderSyncRequest(todo);
          if (!normalized.ok) return { resolved: false, message: normalized.message || "提醒数据不完整。" };
          const result = await syncTodoTasksToMacReminders([normalized.value]);
          applyTodoReminderSyncItems(result.items);
          const item = normalizeArray(result.items)[0];
          if (!item?.ok) return { resolved: false, message: String(item?.error || "提醒写入失败") };
          removePendingSyncGovernanceIssue(issue.id);
          render();
          return { resolved: true };
        }
        if (String(issue?.source || "") === "calendar-delete") {
          const deleteTasks = buildTodoDeleteSyncRequests().filter(
            (item) => !taskId || String(item?.taskId || "") === taskId,
          );
          if (!deleteTasks.length) {
            removePendingSyncGovernanceIssue(issue.id);
            render();
            return { resolved: true };
          }
          const result = await deleteTodoTasksFromMacCalendar(deleteTasks);
          applyTodoTaskDeleteSyncItems(result.items);
          const failedItem = normalizeArray(result.items).find((item) => item && !item.ok);
          if (failedItem) return { resolved: false, message: String(failedItem.error || "Calendar 删除失败") };
          removePendingSyncGovernanceIssue(issue.id);
          render();
          return { resolved: true };
        }
        if (todo) {
          todo.syncState = "dirty";
          const result = await syncSingleTodoToCalendar(todo);
          if (result.resolved) removePendingSyncGovernanceIssue(issue.id);
          render();
          return result;
        }
        try {
          const pullResult = await pullTodosFromMacCalendar({ manual: false, triggerExport: true });
          if (pullResult?.fallback) await syncMacCalendarEvents({ manual: false, triggerExport: true });
          removePendingSyncGovernanceIssue(issue.id);
          render();
          return { resolved: true };
        } catch (error) {
          return { resolved: false, message: error instanceof Error ? error.message : "重试失败" };
        }
      }
      return { resolved: false, message: "暂不支持该处理方式。" };
    }

    async function runManualTopRefreshSync() {
      if (autoBidirectionalSyncRunning) {
        window.alert("同步正在进行中，请稍候再试。");
        return;
      }

      if (topSyncRefreshBtn) topSyncRefreshBtn.disabled = true;
      topSyncRuntimeMessage = "正在刷新同步…";
      topSyncRuntimeTone = "normal";
      renderTopTodoSyncHub(getSelectedTodo());

      const syncWork = collectDirtyTodoSyncWork();
      const governanceIssues = [...syncWork.validationIssues];
      let completedCount = 0;

      try {
        if (syncWork.reminderCompleteTasks.length) {
          try {
            const result = await completeTodoTasksInMacReminders(syncWork.reminderCompleteTasks);
            const summary = applyTodoReminderCompleteItems(result.items);
            completedCount += summary.succeeded;
            governanceIssues.push(...buildItemFailureIssues(result.items, {
              source: "reminder",
              heading: "提醒完成状态未能同步",
              fallbackMessage: "提醒完成同步失败",
            }));
          } catch (error) {
            governanceIssues.push(buildSystemFailureIssue(
              error instanceof Error ? error.message : "提醒完成同步失败",
              { source: "reminder", title: "提醒完成状态未能同步" },
            ));
          }
        }

        if (syncWork.deletePayloads.length) {
          try {
            const result = await deleteTodoTasksFromMacCalendar(syncWork.deletePayloads);
            const summary = applyTodoTaskDeleteSyncItems(result.items);
            completedCount += summary.succeeded;
            governanceIssues.push(...buildItemFailureIssues(result.items, {
              source: "calendar-delete",
              heading: "Calendar 事件未能删除",
              fallbackMessage: "Calendar 删除同步失败",
            }));
          } catch (error) {
            governanceIssues.push(buildSystemFailureIssue(
              error instanceof Error ? error.message : "Calendar 删除同步失败",
              { source: "calendar-delete", title: "Calendar 事件未能删除" },
            ));
          }
        }

        if (syncWork.preparedTasks.length) {
          try {
            const result = await syncTodoTasksToMacCalendar(syncWork.preparedTasks);
            const summary = applyTodoTaskSyncItems(result.items);
            completedCount += summary.succeeded;
            governanceIssues.push(...buildItemFailureIssues(result.items, {
              source: "calendar",
              heading: "Todo 未能写入 Calendar",
              fallbackMessage: "Calendar 写入失败",
            }));
          } catch (error) {
            governanceIssues.push(buildSystemFailureIssue(
              error instanceof Error ? error.message : "Calendar 写入失败",
              { source: "calendar", title: "Todo 未能写入 Calendar" },
            ));
          }
        }

        if (syncWork.preparedReminderTasks.length) {
          try {
            const result = await syncTodoTasksToMacReminders(syncWork.preparedReminderTasks);
            const summary = applyTodoReminderSyncItems(result.items);
            completedCount += summary.succeeded;
            governanceIssues.push(...buildItemFailureIssues(result.items, {
              source: "reminder",
              heading: "Todo 未能写入提醒事项",
              fallbackMessage: "提醒写入失败",
            }));
          } catch (error) {
            governanceIssues.push(buildSystemFailureIssue(
              error instanceof Error ? error.message : "提醒写入失败",
              { source: "reminder", title: "Todo 未能写入提醒事项" },
            ));
          }
        }

        if (syncWork.reminderDisableTasks.length) {
          try {
            const result = await completeTodoTasksInMacReminders(syncWork.reminderDisableTasks);
            const summary = applyTodoReminderCompleteItems(result.items);
            applyQueuedTodoReminderDisableSyncItems(result.items);
            completedCount += summary.succeeded;
            governanceIssues.push(...buildItemFailureIssues(result.items, {
              source: "reminder",
              heading: "提醒关闭状态未能同步",
              fallbackMessage: "提醒关闭同步失败",
            }));
          } catch (error) {
            governanceIssues.push(buildSystemFailureIssue(
              error instanceof Error ? error.message : "提醒关闭同步失败",
              { source: "reminder", title: "提醒关闭状态未能同步" },
            ));
          }
        }

        const pullResult = await pullTodosFromMacCalendar({ manual: true, triggerExport: true });
        completedCount += Number(pullResult?.updated || 0) + Number(pullResult?.deleted || 0);
        governanceIssues.push(...buildPullGovernanceIssues(pullResult));

        const calendarSyncResult = await syncMacCalendarEvents({
          manual: false,
          triggerExport: Boolean(pullResult?.fallback),
        });
        completedCount += Number(calendarSyncResult?.added || 0)
          + Number(calendarSyncResult?.updated || 0)
          + Number(calendarSyncResult?.todoAdded || 0)
          + Number(calendarSyncResult?.todoUpdated || 0);
        governanceIssues.push(...buildEntryImportGovernanceIssues(calendarSyncResult));
        if (calendarSyncResult?.error) {
          governanceIssues.push(buildSystemFailureIssue(calendarSyncResult.error, {
            source: "calendar-import",
            title: "Calendar 数据读取失败",
          }));
        }

        const entrySyncWork = collectDirtyCalendarEntrySyncWork({ includeLegacy: true });
        governanceIssues.push(...entrySyncWork.validationIssues);
        if (entrySyncWork.preparedEntries.length) {
          const entrySyncResult = await syncCalendarEntriesToMacCalendar(entrySyncWork.preparedEntries);
          const entrySummary = applyCalendarEntrySyncItems(entrySyncResult.items);
          completedCount += entrySummary.succeeded;
          governanceIssues.push(...buildEntryFailureIssues(entrySyncResult.items));
        }

        render();
        markRuntimeSyncCompleted();
      } catch (error) {
        governanceIssues.push(buildSystemFailureIssue(
          error instanceof Error ? error.message : "未知错误",
          { source: "system", title: "刷新同步失败" },
        ));
      } finally {
        publishSyncGovernanceIssues(governanceIssues, {
          trigger: "manual",
          completedCount,
          open: true,
        });
        if (!governanceIssues.length) {
          setCalendarSyncStatus(`同步完成：${completedCount} 项数据已更新`, "success");
        }
        if (topSyncRefreshBtn) topSyncRefreshBtn.disabled = false;
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
      publishSyncGovernanceIssues([
        buildSystemFailureIssue(detail, { source: "system", title: summary }),
      ], {
        trigger: "manual",
        completedCount: 0,
        open: true,
      });
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
      const overdueCleanup = stageOverdueCalendarCleanup();
      const candidates = todos.filter(
        (todo) =>
          !todo.completed &&
          !isTodoOverdue(todo) &&
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
      const validationIssues = [];
      let reminderStatePatched = false;
      const nowIso = new Date().toISOString();
      for (const todo of candidates) {
        const normalized = buildTodoSyncRequest(todo);
        if (normalized.ok) {
          preparedTasks.push(normalized.value);
        } else {
          skipped += 1;
          validationIssues.push({
            id: createIssueId("failure", `calendar-validation-${todo.id}`),
            type: "failure",
            source: "calendar",
            taskId: String(todo.id || ""),
            subject: String(todo.title || "待办事项"),
            heading: "Todo 暂时无法同步到 Calendar",
            local: snapshotTodoForGovernance(todo),
            remote: {},
            changedFields: [],
            message: String(normalized.message || "待办数据不完整。"),
            recommendation: {
              title: "先保留 Todo，补齐日期或时间后重试",
              reason: "本地数据没有丢失，修正字段后可以继续同步。",
              fields: {},
            },
          });
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
          } else {
            validationIssues.push({
              id: createIssueId("failure", `reminder-validation-${todo.id}`),
              type: "failure",
              source: "reminder",
              taskId: String(todo.id || ""),
              subject: String(todo.title || "待办事项"),
              heading: "Todo 暂时无法同步到提醒事项",
              local: snapshotTodoForGovernance(todo),
              remote: {},
              changedFields: [],
              message: String(normalized.message || "提醒数据不完整。"),
              recommendation: {
                title: "先保留 Todo，修正提醒时间后重试",
                reason: "本地数据没有丢失，修正后可以继续同步提醒。",
                fields: {},
              },
            });
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
        overdueCleanupStaged: overdueCleanup.staged,
        skipped,
        reminderSkipped,
        reminderCompleteSkipped,
        reminderDisableSkipped,
        validationIssues,
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
      let completedCount = 0;
      const governanceIssues = [...pendingSyncGovernanceIssues];
      try {
        const syncWork = collectDirtyTodoSyncWork();
        governanceIssues.push(...syncWork.validationIssues);

        if (syncWork.reminderCompleteTasks.length > 0) {
          try {
            const result = await completeTodoTasksInMacReminders(syncWork.reminderCompleteTasks);
            const summary = applyTodoReminderCompleteItems(result.items);
            completedCount += summary.succeeded;
            governanceIssues.push(...buildItemFailureIssues(result.items, {
              source: "reminder",
              heading: "提醒完成状态未能自动同步",
            }));
          } catch (error) {
            governanceIssues.push(buildSystemFailureIssue(
              error instanceof Error ? error.message : "提醒完成同步失败",
              { source: "reminder", title: "提醒完成状态未能自动同步" },
            ));
          }
        }

        if (syncWork.deletePayloads.length > 0) {
          const result = await deleteTodoTasksFromMacCalendar(syncWork.deletePayloads);
          const summary = applyTodoTaskDeleteSyncItems(result.items);
          completedCount += summary.succeeded;
          governanceIssues.push(...buildItemFailureIssues(result.items, {
            source: "calendar-delete",
            heading: "Calendar 事件未能自动删除",
          }));
        }

        if (syncWork.preparedTasks.length > 0) {
          const result = await syncTodoTasksToMacCalendar(syncWork.preparedTasks);
          const summary = applyTodoTaskSyncItems(result.items);
          completedCount += summary.succeeded;
          governanceIssues.push(...buildItemFailureIssues(result.items, {
            source: "calendar",
            heading: "Todo 未能自动写入 Calendar",
          }));
        }
        if (syncWork.preparedReminderTasks.length > 0) {
          const result = await syncTodoTasksToMacReminders(syncWork.preparedReminderTasks);
          const summary = applyTodoReminderSyncItems(result.items);
          completedCount += summary.succeeded;
          governanceIssues.push(...buildItemFailureIssues(result.items, {
            source: "reminder",
            heading: "Todo 未能自动写入提醒事项",
          }));
        }
        if (syncWork.reminderDisableTasks.length > 0) {
          const result = await completeTodoTasksInMacReminders(syncWork.reminderDisableTasks);
          const summary = applyTodoReminderCompleteItems(result.items);
          applyQueuedTodoReminderDisableSyncItems(result.items);
          completedCount += summary.succeeded;
          governanceIssues.push(...buildItemFailureIssues(result.items, {
            source: "reminder",
            heading: "提醒关闭状态未能自动同步",
          }));
        }

        const pullResult = await pullTodosFromMacCalendar({ manual: false, triggerExport: true });
        completedCount += Number(pullResult?.updated || 0);
        governanceIssues.push(...buildPullGovernanceIssues(pullResult));
        if (!pullResult.fallback) {
          const calendarSyncResult = await syncMacCalendarEvents({ manual: false, triggerExport: false });
          completedCount += Number(calendarSyncResult?.added || 0)
            + Number(calendarSyncResult?.updated || 0)
            + Number(calendarSyncResult?.todoAdded || 0)
            + Number(calendarSyncResult?.todoUpdated || 0);
          governanceIssues.push(...buildEntryImportGovernanceIssues(calendarSyncResult));
          if (calendarSyncResult?.error) {
            governanceIssues.push(buildSystemFailureIssue(calendarSyncResult.error, {
              source: "calendar-import",
              title: "Calendar 数据自动读取失败",
            }));
          }
        }
        const entrySyncWork = collectDirtyCalendarEntrySyncWork({ includeLegacy: false });
        governanceIssues.push(...entrySyncWork.validationIssues);
        if (entrySyncWork.preparedEntries.length) {
          const entrySyncResult = await syncCalendarEntriesToMacCalendar(entrySyncWork.preparedEntries);
          const entrySummary = applyCalendarEntrySyncItems(entrySyncResult.items);
          completedCount += entrySummary.succeeded;
          governanceIssues.push(...buildEntryFailureIssues(entrySyncResult.items, "观时记录未能自动同步到 Calendar"));
        }
        markRuntimeSyncCompleted();
      } catch (error) {
        const message = error instanceof Error ? error.message : "未知错误";
        setCalendarSyncStatus(`自动同步失败：${message}`, "warning");
        governanceIssues.push(buildSystemFailureIssue(message, {
          source: "system",
          title: "自动同步失败",
        }));
      } finally {
        publishSyncGovernanceIssues(governanceIssues, {
          trigger: "automatic",
          completedCount,
          open: false,
        });
        autoBidirectionalSyncRunning = false;
        if (autoBidirectionalSyncPending) {
          autoBidirectionalSyncPending = false;
          scheduleAutoBidirectionalSync(`${reason}-queued`, 300);
        }
      }
    }
    
    async function triggerMacCalendarExportOnce() {
      const response = await globalScope.fetch(EXTERNAL_CALENDAR_SYNC_TRIGGER_URL, {
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
          conflictItems: [],
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
    
        const response = await globalScope.fetch(`${EXTERNAL_CALENDAR_SYNC_URL}?t=${Date.now()}`, {
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
          saveEntries(entries, { skipSyncSchedule: true, skipUndoSnapshot: true });
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
          conflictItems: normalizeArray(result.conflicts),
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
          conflictItems: [],
          changed: false,
          busy: false,
          error: normalizeSyncErrorDetail(message),
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
      buildOverdueCalendarCleanupTasks,
      stageOverdueCalendarCleanup,
      buildCalendarEntrySyncRequest,
      collectDirtyCalendarEntrySyncWork,
      syncCalendarEntriesToMacCalendar,
      applyCalendarEntrySyncItems,
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
      hasPendingSyncGovernanceIssues,
      openPendingSyncGovernanceIssues,
      resolveSyncGovernanceIssue,
      isSyncRunning,
      cancelPendingAutoSync,
    };
  }

  globalScope.TimeQualitySyncRuntimeModule = {
    createSyncRuntimeModule,
    formatRemoteDeleteGuardNotice,
    formatSyncGovernanceNotice,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = globalScope.TimeQualitySyncRuntimeModule;
  }
})(typeof window !== "undefined" ? window : globalThis);
