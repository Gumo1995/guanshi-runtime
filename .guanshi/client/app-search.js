(function attachTimeQualitySearchModule(globalScope) {
  if (!globalScope) return;

  function requireFunction(deps, key) {
    const value = deps[key];
    if (typeof value !== "function") {
      throw new Error(`TimeQualitySearchModule missing required function dependency: ${key}`);
    }
    return value;
  }

  function createSearchModule(deps = {}) {
    const getTodos = requireFunction(deps, "getTodos");
    const getEntries = requireFunction(deps, "getEntries");
    const normalizeTodo = requireFunction(deps, "normalizeTodo");
    const normalizeProjectName = requireFunction(deps, "normalizeProjectName");
    const getTodoCategory = requireFunction(deps, "getTodoCategory");
    const isValidDateInput = requireFunction(deps, "isValidDateInput");
    const isValidClockInput = requireFunction(deps, "isValidClockInput");
    const formatDate = requireFunction(deps, "formatDate");
    const getWeekdayLabelForDate = requireFunction(deps, "getWeekdayLabelForDate");
    const getEntryDisplayTitle = requireFunction(deps, "getEntryDisplayTitle");
    const escapeHtml = requireFunction(deps, "escapeHtml");
    const escapeCssAttributeSelectorValue = requireFunction(deps, "escapeCssAttributeSelectorValue");
    const setActiveView = requireFunction(deps, "setActiveView");
    const render = requireFunction(deps, "render");
    const renderTodos = requireFunction(deps, "renderTodos");
    const renderCalendar = requireFunction(deps, "renderCalendar");
    const getStartOfWeek = requireFunction(deps, "getStartOfWeek");
    const parseClockToMinutes = requireFunction(deps, "parseClockToMinutes");
    const setSelectedTodoId = requireFunction(deps, "setSelectedTodoId");
    const setCalendarWeekStart = requireFunction(deps, "setCalendarWeekStart");
    const setCalendarNeedsViewportReset = requireFunction(deps, "setCalendarNeedsViewportReset");
    const setCalendarPendingFocusMinutes = requireFunction(deps, "setCalendarPendingFocusMinutes");

    const requestAnimationFrameFn =
      typeof deps.requestAnimationFrameFn === "function"
        ? deps.requestAnimationFrameFn
        : globalScope.requestAnimationFrame.bind(globalScope);
    const setTimeoutFn =
      typeof deps.setTimeoutFn === "function"
        ? deps.setTimeoutFn
        : globalScope.setTimeout.bind(globalScope);
    const clearTimeoutFn =
      typeof deps.clearTimeoutFn === "function"
        ? deps.clearTimeoutFn
        : globalScope.clearTimeout.bind(globalScope);

    const documentRef = deps.documentRef || globalScope.document || null;
    const globalSearchWrap = deps.globalSearchWrap || null;
    const globalSearchInput = deps.globalSearchInput || null;
    const globalSearchResultsPanel = deps.globalSearchResultsPanel || null;
    const globalSearchResultsList = deps.globalSearchResultsList || null;
    const globalSearchResultsEmpty = deps.globalSearchResultsEmpty || null;
    const todoGroups = deps.todoGroups || null;
    const calendarDayColumns = deps.calendarDayColumns || null;
    const GLOBAL_SEARCH_RESULT_LIMIT = Math.max(
      1,
      Number.parseInt(String(deps.GLOBAL_SEARCH_RESULT_LIMIT || 12), 10),
    );
    const GLOBAL_SEARCH_TARGET_HIGHLIGHT_MS = Math.max(
      1,
      Number.parseInt(String(deps.GLOBAL_SEARCH_TARGET_HIGHLIGHT_MS || 1400), 10),
    );

    let globalSearchTerm = "";
    let globalSearchDropdownOpen = false;
    let globalSearchDropdownItems = [];
    let globalSearchDropdownActiveIndex = -1;
    let globalSearchTargetHighlightTimerId = 0;
    let eventsBound = false;

    function splitGlobalSearchKeywords(value) {
      return String(value || "")
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 6);
    }

    function doesGlobalSearchHaystackMatch(haystack, keywords) {
      const normalizedHaystack = String(haystack || "").toLowerCase();
      if (!keywords.length) return true;
      return keywords.every((item) => normalizedHaystack.includes(item));
    }

    function buildTodoGlobalSearchMeta(todo) {
      const projectText = normalizeProjectName(todo.project || "") || "未设置项目";
      const categoryText = getTodoCategory(todo, projectText) || "未分类";
      const dueDate = String(todo.dueDate || "").trim();
      const dueText = isValidDateInput(dueDate)
        ? `${formatDate(dueDate)} ${getWeekdayLabelForDate(dueDate)}`
        : "未排期";
      const timeText = todo.startTime && todo.endTime ? `${todo.startTime}-${todo.endTime}` : "";
      const timingText = timeText ? `${dueText} ${timeText}` : dueText;
      return `${timingText} · ${projectText} · ${categoryText}`;
    }

    function buildEntryGlobalSearchMeta(entry) {
      const date = String(entry.date || "").trim();
      const dateText = isValidDateInput(date) ? `${formatDate(date)} ${getWeekdayLabelForDate(date)}` : "未标注日期";
      const start = String(entry.start || "").trim();
      const end = String(entry.end || "").trim();
      const timeText = start && end ? `${start}-${end}` : "";
      const categoryText = String(entry.category || "").trim() || "记录";
      const timingText = timeText ? `${dateText} ${timeText}` : dateText;
      return `${timingText} · ${categoryText}`;
    }

    function buildTodoGlobalSearchSortToken(todo) {
      const dueDate = String(todo.dueDate || "").trim();
      const dueClock = isValidClockInput(String(todo.startTime || "").trim()) ? String(todo.startTime).trim() : "23:59";
      if (isValidDateInput(dueDate)) {
        return `${dueDate} ${dueClock}`;
      }
      return "9999-12-31 23:59";
    }

    function buildEntryGlobalSearchSortToken(entry) {
      const date = String(entry.date || "").trim();
      const clock = isValidClockInput(String(entry.start || "").trim()) ? String(entry.start).trim() : "00:00";
      if (isValidDateInput(date)) {
        return `${date} ${clock}`;
      }
      return "0000-00-00 00:00";
    }

    function compareGlobalSearchItems(left, right) {
      if (left.kind !== right.kind) {
        return left.kind === "todo" ? -1 : 1;
      }
      if (left.kind === "todo") {
        const dueCompare = left.sortToken.localeCompare(right.sortToken);
        if (dueCompare !== 0) return dueCompare;
        return left.title.localeCompare(right.title, "zh-CN");
      }
      const entryCompare = right.sortToken.localeCompare(left.sortToken);
      if (entryCompare !== 0) return entryCompare;
      return left.title.localeCompare(right.title, "zh-CN");
    }

    function collectResults(keyword = globalSearchTerm) {
      const keywords = splitGlobalSearchKeywords(keyword);
      if (!keywords.length) return [];

      const results = [];
      const normalizedTodos = getTodos().map(normalizeTodo);
      for (const todo of normalizedTodos) {
        if (todo.completed) continue;
        const haystack = `${todo.title} ${todo.project} ${todo.category} ${todo.tags.join(" ")} ${todo.note} ${todo.dueDate} ${todo.startTime} ${todo.endTime} ${todo.reminder}`;
        if (!doesGlobalSearchHaystackMatch(haystack, keywords)) continue;
        results.push({
          key: `todo:${todo.id}`,
          kind: "todo",
          id: String(todo.id),
          title: String(todo.title || "未命名待办"),
          meta: buildTodoGlobalSearchMeta(todo),
          sortToken: buildTodoGlobalSearchSortToken(todo),
        });
      }

      for (const entry of getEntries()) {
        if (!entry) continue;
        const displayTitle = getEntryDisplayTitle(entry, entry.category || "记录");
        const tagsText = Array.isArray(entry.tags) ? entry.tags.join(" ") : "";
        const haystack = `${displayTitle} ${entry.category || ""} ${entry.project || ""} ${entry.note || ""} ${entry.date || ""} ${entry.start || ""} ${entry.end || ""} ${tagsText}`;
        if (!doesGlobalSearchHaystackMatch(haystack, keywords)) continue;
        results.push({
          key: `entry:${entry.id}`,
          kind: "entry",
          id: String(entry.id),
          title: displayTitle,
          meta: buildEntryGlobalSearchMeta(entry),
          sortToken: buildEntryGlobalSearchSortToken(entry),
        });
      }

      return results.sort(compareGlobalSearchItems).slice(0, GLOBAL_SEARCH_RESULT_LIMIT);
    }

    function renderDropdown() {
      if (!globalSearchResultsPanel || !globalSearchResultsList || !globalSearchResultsEmpty) return;
      const shouldShow = Boolean(globalSearchDropdownOpen && globalSearchTerm);
      globalSearchResultsPanel.hidden = !shouldShow;
      if (!shouldShow) return;

      if (!globalSearchDropdownItems.length) {
        globalSearchResultsList.innerHTML = "";
        globalSearchResultsEmpty.hidden = false;
        return;
      }

      globalSearchResultsEmpty.hidden = true;
      globalSearchResultsList.innerHTML = globalSearchDropdownItems
        .map((item, index) => {
          const activeClass = index === globalSearchDropdownActiveIndex ? " is-active" : "";
          const typeClass = item.kind === "entry" ? " is-entry" : "";
          const typeLabel = item.kind === "entry" ? "记录" : "待办";
          return `
            <li>
              <button class="top-search-result-row${activeClass}" type="button" data-index="${index}" role="option" aria-selected="${index === globalSearchDropdownActiveIndex ? "true" : "false"}">
                <span class="top-search-result-type${typeClass}">${typeLabel}</span>
                <span class="top-search-result-main">
                  <span class="top-search-result-title">${escapeHtml(item.title)}</span>
                  <span class="top-search-result-meta">${escapeHtml(item.meta)}</span>
                </span>
              </button>
            </li>
          `;
        })
        .join("");
    }

    function closeDropdown({ resetActiveIndex = false } = {}) {
      globalSearchDropdownOpen = false;
      if (resetActiveIndex) {
        globalSearchDropdownActiveIndex = -1;
      }
      renderDropdown();
    }

    function openDropdown({ resetActiveIndex = false } = {}) {
      if (!globalSearchTerm) {
        globalSearchDropdownItems = [];
        closeDropdown({ resetActiveIndex: true });
        return;
      }

      globalSearchDropdownItems = collectResults(globalSearchTerm);
      if (!globalSearchDropdownItems.length) {
        globalSearchDropdownActiveIndex = -1;
      } else if (resetActiveIndex || globalSearchDropdownActiveIndex < 0 || globalSearchDropdownActiveIndex >= globalSearchDropdownItems.length) {
        globalSearchDropdownActiveIndex = 0;
      }

      globalSearchDropdownOpen = true;
      renderDropdown();
    }

    function syncAfterRender() {
      if (!globalSearchDropdownOpen) return;
      if (!globalSearchTerm) {
        closeDropdown({ resetActiveIndex: true });
        return;
      }
      const activeKey = globalSearchDropdownItems[globalSearchDropdownActiveIndex]?.key || "";
      globalSearchDropdownItems = collectResults(globalSearchTerm);
      if (!globalSearchDropdownItems.length) {
        globalSearchDropdownActiveIndex = -1;
      } else if (activeKey) {
        const index = globalSearchDropdownItems.findIndex((item) => item.key === activeKey);
        globalSearchDropdownActiveIndex = index >= 0 ? index : 0;
      } else if (globalSearchDropdownActiveIndex < 0 || globalSearchDropdownActiveIndex >= globalSearchDropdownItems.length) {
        globalSearchDropdownActiveIndex = 0;
      }
      renderDropdown();
    }

    function scrollActiveGlobalSearchResultIntoView() {
      if (!globalSearchResultsList || globalSearchDropdownActiveIndex < 0) return;
      const activeNode = globalSearchResultsList.querySelector("button.top-search-result-row.is-active");
      if (!(activeNode instanceof HTMLElement)) return;
      activeNode.scrollIntoView({ block: "nearest" });
    }

    function clearTargetHighlight() {
      if (globalSearchTargetHighlightTimerId) {
        clearTimeoutFn(globalSearchTargetHighlightTimerId);
        globalSearchTargetHighlightTimerId = 0;
      }
      if (!documentRef) return;
      for (const node of documentRef.querySelectorAll(".todo-item.is-search-target, .calendar-event.is-search-target")) {
        node.classList.remove("is-search-target");
      }
    }

    function scheduleGlobalSearchTargetHighlightCleanup() {
      if (globalSearchTargetHighlightTimerId) {
        clearTimeoutFn(globalSearchTargetHighlightTimerId);
      }
      globalSearchTargetHighlightTimerId = setTimeoutFn(() => {
        globalSearchTargetHighlightTimerId = 0;
        if (!documentRef) return;
        for (const node of documentRef.querySelectorAll(".todo-item.is-search-target, .calendar-event.is-search-target")) {
          node.classList.remove("is-search-target");
        }
      }, GLOBAL_SEARCH_TARGET_HIGHLIGHT_MS);
    }

    function highlightTodoTarget(todoId) {
      requestAnimationFrameFn(() => {
        if (!todoGroups) return;
        clearTargetHighlight();
        const target = todoGroups.querySelector(`.todo-item[data-id="${escapeCssAttributeSelectorValue(todoId)}"]`);
        if (!(target instanceof HTMLElement)) return;
        target.classList.add("is-search-target");
        target.scrollIntoView({ block: "center", behavior: "smooth" });
        scheduleGlobalSearchTargetHighlightCleanup();
      });
    }

    function highlightCalendarTarget(entryId) {
      requestAnimationFrameFn(() => {
        if (!calendarDayColumns) return;
        clearTargetHighlight();
        const target = calendarDayColumns.querySelector(`.calendar-event[data-id="${escapeCssAttributeSelectorValue(entryId)}"]`);
        if (!(target instanceof HTMLElement)) return;
        target.classList.add("is-search-target");
        target.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
        scheduleGlobalSearchTargetHighlightCleanup();
      });
    }

    function openResultByIndex(index) {
      const target = globalSearchDropdownItems[index];
      if (!target) return;
      closeDropdown();

      if (target.kind === "todo") {
        const todo = getTodos().find((item) => String(item.id) === String(target.id));
        if (!todo) return;
        setSelectedTodoId(String(todo.id));
        setActiveView("todo");
        renderTodos();
        highlightTodoTarget(todo.id);
        return;
      }

      const entry = getEntries().find((item) => String(item.id) === String(target.id));
      if (!entry) return;
      const date = new Date(`${entry.date}T00:00:00`);
      if (!Number.isNaN(date.getTime())) {
        setCalendarWeekStart(getStartOfWeek(date));
        setCalendarNeedsViewportReset(true);
      }
      const startMinutes = parseClockToMinutes(entry.start);
      if (Number.isInteger(startMinutes)) {
        setCalendarPendingFocusMinutes(startMinutes);
      }
      setActiveView("calendar");
      renderCalendar(getEntries());
      highlightCalendarTarget(entry.id);
    }

    function handleResultClick(event) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const row = target.closest("button.top-search-result-row[data-index]");
      if (!(row instanceof HTMLButtonElement)) return;
      const index = Number.parseInt(String(row.dataset.index || "-1"), 10);
      if (!Number.isInteger(index) || index < 0) return;
      openResultByIndex(index);
    }

    function handleInputKeydown(event) {
      if (event.defaultPrevented) return;
      if (event.isComposing) return;
      if (event.key === "Escape") {
        if (!globalSearchDropdownOpen) return;
        event.preventDefault();
        closeDropdown({ resetActiveIndex: false });
        return;
      }

      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (!globalSearchTerm) return;
        if (!globalSearchDropdownOpen) {
          event.preventDefault();
          openDropdown({ resetActiveIndex: true });
          return;
        }
        if (!globalSearchDropdownItems.length) return;
        event.preventDefault();
        const size = globalSearchDropdownItems.length;
        const delta = event.key === "ArrowDown" ? 1 : -1;
        const current = globalSearchDropdownActiveIndex < 0 ? 0 : globalSearchDropdownActiveIndex;
        globalSearchDropdownActiveIndex = (current + delta + size) % size;
        renderDropdown();
        scrollActiveGlobalSearchResultIntoView();
        return;
      }

      if (event.key !== "Enter") return;
      if (event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return;
      if (!globalSearchDropdownOpen || !globalSearchDropdownItems.length) return;
      event.preventDefault();
      const index = globalSearchDropdownActiveIndex >= 0 ? globalSearchDropdownActiveIndex : 0;
      openResultByIndex(index);
    }

    function handleOutsidePointerDown(event) {
      if (!globalSearchDropdownOpen) return;
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (globalSearchWrap && globalSearchWrap.contains(target)) return;
      closeDropdown();
    }

    function setTerm(value, { updateInput = false } = {}) {
      globalSearchTerm = String(value || "").trim().toLowerCase();
      if (updateInput && globalSearchInput) {
        globalSearchInput.value = globalSearchTerm;
      }
    }

    function bindEvents() {
      if (eventsBound) return;
      eventsBound = true;

      if (globalSearchInput) {
        globalSearchInput.addEventListener("input", () => {
          setTerm(globalSearchInput.value);
          openDropdown({ resetActiveIndex: true });
          render();
        });
        globalSearchInput.addEventListener("focus", () => {
          if (!globalSearchTerm) {
            closeDropdown();
            return;
          }
          openDropdown({ resetActiveIndex: false });
        });
        globalSearchInput.addEventListener("keydown", handleInputKeydown);
      }

      if (globalSearchResultsPanel) {
        globalSearchResultsPanel.addEventListener("pointerdown", (event) => {
          event.preventDefault();
        });
        globalSearchResultsPanel.addEventListener("click", handleResultClick);
      }

      if (documentRef) {
        documentRef.addEventListener("pointerdown", handleOutsidePointerDown, { capture: true });
      }
    }

    return {
      bindEvents,
      getTerm: () => globalSearchTerm,
      setTerm,
      closeDropdown,
      openDropdown,
      syncAfterRender,
      collectResults,
      clearTargetHighlight,
    };
  }

  globalScope.TimeQualitySearchModule = {
    createSearchModule,
  };
})(typeof window !== "undefined" ? window : globalThis);
