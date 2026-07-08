(function attachTimeQualityScoreWheelModule(globalScope) {
  if (!globalScope) return;

  function toNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function createScoreWheelModule(deps = {}) {
    const DEFAULT_SCORE = toNumber(deps.DEFAULT_SCORE, 7);
    const SCORE_INPUT_WHEEL_PIXEL_THRESHOLD = toNumber(deps.SCORE_INPUT_WHEEL_PIXEL_THRESHOLD, 60);
    const SCORE_INPUT_WHEEL_LINE_THRESHOLD = toNumber(deps.SCORE_INPUT_WHEEL_LINE_THRESHOLD, 3);
    const SCORE_INPUT_WHEEL_RESET_MS = toNumber(deps.SCORE_INPUT_WHEEL_RESET_MS, 220);
    const SCORE_WHEEL_ITEM_SPACING_PX = toNumber(deps.SCORE_WHEEL_ITEM_SPACING_PX, 25.5);
    const SCORE_WHEEL_DRAG_STEP_PX = toNumber(deps.SCORE_WHEEL_DRAG_STEP_PX, 12);
    const SCORE_WHEEL_SCROLL_THRESHOLD_PX = toNumber(deps.SCORE_WHEEL_SCROLL_THRESHOLD_PX, 14);
    const SCORE_WHEEL_ITEM_VISIBLE_RADIUS = toNumber(deps.SCORE_WHEEL_ITEM_VISIBLE_RADIUS, 3);
    const SCORE_WHEEL_INERTIA_MIN_VELOCITY = toNumber(deps.SCORE_WHEEL_INERTIA_MIN_VELOCITY, 0.045);
    const SCORE_WHEEL_INERTIA_FRICTION_PER_FRAME = toNumber(deps.SCORE_WHEEL_INERTIA_FRICTION_PER_FRAME, 0.9);
    const SCORE_WHEEL_INERTIA_MAX_DT_MS = toNumber(deps.SCORE_WHEEL_INERTIA_MAX_DT_MS, 34);
    const SCORE_WHEEL_MAX_BOUNCES = toNumber(deps.SCORE_WHEEL_MAX_BOUNCES, 1);
    const SCORE_WHEEL_BOUNCE_CLASS_HOLD_MS = toNumber(deps.SCORE_WHEEL_BOUNCE_CLASS_HOLD_MS, 190);

    const documentRef = deps.documentRef || globalScope.document || null;
    const windowRef = deps.windowRef || globalScope.window || globalScope;
    const scoreWheelPopover = deps.scoreWheelPopover || null;
    const scoreWheelTrack = deps.scoreWheelTrack || null;
    const EventCtor = deps.EventCtor || globalScope.Event;
    const requestAnimationFrameFn =
      typeof deps.requestAnimationFrameFn === "function"
        ? deps.requestAnimationFrameFn
        : typeof windowRef.requestAnimationFrame === "function"
          ? windowRef.requestAnimationFrame.bind(windowRef)
          : (callback) => windowRef.setTimeout(callback, 16);
    const cancelAnimationFrameFn =
      typeof deps.cancelAnimationFrameFn === "function"
        ? deps.cancelAnimationFrameFn
        : typeof windowRef.cancelAnimationFrame === "function"
          ? windowRef.cancelAnimationFrame.bind(windowRef)
          : (id) => windowRef.clearTimeout(id);
    const setTimeoutFn =
      typeof deps.setTimeoutFn === "function"
        ? deps.setTimeoutFn
        : typeof windowRef.setTimeout === "function"
          ? windowRef.setTimeout.bind(windowRef)
          : globalScope.setTimeout.bind(globalScope);
    const clearTimeoutFn =
      typeof deps.clearTimeoutFn === "function"
        ? deps.clearTimeoutFn
        : typeof windowRef.clearTimeout === "function"
          ? windowRef.clearTimeout.bind(windowRef)
          : globalScope.clearTimeout.bind(globalScope);

    const scoreInputWheelState = new WeakMap();
    const boundInputs = new WeakSet();
    let globalEventsBound = false;
    const scoreWheelPickerState = {
      activeInput: null,
      min: 1,
      max: 10,
      value: DEFAULT_SCORE,
      dragPointerId: null,
      dragStartY: 0,
      dragStartValue: DEFAULT_SCORE,
      dragLastY: 0,
      dragLastTime: 0,
      dragVelocityY: 0,
      accumulatedWheelDelta: 0,
      inertiaRafId: 0,
      inertiaLastTime: 0,
      inertiaVelocityY: 0,
      inertiaBounceCount: 0,
      bounceClassTimer: 0,
    };

    function isNumberInput(input) {
      return (
        typeof globalScope.HTMLInputElement !== "undefined" &&
        input instanceof globalScope.HTMLInputElement &&
        input.type === "number"
      );
    }

    function isHtmlElement(node) {
      return typeof globalScope.HTMLElement !== "undefined" && node instanceof globalScope.HTMLElement;
    }

    function isElement(node) {
      return typeof globalScope.Element !== "undefined" && node instanceof globalScope.Element;
    }

    function isNode(node) {
      return typeof globalScope.Node !== "undefined" && node instanceof globalScope.Node;
    }

    function getNow() {
      if (typeof deps.nowFn === "function") return deps.nowFn();
      if (windowRef.performance && typeof windowRef.performance.now === "function") {
        return windowRef.performance.now();
      }
      return Date.now();
    }

    function dispatchInputEvent(input, type) {
      if (typeof EventCtor !== "function") return;
      input.dispatchEvent(new EventCtor(type, { bubbles: true }));
    }

    function bindScoreInputWheelControl(input) {
      if (!isNumberInput(input)) return;

      input.addEventListener(
        "wheel",
        (event) => {
          if (event.ctrlKey || event.metaKey || event.altKey) return;

          const rawValue = Number.parseInt(String(input.value || ""), 10);
          if (!Number.isFinite(rawValue)) return;

          const parsedStep = Number.parseFloat(String(input.step || ""));
          const step = Number.isFinite(parsedStep) && parsedStep > 0 ? parsedStep : 1;
          const parsedMin = Number.parseFloat(String(input.min || ""));
          const parsedMax = Number.parseFloat(String(input.max || ""));
          const min = Number.isFinite(parsedMin) ? parsedMin : -Infinity;
          const max = Number.isFinite(parsedMax) ? parsedMax : Infinity;
          const threshold =
            event.deltaMode === 1 ? SCORE_INPUT_WHEEL_LINE_THRESHOLD : SCORE_INPUT_WHEEL_PIXEL_THRESHOLD;

          const prevState = scoreInputWheelState.get(input);
          const state = prevState ? { ...prevState } : { accumulatedDelta: 0, lastTime: 0 };
          const now = getNow();

          if (now - state.lastTime > SCORE_INPUT_WHEEL_RESET_MS) {
            state.accumulatedDelta = 0;
          }
          state.lastTime = now;
          state.accumulatedDelta += event.deltaY;

          let steps = 0;
          while (state.accumulatedDelta >= threshold) {
            steps += 1;
            state.accumulatedDelta -= threshold;
          }
          while (state.accumulatedDelta <= -threshold) {
            steps -= 1;
            state.accumulatedDelta += threshold;
          }

          scoreInputWheelState.set(input, state);
          event.preventDefault();
          if (steps === 0) return;

          const nextValue = Math.max(min, Math.min(max, rawValue - steps * step));
          if (!Number.isFinite(nextValue) || nextValue === rawValue) return;

          input.value = Number.isInteger(step) ? String(Math.round(nextValue)) : String(nextValue);
          dispatchInputEvent(input, "input");
          dispatchInputEvent(input, "change");
        },
        { passive: false },
      );
    }

    function bindScoreWheelPicker(input) {
      if (!isNumberInput(input)) return;

      const openPicker = () => {
        if (input.disabled || input.readOnly) return;
        openScoreWheelPopoverForInput(input);
      };

      input.addEventListener("focus", openPicker);
      input.addEventListener("click", openPicker);
      input.addEventListener("input", () => {
        if (scoreWheelPickerState.activeInput !== input) return;
        const parsed = Number.parseInt(String(input.value || ""), 10);
        if (!Number.isInteger(parsed)) return;
        setScoreWheelValue(parsed, { emitInputEvent: false, emitChangeEvent: false, fromInput: true });
      });
    }

    function isScoreWheelPopoverOpen() {
      return Boolean(scoreWheelPopover && !scoreWheelPopover.hidden && scoreWheelPickerState.activeInput);
    }

    function openScoreWheelPopoverForInput(input) {
      if (!isNumberInput(input) || !scoreWheelPopover || !scoreWheelTrack) return;

      const parsedMin = Number.parseInt(String(input.min || ""), 10);
      const parsedMax = Number.parseInt(String(input.max || ""), 10);
      const min = Number.isInteger(parsedMin) ? parsedMin : 1;
      const max = Number.isInteger(parsedMax) ? parsedMax : 10;
      const parsedValue = Number.parseInt(String(input.value || ""), 10);
      const value = Number.isInteger(parsedValue) ? parsedValue : DEFAULT_SCORE;
      const normalizedValue = Math.max(min, Math.min(max, value));

      const previousInput = scoreWheelPickerState.activeInput;
      if (isNumberInput(previousInput) && previousInput !== input) {
        previousInput.classList.remove("is-wheel-open");
      }

      scoreWheelPickerState.activeInput = input;
      scoreWheelPickerState.min = min;
      scoreWheelPickerState.max = max;
      scoreWheelPickerState.value = normalizedValue;
      scoreWheelPickerState.accumulatedWheelDelta = 0;
      scoreWheelPickerState.dragPointerId = null;
      scoreWheelPickerState.dragVelocityY = 0;
      stopScoreWheelInertia();
      clearScoreWheelBounceClass();
      input.classList.add("is-wheel-open");

      scoreWheelPopover.hidden = false;
      scoreWheelPopover.setAttribute("aria-hidden", "false");
      renderScoreWheelPopover();
      positionScoreWheelPopover(input);

      requestAnimationFrameFn(() => {
        if (!isScoreWheelPopoverOpen()) return;
        scoreWheelPopover.classList.add("is-visible");
      });
    }

    function closeScoreWheelPopover({ keepInputFocus = true } = {}) {
      if (!scoreWheelPopover) return;
      stopScoreWheelInertia();
      clearScoreWheelBounceClass();

      const input = scoreWheelPickerState.activeInput;
      if (isNumberInput(input)) {
        input.classList.remove("is-wheel-open");
        if (!keepInputFocus && documentRef && documentRef.activeElement === input) {
          input.blur();
        }
      }

      scoreWheelPickerState.activeInput = null;
      scoreWheelPickerState.dragPointerId = null;
      scoreWheelPickerState.dragVelocityY = 0;
      scoreWheelPickerState.accumulatedWheelDelta = 0;
      scoreWheelPopover.classList.remove("is-visible", "is-dragging");
      scoreWheelPopover.hidden = true;
      scoreWheelPopover.setAttribute("aria-hidden", "true");
      if (scoreWheelTrack) {
        scoreWheelTrack.textContent = "";
      }
    }

    function positionScoreWheelPopover(input) {
      if (!isHtmlElement(input) || !scoreWheelPopover) return;
      const rect = input.getBoundingClientRect();
      const width = scoreWheelPopover.offsetWidth || 66;
      const height = scoreWheelPopover.offsetHeight || 99;
      const gap = 10;
      const viewportPadding = 8;
      const viewportWidth = toNumber(windowRef.innerWidth, 1024);
      const viewportHeight = toNumber(windowRef.innerHeight, 768);

      let left = rect.left;
      left = Math.max(viewportPadding, Math.min(viewportWidth - width - viewportPadding, left));

      let top = rect.bottom + gap;
      if (top + height > viewportHeight - viewportPadding) {
        top = rect.top - height - gap;
      }
      top = Math.max(viewportPadding, Math.min(viewportHeight - height - viewportPadding, top));

      scoreWheelPopover.style.left = `${Math.round(left)}px`;
      scoreWheelPopover.style.top = `${Math.round(top)}px`;
    }

    function renderScoreWheelPopover() {
      if (!scoreWheelTrack || !isScoreWheelPopoverOpen() || !documentRef) return;

      const { min, max, value } = scoreWheelPickerState;
      scoreWheelTrack.textContent = "";

      for (let option = min; option <= max; option += 1) {
        const distance = option - value;
        const absDistance = Math.abs(distance);

        const item = documentRef.createElement("button");
        item.type = "button";
        item.className = "score-wheel-item";
        item.dataset.value = String(option);
        item.setAttribute("role", "option");
        item.setAttribute("aria-selected", absDistance === 0 ? "true" : "false");
        item.textContent = String(option);

        const translateY = distance * SCORE_WHEEL_ITEM_SPACING_PX;
        const rotateX = -distance * 17;
        const scale = absDistance === 0 ? 1.8 : Math.max(0.62, 1 - absDistance * 0.1);
        const opacity = absDistance > SCORE_WHEEL_ITEM_VISIBLE_RADIUS ? 0 : Math.max(0.08, 1 - absDistance * 0.22);

        item.style.transform = `translate3d(0, ${translateY}px, 0) rotateX(${rotateX}deg) scale(${scale})`;
        item.style.opacity = String(opacity);
        item.style.zIndex = String(40 - absDistance);
        item.style.pointerEvents = absDistance > SCORE_WHEEL_ITEM_VISIBLE_RADIUS ? "none" : "auto";

        if (absDistance === 0) {
          item.classList.add("is-active");
        }

        scoreWheelTrack.appendChild(item);
      }
    }

    function setScoreWheelValue(nextValue, { emitInputEvent = true, emitChangeEvent = true, fromInput = false } = {}) {
      const input = scoreWheelPickerState.activeInput;
      if (!isNumberInput(input)) return;

      const clamped = Math.max(scoreWheelPickerState.min, Math.min(scoreWheelPickerState.max, Math.round(nextValue)));
      const previousValue = scoreWheelPickerState.value;
      const inputValue = Number.parseInt(String(input.value || ""), 10);

      scoreWheelPickerState.value = clamped;
      if (!Number.isInteger(inputValue) || inputValue !== clamped) {
        input.value = String(clamped);
      }

      renderScoreWheelPopover();

      if (fromInput || clamped === previousValue) return;
      if (emitInputEvent) {
        dispatchInputEvent(input, "input");
      }
      if (emitChangeEvent) {
        dispatchInputEvent(input, "change");
      }
    }

    function applyScoreWheelDelta(deltaY, thresholdPx) {
      scoreWheelPickerState.accumulatedWheelDelta += deltaY;

      let steps = 0;
      while (scoreWheelPickerState.accumulatedWheelDelta >= thresholdPx) {
        steps += 1;
        scoreWheelPickerState.accumulatedWheelDelta -= thresholdPx;
      }
      while (scoreWheelPickerState.accumulatedWheelDelta <= -thresholdPx) {
        steps -= 1;
        scoreWheelPickerState.accumulatedWheelDelta += thresholdPx;
      }

      if (steps === 0) {
        return { changed: false, hitBoundary: false };
      }

      const requested = scoreWheelPickerState.value + steps;
      const previous = scoreWheelPickerState.value;
      const hitBoundary = requested < scoreWheelPickerState.min || requested > scoreWheelPickerState.max;
      setScoreWheelValue(requested);
      const changed = scoreWheelPickerState.value !== previous;
      return { changed, hitBoundary };
    }

    function clearScoreWheelBounceClass() {
      if (!scoreWheelPopover) return;
      if (scoreWheelPickerState.bounceClassTimer) {
        clearTimeoutFn(scoreWheelPickerState.bounceClassTimer);
        scoreWheelPickerState.bounceClassTimer = 0;
      }
      scoreWheelPopover.classList.remove("is-bounce-min", "is-bounce-max");
    }

    function triggerScoreWheelBoundaryBounce(direction) {
      if (!scoreWheelPopover) return;
      clearScoreWheelBounceClass();
      scoreWheelPopover.classList.add(direction === "min" ? "is-bounce-min" : "is-bounce-max");
      scoreWheelPickerState.bounceClassTimer = setTimeoutFn(() => {
        if (!scoreWheelPopover) return;
        scoreWheelPopover.classList.remove("is-bounce-min", "is-bounce-max");
        scoreWheelPickerState.bounceClassTimer = 0;
      }, SCORE_WHEEL_BOUNCE_CLASS_HOLD_MS);
    }

    function stopScoreWheelInertia() {
      if (scoreWheelPickerState.inertiaRafId) {
        cancelAnimationFrameFn(scoreWheelPickerState.inertiaRafId);
        scoreWheelPickerState.inertiaRafId = 0;
      }
      scoreWheelPickerState.inertiaLastTime = 0;
      scoreWheelPickerState.inertiaVelocityY = 0;
      scoreWheelPickerState.inertiaBounceCount = 0;
    }

    function stepScoreWheelInertia(timestamp) {
      if (!isScoreWheelPopoverOpen()) {
        stopScoreWheelInertia();
        return;
      }

      const lastTime = scoreWheelPickerState.inertiaLastTime || timestamp;
      const elapsedMs = Math.max(1, timestamp - lastTime);
      const dtMs = Math.min(SCORE_WHEEL_INERTIA_MAX_DT_MS, elapsedMs);
      scoreWheelPickerState.inertiaLastTime = timestamp;

      const result = applyScoreWheelDelta(scoreWheelPickerState.inertiaVelocityY * dtMs, SCORE_WHEEL_DRAG_STEP_PX);

      if (result.hitBoundary) {
        const isMaxSide = scoreWheelPickerState.inertiaVelocityY > 0;
        triggerScoreWheelBoundaryBounce(isMaxSide ? "max" : "min");

        if (scoreWheelPickerState.inertiaBounceCount >= SCORE_WHEEL_MAX_BOUNCES) {
          stopScoreWheelInertia();
          return;
        }

        scoreWheelPickerState.inertiaBounceCount += 1;
        scoreWheelPickerState.inertiaVelocityY *= -0.35;
        scoreWheelPickerState.accumulatedWheelDelta = 0;
      } else {
        const friction = Math.pow(SCORE_WHEEL_INERTIA_FRICTION_PER_FRAME, dtMs / 16.6667);
        scoreWheelPickerState.inertiaVelocityY *= friction;
      }

      if (Math.abs(scoreWheelPickerState.inertiaVelocityY) < SCORE_WHEEL_INERTIA_MIN_VELOCITY) {
        stopScoreWheelInertia();
        return;
      }

      if (!result.changed && !result.hitBoundary) {
        stopScoreWheelInertia();
        return;
      }

      scoreWheelPickerState.inertiaRafId = requestAnimationFrameFn(stepScoreWheelInertia);
    }

    function startScoreWheelInertia(initialVelocityY) {
      if (!isScoreWheelPopoverOpen()) return;
      stopScoreWheelInertia();
      scoreWheelPickerState.inertiaVelocityY = initialVelocityY;
      scoreWheelPickerState.inertiaLastTime = 0;
      scoreWheelPickerState.inertiaBounceCount = 0;
      scoreWheelPickerState.inertiaRafId = requestAnimationFrameFn(stepScoreWheelInertia);
    }

    function handleScoreWheelPopoverWheel(event) {
      if (!isScoreWheelPopoverOpen()) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      event.preventDefault();
      stopScoreWheelInertia();
      const threshold = event.deltaMode === 1 ? 1 : SCORE_WHEEL_SCROLL_THRESHOLD_PX;
      const result = applyScoreWheelDelta(event.deltaY, threshold);
      if (result.hitBoundary) {
        triggerScoreWheelBoundaryBounce(event.deltaY > 0 ? "max" : "min");
      }
    }

    function handleScoreWheelPopoverPointerDown(event) {
      if (!isScoreWheelPopoverOpen()) return;
      if (event.button !== 0) return;
      if (!isElement(event.target) || !event.target.closest(".score-wheel-shell")) return;

      stopScoreWheelInertia();
      scoreWheelPickerState.dragPointerId = event.pointerId;
      scoreWheelPickerState.dragStartY = event.clientY;
      scoreWheelPickerState.dragStartValue = scoreWheelPickerState.value;
      scoreWheelPickerState.dragLastY = event.clientY;
      scoreWheelPickerState.dragLastTime = typeof event.timeStamp === "number" ? event.timeStamp : getNow();
      scoreWheelPickerState.dragVelocityY = 0;
      scoreWheelPickerState.accumulatedWheelDelta = 0;

      if (scoreWheelPopover) {
        scoreWheelPopover.classList.add("is-dragging");
      }
      event.preventDefault();
    }

    function handleScoreWheelPopoverPointerMove(event) {
      if (!isScoreWheelPopoverOpen()) return;
      if (scoreWheelPickerState.dragPointerId !== event.pointerId) return;

      const pointerTime = typeof event.timeStamp === "number" ? event.timeStamp : getNow();
      const dt = Math.max(1, pointerTime - scoreWheelPickerState.dragLastTime);
      const deltaSinceLast = event.clientY - scoreWheelPickerState.dragLastY;
      const instantVelocity = deltaSinceLast / dt;
      scoreWheelPickerState.dragVelocityY = scoreWheelPickerState.dragVelocityY * 0.62 + instantVelocity * 0.38;
      scoreWheelPickerState.dragLastY = event.clientY;
      scoreWheelPickerState.dragLastTime = pointerTime;

      const result = applyScoreWheelDelta(deltaSinceLast, SCORE_WHEEL_DRAG_STEP_PX);
      if (result.hitBoundary) {
        triggerScoreWheelBoundaryBounce(deltaSinceLast > 0 ? "max" : "min");
      }
      event.preventDefault();
    }

    function handleScoreWheelPopoverPointerUp(event) {
      if (scoreWheelPickerState.dragPointerId !== event.pointerId) return;
      scoreWheelPickerState.dragPointerId = null;

      const releaseVelocity = scoreWheelPickerState.dragVelocityY;
      scoreWheelPickerState.dragVelocityY = 0;
      scoreWheelPickerState.dragLastY = 0;
      scoreWheelPickerState.dragLastTime = 0;

      if (scoreWheelPopover) {
        scoreWheelPopover.classList.remove("is-dragging");
      }

      if (Math.abs(releaseVelocity) >= SCORE_WHEEL_INERTIA_MIN_VELOCITY) {
        startScoreWheelInertia(releaseVelocity);
      }
    }

    function handleScoreWheelPopoverPointerCancel(event) {
      handleScoreWheelPopoverPointerUp(event);
    }

    function handleScoreWheelPopoverClick(event) {
      if (!isScoreWheelPopoverOpen()) return;
      if (!isElement(event.target)) return;

      const target = event.target.closest(".score-wheel-item[data-value]");
      if (!target) return;

      const value = Number.parseInt(String(target.dataset.value || ""), 10);
      if (!Number.isInteger(value)) return;

      setScoreWheelValue(value);
      closeScoreWheelPopover();
    }

    function handleScoreWheelOutsidePointerDown(event) {
      if (!isScoreWheelPopoverOpen()) return;
      if (!isNode(event.target)) return;

      if (scoreWheelPopover?.contains(event.target)) return;

      const input = scoreWheelPickerState.activeInput;
      if (isNumberInput(input)) {
        if (event.target === input) return;
        if (input.parentElement && input.parentElement.contains(event.target)) return;
      }

      closeScoreWheelPopover();
    }

    function handleScoreWheelViewportChange() {
      const input = scoreWheelPickerState.activeInput;
      if (!isScoreWheelPopoverOpen() || !isNumberInput(input)) return;
      if (!input.isConnected || input.disabled || input.readOnly) {
        closeScoreWheelPopover();
        return;
      }
      positionScoreWheelPopover(input);
    }

    const api = {
      registerRatingInput(input) {
        if (!isNumberInput(input)) return;
        if (boundInputs.has(input)) return;
        boundInputs.add(input);
        bindScoreInputWheelControl(input);
        bindScoreWheelPicker(input);
      },
      registerRatingInputs(inputs) {
        if (!Array.isArray(inputs)) return;
        for (const input of inputs) {
          api.registerRatingInput(input);
        }
      },
      bindGlobalEvents() {
        if (globalEventsBound) return;
        globalEventsBound = true;

        if (scoreWheelPopover) {
          scoreWheelPopover.addEventListener("wheel", handleScoreWheelPopoverWheel, { passive: false });
          scoreWheelPopover.addEventListener("pointerdown", handleScoreWheelPopoverPointerDown);
          scoreWheelPopover.addEventListener("click", handleScoreWheelPopoverClick);
        }

        if (documentRef) {
          documentRef.addEventListener("pointerdown", handleScoreWheelOutsidePointerDown, true);
        }
        if (windowRef && typeof windowRef.addEventListener === "function") {
          windowRef.addEventListener("pointermove", handleScoreWheelPopoverPointerMove);
          windowRef.addEventListener("pointerup", handleScoreWheelPopoverPointerUp);
          windowRef.addEventListener("pointercancel", handleScoreWheelPopoverPointerCancel);
          windowRef.addEventListener("resize", handleScoreWheelViewportChange);
          windowRef.addEventListener("scroll", handleScoreWheelViewportChange, true);
        }
      },
      close(options) {
        closeScoreWheelPopover(options);
      },
      isOpen() {
        return isScoreWheelPopoverOpen();
      },
    };

    return api;
  }

  globalScope.TimeQualityScoreWheelModule = {
    createScoreWheelModule,
  };
})(typeof window !== "undefined" ? window : globalThis);
