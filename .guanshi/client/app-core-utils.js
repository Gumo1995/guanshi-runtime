(function attachTimeQualityCoreUtils(globalScope) {
  if (!globalScope) return;

  function isValidDateInput(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "").trim());
  }

  function isValidClockInput(value) {
    return /^\d{2}:\d{2}$/.test(String(value || "").trim());
  }

  function parseOptionalScore(value) {
    const numeric = Number(value);
    if (Number.isInteger(numeric) && numeric >= 1 && numeric <= 10) {
      return numeric;
    }
    return null;
  }

  function calcDurationHours(start, end) {
    if (!start || !end) return 0;

    const [startHour, startMin] = start.split(":").map(Number);
    const [endHour, endMin] = end.split(":").map(Number);

    let startTotal = startHour * 60 + startMin;
    let endTotal = endHour * 60 + endMin;

    if (endTotal <= startTotal) {
      endTotal += 24 * 60;
    }

    const minutes = endTotal - startTotal;
    if (minutes <= 0 || minutes > 24 * 60) return 0;
    return minutes / 60;
  }

  function addDays(date, days) {
    const copy = new Date(date);
    copy.setDate(copy.getDate() + days);
    return copy;
  }

  function getStartOfWeek(date) {
    const normalized = new Date(date);
    normalized.setHours(0, 0, 0, 0);
    const day = normalized.getDay();
    normalized.setDate(normalized.getDate() - day);
    return normalized;
  }

  function getWeekDates(weekStart) {
    return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  }

  function isSameDay(a, b) {
    return (
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate()
    );
  }

  function formatMinutesLabel(minutes) {
    const safe = Math.max(0, Math.min(24 * 60, Math.round(minutes)));
    if (safe === 24 * 60) return "24:00";
    const hours = Math.floor(safe / 60);
    const mins = safe % 60;
    return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
  }

  function formatMinutesForInput(minutes) {
    const safe = Math.max(0, Math.min(24 * 60 - 1, Math.floor(minutes)));
    const hours = Math.floor(safe / 60);
    const mins = safe % 60;
    return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
  }

  function formatDateForInput(date) {
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${date.getFullYear()}-${month}-${day}`;
  }

  function formatTimeForInput(date) {
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${hours}:${minutes}`;
  }

  function formatClock(seconds) {
    const safeSeconds = Math.max(0, seconds);
    const minutesPart = Math.floor(safeSeconds / 60);
    const secondsPart = safeSeconds % 60;
    return `${String(minutesPart).padStart(2, "0")}:${String(secondsPart).padStart(2, "0")}`;
  }

  function parseClockToMinutes(clock) {
    const text = String(clock || "").trim();
    if (!/^\d{2}:\d{2}$/.test(text)) return null;
    const [hourText, minuteText] = text.split(":");
    const hour = Number.parseInt(hourText, 10);
    const minute = Number.parseInt(minuteText, 10);
    if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
    return hour * 60 + minute;
  }

  const existing = globalScope.TimeQualityCoreUtils || {};
  globalScope.TimeQualityCoreUtils = {
    ...existing,
    isValidDateInput,
    isValidClockInput,
    parseOptionalScore,
    calcDurationHours,
    addDays,
    getStartOfWeek,
    getWeekDates,
    isSameDay,
    formatMinutesLabel,
    formatMinutesForInput,
    formatDateForInput,
    formatTimeForInput,
    formatClock,
    parseClockToMinutes,
  };
})(typeof window !== "undefined" ? window : globalThis);
