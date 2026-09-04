/* global window */

(function attachTimeQualityScoreWheelModule(globalScope) {
  "use strict";

  if (!globalScope) return;

  function toNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function clampScore(value, min = 1, max = 10) {
    return Math.max(min, Math.min(max, Math.round(toNumber(value, min))));
  }

  function calculateScorePair(xRatio, yRatio, min = 1, max = 10) {
    const safeMin = Number.isInteger(min) ? min : 1;
    const safeMax = Number.isInteger(max) && max > safeMin ? max : 10;
    const steps = safeMax - safeMin;
    const x = Math.max(0, Math.min(1, toNumber(xRatio, 0)));
    const y = Math.max(0, Math.min(1, toNumber(yRatio, 0)));
    return {
      quality: safeMin + Math.round(x * steps),
      happiness: safeMax - Math.round(y * steps),
    };
  }

  function createScoreWheelModule(deps = {}) {
    const DEFAULT_SCORE = clampScore(deps.DEFAULT_SCORE || 7);
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

    const pairByInput = new WeakMap();
    const boundInputs = new WeakSet();
    const boundTriggers = new WeakSet();
    let globalEventsBound = false;
    let legacyPendingInput = null;
    const pickerState = {
      pair: null,
      pointerId: null,
    };

    function isNumberInput(input) {
      return (
        typeof globalScope.HTMLInputElement !== "undefined" &&
        input instanceof globalScope.HTMLInputElement &&
        input.type === "number"
      );
    }

    function isNode(node) {
      return typeof globalScope.Node !== "undefined" && node instanceof globalScope.Node;
    }

    function parseInputScore(input) {
      if (!isNumberInput(input)) return null;
      const value = Number.parseInt(String(input.value || ""), 10);
      if (!Number.isInteger(value)) return null;
      const min = Number.parseInt(String(input.min || "1"), 10);
      const max = Number.parseInt(String(input.max || "10"), 10);
      const safeMin = Number.isInteger(min) ? min : 1;
      const safeMax = Number.isInteger(max) ? max : 10;
      return value >= safeMin && value <= safeMax ? value : null;
    }

    function getPairLimits(pair) {
      const min = Number.parseInt(String(pair?.qualityInput?.min || "1"), 10);
      const max = Number.parseInt(String(pair?.qualityInput?.max || "10"), 10);
      return {
        min: Number.isInteger(min) ? min : 1,
        max: Number.isInteger(max) ? max : 10,
      };
    }

    function getPairForInputs(qualityInput, happinessInput) {
      const knownPair = pairByInput.get(qualityInput) || pairByInput.get(happinessInput);
      if (
        knownPair &&
        knownPair.qualityInput === qualityInput &&
        knownPair.happinessInput === happinessInput
      ) {
        return knownPair;
      }
      return registerRatingPair({ qualityInput, happinessInput });
    }

    function dispatchInputEvent(input, type) {
      if (!isNumberInput(input) || typeof EventCtor !== "function") return;
      input.dispatchEvent(new EventCtor(type, { bubbles: true }));
    }

    function getTriggerValueNode(trigger) {
      return trigger?.querySelector?.("[data-score-pair-value]") || null;
    }

    function syncTrigger(pair) {
      if (!pair?.trigger) return;
      const quality = parseInputScore(pair.qualityInput);
      const happiness = parseInputScore(pair.happinessInput);
      const hasValue = Number.isInteger(quality) && Number.isInteger(happiness);
      const disabled = Boolean(pair.qualityInput.disabled || pair.happinessInput.disabled);
      const valueNode = getTriggerValueNode(pair.trigger);
      const valueText = disabled ? "未来时段" : hasValue ? `${quality}*${happiness}` : "--*--";

      if (valueNode) valueNode.textContent = valueText;
      pair.trigger.disabled = disabled;
      pair.trigger.classList.toggle("is-empty", !hasValue && !disabled);
      pair.trigger.classList.toggle("is-score-open", pickerState.pair === pair);
      pair.trigger.setAttribute(
        "aria-label",
        disabled ? "未来时段暂不评分" : hasValue ? `评分 ${quality} 乘 ${happiness}` : "设置质量与幸福感评分",
      );
      pair.trigger.setAttribute("aria-expanded", pickerState.pair === pair ? "true" : "false");
    }

    function renderScoreQuadrant() {
      const pair = pickerState.pair;
      if (!pair || !scoreWheelTrack) return;
      const marker = scoreWheelTrack.querySelector(".score-quadrant-marker");
      const markerValue = scoreWheelTrack.querySelector(".score-quadrant-marker-value");
      const quality = parseInputScore(pair.qualityInput);
      const happiness = parseInputScore(pair.happinessInput);
      const hasValue = Number.isInteger(quality) && Number.isInteger(happiness);

      if (marker) {
        marker.hidden = !hasValue;
        marker.classList.toggle("label-left", hasValue && quality >= 9);
        if (hasValue) {
          const { min, max } = getPairLimits(pair);
          const steps = Math.max(1, max - min);
          marker.style.left = `${((quality - min) / steps) * 100}%`;
          marker.style.top = `${((max - happiness) / steps) * 100}%`;
        }
      }
      if (markerValue) markerValue.textContent = hasValue ? `${quality}*${happiness}` : "";
      scoreWheelTrack.setAttribute(
        "aria-label",
        hasValue
          ? `质量 ${quality}，幸福感 ${happiness}。左右调整质量，上下调整幸福感`
          : "尚未评分。点击选择质量与幸福感，或使用方向键从七分开始",
      );
      syncTrigger(pair);
    }

    function setPairValues(pair, quality, happiness, { emitInput = true, emitChange = true } = {}) {
      if (!pair) return;
      const { min, max } = getPairLimits(pair);
      const nextQuality = clampScore(quality, min, max);
      const nextHappiness = clampScore(happiness, min, max);
      const previousQuality = parseInputScore(pair.qualityInput);
      const previousHappiness = parseInputScore(pair.happinessInput);

      pair.qualityInput.value = String(nextQuality);
      pair.happinessInput.value = String(nextHappiness);
      renderScoreQuadrant();

      if (emitInput && previousQuality !== nextQuality) dispatchInputEvent(pair.qualityInput, "input");
      if (emitInput && previousHappiness !== nextHappiness) dispatchInputEvent(pair.happinessInput, "input");
      if (emitChange && previousQuality !== nextQuality) dispatchInputEvent(pair.qualityInput, "change");
      if (emitChange && previousHappiness !== nextHappiness) dispatchInputEvent(pair.happinessInput, "change");
    }

    function updatePairFromPointer(event) {
      if (!pickerState.pair || !scoreWheelTrack) return;
      const rect = scoreWheelTrack.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const { min, max } = getPairLimits(pickerState.pair);
      const pair = calculateScorePair(
        (event.clientX - rect.left) / rect.width,
        (event.clientY - rect.top) / rect.height,
        min,
        max,
      );
      setPairValues(pickerState.pair, pair.quality, pair.happiness);
    }

    function positionScoreWheelPopover(pair) {
      if (!pair || !scoreWheelPopover) return;
      const anchor = pair.trigger || pair.qualityInput;
      if (!anchor?.getBoundingClientRect) return;
      const dialog = anchor.closest?.('[role="dialog"]');
      const anchorRect = (dialog || anchor).getBoundingClientRect();
      const width = scoreWheelPopover.offsetWidth || 252;
      const height = scoreWheelPopover.offsetHeight || 282;
      const viewportWidth = toNumber(windowRef.innerWidth, 1024);
      const viewportHeight = toNumber(windowRef.innerHeight, 768);
      const gap = 12;
      const padding = 12;

      let placement = "right";
      let left = anchorRect.right + gap;
      let top = anchorRect.top + (anchorRect.height - height) / 2;

      if (left + width > viewportWidth - padding) {
        const leftCandidate = anchorRect.left - width - gap;
        if (leftCandidate >= padding) {
          placement = "left";
          left = leftCandidate;
        } else {
          placement = "below";
          left = anchorRect.left + (anchorRect.width - width) / 2;
          top = anchorRect.bottom + gap;
          if (top + height > viewportHeight - padding) {
            placement = "above";
            top = anchorRect.top - height - gap;
          }
        }
      }

      left = Math.max(padding, Math.min(viewportWidth - width - padding, left));
      top = Math.max(padding, Math.min(viewportHeight - height - padding, top));
      scoreWheelPopover.dataset.placement = placement;
      scoreWheelPopover.style.left = `${Math.round(left)}px`;
      scoreWheelPopover.style.top = `${Math.round(top)}px`;
    }

    function isScoreWheelPopoverOpen() {
      return Boolean(scoreWheelPopover && !scoreWheelPopover.hidden && pickerState.pair);
    }

    function closeScoreWheelPopover({ keepInputFocus = true } = {}) {
      if (!scoreWheelPopover) return;
      const pair = pickerState.pair;
      pickerState.pointerId = null;
      pickerState.pair = null;
      scoreWheelPopover.classList.remove("is-visible", "is-dragging");
      scoreWheelPopover.hidden = true;
      scoreWheelPopover.setAttribute("aria-hidden", "true");
      if (pair) {
        syncTrigger(pair);
        if (!keepInputFocus && documentRef?.activeElement === pair.trigger) pair.trigger.blur();
      }
    }

    function openForPair(qualityInput, happinessInput, options = {}) {
      if (!scoreWheelPopover || !scoreWheelTrack) return false;
      const pair = getPairForInputs(qualityInput, happinessInput);
      if (!pair || pair.qualityInput.disabled || pair.happinessInput.disabled) {
        if (pair) syncTrigger(pair);
        return false;
      }

      const previousPair = pickerState.pair;
      pickerState.pair = pair;
      if (previousPair && previousPair !== pair) syncTrigger(previousPair);
      scoreWheelPopover.hidden = false;
      scoreWheelPopover.setAttribute("aria-hidden", "false");
      renderScoreQuadrant();
      positionScoreWheelPopover(pair);
      requestAnimationFrameFn(() => {
        if (!isScoreWheelPopoverOpen() || pickerState.pair !== pair) return;
        scoreWheelPopover.classList.add("is-visible");
        if (options.focus !== false && typeof scoreWheelTrack.focus === "function") scoreWheelTrack.focus();
      });
      return true;
    }

    function registerRatingPair({ qualityInput, happinessInput, trigger = null } = {}) {
      if (!isNumberInput(qualityInput) || !isNumberInput(happinessInput)) return null;
      const existing = pairByInput.get(qualityInput);
      const pair = existing || { qualityInput, happinessInput, trigger: null };
      if (trigger) pair.trigger = trigger;
      pairByInput.set(qualityInput, pair);
      pairByInput.set(happinessInput, pair);

      for (const input of [qualityInput, happinessInput]) {
        if (boundInputs.has(input)) continue;
        boundInputs.add(input);
        input.addEventListener("input", () => {
          syncTrigger(pair);
          if (pickerState.pair === pair) renderScoreQuadrant();
        });
        input.addEventListener("focus", () => {
          if (!input.disabled) openForPair(qualityInput, happinessInput);
        });
      }

      if (pair.trigger && !boundTriggers.has(pair.trigger)) {
        boundTriggers.add(pair.trigger);
        pair.trigger.addEventListener("click", () => {
          if (pickerState.pair === pair && isScoreWheelPopoverOpen()) {
            closeScoreWheelPopover();
            return;
          }
          openForPair(qualityInput, happinessInput);
        });
      }
      syncTrigger(pair);
      return pair;
    }

    function handlePointerDown(event) {
      if (!isScoreWheelPopoverOpen() || event.button !== 0) return;
      pickerState.pointerId = event.pointerId;
      scoreWheelPopover.classList.add("is-dragging");
      scoreWheelTrack.setPointerCapture?.(event.pointerId);
      scoreWheelTrack.focus?.();
      updatePairFromPointer(event);
      event.preventDefault();
    }

    function handlePointerMove(event) {
      if (!isScoreWheelPopoverOpen() || pickerState.pointerId !== event.pointerId) return;
      updatePairFromPointer(event);
      event.preventDefault();
    }

    function handlePointerUp(event) {
      if (pickerState.pointerId !== event.pointerId) return;
      pickerState.pointerId = null;
      scoreWheelPopover?.classList.remove("is-dragging");
      scoreWheelTrack?.releasePointerCapture?.(event.pointerId);
    }

    function handleKeydown(event) {
      if (!isScoreWheelPopoverOpen()) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeScoreWheelPopover();
        return;
      }
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
      event.preventDefault();
      const quality = parseInputScore(pickerState.pair.qualityInput);
      const happiness = parseInputScore(pickerState.pair.happinessInput);
      if (!Number.isInteger(quality) || !Number.isInteger(happiness)) {
        setPairValues(pickerState.pair, DEFAULT_SCORE, DEFAULT_SCORE);
        return;
      }
      if (event.key === "ArrowLeft") setPairValues(pickerState.pair, quality - 1, happiness);
      if (event.key === "ArrowRight") setPairValues(pickerState.pair, quality + 1, happiness);
      if (event.key === "ArrowUp") setPairValues(pickerState.pair, quality, happiness + 1);
      if (event.key === "ArrowDown") setPairValues(pickerState.pair, quality, happiness - 1);
    }

    function handleOutsidePointerDown(event) {
      if (!isScoreWheelPopoverOpen() || !isNode(event.target)) return;
      if (scoreWheelPopover.contains(event.target)) return;
      if (pickerState.pair?.trigger?.contains?.(event.target)) return;
      closeScoreWheelPopover();
    }

    function handleViewportChange() {
      if (!isScoreWheelPopoverOpen()) return;
      const pair = pickerState.pair;
      if (!pair.qualityInput.isConnected || pair.qualityInput.disabled || pair.happinessInput.disabled) {
        closeScoreWheelPopover();
        return;
      }
      positionScoreWheelPopover(pair);
    }

    const api = {
      registerRatingPair,
      registerRatingPairs(pairs) {
        if (!Array.isArray(pairs)) return;
        for (const pair of pairs) registerRatingPair(pair);
      },
      registerRatingInput(input) {
        if (!isNumberInput(input)) return;
        if (!legacyPendingInput) {
          legacyPendingInput = input;
          return;
        }
        registerRatingPair({ qualityInput: legacyPendingInput, happinessInput: input });
        legacyPendingInput = null;
      },
      registerRatingInputs(inputs) {
        if (!Array.isArray(inputs)) return;
        for (const input of inputs) api.registerRatingInput(input);
      },
      bindGlobalEvents() {
        if (globalEventsBound) return;
        globalEventsBound = true;
        scoreWheelTrack?.addEventListener("pointerdown", handlePointerDown);
        scoreWheelTrack?.addEventListener("keydown", handleKeydown);
        documentRef?.addEventListener("pointerdown", handleOutsidePointerDown, true);
        windowRef?.addEventListener?.("pointermove", handlePointerMove);
        windowRef?.addEventListener?.("pointerup", handlePointerUp);
        windowRef?.addEventListener?.("pointercancel", handlePointerUp);
        windowRef?.addEventListener?.("resize", handleViewportChange);
        windowRef?.addEventListener?.("scroll", handleViewportChange, true);
      },
      openForPair,
      syncPair(qualityInput, happinessInput) {
        const pair = getPairForInputs(qualityInput, happinessInput);
        if (!pair) return;
        syncTrigger(pair);
        if (pickerState.pair === pair) renderScoreQuadrant();
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
    calculateScorePair,
    createScoreWheelModule,
  };
})(typeof window !== "undefined" ? window : globalThis);
