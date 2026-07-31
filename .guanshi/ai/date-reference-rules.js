"use strict";

const DATE_REFERENCE_RULE_SCHEMA = "guanshi-ai-date-reference-rule-v1";
const DATE_REFERENCE_RESOLUTION_SCHEMA = "guanshi-ai-date-reference-resolution-v1";

const DEFAULT_DATE_REFERENCE_INCLUDES = Object.freeze(["todos", "entries", "busyBlocks"]);

const HISTORICAL_CONTEXT_TRIGGERS = Object.freeze([
  "复盘",
  "回顾",
  "总结",
  "为什么",
  "没完成",
  "未完成",
  "没推进",
  "拖延",
  "延期",
  "风险",
  "冲突",
  "有哪些",
  "哪几天",
  "看一下",
  "查一下",
  "查",
  "找",
  "看看",
  "分析",
  "做了什么",
  "做过什么",
  "完成了什么",
  "干了什么",
]);

const WEEKDAY_MAP = Object.freeze({ 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 });

const DATE_REFERENCE_RULES = Object.freeze([
  {
    schema: DATE_REFERENCE_RULE_SCHEMA,
    id: "explicit_iso_date",
    label: "明确日期",
    source: "user_explicit",
    description: "YYYY-MM-DD 明确日期按单日处理。",
  },
  {
    schema: DATE_REFERENCE_RULE_SCHEMA,
    id: "explicit_calendar_month",
    label: "明确月份按自然月",
    source: "user_explicit",
    description: "明确月份按该月份完整自然月处理。",
  },
  {
    schema: DATE_REFERENCE_RULE_SCHEMA,
    id: "previous_calendar_weekday",
    label: "上周几按上一周对应日",
    source: "system_default",
    description: "上周一至上周日按上一自然周中的对应日期处理。",
  },
  {
    schema: DATE_REFERENCE_RULE_SCHEMA,
    id: "current_week_rolling_7_days",
    label: "这周按最近7天",
    source: "system_default",
    description: "这周、本周、近一周按最近 7 天处理，包含 currentDate。",
  },
  {
    schema: DATE_REFERENCE_RULE_SCHEMA,
    id: "previous_week_rolling_7_days",
    label: "上周按前7天",
    source: "system_default",
    description: "上周按 currentDate 之前连续 7 天处理，不包含 currentDate。",
  },
  {
    schema: DATE_REFERENCE_RULE_SCHEMA,
    id: "previous_calendar_month",
    label: "上个自然月",
    source: "user_explicit",
    description: "用户明确说自然月或整月时，按上一个自然月处理。",
  },
  {
    schema: DATE_REFERENCE_RULE_SCHEMA,
    id: "last_month_rolling_31_days",
    label: "上个月按过去31天",
    source: "system_default",
    description: "上个月、上月、近一个月按最近 31 天处理，包含 currentDate。",
  },
]);

function normalizeText(value, maxLength = 4000) {
  return String(value || "").trim().slice(0, maxLength);
}

function isIsoDateText(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(normalizeText(value, 20));
}

function parseLocalNoonDate(dateText) {
  if (!isIsoDateText(dateText)) return null;
  const date = new Date(`${dateText}T12:00:00`);
  return Number.isFinite(date.getTime()) ? date : null;
}

