/* global window */

(function attachTimeQualityCalendarModalModule(globalScope) {
  "use strict";

  function requireFunction(deps, name) {
    const value = deps[name];
    if (typeof value !== "function") {
      throw new Error(`TimeQualityCalendarModalModule requires dependency: ${name}`);
    }
    return value;
  }

  function createCalendarModalModule(deps = {}) {
    const {
      documentRef = globalScope.document,
      windowRef = globalScope,
      DEFAULT_SCORE = 5,
      calendarEventModal = null,
      calendarEventTitle = null,
      calendarEventForm = null,
      calendarEventEditCategory = null,
      calendarEventEditDate = null,
      calendarEventEditStart = null,
      calendarEventEditEnd = null,
      calendarEventEditQuality = null,
      calendarEventEditHappiness = null,
      calendarEventEditNote = null,
      scoreWheelModule = {},
    } = deps;

    const getCategories = requireFunction(deps, "getCategories");
    const setEditingCalendarEntryId = requireFunction(deps, "setEditingCalendarEntryId");
    const getTodayDateInputValue = requireFunction(deps, "getTodayDateInputValue");
    const getDefaultCalendarMinutesByClick = requireFunction(deps, "getDefaultCalendarMinutesByClick");
    const getEntryDisplayTitle = requireFunction(deps, "getEntryDisplayTitle");
    const isEntryNotEditableYet = requireFunction(deps, "isEntryNotEditableYet");
    const parseOptionalScore = requireFunction(deps, "parseOptionalScore");
    const formatMinutesForInput = requireFunction(deps, "formatMinutesForInput");
    const normalizeEntryTitle = requireFunction(deps, "normalizeEntryTitle");
    const updateBodyModalState = requireFunction(deps, "updateBodyModalState");

    const ElementCtor = windowRef?.Element || globalScope.Element;
    const HTMLInputElementCtor = windowRef?.HTMLInputElement || globalScope.HTMLInputElement;
    const HTMLSelectElementCtor = windowRef?.HTMLSelectElement || globalScope.HTMLSelectElement;
    const HTMLTextAreaElementCtor = windowRef?.HTMLTextAreaElement || globalScope.HTMLTextAreaElement;
    const EventCtor = windowRef?.Event || globalScope.Event;

    let eventsBound = false;

    function isElement(value) {
      return typeof ElementCtor === "function" && value instanceof ElementCtor;
    }

    function getCategoryList() {
      const categories = getCategories();
      return Array.isArray(categories) ? categories : [];
    }

    function getDefaultCategory() {
      return getCategoryList()[0] || "记录";
    }

    function getTitleFallback() {
      return calendarEventEditCategory?.value || getDefaultCategory();
    }

    function bindEvents({ onSubmit } = {}) {
      if (eventsBound) return;
      if (calendarEventForm && typeof onSubmit !== "function") {
        throw new Error("TimeQualityCalendarModalModule.bindEvents requires onSubmit.");
      }

      eventsBound = true;

      if (documentRef && typeof documentRef.addEventListener === "function") {
        documentRef.addEventListener("keydown", handleModalKeydown);
      }

      if (calendarEventModal) {
        calendarEventModal.addEventListener("click", (event) => {
          if (!isElement(event.target)) return;
          const closeTarget = event.target.closest("[data-calendar-modal-close]");
          if (closeTarget) {
            close();
          }
        });
      }

      if (calendarEventForm) {
        calendarEventForm.addEventListener("submit", onSubmit);
        calendarEventForm.addEventListener("keydown", handleFormEnterKeydown);
      }

      if (calendarEventTitle) {
        calendarEventTitle.addEventListener("click", beginTitleInlineEdit);
        calendarEventTitle.addEventListener("keydown", handleTitleKeydown);
        calendarEventTitle.addEventListener("blur", () => {
          getTitleValue(getTitleFallback());
          calendarEventTitle.setAttribute("contenteditable", "false");
        });
      }
    }

    function getTitleValue(fallback = getDefaultCategory()) {
      if (!calendarEventTitle) return normalizeEntryTitle("", fallback);
      const raw = String(calendarEventTitle.textContent || "").replace(/\s+/g, " ").trim();
      const normalized = normalizeEntryTitle(raw, fallback);
      calendarEventTitle.textContent = normalized;
      return normalized;
    }

    function setTitle(value, fallback = getDefaultCategory()) {
      if (!calendarEventTitle) return;
      calendarEventTitle.textContent = normalizeEntryTitle(value, fallback);
    }

    function beginTitleInlineEdit() {
      if (!calendarEventTitle || !calendarEventModal || calendarEventModal.hidden) return;
      if (calendarEventTitle.getAttribute("contenteditable") === "true" && documentRef.activeElement === calendarEventTitle) {
        return;
      }
      calendarEventTitle.setAttribute("contenteditable", "true");
      calendarEventTitle.focus();
      if (typeof windowRef.getSelection === "function" && typeof documentRef.createRange === "function") {
        const range = documentRef.createRange();
        range.selectNodeContents(calendarEventTitle);
        const selection = windowRef.getSelection();
        if (selection) {
          selection.removeAllRanges();
          selection.addRange(range);
        }
      }
    }

    function handleTitleKeydown(event) {
      if (event.key === "Enter") {
        event.preventDefault();
        getTitleValue(getTitleFallback());
        calendarEventTitle.blur();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        getTitleValue(getTitleFallback());
        calendarEventTitle.blur();
      }
    }

    function applyScoreEditState(entry = null) {
      if (!calendarEventEditQuality || !calendarEventEditHappiness) return;
      const isFutureEntry = Boolean(entry && isEntryScoreLocked(entry));
      calendarEventEditQuality.disabled = isFutureEntry;
      calendarEventEditHappiness.disabled = isFutureEntry;
      calendarEventEditQuality.title = isFutureEntry ? "未来时间块暂不支持质量评分" : "";
      calendarEventEditHappiness.title = isFutureEntry ? "未来时间块暂不支持幸福感评分" : "";
      calendarEventEditQuality.placeholder = isFutureEntry ? "未来时段暂不评分" : "";
      calendarEventEditHappiness.placeholder = isFutureEntry ? "未来时段暂不评分" : "";
    }

    function resetScoreEditState() {
      if (calendarEventEditQuality) {
        calendarEventEditQuality.disabled = false;
        calendarEventEditQuality.title = "";
        calendarEventEditQuality.placeholder = "";
      }
      if (calendarEventEditHappiness) {
        calendarEventEditHappiness.disabled = false;
        calendarEventEditHappiness.title = "";
        calendarEventEditHappiness.placeholder = "";
      }
    }

    function openCreateByClick(dayColumn, event) {
      if (!hasRequiredFormFields()) return;

      const today = getTodayDateInputValue();
      const rawDate = String(dayColumn.dataset.date || today);
      const date = rawDate || today;
      const { startMinutes, endMinutes } = getDefaultCalendarMinutesByClick(dayColumn, event);
      const defaultCategory = getDefaultCategory();

      closeScoreWheel();
      setEditingCalendarEntryId(null);
      setTitle("", defaultCategory);
      if (calendarEventTitle) {
        calendarEventTitle.setAttribute("contenteditable", "false");
      }
      calendarEventEditDate.max = "";
      calendarEventEditCategory.value = defaultCategory;
      calendarEventEditDate.value = date;
      calendarEventEditStart.value = formatMinutesForInput(startMinutes);
      calendarEventEditEnd.value = formatMinutesForInput(endMinutes);
      resetScoreEditState();
      calendarEventEditQuality.value = String(DEFAULT_SCORE);
      calendarEventEditHappiness.value = String(DEFAULT_SCORE);
      calendarEventEditNote.value = "";

      openModal();
      calendarEventEditCategory.focus();
    }

    function openEvent(entry) {
      if (!hasRequiredFormFields() || !entry) return;

      const categories = getCategoryList();
      const defaultCategory = getDefaultCategory();

      closeScoreWheel();
      setEditingCalendarEntryId(entry.id);
      setTitle(getEntryDisplayTitle(entry, defaultCategory), defaultCategory);
      if (calendarEventTitle) {
        calendarEventTitle.setAttribute("contenteditable", "false");
      }
      calendarEventEditCategory.value = categories.includes(entry.category) ? entry.category : defaultCategory;
      calendarEventEditDate.value = entry.date;
      calendarEventEditStart.value = entry.start;
      calendarEventEditEnd.value = entry.end;
      calendarEventEditDate.max = "";
      applyScoreEditState(entry);

      if (isEntryScoreLocked(entry)) {
        const quality = Number(entry.quality);
        const happiness = Number(entry.happiness);
        calendarEventEditQuality.value = Number.isInteger(quality) && quality >= 1 && quality <= 10 ? String(quality) : "";
        calendarEventEditHappiness.value =
          Number.isInteger(happiness) && happiness >= 1 && happiness <= 10 ? String(happiness) : "";
      } else {
        const quality = parseOptionalScore(entry.quality);
        const happiness = parseOptionalScore(entry.happiness);
        calendarEventEditQuality.value = quality === null ? "" : String(quality);
        calendarEventEditHappiness.value = happiness === null ? "" : String(happiness);
      }
      calendarEventEditNote.value = entry.note || "";

      openModal();
      calendarEventEditCategory.focus();
    }

    function close() {
      if (!calendarEventModal) return;
      closeScoreWheel();
      if (calendarEventTitle) {
        calendarEventTitle.setAttribute("contenteditable", "false");
      }
      setEditingCalendarEntryId(null);
      if (calendarEventForm) {
        calendarEventForm.reset();
      }
      resetScoreEditState();
      calendarEventModal.hidden = true;
      updateBodyModalState();
    }

    function isOpen() {
      return Boolean(calendarEventModal && !calendarEventModal.hidden);
    }

    function isEntryScoreLocked(entry) {
      return Boolean(entry && isEntryNotEditableYet(entry));
    }

    function handleModalKeydown(event) {
      if (event.key !== "Escape" || !isOpen()) return;
      if (typeof scoreWheelModule.isOpen === "function" && scoreWheelModule.isOpen()) {
        event.preventDefault();
        closeScoreWheel();
        return;
      }
      if (calendarEventTitle && documentRef.activeElement === calendarEventTitle) {
        event.preventDefault();
        getTitleValue(getTitleFallback());
        calendarEventTitle.blur();
        return;
      }
      event.preventDefault();
      close();
    }

    function handleFormEnterKeydown(event) {
      if (event.defaultPrevented) return;
      if (event.isComposing) return;
      if (event.key !== "Enter") return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const target = event.target;
      if (!isElement(target)) return;
      if (typeof HTMLTextAreaElementCtor === "function" && target instanceof HTMLTextAreaElementCtor) return;
      const isSubmitField =
        (typeof HTMLInputElementCtor === "function" && target instanceof HTMLInputElementCtor) ||
        (typeof HTMLSelectElementCtor === "function" && target instanceof HTMLSelectElementCtor);
      if (!isSubmitField || !calendarEventForm) return;

      event.preventDefault();
      if (typeof calendarEventForm.requestSubmit === "function") {
        calendarEventForm.requestSubmit();
        return;
      }
      calendarEventForm.dispatchEvent(new EventCtor("submit", { bubbles: true, cancelable: true }));
    }

    function hasRequiredFormFields() {
      return Boolean(
        calendarEventModal &&
          calendarEventForm &&
          calendarEventEditCategory &&
          calendarEventEditDate &&
          calendarEventEditStart &&
          calendarEventEditEnd &&
          calendarEventEditQuality &&
          calendarEventEditHappiness &&
          calendarEventEditNote,
      );
    }

    function openModal() {
      calendarEventModal.hidden = false;
      updateBodyModalState();
    }

    function closeScoreWheel() {
      if (scoreWheelModule && typeof scoreWheelModule.close === "function") {
        scoreWheelModule.close();
      }
    }

    return {
      bindEvents,
      openCreateByClick,
      openEvent,
      close,
      isOpen,
      getTitleValue,
      setTitle,
      beginTitleInlineEdit,
      isEntryScoreLocked,
    };
  }

  globalScope.TimeQualityCalendarModalModule = {
    createCalendarModalModule,
  };
})(typeof window !== "undefined" ? window : globalThis);
