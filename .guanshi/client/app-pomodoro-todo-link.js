/* global window */

(function attachTimeQualityPomodoroTodoLinkModule(globalScope) {
  "use strict";

  function requireFunction(deps, key) {
    const value = deps[key];
    if (typeof value !== "function") {
      throw new Error(`TimeQualityPomodoroTodoLinkModule missing required function dependency: ${key}`);
    }
    return value;
  }

  function createPomodoroTodoLinkModule(deps = {}) {
    const TODO_PLAN_DAY_GAP_MINUTES = Number(deps.TODO_PLAN_DAY_GAP_MINUTES) || 0;

    const getCategories = requireFunction(deps, "getCategories");
    const getTodos = requireFunction(deps, "getTodos");
    const isValidDateInput = requireFunction(deps, "isValidDateInput");
    const getIncompleteTodosByDate = requireFunction(deps, "getIncompleteTodosByDate");
    const getTodoCategory = requireFunction(deps, "getTodoCategory");
    const normalizeEntryTitle = requireFunction(deps, "normalizeEntryTitle");
    const normalizeScoreForInput = requireFunction(deps, "normalizeScoreForInput");
    const getNextTodoOrderForDate = requireFunction(deps, "getNextTodoOrderForDate");
    const markTodoPlanningDirty = requireFunction(deps, "markTodoPlanningDirty");
    const reflowTodoDayFromIndex = requireFunction(deps, "reflowTodoDayFromIndex");
    const toggleTodoCompleted = requireFunction(deps, "toggleTodoCompleted");
    const savePomodoroEntry = requireFunction(deps, "savePomodoroEntry");
    const formatDateForInput = requireFunction(deps, "formatDateForInput");
    const moveTodoToDateOrder = requireFunction(deps, "moveTodoToDateOrder");
    const reflowTodoDayAfterAnchor = requireFunction(deps, "reflowTodoDayAfterAnchor");
    const saveTodos = requireFunction(deps, "saveTodos");
    const render = requireFunction(deps, "render");

    function getFallbackCategory(todo) {
      const categories = getCategories();
      return getTodoCategory(todo, todo?.project || categories[0] || "工作");
    }

    function completeLinkedTodoByPomodoroSession(todo, scoreResult, sessionRange) {
      if (!todo || todo.completed || !sessionRange?.ok) return false;
      const oldDueDate = String(todo.dueDate || "").trim();
      const oldDayIndex = isValidDateInput(oldDueDate)
        ? getIncompleteTodosByDate(oldDueDate).findIndex((item) => String(item.id) === String(todo.id))
        : -1;
      const nowIso = new Date().toISOString();
      const categoryFallback = getFallbackCategory(todo);
      const normalizedTitle = normalizeEntryTitle(scoreResult.title, todo.title || categoryFallback);
      if (normalizedTitle) {
        todo.title = normalizedTitle;
      }
      todo.dueDate = sessionRange.date;
      todo.startTime = sessionRange.start;
      todo.endTime = sessionRange.end;
      todo.estimatedMinutes = sessionRange.durationMinutes;
      todo.qualityScore = normalizeScoreForInput(scoreResult.quality);
      todo.happinessScore = normalizeScoreForInput(scoreResult.happiness);
      if (oldDueDate !== todo.dueDate && isValidDateInput(todo.dueDate)) {
        todo.orderInDay = getNextTodoOrderForDate(todo.dueDate, todo.id);
      }
      markTodoPlanningDirty(todo, nowIso);
      if (oldDueDate && oldDueDate !== todo.dueDate && isValidDateInput(oldDueDate)) {
        reflowTodoDayFromIndex(oldDueDate, oldDayIndex, { markDirty: true, timestampIso: nowIso });
      }
      toggleTodoCompleted(todo.id, { skipLinkedPomodoroInterception: true });
      return true;
    }

    function recordLinkedTodoPomodoroSession(todo, scoreResult, sessionRange) {
      if (!todo || todo.completed || !sessionRange?.ok) return false;
      const focusMinutes = sessionRange.durationMinutes;
      const category = getFallbackCategory(todo);
      const created = savePomodoroEntry({
        endDate: sessionRange.endDate,
        durationSeconds: sessionRange.durationSeconds,
        title: scoreResult.title,
        quality: scoreResult.quality,
        happiness: scoreResult.happiness,
        note: `番茄钟专注${focusMinutes}分钟（任务未完成）`,
        source: "pomodoro-session",
        categoryOverride: category,
        includeTodoPlans: false,
      });
      if (!created) return false;

      const nextStartDate = new Date(sessionRange.endDate.getTime() + TODO_PLAN_DAY_GAP_MINUTES * 60 * 1000);
      const nextDueDate = formatDateForInput(nextStartDate);
      const targetOrder = getNextTodoOrderForDate(nextDueDate, todo.id);
      const moved = moveTodoToDateOrder(todo.id, nextDueDate, targetOrder);
      if (!moved) {
        const nowIso = new Date().toISOString();
        const minStartMinutes = nextStartDate.getHours() * 60 + nextStartDate.getMinutes();
        markTodoPlanningDirty(todo, nowIso);
        reflowTodoDayAfterAnchor(todo.dueDate, todo.id, {
          markDirty: true,
          timestampIso: nowIso,
          minStartMinutes,
        });
        saveTodos(getTodos());
        render();
      }
      return true;
    }

    return {
      completeLinkedTodoByPomodoroSession,
      recordLinkedTodoPomodoroSession,
    };
  }

  globalScope.TimeQualityPomodoroTodoLinkModule = { createPomodoroTodoLinkModule };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = globalScope.TimeQualityPomodoroTodoLinkModule;
  }
})(typeof window !== "undefined" ? window : globalThis);
