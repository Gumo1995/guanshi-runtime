"use strict";

const scheduleConstraints = require("./schedule-constraints");

const SCHEDULER_INPUT_SCHEMA = "guanshi-scheduler-input-v1";
const SCHEDULE_DRAFT_SCHEMA = "guanshi-schedule-draft-v1";

const DEFAULT_FIRST_START_MINUTES = 9 * 60 + 30;
const DEFAULT_DAY_END_MINUTES = 21 * 60 + 30;
const DEFAULT_GAP_MINUTES = 5;
const DEFAULT_TASK_MINUTES = 45;
const MIN_BLOCK_MINUTES = 5;

const PRIORITY_RANK = {
  P0: 0,
  urgent: 0,
  P1: 1,
  high: 1,
  P2: 2,
  medium: 2,
  P3: 3,
  low: 3,
  P4: 4,
};

function createSchedulerError(code, message, statusCode = 400, details = {}) {
  const error = new Error(message || code);
  error.code = code;
  error.statusCode = statusCode;
  error.details = details && typeof details === "object" ? details : {};
  return error;
}

function normalizeText(value, maxLength = 4000) {
  return String(value || "").trim().slice(0, maxLength);
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function parseDateInput(value) {
  const text = normalizeText(value, 20);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T12:00:00`);
  return Number.isFinite(date.getTime()) ? date : null;
}

function formatDate(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function addDays(dateText, days) {
  const date = parseDateInput(dateText);
  if (!date) return "";
  date.setDate(date.getDate() + days);
  return formatDate(date);
}

function getDateRange(start, end, maxDays = 7) {
  const startDate = parseDateInput(start);
  const endDate = parseDateInput(end || start);
  if (!startDate || !endDate) {
    throw createSchedulerError("AI_SCHEDULER_DATE_RANGE_INVALID", "Scheduler dateRange is invalid.", 400);
  }
  const dates = [];
  let cursor = formatDate(startDate);
  const endText = formatDate(endDate);
  while (cursor <= endText && dates.length < maxDays) {
    dates.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return dates;
}

function parseClockToMinutes(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(normalizeText(value, 8));
  if (!match) return null;
  const hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }
  return hours * 60 + minutes;
}

function formatMinutes(value) {
  const safe = Math.max(0, Math.min(24 * 60 - 1, Math.floor(value)));
  return `${pad2(Math.floor(safe / 60))}:${pad2(safe % 60)}`;
}

function normalizeInteger(value, fallback, min = 0, max = 24 * 60) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function normalizeTodo(todo, index) {
  const source = todo && typeof todo === "object" && !Array.isArray(todo) ? todo : {};
  const id = normalizeText(source.id || `todo_${index}`, 120);
  const estimatedMinutes = normalizeInteger(source.estimatedMinutes, DEFAULT_TASK_MINUTES, 0, 24 * 60);
  const remainingMinutes = normalizeInteger(source.remainingMinutes, estimatedMinutes || DEFAULT_TASK_MINUTES, 0, 24 * 60);
  const minimumBlockMinutes = normalizeInteger(source.minimumBlockMinutes, Math.min(DEFAULT_TASK_MINUTES, Math.max(MIN_BLOCK_MINUTES, remainingMinutes)), MIN_BLOCK_MINUTES, 24 * 60);
  return {
    id,
    title: normalizeText(source.title || id, 200),
    category: normalizeText(source.category, 80),
    dueDate: normalizeText(source.dueDate, 20),
    startTime: normalizeText(source.startTime, 8),
    endTime: normalizeText(source.endTime, 8),
    estimatedMinutes,
    remainingMinutes,
    hasEstimatedMinutes: source.estimatedMinutes !== null && source.estimatedMinutes !== undefined,
    hasRemainingMinutes: source.remainingMinutes !== null && source.remainingMinutes !== undefined,
    priority: normalizeText(source.priority || "P2", 20),
    importance: Number.isFinite(Number(source.importance)) ? Number(source.importance) : 0,
    urgency: Number.isFinite(Number(source.urgency)) ? Number(source.urgency) : 0,
    taskType: normalizeText(source.taskType || "other", 40),
    energyLevel: normalizeText(source.energyLevel, 40),
    splittable: source.splittable === true,
    minimumBlockMinutes,
    dependencies: Array.isArray(source.dependencies) ? source.dependencies.map((item) => normalizeText(item, 120)).filter(Boolean) : [],
    planLocked: source.planLocked === true,
    repeat: normalizeText(source.repeat || "none", 40),
    orderInDay: normalizeInteger(source.orderInDay, index, 0, 100000),
    hasOrderInDay: source.orderInDay !== null && source.orderInDay !== undefined,
    completed: source.completed === true,
  };
}

function normalizeWindow(window, fallbackDate) {
  const source = window && typeof window === "object" && !Array.isArray(window) ? window : {};
  const date = normalizeText(source.date || fallbackDate, 20);
  const start = parseClockToMinutes(source.start) ?? DEFAULT_FIRST_START_MINUTES;
  const end = parseClockToMinutes(source.end) ?? DEFAULT_DAY_END_MINUTES;
  if (end <= start) return null;
  return { date, start, end };
}

function normalizeBusyBlock(block, index) {
  const source = block && typeof block === "object" && !Array.isArray(block) ? block : {};
  const date = normalizeText(source.date, 20);
  const start = parseClockToMinutes(source.start);
  const end = parseClockToMinutes(source.end);
  if (!date || start === null || end === null || end <= start) return null;
  return {
    id: normalizeText(source.id || `busy_${index}`, 120),
    source: normalizeText(source.source || "busy", 80),
    date,
    start,
    end,
    isHard: source.isHard !== false,
  };
}

function normalizeNotBeforeConstraint(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const date = normalizeText(source.date || source.localDate, 20);
  const minutes = parseClockToMinutes(source.time || source.localTime);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || minutes === null) return null;
  return {
    date,
    minutes,
    time: formatMinutes(minutes),
    source: normalizeText(source.source || "scheduler_input", 80),
  };
}

function getTodoRange(todo) {
  const start = parseClockToMinutes(todo.startTime);
  const end = parseClockToMinutes(todo.endTime);
  if (start === null || end === null || end <= start) return null;
  return { start, end };
}

function mergeIntervals(intervals) {
  const sorted = intervals
    .filter((item) => item && Number.isInteger(item.start) && Number.isInteger(item.end) && item.end > item.start)
    .sort((left, right) => left.start - right.start);
  const merged = [];
  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (!last || interval.start > last.end) {
      merged.push({ ...interval });
      continue;
    }
    last.end = Math.max(last.end, interval.end);
  }
  return merged;
}

function subtractBlocked(window, blocked) {
  let available = [{ start: window.start, end: window.end }];
  for (const block of blocked) {
    const next = [];
    for (const slot of available) {
      if (block.end <= slot.start || block.start >= slot.end) {
        next.push(slot);
        continue;
      }
      if (block.start > slot.start) next.push({ start: slot.start, end: block.start });
      if (block.end < slot.end) next.push({ start: block.end, end: slot.end });
    }
    available = next;
  }
  return available.filter((slot) => slot.end - slot.start >= MIN_BLOCK_MINUTES);
}

function isWorkLikeTodo(todo) {
  if (todo.category === "工作") return true;
  return ["deep_work", "admin", "communication", "learning"].includes(todo.taskType);
}

function buildHardBoundaryMap(memoryProjections, usedMemoryIds = null) {
  const boundaries = {};
  for (const memory of memoryProjections || []) {
    if (!memory || memory.status !== "active" || memory.strength !== "hard" || !memory.rule) continue;
    const kind = normalizeText(memory.rule.kind, 80);
    if (kind === "no_work_after") {
      const minutes = parseClockToMinutes(memory.rule.time);
      if (minutes !== null) {
        boundaries.noWorkAfter = Math.min(boundaries.noWorkAfter ?? minutes, minutes);
        if (usedMemoryIds && memory.memoryId) usedMemoryIds.add(normalizeText(memory.memoryId, 120));
      }
    }
  }
  return boundaries;
}

function buildFixedBreakBlocks(memoryProjections, dates, usedMemoryIds = null) {
  const blocks = [];
  for (const memory of memoryProjections || []) {
    if (!memory || memory.status !== "active" || memory.strength !== "hard" || !memory.rule) continue;
    if (normalizeText(memory.rule.kind, 80) !== "fixed_break") continue;
    const start = parseClockToMinutes(memory.rule.start);
    const end = parseClockToMinutes(memory.rule.end);
    if (start === null || end === null || end <= start) continue;
    if (usedMemoryIds && memory.memoryId) usedMemoryIds.add(normalizeText(memory.memoryId, 120));
    for (const date of dates) {
      blocks.push({
        id: `${memory.memoryId || "memory"}:${date}`,
        source: "memory_fixed_break",
        date,
        start,
        end,
        isHard: true,
        memoryId: memory.memoryId,
      });
    }
  }
  return blocks;
}

function getPriorityRank(priority) {
  return PRIORITY_RANK[priority] ?? 9;
}

function sortTodos(todos, strategy) {
  return [...todos].sort((left, right) => {
    if (strategy === "minimal_change") {
      return String(left.dueDate || "9999-99-99").localeCompare(String(right.dueDate || "9999-99-99"))
        || left.orderInDay - right.orderInDay;
    }
    if (strategy === "deadline_first") {
      const dueCompare = String(left.dueDate || "9999-99-99").localeCompare(String(right.dueDate || "9999-99-99"));
      if (dueCompare !== 0) return dueCompare;
    }
    const priorityCompare = getPriorityRank(left.priority) - getPriorityRank(right.priority);
    if (priorityCompare !== 0) return priorityCompare;
    const dueCompare = String(left.dueDate || "9999-99-99").localeCompare(String(right.dueDate || "9999-99-99"));
    if (dueCompare !== 0) return dueCompare;
    const importanceCompare = right.importance - left.importance;
    if (importanceCompare !== 0) return importanceCompare;
    const urgencyCompare = right.urgency - left.urgency;
    if (urgencyCompare !== 0) return urgencyCompare;
    return left.orderInDay - right.orderInDay;
  });
}

function reorderByDependencies(todos) {
  const byId = new Map(todos.map((todo) => [todo.id, todo]));
  const visited = new Set();
  const visiting = new Set();
  const ordered = [];
  const conflicts = [];

  function visit(todo) {
    if (visited.has(todo.id)) return;
    if (visiting.has(todo.id)) {
      conflicts.push({
        conflictId: `conflict_dependency_cycle_${todo.id}`,
        type: "dependency_unmet",
        severity: "hard",
        message: "任务依赖存在循环，无法稳定排序。",
        targets: [{ kind: "todo", id: todo.id }],
        suggestedResolution: "edit_dependencies",
      });
      return;
    }
    visiting.add(todo.id);
    for (const dependencyId of todo.dependencies) {
      const dependency = byId.get(dependencyId);
      if (dependency) visit(dependency);
    }
    visiting.delete(todo.id);
    visited.add(todo.id);
    ordered.push(todo);
  }

  for (const todo of todos) visit(todo);
  return { ordered, conflicts };
}

function findSlotForDuration(date, duration, windowsByDate, blockedByDate, limits = {}) {
  if (limits.notBefore && date < limits.notBefore.date) return null;
  const windows = windowsByDate.get(date) || [];
  const blocked = mergeIntervals(blockedByDate.get(date) || []);
  for (const window of windows) {
    const slots = subtractBlocked(window, blocked);
    for (const slot of slots) {
      const start = Math.max(slot.start, limits.notBefore?.date === date ? limits.notBefore.minutes : 0);
      const end = Math.min(slot.end, limits.endBoundary ?? DEFAULT_DAY_END_MINUTES);
      if (end - start >= duration) {
        return { date, start, end: start + duration };
      }
    }
  }
  return null;
}

function addBlockedInterval(blockedByDate, date, start, end, gap) {
  const intervals = blockedByDate.get(date) || [];
  intervals.push({
    start: Math.max(0, start - gap),
    end: Math.min(24 * 60 - 1, end + gap),
  });
  blockedByDate.set(date, intervals);
}

function buildChange(todo, block, reason, blockIndex = 0, blockCount = 1) {
  return {
    changeId: `change_${todo.id}_${block.date}_${formatMinutes(block.start).replace(":", "")}_${blockIndex + 1}`,
    operation: "schedule_todo_block",
    todoId: todo.id,
    title: todo.title,
    parentTodoId: todo.id,
    blockIndex,
    blockCount,
    before: {
      dueDate: todo.dueDate || "",
      startTime: todo.startTime || "",
      endTime: todo.endTime || "",
      planLocked: todo.planLocked,
      completed: todo.completed,
      ...(todo.hasOrderInDay ? { orderInDay: todo.orderInDay } : {}),
      ...(todo.hasEstimatedMinutes ? { estimatedMinutes: todo.estimatedMinutes } : {}),
      ...(todo.hasRemainingMinutes ? { remainingMinutes: todo.remainingMinutes } : {}),
      dependencies: todo.dependencies,
    },
    after: {
      dueDate: block.date,
      startTime: formatMinutes(block.start),
      endTime: formatMinutes(block.end),
    },
    durationMinutes: block.end - block.start,
    reason,
    requiresConfirmation: true,
  };
}

function createCapacityConflict(todo, unscheduledMinutes) {
  return {
    conflictId: `conflict_capacity_${todo.id}`,
    type: "capacity_overload",
    severity: "hard",
    message: `可用时间不足，${todo.title} 仍有 ${unscheduledMinutes} 分钟未安排。`,
    targets: [{ kind: "todo", id: todo.id }],
    suggestedResolution: "move_to_next_day",
  };
}

function createMinBlockConflict(todo) {
  return {
    conflictId: `conflict_min_block_${todo.id}`,
    type: "min_block_unavailable",
    severity: "hard",
    message: `找不到满足 ${todo.title} 最小连续时长的可用时间块。`,
    targets: [{ kind: "todo", id: todo.id }],
    suggestedResolution: "split_or_extend_window",
  };
}

function createBoundaryConflict(todo) {
  return {
    conflictId: `conflict_boundary_${todo.id}`,
    type: "hard_boundary_violation",
    severity: "hard",
    message: `${todo.title} 受硬边界限制，不能安排到工作边界之后。`,
    targets: [{ kind: "todo", id: todo.id }],
    suggestedResolution: "move_before_boundary_or_change_memory",
  };
}

function createScheduleDraft(input = {}, options = {}) {
  const request = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  if (normalizeText(request.schema || SCHEDULER_INPUT_SCHEMA) !== SCHEDULER_INPUT_SCHEMA) {
    throw createSchedulerError("AI_SCHEDULER_INPUT_SCHEMA_INVALID", "Scheduler input schema is invalid.", 400);
  }
  const now = typeof options.now === "function" ? options.now() : new Date().toISOString();
  const requestId = normalizeText(request.requestId || `req_${now.replace(/[^0-9]/g, "").slice(0, 14)}`, 120);
  const action = normalizeText(request.action || "plan_today", 80);
  const source = request.source && typeof request.source === "object" && !Array.isArray(request.source)
    ? request.source
    : {};
  const dateRange = request.dateRange && typeof request.dateRange === "object" ? request.dateRange : {};
  const maxDays = normalizeInteger(request.options?.maxDays, 7, 1, 14);
  const dates = getDateRange(dateRange.start, dateRange.end || dateRange.start, maxDays);
  const defaultGapMinutes = normalizeInteger(request.options?.defaultGapMinutes, DEFAULT_GAP_MINUTES, 0, 60);
  const strategy = normalizeText(request.options?.strategy || "balanced", 80);
  const allowSplitLongTasks = request.options?.allowSplitLongTasks !== false;
  const memoryProjections = Array.isArray(request.memoryProjections) ? request.memoryProjections : [];
  const usedMemoryIds = new Set();

  const windowsByDate = new Map();
  const configuredWindows = Array.isArray(request.options?.workingWindows) ? request.options.workingWindows : [];
  for (const date of dates) {
    const windows = configuredWindows
      .filter((window) => !window.date || normalizeText(window.date, 20) === date)
      .map((window) => normalizeWindow(window, date))
      .filter(Boolean);
    if (!windows.length) windows.push({ date, start: DEFAULT_FIRST_START_MINUTES, end: DEFAULT_DAY_END_MINUTES });
    windowsByDate.set(date, windows);
  }

  const busyBlocks = (Array.isArray(request.busyBlocks) ? request.busyBlocks : [])
    .map(normalizeBusyBlock)
    .filter(Boolean);
  busyBlocks.push(...buildFixedBreakBlocks(memoryProjections, dates, usedMemoryIds));

  const allInputTodos = (Array.isArray(request.todos) ? request.todos : []).map(normalizeTodo);
  const todos = allInputTodos.filter((todo) => !todo.completed)
    .filter((todo) => action === "reflow_unfinished" || !todo.dueDate || dates.includes(todo.dueDate));
  const fixedTodos = (Array.isArray(request.fixedTodos) ? request.fixedTodos : []).map(normalizeTodo);
  const movable = todos.filter((todo) => !todo.planLocked && (request.options?.allowMoveExistingUnlocked !== false || !getTodoRange(todo)));
  const movableIds = new Set(movable.map((todo) => todo.id));
  const knownTodos = new Map([...fixedTodos, ...allInputTodos].map((todo) => [todo.id, todo]));
  const fixedBlocks = scheduleConstraints.buildFixedBlocks([...knownTodos.values()], busyBlocks, {
    targetIds: [...movableIds], includeOtherTodos: true,
  });
  const blockedByDate = new Map();
  for (const block of fixedBlocks) {
    if (dates.includes(block.date)) addBlockedInterval(blockedByDate, block.date, block.start, block.end, defaultGapMinutes);
  }
  const notBefore = normalizeNotBeforeConstraint(request.options?.notBefore);
  if (notBefore && dates.includes(notBefore.date) && notBefore.minutes > 0) {
    addBlockedInterval(blockedByDate, notBefore.date, 0, notBefore.minutes, 0);
  }
  const boundaries = buildHardBoundaryMap(memoryProjections, usedMemoryIds);
  const { ordered, conflicts: dependencyConflicts } = reorderByDependencies(sortTodos(movable, strategy));
  const changes = [];
  const conflicts = [...dependencyConflicts];
  const unscheduledTodos = [];
  const completionById = new Map();
  for (const todo of knownTodos.values()) {
    const time = getTodoRange(todo);
    if (!movableIds.has(todo.id) && time && todo.dueDate) completionById.set(todo.id, { date: todo.dueDate, minutes: time.end + defaultGapMinutes });
  }
  let orderCursor = null;
  const later = (left, right) => !left ? right : !right ? left
    : left.date > right.date || (left.date === right.date && left.minutes >= right.minutes) ? left : right;
  const dependencyConflict = (todo) => ({
    conflictId: `conflict_dependency_${todo.id}`, type: "dependency_unmet", severity: "hard",
    message: `${todo.title} 的依赖尚无可用的完成时间。`, targets: [{ kind: "todo", id: todo.id }], suggestedResolution: "schedule_dependency_first",
  });

  for (const todo of ordered) {
    let remaining = Math.max(MIN_BLOCK_MINUTES, todo.remainingMinutes || todo.estimatedMinutes || DEFAULT_TASK_MINUTES);
    const plannedBlocks = [];
    const previousBlocks = new Map([...blockedByDate].map(([date, blocks]) => [date, blocks.map((block) => ({ ...block }))]));
    const taskBoundary = boundaries.noWorkAfter && isWorkLikeTodo(todo) ? boundaries.noWorkAfter : null;
    const minimumBlock = Math.max(MIN_BLOCK_MINUTES, Math.min(todo.minimumBlockMinutes, remaining));
    let lowerBound = strategy === "minimal_change" ? orderCursor : null;
    let dependencyMissing = dependencyConflicts.some((conflict) => conflict.targets.some((target) => target.id === todo.id));
    for (const id of todo.dependencies) {
      if (knownTodos.get(id)?.completed) continue;
      const completedAt = completionById.get(id);
      if (!completedAt) dependencyMissing = true;
      else lowerBound = later(lowerBound, completedAt);
    }
    if (dependencyMissing) {
      unscheduledTodos.push(todo.id);
      conflicts.push(dependencyConflict(todo));
      continue;
    }
    const limits = { notBefore: lowerBound, endBoundary: taskBoundary ?? 1439 };
    const original = getTodoRange(todo);
    // Preserve an existing valid slot before searching for a new one.
    if (strategy === "minimal_change" && original && dates.includes(todo.dueDate) && original.end - original.start === remaining) {
      const slot = findSlotForDuration(todo.dueDate, remaining, windowsByDate, blockedByDate, {
        ...limits, notBefore: later(lowerBound, { date: todo.dueDate, minutes: original.start }),
      });
      if (slot && slot.start === original.start) {
        plannedBlocks.push(slot);
        addBlockedInterval(blockedByDate, slot.date, slot.start, slot.end, defaultGapMinutes);
        remaining = 0;
      }
    }
    let attempts = 0;
    while (remaining >= MIN_BLOCK_MINUTES && attempts < 100) {
      attempts += 1;
      const canSplit = allowSplitLongTasks && todo.splittable;
      if (canSplit && remaining < minimumBlock) break;
      let duration = canSplit ? Math.min(remaining, 90) : remaining;
      if (canSplit && remaining > duration && remaining - duration < minimumBlock) duration = remaining - minimumBlock;
      let slot = null;
      while (!slot && duration >= minimumBlock) {
        for (const date of dates) {
          slot = findSlotForDuration(date, duration, windowsByDate, blockedByDate, limits);
          if (slot) break;
        }
        if (!canSplit) break;
        if (!slot) {
          if (duration === minimumBlock) break;
          duration = Math.max(minimumBlock, duration - 15);
        }
      }
      if (!slot) break;
      plannedBlocks.push(slot);
      addBlockedInterval(blockedByDate, slot.date, slot.start, slot.end, defaultGapMinutes);
      remaining -= slot.end - slot.start;
      limits.notBefore = { date: slot.date, minutes: slot.end + defaultGapMinutes };
      if (!canSplit) break;
    }
    if (!plannedBlocks.length) {
      unscheduledTodos.push(todo.id);
      conflicts.push(createMinBlockConflict(todo));
      if (taskBoundary !== null && dates.some((date) => findSlotForDuration(date, remaining, windowsByDate, blockedByDate, { notBefore: lowerBound, endBoundary: 1439 }))) {
        conflicts.push(createBoundaryConflict(todo));
      }
      continue;
    }
    if (remaining > 0) {
      unscheduledTodos.push(todo.id);
      conflicts.push(createCapacityConflict(todo, remaining));
      // Applying only part would replace the original Todo and lose its unallocated duration.
      blockedByDate.clear();
      for (const [date, blocks] of previousBlocks) blockedByDate.set(date, blocks);
      if (original && todo.dueDate) addBlockedInterval(blockedByDate, todo.dueDate, original.start, original.end, defaultGapMinutes);
      continue;
    } else {
      const last = plannedBlocks[plannedBlocks.length - 1];
      completionById.set(todo.id, { date: last.date, minutes: last.end + defaultGapMinutes });
    }
    const last = plannedBlocks[plannedBlocks.length - 1];
    if (strategy === "minimal_change") orderCursor = { date: last.date, minutes: last.end + defaultGapMinutes };
    plannedBlocks.forEach((block, index) => {
      if (plannedBlocks.length === 1 && todo.dueDate === block.date && original?.start === block.start && original?.end === block.end) return;
      changes.push(buildChange(todo, block,
        plannedBlocks.length > 1 ? "长任务按最小时间块拆分安排。" : strategy === "minimal_change" ? "保留原顺序，仅调整无法保留的时间。" : "按优先级、截止日期和可用时间安排。",
        index, plannedBlocks.length));
    });
  }
  // Unscheduled targets remain at their old times. Do not emit a draft that collides with them.
  const validation = scheduleConstraints.validateChanges([...knownTodos.values()], changes, { busyBlocks: fixedBlocks, gapMinutes: defaultGapMinutes });
  if (!validation.feasible) {
    conflicts.push({ conflictId: "conflict_final_validation", type: "schedule_constraint_violation", severity: "hard", message: validation.message, targets: [], suggestedResolution: "regenerate_schedule" });
    changes.splice(0);
  }

  const changedTodoIds = Array.from(new Set(changes.map((change) => change.todoId)));
  const draftId = normalizeText(request.draftId, 120) || `draft_${now.replace(/[^0-9]/g, "").slice(0, 14)}`;
  const actionable = changes.length > 0;
  return {
    schema: SCHEDULE_DRAFT_SCHEMA,
    draftId,
    source: {
      kind: normalizeText(source.kind || "local_scheduler", 80),
      requestId,
      action,
      client: normalizeText(source.client, 120),
    },
    status: actionable ? "pending" : "not_actionable",
    actionable,
    dateRange: {
      start: dates[0],
      end: dates[dates.length - 1],
    },
    summary: actionable
      ? `安排 ${changes.length} 个时间块，影响 ${changedTodoIds.length} 个任务。`
      : "没有生成可执行的排程变更。",
    changes,
    validation: { fixedBlocks, gapMinutes: defaultGapMinutes },
    conflicts,
    impact: {
      todosChanged: changedTodoIds.length,
      calendarBlocksAdded: 0,
      remindersChanged: 0,
      memoryUsed: Array.from(usedMemoryIds),
      progressUsed: request.progressSummary ? ["summary"] : [],
      unscheduledTodos,
    },
    undo: {
      transactionId: null,
      restorable: true,
    },
    createdAt: now,
  };
}

module.exports = {
  SCHEDULE_DRAFT_SCHEMA,
  SCHEDULER_INPUT_SCHEMA,
  createScheduleDraft,
  createSchedulerError,
  parseClockToMinutes,
};
