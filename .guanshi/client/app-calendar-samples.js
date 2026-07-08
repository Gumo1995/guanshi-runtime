/* global window */

(function attachCalendarSamplesModule(globalScope) {
  "use strict";

  function assertFunction(name, value) {
    if (typeof value !== "function") {
      throw new Error(`TimeQualityCalendarSamplesModule requires dependency: ${name}`);
    }
  }

  function createCalendarSamplesModule(deps = {}) {
    const {
      CALENDAR_SAMPLE_16_SEEDED_KEY = "time_quality_calendar_sample_16_seeded_v2",
      CALENDAR_SAMPLE_16_MARKER = "[样例16]",
      localStorageRef = globalScope.localStorage || null,
      getEntries,
      setEntries,
      getTodos,
      setTodos,
      getCalendarWeekStart,
      setCalendarWeekStart,
      setCalendarNeedsViewportReset,
      createUniqueEntryId,
      normalizeTodo,
      getNextTodoOrderForDate,
      saveEntries,
      saveTodos,
      calcDurationHours,
      getStartOfWeek,
      getWeekDates,
      formatDateForInput,
    } = deps;

    [
      ["getEntries", getEntries],
      ["setEntries", setEntries],
      ["getTodos", getTodos],
      ["setTodos", setTodos],
      ["getCalendarWeekStart", getCalendarWeekStart],
      ["setCalendarWeekStart", setCalendarWeekStart],
      ["setCalendarNeedsViewportReset", setCalendarNeedsViewportReset],
      ["createUniqueEntryId", createUniqueEntryId],
      ["normalizeTodo", normalizeTodo],
      ["getNextTodoOrderForDate", getNextTodoOrderForDate],
      ["saveEntries", saveEntries],
      ["saveTodos", saveTodos],
      ["calcDurationHours", calcDurationHours],
      ["getStartOfWeek", getStartOfWeek],
      ["getWeekDates", getWeekDates],
      ["formatDateForInput", formatDateForInput],
    ].forEach(([name, value]) => assertFunction(name, value));

    function ensureCalendarSamplesForDay16() {
      try {
        if (localStorageRef && localStorageRef.getItem(CALENDAR_SAMPLE_16_SEEDED_KEY) === "1") {
          return false;
        }
      } catch {
        return false;
      }

      const targetDate = resolveSampleDay16Date();
      if (!targetDate) return false;

      const nowIso = new Date().toISOString();
      const nextEntries = getEntries().filter((item) => !isCalendarSample16Entry(item));
      const nextTodos = getTodos().filter((item) => !isCalendarSample16Todo(item));

      const samples = [
        {
          title: `${CALENDAR_SAMPLE_16_MARKER} 待编辑未评分`,
          start: "08:30",
          end: "09:15",
          category: "工作",
          quality: 0,
          happiness: 0,
          note: `${CALENDAR_SAMPLE_16_MARKER} needsReview 灰色样例`,
          needsReview: true,
        },
        {
          title: `${CALENDAR_SAMPLE_16_MARKER} 高质高幸`,
          start: "09:30",
          end: "10:15",
          category: "学习",
          quality: 9,
          happiness: 9,
          note: `${CALENDAR_SAMPLE_16_MARKER} 高质量高幸福样例`,
          needsReview: false,
        },
        {
          title: `${CALENDAR_SAMPLE_16_MARKER} 高质低幸(深紫)`,
          start: "10:30",
          end: "11:15",
          category: "工作",
          quality: 9,
          happiness: 4,
          note: `${CALENDAR_SAMPLE_16_MARKER} 高质量低幸福样例`,
          needsReview: false,
        },
        {
          title: `${CALENDAR_SAMPLE_16_MARKER} 低质高幸`,
          start: "11:30",
          end: "12:15",
          category: "兴趣",
          quality: 4,
          happiness: 9,
          note: `${CALENDAR_SAMPLE_16_MARKER} 低质量高幸福样例`,
          needsReview: false,
        },
        {
          title: `${CALENDAR_SAMPLE_16_MARKER} 低质低幸`,
          start: "12:30",
          end: "13:15",
          category: "家务",
          quality: 3,
          happiness: 3,
          note: `${CALENDAR_SAMPLE_16_MARKER} 低质量低幸福样例`,
          needsReview: false,
        },
        {
          title: `${CALENDAR_SAMPLE_16_MARKER} 任一>=7(橙色)`,
          start: "13:30",
          end: "14:15",
          category: "社交",
          quality: 7,
          happiness: 6,
          note: `${CALENDAR_SAMPLE_16_MARKER} 任一>=7 橙色样例`,
          needsReview: false,
        },
        {
          title: `${CALENDAR_SAMPLE_16_MARKER} 中性默认`,
          start: "14:30",
          end: "15:15",
          category: "休息",
          quality: 6,
          happiness: 6,
          note: `${CALENDAR_SAMPLE_16_MARKER} 默认中性样例`,
          needsReview: false,
        },
      ];

      for (let index = samples.length - 1; index >= 0; index -= 1) {
        const sample = samples[index];
        nextEntries.unshift({
          id: createUniqueEntryId(),
          title: sample.title,
          date: targetDate,
          start: sample.start,
          end: sample.end,
          category: sample.category,
          quality: sample.quality,
          happiness: sample.happiness,
          note: sample.note,
          duration: calcDurationHours(sample.start, sample.end),
          source: "calendar-sample-16",
          needsReview: Boolean(sample.needsReview),
          createdAt: nowIso,
          updatedAt: nowIso,
        });
      }

      const todoSample = normalizeTodo({
        id: `todo_sample_16_${Date.now()}`,
        title: `${CALENDAR_SAMPLE_16_MARKER} 待办计划灰色块`,
        dueDate: targetDate,
        project: "工作",
        tags: ["样例"],
        note: `${CALENDAR_SAMPLE_16_MARKER} todoPending 灰色样例`,
        qualityScore: null,
        happinessScore: null,
        startTime: "15:30",
        endTime: "16:15",
        estimatedMinutes: 45,
        reminder: "",
        repeat: "none",
        calendarSynced: false,
        completed: false,
        createdAt: nowIso,
        updatedAt: nowIso,
      });
      todoSample.orderInDay = getNextTodoOrderForDate(targetDate, todoSample.id);
      nextTodos.unshift(todoSample);

      setEntries(nextEntries);
      setTodos(nextTodos);
      saveEntries(nextEntries);
      saveTodos(nextTodos);

      const focusDate = new Date(`${targetDate}T00:00:00`);
      if (!Number.isNaN(focusDate.getTime())) {
        setCalendarWeekStart(getStartOfWeek(focusDate));
        setCalendarNeedsViewportReset(true);
      }

      try {
        if (localStorageRef) {
          localStorageRef.setItem(CALENDAR_SAMPLE_16_SEEDED_KEY, "1");
        }
      } catch {
        // ignore localStorage write failure
      }

      return true;
    }

    function resolveSampleDay16Date() {
      const weekDates = getWeekDates(getCalendarWeekStart());
      const weekTarget = weekDates.find((date) => date.getDate() === 16);
      if (weekTarget) {
        return formatDateForInput(weekTarget);
      }
      const now = new Date();
      return formatDateForInput(new Date(now.getFullYear(), now.getMonth(), 16));
    }

    function isCalendarSample16Entry(entry) {
      if (!entry) return false;
      if (String(entry.source || "") === "calendar-sample-16") return true;
      return String(entry.note || "").includes(CALENDAR_SAMPLE_16_MARKER);
    }

    function isCalendarSample16Todo(todo) {
      if (!todo) return false;
      return (
        String(todo.title || "").includes(CALENDAR_SAMPLE_16_MARKER) ||
        String(todo.note || "").includes(CALENDAR_SAMPLE_16_MARKER)
      );
    }

    return {
      ensureCalendarSamplesForDay16,
      resolveSampleDay16Date,
      isCalendarSample16Entry,
      isCalendarSample16Todo,
    };
  }

  globalScope.TimeQualityCalendarSamplesModule = {
    createCalendarSamplesModule,
  };
})(typeof window !== "undefined" ? window : globalThis);
