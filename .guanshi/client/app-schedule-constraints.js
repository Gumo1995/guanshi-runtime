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
      if (todo.todoKind === "group" || todo.scheduleState === "unplanned" || todo.completed || (!todo.planLocked && (!options.includeOtherTodos || targets.has(text(todo.id))))) continue;
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
      dependencies: ids(todo.dependencies), todoKind: todo.todoKind || "task", containerTodoId: todo.containerTodoId || null, scheduleState: todo.scheduleState || null,
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
      if (!todo || todo.todoKind === "group" || todo.completed) return fail("schedule_target_unavailable", "任务已删除或完成，请重新调整。");
      const after = change.after || {};
      const time = range(after);
      if (!time || !validDate(after.dueDate)) return fail("schedule_range_invalid", "任务时间无效，未应用调整。");
      const timeChanged = ["dueDate", "startTime", "endTime"].some((key) => text(after[key]) !== text(todo[key]));
      if (timeChanged && todo.planLocked) return fail("schedule_target_locked", "任务已锁定，请重新生成安排。", { todoId: todo.id });
      if (change.before) {
        const currentState = todoState(todo);
        if (change.before.dependencies && JSON.stringify(ids(change.before.dependencies)) !== JSON.stringify(ids(todo.dependencies))) {
          return fail("schedule_state_changed", "任务依赖已变化，请重新调整。");
        }
        for (const key of ["dueDate", "startTime", "endTime", "planLocked", "completed", "orderInDay", "estimatedMinutes", "remainingMinutes", "todoKind", "containerTodoId", "scheduleState"]) {
          if (Object.prototype.hasOwnProperty.call(change.before, key) && text(change.before[key] ?? "") !== text(currentState[key] ?? "")) {
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
      if (obstacle) {
        const message = obstacle.source === "locked_todo"
          ? "调整后的时间与锁定待办冲突。"
          : obstacle.source === "unchanged_todo"
            ? "调整后的时间与已有待办冲突。"
            : "调整后的时间与日历或时间记录占用冲突。";
        return fail("schedule_overlap", message, { todoId: current.todoId, blockerId: obstacle.todoId || obstacle.id, blockerSource: obstacle.source });
      }
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
  function compareTodoDayOrder(a, b) {
    // The clock is authoritative: imports, recurring tasks and edits can leave
    // orderInDay stale, including on locks used as segment boundaries.
    const left = range(a);
    const right = range(b);
    if (Boolean(left) !== Boolean(right)) return left ? -1 : 1;
    if (left && right) {
      const timeDifference = left.start - right.start || left.end - right.end;
      if (timeDifference) return timeDifference;
    }
    const order = (todo) => todo.orderInDay !== null && text(todo.orderInDay).trim() !== "" && Number.isFinite(Number(todo.orderInDay))
      ? Number(todo.orderInDay) : Number.MAX_SAFE_INTEGER;
    return order(a) - order(b) || text(a.createdAt).localeCompare(text(b.createdAt)) || text(a.id).localeCompare(text(b.id));
  }
  function previewPlacement(snapshot, intent, options = {}, newTodo = null) {
    const originalTodos = snapshot.todos || [];
    const todos = newTodo ? [...originalTodos, newTodo] : originalTodos;
    const busyBlocks = snapshot.busyBlocks || [];
    const movingIds = ids(intent.todoIds);
    const movingSet = new Set(movingIds);
    const targetDate = text(intent.targetDate);
    const byId = new Map(todos.map((todo) => [text(todo.id), todo]));
    const moving = movingIds.map((id) => byId.get(id));
    if (!moving.length || !validDate(targetDate) || moving.some((todo) => !todo || todo.todoKind === "group" || todo.scheduleState === "unplanned" || todo.completed || todo.planLocked || !validDate(todo.dueDate))) {
      return fail("schedule_move_invalid", "已锁定、已完成或不存在的任务不能拖动。");
    }
    if (options.notBefore && targetDate < options.notBefore.date) return fail("schedule_in_past", "不能把任务移到过去的日期。");
    const dates = ids([...moving.map((todo) => todo.dueDate), targetDate]).sort();
    const oldTarget = originalTodos.filter((todo) => !todo.completed && todo.dueDate === targetDate).sort(compareTodoDayOrder);
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
    // Every unselected task is fixed for a manual insertion, even if unlocked.
    // The adjacent rows bound the chosen slot; never push a suffix to make room.
    const blocks = buildFixedBlocks(todos, busyBlocks, { targetIds: movingIds, includeOtherTodos: true });
    const previous = index > 0 ? range(remaining[index - 1]) : null;
    const following = index < remaining.length ? range(remaining[index]) : null;
    const notBeforeMinutes = options.notBefore?.date === targetDate ? clock(options.notBefore.time) : null;
    const dayStart = oldTarget.map(range).filter(Boolean).reduce((start, time) => Math.min(start, time.start), 1439);
    const dayStartTodo = oldTarget.find((todo) => range(todo)?.start === dayStart);
    // Reordering an existing Todo to the top of its own day is a slot reorder,
    // not a new insertion before the day. Keep a future first slot stable, but
    // never put unfinished work back into an already-passed slot: in that case
    // restart at the next five-minute clock mark and locally reflow the suffix.
    const reorderDayTopSlot = !newTodo
      && moving.every((todo) => todo.dueDate === targetDate)
      && index === 0
      && Number.isInteger(dayStart)
      && !dayStartTodo?.planLocked;
    const alignedNotBeforeMinutes = notBeforeMinutes === null
      ? null
      : Math.ceil(notBeforeMinutes / 5) * 5;
    const topSlotStart = reorderDayTopSlot
      ? Math.max(dayStart, alignedNotBeforeMinutes ?? dayStart)
      : dayStart;
    const reuseDayTopSlot = reorderDayTopSlot && topSlotStart === dayStart;
    const alignExpiredTopSlot = reorderDayTopSlot && topSlotStart > dayStart;
    let lower = previous ? previous.end + gap : 0;
    const upper = following ? following.start - gap : 1439;
    if (notBeforeMinutes !== null && !reuseDayTopSlot) lower = Math.max(lower, notBeforeMinutes);
    const fits = (time) => time.start >= lower && time.end <= upper &&
      !blocks.some((block) => overlaps({ date: targetDate, ...time }, block, gap));
    // Keep valid original clock times when they already fit the requested order.
    let placements = moving.map(range);
    const preserve = !newTodo && placements.every((time, i) => fits(time) &&
      (i === 0 || placements[i - 1].end + gap <= time.start));
    if (!preserve) {
      placements = [];
      if (!previous && following) {
        // Before the day's first row, search backwards from its start. This
        // uses the closest available gap instead of stealing that row's time.
        let end = upper;
        const dayBlocks = blocks.filter((block) => block.date === targetDate).sort((a, b) => b.end - a.end);
        for (let i = moving.length - 1; i >= 0; i -= 1) {
          const original = range(moving[i]);
          const duration = original.end - original.start;
          for (const block of dayBlocks) {
            if (end <= block.start - gap || end - duration >= block.end + gap) continue;
            end = block.start - gap;
          }
          const time = { start: end - duration, end };
          placements.unshift(time);
          end = time.start - gap;
        }
      } else {
        // Between rows / at the end, start after the preceding row. An empty
        // day retains the normal default start and current-clock constraint.
        let cursor = previous ? lower : Math.max(lower, options.firstStartMinutes ?? 570);
        for (const todo of moving) {
          const original = range(todo);
          const duration = original.end - original.start;
          const start = findStart(cursor, duration, blocks, targetDate, gap);
          placements.push({ start, end: start + duration });
          cursor = start + duration + gap;
        }
      }
    }
    let localReflowApplied = false;
    if (!reuseDayTopSlot && placements.every(fits)) {
      moving.forEach((todo, i) => {
        const updated = nextById.get(text(todo.id));
        updated.startTime = formatClock(placements[i].start);
        updated.endTime = formatClock(placements[i].end);
      });
    } else if (!newTodo) {
      // A manual reorder may cascade from the drop slot through the necessary
      // unlocked suffix. The prefix, locked Todos and busy blocks remain fixed.
      // This preserves gap-first placement without making every neighbour
      // behave like a locked task when the chosen slot is dense.
      const fixedBlocks = buildFixedBlocks(todos, busyBlocks, { includeOtherTodos: false });
      const previousTodo = index > 0 ? nextById.get(text(remaining[index - 1].id)) : null;
      const previousTime = range(previousTodo);
      let cursor = previousTime
        ? previousTime.end + gap
        : reorderDayTopSlot
          ? topSlotStart
          : Math.max(0, options.firstStartMinutes ?? 570);
      if (notBeforeMinutes !== null && !reorderDayTopSlot) cursor = Math.max(cursor, notBeforeMinutes);
      let reflowFailure = null;

      for (const todo of desired.slice(index)) {
        const updated = nextById.get(text(todo.id));
        const original = range(updated);
        if (!original) {
          reflowFailure = { blockerId: text(todo.id), reason: "invalid_range" };
          break;
        }
        if (updated.planLocked) {
          if (original.start < cursor) {
            if (!alignExpiredTopSlot) {
              reflowFailure = { blockerId: text(todo.id), reason: "locked_boundary" };
              break;
            }
            continue;
          }
          cursor = original.end + gap;
          continue;
        }

        const duration = original.end - original.start;
        const canPreserve = !movingSet.has(text(todo.id))
          && original.start >= cursor
          && !fixedBlocks.some((block) => overlaps({ date: targetDate, ...original }, block, gap));
        const start = canPreserve
          ? original.start
          : findStart(cursor, duration, fixedBlocks, targetDate, gap);
        const candidate = { start, end: start + duration };
        if (candidate.end > 1439) {
          reflowFailure = { blockerId: text(todo.id), reason: "day_overflow" };
          break;
        }
        updated.startTime = formatClock(candidate.start);
        updated.endTime = formatClock(candidate.end);
        cursor = candidate.end + gap;
      }

      if (reflowFailure) {
        return fail("schedule_no_space", "该位置无法在锁定任务和忙碌时间之间完成局部重排，原安排未改动。", reflowFailure);
      }
      localReflowApplied = true;
    } else {
      return fail("schedule_no_space", "该位置没有足够的空闲时间，请选择其他位置；已有待办时间未改动。",
        { blockerId: remaining[index]?.id || "" });
    }
    for (const date of dates) {
      const desiredPosition = new Map(desired.map((todo, index) => [text(todo.id), index]));
      const day = date === targetDate
        ? alignExpiredTopSlot
          ? [...desired].sort((left, right) => {
            const leftRange = range(nextById.get(text(left.id)));
            const rightRange = range(nextById.get(text(right.id)));
            if (leftRange && rightRange) return leftRange.start - rightRange.start || leftRange.end - rightRange.end || desiredPosition.get(text(left.id)) - desiredPosition.get(text(right.id));
            return desiredPosition.get(text(left.id)) - desiredPosition.get(text(right.id));
          })
          : desired
        : todos.filter((todo) => !todo.completed && todo.dueDate === date && !movingSet.has(text(todo.id))).sort(compareTodoDayOrder);
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
      if (todo !== newTodo && ["dueDate", "startTime", "endTime", "orderInDay"].every((key) => todo[key] === next[key])) return [];
      return [{ todoId: text(todo.id), title: todo.title, before: todoState(todo), after: { dueDate: next.dueDate, startTime: next.startTime, endTime: next.endTime, orderInDay: next.orderInDay } }];
    });
    const validation = validateChanges(todos, changes, {
      busyBlocks, gapMinutes: gap, preserveDuration: true,
      notBefore: options.notBefore,
    });
    if (!validation.feasible) return validation;
    return {
      feasible: true, changes, conflicts: [], dates, kind: newTodo ? "todo_insert" : "manual_move", gapMinutes: gap,
      localReflowApplied,
      alignedToCurrentTime: alignExpiredTopSlot,
      effectiveStartTime: reorderDayTopSlot ? formatClock(topSlotStart) : "",
      ...(newTodo ? { newTodo } : {}),
      expectedState: { dates, fingerprint: fingerprint(originalTodos, busyBlocks, dates) },
      message: changes.length ? `调整 ${changes.filter((change) => ["dueDate", "startTime", "endTime"].some((key) => change.before[key] !== change.after[key])).length} 条任务的时间；松手应用，可撤销。` : "顺序未变化。",
    };
  }
  function previewMove(snapshot, intent, options = {}) {
    return previewPlacement(snapshot, intent, options);
  }
  function previewInsert(snapshot, todo, intent, options = {}) {
    const duration = Number(todo?.estimatedMinutes);
    if (!todo?.id || (snapshot.todos || []).some((item) => text(item.id) === text(todo.id)) ||
        !Number.isInteger(duration) || duration < 5 || duration > 1439) {
      return fail("schedule_insert_invalid", "新待办的标识或预计时长无效，未新增。");
    }
    // A virtual task participates in the same scheduling checks; it is never
    // added to the live collection until the entire insertion is feasible.
    const candidate = { ...todo, dueDate: intent.targetDate, startTime: "00:00", endTime: formatClock(duration),
      completed: false, planLocked: false, orderInDay: null };
    return previewPlacement(snapshot, { ...intent, todoIds: [text(todo.id)] }, options, candidate);
  }
  const api = { clock, formatClock, validDate, range, normalizeBlock, buildFixedBlocks, overlaps, findStart, todoState, fingerprint, validateChanges, compareTodoDayOrder, previewMove, previewInsert };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (scope) scope.TimeQualityScheduleConstraints = api;
})(typeof window !== "undefined" ? window : globalThis);