function formatLocalDate(date) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return "";
  return [
    String(date.getFullYear()).padStart(4, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function addDaysToDateText(dateText, offset) {
  const date = parseLocalNoonDate(dateText);
  if (!date) return "";
  date.setDate(date.getDate() + offset);
  return formatLocalDate(date);
}

function buildDefaultContextWindow(currentDate) {
  const date = normalizeText(currentDate, 20);
  if (!isIsoDateText(date)) return null;
  const start = addDaysToDateText(date, -2);
  const end = addDaysToDateText(date, 3);
  return start && end ? { start, end } : null;
}

function isDateInsideRange(dateText, range) {
  const date = normalizeText(dateText, 20);
  if (!isIsoDateText(date) || !range?.start || !range?.end) return true;
  return date >= range.start && date <= range.end;
}

function isRangeInsideRange(range, container) {
  if (!range?.start || !range?.end || !container?.start || !container?.end) return false;
  return isDateInsideRange(range.start, container) && isDateInsideRange(range.end, container);
}

function getPreviousCalendarWeekday(today, weekdayIndex) {
  const date = parseLocalNoonDate(today);
  if (!date) return "";
  const jsDay = date.getDay();
  const daysSinceMonday = (jsDay + 6) % 7;
  const monday = addDaysToDateText(today, -daysSinceMonday);
  const previousMonday = addDaysToDateText(monday, -7);
  const offset = weekdayIndex === 0 ? 6 : weekdayIndex - 1;
  return addDaysToDateText(previousMonday, offset);
}

function getRollingRangeEndingToday(today, dayCount) {
  const days = Number.parseInt(dayCount, 10);
  if (!isIsoDateText(today) || !Number.isInteger(days) || days < 1) return null;
  const start = addDaysToDateText(today, -(days - 1));
  return start ? { start, end: today } : null;
}

function getPreviousRollingRange(today, dayCount) {
  const days = Number.parseInt(dayCount, 10);
  if (!isIsoDateText(today) || !Number.isInteger(days) || days < 1) return null;
  const end = addDaysToDateText(today, -1);
  const start = end ? addDaysToDateText(end, -(days - 1)) : "";
  return start && end ? { start, end } : null;
}

function getCalendarMonthRange(year, month) {
  const parsedYear = Number.parseInt(String(year || ""), 10);
  const parsedMonth = Number.parseInt(String(month || ""), 10);
  if (!Number.isInteger(parsedYear) || parsedYear < 1900 || parsedYear > 2999) return null;
  if (!Number.isInteger(parsedMonth) || parsedMonth < 1 || parsedMonth > 12) return null;
  const startDate = new Date(parsedYear, parsedMonth - 1, 1, 12, 0, 0);
  const endDate = new Date(parsedYear, parsedMonth, 0, 12, 0, 0);
  const start = formatLocalDate(startDate);
  const end = formatLocalDate(endDate);
  return start && end ? { start, end } : null;
}

function getPreviousCalendarMonthRange(today) {
  const date = parseLocalNoonDate(today);
  if (!date) return null;
  return getCalendarMonthRange(date.getFullYear(), date.getMonth());
}

function hasHistoricalContextIntent(text) {
  const source = normalizeText(text, 4000);
  return HISTORICAL_CONTEXT_TRIGGERS.some((trigger) => source.includes(trigger));
}

function getRule(ruleId) {
  return DATE_REFERENCE_RULES.find((rule) => rule.id === ruleId) || null;
}

function cleanMatchedText(value) {
  return normalizeText(value, 80).replace(/^[^\d一二三四五六日天这本上近最过]+/, "").trim();
}

function createResolution(ruleId, params = {}) {
  const rule = getRule(ruleId);
  const range = params.range || null;
  if (!rule || !range?.start || !range?.end) return null;
  const defaultWindow = params.defaultWindow || null;
  return {
    schema: DATE_REFERENCE_RESOLUTION_SCHEMA,
    matched: true,
    matchedText: cleanMatchedText(params.matchedText || ""),
    ruleId: rule.id,
    ruleLabel: rule.label,
    source: rule.source,
    reasonDate: normalizeText(params.reasonDate || rule.label, 120),
    range,
    include: DEFAULT_DATE_REFERENCE_INCLUDES.slice(),
    currentDate: normalizeText(params.currentDate, 20),
    defaultWindow,
    requiresExpandedContext: defaultWindow ? !isRangeInsideRange(range, defaultWindow) : true,
  };
}

function resolveExplicitMonth(source, currentDate, defaultWindow) {
  const currentYear = Number.parseInt(String(currentDate || "").slice(0, 4), 10);
  const yearMonth = /(?:^|[^\d])(\d{4})年(0?[1-9]|1[0-2])月份?(?:整月|全月)?(?!\s*\d)/.exec(source)
    || /(?:^|[^\d])(\d{4})-(0[1-9]|1[0-2])(?:整月|全月|月)?(?!-\d{2})/.exec(source);
  if (yearMonth) {
    const range = getCalendarMonthRange(yearMonth[1], yearMonth[2]);
    return createResolution("explicit_calendar_month", {
      matchedText: yearMonth[0],
      reasonDate: `${Number.parseInt(yearMonth[1], 10)}年${Number.parseInt(yearMonth[2], 10)}月`,
      range,
      currentDate,
      defaultWindow,
    });
  }

  const localMonth = /(?:^|[^\d])((?:0?[1-9])|(?:1[0-2]))月份?(?:整月|全月)?(?!\s*\d)/.exec(source);
  if (localMonth && Number.isInteger(currentYear)) {
    const range = getCalendarMonthRange(currentYear, localMonth[1]);
    return createResolution("explicit_calendar_month", {
      matchedText: localMonth[0],
      reasonDate: `${currentYear}年${Number.parseInt(localMonth[1], 10)}月`,
      range,
      currentDate,
      defaultWindow,
    });
  }
  return null;
}

function resolveDateReference(options = {}) {
  const source = normalizeText(options.text, 4000);
  const currentDate = normalizeText(options.currentDate, 20);
  if (!source || !isIsoDateText(currentDate)) return null;
  const defaultWindow = options.defaultWindow || null;

  const explicitDate = /\b(\d{4}-\d{2}-\d{2})\b/.exec(source);
  if (explicitDate) {
    return createResolution("explicit_iso_date", {
      matchedText: explicitDate[1],
      reasonDate: explicitDate[1],
      range: { start: explicitDate[1], end: explicitDate[1] },
      currentDate,
      defaultWindow,
    });
  }

  const explicitMonth = resolveExplicitMonth(source, currentDate, defaultWindow);
  if (explicitMonth) return explicitMonth;

  const lastWeekday = /上(?:周|星期|礼拜)([一二三四五六日天])/.exec(source);
  if (lastWeekday) {
    const date = getPreviousCalendarWeekday(currentDate, WEEKDAY_MAP[lastWeekday[1]]);
    return createResolution("previous_calendar_weekday", {
      matchedText: lastWeekday[0],
      reasonDate: `上周${lastWeekday[1]}`,
      range: date ? { start: date, end: date } : null,
      currentDate,
      defaultWindow,
    });
  }

  const currentWeekMatch = /(?:这|本)(?:周|星期|礼拜)|(?:近|最近|过去)一周|(?:近|最近|过去)7天/.exec(source);
  if (currentWeekMatch) {
    return createResolution("current_week_rolling_7_days", {
      matchedText: currentWeekMatch[0],
      reasonDate: "这周（最近7天）",
      range: getRollingRangeEndingToday(currentDate, 7),
      currentDate,
      defaultWindow,
    });
  }

  const previousWeekMatch = /上(?:周|星期|礼拜)(?![一二三四五六日天])/.exec(source);
  if (previousWeekMatch) {
    return createResolution("previous_week_rolling_7_days", {
      matchedText: previousWeekMatch[0],
      reasonDate: "上周（前7天）",
      range: getPreviousRollingRange(currentDate, 7),
      currentDate,
      defaultWindow,
    });
  }

  const previousCalendarMonthMatch = /上个自然月|上一个自然月|上月整月|上个月整月/.exec(source);
  if (previousCalendarMonthMatch) {
    return createResolution("previous_calendar_month", {
      matchedText: previousCalendarMonthMatch[0],
      reasonDate: "上个自然月",
      range: getPreviousCalendarMonthRange(currentDate),
      currentDate,
      defaultWindow,
    });
  }

  const rollingMonthMatch = /上个月|上月|近一个月|最近一个月|过去一个月|过去31天|近31天|最近31天/.exec(source);
  if (rollingMonthMatch) {
    return createResolution("last_month_rolling_31_days", {
      matchedText: rollingMonthMatch[0],
      reasonDate: "上个月（过去31天）",
      range: getRollingRangeEndingToday(currentDate, 31),
      currentDate,
      defaultWindow,
    });
  }

  return null;
}

module.exports = {
  DATE_REFERENCE_RESOLUTION_SCHEMA,
  DATE_REFERENCE_RULE_SCHEMA,
  DATE_REFERENCE_RULES,
  DEFAULT_DATE_REFERENCE_INCLUDES,
  HISTORICAL_CONTEXT_TRIGGERS,
  addDaysToDateText,
  buildDefaultContextWindow,
  hasHistoricalContextIntent,
  isDateInsideRange,
  resolveDateReference,
};
