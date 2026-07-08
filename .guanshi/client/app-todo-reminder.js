/* global window */

(function attachTimeQualityTodoReminderModule(globalScope) {
  "use strict";

  function requireFunction(deps, name) {
    const value = deps[name];
    if (typeof value !== "function") {
      throw new Error(`TimeQualityTodoReminderModule requires dependency: ${name}`);
    }
    return value;
  }

  function createTodoReminderModule(deps = {}) {
    const TODO_PLAN_DAY_FIRST_START_MINUTES = Number.isFinite(Number(deps.TODO_PLAN_DAY_FIRST_START_MINUTES))
      ? Number(deps.TODO_PLAN_DAY_FIRST_START_MINUTES)
      : 9 * 60;
    const TODO_REMINDER_DEFAULT_LEAD_MINUTES = Number.isFinite(Number(deps.TODO_REMINDER_DEFAULT_LEAD_MINUTES))
      ? Number(deps.TODO_REMINDER_DEFAULT_LEAD_MINUTES)
      : 5;
    const TODO_REMINDER_DEFAULT_LEAD_OPTIONS = Array.isArray(deps.TODO_REMINDER_DEFAULT_LEAD_OPTIONS)
      ? deps.TODO_REMINDER_DEFAULT_LEAD_OPTIONS.map((item) => Number(item)).filter((item) => Number.isFinite(item))
      : [];

    const addDays = requireFunction(deps, "addDays");
    const formatDateForInput = requireFunction(deps, "formatDateForInput");
    const formatTimeForInput = requireFunction(deps, "formatTimeForInput");
    const formatMinutesForInput = requireFunction(deps, "formatMinutesForInput");
    const isValidDateInput = requireFunction(deps, "isValidDateInput");
    const isValidClockInput = requireFunction(deps, "isValidClockInput");
    const parseClockToMinutes = requireFunction(deps, "parseClockToMinutes");
    const getReminderDefaultLeadMinutes =
      typeof deps.getReminderDefaultLeadMinutes === "function"
        ? deps.getReminderDefaultLeadMinutes
        : () => TODO_REMINDER_DEFAULT_LEAD_MINUTES;

    function normalizeDefaultLeadMinutes(value) {
      const parsed = Number.parseInt(String(value ?? ""), 10);
      if (!Number.isFinite(parsed)) return TODO_REMINDER_DEFAULT_LEAD_MINUTES;
      if (TODO_REMINDER_DEFAULT_LEAD_OPTIONS.includes(parsed)) return parsed;
      return TODO_REMINDER_DEFAULT_LEAD_MINUTES;
    }

    function getLeadLabel(minutes) {
      const safe = normalizeDefaultLeadMinutes(minutes);
      if (safe <= 0) return "关闭（按任务时间）";
      return `提前 ${safe} 分钟`;
    }

    function normalizeRepeatValue(value, fallback = "none") {
      const raw = String(value || "").trim().toLowerCase();
      if (!raw) return String(fallback || "none");
      if (raw === "off" || raw === "none") return "none";
      if (raw === "once" || raw === "single") return "once";
      if (raw === "daily" || raw === "weekly" || raw === "monthly") return raw;
      return String(fallback || "none");
    }

    function parseDateTime(value) {
      const raw = String(value || "").trim();
      if (!raw) return null;
      const normalized = raw.replace(" ", "T");
      const directMatch = normalized.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
      if (directMatch && isValidDateInput(directMatch[1]) && isValidClockInput(directMatch[2])) {
        return { date: directMatch[1], time: directMatch[2] };
      }

      const parsed = new Date(normalized);
      if (Number.isNaN(parsed.getTime())) return null;
      const date = formatDateForInput(parsed);
      const time = formatTimeForInput(parsed);
      if (!isValidDateInput(date) || !isValidClockInput(time)) return null;
      return { date, time };
    }

    function usesExplicitDateTime(todo) {
      if (!todo) return false;
      return Boolean(parseDateTime(todo.reminder));
    }

    function isEligibleForSync(todo) {
      if (!todo || todo.completed) return false;
      const repeat = normalizeRepeatValue(todo.repeat);
      const externalReminderId = String(todo.externalReminderId || "").trim();
      if (repeat !== "none") return true;
      return Boolean(externalReminderId);
    }

    function isRecurringRepeat(value) {
      const repeat = normalizeRepeatValue(value, "none");
      return repeat === "daily" || repeat === "weekly" || repeat === "monthly";
    }

    function resolveNextRecurringDueDate(baseDateText, repeatMode) {
      const normalizedRepeat = normalizeRepeatValue(repeatMode, "none");
      if (!isRecurringRepeat(normalizedRepeat)) return "";

      const baseDate = isValidDateInput(String(baseDateText || "").trim())
        ? new Date(`${String(baseDateText).trim()}T00:00:00`)
        : new Date();
      if (Number.isNaN(baseDate.getTime())) return "";

      if (normalizedRepeat === "daily") {
        return formatDateForInput(addDays(baseDate, 1));
      }
      if (normalizedRepeat === "weekly") {
        return formatDateForInput(addDays(baseDate, 7));
      }

      const nextMonthStart = new Date(baseDate.getFullYear(), baseDate.getMonth() + 1, 1);
      const maxDayInNextMonth = new Date(
        nextMonthStart.getFullYear(),
        nextMonthStart.getMonth() + 1,
        0,
      ).getDate();
      const day = Math.min(baseDate.getDate(), maxDayInNextMonth);
      return formatDateForInput(new Date(nextMonthStart.getFullYear(), nextMonthStart.getMonth(), day));
    }

    function formatRepeatLabel(value) {
      const repeat = normalizeRepeatValue(value, "none");
      if (repeat === "once") return "单次";
      if (repeat === "daily") return "每天";
      if (repeat === "weekly") return "每周";
      if (repeat === "monthly") return "每月";
      return "";
    }

    function resolveDisplayClock(reminderValue, startTimeValue = "") {
      const parsedReminder = parseDateTime(reminderValue);
      if (parsedReminder && isValidClockInput(parsedReminder.time)) {
        return parsedReminder.time;
      }

      const startTimeRaw = String(startTimeValue || "").trim();
      const fallbackStartTime = formatMinutesForInput(TODO_PLAN_DAY_FIRST_START_MINUTES);
      const baseClock = isValidClockInput(startTimeRaw) ? startTimeRaw : fallbackStartTime;
      const baseMinutes = parseClockToMinutes(baseClock);
      if (!Number.isInteger(baseMinutes)) return "";

      const leadMinutes = normalizeDefaultLeadMinutes(getReminderDefaultLeadMinutes());
      const dayMinutes = 24 * 60;
      const displayMinutes = ((baseMinutes - leadMinutes) % dayMinutes + dayMinutes) % dayMinutes;
      return formatMinutesForInput(displayMinutes);
    }

    function formatLabel(reminderValue, repeatValue = "none", options = {}) {
      const repeat = normalizeRepeatValue(repeatValue, "none");
      if (repeat === "none") {
        return "不提醒";
      }

      const repeatLabel = formatRepeatLabel(repeat);
      const startTime = options && typeof options === "object" ? String(options.startTime || "").trim() : "";
      const displayClock = resolveDisplayClock(reminderValue, startTime);
      if (repeatLabel && displayClock) {
        return `提醒 ${repeatLabel} ${displayClock}`;
      }
      if (repeatLabel) {
        return `提醒 ${repeatLabel}`;
      }
      return displayClock ? `提醒 ${displayClock}` : "提醒";
    }

    return {
      normalizeDefaultLeadMinutes,
      getLeadLabel,
      normalizeRepeatValue,
      parseDateTime,
      usesExplicitDateTime,
      isEligibleForSync,
      isRecurringRepeat,
      resolveNextRecurringDueDate,
      formatRepeatLabel,
      resolveDisplayClock,
      formatLabel,
    };
  }

  globalScope.TimeQualityTodoReminderModule = {
    createTodoReminderModule,
  };
})(typeof window !== "undefined" ? window : globalThis);
