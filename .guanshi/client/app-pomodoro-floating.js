/* global window */

(function attachTimeQualityPomodoroFloatingModule(globalScope) {
  "use strict";

  function toFiniteNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function createPomodoroFloatingModule(deps = {}) {
    const {
      documentRef = globalScope.document || null,
      windowRef = globalScope.window || globalScope,
      localStorageRef = globalScope.localStorage || null,
      storageKey = "time_quality_pomodoro_float_layout_v1",
      panel = null,
      handle = null,
      collapseButton = null,
      summary = null,
      pomodoroDisplay = null,
      viewportGutter = 12,
      defaultTop = 58,
      collapsedTop = 4,
      collapsedRight = 14,
      collapsedWidth = 210,
      keyboardStep = 12,
      requestAnimationFrameFn =
        typeof windowRef?.requestAnimationFrame === "function"
          ? windowRef.requestAnimationFrame.bind(windowRef)
          : (callback) => callback(),
      setTimeoutFn =
        typeof windowRef?.setTimeout === "function"
          ? windowRef.setTimeout.bind(windowRef)
          : globalScope.setTimeout.bind(globalScope),
      clearTimeoutFn =
        typeof windowRef?.clearTimeout === "function"
          ? windowRef.clearTimeout.bind(windowRef)
          : globalScope.clearTimeout.bind(globalScope),
    } = deps;

    let initialized = false;
    let eventsBound = false;
    let x = 0;
    let y = 0;
    let expandedX = null;
    let expandedY = null;
    let collapsed = false;
    let pointerId = null;
    let dragStartClientX = 0;
    let dragStartClientY = 0;
    let dragStartX = 0;
    let dragStartY = 0;
    let dragMoved = false;
    let clampFramePending = false;
    let attentionTimer = 0;
    let summaryObserver = null;

    function getInteractionClassTarget() {
      return documentRef?.body || documentRef?.documentElement || null;
    }

    function getViewportSize() {
      const viewport = windowRef?.visualViewport || null;
      const width = toFiniteNumber(
        viewport?.width,
        toFiniteNumber(windowRef?.innerWidth, toFiniteNumber(documentRef?.documentElement?.clientWidth, 0)),
      );
      const height = toFiniteNumber(
        viewport?.height,
        toFiniteNumber(windowRef?.innerHeight, toFiniteNumber(documentRef?.documentElement?.clientHeight, 0)),
      );
      return { width: Math.max(0, width), height: Math.max(0, height) };
    }

    function getPanelSize() {
      const rect = panel?.getBoundingClientRect?.() || {};
      const width = toFiniteNumber(
        rect.width,
        toFiniteNumber(panel?.offsetWidth, collapsed ? collapsedWidth : 340),
      );
      const height = toFiniteNumber(rect.height, toFiniteNumber(panel?.offsetHeight, collapsed ? 42 : 250));
      return {
        width: Math.max(1, width),
        height: Math.max(1, height),
      };
    }

    function clampPosition(nextX, nextY, options = {}) {
      const gutter = Math.max(0, toFiniteNumber(viewportGutter, 12));
      const minY = options.allowTopEdge || collapsed ? 0 : gutter;
      const viewport = getViewportSize();
      const measuredSize = getPanelSize();
      const size = {
        width: Math.max(1, toFiniteNumber(options.panelWidth, measuredSize.width)),
        height: Math.max(1, toFiniteNumber(options.panelHeight, measuredSize.height)),
      };
      const maxX = Math.max(gutter, viewport.width - size.width - gutter);
      const maxY = Math.max(minY, viewport.height - size.height - gutter);
      return {
        x: Math.min(maxX, Math.max(gutter, toFiniteNumber(nextX, gutter))),
        y: Math.min(maxY, Math.max(minY, toFiniteNumber(nextY, minY))),
      };
    }

    function writePosition() {
      if (!panel?.style) return;
      const renderedX = Math.round(x * 100) / 100;
      const renderedY = Math.round(y * 100) / 100;
      panel.style.setProperty?.("--pomodoro-float-x", `${renderedX}px`);
      panel.style.setProperty?.("--pomodoro-float-y", `${renderedY}px`);
      if (typeof panel.style.setProperty !== "function") {
        panel.style.transform = `translate3d(${renderedX}px, ${renderedY}px, 0)`;
      }
    }

    function applyPosition(nextX, nextY, options = {}) {
      const clamped = clampPosition(nextX, nextY, options);
      x = clamped.x;
      y = clamped.y;
      if (!collapsed && options.trackExpanded !== false) {
        expandedX = x;
        expandedY = y;
      }
      writePosition();
      if (options.persist) saveLayout();
      return { x, y };
    }

    function getDefaultPosition() {
      const gutter = Math.max(0, toFiniteNumber(viewportGutter, 12));
      const viewport = getViewportSize();
      const size = getPanelSize();
      return clampPosition(
        Math.max(gutter, viewport.width - size.width - 18),
        Math.max(gutter, toFiniteNumber(defaultTop, 58)),
      );
    }

    function getCollapsedDockPosition() {
      const gutter = Math.max(0, toFiniteNumber(viewportGutter, 12));
      const rightInset = Math.max(0, toFiniteNumber(collapsedRight, 14));
      const viewport = getViewportSize();
      const dockWidth = Math.min(
        Math.max(1, toFiniteNumber(collapsedWidth, 210)),
        Math.max(1, viewport.width - gutter - rightInset),
      );
      const size = getPanelSize();
      const maxY = Math.max(0, viewport.height - size.height - gutter);
      const alignedControlRect = documentRef
        ?.querySelector?.(".top-search")
        ?.getBoundingClientRect?.();
      const alignedTop = Number.isFinite(Number(alignedControlRect?.top))
        ? Number(alignedControlRect.top)
        : Math.max(0, toFiniteNumber(collapsedTop, 4));
      return {
        x: Math.max(gutter, viewport.width - dockWidth - rightInset),
        y: Math.min(maxY, Math.max(0, alignedTop)),
      };
    }

    function normalizeStoredLayout(value) {
      if (!value || typeof value !== "object") return null;
      const storedX = Number(value.x);
      const storedY = Number(value.y);
      if (!Number.isFinite(storedX) || !Number.isFinite(storedY)) return null;
      return {
        x: storedX,
        y: storedY,
        collapsed: Boolean(value.collapsed),
        expandedX: Number.isFinite(Number(value.expandedX)) ? Number(value.expandedX) : storedX,
        expandedY: Number.isFinite(Number(value.expandedY)) ? Number(value.expandedY) : storedY,
      };
    }

    function loadLayout() {
      if (!localStorageRef || !storageKey) return null;
      try {
        const raw = localStorageRef.getItem(storageKey);
        if (!raw) return null;
        return normalizeStoredLayout(JSON.parse(raw));
      } catch {
        return null;
      }
    }

    function saveLayout() {
      if (!localStorageRef || !storageKey) return false;
      try {
        localStorageRef.setItem(storageKey, JSON.stringify({
          x: Math.round(x),
          y: Math.round(y),
          collapsed,
          expandedX: Math.round(toFiniteNumber(expandedX, x)),
          expandedY: Math.round(toFiniteNumber(expandedY, y)),
        }));
        return true;
      } catch {
        return false;
      }
    }

    function syncSummary() {
      if (!summary) return;
      summary.textContent = String(pomodoroDisplay?.textContent || "25:00").trim() || "25:00";
    }

    function applyCollapsed(nextCollapsed, options = {}) {
      const wasCollapsed = collapsed;
      if (initialized && !wasCollapsed && nextCollapsed) {
        expandedX = x;
        expandedY = y;
      }
      collapsed = Boolean(nextCollapsed);
      panel?.classList?.toggle("is-collapsed", collapsed);
      if (collapseButton) {
        const label = collapsed ? "展开番茄钟" : "收起番茄钟";
        collapseButton.setAttribute?.("aria-label", label);
        collapseButton.setAttribute?.("aria-expanded", collapsed ? "false" : "true");
        collapseButton.title = label;
      }
      summary?.setAttribute?.("aria-hidden", collapsed ? "false" : "true");
      syncSummary();
      if (initialized) {
        scheduleClamp({
          persist: Boolean(options.persist),
          restoreExpanded: wasCollapsed && !collapsed,
        });
      }
      if (options.persist) saveLayout();
      return collapsed;
    }

    function scheduleClamp(options = {}) {
      if (clampFramePending) return;
      clampFramePending = true;
      requestAnimationFrameFn(() => {
        clampFramePending = false;
        if (collapsed) {
          const dock = getCollapsedDockPosition();
          applyPosition(dock.x, dock.y, {
            allowTopEdge: true,
            panelWidth: collapsedWidth,
            persist: Boolean(options.persist),
            trackExpanded: false,
          });
          return;
        }
        if (options.restoreExpanded) {
          const fallback = getDefaultPosition();
          applyPosition(
            Number.isFinite(expandedX) ? expandedX : fallback.x,
            Number.isFinite(expandedY) ? expandedY : fallback.y,
            { persist: Boolean(options.persist) },
          );
          return;
        }
        applyPosition(x, y, { persist: Boolean(options.persist) });
      });
    }

    function init() {
      if (initialized || !panel) return false;
      const stored = loadLayout();
      expandedX = stored?.expandedX ?? null;
      expandedY = stored?.expandedY ?? null;
      applyCollapsed(stored?.collapsed || false);
      if (collapsed) {
        const dock = getCollapsedDockPosition();
        applyPosition(dock.x, dock.y, {
          allowTopEdge: true,
          panelWidth: collapsedWidth,
          trackExpanded: false,
        });
      } else {
        const initial = stored || getDefaultPosition();
        applyPosition(initial.x, initial.y);
      }
      panel.classList?.add("is-ready");
      initialized = true;
      syncSummary();
      return true;
    }

    function isInteractiveTarget(target) {
      if (!target || target === handle) return false;
      if (typeof target.closest !== "function") return false;
      return Boolean(target.closest("button, input, select, textarea, a, [contenteditable='true']"));
    }

    function handlePointerDown(event) {
      if (!panel || !handle || event?.button !== 0 || pointerId !== null) return;
      if (isInteractiveTarget(event.target)) return;
      pointerId = event.pointerId;
      dragStartClientX = toFiniteNumber(event.clientX, 0);
      dragStartClientY = toFiniteNumber(event.clientY, 0);
      dragStartX = x;
      dragStartY = y;
      dragMoved = false;
      panel.classList?.add("is-dragging");
      getInteractionClassTarget()?.classList?.add("is-pomodoro-floating-dragging");
      try {
        handle.setPointerCapture?.(event.pointerId);
      } catch {
        // Pointer capture can fail when the pointer already ended.
      }
      event.preventDefault?.();
    }

    function handlePointerMove(event) {
      if (pointerId === null || event?.pointerId !== pointerId) return;
      const deltaX = toFiniteNumber(event.clientX, dragStartClientX) - dragStartClientX;
      const deltaY = toFiniteNumber(event.clientY, dragStartClientY) - dragStartClientY;
      dragMoved = dragMoved || Math.abs(deltaX) >= 1 || Math.abs(deltaY) >= 1;
      applyPosition(dragStartX + deltaX, dragStartY + deltaY);
      event.preventDefault?.();
    }

    function finishPointerDrag(event) {
      if (pointerId === null || event?.pointerId !== pointerId) return;
      const releasedPointerId = pointerId;
      pointerId = null;
      panel?.classList?.remove("is-dragging");
      getInteractionClassTarget()?.classList?.remove("is-pomodoro-floating-dragging");
      try {
        handle?.releasePointerCapture?.(releasedPointerId);
      } catch {
        // Ignore release errors from canceled pointers.
      }
      if (dragMoved) saveLayout();
      dragMoved = false;
    }

    function handleKeydown(event) {
      if (!handle || event?.target !== handle) return;
      const step = event.shiftKey ? Math.max(24, keyboardStep * 3) : keyboardStep;
      let nextX = x;
      let nextY = y;
      if (event.key === "ArrowLeft") nextX -= step;
      else if (event.key === "ArrowRight") nextX += step;
      else if (event.key === "ArrowUp") nextY -= step;
      else if (event.key === "ArrowDown") nextY += step;
      else return;
      applyPosition(nextX, nextY, { persist: true });
      event.preventDefault?.();
    }

    function toggleCollapsed() {
      applyCollapsed(!collapsed, { persist: true });
    }

    function reveal() {
      applyCollapsed(false, { persist: true });
      panel?.classList?.remove("is-attention");
      void panel?.offsetWidth;
      panel?.classList?.add("is-attention");
      if (attentionTimer) clearTimeoutFn(attentionTimer);
      attentionTimer = setTimeoutFn(() => {
        attentionTimer = 0;
        panel?.classList?.remove("is-attention");
      }, 900);
    }

    function bindSummaryObserver() {
      const MutationObserverCtor = windowRef?.MutationObserver || globalScope.MutationObserver;
      if (!pomodoroDisplay || typeof MutationObserverCtor !== "function" || summaryObserver) return;
      summaryObserver = new MutationObserverCtor(syncSummary);
      summaryObserver.observe(pomodoroDisplay, { childList: true, subtree: true, characterData: true });
    }

    function bindEvents() {
      if (eventsBound || !panel) return false;
      eventsBound = true;
      handle?.addEventListener?.("pointerdown", handlePointerDown);
      handle?.addEventListener?.("keydown", handleKeydown);
      collapseButton?.addEventListener?.("click", toggleCollapsed);
      windowRef?.addEventListener?.("pointermove", handlePointerMove);
      windowRef?.addEventListener?.("pointerup", finishPointerDrag);
      windowRef?.addEventListener?.("pointercancel", finishPointerDrag);
      windowRef?.addEventListener?.("resize", scheduleClamp);
      windowRef?.visualViewport?.addEventListener?.("resize", scheduleClamp);
      bindSummaryObserver();
      return true;
    }

    function getState() {
      return {
        x,
        y,
        collapsed,
        dragging: pointerId !== null,
      };
    }

    return {
      init,
      bindEvents,
      reveal,
      applyPosition,
      applyCollapsed,
      clampPosition,
      getState,
      loadLayout,
      saveLayout,
      syncSummary,
    };
  }

  globalScope.TimeQualityPomodoroFloatingModule = { createPomodoroFloatingModule };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = globalScope.TimeQualityPomodoroFloatingModule;
  }
})(typeof window !== "undefined" ? window : globalThis);
