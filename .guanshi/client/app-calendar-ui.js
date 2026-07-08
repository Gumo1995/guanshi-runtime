(function attachTimeQualityCalendarUiModule(globalScope) {
  if (!globalScope) return;

  function requireFunction(deps, key) {
    const value = deps[key];
    if (typeof value !== "function") {
      throw new Error(`TimeQualityCalendarUiModule missing required function dependency: ${key}`);
    }
    return value;
  }

  function normalizeList(value) {
    return Array.isArray(value) ? value : [];
  }

  function normalizeNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function createCalendarUiModule(deps = {}) {
    const documentRef = deps.documentRef || globalScope.document || null;
    const windowRef = deps.windowRef || globalScope.window || globalScope;
    const alertFn =
      typeof deps.alertFn === "function"
        ? deps.alertFn
        : typeof windowRef.alert === "function"
          ? windowRef.alert.bind(windowRef)
          : () => {};
    const requestAnimationFrameFn =
      typeof deps.requestAnimationFrameFn === "function"
        ? deps.requestAnimationFrameFn
        : typeof windowRef.requestAnimationFrame === "function"
          ? windowRef.requestAnimationFrame.bind(windowRef)
          : (callback) => windowRef.setTimeout(callback, 0);
    const cancelAnimationFrameFn =
      typeof deps.cancelAnimationFrameFn === "function"
        ? deps.cancelAnimationFrameFn
        : typeof windowRef.cancelAnimationFrame === "function"
          ? windowRef.cancelAnimationFrame.bind(windowRef)
          : windowRef.clearTimeout.bind(windowRef);

    const CALENDAR_DEFAULT_CENTER_HOUR = normalizeNumber(deps.CALENDAR_DEFAULT_CENTER_HOUR, 12);
    const CALENDAR_DEFAULT_HIDE_BEFORE_HOUR = normalizeNumber(deps.CALENDAR_DEFAULT_HIDE_BEFORE_HOUR, 8);
    const CALENDAR_CLICK_MINUTE_STEP = normalizeNumber(deps.CALENDAR_CLICK_MINUTE_STEP, 15);
    const CALENDAR_NEW_EVENT_DEFAULT_DURATION_MINUTES = normalizeNumber(
      deps.CALENDAR_NEW_EVENT_DEFAULT_DURATION_MINUTES,
      60,
    );
    const CALENDAR_DIRECT_EDIT_MINUTES_STEP = normalizeNumber(deps.CALENDAR_DIRECT_EDIT_MINUTES_STEP, 15);
    const CALENDAR_DIRECT_EDIT_MIN_DURATION_MINUTES = normalizeNumber(
      deps.CALENDAR_DIRECT_EDIT_MIN_DURATION_MINUTES,
      15,
    );
    const CALENDAR_DIRECT_EDIT_DRAG_SLOP_PX = normalizeNumber(deps.CALENDAR_DIRECT_EDIT_DRAG_SLOP_PX, 4);
    const CALENDAR_DIRECT_EDIT_CLICK_SUPPRESS_MS = normalizeNumber(
      deps.CALENDAR_DIRECT_EDIT_CLICK_SUPPRESS_MS,
      260,
    );
    const CALENDAR_NOW_LINE_REFRESH_MS = normalizeNumber(deps.CALENDAR_NOW_LINE_REFRESH_MS, 30000);
    const WEEKDAY_LABELS = normalizeList(deps.WEEKDAY_LABELS).length
      ? normalizeList(deps.WEEKDAY_LABELS)
      : ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

    const recordsPanel = deps.recordsPanel || null;
    const emptyTip = deps.emptyTip || null;
    const calendarRangeLabel = deps.calendarRangeLabel || null;
    const calendarWeekdays = deps.calendarWeekdays || null;
    const calendarScroll = deps.calendarScroll || null;
    const calendarCustomScrollbar = deps.calendarCustomScrollbar || null;
    const calendarCustomThumb = deps.calendarCustomThumb || null;
    const calendarTimeAxis = deps.calendarTimeAxis || null;
    const calendarDayColumns = deps.calendarDayColumns || null;
    const calendarUnratedJumpBtn = deps.calendarUnratedJumpBtn || null;
    const calendarUnratedCount = deps.calendarUnratedCount || null;

    const getEntries = requireFunction(deps, "getEntries");
    const getCalendarWeekStart = requireFunction(deps, "getCalendarWeekStart");
    const setCalendarWeekStart = requireFunction(deps, "setCalendarWeekStart");
    const getCalendarNeedsViewportReset = requireFunction(deps, "getCalendarNeedsViewportReset");
    const setCalendarNeedsViewportReset = requireFunction(deps, "setCalendarNeedsViewportReset");
    const getCalendarPendingFocusMinutes = requireFunction(deps, "getCalendarPendingFocusMinutes");
    const setCalendarPendingFocusMinutes = requireFunction(deps, "setCalendarPendingFocusMinutes");
    const getCalendarRenderEntries = requireFunction(deps, "getCalendarRenderEntries");
    const findCalendarRenderableById = requireFunction(deps, "findCalendarRenderableById");
    const doesCalendarEntryMatchSearch = requireFunction(deps, "doesCalendarEntryMatchSearch");
    const getGlobalSearchTerm = requireFunction(deps, "getGlobalSearchTerm");
    const isAnalyzableEntry = requireFunction(deps, "isAnalyzableEntry");
    const isValidDateInput = requireFunction(deps, "isValidDateInput");
    const parseClockToMinutes = requireFunction(deps, "parseClockToMinutes");
    const getTodayDateInputValue = requireFunction(deps, "getTodayDateInputValue");
    const formatDate = requireFunction(deps, "formatDate");
    const formatDateForInput = requireFunction(deps, "formatDateForInput");
    const formatMinutesLabel = requireFunction(deps, "formatMinutesLabel");
    const formatTimeForInput = requireFunction(deps, "formatTimeForInput");
    const getWeekDates = requireFunction(deps, "getWeekDates");
    const getStartOfWeek = requireFunction(deps, "getStartOfWeek");
    const addDays = requireFunction(deps, "addDays");
    const isSameDay = requireFunction(deps, "isSameDay");
    const buildEntryDateRange = requireFunction(deps, "buildEntryDateRange");
    const validateEntryInput = requireFunction(deps, "validateEntryInput");
    const findOverlappingCalendarItem = requireFunction(deps, "findOverlappingCalendarItem");
    const getOverlapMessage = requireFunction(deps, "getOverlapMessage");
    const getEntryDisplayTitle = requireFunction(deps, "getEntryDisplayTitle");
    const canDirectEditEntry = requireFunction(deps, "canDirectEditEntry");
    const isEntryNotEditableYet = requireFunction(deps, "isEntryNotEditableYet");
    const escapeHtml = requireFunction(deps, "escapeHtml");
    const commitDirectEditDraft = requireFunction(deps, "commitDirectEditDraft");

    let customScrollbarBound = false;
    let scrollbarOnlyInteractionBound = false;
    let isCalendarScrollbarDragging = false;
    let calendarScrollbarDragPointerId = null;
    let calendarScrollbarDragOffsetY = 0;
    let calendarDirectEditState = null;
    let calendarDirectEditRafId = 0;
    let calendarDirectEditPendingPointer = null;
    let calendarSuppressClickUntil = 0;
    let calendarRenderEntries = [];
    let calendarUnratedEntries = [];
    let calendarNowLineTimerId = 0;

    function bindCustomScrollbar() {
      if (!calendarScroll || !calendarCustomScrollbar || !calendarCustomThumb || customScrollbarBound) return;
      customScrollbarBound = true;

      calendarScroll.addEventListener("scroll", syncCustomScrollbar, { passive: true });
      windowRef.addEventListener("resize", syncCustomScrollbar);
      calendarCustomScrollbar.addEventListener("pointerdown", handleScrollbarPointerDown);
      calendarCustomScrollbar.addEventListener("keydown", handleScrollbarKeydown);
      syncCustomScrollbar();
    }

    function getScrollbarMetrics() {
      if (!calendarScroll || !calendarCustomScrollbar) return null;
      const viewportHeight = calendarScroll.clientHeight;
      const scrollHeight = calendarScroll.scrollHeight;
      const maxScroll = Math.max(0, scrollHeight - viewportHeight);
      const trackHeight = Math.max(0, calendarCustomScrollbar.clientHeight);
      const minThumbHeight = 36;
      const rawThumbHeight =
        maxScroll <= 0 ? trackHeight : (viewportHeight / Math.max(scrollHeight, 1)) * trackHeight;
      const thumbHeight = Math.min(trackHeight, Math.max(minThumbHeight, rawThumbHeight));
      const maxThumbTop = Math.max(0, trackHeight - thumbHeight);
      return {
        maxScroll,
        trackHeight,
        thumbHeight,
        maxThumbTop,
      };
    }

    function syncCustomScrollbar() {
      if (!calendarScroll || !calendarCustomScrollbar || !calendarCustomThumb) return;
      const metrics = getScrollbarMetrics();
      if (!metrics) return;

      const { maxScroll, thumbHeight, maxThumbTop } = metrics;
      const scrollTop = Math.max(0, Math.min(maxScroll, calendarScroll.scrollTop));
      const thumbTop = maxScroll <= 0 ? 0 : (scrollTop / maxScroll) * maxThumbTop;

      calendarCustomThumb.style.height = `${thumbHeight}px`;
      calendarCustomThumb.style.transform = `translateY(${thumbTop}px)`;
      calendarCustomScrollbar.classList.toggle("is-disabled", maxScroll <= 0);
      calendarCustomScrollbar.setAttribute("aria-valuemin", "0");
      calendarCustomScrollbar.setAttribute("aria-valuemax", String(Math.round(maxScroll)));
      calendarCustomScrollbar.setAttribute("aria-valuenow", String(Math.round(scrollTop)));
    }

    function setScrollTopByThumbTop(rawThumbTop) {
      if (!calendarScroll) return;
      const metrics = getScrollbarMetrics();
      if (!metrics) return;

      const { maxScroll, maxThumbTop } = metrics;
      if (maxScroll <= 0) {
        calendarScroll.scrollTop = 0;
        return;
      }

      const clampedThumbTop = Math.max(0, Math.min(maxThumbTop, rawThumbTop));
      const ratio = maxThumbTop <= 0 ? 0 : clampedThumbTop / maxThumbTop;
      calendarScroll.scrollTop = ratio * maxScroll;
    }

    function handleScrollbarPointerDown(event) {
      if (!calendarScroll || !calendarCustomScrollbar || !calendarCustomThumb) return;
      if (event.button !== 0) return;

      const trackRect = calendarCustomScrollbar.getBoundingClientRect();
      const thumbRect = calendarCustomThumb.getBoundingClientRect();
      const pointerY = event.clientY;
      const targetNode = event.target;
      const clickedThumb = targetNode instanceof Element && targetNode.closest("#calendar-custom-thumb");

      if (clickedThumb) {
        calendarScrollbarDragOffsetY = pointerY - thumbRect.top;
      } else {
        calendarScrollbarDragOffsetY = thumbRect.height / 2;
        const thumbTop = pointerY - trackRect.top - calendarScrollbarDragOffsetY;
        setScrollTopByThumbTop(thumbTop);
      }

      isCalendarScrollbarDragging = true;
      calendarScrollbarDragPointerId = event.pointerId;
      calendarCustomThumb.classList.add("is-dragging");

      if (typeof calendarCustomScrollbar.setPointerCapture === "function") {
        calendarCustomScrollbar.setPointerCapture(event.pointerId);
      }
      calendarCustomScrollbar.addEventListener("pointermove", handleScrollbarPointerMove);
      calendarCustomScrollbar.addEventListener("pointerup", handleScrollbarPointerUp);
      calendarCustomScrollbar.addEventListener("pointercancel", handleScrollbarPointerUp);
      event.preventDefault();
    }

    function handleScrollbarPointerMove(event) {
      if (!isCalendarScrollbarDragging || !calendarCustomScrollbar) return;
      if (event.pointerId !== calendarScrollbarDragPointerId) return;

      const trackRect = calendarCustomScrollbar.getBoundingClientRect();
      const thumbTop = event.clientY - trackRect.top - calendarScrollbarDragOffsetY;
      setScrollTopByThumbTop(thumbTop);
      event.preventDefault();
    }

    function handleScrollbarPointerUp(event) {
      if (!calendarCustomScrollbar || !calendarCustomThumb) return;
      if (event.pointerId !== calendarScrollbarDragPointerId) return;

      isCalendarScrollbarDragging = false;
      calendarScrollbarDragPointerId = null;
      calendarScrollbarDragOffsetY = 0;
      calendarCustomThumb.classList.remove("is-dragging");

      calendarCustomScrollbar.removeEventListener("pointermove", handleScrollbarPointerMove);
      calendarCustomScrollbar.removeEventListener("pointerup", handleScrollbarPointerUp);
      calendarCustomScrollbar.removeEventListener("pointercancel", handleScrollbarPointerUp);
    }

    function handleScrollbarKeydown(event) {
      if (!calendarScroll) return;

      const maxScrollTop = Math.max(0, calendarScroll.scrollHeight - calendarScroll.clientHeight);
      const pageStep = Math.max(24, calendarScroll.clientHeight * 0.8);
      const lineStep = 32;

      if (event.key === "ArrowDown") {
        calendarScroll.scrollTop = Math.min(maxScrollTop, calendarScroll.scrollTop + lineStep);
        event.preventDefault();
        return;
      }

      if (event.key === "ArrowUp") {
        calendarScroll.scrollTop = Math.max(0, calendarScroll.scrollTop - lineStep);
        event.preventDefault();
        return;
      }

      if (event.key === "PageDown") {
        calendarScroll.scrollTop = Math.min(maxScrollTop, calendarScroll.scrollTop + pageStep);
        event.preventDefault();
        return;
      }

      if (event.key === "PageUp") {
        calendarScroll.scrollTop = Math.max(0, calendarScroll.scrollTop - pageStep);
        event.preventDefault();
        return;
      }

      if (event.key === "Home") {
        calendarScroll.scrollTop = 0;
        event.preventDefault();
        return;
      }

      if (event.key === "End") {
        calendarScroll.scrollTop = maxScrollTop;
        event.preventDefault();
      }
    }

    function bindScrollbarOnlyInteraction() {
      if (!calendarScroll || scrollbarOnlyInteractionBound) return;
      scrollbarOnlyInteractionBound = true;

      calendarScroll.addEventListener(
        "wheel",
        (event) => {
          event.preventDefault();
        },
        { passive: false },
      );
    }

    function isEntryUnratedForCalendar(entry) {
      if (!entry || entry.todoPending) return false;
      if (!isValidDateInput(String(entry.date || "").trim())) return false;
      return !isAnalyzableEntry(entry);
    }

    function compareEntryDateTimeAsc(a, b) {
      const dateA = String(a?.date || "");
      const dateB = String(b?.date || "");
      if (dateA !== dateB) return dateA.localeCompare(dateB);
      const startA = parseClockToMinutes(a?.start);
      const startB = parseClockToMinutes(b?.start);
      const safeStartA = Number.isInteger(startA) ? startA : -1;
      const safeStartB = Number.isInteger(startB) ? startB : -1;
      if (safeStartA !== safeStartB) return safeStartA - safeStartB;
      return String(a?.id || "").localeCompare(String(b?.id || ""));
    }

    function getUnratedEntries(baseEntries = getEntries()) {
      const source = Array.isArray(baseEntries) ? baseEntries : [];
      return source.filter(isEntryUnratedForCalendar).sort(compareEntryDateTimeAsc);
    }

    function getUnratedTargetDate(unratedEntries = calendarUnratedEntries) {
      const source = Array.isArray(unratedEntries) ? unratedEntries : [];
      if (!source.length) return "";
      const today = getTodayDateInputValue();
      const futureOrToday = source.filter((item) => String(item.date || "") >= today);
      if (futureOrToday.length) {
        return String(futureOrToday[0].date || "");
      }
      const latestPast = [...source].sort((left, right) => compareEntryDateTimeAsc(right, left));
      return String(latestPast[0]?.date || "");
    }

    function renderUnratedJumpButton() {
      if (!calendarUnratedJumpBtn) return;
      calendarUnratedEntries = getUnratedEntries(getEntries());
      const count = calendarUnratedEntries.length;
      if (calendarUnratedCount) {
        calendarUnratedCount.textContent = String(count);
      }
      const targetDate = getUnratedTargetDate(calendarUnratedEntries);
      calendarUnratedJumpBtn.disabled = count <= 0 || !targetDate;
      calendarUnratedJumpBtn.dataset.targetDate = targetDate;
      if (count > 0 && targetDate) {
        calendarUnratedJumpBtn.title = `待评分 ${count} 条，跳转到 ${formatDate(targetDate)} 所在周`;
      } else {
        calendarUnratedJumpBtn.title = "暂无待评分";
      }
    }

    function handleUnratedJump() {
      const targetDate =
        String(calendarUnratedJumpBtn?.dataset.targetDate || "").trim() || getUnratedTargetDate();
      if (!isValidDateInput(targetDate)) return;
      const target = new Date(`${targetDate}T00:00:00`);
      if (Number.isNaN(target.getTime())) return;
      setCalendarWeekStart(getStartOfWeek(target));
      setCalendarNeedsViewportReset(true);
      render(getEntries());
    }

    function renderTimeAxis() {
      if (!calendarTimeAxis) return;

      calendarTimeAxis.innerHTML = "";
      for (let hour = 0; hour < 24; hour += 1) {
        const label = documentRef.createElement("div");
        label.className = "calendar-time-label";
        label.textContent = `${String(hour).padStart(2, "0")}:00`;
        calendarTimeAxis.appendChild(label);
      }
    }

    function render(allEntries) {
      if (!calendarRangeLabel || !calendarWeekdays || !calendarDayColumns || !emptyTip) return;
      renderUnratedJumpButton();

      const renderEntries = normalizeList(getCalendarRenderEntries(allEntries)).filter((entry) =>
        doesCalendarEntryMatchSearch(entry),
      );
      calendarRenderEntries = renderEntries;

      const weekDates = getWeekDates(getCalendarWeekStart());
      const startDate = weekDates[0];
      const endDate = weekDates[weekDates.length - 1];
      calendarRangeLabel.textContent = formatRange(startDate, endDate);
      renderWeekdays(weekDates);

      const daySegmentsMap = new Map(weekDates.map((day) => [formatDateForInput(day), []]));

      for (const entry of renderEntries) {
        for (const segment of splitEntryIntoDaySegments(entry)) {
          const bucket = daySegmentsMap.get(segment.dayKey);
          if (bucket) {
            bucket.push(segment);
          }
        }
      }

      const hourHeight = getHourHeight();
      let hasEvents = false;
      calendarDayColumns.innerHTML = "";

      for (const day of weekDates) {
        const dayKey = formatDateForInput(day);
        const daySegments = daySegmentsMap.get(dayKey) || [];
        const laidOutSegments = layoutDaySegments(daySegments);

        const dayColumn = documentRef.createElement("div");
        dayColumn.className = "calendar-day-column";
        dayColumn.dataset.date = dayKey;

        const eventsLayer = documentRef.createElement("div");
        eventsLayer.className = "calendar-events-layer";

        for (const segment of laidOutSegments) {
          eventsLayer.appendChild(createEventNode(segment, hourHeight));
          hasEvents = true;
        }

        dayColumn.appendChild(eventsLayer);
        calendarDayColumns.appendChild(dayColumn);
      }

      renderNowLine(weekDates, hourHeight);

      emptyTip.style.display = hasEvents ? "none" : "block";
      if (!hasEvents) {
        emptyTip.textContent = getGlobalSearchTerm()
          ? "未找到匹配的 entry。"
          : "本周还没有记录。先添加一段时间，系统会自动生成分析结果。";
      }

      if (getCalendarNeedsViewportReset()) {
        requestAnimationFrameFn(() => {
          setDefaultViewport();
          syncCustomScrollbar();
          setCalendarNeedsViewportReset(false);
        });
        return;
      }

      syncCustomScrollbar();
    }

    function renderNowLine(weekDates = getWeekDates(getCalendarWeekStart()), hourHeight = getHourHeight()) {
      if (!calendarDayColumns) return;
      const existing = calendarDayColumns.querySelector(".calendar-now-line");
      if (existing) {
        existing.remove();
      }

      const now = new Date();
      const isCurrentWeekVisible = weekDates.some((date) => isSameDay(date, now));
      if (!isCurrentWeekVisible) return;

      const nowMinutes = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
      const maxTop = Math.max(0, hourHeight * 24 - 1);
      const top = Math.max(0, Math.min(maxTop, (nowMinutes / 60) * hourHeight));

      const line = documentRef.createElement("div");
      line.className = "calendar-now-line";
      line.style.top = `${top}px`;
      line.setAttribute("aria-hidden", "true");
      calendarDayColumns.appendChild(line);
    }

    function startNowLineTicker() {
      if (calendarNowLineTimerId) {
        windowRef.clearInterval(calendarNowLineTimerId);
      }
      renderNowLine();
      calendarNowLineTimerId = windowRef.setInterval(() => {
        renderNowLine();
      }, CALENDAR_NOW_LINE_REFRESH_MS);
    }

    function renderWeekdays(weekDates) {
      if (!calendarWeekdays) return;

      const today = new Date();
      calendarWeekdays.innerHTML = "";

      const corner = documentRef.createElement("div");
      corner.className = "calendar-corner";
      corner.textContent = "时间";
      calendarWeekdays.appendChild(corner);

      const dayColumns = documentRef.createElement("div");
      dayColumns.className = "calendar-weekday-columns";

      for (const date of weekDates) {
        const dayNode = documentRef.createElement("div");
        dayNode.className = "calendar-weekday";
        if (isSameDay(date, today)) {
          dayNode.classList.add("is-today");
        }

        dayNode.innerHTML = `
      <strong class="calendar-weekday-date">${date.getDate()}</strong>
      <span class="calendar-weekday-label">${WEEKDAY_LABELS[date.getDay()]}</span>
    `;
        dayColumns.appendChild(dayNode);
      }

      calendarWeekdays.appendChild(dayColumns);
    }

    function handleDirectEditPointerDown(event) {
      if (!calendarDayColumns) return;
      if (event.button !== 0) return;
      if (!(event.target instanceof Element)) return;
      if (event.target.closest("button[data-id]")) return;

      const eventCard = event.target.closest(".calendar-event[data-id]");
      if (!eventCard) return;

      const idToken = String(eventCard.dataset.id || "");
      if (!idToken) return;

      const resolved = findCalendarRenderableById(idToken, calendarRenderEntries);
      if (!resolved) return;
      const entry = resolved.entry;
      const sourceKind = resolved.kind;
      const sourceTodoId = resolved.todo ? String(resolved.todo.id) : "";

      if (!canDirectEditEntry(entry)) {
        return;
      }

      const range = buildEntryDateRange(entry.date, entry.start, entry.end);
      if (!range) return;

      const edgeHandle = event.target.closest(".calendar-event-edge[data-edge]");
      const edge = edgeHandle ? String(edgeHandle.dataset.edge || "") : "";
      const mode = edge === "start" ? "resize-start" : edge === "end" ? "resize-end" : "move";
      const dayKey = String(eventCard.dataset.dayKey || entry.date || "");
      const startDayByKey = getDayIndexByDateKey(dayKey);
      const startDayByPointer = getDayIndexByClientX(event.clientX);
      const startDayIndex = startDayByKey >= 0 ? startDayByKey : startDayByPointer;

      calendarDirectEditState = {
        pointerId: event.pointerId,
        mode,
        entryId: idToken,
        entryIdRaw: entry.id,
        sourceKind,
        sourceTodoId,
        baseEntry: entry,
        originalStartDate: range.startDate,
        originalEndDate: range.endDate,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startScrollTop: calendarScroll ? calendarScroll.scrollTop : 0,
        startDayIndex,
        hasExceededSlop: false,
        didMutate: false,
        draft: null,
        draftValidation: null,
        draftOverlap: null,
        draftSignature: "",
        allowFutureRange: sourceKind === "todo-plan" || isEntryNotEditableYet(entry),
      };

      event.preventDefault();
    }

    function handleDirectEditPointerMove(event) {
      if (!calendarDirectEditState) return;
      if (event.pointerId !== calendarDirectEditState.pointerId) return;

      calendarDirectEditPendingPointer = {
        clientX: event.clientX,
        clientY: event.clientY,
      };

      if (calendarDirectEditRafId) return;
      calendarDirectEditRafId = requestAnimationFrameFn(processDirectEditFrame);

      if (calendarDirectEditState.hasExceededSlop) {
        event.preventDefault();
      }
    }

    function handleDirectEditPointerUp(event) {
      if (!calendarDirectEditState) return;
      if (event.pointerId !== calendarDirectEditState.pointerId) return;

      calendarDirectEditPendingPointer = {
        clientX: event.clientX,
        clientY: event.clientY,
      };

      if (calendarDirectEditRafId) {
        cancelAnimationFrameFn(calendarDirectEditRafId);
        calendarDirectEditRafId = 0;
      }
      processDirectEditFrame();
      finalizeDirectEdit(false);
    }

    function handleDirectEditPointerCancel(event) {
      if (!calendarDirectEditState) return;
      if (event.pointerId !== calendarDirectEditState.pointerId) return;

      if (calendarDirectEditRafId) {
        cancelAnimationFrameFn(calendarDirectEditRafId);
        calendarDirectEditRafId = 0;
      }
      finalizeDirectEdit(true);
    }

    function processDirectEditFrame() {
      calendarDirectEditRafId = 0;
      if (!calendarDirectEditState || !calendarDirectEditPendingPointer) return;

      const state = calendarDirectEditState;
      const pointer = calendarDirectEditPendingPointer;
      const deltaX = pointer.clientX - state.startClientX;
      const deltaY = pointer.clientY - state.startClientY;

      if (!state.hasExceededSlop) {
        const distance = Math.hypot(deltaX, deltaY);
        if (distance < CALENDAR_DIRECT_EDIT_DRAG_SLOP_PX) {
          return;
        }
        state.hasExceededSlop = true;
        documentRef.body.classList.add("calendar-direct-editing");
        documentRef.body.classList.toggle("calendar-direct-editing-resize", state.mode !== "move");
      }

      const draft = computeDirectEditDraft(state, pointer);
      if (!draft) return;

      const validation = validateEntryInput(draft.date, draft.start, draft.end, {
        allowFutureRange: Boolean(state.allowFutureRange),
      });
      const overlap = validation.ok
        ? findOverlappingCalendarItem(draft.date, draft.start, draft.end, state.entryIdRaw)
        : null;
      const isInvalid = !validation.ok || Boolean(overlap);
      const signature = `${draft.date}|${draft.start}|${draft.end}|${isInvalid ? "1" : "0"}|${
        overlap ? overlap.id : ""
      }`;
      if (signature === state.draftSignature) return;

      state.draftSignature = signature;
      state.draft = draft;
      state.draftValidation = validation;
      state.draftOverlap = overlap;
      state.didMutate = true;

      applyDirectEditDraftPreview(state, draft, isInvalid);
    }

    function computeDirectEditDraft(state, pointer) {
      const hourHeight = getHourHeight();
      const minuteHeight = hourHeight / 60;
      if (!Number.isFinite(minuteHeight) || minuteHeight <= 0) return null;

      const scrollCompensation = calendarScroll ? calendarScroll.scrollTop - state.startScrollTop : 0;
      const rawDeltaMinutes = (pointer.clientY - state.startClientY + scrollCompensation) / minuteHeight;
      const snappedDeltaMinutes = roundToStep(rawDeltaMinutes, CALENDAR_DIRECT_EDIT_MINUTES_STEP);

      const minDurationMs = CALENDAR_DIRECT_EDIT_MIN_DURATION_MINUTES * 60 * 1000;
      let nextStart = new Date(state.originalStartDate);
      let nextEnd = new Date(state.originalEndDate);

      if (state.mode === "move") {
        const dayIndex = getDayIndexByClientX(pointer.clientX);
        const dayDeltaMinutes = (dayIndex - state.startDayIndex) * 24 * 60;
        const totalDeltaMinutes = snappedDeltaMinutes + dayDeltaMinutes;
        nextStart = new Date(state.originalStartDate.getTime() + totalDeltaMinutes * 60 * 1000);
        nextEnd = new Date(state.originalEndDate.getTime() + totalDeltaMinutes * 60 * 1000);
      } else if (state.mode === "resize-start") {
        const candidateStart = new Date(state.originalStartDate.getTime() + snappedDeltaMinutes * 60 * 1000);
        const latestStart = new Date(state.originalEndDate.getTime() - minDurationMs);
        const dayFloor = new Date(state.originalStartDate);
        dayFloor.setHours(0, 0, 0, 0);

        if (candidateStart < dayFloor) {
          nextStart = dayFloor;
        } else if (candidateStart > latestStart) {
          nextStart = latestStart;
        } else {
          nextStart = candidateStart;
        }
      } else {
        const candidateEnd = new Date(state.originalEndDate.getTime() + snappedDeltaMinutes * 60 * 1000);
        const earliestEnd = new Date(state.originalStartDate.getTime() + minDurationMs);
        const dayCeil = new Date(state.originalStartDate);
        dayCeil.setHours(24, 0, 0, 0);

        if (candidateEnd > dayCeil) {
          nextEnd = dayCeil;
        } else if (candidateEnd < earliestEnd) {
          nextEnd = earliestEnd;
        } else {
          nextEnd = candidateEnd;
        }
      }

      if (nextEnd.getTime() <= nextStart.getTime()) {
        nextEnd = new Date(nextStart.getTime() + minDurationMs);
      }

      const date = formatDateForInput(nextStart);
      const start = formatTimeForInput(nextStart);
      const end = formatTimeForInput(nextEnd);
      const durationHours = (nextEnd.getTime() - nextStart.getTime()) / (1000 * 60 * 60);
      const duration = Math.round(durationHours * 100) / 100;

      return { date, start, end, duration };
    }

    function applyDirectEditDraftPreview(state, draft, isInvalid) {
      const targetId = String(state?.entryId || "");
      if (!targetId) return;
      const sourceEntries = getCalendarRenderEntries(getEntries());
      const previewEntries = sourceEntries.map((item) => {
        if (String(item.id) !== targetId) return item;
        return {
          ...item,
          date: draft.date,
          start: draft.start,
          end: draft.end,
          duration: draft.duration,
          _directEditActive: true,
          _directEditInvalid: isInvalid,
        };
      });
      render(previewEntries);
    }

    function finalizeDirectEdit(cancelled) {
      if (!calendarDirectEditState) return;
      const state = calendarDirectEditState;
      const shouldSuppressClick = state.hasExceededSlop;

      documentRef.body.classList.remove("calendar-direct-editing");
      documentRef.body.classList.remove("calendar-direct-editing-resize");

      if (cancelled || !state.hasExceededSlop || !state.draft) {
        if (state.hasExceededSlop) {
          render(getEntries());
        }
        clearDirectEditState(shouldSuppressClick);
        return;
      }

      const draft = state.draft;
      const hasChanged =
        draft.date !== state.baseEntry.date ||
        draft.start !== state.baseEntry.start ||
        draft.end !== state.baseEntry.end;

      if (!hasChanged) {
        render(getEntries());
        clearDirectEditState(shouldSuppressClick);
        return;
      }

      if (!state.draftValidation?.ok) {
        alertFn(state.draftValidation?.message || "时间调整无效。");
        render(getEntries());
        clearDirectEditState(shouldSuppressClick);
        return;
      }

      if (state.draftOverlap) {
        alertFn(getOverlapMessage(state.draftOverlap));
        render(getEntries());
        clearDirectEditState(shouldSuppressClick);
        return;
      }

      const applied = commitDirectEditDraft(state, draft);
      if (!applied) {
        render(getEntries());
      }
      clearDirectEditState(shouldSuppressClick);
    }

    function clearDirectEditState(shouldSuppressClick = false) {
      if (shouldSuppressClick) {
        calendarSuppressClickUntil = Date.now() + CALENDAR_DIRECT_EDIT_CLICK_SUPPRESS_MS;
      }
      calendarDirectEditState = null;
      calendarDirectEditPendingPointer = null;
      if (calendarDirectEditRafId) {
        cancelAnimationFrameFn(calendarDirectEditRafId);
        calendarDirectEditRafId = 0;
      }
    }

    function createEventNode(segment, hourHeight) {
      const minuteHeight = hourHeight / 60;
      const durationMinutes = Math.max(1, segment.endMinutes - segment.startMinutes);
      const top = segment.startMinutes * minuteHeight;
      const height = Math.max(durationMinutes * minuteHeight, 32);
      const columns = segment.columnCount || 1;
      const widthPercent = 100 / columns;
      const sideGap = 3;
      const isCompact = durationMinutes < 50;
      const isTitleOnly = height <= 42 || durationMinutes <= 35;

      const entry = segment.entry;
      const startText = formatMinutesLabel(segment.startMinutes);
      const endText = formatMinutesLabel(segment.endMinutes);
      const durationText = `${entry.duration.toFixed(1)}h`;
      const eventColor = getEventColorTokens(entry);
      const isTodoPlan = Boolean(entry.todoPending);
      const isPendingReview = Boolean(entry.needsReview);
      const displayTitle = getEntryDisplayTitle(entry, isTodoPlan ? "待办计划" : isPendingReview ? "待编辑日程" : "记录");
      const reviewMeta = entry.calendarGroup ? `待编辑 · ${entry.calendarGroup}` : "待编辑";
      const todoMeta = entry.category ? `待办计划 · ${entry.category}` : "待办计划";
      const canDirectEdit = canDirectEditEntry(entry);
      const isDirectEditActive = Boolean(entry._directEditActive);
      const isDirectEditInvalid = Boolean(entry._directEditInvalid);

      const eventNode = documentRef.createElement("article");
      eventNode.className = `calendar-event${isCompact ? " is-compact" : ""}${isTitleOnly ? " is-title-only" : ""}${canDirectEdit ? " is-direct-editable" : " is-direct-edit-disabled"}${isDirectEditActive ? " is-direct-edit-active" : ""}${isDirectEditInvalid ? " is-direct-edit-invalid" : ""}`;
      eventNode.dataset.id = String(entry.id);
      eventNode.dataset.dayKey = segment.dayKey;
      eventNode.dataset.directEdit = canDirectEdit ? "true" : "false";
      eventNode.tabIndex = 0;
      eventNode.setAttribute("role", "button");
      eventNode.setAttribute(
        "aria-label",
        `${displayTitle} ${startText}-${endText}${isTodoPlan ? "，待办计划" : isPendingReview ? "，待编辑" : "，查看详情"}`,
      );
      eventNode.style.top = `${top}px`;
      eventNode.style.height = `${height}px`;
      eventNode.style.left = `calc(${segment.columnIndex * widthPercent}% + ${sideGap}px)`;
      eventNode.style.width = `calc(${widthPercent}% - ${sideGap * 2}px)`;
      eventNode.style.setProperty("--event-bg-a", eventColor.bgA);
      eventNode.style.setProperty("--event-bg-b", eventColor.bgB);
      eventNode.style.setProperty("--event-border", eventColor.border);
      eventNode.style.setProperty("--event-accent", eventColor.accent);
      eventNode.style.setProperty("--event-text", eventColor.text);
      eventNode.style.setProperty("--event-subtext", eventColor.subtext);
      eventNode.style.setProperty("--event-shadow", eventColor.shadow);
      if (isTodoPlan) {
        eventNode.title = `${displayTitle} ${startText}-${endText}\n${todoMeta}`;
      } else if (isPendingReview) {
        eventNode.title = `${displayTitle} ${startText}-${endText}\n${reviewMeta}`;
      } else {
        eventNode.title = `${displayTitle} ${startText}-${endText}\n质量${entry.quality} 幸福${entry.happiness}`;
      }

      const detailText = isTitleOnly
        ? ""
        : isTodoPlan
          ? `
    <p class="calendar-event-time">${startText} - ${endText}</p>
    <p class="calendar-event-meta">${escapeHtml(todoMeta)} · ${durationText}</p>
  `
          : isPendingReview
            ? `
    <p class="calendar-event-time">${startText} - ${endText}</p>
    <p class="calendar-event-meta">${escapeHtml(reviewMeta)} · ${durationText}</p>
  `
            : `
    <p class="calendar-event-time">${startText} - ${endText}</p>
    <p class="calendar-event-meta">质${entry.quality} / 幸${entry.happiness} · ${durationText}</p>
  `;
      const resizeHandles = canDirectEdit
        ? `
    <span class="calendar-event-edge calendar-event-edge-top" data-edge="start" aria-hidden="true"></span>
    <span class="calendar-event-edge calendar-event-edge-bottom" data-edge="end" aria-hidden="true"></span>
  `
        : "";
      const deleteButton = isTodoPlan
        ? ""
        : `<button class="calendar-event-delete" type="button" data-id="${entry.id}" aria-label="删除记录">×</button>`;

      eventNode.innerHTML = `
    ${resizeHandles}
    ${deleteButton}
    <p class="calendar-event-title">${escapeHtml(displayTitle)}</p>
    ${detailText}
  `;

      return eventNode;
    }

    function getEventColorTokens(entry) {
      if (entry && entry.todoPending) {
        return {
          bgA: "#f4f7fa",
          bgB: "#eaeff5",
          border: "#bac2cd",
          accent: "#808fa4",
          text: "#293444",
          subtext: "#586475",
          shadow: "0 4px 10px rgba(54, 72, 96, 0.12)",
        };
      }

      if (entry && entry.needsReview) {
        return {
          bgA: "#f4f5f7",
          bgB: "#edeff2",
          border: "#c0c5cd",
          accent: "#89919f",
          text: "#2e3440",
          subtext: "#5f6774",
          shadow: "0 4px 10px rgba(63, 74, 92, 0.12)",
        };
      }

      const quality = Number(entry.quality) || 0;
      const happiness = Number(entry.happiness) || 0;

      if (quality >= 8 && happiness >= 8) {
        return {
          bgA: "#eaf6ee",
          bgB: "#dff0e4",
          border: "#93baa3",
          accent: "#549172",
          text: "#214033",
          subtext: "#426757",
          shadow: "0 4px 10px rgba(79, 150, 114, 0.14)",
        };
      }

      if (quality >= 8 && happiness <= 5) {
        return {
          bgA: "#f0ecfa",
          bgB: "#e8e0f6",
          border: "#b0a4cf",
          accent: "#7968ad",
          text: "#3c335c",
          subtext: "#675d8e",
          shadow: "0 4px 10px rgba(118, 98, 179, 0.14)",
        };
      }

      if (quality <= 5 && happiness >= 8) {
        return {
          bgA: "#ebf3fa",
          bgB: "#e1eef7",
          border: "#9ab8d0",
          accent: "#5586b4",
          text: "#28455f",
          subtext: "#4d6b89",
          shadow: "0 4px 10px rgba(77, 134, 188, 0.14)",
        };
      }

      if (quality <= 5 && happiness <= 5) {
        return {
          bgA: "#f6e4e4",
          bgB: "#f0d3d3",
          border: "#c58d8d",
          accent: "#a25656",
          text: "#5b2828",
          subtext: "#804b4b",
          shadow: "0 4px 10px rgba(169, 79, 79, 0.16)",
        };
      }

      if (quality >= 7 || happiness >= 7) {
        return {
          bgA: "#f8edde",
          bgB: "#f2e2cd",
          border: "#d0b28d",
          accent: "#b0824f",
          text: "#583d24",
          subtext: "#7e624b",
          shadow: "0 4px 10px rgba(185, 130, 70, 0.14)",
        };
      }

      return {
        bgA: "#f8eded",
        bgB: "#f4e3e3",
        border: "#dabdbd",
        accent: "#b98686",
        text: "#573636",
        subtext: "#775858",
        shadow: "0 4px 10px rgba(190, 129, 129, 0.13)",
      };
    }

    function layoutDaySegments(segments) {
      if (!segments.length) return [];

      const sorted = [...segments].sort((a, b) => {
        if (a.startMinutes !== b.startMinutes) return a.startMinutes - b.startMinutes;
        return a.endMinutes - b.endMinutes;
      });

      const columnEndMinutes = [];
      const laidOut = [];

      for (const segment of sorted) {
        let columnIndex = -1;
        for (let index = 0; index < columnEndMinutes.length; index += 1) {
          if (segment.startMinutes >= columnEndMinutes[index]) {
            columnIndex = index;
            break;
          }
        }

        if (columnIndex === -1) {
          columnIndex = columnEndMinutes.length;
          columnEndMinutes.push(segment.endMinutes);
        } else {
          columnEndMinutes[columnIndex] = segment.endMinutes;
        }

        laidOut.push({
          ...segment,
          columnIndex,
        });
      }

      const columnCount = Math.max(1, columnEndMinutes.length);
      for (const item of laidOut) {
        item.columnCount = columnCount;
      }

      return laidOut;
    }

    function splitEntryIntoDaySegments(entry) {
      const range = buildEntryDateRange(entry.date, entry.start, entry.end);
      if (!range) return [];

      const segments = [];
      let cursor = new Date(range.startDate);

      while (cursor < range.endDate) {
        const dayStart = new Date(cursor);
        dayStart.setHours(0, 0, 0, 0);
        const nextDay = addDays(dayStart, 1);
        const segmentEnd = range.endDate < nextDay ? new Date(range.endDate) : nextDay;
        const dayKey = formatDateForInput(dayStart);
        const startMinutes = cursor.getHours() * 60 + cursor.getMinutes();
        let endMinutes = segmentEnd.getHours() * 60 + segmentEnd.getMinutes();
        if (segmentEnd.getTime() === nextDay.getTime()) {
          endMinutes = 24 * 60;
        }

        segments.push({
          entry,
          dayKey,
          startMinutes,
          endMinutes,
        });

        cursor = new Date(segmentEnd);
      }

      return segments;
    }

    function formatRange(start, end) {
      const startMonth = start.getMonth() + 1;
      const endMonth = end.getMonth() + 1;
      const startText = `${startMonth}月${start.getDate()}日`;
      const endText = `${endMonth}月${end.getDate()}日`;

      if (start.getFullYear() === end.getFullYear()) {
        return `${start.getFullYear()}年 ${startText} - ${endText}`;
      }

      return `${start.getFullYear()}年${startText} - ${end.getFullYear()}年${endText}`;
    }

    function getHourHeight() {
      if (!recordsPanel) return 56;
      const raw = windowRef.getComputedStyle(recordsPanel).getPropertyValue("--calendar-hour-height");
      const parsed = Number.parseFloat(raw);
      return Number.isFinite(parsed) ? parsed : 56;
    }

    function roundToStep(value, step) {
      const safeStep = Math.max(1, Math.floor(step));
      return Math.round(value / safeStep) * safeStep;
    }

    function getDayIndexByClientX(clientX) {
      if (!calendarDayColumns) return 0;
      const rect = calendarDayColumns.getBoundingClientRect();
      if (rect.width <= 0) return 0;
      const ratio = (clientX - rect.left) / rect.width;
      const clamped = Math.max(0, Math.min(0.999999, ratio));
      return Math.floor(clamped * 7);
    }

    function getDayIndexByDateKey(dayKey) {
      const key = String(dayKey || "");
      if (!key) return -1;
      const weekDates = getWeekDates(getCalendarWeekStart());
      return weekDates.findIndex((date) => formatDateForInput(date) === key);
    }

    function getDefaultMinutesByClick(dayColumn, event) {
      const rect = dayColumn.getBoundingClientRect();
      const clickY = event.clientY - rect.top;
      const ratio = Math.max(0, Math.min(1, clickY / Math.max(1, rect.height)));
      const totalMinutes = Math.max(0, Math.min(24 * 60 - 1, Math.floor(ratio * 24 * 60)));
      const roundedStart = Math.floor(totalMinutes / CALENDAR_CLICK_MINUTE_STEP) * CALENDAR_CLICK_MINUTE_STEP;
      const startMinutes = Math.max(0, Math.min(24 * 60 - 1, roundedStart));
      const endMinutes = Math.max(
        startMinutes + 1,
        Math.min(24 * 60 - 1, startMinutes + CALENDAR_NEW_EVENT_DEFAULT_DURATION_MINUTES),
      );

      return { startMinutes, endMinutes };
    }

    function setDefaultViewport() {
      if (!calendarScroll) return;
      const hourHeight = getHourHeight();
      const pendingFocusMinutes = getCalendarPendingFocusMinutes();
      const hasPendingFocus = Number.isFinite(pendingFocusMinutes);
      const targetCenter = hasPendingFocus
        ? (Math.max(0, Math.min(24 * 60, pendingFocusMinutes)) / 60) * hourHeight
        : CALENDAR_DEFAULT_CENTER_HOUR * hourHeight;
      const minTop = hasPendingFocus ? 0 : CALENDAR_DEFAULT_HIDE_BEFORE_HOUR * hourHeight;
      const viewportHeight = calendarScroll.clientHeight;

      let targetTop = targetCenter - viewportHeight / 2;
      targetTop = Math.max(minTop, targetTop);

      const maxScrollTop = Math.max(0, calendarScroll.scrollHeight - viewportHeight);
      calendarScroll.scrollTop = Math.min(maxScrollTop, Math.max(0, targetTop));
      setCalendarPendingFocusMinutes(null);
    }

    function isDirectEditing() {
      return Boolean(calendarDirectEditState);
    }

    function shouldSuppressClick() {
      return Date.now() < calendarSuppressClickUntil || isDirectEditing();
    }

    return {
      bindCustomScrollbar,
      bindScrollbarOnlyInteraction,
      getScrollbarMetrics,
      syncCustomScrollbar,
      setScrollTopByThumbTop,
      renderTimeAxis,
      render,
      renderUnratedJumpButton,
      renderNowLine,
      startNowLineTicker,
      renderWeekdays,
      getUnratedEntries,
      getUnratedTargetDate,
      handleUnratedJump,
      handleDirectEditPointerDown,
      handleDirectEditPointerMove,
      handleDirectEditPointerUp,
      handleDirectEditPointerCancel,
      getRenderEntries: () => calendarRenderEntries,
      isDirectEditing,
      shouldSuppressClick,
      createEventNode,
      getEventColorTokens,
      layoutDaySegments,
      splitEntryIntoDaySegments,
      formatRange,
      getHourHeight,
      roundToStep,
      getDayIndexByClientX,
      getDayIndexByDateKey,
      getDefaultMinutesByClick,
      setDefaultViewport,
    };
  }

  globalScope.TimeQualityCalendarUiModule = {
    createCalendarUiModule,
  };
})(typeof window !== "undefined" ? window : globalThis);
