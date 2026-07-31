/* global window */

(function attachTimeQualityLayoutShellModule(globalScope) {
  "use strict";

  function createLayoutShellModule(deps = {}) {
    const {
      documentRef = globalScope.document,
      windowRef = globalScope,
      recordsPanel,
      firstScreenPanels = [],
      sidebar,
      sidebarResizer,
      sidebarToggleBtn,
      todoLayout,
      todoDetailResizer,
      HARD_SNAP_GUTTER = 0,
      loadSidebarWidth,
      saveSidebarWidth,
      clampSidebarWidth,
      loadSidebarCollapsed,
      saveSidebarCollapsed,
      loadTodoDetailWidth,
      saveTodoDetailWidth,
      clampTodoDetailWidth,
      TODO_DETAIL_MIN_WIDTH = 320,
      TODO_DETAIL_MAX_WIDTH = 640,
      TODO_LIST_MIN_WIDTH = 420,
    } = deps;

    const ElementCtor = windowRef?.Element || globalScope.Element;
    const DEFAULT_TODO_DETAIL_WIDTH = 430;

    let hardSnapLockTimer = 0;
    let isHardSnapping = false;
    let isSidebarResizing = false;
    let isTodoDetailResizing = false;
    let sidebarCollapsed = false;
    let sidebarResizePointerId = null;
    let sidebarResizeStartX = 0;
    let sidebarResizeStartWidth = 0;
    let todoDetailResizePointerId = null;
    let todoDetailResizeStartX = 0;
    let todoDetailResizeStartWidth = 0;
    let todoDetailPreferredWidth = DEFAULT_TODO_DETAIL_WIDTH;
    let todoListPreferredWidth = 0;
    let todoLayoutSyncFrame = 0;
    let todoLayoutResizeObserver = null;
    let eventsBound = false;

    function isElement(value) {
      return typeof ElementCtor === "function" && value instanceof ElementCtor;
    }

    function init() {
      if (typeof loadSidebarWidth === "function") {
        applySidebarWidth(loadSidebarWidth());
      }
      applySidebarCollapsed(typeof loadSidebarCollapsed === "function" ? loadSidebarCollapsed() : false);
      if (typeof loadTodoDetailWidth === "function") {
        applyTodoDetailWidth(loadTodoDetailWidth());
      } else {
        applyTodoDetailWidth(DEFAULT_TODO_DETAIL_WIDTH);
      }
    }

    function bindEvents() {
      if (eventsBound) return;
      eventsBound = true;

      if (windowRef && typeof windowRef.addEventListener === "function") {
        windowRef.addEventListener("resize", handleWindowResize);
        windowRef.addEventListener("pointermove", handleSidebarResizeMove);
        windowRef.addEventListener("pointermove", handleTodoDetailResizeMove);
        windowRef.addEventListener("pointerup", handleSidebarResizeEnd);
        windowRef.addEventListener("pointerup", handleTodoDetailResizeEnd);
        windowRef.addEventListener("pointercancel", handleSidebarResizeEnd);
        windowRef.addEventListener("pointercancel", handleTodoDetailResizeEnd);
      }

      if (sidebarResizer) {
        sidebarResizer.addEventListener("pointerdown", handleSidebarResizeStart);
      }

      if (sidebarToggleBtn) {
        sidebarToggleBtn.addEventListener("click", toggleSidebarCollapsed);
      }

      if (todoDetailResizer) {
        todoDetailResizer.addEventListener("pointerdown", handleTodoDetailResizeStart);
        todoDetailResizer.addEventListener("keydown", handleTodoDetailResizeKeydown);
      }

      bindTodoLayoutResizeObserver();
    }

    function getInteractionClassTarget() {
      return documentRef?.body || documentRef?.documentElement || null;
    }

    function handleWindowResize() {
      scheduleFirstScreenPanelFit();
      if (!sidebarCollapsed && typeof loadSidebarWidth === "function") {
        applySidebarWidth(loadSidebarWidth());
      }
      scheduleTodoLayoutSync();
    }

    function applySidebarWidth(width) {
      if (!documentRef?.documentElement || typeof clampSidebarWidth !== "function") return;
      const clamped = clampSidebarWidth(width);
      documentRef.documentElement.style.setProperty("--sidebar-width", `${clamped}px`);
      scheduleTodoLayoutSync();
    }

    function applySidebarCollapsed(value) {
      sidebarCollapsed = Boolean(value);
      const target = getInteractionClassTarget();
      target?.classList.toggle("is-sidebar-collapsed", sidebarCollapsed);
      sidebarToggleBtn?.classList.toggle("is-active", sidebarCollapsed);
      if (sidebarToggleBtn) {
        const label = sidebarCollapsed ? "显示侧边栏" : "隐藏侧边栏";
        sidebarToggleBtn.setAttribute("aria-label", label);
        sidebarToggleBtn.setAttribute("aria-pressed", sidebarCollapsed ? "true" : "false");
        sidebarToggleBtn.title = label;
      }
      scheduleTodoLayoutSync();
    }

    function toggleSidebarCollapsed() {
      const nextValue = !sidebarCollapsed;
      applySidebarCollapsed(nextValue);
      if (!nextValue && typeof loadSidebarWidth === "function") {
        applySidebarWidth(loadSidebarWidth());
      }
      if (typeof saveSidebarCollapsed === "function") {
        saveSidebarCollapsed(nextValue);
      }
    }

    function handleSidebarResizeStart(event) {
      if (!sidebar || !sidebarResizer) return;
      if (sidebarCollapsed) return;
      if (event.button !== 0) return;

      isSidebarResizing = true;
      sidebarResizePointerId = event.pointerId;
      sidebarResizeStartX = event.clientX;
      sidebarResizeStartWidth = sidebar.getBoundingClientRect().width;
      sidebarResizer.classList.add("is-dragging");
      sidebarResizer.setPointerCapture(event.pointerId);
      event.preventDefault();
    }

    function getTodoDetailResizerWidth() {
      const width = todoDetailResizer?.getBoundingClientRect?.().width;
      return Number.isFinite(width) && width > 0 ? width : 12;
    }

    function getTodoLayoutWidth() {
      const width = todoLayout?.getBoundingClientRect?.().width;
      if (Number.isFinite(width) && width > 0) return width;
      const innerWidth = Number(windowRef?.innerWidth);
      return Number.isFinite(innerWidth) && innerWidth > 0 ? innerWidth : 0;
    }

    function clampTodoDetailPreference(width) {
      const requestedWidth = Number(width);
      const safeWidth = Number.isFinite(requestedWidth) ? requestedWidth : DEFAULT_TODO_DETAIL_WIDTH;
      return typeof clampTodoDetailWidth === "function"
        ? clampTodoDetailWidth(safeWidth)
        : Math.max(TODO_DETAIL_MIN_WIDTH, Math.min(TODO_DETAIL_MAX_WIDTH, safeWidth));
    }

    function getTodoLayoutMinimumWidth() {
      return TODO_LIST_MIN_WIDTH + TODO_DETAIL_MIN_WIDTH + getTodoDetailResizerWidth();
    }

    function getTodoLayoutAvailableWidth() {
      const layoutWidth = getTodoLayoutWidth();
      const minTotal = getTodoLayoutMinimumWidth();
      const safeLayoutWidth = Number.isFinite(layoutWidth) && layoutWidth > 0
        ? Math.max(minTotal, layoutWidth)
        : minTotal;
      return safeLayoutWidth - getTodoDetailResizerWidth();
    }

    function resetTodoListPreferenceForDetail(detailWidth) {
      const nextWidth = getTodoLayoutAvailableWidth() - detailWidth;
      todoListPreferredWidth = Math.max(TODO_LIST_MIN_WIDTH, nextWidth);
    }

    function calculateTodoColumnWidths() {
      const resizerWidth = getTodoDetailResizerWidth();
      const minTotal = TODO_LIST_MIN_WIDTH + TODO_DETAIL_MIN_WIDTH + resizerWidth;
      const layoutWidth = getTodoLayoutWidth();
      const safeLayoutWidth = Number.isFinite(layoutWidth) && layoutWidth > 0
        ? Math.max(minTotal, layoutWidth)
        : minTotal;
      const availableWidth = safeLayoutWidth - resizerWidth;
      const detailPreferred = clampTodoDetailPreference(todoDetailPreferredWidth);
      const hasListPreference = Number.isFinite(todoListPreferredWidth) && todoListPreferredWidth >= TODO_LIST_MIN_WIDTH;
      let listPreferred = hasListPreference
        ? todoListPreferredWidth
        : Math.max(TODO_LIST_MIN_WIDTH, availableWidth - detailPreferred);
      listPreferred = Math.max(TODO_LIST_MIN_WIDTH, listPreferred);

      let detailWidth = detailPreferred;
      let listWidth = availableWidth - detailWidth;

      if (availableWidth < listPreferred + detailPreferred) {
        listWidth = listPreferred;
        detailWidth = availableWidth - listWidth;
      }

      if (detailWidth < TODO_DETAIL_MIN_WIDTH) {
        detailWidth = TODO_DETAIL_MIN_WIDTH;
        listWidth = availableWidth - detailWidth;
      }

      if (listWidth < TODO_LIST_MIN_WIDTH) {
        listWidth = TODO_LIST_MIN_WIDTH;
        detailWidth = availableWidth - listWidth;
      }

      detailWidth = Math.max(TODO_DETAIL_MIN_WIDTH, Math.min(TODO_DETAIL_MAX_WIDTH, detailWidth));
      listWidth = Math.max(TODO_LIST_MIN_WIDTH, listWidth);

      if (detailWidth >= detailPreferred - 0.5 && listWidth > listPreferred) {
        todoListPreferredWidth = listWidth;
      } else if (!hasListPreference) {
        todoListPreferredWidth = listPreferred;
      }

      return {
        listWidth,
        detailWidth,
        minTotal,
      };
    }

    function syncTodoLayoutWidths() {
      todoLayoutSyncFrame = 0;
      if (!todoLayout) return;
      const { listWidth, detailWidth, minTotal } = calculateTodoColumnWidths();
      todoLayout.style.setProperty("--todo-list-width", `${Math.round(listWidth)}px`);
      todoLayout.style.setProperty("--todo-detail-width", `${Math.round(detailWidth)}px`);
      todoLayout.style.setProperty("--todo-layout-min-width", `${Math.round(minTotal)}px`);
      if (todoDetailResizer) {
        todoDetailResizer.setAttribute("aria-valuemin", String(TODO_DETAIL_MIN_WIDTH));
        todoDetailResizer.setAttribute("aria-valuemax", String(TODO_DETAIL_MAX_WIDTH));
        todoDetailResizer.setAttribute("aria-valuenow", String(Math.round(detailWidth)));
      }
    }

    function scheduleTodoLayoutSync() {
      if (!todoLayout) return;
      if (todoLayoutSyncFrame) return;
      if (windowRef && typeof windowRef.requestAnimationFrame === "function") {
        todoLayoutSyncFrame = windowRef.requestAnimationFrame(syncTodoLayoutWidths);
        return;
      }
      syncTodoLayoutWidths();
    }

    function bindTodoLayoutResizeObserver() {
      if (!todoLayout || todoLayoutResizeObserver) return;
      const ResizeObserverCtor = windowRef?.ResizeObserver || globalScope.ResizeObserver;
      if (typeof ResizeObserverCtor !== "function") return;
      todoLayoutResizeObserver = new ResizeObserverCtor(() => {
        scheduleTodoLayoutSync();
      });
      todoLayoutResizeObserver.observe(todoLayout);
    }

    function getCurrentTodoDetailWidth(fallbackWidth = DEFAULT_TODO_DETAIL_WIDTH) {
      const raw = todoLayout?.style?.getPropertyValue("--todo-detail-width") || "";
      const parsed = Number.parseFloat(raw);
      if (Number.isFinite(parsed)) return parsed;
      return fallbackWidth;
    }

    function applyTodoDetailWidth(width, options = {}) {
      if (!todoLayout) return;
      const clamped = clampTodoDetailPreference(width);
      todoDetailPreferredWidth = clamped;
      if (options.rebalanceList !== false) {
        resetTodoListPreferenceForDetail(clamped);
      }
      syncTodoLayoutWidths();
    }

    function isTodoDetailResizeAvailable() {
      if (!todoLayout || !todoDetailResizer) return false;
      const style = windowRef?.getComputedStyle ? windowRef.getComputedStyle(todoDetailResizer) : null;
      if (style && style.display === "none") return false;
      return getTodoLayoutWidth() >= TODO_LIST_MIN_WIDTH + TODO_DETAIL_MIN_WIDTH + getTodoDetailResizerWidth();
    }

    function handleTodoDetailResizeStart(event) {
      if (!isTodoDetailResizeAvailable()) return;
      if (event.button !== 0) return;

      isTodoDetailResizing = true;
      todoDetailResizePointerId = event.pointerId;
      todoDetailResizeStartX = event.clientX;
      todoDetailResizeStartWidth = getCurrentTodoDetailWidth(
        typeof loadTodoDetailWidth === "function" ? loadTodoDetailWidth() : 430,
      );
      todoDetailResizer.classList.add("is-dragging");
      todoLayout.classList.add("is-resizing");
      getInteractionClassTarget()?.classList.add("is-todo-detail-resizing");
      todoDetailResizer.setPointerCapture(event.pointerId);
      event.preventDefault();
    }

    function handleTodoDetailResizeMove(event) {
      if (!isTodoDetailResizing) return;
      if (event.pointerId !== todoDetailResizePointerId) return;
      const delta = event.clientX - todoDetailResizeStartX;
      applyTodoDetailWidth(todoDetailResizeStartWidth - delta);
    }

    function handleTodoDetailResizeEnd(event) {
      if (!isTodoDetailResizing) return;
      if (event.pointerId !== todoDetailResizePointerId) return;

      isTodoDetailResizing = false;
      todoDetailResizePointerId = null;
      if (todoDetailResizer) {
        todoDetailResizer.classList.remove("is-dragging");
        if (typeof todoDetailResizer.releasePointerCapture === "function") {
          try {
            todoDetailResizer.releasePointerCapture(event.pointerId);
          } catch {
            // ignore release errors
          }
        }
      }
      todoLayout?.classList.remove("is-resizing");
      getInteractionClassTarget()?.classList.remove("is-todo-detail-resizing");

      const width = getCurrentTodoDetailWidth(typeof loadTodoDetailWidth === "function" ? loadTodoDetailWidth() : 430);
      if (typeof saveTodoDetailWidth === "function") {
        saveTodoDetailWidth(width);
      }
    }

    function handleTodoDetailResizeKeydown(event) {
      if (!isTodoDetailResizeAvailable()) return;
      let nextWidth = null;
      const currentWidth = getCurrentTodoDetailWidth(
        typeof loadTodoDetailWidth === "function" ? loadTodoDetailWidth() : 430,
      );
      if (event.key === "ArrowLeft") {
        nextWidth = currentWidth + 24;
      } else if (event.key === "ArrowRight") {
        nextWidth = currentWidth - 24;
      } else if (event.key === "Home") {
        nextWidth = TODO_DETAIL_MAX_WIDTH;
      } else if (event.key === "End") {
        nextWidth = TODO_DETAIL_MIN_WIDTH;
      }
      if (nextWidth === null) return;
      applyTodoDetailWidth(nextWidth);
      if (typeof saveTodoDetailWidth === "function") {
        saveTodoDetailWidth(getCurrentTodoDetailWidth(nextWidth));
      }
      event.preventDefault();
    }

    function handleSidebarResizeMove(event) {
      if (!isSidebarResizing) return;
      if (event.pointerId !== sidebarResizePointerId) return;
      const delta = event.clientX - sidebarResizeStartX;
      applySidebarWidth(sidebarResizeStartWidth + delta);
    }

    function handleSidebarResizeEnd(event) {
      if (!isSidebarResizing) return;
      if (event.pointerId !== sidebarResizePointerId) return;

      isSidebarResizing = false;
      sidebarResizePointerId = null;
      if (sidebarResizer) {
        sidebarResizer.classList.remove("is-dragging");
        if (typeof sidebarResizer.releasePointerCapture === "function") {
          try {
            sidebarResizer.releasePointerCapture(event.pointerId);
          } catch {
            // ignore release errors
          }
        }
      }

      const width = sidebar ? sidebar.getBoundingClientRect().width : 288;
      if (typeof saveSidebarWidth === "function") {
        saveSidebarWidth(width);
      }
    }

    function scheduleFirstScreenPanelFit() {
      if (!firstScreenPanels.length) return;
      resetFirstScreenPanelFit();
    }

    function resetFirstScreenPanelFit() {
      for (const panel of firstScreenPanels) {
        panel.style.height = "";
        panel.style.overflowY = "";
        panel.style.overflowX = "";
        panel.style.scrollbarGutter = "";
      }
    }

    function canScrollInDirection(scroller, deltaY) {
      const maxScrollTop = scroller.scrollHeight - scroller.clientHeight;
      if (maxScrollTop <= 1) return false;
      if (deltaY > 0) return scroller.scrollTop < maxScrollTop - 1;
      if (deltaY < 0) return scroller.scrollTop > 1;
      return false;
    }

    function findVerticalScroller(startNode) {
      let node = startNode;
      while (node && isElement(node)) {
        const style = windowRef.getComputedStyle(node);
        const overflowY = style.overflowY;
        const canContainScroll = overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay";
        if (canContainScroll && node.scrollHeight - node.clientHeight > 1) {
          return node;
        }
        node = node.parentElement;
      }
      return null;
    }

    function isRootBounceAtBoundary(event) {
      if (event.ctrlKey || Math.abs(event.deltaY) < 1) return false;
      if (!isElement(event.target)) return false;

      const scroller = findVerticalScroller(event.target);
      if (scroller && canScrollInDirection(scroller, event.deltaY)) {
        return false;
      }

      const documentElement = documentRef?.documentElement;
      if (!documentElement) return false;

      const maxRootScroll = Math.max(0, documentElement.scrollHeight - windowRef.innerHeight);
      const atTop = windowRef.scrollY <= 0;
      const atBottom = windowRef.scrollY >= maxRootScroll - 1;

      return (event.deltaY < 0 && atTop) || (event.deltaY > 0 && atBottom);
    }

    function bindHardScreenSnap() {
      if (!recordsPanel || !windowRef || typeof windowRef.addEventListener !== "function") return;

      windowRef.addEventListener(
        "wheel",
        (event) => {
          if (event.ctrlKey) return;

          if (isRootBounceAtBoundary(event)) {
            event.preventDefault();
            return;
          }

          if (Math.abs(event.deltaY) < 28) return;

          const listTarget = isElement(event.target) ? event.target.closest("#calendar-scroll") : null;
          if (!event.defaultPrevented && listTarget && canScrollInDirection(listTarget, event.deltaY)) {
            return;
          }

          if (isHardSnapping) {
            event.preventDefault();
            return;
          }

          const targetTop = recordsPanel.getBoundingClientRect().top + windowRef.scrollY;
          const snappedTop = Math.max(0, targetTop - HARD_SNAP_GUTTER);
          const currentTop = windowRef.scrollY;
          const tolerance = 24;

          if (event.deltaY > 0 && currentTop < snappedTop - tolerance) {
            event.preventDefault();
            hardSnapTo(snappedTop);
            return;
          }

          if (event.deltaY < 0 && Math.abs(currentTop - snappedTop) <= tolerance) {
            event.preventDefault();
            hardSnapTo(0);
          }
        },
        { passive: false },
      );
    }

    function hardSnapTo(top) {
      isHardSnapping = true;
      windowRef.scrollTo({ top, behavior: "smooth" });

      if (hardSnapLockTimer) {
        windowRef.clearTimeout(hardSnapLockTimer);
      }

      hardSnapLockTimer = windowRef.setTimeout(() => {
        isHardSnapping = false;
        hardSnapLockTimer = 0;
      }, 340);
    }

    return {
      init,
      bindEvents,
      applySidebarWidth,
      applySidebarCollapsed,
      applyTodoDetailWidth,
      syncTodoLayout: scheduleTodoLayoutSync,
      scheduleFirstScreenPanelFit,
      resetFirstScreenPanelFit,
      bindHardScreenSnap,
    };
  }

  globalScope.TimeQualityLayoutShellModule = {
    createLayoutShellModule,
  };
})(typeof window !== "undefined" ? window : globalThis);
