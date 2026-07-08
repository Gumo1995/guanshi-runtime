/* global window */

(function attachTimeQualityExternalCalendarImportModule(globalScope) {
  "use strict";

  function requireFunction(deps, key) {
    const value = deps[key];
    if (typeof value !== "function") {
      throw new Error(`TimeQualityExternalCalendarImportModule missing required function dependency: ${key}`);
    }
    return value;
  }

  function normalizeArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function buildCalendarGroup(sourceName, calendarName) {
    const source = String(sourceName || "").trim();
    const name = String(calendarName || "").trim();
    if (source && name) return `${source}/${name}`;
    return source || name || "";
  }

  function createExternalCalendarImportModule(deps = {}) {
    const EXTERNAL_CALENDAR_SOURCE = String(deps.EXTERNAL_CALENDAR_SOURCE || "mac-calendar");
    const EXTERNAL_CALENDAR_DEFAULT_CATEGORY = String(deps.EXTERNAL_CALENDAR_DEFAULT_CATEGORY || "工作");
    const EXTERNAL_CALENDAR_AUTO_TODO_ENABLED = Boolean(deps.EXTERNAL_CALENDAR_AUTO_TODO_ENABLED);
    const EXTERNAL_CALENDAR_AUTO_TODO_MAX_DURATION_HOURS =
      Number(deps.EXTERNAL_CALENDAR_AUTO_TODO_MAX_DURATION_HOURS) || 12;

    const getEntries = requireFunction(deps, "getEntries");
    const getTodos = requireFunction(deps, "getTodos");
    const getIgnoredExternalCalendarIds = requireFunction(deps, "getIgnoredExternalCalendarIds");
    const getSelectedTodoId = requireFunction(deps, "getSelectedTodoId");
    const setSelectedTodoId = requireFunction(deps, "setSelectedTodoId");
    const getSyncCalendarTarget = requireFunction(deps, "getSyncCalendarTarget");
    const normalizeSyncCalendarTarget = requireFunction(deps, "normalizeSyncCalendarTarget");
    const normalizeTodoCategoryValue = requireFunction(deps, "normalizeTodoCategoryValue");
    const normalizeProjectName = requireFunction(deps, "normalizeProjectName");
    const normalizeEntryTitle = requireFunction(deps, "normalizeEntryTitle");
    const normalizeTodoNoteValue = requireFunction(deps, "normalizeTodoNoteValue");
    const getTodoCategory = requireFunction(deps, "getTodoCategory");
    const isValidDateInput = requireFunction(deps, "isValidDateInput");
    const getNextTodoOrderForDate = requireFunction(deps, "getNextTodoOrderForDate");
    const normalizeTodo = requireFunction(deps, "normalizeTodo");
    const normalizeTodoOrderForDate = requireFunction(deps, "normalizeTodoOrderForDate");
    const buildEntryDateRange = requireFunction(deps, "buildEntryDateRange");
    const formatDateForInput = requireFunction(deps, "formatDateForInput");
    const formatTimeForInput = requireFunction(deps, "formatTimeForInput");
    const isImportedExternalEntry = requireFunction(deps, "isImportedExternalEntry");
    const createUniqueEntryId = requireFunction(deps, "createUniqueEntryId");
    const normalizeExternalCalendarGroupValue = requireFunction(deps, "normalizeExternalCalendarGroupValue");

    let entries = [];
    let todos = [];
    let ignoredExternalCalendarIds = new Set();

    function refreshDataRefs() {
      entries = normalizeArray(getEntries());
      todos = normalizeArray(getTodos());
      const ignored = getIgnoredExternalCalendarIds();
      ignoredExternalCalendarIds = ignored instanceof Set ? ignored : new Set();
    }

    function normalizeExternalCalendarPayload(payload, targetCalendar = getSyncCalendarTarget()) {
      const events = Array.isArray(payload) ? payload : Array.isArray(payload?.events) ? payload.events : [];
      const normalized = [];

      for (const item of events) {
        const event = normalizeExternalCalendarEvent(item);
        if (event) {
          if (!isEventInSyncCalendarTarget(event, targetCalendar)) {
            continue;
          }
          normalized.push(event);
        }
      }

      return normalized;
    }

    function extractTimeQualityTaskIdFromUrl(urlText) {
      const text = String(urlText || "").trim();
      if (!text) return "";

      let parsed = null;
      try {
        parsed = new URL(text);
      } catch {
        return "";
      }

      if (String(parsed.protocol || "").toLowerCase() !== "timequality:") {
        return "";
      }

      const taskId = String(
        parsed.searchParams.get("taskId")
          || parsed.searchParams.get("sourceId")
          || parsed.searchParams.get("id")
          || "",
      ).trim();
      if (!taskId) return "";
      return taskId.slice(0, 120);
    }

    function hasTimeQualityMetaUrl(urlText) {
      return Boolean(extractTimeQualityTaskIdFromUrl(urlText));
    }

    function extractTimeQualityTaskIdFromNote(noteText, urlText = "") {
      const fromUrl = extractTimeQualityTaskIdFromUrl(urlText);
      if (fromUrl) return fromUrl;

      const text = String(noteText || "").replace(/\r\n/g, "\n").trim();
      if (!text) return "";
      if (!/\[TimeQuality/i.test(text)) return "";
      const match = text.match(/(?:来源任务|任务ID|taskId)\s*[:：]\s*([^\n\r]+)/i);
      if (!match || !match[1]) return "";
      return String(match[1]).trim().slice(0, 120);
    }

    function isEventInSyncCalendarTarget(event, targetCalendar = getSyncCalendarTarget()) {
      const target = normalizeSyncCalendarTarget(targetCalendar);
      if (!target) return true;

      const targetCalendarId = String(target.calendarId || "").trim();
      if (targetCalendarId) {
        const eventCalendarId = String(event?.calendarId || "").trim();
        if (eventCalendarId) {
          return eventCalendarId === targetCalendarId;
        }
      }

      const targetGroup = normalizeExternalCalendarGroupValue(
        target.group || buildCalendarGroup(target.sourceName, target.calendarName),
      );
      if (targetGroup) {
        const eventGroup = normalizeExternalCalendarGroupValue(
          event?.calendarGroup || buildCalendarGroup(event?.calendarSource, event?.calendarName),
        );
        if (eventGroup) {
          return eventGroup === targetGroup;
        }
      }

      const targetCalendarName = String(target.calendarName || "").trim().toLowerCase();
      if (targetCalendarName) {
        const eventCalendarName = String(event?.calendarName || "").trim().toLowerCase();
        if (eventCalendarName) {
          return eventCalendarName === targetCalendarName;
        }
      }

      return true;
    }

    function findTodoByExternalCalendarId(externalId) {
      refreshDataRefs();
      const target = String(externalId || "").trim();
      if (!target) return null;
      const matched = todos.filter((item) => String(item.externalCalendarId || "").trim() === target);
      if (!matched.length) return null;
      return matched.find((item) => !item.completed) || matched[0] || null;
    }

    function hasDirtyLocalChanges(todo) {
      if (!todo) return false;
      if (String(todo.syncState || "").trim() === "dirty") return true;
      const syncedMs = Date.parse(String(todo.syncedAt || "").trim());
      const updatedMs = Date.parse(String(todo.updatedAt || "").trim());
      if (!Number.isFinite(syncedMs) || !Number.isFinite(updatedMs)) return false;
      return updatedMs > syncedMs;
    }

    function isExternalEventEligibleForAutoTodo(imported, nowDate = new Date()) {
      if (!EXTERNAL_CALENDAR_AUTO_TODO_ENABLED) return false;
      if (!imported || typeof imported !== "object") return false;
      if (String(imported.externalId || "").trim() === "") return false;
      if (Boolean(imported.hasTimeQualityMarker) || String(imported.linkedTodoId || "").trim()) return false;
      if (!isEventInSyncCalendarTarget(imported, getSyncCalendarTarget())) return false;
      const range = buildEntryDateRange(imported.date, imported.start, imported.end);
      if (!range) return false;
      const durationHours = Number(imported.duration || 0);
      if (!Number.isFinite(durationHours) || durationHours <= 0) return false;
      if (durationHours > EXTERNAL_CALENDAR_AUTO_TODO_MAX_DURATION_HOURS) return false;
      if (range.endDate <= nowDate) return false;
      return true;
    }

    function syncFutureExternalEventsToTodos(importedEvents) {
      refreshDataRefs();
      const list = Array.isArray(importedEvents) ? importedEvents : [];
      if (!list.length || !EXTERNAL_CALENDAR_AUTO_TODO_ENABLED) {
        return { changed: false, added: 0, updated: 0, skipped: 0 };
      }

      const nowDate = new Date();
      const nowIso = nowDate.toISOString();
      let changed = false;
      let added = 0;
      let updated = 0;
      let skipped = 0;

      for (const imported of list) {
        if (!isExternalEventEligibleForAutoTodo(imported, nowDate)) {
          skipped += 1;
          continue;
        }

        const externalId = String(imported.externalId || "").trim();
        if (!externalId) {
          skipped += 1;
          continue;
        }

        const dueDate = String(imported.date || "").trim();
        const start = String(imported.start || "").trim();
        const end = String(imported.end || "").trim();
        const importedCategory = normalizeTodoCategoryValue(imported.category, EXTERNAL_CALENDAR_DEFAULT_CATEGORY);
        const project =
          normalizeProjectName(imported.category || EXTERNAL_CALENDAR_DEFAULT_CATEGORY)
          || EXTERNAL_CALENDAR_DEFAULT_CATEGORY;
        const title = normalizeEntryTitle(imported.externalTitle || imported.title || "", project);
        const estimateMinutes = Math.max(5, Math.round(Number(imported.duration || 0) * 60));
        const importedNote = normalizeTodoNoteValue(imported.note || "");
        const linkedTodo = findTodoByExternalCalendarId(externalId);

        if (linkedTodo) {
          if (linkedTodo.completed || hasDirtyLocalChanges(linkedTodo)) {
            skipped += 1;
            continue;
          }

          const oldDueDate = String(linkedTodo.dueDate || "").trim();
          const dueDateChanged = oldDueDate !== dueDate;
          const hasChanged =
            String(linkedTodo.title || "") !== title ||
            dueDateChanged ||
            String(linkedTodo.startTime || "") !== start ||
            String(linkedTodo.endTime || "") !== end ||
            getTodoCategory(linkedTodo, linkedTodo.project) !== importedCategory ||
            Number(linkedTodo.estimatedMinutes || 0) !== estimateMinutes ||
            String(linkedTodo.externalCalendarId || "") !== externalId;

          if (!hasChanged) {
            skipped += 1;
            continue;
          }

          linkedTodo.title = title;
          linkedTodo.dueDate = dueDate;
          linkedTodo.startTime = start;
          linkedTodo.endTime = end;
          linkedTodo.category = importedCategory;
          linkedTodo.estimatedMinutes = estimateMinutes;
          linkedTodo.externalCalendarId = externalId;
          if (!String(linkedTodo.note || "").trim() && importedNote) {
            linkedTodo.note = importedNote;
          }
          if (dueDateChanged && isValidDateInput(dueDate)) {
            linkedTodo.orderInDay = getNextTodoOrderForDate(dueDate, linkedTodo.id);
          }
          linkedTodo.calendarSynced = true;
          linkedTodo.syncState = "synced";
          linkedTodo.lastSyncError = "";
          linkedTodo.syncedAt = nowIso;
          linkedTodo.updatedAt = nowIso;
          updated += 1;
          changed = true;
          continue;
        }

        const createdTodo = normalizeTodo({
          id: `todo_ext_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          title,
          dueDate,
          project,
          category: importedCategory,
          tags: [],
          note: importedNote,
          qualityScore: null,
          happinessScore: null,
          startTime: start,
          endTime: end,
          estimatedMinutes: estimateMinutes,
          reminder: "",
          repeat: "none",
          calendarSynced: true,
          syncState: "synced",
          lastSyncError: "",
          externalCalendarId: externalId,
          syncedAt: nowIso,
          completed: false,
          completedAt: null,
          completionEntryId: "",
          createdAt: nowIso,
          updatedAt: nowIso,
        });
        createdTodo.orderInDay = getNextTodoOrderForDate(createdTodo.dueDate, createdTodo.id);
        todos.unshift(createdTodo);
        if (!getSelectedTodoId()) {
          setSelectedTodoId(String(createdTodo.id));
        }
        added += 1;
        changed = true;
      }

      if (changed) {
        const daySet = new Set(
          todos
            .filter((todo) => !todo.completed && isValidDateInput(todo.dueDate))
            .map((todo) => String(todo.dueDate)),
        );
        for (const day of daySet) {
          normalizeTodoOrderForDate(day);
        }
      }

      return { changed, added, updated, skipped };
    }

    function normalizeExternalCalendarEvent(rawEvent) {
      refreshDataRefs();
      if (!rawEvent || typeof rawEvent !== "object") return null;

      const externalId = String(
        rawEvent.externalId ||
          rawEvent.eventId ||
          rawEvent.id ||
          `${rawEvent.title || rawEvent.name || "untitled"}-${rawEvent.start || rawEvent.startAt || ""}`,
      ).trim();
      if (!externalId) return null;
      const rawNoteText = String(rawEvent.note || rawEvent.notes || rawEvent.description || "").trim();
      const rawUrlText = String(rawEvent.url || rawEvent.urlString || "").trim();
      const linkedTodoId = extractTimeQualityTaskIdFromNote(rawNoteText, rawUrlText);
      const hasTimeQualityMarker = /\[TimeQuality/i.test(rawNoteText) || hasTimeQualityMetaUrl(rawUrlText);
      if (linkedTodoId && todos.some((item) => String(item.id) === linkedTodoId)) {
        return null;
      }

      const startDate =
        parseExternalDateValue(rawEvent.start || rawEvent.startAt || rawEvent.startDate) ||
        parseExternalDateAndTime(rawEvent.date, rawEvent.startTime);

      let endDate =
        parseExternalDateValue(rawEvent.end || rawEvent.endAt || rawEvent.endDate) ||
        parseExternalDateAndTime(rawEvent.date, rawEvent.endTime);

      if (!startDate || !endDate) return null;
      if (endDate.getTime() <= startDate.getTime()) {
        const endFromSameDayClock = parseExternalDateAndTime(rawEvent.date, rawEvent.endTime);
        if (endFromSameDayClock) {
          endFromSameDayClock.setDate(endFromSameDayClock.getDate() + 1);
          endDate = endFromSameDayClock;
        }
      }

      if (endDate.getTime() <= startDate.getTime()) return null;

      const durationHours = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60);
      if (!Number.isFinite(durationHours) || durationHours <= 0 || durationHours > 24) return null;
      const roundedDuration = Math.round(durationHours * 100) / 100;

      const date = formatDateForInput(startDate);
      const start = formatTimeForInput(startDate);
      const end = formatTimeForInput(endDate);
      const category = mapExternalCalendarCategory(rawEvent);
      const title = String(rawEvent.title || rawEvent.name || category).trim() || category;
      const calendarId = String(rawEvent.calendarId || rawEvent.calendarIdentifier || "").trim();
      const calendarName = String(rawEvent.calendarName || rawEvent.calendar || "").trim();
      const calendarSource = String(rawEvent.sourceName || rawEvent.groupName || rawEvent.calendarSource || "").trim();
      const calendarGroup = String(
        rawEvent.group ||
          rawEvent.calendarGroup ||
          buildCalendarGroup(calendarSource, calendarName) ||
          rawEvent.calendar ||
          rawEvent.calendarName ||
          "",
      ).trim();
      const note = normalizeTodoNoteValue(rawNoteText);

      return {
        externalId,
        externalTitle: title,
        calendarId,
        calendarName,
        calendarSource,
        calendarGroup,
        modifiedAt: String(rawEvent.modifiedAt || rawEvent.lastModifiedDate || "").trim(),
        linkedTodoId,
        hasTimeQualityMarker,
        date,
        start,
        end,
        category,
        note,
        duration: roundedDuration,
      };
    }

    function mapExternalCalendarCategory(rawEvent) {
      const text = String(
        `${rawEvent.title || rawEvent.name || ""} ${rawEvent.group || rawEvent.calendar || rawEvent.calendarName || ""} ${rawEvent.sourceName || rawEvent.calendarSource || ""}`,
      ).toLowerCase();

      if (/学习|课程|读书|study|class|lesson|course/.test(text)) return "学习";
      if (/运动|跑步|健身|瑜伽|锻炼|sport|run|gym|workout|yoga/.test(text)) return "运动";
      if (/休息|睡|nap|rest|break/.test(text)) return "休息";
      if (/社交|聚会|约会|会友|social|party|dinner/.test(text)) return "社交";
      if (/兴趣|绘画|音乐|摄影|游戏|hobby|music|photo|art/.test(text)) return "兴趣";
      if (/家务|清洁|做饭|购物|housework|clean|cook|grocery/.test(text)) return "家务";
      if (/通勤|出行|交通|地铁|公交|commute|travel|drive|flight|train/.test(text)) return "通勤";
      return EXTERNAL_CALENDAR_DEFAULT_CATEGORY;
    }

    function parseExternalDateValue(value) {
      if (!value) return null;
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) return null;
      return parsed;
    }

    function parseExternalDateAndTime(rawDate, rawTime) {
      const date = String(rawDate || "").trim();
      const time = String(rawTime || "").trim();
      if (!date || !time) return null;

      const dateParts = date.split("-");
      const timeParts = time.split(":");
      if (dateParts.length !== 3 || timeParts.length < 2) return null;

      const year = Number.parseInt(dateParts[0], 10);
      const month = Number.parseInt(dateParts[1], 10);
      const day = Number.parseInt(dateParts[2], 10);
      const hours = Number.parseInt(timeParts[0], 10);
      const minutes = Number.parseInt(timeParts[1], 10);

      if (
        !Number.isInteger(year) ||
        !Number.isInteger(month) ||
        !Number.isInteger(day) ||
        !Number.isInteger(hours) ||
        !Number.isInteger(minutes) ||
        month < 1 ||
        month > 12 ||
        day < 1 ||
        day > 31 ||
        hours < 0 ||
        hours > 23 ||
        minutes < 0 ||
        minutes > 59
      ) {
        return null;
      }

      const parsed = new Date(year, month - 1, day, hours, minutes, 0, 0);
      if (Number.isNaN(parsed.getTime())) return null;
      return parsed;
    }

    function applyImportedCalendarEvents(importedEvents) {
      refreshDataRefs();
      const externalMap = new Map();
      for (const entry of entries) {
        if (!isImportedExternalEntry(entry)) continue;
        externalMap.set(String(entry.externalId), entry);
      }

      let changed = false;
      let added = 0;
      let updated = 0;
      let ignored = 0;

      for (const imported of importedEvents) {
        if (ignoredExternalCalendarIds.has(imported.externalId)) {
          ignored += 1;
          continue;
        }

        const existing = externalMap.get(imported.externalId);
        const linkedTodo = findTodoByExternalCalendarId(imported.externalId);
        if (linkedTodo && !linkedTodo.completed) {
          if (existing) {
            const existingIndex = entries.findIndex((item) => String(item.id) === String(existing.id));
            if (existingIndex >= 0) {
              entries.splice(existingIndex, 1);
              changed = true;
            }
            externalMap.delete(imported.externalId);
          }
          ignored += 1;
          continue;
        }

        if (!existing) {
          const entry = createImportedCalendarEntry(imported);
          entries.unshift(entry);
          externalMap.set(imported.externalId, entry);
          added += 1;
          changed = true;
          continue;
        }

        const existingIndex = entries.findIndex((item) => String(item.id) === String(existing.id));
        if (existingIndex < 0) continue;

        const current = entries[existingIndex];
        const preserveLocalReviewFields = !current.needsReview;

        const next = {
          ...current,
          title: imported.externalTitle,
          date: imported.date,
          start: imported.start,
          end: imported.end,
          category: imported.category,
          note: imported.note,
          duration: imported.duration,
          externalTitle: imported.externalTitle,
          calendarGroup: imported.calendarGroup,
          source: EXTERNAL_CALENDAR_SOURCE,
          externalId: imported.externalId,
          updatedAt: new Date().toISOString(),
        };

        if (preserveLocalReviewFields) {
          next.note = current.note;
          next.quality = current.quality;
          next.happiness = current.happiness;
          next.needsReview = false;
        }

        if (!isSameImportedSnapshot(current, next)) {
          entries[existingIndex] = next;
          updated += 1;
          changed = true;
        } else {
          ignored += 1;
        }
      }

      return { changed, added, updated, ignored };
    }

    function isSameImportedSnapshot(prev, next) {
      return (
        prev.title === next.title &&
        prev.date === next.date &&
        prev.start === next.start &&
        prev.end === next.end &&
        prev.category === next.category &&
        prev.note === next.note &&
        prev.duration === next.duration &&
        prev.externalTitle === next.externalTitle &&
        prev.calendarGroup === next.calendarGroup
      );
    }

    function createImportedCalendarEntry(imported) {
      return {
        id: createUniqueEntryId(),
        title: imported.externalTitle,
        date: imported.date,
        start: imported.start,
        end: imported.end,
        category: imported.category,
        quality: 0,
        happiness: 0,
        note: imported.note,
        duration: imported.duration,
        createdAt: new Date().toISOString(),
        source: EXTERNAL_CALENDAR_SOURCE,
        needsReview: true,
        externalId: imported.externalId,
        externalTitle: imported.externalTitle,
        calendarGroup: imported.calendarGroup,
      };
    }

    return {
      normalizeExternalCalendarPayload,
      extractTimeQualityTaskIdFromUrl,
      hasTimeQualityMetaUrl,
      extractTimeQualityTaskIdFromNote,
      isEventInSyncCalendarTarget,
      findTodoByExternalCalendarId,
      hasDirtyLocalChanges,
      isExternalEventEligibleForAutoTodo,
      syncFutureExternalEventsToTodos,
      normalizeExternalCalendarEvent,
      mapExternalCalendarCategory,
      parseExternalDateValue,
      parseExternalDateAndTime,
      applyImportedCalendarEvents,
      isSameImportedSnapshot,
      createImportedCalendarEntry,
    };
  }

  globalScope.TimeQualityExternalCalendarImportModule = { createExternalCalendarImportModule };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = globalScope.TimeQualityExternalCalendarImportModule;
  }
})(typeof window !== "undefined" ? window : globalThis);
