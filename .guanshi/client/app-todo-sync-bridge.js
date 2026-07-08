/* global window */

(function attachTimeQualityTodoSyncBridgeModule(globalScope) {
  "use strict";

  function requireFunction(deps, key) {
    const value = deps[key];
    if (typeof value !== "function") {
      throw new Error(`TimeQualityTodoSyncBridgeModule missing required function dependency: ${key}`);
    }
    return value;
  }

  function createTodoSyncBridgeModule(deps = {}) {
    const formatMinutesForInput = requireFunction(deps, "formatMinutesForInput");
    const calcDurationHours = requireFunction(deps, "calcDurationHours");
    const addMinutesToClock = requireFunction(deps, "addMinutesToClock");
    const getSyncCalendarTargetPayload = requireFunction(deps, "getSyncCalendarTargetPayload");
    const getSyncReminderTargetPayload =
      typeof deps.getSyncReminderTargetPayload === "function"
        ? deps.getSyncReminderTargetPayload
        : () => ({});
    const getTodoReminderDefaultLeadMinutes =
      typeof deps.getTodoReminderDefaultLeadMinutes === "function"
        ? deps.getTodoReminderDefaultLeadMinutes
        : () => undefined;
    const getTodoCategory = requireFunction(deps, "getTodoCategory");
    const parseOptionalScore = requireFunction(deps, "parseOptionalScore");
    const isValidDateInput = requireFunction(deps, "isValidDateInput");
    const isValidClockInput = requireFunction(deps, "isValidClockInput");
    const buildTodoCalendarNote = requireFunction(deps, "buildTodoCalendarNote");
    const saveTodos = requireFunction(deps, "saveTodos");
    const scheduleAutoBidirectionalSync = requireFunction(deps, "scheduleAutoBidirectionalSync");
    const getTodos = requireFunction(deps, "getTodos");
    const getPendingTodoCalendarDeletes = requireFunction(deps, "getPendingTodoCalendarDeletes");
    const setPendingTodoCalendarDeletes = requireFunction(deps, "setPendingTodoCalendarDeletes");
    const pushCalendarEventPayload = requireFunction(deps, "pushCalendarEventPayload");
    const normalizeTodoReminderDisableItem = requireFunction(deps, "normalizeTodoReminderDisableItem");
    const getPendingTodoReminderDisables = requireFunction(deps, "getPendingTodoReminderDisables");
    const saveTodoReminderDisableQueue = requireFunction(deps, "saveTodoReminderDisableQueue");

    const TODO_PLAN_DAY_FIRST_START_MINUTES = Number(deps.TODO_PLAN_DAY_FIRST_START_MINUTES) || 0;
    const TODO_REMINDER_DEFAULT_LEAD_MINUTES = Number.isFinite(Number(deps.TODO_REMINDER_DEFAULT_LEAD_MINUTES))
      ? Math.max(0, Number(deps.TODO_REMINDER_DEFAULT_LEAD_MINUTES))
      : 5;
    const EXTERNAL_TASK_SYNC_URL = String(deps.EXTERNAL_TASK_SYNC_URL || "").trim();
    const EXTERNAL_TASK_DELETE_URL = String(deps.EXTERNAL_TASK_DELETE_URL || "").trim();
    const EXTERNAL_TASK_REMINDER_SYNC_URL = String(deps.EXTERNAL_TASK_REMINDER_SYNC_URL || "").trim();
    const EXTERNAL_TASK_REMINDER_COMPLETE_URL = String(deps.EXTERNAL_TASK_REMINDER_COMPLETE_URL || "").trim();
    const TODO_DELETE_QUEUE_STORAGE_KEY = String(deps.TODO_DELETE_QUEUE_STORAGE_KEY || "").trim();
    const localStorageRef = deps.localStorageRef || (globalScope.localStorage || null);

    function resolveFetch() {
      if (typeof deps.fetchFn === "function") return deps.fetchFn;
      if (typeof globalScope.fetch === "function") return globalScope.fetch.bind(globalScope);
      throw new Error("Fetch API is unavailable in current runtime.");
    }

    function buildTodoSyncRequest(todo) {
      if (!todo || !String(todo.id || "").trim()) {
        return { ok: false, message: "待办数据无效，请重新创建任务后再同步。" };
      }
      if (!String(todo.dueDate || "").trim()) {
        return { ok: false, message: "请先填写截止日期后再同步。" };
      }

      const start = String(todo.startTime || "").trim() || formatMinutesForInput(TODO_PLAN_DAY_FIRST_START_MINUTES);
      const end = String(todo.endTime || "").trim() || addMinutesToClock(start, Number(todo.estimatedMinutes) || 60);
      const duration = calcDurationHours(start, end);
      if (!duration || duration <= 0) {
        return { ok: false, message: "时间段无效，请检查开始/结束时间。" };
      }

      const syncTarget = getSyncCalendarTargetPayload();
      return {
        ok: true,
        value: {
          taskId: String(todo.id),
          title: String(todo.title || "待办事项").trim(),
          date: String(todo.dueDate),
          start,
          end,
          duration,
          category: getTodoCategory(todo, todo.project),
          quality: parseOptionalScore(todo.qualityScore),
          happiness: parseOptionalScore(todo.happinessScore),
          sourceId: String(todo.id || ""),
          eventId: String(todo.externalCalendarId || ""),
          note: buildTodoCalendarNote(todo),
          calendarId: String(syncTarget.calendarId || ""),
          calendarName: String(syncTarget.calendarName || ""),
        },
      };
    }

    function formatDatePart(value) {
      return String(value).padStart(2, "0");
    }

    function formatDateForPayload(date) {
      return `${date.getFullYear()}-${formatDatePart(date.getMonth() + 1)}-${formatDatePart(date.getDate())}`;
    }

    function formatClockForPayload(date) {
      return `${formatDatePart(date.getHours())}:${formatDatePart(date.getMinutes())}`;
    }

    function parseReminderDateTime(value) {
      const raw = String(value || "").trim();
      if (!raw) return null;

      const normalized = raw.replace(" ", "T");
      const directMatch = normalized.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
      if (directMatch && isValidDateInput(directMatch[1]) && isValidClockInput(directMatch[2])) {
        const dateObj = new Date(`${directMatch[1]}T${directMatch[2]}:00`);
        return {
          date: directMatch[1],
          time: directMatch[2],
          dateObj: Number.isNaN(dateObj.getTime()) ? null : dateObj,
        };
      }

      const parsed = new Date(normalized);
      if (!Number.isNaN(parsed.getTime())) {
        const date = formatDateForPayload(parsed);
        const time = formatClockForPayload(parsed);
        if (isValidDateInput(date) && isValidClockInput(time)) {
          return { date, time, dateObj: parsed };
        }
      }
      return null;
    }

    function normalizeReminderRepeat(value) {
      const text = String(value || "").trim().toLowerCase();
      if (!text || text === "none" || text === "off") return "none";
      if (text === "once" || text === "single") return "once";
      if (text === "daily" || text === "weekly" || text === "monthly") return text;
      return "none";
    }

    function formatReminderRepeatLabel(value) {
      const repeat = normalizeReminderRepeat(value);
      if (repeat === "once") return "单次";
      if (repeat === "daily") return "每天";
      if (repeat === "weekly") return "每周";
      if (repeat === "monthly") return "每月";
      return "不提醒";
    }

    function buildDateFromDateClock(dateText, clockText) {
      if (!isValidDateInput(dateText) || !isValidClockInput(clockText)) return null;
      const candidate = new Date(`${dateText}T${clockText}:00`);
      if (Number.isNaN(candidate.getTime())) return null;
      return candidate;
    }

    function normalizeReminderLeadMinutes(value) {
      const parsed = Number.parseInt(String(value ?? ""), 10);
      if (!Number.isFinite(parsed)) return TODO_REMINDER_DEFAULT_LEAD_MINUTES;
      if (parsed <= 0) return 0;
      return Math.min(120, Math.max(0, parsed));
    }

    function buildReminderAlarmAt(dueDate, dueTime, { explicitReminderTime = false } = {}) {
      const dueAt = buildDateFromDateClock(dueDate, dueTime);
      if (!dueAt) return "";

      if (explicitReminderTime) {
        return dueAt.toISOString();
      }

      const leadMinutes = normalizeReminderLeadMinutes(getTodoReminderDefaultLeadMinutes());
      if (leadMinutes <= 0) {
        return "";
      }
      const alarmAt = new Date(dueAt.getTime() - leadMinutes * 60 * 1000);
      return alarmAt.toISOString();
    }

    function buildTodoReminderNote(todo) {
      const lines = [];
      const project = String(todo?.project || "").trim();
      const category = String(getTodoCategory(todo, todo?.project) || "").trim();
      const repeat = normalizeReminderRepeat(todo?.repeat);
      const note = String(todo?.note || "").trim();

      if (project) {
        lines.push(`项目: ${project}`);
      }
      if (category) {
        lines.push(`分类: ${category}`);
      }
      if (repeat && repeat !== "none") {
        lines.push(`提醒频率: ${formatReminderRepeatLabel(repeat)}`);
      }
      if (note) {
        lines.push(`备注: ${note}`);
      }
      return lines.join("\n").slice(0, 1000);
    }

    function buildTodoReminderSyncRequest(todo) {
      if (!todo || !String(todo.id || "").trim()) {
        return { ok: false, code: "INVALID_TODO", message: "待办数据无效，请重新创建任务后再同步提醒。" };
      }
      if (!String(todo.dueDate || "").trim()) {
        return { ok: false, code: "MISSING_DUE_DATE", message: "请先填写截止日期后再同步提醒。" };
      }
      if (!isValidDateInput(String(todo.dueDate || "").trim())) {
        return { ok: false, code: "INVALID_DUE_DATE", message: "截止日期格式无效，请使用 YYYY-MM-DD。" };
      }

      const repeat = normalizeReminderRepeat(todo?.repeat);
      if (repeat === "none") {
        return { ok: false, code: "REMINDER_DISABLED", message: "当前任务已设置为不提醒。" };
      }

      const reminderToken = parseReminderDateTime(todo.reminder);
      const todoDueDate = String(todo.dueDate || "").trim();
      const dueDate = repeat === "once"
        ? (reminderToken?.date || todoDueDate)
        : (todoDueDate || reminderToken?.date || "");
      const dueTime = reminderToken?.time || (
        isValidClockInput(String(todo.startTime || "").trim())
          ? String(todo.startTime || "").trim()
          : formatMinutesForInput(TODO_PLAN_DAY_FIRST_START_MINUTES)
      );

      if (!isValidDateInput(dueDate)) {
        return { ok: false, code: "INVALID_REMINDER_DATE", message: "提醒日期无效，请检查截止日期或提醒时间。" };
      }
      if (!isValidClockInput(dueTime)) {
        return { ok: false, code: "INVALID_REMINDER_TIME", message: "提醒时间无效，请检查开始时间或提醒时间格式。" };
      }

      const dueAt = buildDateFromDateClock(dueDate, dueTime);
      if (repeat === "once" && dueAt && dueAt.getTime() <= Date.now() - 15000) {
        return {
          ok: false,
          code: "REMINDER_TIME_IN_PAST",
          message: "单次提醒时间早于当前时间，已跳过同步。",
        };
      }

      const syncTarget = getSyncReminderTargetPayload();
      const alarmAt = buildReminderAlarmAt(dueDate, dueTime, {
        explicitReminderTime: Boolean(reminderToken?.dateObj),
      });

      return {
        ok: true,
        value: {
          taskId: String(todo.id),
          title: String(todo.title || "待办事项").trim().slice(0, 120),
          dueDate,
          dueTime,
          alarmAt,
          note: buildTodoReminderNote(todo),
          sourceId: String(todo.id || ""),
          reminderId: String(todo.externalReminderId || "").trim(),
          repeat,
          calendarId: String(syncTarget.calendarId || ""),
          calendarName: String(syncTarget.calendarName || ""),
        },
      };
    }

    function buildTodoReminderCompleteRequest(todo, options = {}) {
      const taskId = String(todo?.id || "").trim();
      if (!taskId) {
        return { ok: false, message: "待办数据无效，无法同步完成状态。" };
      }

      const reminderId = String(todo?.externalReminderId || "").trim();
      const action = String(options?.action || "complete").trim() === "disable" ? "disable" : "complete";

      return {
        ok: true,
        value: {
          taskId,
          reminderId,
          sourceId: taskId,
          action,
          completedAt:
            action === "complete"
              ? String(todo?.completedAt || new Date().toISOString())
              : new Date().toISOString(),
        },
      };
    }

    async function syncTodoTasksByLegacyPushApi(taskPayloads) {
      const items = [];
      for (const payload of taskPayloads) {
        try {
          const data = await pushCalendarEventPayload(payload);
          items.push({
            taskId: String(payload.taskId),
            ok: true,
            eventId: String(data?.result?.eventId || ""),
            calendar: String(data?.result?.calendar || ""),
            syncedAt: new Date().toISOString(),
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown push error";
          items.push({
            taskId: String(payload.taskId),
            ok: false,
            error: message,
          });
        }
      }

      return { items, legacy: true };
    }

    async function syncTodoTasksToMacCalendar(taskPayloads) {
      if (!Array.isArray(taskPayloads) || !taskPayloads.length) {
        return { items: [] };
      }

      const fetchFn = resolveFetch();
      let response = null;
      try {
        response = await fetchFn(EXTERNAL_TASK_SYNC_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ tasks: taskPayloads }),
        });
      } catch {
        throw new Error("无法连接本地同步服务，请先运行 node server.js。");
      }

      if (response.status === 404 || response.status === 405) {
        return syncTodoTasksByLegacyPushApi(taskPayloads);
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

      const items = Array.isArray(data?.result?.items) ? data.result.items : [];
      return { items };
    }

    async function deleteTodoTasksFromMacCalendar(taskPayloads) {
      if (!Array.isArray(taskPayloads) || !taskPayloads.length) {
        return { items: [] };
      }

      const fetchFn = resolveFetch();
      let response = null;
      try {
        response = await fetchFn(EXTERNAL_TASK_DELETE_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ tasks: taskPayloads }),
        });
      } catch {
        throw new Error("无法连接本地同步服务，请先运行 node server.js。");
      }

      if (response.status === 404 || response.status === 405) {
        throw new Error("DELETE_ENDPOINT_NOT_FOUND");
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

      const items = Array.isArray(data?.result?.items) ? data.result.items : [];
      return { items };
    }

    async function syncTodoTasksToMacReminders(taskPayloads) {
      if (!Array.isArray(taskPayloads) || !taskPayloads.length) {
        return { items: [] };
      }
      if (!EXTERNAL_TASK_REMINDER_SYNC_URL) {
        throw new Error("提醒同步接口未配置。");
      }

      const fetchFn = resolveFetch();
      let response = null;
      try {
        response = await fetchFn(EXTERNAL_TASK_REMINDER_SYNC_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            tasks: taskPayloads,
            targetReminderList: getSyncReminderTargetPayload(),
          }),
        });
      } catch {
        throw new Error("无法连接本地同步服务，请先运行 node server.js。");
      }

      if (response.status === 404 || response.status === 405) {
        throw new Error("提醒同步接口不可用，请升级本地同步服务。");
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

      const items = Array.isArray(data?.result?.items) ? data.result.items : [];
      return { items };
    }

    async function completeTodoTasksInMacReminders(taskPayloads) {
      if (!Array.isArray(taskPayloads) || !taskPayloads.length) {
        return { items: [] };
      }
      if (!EXTERNAL_TASK_REMINDER_COMPLETE_URL) {
        throw new Error("提醒完成同步接口未配置。");
      }

      const fetchFn = resolveFetch();
      let response = null;
      try {
        response = await fetchFn(EXTERNAL_TASK_REMINDER_COMPLETE_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ tasks: taskPayloads }),
        });
      } catch {
        throw new Error("无法连接本地同步服务，请先运行 node server.js。");
      }

      if (response.status === 404 || response.status === 405) {
        throw new Error("提醒完成接口不可用，请升级本地同步服务。");
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

      const items = Array.isArray(data?.result?.items) ? data.result.items : [];
      return { items };
    }

    function applyTodoTaskSyncItems(items) {
      const todos = getTodos();
      const itemMap = new Map((Array.isArray(items) ? items : []).map((item) => [String(item.taskId || ""), item]));
      let succeeded = 0;
      let failed = 0;
      const nowIso = new Date().toISOString();

      for (const todo of todos) {
        const item = itemMap.get(String(todo.id));
        if (!item) continue;

        if (item.ok) {
          succeeded += 1;
          todo.calendarSynced = true;
          todo.syncState = "synced";
          todo.lastSyncError = "";
          const syncedAt = String(item.syncedAt || nowIso);
          todo.syncedAt = syncedAt;
          todo.externalCalendarId = String(item.eventId || todo.externalCalendarId || "");
          todo.updatedAt = syncedAt;
        } else {
          failed += 1;
          todo.calendarSynced = false;
          todo.syncState = "error";
          todo.lastSyncError = String(item.error || "同步失败");
        }
      }

      if (succeeded > 0 || failed > 0) {
        saveTodos(todos, { skipSyncSchedule: true, skipUndoSnapshot: true });
      }

      return { succeeded, failed };
    }

    function applyTodoReminderSyncItems(items) {
      const todos = getTodos();
      const itemMap = new Map((Array.isArray(items) ? items : []).map((item) => [String(item.taskId || ""), item]));
      let succeeded = 0;
      let failed = 0;
      let changed = false;
      const nowIso = new Date().toISOString();

      for (const todo of todos) {
        const item = itemMap.get(String(todo.id));
        if (!item) continue;

        if (item.ok) {
          succeeded += 1;
          todo.externalReminderId = String(item.reminderId || todo.externalReminderId || "");
          todo.reminderSynced = true;
          todo.reminderSyncState = "synced";
          todo.reminderLastSyncError = "";
          todo.reminderSyncedAt = String(item.syncedAt || nowIso);
          todo.reminderCompletedAt = null;
        } else {
          failed += 1;
          todo.reminderSynced = false;
          todo.reminderSyncState = "error";
          todo.reminderLastSyncError = String(item.error || "提醒同步失败");
        }
        changed = true;
      }

      if (changed) {
        saveTodos(todos, { skipSyncSchedule: true, skipUndoSnapshot: true });
      }

      return { succeeded, failed };
    }

    function applyTodoReminderCompleteItems(items) {
      const todos = getTodos();
      const itemMap = new Map((Array.isArray(items) ? items : []).map((item) => [String(item.taskId || ""), item]));
      let succeeded = 0;
      let failed = 0;
      let changed = false;
      const nowIso = new Date().toISOString();

      for (const todo of todos) {
        const item = itemMap.get(String(todo.id));
        if (!item) continue;

        const action = String(item.action || "").trim().toLowerCase();
        const pendingComplete = Boolean(String(todo.reminderPendingCompleteAt || "").trim());
        if (item.ok && action === "complete" && pendingComplete && item.notFound) {
          failed += 1;
          todo.reminderSynced = false;
          todo.reminderSyncState = "error";
          todo.reminderLastSyncError = "未找到当前提醒实例，已保留完成重试状态。";
          changed = true;
          continue;
        }

        if (item.ok) {
          succeeded += 1;
          const repeat = normalizeReminderRepeat(todo?.repeat);
          const recurringActiveTodo = !todo.completed && (repeat === "daily" || repeat === "weekly" || repeat === "monthly");
          const isDisableAction = action === "disable" || (!todo.completed && normalizeReminderRepeat(todo?.repeat) === "none");
          if (item.notFound || isDisableAction) {
            todo.externalReminderId = "";
          } else if (String(item.reminderId || "").trim()) {
            todo.externalReminderId = String(item.reminderId || "").trim();
          }
          const completedAtIso = String(item.completedAt || nowIso);
          if (action === "complete" && recurringActiveTodo) {
            if (item.notFound) {
              todo.externalReminderId = "";
            }
            todo.reminderPendingCompleteAt = null;
            todo.reminderSynced = false;
            todo.reminderSyncState = "dirty";
            todo.reminderLastSyncError = "";
            todo.reminderCompletedAt = null;
            todo.reminderSyncedAt = completedAtIso;
          } else {
            todo.reminderSynced = true;
            todo.reminderSyncState = "synced";
            todo.reminderLastSyncError = "";
            todo.reminderCompletedAt = isDisableAction ? null : completedAtIso;
            todo.reminderSyncedAt = completedAtIso;
            todo.reminderPendingCompleteAt = null;
          }
        } else {
          failed += 1;
          todo.reminderSynced = false;
          todo.reminderSyncState = "error";
          todo.reminderLastSyncError = String(item.error || "提醒完成同步失败");
        }
        changed = true;
      }

      if (changed) {
        saveTodos(todos, { skipSyncSchedule: true, skipUndoSnapshot: true });
      }

      return { succeeded, failed };
    }

    function normalizeTodoCalendarDeleteItem(raw) {
      if (!raw || typeof raw !== "object") return null;
      const taskId = String(raw.taskId || raw.id || "").trim();
      const eventId = String(raw.eventId || raw.externalCalendarId || "").trim();
      if (!taskId || !eventId) return null;
      const deletedAtRaw = String(raw.deletedAt || "").trim();
      const deletedAt = Number.isFinite(Date.parse(deletedAtRaw)) ? deletedAtRaw : new Date().toISOString();
      const title = String(raw.title || "").trim().slice(0, 120);
      return {
        taskId: taskId.slice(0, 120),
        eventId: eventId.slice(0, 240),
        deletedAt,
        title,
      };
    }

    function loadTodoCalendarDeleteQueue() {
      if (!localStorageRef || typeof localStorageRef.getItem !== "function") return [];
      try {
        const raw = localStorageRef.getItem(TODO_DELETE_QUEUE_STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.map(normalizeTodoCalendarDeleteItem).filter(Boolean);
      } catch {
        return [];
      }
    }

    function saveTodoCalendarDeleteQueue(value) {
      const normalized = Array.isArray(value)
        ? value.map(normalizeTodoCalendarDeleteItem).filter(Boolean)
        : [];
      setPendingTodoCalendarDeletes(normalized);
      if (localStorageRef && typeof localStorageRef.setItem === "function") {
        localStorageRef.setItem(TODO_DELETE_QUEUE_STORAGE_KEY, JSON.stringify(normalized));
      }
      scheduleAutoBidirectionalSync("delete-queue");
    }

    function enqueueTodoCalendarDelete(todo, timestampIso = new Date().toISOString()) {
      if (!todo || typeof todo !== "object") return false;
      const taskId = String(todo.id || "").trim();
      const eventId = String(todo.externalCalendarId || "").trim();
      if (!taskId || !eventId) return false;

      const pendingTodoCalendarDeletes = getPendingTodoCalendarDeletes();
      const next = Array.isArray(pendingTodoCalendarDeletes) ? [...pendingTodoCalendarDeletes] : [];
      const payload = normalizeTodoCalendarDeleteItem({
        taskId,
        eventId,
        deletedAt: timestampIso,
        title: String(todo.title || ""),
      });
      if (!payload) return false;

      const existingIndex = next.findIndex(
        (item) => String(item.eventId || "") === payload.eventId || String(item.taskId || "") === payload.taskId,
      );
      if (existingIndex >= 0) {
        next[existingIndex] = payload;
      } else {
        next.push(payload);
      }
      saveTodoCalendarDeleteQueue(next);
      return true;
    }

    function buildTodoDeleteSyncRequests() {
      const pendingTodoCalendarDeletes = getPendingTodoCalendarDeletes();
      const queue = Array.isArray(pendingTodoCalendarDeletes) ? pendingTodoCalendarDeletes : [];
      return queue
        .map(normalizeTodoCalendarDeleteItem)
        .filter(Boolean)
        .map((item) => ({
          taskId: item.taskId,
          eventId: item.eventId,
        }));
    }

    function applyTodoTaskDeleteSyncItems(items) {
      const pendingTodoCalendarDeletes = getPendingTodoCalendarDeletes();
      const rawItems = Array.isArray(items) ? items : [];
      const remaining = Array.isArray(pendingTodoCalendarDeletes) ? [...pendingTodoCalendarDeletes] : [];
      let succeeded = 0;
      let failed = 0;

      for (const item of rawItems) {
        const taskId = String(item?.taskId || "").trim();
        const eventId = String(item?.eventId || "").trim();
        if (item?.ok) {
          succeeded += 1;
          const index = remaining.findIndex(
            (queued) =>
              (taskId && String(queued.taskId || "") === taskId) ||
              (eventId && String(queued.eventId || "") === eventId),
          );
          if (index >= 0) {
            remaining.splice(index, 1);
          }
          continue;
        }
        failed += 1;
      }

      saveTodoCalendarDeleteQueue(remaining);
      return {
        succeeded,
        failed,
        remaining: remaining.length,
      };
    }

    function buildTodoReminderDisableSyncRequestsFromQueue() {
      const queue = Array.isArray(getPendingTodoReminderDisables()) ? getPendingTodoReminderDisables() : [];
      const tasks = [];
      const normalizedQueue = [];
      let skipped = 0;

      for (const item of queue) {
        const normalized = normalizeTodoReminderDisableItem(item);
        if (!normalized) {
          skipped += 1;
          continue;
        }
        normalizedQueue.push(normalized);
        tasks.push({
          taskId: normalized.queueId,
          reminderId: normalized.reminderId,
          action: "disable",
          completedAt: normalized.createdAt,
        });
      }

      if (skipped > 0 || normalizedQueue.length !== queue.length) {
        saveTodoReminderDisableQueue(normalizedQueue);
      }

      return { tasks, skipped };
    }

    function applyQueuedTodoReminderDisableSyncItems(items) {
      const queue = Array.isArray(getPendingTodoReminderDisables()) ? getPendingTodoReminderDisables() : [];
      if (!queue.length) {
        return { removed: 0, remaining: 0 };
      }

      const succeededTaskIds = new Set(
        (Array.isArray(items) ? items : [])
          .filter((item) => item && item.ok)
          .map((item) => String(item.taskId || "").trim())
          .filter(Boolean),
      );
      if (!succeededTaskIds.size) {
        return { removed: 0, remaining: queue.length };
      }

      const next = queue.filter(
        (item) => !succeededTaskIds.has(String(item.queueId || item.taskId || "").trim()),
      );
      const removed = queue.length - next.length;
      if (removed > 0) {
        saveTodoReminderDisableQueue(next);
      }
      return { removed, remaining: next.length };
    }

    return {
      buildTodoSyncRequest,
      buildTodoReminderSyncRequest,
      buildTodoReminderCompleteRequest,
      syncTodoTasksByLegacyPushApi,
      syncTodoTasksToMacCalendar,
      deleteTodoTasksFromMacCalendar,
      syncTodoTasksToMacReminders,
      completeTodoTasksInMacReminders,
      applyTodoTaskSyncItems,
      applyTodoReminderSyncItems,
      applyTodoReminderCompleteItems,
      normalizeTodoCalendarDeleteItem,
      loadTodoCalendarDeleteQueue,
      saveTodoCalendarDeleteQueue,
      enqueueTodoCalendarDelete,
      buildTodoDeleteSyncRequests,
      applyTodoTaskDeleteSyncItems,
      buildTodoReminderDisableSyncRequestsFromQueue,
      applyQueuedTodoReminderDisableSyncItems,
    };
  }

  globalScope.TimeQualityTodoSyncBridgeModule = {
    createTodoSyncBridgeModule,
  };
})(typeof window !== "undefined" ? window : globalThis);
