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
      HARD_SNAP_GUTTER = 0,
      loadSidebarWidth,
      saveSidebarWidth,
      clampSidebarWidth,
    } = deps;

    const ElementCtor = windowRef?.Element || globalScope.Element;

    let hardSnapLockTimer = 0;
    let isHardSnapping = false;
    let isSidebarResizing = false;
    let sidebarResizePointerId = null;
    let sidebarResizeStartX = 0;
    let sidebarResizeStartWidth = 0;
    let eventsBound = false;

    function isElement(value) {
      return typeof ElementCtor === "function" && value instanceof ElementCtor;
    }

    function init() {
      if (typeof loadSidebarWidth !== "function") return;
      applySidebarWidth(loadSidebarWidth());
    }

    function bindEvents() {
      if (eventsBound) return;
      eventsBound = true;

      if (windowRef && typeof windowRef.addEventListener === "function") {
        windowRef.addEventListener("resize", scheduleFirstScreenPanelFit);
        windowRef.addEventListener("pointermove", handleSidebarResizeMove);
        windowRef.addEventListener("pointerup", handleSidebarResizeEnd);
        windowRef.addEventListener("pointercancel", handleSidebarResizeEnd);
      }

      if (sidebarResizer) {
        sidebarResizer.addEventListener("pointerdown", handleSidebarResizeStart);
      }
    }

    function applySidebarWidth(width) {
      if (!documentRef?.documentElement || typeof clampSidebarWidth !== "function") return;
      const clamped = clampSidebarWidth(width);
      documentRef.documentElement.style.setProperty("--sidebar-width", `${clamped}px`);
    }

    function handleSidebarResizeStart(event) {
      if (!sidebar || !sidebarResizer) return;
      if (event.button !== 0) return;

      isSidebarResizing = true;
      sidebarResizePointerId = event.pointerId;
      sidebarResizeStartX = event.clientX;
      sidebarResizeStartWidth = sidebar.getBoundingClientRect().width;
      sidebarResizer.classList.add("is-dragging");
      sidebarResizer.setPointerCapture(event.pointerId);
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
      scheduleFirstScreenPanelFit,
      resetFirstScreenPanelFit,
      bindHardScreenSnap,
    };
  }

  globalScope.TimeQualityLayoutShellModule = {
    createLayoutShellModule,
  };
})(typeof window !== "undefined" ? window : globalThis);
