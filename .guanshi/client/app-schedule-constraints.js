(function attachScheduleConstraints(scope) {
  "use strict";

  const text = (value) => String(value ?? "");
  const ids = (values) => [...new Set((Array.isArray(values) ? values : []).map(text).filter(Boolean))];
  function clock(value) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(text(value));
    if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return null;
    return Number(match[1]) * 60 + Number(match[2]);
  }
  function formatClock(value) {
    return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
  }
  function validDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text(value))) return false;
    const date = new Date(`${value}T12:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }
  function range(value) {
    const start = Number.isInteger(value?.start) ? value.start : clock(value?.startTime ?? value?.start);
    const end = Number.isInteger(value?.end) ? value.end : clock(value?.endTime ?? value?.end);
    return start !== null && end !== null && start >= 0 && end <= 1439 && end > start ? { start, end } : null;
  }
  function normalizeBlock(value) {
    const time = range(value);
    const date = text(value?.date || value?.dueDate);
    if (!time || !validDate(date) || value?.isHard === false) return null;
    return { id: text(value.id), todoId: text(value.todoId), date, ...time, isHard: true, source: text(value.source) };
  }
  function buildFixedBlocks(todos = [], busyBlocks = [], options = {}) {
    const targets = new Set(ids(options.targetIds));
    const blocks = busyBlocks.map(normalizeBlock).filter(Boolean);
    for (const todo of todos) {
      if (todo.completed || (!todo.planLocked && (!options.includeOtherTodos || targets.has(text(todo.id))))) continue;
      const block = normalizeBlock({ ...todo, todoId: todo.id, source: todo.planLocked ? "locked_todo" : "unchanged_todo" });
      if (block) blocks.push(block);
    }
    const unique = new Map(blocks.map((block) => [`${block.todoId || block.id}|${block.date}|${block.start}|${block.end}`, block]));
    return [...unique.values()].sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start || a.end - b.end);
  }
  function overlaps(left, right, gap = 0) {
    return left.date === right.date && left.start < right.end + gap && left.end + gap > right.start;
  }
  function findStart(start, duration, blocks, date, gap = 5) {
    let cursor = start;
    for (const block of blocks.filter((item) => item.date === date).sort((a, b) => a.start - b.start)) {
      if (cursor + duration <= block.start - gap) break;
      if (cursor >= block.end + gap) continue;
      cursor = block.end + gap;
    }
    return cursor;
  }
  function todoState(todo) {
    return {
      id: text(todo.id), dueDate: text(todo.dueDate), startTime: text(todo.startTime), endTime: text(todo.endTime),
      orderInDay: todo.orderInDay ?? null, completed: Boolean(todo.completed), planLocked: Boolean(todo.planLocked),
      estimatedMinutes: todo.estimatedMinutes ?? null, remainingMinutes: todo.remainingMinutes ?? null,
      dependencies: ids(todo.dependencies),
    };
  }
  function fingerprint(todos, busyBlocks, dates) {
    const days = new Set(dates);
    return JSON.stringify({
      todos: todos.filter((todo) => days.has(todo.dueDate)).map(todoState).sort((a, b) => a.id.localeCompare(b.id)),
      busy: buildFixedBlocks([], busyBlocks).filter((block) => days.has(block.date)),
    });
  }
  function fail(code, message, extra = {}) {
    return { feasible: false, changes: [], conflicts: [{ code, message, ...extra }], code, message };
  }
  function validateChanges(todos, changes, options = {}) {
    const byId = new Map(todos.map((todo) => [text(todo.id), todo]));
    const gap = options.gapMinutes ?? 5;
    const movingIds = new Set();
    const scheduled = [];
    const changedDates = new Set(changes.map((change) => change.after?.dueDate));
    if (todos.some((todo) => !todo.completed && todo.planLocked && changedDates.has(todo.dueDate) && !range(todo))) {
      return fail("schedule_locked_range_invalid", "当天有锁定任务缺少有效时间，请先修正其排期。");
    }
    for (const change of changes) {
      if (change.operation && change.operation !== "schedule_todo_block") return fail("schedule_operation_invalid", "草稿包含不支持的操作。");
      const todo = byId.get(text(change.todoId));
      if (!todo || todo.completed) return fail("schedule_target_unavailable", "任务已删除或完成，请重新调整。");
      const after = change.after || {};
      const time = range(after);
      if (!time || !validDate(after.dueDate)) return fail("schedule_range_invalid", "任务时间无效，未应用调整。");
      const timeChanged = ["dueDate", "startTime", "endTime"].some((key) => text(after[key]) !== text(todo[key]));
      if (timeChanged && todo.planLocked) return fail("schedule_target_locked", "任务已锁定，请重新生成安排。", { todoId: todo.id });
      if (change.before) {
        if (change.before.dependencies && JSON.stringify(ids(change.before.dependencies)) !== JSON.stringify(ids(todo.dependencies))) {
          return fail("schedule_state_changed", "任务依赖已变化，请重新调整。");
        }
        for (const key of ["dueDate", "startTime", "endTime", "planLocked", "completed", "orderInDay", "estimatedMinutes", "remainingMinutes"]) {
          if (Object.prototype.hasOwnProperty.call(change.before, key) && text(change.before[key] ?? "") !== text(todo[key] ?? "")) {
            return fail("schedule_state_changed", "任务在预览后发生变化，请重新调整。", { todoId: todo.id });
          }
        }
      }
      if (timeChanged && options.notBefore &&
          (after.dueDate < options.notBefore.date || (after.dueDate === options.notBefore.date && time.start < clock(options.notBefore.time)))) {
        return fail("schedule_in_past", "调整后的任务不能安排在当前时刻之前。");
      }
      if (options.preserveDuration && range(todo) && time.end - time.start !== range(todo).end - range(todo).start) {
        return fail("schedule_duration_changed", "手动排序不能改变任务时长。");
      }
      scheduled.push({ todoId: text(todo.id), date: after.dueDate, ...time, timeChanged });
      if (timeChanged || !todo.planLocked) movingIds.add(text(todo.id));
    }
    const blocks = buildFixedBlocks(todos, options.busyBlocks || [], { targetIds: [...movingIds], includeOtherTodos: true });
    for (let i = 0; i < scheduled.length; i += 1) {
      const current = scheduled[i];
      if (!current.timeChanged) continue;
      const obstacle = blocks.find((block) => block.todoId !== current.todoId && overlaps(current, block, gap));
      if (obstacle) return fail("schedule_overlap", "调整后的时间与锁定任务或已有安排冲突。", { todoId: current.todoId, blockerId: obstacle.todoId || obstacle.id });
      for (let j = 0; j < scheduled.length; j += 1) {
        if (i === j) continue;
        if (overlaps(current, scheduled[j], gap)) return fail("schedule_overlap", "调整后的任务时间互相重叠。");
      }
    }
    const finalRanges = new Map();
    for (const todo of todos) {
      const time = range(todo);
      if (!todo.completed && time) finalRanges.set(text(todo.id), [{ date: todo.dueDate, ...time }]);
    }
    for (const id of movingIds) finalRanges.set(id, scheduled.filter((item) => item.todoId === id));
    // Validate both moved dependents and unchanged dependents of a moved prerequisite.
    for (const todo of todos) {
      if (todo.completed) continue;
      for (const dependencyId of ids(todo.dependencies)) {
        if (!movingIds.has(text(todo.id)) && !movingIds.has(dependencyId)) continue;
        if (byId.get(dependencyId)?.completed) continue;
        const prerequisite = finalRanges.get(dependencyId);
        const dependent = finalRanges.get(text(todo.id));
        if (!prerequisite?.length || !dependent?.length) return fail("schedule_dependency_unavailable", "缺少依赖任务的有效安排，请先处理依赖。");
        const last = [...prerequisite].sort((a, b) => b.date.localeCompare(a.date) || b.end - a.end)[0];
        const first = [...dependent].sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start)[0];
        if (first.date < last.date || (first.date === last.date && first.start < last.end + gap)) {
          return fail("schedule_dependency_order", "调整会使任务排在其依赖完成之前。", { todoId: todo.id, dependencyId });
        }
      }
    }
    return { feasible: true, conflicts: [] };
  }
  function byOrder(a, b) {
    return (Number(a.orderInDay) || 0) - (Number(b.orderInDay) || 0) || text(a.createdAt).localeCompare(text(b.createdAt));
  }
  function splitSegments(list) {
    const segments = [];
    let left = null;
    let items = [];
    for (const todo of list) {
      if (!todo.planLocked) { items.push(todo); continue; }
      segments.push({ left, right: todo, items });
      left = todo;
      items = [];
    }
    segments.push({ left, right: null, items });
    return segments;
  }
  function previewMove(snapshot, intent, options = {}) {
    const todos = snapshot.todos || [];
    const busyBlocks = snapshot.busyBlocks || [];
    const movingIds = ids(intent.todoIds);
    const movingSet = new Set(movingIds);
    const targetDate = text(intent.targetDate);
    const byId = new Map(todos.map((todo) => [text(todo.id), todo]));
    const moving = movingIds.map((id) => byId.get(id));
    if (!moving.length || !validDate(targetDate) || moving.some((todo) => !todo || todo.completed || todo.planLocked || !validDate(todo.dueDate))) {
      return fail("schedule_move_invalid", "已锁定、已完成或不存在的任务不能拖动。");
    }
    if (options.notBefore && targetDate < options.notBefore.date) return fail("schedule_in_past", "不能把任务移到过去的日期。");
    const dates = ids([...moving.map((todo) => todo.dueDate), targetDate]).sort();
    const oldTarget = todos.filter((todo) => !todo.completed && todo.dueDate === targetDate).sort(byOrder);
    const remaining = oldTarget.filter((todo) => !movingSet.has(text(todo.id)));
    let index = Number(intent.targetOrder);
    if (intent.anchorTodoId) {
      index = remaining.findIndex((todo) => text(todo.id) === text(intent.anchorTodoId));
      if (index < 0) return fail("schedule_drop_target_changed", "落点任务已变化，请重新拖动。");
      if (intent.side === "after") index += 1;
    }
    if (!Number.isInteger(index)) return fail("schedule_move_invalid", "拖动位置无效。");
    index = Math.max(0, Math.min(index, remaining.length));
    const desired = [...remaining];
    desired.splice(index, 0, ...moving);
    if (desired.length === oldTarget.length && desired.every((todo, i) => todo.id === oldTarget[i].id)) {
      return { feasible: true, changes: [], conflicts: [], dates, message: "顺序未变化。" };
    }
    if (desired.some((todo) => !range(todo))) return fail("schedule_range_invalid", "请先为任务设置有效的开始和结束时间。");
    const nextById = new Map(todos.map((todo) => [text(todo.id), { ...todo }]));
    for (const todo of moving) nextById.get(text(todo.id)).dueDate = targetDate;
    const gap = options.gapMinutes ?? 5;
    const blocks = buildFixedBlocks(todos, busyBlocks);
    const oldSegments = splitSegments(oldTarget);
    for (const segment of splitSegments(desired)) {
      const old = oldSegments.find((item) => item.left?.id === segment.left?.id && item.right?.id === segment.right?.id)?.items || [];
      const next = segment.items;
      // Removing a task leaves a gap; it must not compact the source segment.
      const first = next.findIndex((todo) => movingSet.has(text(todo.id)));
      if (first < 0) continue;
      const lastChanged = next.reduce((last, todo, i) => movingSet.has(text(todo.id)) ? i : last, first);
      const leftEnd = segment.left ? range(segment.left).end + gap : 0;
      const rightStart = segment.right ? range(segment.right).start - gap : 1439;
      const previous = first ? range(nextById.get(text(next[first - 1].id))) : null;
      const originalStart = previous ? previous.end + gap : segment.left ? leftEnd : old[0] ? range(old[0]).start : (options.firstStartMinutes ?? 570);
      let cursor = Math.max(originalStart, previous ? previous.end + gap : leftEnd);
      if (options.notBefore?.date === targetDate) cursor = Math.max(cursor, clock(options.notBefore.time));
      for (let i = first; i < next.length; i += 1) {
        const todo = next[i];
        const original = range(todo);
        // Once the unchanged suffix still fits, leave its original gaps and times intact.
        if (i > lastChanged && todo.dueDate === targetDate && original.start >= cursor) break;
        const duration = original.end - original.start;
        const start = findStart(cursor, duration, blocks, targetDate, gap);
        if (start + duration > rightStart) {
          return fail("schedule_no_space", segment.right ? "锁定任务前没有足够的连续时间，未应用调整。" : "当天剩余时间放不下，未自动顺延到次日。", { blockerId: segment.right?.id || "" });
        }
        const updated = nextById.get(text(todo.id));
        updated.startTime = formatClock(start);
        updated.endTime = formatClock(start + duration);
        cursor = start + duration + gap;
      }
    }
    for (const date of dates) {
      const day = date === targetDate ? desired : todos.filter((todo) => !todo.completed && todo.dueDate === date && !movingSet.has(text(todo.id))).sort(byOrder);
      day.forEach((todo, order) => { nextById.get(text(todo.id)).orderInDay = order; });
      const times = day.map((todo) => nextById.get(text(todo.id)));
      for (let i = 1; i < times.length; i += 1) {
        if (range(times[i]) && range(times[i - 1]) && range(times[i]).start < range(times[i - 1]).start) {
          return fail("schedule_order_conflict", "该位置无法保持任务顺序与实际时间一致。");
        }
      }
    }
    const changes = todos.flatMap((todo) => {
      const next = nextById.get(text(todo.id));
      if (["dueDate", "startTime", "endTime", "orderInDay"].every((key) => todo[key] === next[key])) return [];
      return [{ todoId: text(todo.id), title: todo.title, before: todoState(todo), after: { dueDate: next.dueDate, startTime: next.startTime, endTime: next.endTime, orderInDay: next.orderInDay } }];
    });
    const validation = validateChanges(todos, changes, { busyBlocks, gapMinutes: gap, preserveDuration: true, notBefore: options.notBefore });
    if (!validation.feasible) return validation;
    return {
      feasible: true, changes, conflicts: [], dates, kind: "manual_move", gapMinutes: gap,
      expectedState: { dates, fingerprint: fingerprint(todos, busyBlocks, dates) },
      message: changes.length ? `调整 ${changes.filter((change) => ["dueDate", "startTime", "endTime"].some((key) => change.before[key] !== change.after[key])).length} 条任务的时间；松手应用，可撤销。` : "顺序未变化。",
    };
  }
  const api = { clock, formatClock, validDate, range, normalizeBlock, buildFixedBlocks, overlaps, findStart, todoState, fingerprint, validateChanges, previewMove };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (scope) scope.TimeQualityScheduleConstraints = api;
})(typeof window !== "undefined" ? window : globalThis);
