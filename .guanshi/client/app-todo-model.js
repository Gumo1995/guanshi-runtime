/* global window */

(function attachTodoModelModule(globalScope) {
  "use strict";

  function assertFunction(name, value) {
    if (typeof value !== "function") {
      throw new Error(`TimeQualityTodoModelModule requires dependency: ${name}`);
    }
  }

  function createTodoModelModule(deps = {}) {
    const {
      TODO_PLAN_NEW_TODO_DURATION_MINUTES = 45,
      TODO_PROJECT_MAX_LEVEL = 3,
      TODO_PROJECT_LEVEL_SEPARATOR = " / ",
      addDays,
      formatDateForInput,
      parseOptionalScore,
      normalizeTodoCategoryValue,
      normalizeTodoNoteValue,
      normalizeTodoReminderRepeatValue,
      isRecurringTodoRepeatMode,
    } = deps;

    [
      ["addDays", addDays],
      ["formatDateForInput", formatDateForInput],
      ["parseOptionalScore", parseOptionalScore],
      ["normalizeTodoCategoryValue", normalizeTodoCategoryValue],
      ["normalizeTodoNoteValue", normalizeTodoNoteValue],
      ["normalizeTodoReminderRepeatValue", normalizeTodoReminderRepeatValue],
      ["isRecurringTodoRepeatMode", isRecurringTodoRepeatMode],
    ].forEach(([name, value]) => assertFunction(name, value));

    function createDefaultTodos() {
      const today = new Date();
      const tomorrow = addDays(today, 1);
      const future = addDays(today, 4);

      return [
        normalizeTodo({
          id: `todo_${Date.now()}_a`,
          title: "完成项目复盘并输出下一步计划",
          dueDate: formatDateForInput(today),
          project: "work-life balance",
          category: "工作",
          tags: ["持续输出", "重要且紧急"],
          note: "聚焦本周关键事项，完成后同步到日历。",
          qualityScore: null,
          happinessScore: null,
          startTime: "14:00",
          endTime: "16:00",
          estimatedMinutes: 120,
          repeat: "none",
          calendarSynced: false,
          completed: false,
        }),
        normalizeTodo({
          id: `todo_${Date.now()}_b`,
          title: "整理自我成长清单并拆分行动点",
          dueDate: formatDateForInput(tomorrow),
          project: "自我成长",
          category: "学习",
          tags: ["持续输出"],
          note: "明确三条本周可执行动作。",
          qualityScore: null,
          happinessScore: null,
          estimatedMinutes: 60,
          repeat: "weekly",
          calendarSynced: false,
          completed: false,
        }),
        normalizeTodo({
          id: `todo_${Date.now()}_c`,
          title: "客户维护周会纪要补全",
          dueDate: formatDateForInput(future),
          project: "客情维护",
          category: "工作",
          tags: ["重要且紧急"],
          note: "补录评分和关键备注，便于后续复盘。",
          qualityScore: null,
          happinessScore: null,
          estimatedMinutes: 45,
          repeat: "none",
          calendarSynced: false,
          completed: false,
        }),
      ];
    }

    function createTodoDraft() {
      const now = new Date();
      return normalizeTodo({
        id: `todo_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        title: "新待办事项",
        dueDate: formatDateForInput(now),
        project: "",
        category: "工作",
        tags: [],
        note: "",
        qualityScore: null,
        happinessScore: null,
        startTime: "",
        endTime: "",
        estimatedMinutes: TODO_PLAN_NEW_TODO_DURATION_MINUTES,
        reminder: "",
        repeat: "none",
        reminderRepeatExplicit: true,
        externalReminderId: "",
        reminderSynced: true,
        reminderSyncState: "synced",
        reminderLastSyncError: "",
        reminderSyncedAt: null,
        reminderCompletedAt: null,
        reminderPendingCompleteAt: null,
        planLocked: false,
        planLockExplicit: false,
        calendarSynced: false,
        completed: false,
      });
    }

    function normalizeTodoSyncState(value, calendarSynced = false) {
      const text = String(value || "").trim();
      if (text === "dirty" || text === "synced" || text === "conflict" || text === "error") {
        return text;
      }
      return calendarSynced ? "synced" : "dirty";
    }

    function normalizeTodoReminderSyncState(value, reminderSynced = false, reminderEligible = false) {
      const text = String(value || "").trim();
      if (text === "dirty" || text === "synced" || text === "conflict" || text === "error") {
        return text;
      }
      if (!reminderEligible) return "synced";
      return reminderSynced ? "synced" : "dirty";
    }

    function normalizeTodo(raw) {
      const nowIso = new Date().toISOString();
      const todo = raw || {};
      const calendarSynced = Boolean(todo.calendarSynced);
      const syncState = normalizeTodoSyncState(todo.syncState, calendarSynced);
      const reminderText = String(todo.reminder || "").trim();
      const reminderRepeatExplicit = Boolean(todo.reminderRepeatExplicit);
      let reminderRepeat = normalizeTodoReminderRepeatValue(todo.repeat);
      if (!reminderRepeatExplicit && reminderRepeat === "none" && reminderText) {
        // Compatibility migration: old versions used reminder datetime + none for one-shot reminders.
        reminderRepeat = "once";
      }
      const planLockExplicit = Boolean(todo.planLockExplicit);
      let planLocked = Boolean(todo.planLocked);
      if (!planLockExplicit && typeof todo.planLocked !== "boolean") {
        planLocked = isRecurringTodoRepeatMode(reminderRepeat);
      }
      const externalReminderId = todo.externalReminderId ? String(todo.externalReminderId) : "";
      const reminderEligible = Boolean(reminderRepeat !== "none" || externalReminderId);
      const reminderSynced = reminderEligible ? Boolean(todo.reminderSynced) : true;
      const reminderSyncState = normalizeTodoReminderSyncState(
        todo.reminderSyncState,
        reminderSynced,
        reminderEligible,
      );
      const syncedAt = todo.syncedAt ? String(todo.syncedAt) : null;
      let updatedAt = todo.updatedAt ? String(todo.updatedAt) : nowIso;
      // Backward-compat migration:
      // Older builds may write updatedAt after syncedAt during sync success,
      // which causes false conflicts on subsequent pull.
      if (calendarSynced && syncState === "synced" && syncedAt) {
        const syncedMs = Date.parse(syncedAt);
        const updatedMs = Date.parse(updatedAt);
        if (Number.isFinite(syncedMs) && Number.isFinite(updatedMs) && updatedMs > syncedMs) {
          updatedAt = syncedAt;
        }
      }
      const normalizedProject = normalizeProjectName(todo.project);
      return {
        id: String(todo.id || `todo_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`),
        title: String(todo.title || "未命名待办").trim(),
        dueDate: String(todo.dueDate || "").trim(),
        project: normalizedProject,
        category: normalizeTodoCategoryValue(todo.category, normalizedProject),
        tags: normalizeTodoTags(todo.tags),
        note: normalizeTodoNoteValue(todo.note),
        qualityScore: parseOptionalScore(todo.qualityScore),
        happinessScore: parseOptionalScore(todo.happinessScore),
        startTime: String(todo.startTime || "").trim(),
        endTime: String(todo.endTime || "").trim(),
        estimatedMinutes: Number.isFinite(Number(todo.estimatedMinutes))
          ? Math.max(5, Math.min(24 * 60, Number(todo.estimatedMinutes)))
          : 60,
        reminder: reminderText,
        repeat: reminderRepeat,
        reminderRepeatExplicit: true,
        externalReminderId,
        reminderSynced,
        reminderSyncState,
        reminderLastSyncError: String(todo.reminderLastSyncError || "").trim(),
        reminderSyncedAt: todo.reminderSyncedAt ? String(todo.reminderSyncedAt) : null,
        reminderCompletedAt: todo.reminderCompletedAt ? String(todo.reminderCompletedAt) : null,
        reminderPendingCompleteAt: todo.reminderPendingCompleteAt ? String(todo.reminderPendingCompleteAt) : null,
        planLocked,
        planLockExplicit,
        calendarSynced,
        syncState,
        lastSyncError: String(todo.lastSyncError || "").trim(),
        externalCalendarId: todo.externalCalendarId ? String(todo.externalCalendarId) : "",
        syncedAt,
        completed: Boolean(todo.completed),
        completedAt: todo.completedAt ? String(todo.completedAt) : null,
        completionEntryId: todo.completionEntryId ? String(todo.completionEntryId) : "",
        orderInDay: Number.isFinite(Number(todo.orderInDay)) ? Number(todo.orderInDay) : null,
        createdAt: todo.createdAt ? String(todo.createdAt) : nowIso,
        updatedAt,
      };
    }

    function normalizeTodoTags(value) {
      if (Array.isArray(value)) {
        return value
          .map((item) => String(item || "").trim().replace(/^#/, ""))
          .filter(Boolean)
          .slice(0, 8);
      }

      return String(value || "")
        .split(/[，,]/)
        .map((item) => item.trim().replace(/^#/, ""))
        .filter(Boolean)
        .slice(0, 8);
    }

    function normalizeProjectSegmentName(value) {
      return String(value || "")
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, 40);
    }

    function shouldSplitProjectByHyphenShortcut(raw) {
      const text = String(raw || "");
      const normalized = text.replace(/[－—–]/g, "-");
      const hyphenCount = (normalized.match(/-/g) || []).length;
      if (!hyphenCount) return false;
      if (/\s-\s|\s-|-\s/.test(normalized)) return true;
      if (hyphenCount >= 2) return true;
      const parts = normalized.split("-");
      if (parts.length !== 2) return false;
      const left = String(parts[0] || "").trim();
      const right = String(parts[1] || "").trim();
      if (!left || !right) return false;
      const latinTextPattern = /^[A-Za-z0-9][A-Za-z0-9\s]*$/;
      if (latinTextPattern.test(left) && latinTextPattern.test(right)) return false;
      return true;
    }

    function splitProjectNameToSegments(value, { allowHyphenShortcut = true } = {}) {
      const raw = String(value || "").trim();
      if (!raw) return [];
      const normalized = raw.replace(/[／]/g, "/").replace(/[－—–]/g, "-");
      let sourceParts = [normalized];
      if (normalized.includes("/")) {
        sourceParts = normalized.split("/");
      } else if (allowHyphenShortcut && shouldSplitProjectByHyphenShortcut(normalized)) {
        sourceParts = normalized.split("-");
      }
      return sourceParts
        .map((part) => normalizeProjectSegmentName(part))
        .filter(Boolean)
        .slice(0, TODO_PROJECT_MAX_LEVEL);
    }

    function buildProjectPathFromSegments(parts) {
      if (!Array.isArray(parts)) return "";
      return parts
        .map((part) => normalizeProjectSegmentName(part))
        .filter(Boolean)
        .slice(0, TODO_PROJECT_MAX_LEVEL)
        .join(TODO_PROJECT_LEVEL_SEPARATOR)
        .slice(0, 120);
    }

    function normalizeProjectName(value) {
      const parts = splitProjectNameToSegments(value, { allowHyphenShortcut: true });
      return buildProjectPathFromSegments(parts);
    }

    function getProjectPathSegments(value) {
      const normalized = normalizeProjectName(value);
      if (!normalized) return [];
      return splitProjectNameToSegments(normalized, { allowHyphenShortcut: false });
    }

    function getProjectRootName(value) {
      const parts = getProjectPathSegments(value);
      return parts[0] || "";
    }

    return {
      createDefaultTodos,
      createTodoDraft,
      normalizeTodoSyncState,
      normalizeTodoReminderSyncState,
      normalizeTodo,
      normalizeTodoTags,
      normalizeProjectSegmentName,
      shouldSplitProjectByHyphenShortcut,
      splitProjectNameToSegments,
      buildProjectPathFromSegments,
      normalizeProjectName,
      getProjectPathSegments,
      getProjectRootName,
    };
  }

  globalScope.TimeQualityTodoModelModule = {
    createTodoModelModule,
  };
})(typeof window !== "undefined" ? window : globalThis);
