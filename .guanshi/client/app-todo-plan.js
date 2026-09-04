(function attachTimeQualityTodoPlanModule(globalScope) {
  if (!globalScope) return;

  function requireFunction(deps, key) {
    const value = deps[key];
    if (typeof value !== "function") {
      throw new Error(`TimeQualityTodoPlanModule missing required function dependency: ${key}`);
    }
    return value;
  }

  function parseInteger(value, fallback) {
    const parsed = Number.parseInt(String(value ?? ""), 10);
    return Number.isInteger(parsed) ? parsed : fallback;
  }

  function normalizeTodoIdList(todoIds) {
    const source = Array.isArray(todoIds) ? todoIds : [todoIds];
    const seen = new Set();
    const ids = [];
    for (const value of source) {
      const id = String(value || "").trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
    return ids;
  }

  function pad2(value) {
    return String(value).padStart(2, "0");
  }

  function formatDateFromLocalDate(date) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  }

  function addDaysToDateInput(dateText, days = 1) {
    const base = new Date(`${String(dateText || "").trim()}T12:00:00`);
    if (Number.isNaN(base.getTime())) return "";
    base.setDate(base.getDate() + Number.parseInt(String(days || 0), 10));
    return formatDateFromLocalDate(base);
  }

  function clampMinutes(value) {
    return Math.max(0, Math.min(24 * 60 - 1, Math.floor(value)));
  }

  function createTodoPlanModule(deps = {}) {
    const parseClockToMinutes = requireFunction(deps, "parseClockToMinutes");
    const formatMinutesForInput = requireFunction(deps, "formatMinutesForInput");
    const isValidDateInput = requireFunction(deps, "isValidDateInput");
    const calcDurationHours = requireFunction(deps, "calcDurationHours");
    const normalizeEntryTitle = requireFunction(deps, "normalizeEntryTitle");
    const getTodoCategory = requireFunction(deps, "getTodoCategory");
    const normalizeScoreForInput = requireFunction(deps, "normalizeScoreForInput");
    const buildEntryDateRange = requireFunction(deps, "buildEntryDateRange");
    const saveTodos = requireFunction(deps, "saveTodos");
    const render = requireFunction(deps, "render");
    const getTodayDateInputValue = requireFunction(deps, "getTodayDateInputValue");
    const getCurrentClockMinutes = requireFunction(deps, "getCurrentClockMinutes");
    const getTodos = requireFunction(deps, "getTodos");
    const getEntries = requireFunction(deps, "getEntries");
    const isTodoOverdue = typeof deps.isTodoOverdue === "function" ? deps.isTodoOverdue : () => false;

    const getCategories = typeof deps.getCategories === "function" ? deps.getCategories : () => [];

    const TODO_PLAN_ENTRY_ID_PREFIX = String(deps.TODO_PLAN_ENTRY_ID_PREFIX || "todo-plan:");
    const TODO_PLAN_DAY_FIRST_START_MINUTES = clampMinutes(
      parseInteger(deps.TODO_PLAN_DAY_FIRST_START_MINUTES, 9 * 60 + 30),
    );
    const TODO_PLAN_DAY_FIRST_DURATION_MINUTES = Math.max(1, parseInteger(deps.TODO_PLAN_DAY_FIRST_DURATION_MINUTES, 45));
    const TODO_PLAN_DAY_NEXT_DURATION_MINUTES = Math.max(1, parseInteger(deps.TODO_PLAN_DAY_NEXT_DURATION_MINUTES, 5));
    const TODO_PLAN_NEW_TODO_DURATION_MINUTES = Math.max(1, parseInteger(deps.TODO_PLAN_NEW_TODO_DURATION_MINUTES, 45));
    const TODO_PLAN_DAY_GAP_MINUTES = Math.max(0, parseInteger(deps.TODO_PLAN_DAY_GAP_MINUTES, 5));

    function getTodoClockRange(todo) {
      if (!todo) return null;
      const startMinutes = parseClockToMinutes(todo.startTime);
      const endMinutes = parseClockToMinutes(todo.endTime);
      if (!Number.isInteger(startMinutes) || !Number.isInteger(endMinutes)) return null;
      if (endMinutes <= startMinutes) return null;
      return { startMinutes, endMinutes };
    }

    function getTodoDurationMinutes(todo, fallbackMinutes = TODO_PLAN_DAY_NEXT_DURATION_MINUTES) {
      const estimated = Number.parseInt(String(todo?.estimatedMinutes ?? ""), 10);
      if (Number.isInteger(estimated) && estimated >= 5 && estimated <= 24 * 60) {
        return estimated;
      }
      const range = getTodoClockRange(todo);
      if (range) {
        return Math.max(5, range.endMinutes - range.startMinutes);
      }
      const fallback = Number.parseInt(String(fallbackMinutes || TODO_PLAN_DAY_NEXT_DURATION_MINUTES), 10);
      if (Number.isInteger(fallback) && fallback >= 5) {
        return Math.min(24 * 60, fallback);
      }
      return TODO_PLAN_DAY_NEXT_DURATION_MINUTES;
    }

    function isTodoPlanLocked(todo) {
      return Boolean(todo?.planLocked);
    }

    function getLockedTodoClockRange(todo) {
      if (!isTodoPlanLocked(todo)) return null;
      return getTodoClockRange(todo);
    }

    function buildLockedTimeBlocks(dayTodos) {
      const blocks = [];
      for (const todo of dayTodos) {
        const range = getLockedTodoClockRange(todo);
        if (!range) continue;
        const startMinutes = clampMinutes(Math.max(0, range.startMinutes - TODO_PLAN_DAY_GAP_MINUTES));
        const endMinutes = clampMinutes(Math.min(24 * 60 - 1, range.endMinutes + TODO_PLAN_DAY_GAP_MINUTES));
        if (endMinutes <= startMinutes) continue;
        blocks.push({ startMinutes, endMinutes });
      }
      if (!blocks.length) return [];
      blocks.sort((a, b) => a.startMinutes - b.startMinutes);
      const merged = [];
      for (const block of blocks) {
        const last = merged[merged.length - 1];
        if (!last || block.startMinutes > last.endMinutes) {
          merged.push({ ...block });
          continue;
        }
        if (block.endMinutes > last.endMinutes) {
          last.endMinutes = block.endMinutes;
        }
      }
      return merged;
    }

    function findNextAvailableStartSkippingLocked(startMinutes, durationMinutes, lockedBlocks) {
      let candidate = clampMinutes(startMinutes);
      const duration = Math.max(1, Math.floor(durationMinutes));
      for (const block of lockedBlocks) {
        if (candidate + duration <= block.startMinutes) {
          break;
        }
        if (candidate >= block.endMinutes) {
          continue;
        }
        candidate = block.endMinutes;
      }
      return clampMinutes(candidate);
    }

    function setTodoRangeByStartAndDuration(todo, startMinutes, durationMinutes) {
      const safeStart = clampMinutes(startMinutes);
      const safeDuration = Math.max(1, Math.floor(durationMinutes));
      const safeEnd = Math.max(safeStart + 1, Math.min(24 * 60 - 1, safeStart + safeDuration));
      todo.startTime = formatMinutesForInput(safeStart);
      todo.endTime = formatMinutesForInput(safeEnd);
      return {
        startMinutes: safeStart,
        endMinutes: safeEnd,
        durationMinutes: safeEnd - safeStart,
      };
    }

    function sortTodosByDayOrder(list) {
      return [...list].sort((a, b) => {
        const orderA = Number.isFinite(Number(a.orderInDay)) ? Number(a.orderInDay) : Number.MAX_SAFE_INTEGER;
        const orderB = Number.isFinite(Number(b.orderInDay)) ? Number(b.orderInDay) : Number.MAX_SAFE_INTEGER;
        if (orderA !== orderB) return orderA - orderB;
        return String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
      });
    }

    function getIncompleteTodosByDate(date) {
      const key = String(date || "").trim();
      if (!isValidDateInput(key)) return [];
      const todos = getTodos();
      return sortTodosByDayOrder(
        todos.filter((todo) => !todo.completed && String(todo.dueDate || "").trim() === key),
      );
    }

    function normalizeTodoOrderForDate(date) {
      const key = String(date || "").trim();
      if (!isValidDateInput(key)) return false;
      const dayTodos = getIncompleteTodosByDate(key);
      let changed = false;
      dayTodos.forEach((todo, index) => {
        if (todo.orderInDay !== index) {
          todo.orderInDay = index;
          changed = true;
        }
      });
      return changed;
    }

    function normalizeTodoOrderByClockForDate(date) {
      const key = String(date || "").trim();
      if (!isValidDateInput(key)) return false;
      const dayTodos = getIncompleteTodosByDate(key);
      if (!dayTodos.length) return false;

      const orderedByClock = [...dayTodos].sort((a, b) => {
        const rangeA = getTodoClockRange(a);
        const rangeB = getTodoClockRange(b);
        const hasRangeA = Boolean(rangeA);
        const hasRangeB = Boolean(rangeB);
        if (hasRangeA !== hasRangeB) return hasRangeA ? -1 : 1;
        if (hasRangeA && hasRangeB) {
          if (rangeA.startMinutes !== rangeB.startMinutes) {
            return rangeA.startMinutes - rangeB.startMinutes;
          }
          if (rangeA.endMinutes !== rangeB.endMinutes) {
            return rangeA.endMinutes - rangeB.endMinutes;
          }
        }
        const orderA = Number.isFinite(Number(a.orderInDay)) ? Number(a.orderInDay) : Number.MAX_SAFE_INTEGER;
        const orderB = Number.isFinite(Number(b.orderInDay)) ? Number(b.orderInDay) : Number.MAX_SAFE_INTEGER;
        if (orderA !== orderB) return orderA - orderB;
        return String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
      });

      let changed = false;
      orderedByClock.forEach((todo, index) => {
        if (todo.orderInDay === index) return;
        todo.orderInDay = index;
        changed = true;
      });
      return changed;
    }

    function getNextTodoOrderForDate(date, excludedTodoId = null) {
      const key = String(date || "").trim();
      if (!isValidDateInput(key)) return 0;
      const excludedId = excludedTodoId === null ? "" : String(excludedTodoId);
      const dayTodos = getIncompleteTodosByDate(key).filter((todo) => String(todo.id) !== excludedId);
      if (!dayTodos.length) return 0;
      const last = dayTodos[dayTodos.length - 1];
      const lastOrder = Number.isFinite(Number(last.orderInDay)) ? Number(last.orderInDay) : dayTodos.length - 1;
      return lastOrder + 1;
    }

    function markTodoPlanningDirty(todo, timestampIso = new Date().toISOString()) {
      todo.updatedAt = timestampIso;
      todo.calendarSynced = false;
      todo.syncState = "dirty";
      todo.lastSyncError = "";
    }

    function reflowTodoDayFromStart(date, options = {}) {
      const key = String(date || "").trim();
      if (!isValidDateInput(key)) return false;
      const markDirty = options.markDirty !== false;
      const timestampIso = String(options.timestampIso || new Date().toISOString());
      const parsedMinStart = Number.parseInt(String(options.minStartMinutes ?? ""), 10);
      const minStartMinutes = Number.isInteger(parsedMinStart)
        ? clampMinutes(parsedMinStart)
        : null;
      const parsedStartOverride = Number.parseInt(String(options.startMinutesOverride ?? ""), 10);
      const startMinutesOverride = Number.isInteger(parsedStartOverride)
        ? clampMinutes(parsedStartOverride)
        : null;
      normalizeTodoOrderForDate(key);
      const dayTodos = getIncompleteTodosByDate(key);
      const lockedBlocks = buildLockedTimeBlocks(dayTodos);
      let cursor = startMinutesOverride === null ? TODO_PLAN_DAY_FIRST_START_MINUTES : startMinutesOverride;
      if (startMinutesOverride === null && minStartMinutes !== null) {
        cursor = Math.max(cursor, minStartMinutes);
      }
      let changed = false;

      dayTodos.forEach((todo, index) => {
        const lockedRange = getLockedTodoClockRange(todo);
        if (lockedRange) {
          cursor = Math.max(cursor, lockedRange.endMinutes + TODO_PLAN_DAY_GAP_MINUTES);
          return;
        }
        const fallbackDuration = index === 0 ? TODO_PLAN_DAY_FIRST_DURATION_MINUTES : TODO_PLAN_DAY_NEXT_DURATION_MINUTES;
        const duration = getTodoDurationMinutes(todo, fallbackDuration);
        const prevStart = String(todo.startTime || "");
        const prevEnd = String(todo.endTime || "");
        const prevEstimate = Number.parseInt(String(todo.estimatedMinutes ?? ""), 10);
        const nextStart = findNextAvailableStartSkippingLocked(cursor, duration, lockedBlocks);
        const next = setTodoRangeByStartAndDuration(todo, nextStart, duration);
        const nextEstimate = Math.max(5, duration);
        if (prevEstimate !== nextEstimate) {
          todo.estimatedMinutes = nextEstimate;
        }
        if (prevStart !== todo.startTime || prevEnd !== todo.endTime || prevEstimate !== nextEstimate) {
          changed = true;
          if (markDirty) {
            markTodoPlanningDirty(todo, timestampIso);
          }
        }
        cursor = next.endMinutes + TODO_PLAN_DAY_GAP_MINUTES;
      });

      return changed;
    }

    function reflowTodoDayAfterAnchor(date, anchorTodoId, options = {}) {
      const key = String(date || "").trim();
      const anchorId = String(anchorTodoId || "");
      if (!isValidDateInput(key) || !anchorId) return false;
      const markDirty = options.markDirty !== false;
      const timestampIso = String(options.timestampIso || new Date().toISOString());
      const parsedMinStart = Number.parseInt(String(options.minStartMinutes ?? ""), 10);
      const minStartMinutes = Number.isInteger(parsedMinStart)
        ? clampMinutes(parsedMinStart)
        : null;
      normalizeTodoOrderForDate(key);
      const dayTodos = getIncompleteTodosByDate(key);
      const lockedBlocks = buildLockedTimeBlocks(dayTodos);
      const anchorIndex = dayTodos.findIndex((todo) => String(todo.id) === anchorId);
      if (anchorIndex < 0) return false;

      let anchorRange = getTodoClockRange(dayTodos[anchorIndex]);
      if (!anchorRange) {
        const previous = anchorIndex > 0 ? getTodoClockRange(dayTodos[anchorIndex - 1]) : null;
        const baseStart = previous ? previous.endMinutes + TODO_PLAN_DAY_GAP_MINUTES : TODO_PLAN_DAY_FIRST_START_MINUTES;
        const fallbackDuration =
          anchorIndex === 0 ? TODO_PLAN_DAY_FIRST_DURATION_MINUTES : TODO_PLAN_DAY_NEXT_DURATION_MINUTES;
        const duration = getTodoDurationMinutes(dayTodos[anchorIndex], fallbackDuration);
        const prevEstimate = Number.parseInt(String(dayTodos[anchorIndex].estimatedMinutes ?? ""), 10);
        setTodoRangeByStartAndDuration(dayTodos[anchorIndex], baseStart, duration);
        if (prevEstimate !== duration) {
          dayTodos[anchorIndex].estimatedMinutes = duration;
        }
        if (markDirty) {
          markTodoPlanningDirty(dayTodos[anchorIndex], timestampIso);
        }
        anchorRange = getTodoClockRange(dayTodos[anchorIndex]);
      }
      if (!anchorRange) return false;

      let cursor = anchorRange.endMinutes + TODO_PLAN_DAY_GAP_MINUTES;
      if (minStartMinutes !== null) {
        cursor = Math.max(cursor, minStartMinutes);
      }
      let changed = false;

      for (let index = anchorIndex + 1; index < dayTodos.length; index += 1) {
        const todo = dayTodos[index];
        const lockedRange = getLockedTodoClockRange(todo);
        if (lockedRange) {
          cursor = Math.max(cursor, lockedRange.endMinutes + TODO_PLAN_DAY_GAP_MINUTES);
          continue;
        }
        const duration = getTodoDurationMinutes(todo, TODO_PLAN_DAY_NEXT_DURATION_MINUTES);
        const prevStart = String(todo.startTime || "");
        const prevEnd = String(todo.endTime || "");
        const prevEstimate = Number.parseInt(String(todo.estimatedMinutes ?? ""), 10);
        const nextStart = findNextAvailableStartSkippingLocked(cursor, duration, lockedBlocks);
        const next = setTodoRangeByStartAndDuration(todo, nextStart, duration);
        const nextEstimate = Math.max(5, duration);
        if (prevEstimate !== nextEstimate) {
          todo.estimatedMinutes = nextEstimate;
        }
        if (prevStart !== todo.startTime || prevEnd !== todo.endTime || prevEstimate !== nextEstimate) {
          changed = true;
          if (markDirty) {
            markTodoPlanningDirty(todo, timestampIso);
          }
        }
        cursor = next.endMinutes + TODO_PLAN_DAY_GAP_MINUTES;
      }

      return changed;
    }

    function reflowTodoDayFromIndex(date, startIndex, options = {}) {
      const key = String(date || "").trim();
      if (!isValidDateInput(key)) return false;

      normalizeTodoOrderForDate(key);
      const dayTodos = getIncompleteTodosByDate(key);
      if (!dayTodos.length) return false;

      const normalizedStart = Number.isInteger(Number(startIndex)) ? Number(startIndex) : 0;
      if (normalizedStart <= 0) {
        return reflowTodoDayFromStart(key, options);
      }

      const anchor = dayTodos[Math.min(dayTodos.length - 1, normalizedStart - 1)];
      if (!anchor) {
        return reflowTodoDayFromStart(key, options);
      }
      return reflowTodoDayAfterAnchor(key, anchor.id, options);
    }

    function assignScheduleForNewTodo(todo) {
      if (!todo) return;
      const dueDate = isValidDateInput(todo.dueDate) ? todo.dueDate : getTodayDateInputValue();
      todo.dueDate = dueDate;
      normalizeTodoOrderForDate(dueDate);

      const sameDayTodos = getIncompleteTodosByDate(dueDate);
      const isFirst = sameDayTodos.length === 0;
      const defaultDuration = isFirst ? TODO_PLAN_DAY_FIRST_DURATION_MINUTES : TODO_PLAN_NEW_TODO_DURATION_MINUTES;
      const lastTodo = isFirst ? null : sameDayTodos[sameDayTodos.length - 1];
      const lastRange = lastTodo ? getTodoClockRange(lastTodo) : null;
      const startMinutes = isFirst
        ? TODO_PLAN_DAY_FIRST_START_MINUTES
        : (lastRange ? lastRange.endMinutes : TODO_PLAN_DAY_FIRST_START_MINUTES) + TODO_PLAN_DAY_GAP_MINUTES;

      setTodoRangeByStartAndDuration(todo, startMinutes, defaultDuration);
      todo.estimatedMinutes = defaultDuration;
      todo.orderInDay = getNextTodoOrderForDate(dueDate);
    }

    function ensureTodoPlanningState() {
      const todos = getTodos();
      let changed = false;
      const daySet = new Set();

      for (const todo of todos) {
        if (todo.completed) continue;
        const dueDate = String(todo.dueDate || "").trim();
        if (!isValidDateInput(dueDate)) {
          todo.dueDate = getTodayDateInputValue();
          changed = true;
        }
        daySet.add(String(todo.dueDate || "").trim());
      }

      for (const day of daySet) {
        if (!isValidDateInput(day)) continue;
        if (normalizeTodoOrderForDate(day)) {
          changed = true;
        }

        const dayTodos = getIncompleteTodosByDate(day);
        let cursor = TODO_PLAN_DAY_FIRST_START_MINUTES;
        dayTodos.forEach((todo, index) => {
          const range = getTodoClockRange(todo);
          if (range) {
            if (!Number.isInteger(Number(todo.estimatedMinutes)) || Number(todo.estimatedMinutes) < 5) {
              todo.estimatedMinutes = Math.max(5, range.endMinutes - range.startMinutes);
              changed = true;
            }
            cursor = range.endMinutes + TODO_PLAN_DAY_GAP_MINUTES;
            return;
          }

          const fallbackDuration =
            index === 0 ? TODO_PLAN_DAY_FIRST_DURATION_MINUTES : TODO_PLAN_DAY_NEXT_DURATION_MINUTES;
          const duration = getTodoDurationMinutes(todo, fallbackDuration);
          const prevStart = String(todo.startTime || "");
          const prevEnd = String(todo.endTime || "");
          const next = setTodoRangeByStartAndDuration(todo, cursor, duration);
          todo.estimatedMinutes = Math.max(5, duration);
          cursor = next.endMinutes + TODO_PLAN_DAY_GAP_MINUTES;
          if (prevStart !== todo.startTime || prevEnd !== todo.endTime) {
            changed = true;
          }
        });
      }

      return changed;
    }

    function getTodoIdFromPlanEntryId(entryId) {
      const text = String(entryId || "");
      if (!text.startsWith(TODO_PLAN_ENTRY_ID_PREFIX)) return "";
      return text.slice(TODO_PLAN_ENTRY_ID_PREFIX.length);
    }

    function createTodoPlanEntry(todo) {
      if (!todo || todo.completed || isTodoOverdue(todo)) return null;
      const dueDate = String(todo.dueDate || "").trim();
      if (!isValidDateInput(dueDate)) return null;
      const range = getTodoClockRange(todo);
      if (!range) return null;
      const duration = calcDurationHours(todo.startTime, todo.endTime);
      if (!duration || duration <= 0) return null;

      const categories = Array.isArray(getCategories()) ? getCategories() : [];
      const fallbackCategory = categories[0];
      return {
        id: `${TODO_PLAN_ENTRY_ID_PREFIX}${todo.id}`,
        title: normalizeEntryTitle(todo.title, todo.project || fallbackCategory),
        date: dueDate,
        start: todo.startTime,
        end: todo.endTime,
        category: getTodoCategory(todo, todo.project),
        quality: normalizeScoreForInput(todo.qualityScore),
        happiness: normalizeScoreForInput(todo.happinessScore),
        note: todo.note || "",
        duration,
        todoPending: true,
        linkedTodoId: String(todo.id),
        orderInDay: Number.isFinite(Number(todo.orderInDay)) ? Number(todo.orderInDay) : 0,
      };
    }

    function getPendingTodoCalendarEntries() {
      const plans = [];
      const todos = getTodos();
      for (const todo of todos) {
        const plan = createTodoPlanEntry(todo);
        if (plan) {
          plans.push(plan);
        }
      }
      return plans;
    }

    function mergeCalendarEntriesWithTodoPlans(baseEntries) {
      const merged = [];
      const seen = new Set();
      const source = Array.isArray(baseEntries) ? baseEntries : [];
      for (const entry of source) {
        if (!entry || !entry.id) continue;
        const id = String(entry.id);
        if (seen.has(id)) continue;
        seen.add(id);
        merged.push(entry);
      }
      for (const plan of getPendingTodoCalendarEntries()) {
        const id = String(plan.id);
        if (seen.has(id)) continue;
        seen.add(id);
        merged.push(plan);
      }
      return merged;
    }

    function findOverlappingCalendarItem(date, start, end, excludedId = null) {
      const targetRange = buildEntryDateRange(date, start, end);
      if (!targetRange) return null;
      const excluded = excludedId === null ? "" : String(excludedId);
      const entries = getEntries();

      for (const item of mergeCalendarEntriesWithTodoPlans(entries)) {
        if (!item || !item.id) continue;
        if (excluded && String(item.id) === excluded) continue;
        const currentRange = buildEntryDateRange(item.date, item.start, item.end);
        if (!currentRange) continue;
        const isOverlapping =
          targetRange.startDate < currentRange.endDate && targetRange.endDate > currentRange.startDate;
        if (isOverlapping) {
          return item;
        }
      }

      return null;
    }

    function scheduleCore() {
      const core = deps.scheduleConstraints || globalScope.TimeQualityScheduleConstraints;
      if (!core) throw new Error("Schedule constraints module is unavailable.");
      return core;
    }

    function getScheduleBusyBlocks() {
      return getEntries().filter((entry) => entry && entry.source !== "todo-plan")
        .map((entry) => scheduleCore().normalizeBlock(entry)).filter(Boolean);
    }

    function previewTodoMove(todoIds, targetDate, targetOrder, anchor = {}) {
      return scheduleCore().previewMove(
        { todos: getTodos(), busyBlocks: getScheduleBusyBlocks() },
        { todoIds: normalizeTodoIdList(todoIds), targetDate, targetOrder, ...anchor },
        {
          gapMinutes: TODO_PLAN_DAY_GAP_MINUTES,
          firstStartMinutes: TODO_PLAN_DAY_FIRST_START_MINUTES,
          notBefore: { date: getTodayDateInputValue(), time: formatMinutesForInput(getCurrentClockMinutes()) },
        },
      );
    }

    function applyTodoScheduleChanges(plan, options = {}) {
      const core = scheduleCore();
      const todos = getTodos();
      const busyBlocks = getScheduleBusyBlocks();
      const failure = (code, message) => ({ feasible: false, applied: 0, created: 0, invalid: 1, missing: 0, appliedIds: [], createdIds: [], updatedIds: [], code, message });
      if (plan?.feasible === false) return failure(plan.code, plan.message);
      if (plan?.expectedState && core.fingerprint(todos, busyBlocks, plan.expectedState.dates) !== plan.expectedState.fingerprint) {
        return failure("schedule_state_changed", "拖动期间任务或占用发生变化，请重新拖动。");
      }
      const isAi = options.kind === "ai";
      const changes = (Array.isArray(plan?.changes) ? plan.changes : []).map((change) => ({
        ...change,
        todoId: String(change.todoId || change.parentTodoId || change.target?.id || ""),
        after: {
          dueDate: change.after?.dueDate || change.dueDate || plan?.dateRange?.start,
          startTime: change.after?.startTime || change.after?.start || change.startTime || change.start,
          endTime: change.after?.endTime || change.after?.end || change.endTime || change.end,
          ...(!isAi && Number.isInteger(change.after?.orderInDay) ? { orderInDay: change.after.orderInDay } : {}),
        },
      }));
      if (!changes.length) return { ...failure("schedule_no_changes", "没有需要应用的调整。"), feasible: true, invalid: 0 };
      if (isAi && changes.some((change) => todos.find((todo) => String(todo.id) === change.todoId)?.planLocked)) {
        return failure("schedule_target_locked", "任务已锁定，请重新生成安排。");
      }
      const validation = core.validateChanges(todos, changes, {
        busyBlocks: [...busyBlocks, ...(plan?.validation?.fixedBlocks || [])],
        gapMinutes: plan?.gapMinutes ?? plan?.validation?.gapMinutes ?? TODO_PLAN_DAY_GAP_MINUTES,
        preserveDuration: !isAi,
        notBefore: { date: getTodayDateInputValue(), time: formatMinutesForInput(getCurrentClockMinutes()) },
      });
      if (!validation.feasible) return failure(validation.code, validation.message);
      if (options.dryRun) return { feasible: true, applied: 0, created: 0, invalid: 0, missing: 0, appliedIds: [], createdIds: [], updatedIds: [] };

      const nowIso = new Date().toISOString();
      const nextTodos = todos.map((todo) => ({ ...todo, aiMeta: todo.aiMeta ? { ...todo.aiMeta } : todo.aiMeta }));
      const byId = new Map(nextTodos.map((todo) => [String(todo.id), todo]));
      const originals = new Map(todos.map((todo) => [String(todo.id), todo]));
      const used = new Set();
      const splitIds = new Map();
      const touchedDates = new Set();
      const appliedIds = [], createdIds = [], updatedIds = [];
      for (const change of changes) {
        const base = byId.get(change.todoId);
        const original = originals.get(change.todoId);
        let todo = base;
        if (isAi && used.has(change.todoId)) {
          const blockIndex = Number(change.blockIndex) || 1;
          const blockCount = Number(change.blockCount) || 2;
          todo = {
            ...original,
            id: `todo_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
            title: `${original.title}（${blockIndex + 1}/${blockCount}）`,
            externalCalendarId: "", externalReminderId: "", completionEntryId: "",
            createdAt: nowIso, aiMeta: { ...(original.aiMeta || {}), sourceTodoId: original.id },
          };
          nextTodos.push(todo);
          createdIds.push(todo.id);
          splitIds.set(original.id, [...(splitIds.get(original.id) || []), todo.id]);
        } else updatedIds.push(todo.id);
        touchedDates.add(original.dueDate);
        touchedDates.add(change.after.dueDate);
        Object.assign(todo, change.after);
        if (isAi) {
          const time = core.range(change.after);
          todo.estimatedMinutes = time.end - time.start;
          todo.remainingMinutes = Math.min(Math.max(0, Number(original.remainingMinutes) || todo.estimatedMinutes), todo.estimatedMinutes);
          todo.aiMeta = {
            ...(todo.aiMeta || {}), source: todo.aiMeta?.source || "ai_schedule_draft", scheduleSource: "ai_schedule_draft",
            scheduleDraftId: plan.draftId || "", scheduleChangeId: change.changeId || "", scheduleAppliedAt: nowIso,
          };
        }
        markTodoPlanningDirty(todo, nowIso);
        used.add(change.todoId);
        appliedIds.push(todo.id);
      }
      if (isAi) {
        // A dependency on a split task still means completion of all of its blocks.
        for (const todo of nextTodos) {
          const dependencies = Array.isArray(todo.dependencies) ? todo.dependencies : [];
          const added = dependencies.flatMap((id) => splitIds.get(id) || []);
          if (added.length) {
            todo.dependencies = [...new Set([...dependencies, ...added])];
            markTodoPlanningDirty(todo, nowIso);
          }
        }
        for (const date of touchedDates) {
          nextTodos.filter((todo) => !todo.completed && todo.dueDate === date)
            .sort((a, b) => (core.range(a)?.start ?? 1440) - (core.range(b)?.start ?? 1440) || (Number(a.orderInDay) || 0) - (Number(b.orderInDay) || 0))
            .forEach((todo, order) => { todo.orderInDay = order; });
        }
      }
      const previous = [...todos];
      todos.splice(0, todos.length, ...nextTodos);
      try {
        saveTodos(todos, { undoBoundary: true });
      } catch (error) {
        todos.splice(0, todos.length, ...previous);
        return failure("schedule_save_failed", "保存失败，调整未应用，请检查本地存储后重试。");
      }
      if (options.render !== false) render();
      return { feasible: true, applied: appliedIds.length, created: createdIds.length, invalid: 0, missing: 0, appliedIds, createdIds, updatedIds };
    }

    function applyTodoScheduleDraft(draft, options = {}) {
      return applyTodoScheduleChanges(draft, { ...options, kind: "ai", render: false });
    }

    function moveTodoOrder(todoId, direction) {
      const todo = getTodos().find((item) => String(item.id) === String(todoId));
      if (!todo) return false;
      const day = getIncompleteTodosByDate(todo.dueDate);
      const index = day.findIndex((item) => String(item.id) === String(todoId));
      const target = index + Number(direction);
      if (!Number.isInteger(target) || target < 0 || target >= day.length) return false;
      return moveTodoToOrder(todoId, target);
    }

    function moveTodoToOrder(todoId, nextOrderInDay) {
      const todo = getTodos().find((item) => String(item.id) === String(todoId));
      if (!todo) return false;
      return moveTodosToDateOrder([todoId], todo.dueDate, nextOrderInDay);
    }

    function moveTodosToDateOrder(todoIds, nextDueDate, nextOrderInDay) {
      const preview = previewTodoMove(todoIds, nextDueDate, nextOrderInDay);
      const result = applyTodoScheduleChanges(preview);
      if (!result.feasible && typeof deps.onScheduleConflict === "function") deps.onScheduleConflict(result.message);
      return result.applied > 0;
    }

    function moveTodoToDateOrder(todoId, nextDueDate, nextOrderInDay) {
      return moveTodosToDateOrder([todoId], nextDueDate, nextOrderInDay);
    }

    function applyDirectEditDraftForTodoPlan(state, draft) {
      if (!state || state.sourceKind !== "todo-plan" || !draft) {
        return { handled: false, applied: false };
      }

      const todoId = String(state.sourceTodoId || getTodoIdFromPlanEntryId(state.entryId) || "");
      const todos = getTodos();
      const todo = todos.find((item) => String(item.id) === todoId);
      if (!todo || todo.completed) {
        return { handled: true, applied: false };
      }

      const oldDueDate = String(todo.dueDate || "").trim();
      const oldDayIndex = isValidDateInput(oldDueDate)
        ? getIncompleteTodosByDate(oldDueDate).findIndex((item) => String(item.id) === String(todo.id))
        : -1;
      const nowIso = new Date().toISOString();
      const rawDuration = Number(draft.duration);
      const nextDurationMinutes = Number.isFinite(rawDuration)
        ? Math.max(5, Math.round(rawDuration * 60))
        : getTodoDurationMinutes(todo, TODO_PLAN_NEW_TODO_DURATION_MINUTES);

      todo.dueDate = draft.date;
      todo.startTime = draft.start;
      todo.endTime = draft.end;
      todo.estimatedMinutes = nextDurationMinutes;
      if (oldDueDate !== todo.dueDate) {
        todo.orderInDay = getNextTodoOrderForDate(todo.dueDate, todo.id);
      }
      markTodoPlanningDirty(todo, nowIso);

      if (oldDueDate && oldDueDate !== todo.dueDate) {
        reflowTodoDayFromIndex(oldDueDate, oldDayIndex, { markDirty: true, timestampIso: nowIso });
      }
      reflowTodoDayAfterAnchor(todo.dueDate, todo.id, { markDirty: true, timestampIso: nowIso });
      saveTodos(todos);
      render();

      return { handled: true, applied: true };
    }

    return {
      getTodoClockRange,
      getTodoDurationMinutes,
      setTodoRangeByStartAndDuration,
      sortTodosByDayOrder,
      getIncompleteTodosByDate,
      normalizeTodoOrderForDate,
      normalizeTodoOrderByClockForDate,
      getNextTodoOrderForDate,
      markTodoPlanningDirty,
      reflowTodoDayFromStart,
      reflowTodoDayAfterAnchor,
      reflowTodoDayFromIndex,
      assignScheduleForNewTodo,
      ensureTodoPlanningState,
      getTodoIdFromPlanEntryId,
      createTodoPlanEntry,
      getPendingTodoCalendarEntries,
      mergeCalendarEntriesWithTodoPlans,
      findOverlappingCalendarItem,
      previewTodoMove,
      applyTodoScheduleChanges,
      applyTodoScheduleDraft,
      moveTodoOrder,
      moveTodoToOrder,
      moveTodosToDateOrder,
      moveTodoToDateOrder,
      applyDirectEditDraftForTodoPlan,
    };
  }

  const existing = globalScope.TimeQualityTodoPlanModule || {};
  globalScope.TimeQualityTodoPlanModule = {
    ...existing,
    createTodoPlanModule,
  };
})(typeof window !== "undefined" ? window : globalThis);
