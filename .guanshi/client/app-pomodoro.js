(function attachTimeQualityPomodoroModule(globalScope) {
  if (!globalScope) return;

  function requireFunction(deps, key) {
    const value = deps[key];
    if (typeof value !== "function") {
      throw new Error(`TimeQualityPomodoroModule missing required function dependency: ${key}`);
    }
    return value;
  }

  function toNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function normalizeList(value) {
    return Array.isArray(value) ? value : [];
  }

  function createPomodoroModule(deps = {}) {
    const DEFAULT_POMODORO_MINUTES = toNumber(deps.DEFAULT_POMODORO_MINUTES, 25);
    const DEFAULT_SCORE = toNumber(deps.DEFAULT_SCORE, 7);
    const POMODORO_DIAL_RUNNING_CLASS = String(deps.POMODORO_DIAL_RUNNING_CLASS || "is-running");
    const POMODORO_DIAL_START_DEG = toNumber(deps.POMODORO_DIAL_START_DEG, -90);

    const documentRef = deps.documentRef || globalScope.document || null;
    const windowRef = deps.windowRef || globalScope.window || globalScope;
    const alertFn =
      typeof deps.alertFn === "function"
        ? deps.alertFn
        : typeof windowRef.alert === "function"
          ? windowRef.alert.bind(windowRef)
          : () => {};
    const promptFn =
      typeof deps.promptFn === "function"
        ? deps.promptFn
        : typeof windowRef.prompt === "function"
          ? windowRef.prompt.bind(windowRef)
          : () => null;

    const formatClock = requireFunction(deps, "formatClock");
    const formatDateForInput = requireFunction(deps, "formatDateForInput");
    const formatTimeForInput = requireFunction(deps, "formatTimeForInput");
    const validateEntryInput = requireFunction(deps, "validateEntryInput");
    const normalizeEntryTitle = requireFunction(deps, "normalizeEntryTitle");
    const updateBodyModalState = requireFunction(deps, "updateBodyModalState");
    const savePomodoroEntry = requireFunction(deps, "savePomodoroEntry");
    const getLinkedTodoById = requireFunction(deps, "getLinkedTodoById");
    const getLinkedTodoTitleFallback = requireFunction(deps, "getLinkedTodoTitleFallback");
    const completeLinkedTodoSession = requireFunction(deps, "completeLinkedTodoSession");
    const recordLinkedTodoSession = requireFunction(deps, "recordLinkedTodoSession");
    const getCategories =
      typeof deps.getCategories === "function" ? deps.getCategories : () => normalizeList(deps.categories);

    const scoreWheelModule = deps.scoreWheelModule || null;
    const pomodoroMinutesInput = deps.pomodoroMinutesInput || null;
    const pomodoroCategory = deps.pomodoroCategory || null;
    const pomodoroDial = deps.pomodoroDial || null;
    const pomodoroDisplay = deps.pomodoroDisplay || null;
    const pomodoroRange = deps.pomodoroRange || null;
    const pomodoroMinusFiveBtn = deps.pomodoroMinusFiveBtn || null;
    const pomodoroPlusFiveBtn = deps.pomodoroPlusFiveBtn || null;
    const pomodoroStartBtn = deps.pomodoroStartBtn || null;
    const pomodoroPauseBtn = deps.pomodoroPauseBtn || null;
    const pomodoroResetBtn = deps.pomodoroResetBtn || null;
    const pomodoroScoreModal = deps.pomodoroScoreModal || null;
    const pomodoroScoreTitle = deps.pomodoroScoreTitle || null;
    const pomodoroScoreDescription = deps.pomodoroScoreDescription || null;
    const pomodoroQualityScoreSlider = deps.pomodoroQualityScoreSlider || null;
    const pomodoroHappinessScoreSlider = deps.pomodoroHappinessScoreSlider || null;
    const pomodoroScoreConfirmBtn = deps.pomodoroScoreConfirmBtn || null;
    const pomodoroScoreIncompleteBtn = deps.pomodoroScoreIncompleteBtn || null;
    const pomodoroScoreCancelBtn = deps.pomodoroScoreCancelBtn || null;

    let eventsBound = false;
    let timerId = null;
    let durationSeconds = DEFAULT_POMODORO_MINUTES * 60;
    let secondsLeft = durationSeconds;
    let scoreModalResolver = null;
    let linkedTodoId = "";
    let linkedSessionStartedAt = null;
    let sessionStartedAt = null;
    let expectedEndAt = null;
    let scoreModalLinkedMode = false;
    let finishInProgress = false;

    function isElement(node) {
      return typeof globalScope.Element !== "undefined" && node instanceof globalScope.Element;
    }

    function getDefaultEntryTitle() {
      const categories = normalizeList(getCategories());
      const category = String(pomodoroCategory?.value || categories[0] || "工作").trim() || "工作";
      return `番茄钟：${category}`;
    }

    function getScoreModalTitleValue(fallback = getDefaultEntryTitle()) {
      if (!pomodoroScoreTitle) return normalizeEntryTitle("", fallback);
      const raw = String(pomodoroScoreTitle.textContent || "").replace(/\s+/g, " ").trim();
      const normalized = normalizeEntryTitle(raw, fallback);
      pomodoroScoreTitle.textContent = normalized;
      return normalized;
    }

    function setScoreModalTitle(value, fallback = getDefaultEntryTitle()) {
      if (!pomodoroScoreTitle) return;
      pomodoroScoreTitle.textContent = normalizeEntryTitle(value, fallback);
    }

    function beginScoreTitleInlineEdit() {
      if (!pomodoroScoreTitle || !pomodoroScoreModal || pomodoroScoreModal.hidden) return;
      if (pomodoroScoreTitle.getAttribute("contenteditable") === "true" && documentRef?.activeElement === pomodoroScoreTitle) {
        return;
      }
      pomodoroScoreTitle.setAttribute("contenteditable", "true");
      pomodoroScoreTitle.focus();
      if (documentRef?.createRange && windowRef.getSelection) {
        const range = documentRef.createRange();
        range.selectNodeContents(pomodoroScoreTitle);
        const selection = windowRef.getSelection();
        if (selection) {
          selection.removeAllRanges();
          selection.addRange(range);
        }
      }
    }

    function init() {
      if (pomodoroMinutesInput) {
        pomodoroMinutesInput.value = String(DEFAULT_POMODORO_MINUTES);
      }
      durationSeconds = DEFAULT_POMODORO_MINUTES * 60;
      secondsLeft = durationSeconds;
      linkedTodoId = "";
      linkedSessionStartedAt = null;
      sessionStartedAt = null;
      expectedEndAt = null;
      scoreModalLinkedMode = false;
      hideScoreModal();
      updateDisplay();
      updateButtons();
    }

    function bindEvents() {
      if (eventsBound) return;
      eventsBound = true;

      if (pomodoroMinutesInput) {
        pomodoroMinutesInput.addEventListener("change", handleMinutesChange);
      }
      if (pomodoroMinusFiveBtn) {
        pomodoroMinusFiveBtn.addEventListener("click", () => {
          adjustMinutes(-5);
        });
      }
      if (pomodoroPlusFiveBtn) {
        pomodoroPlusFiveBtn.addEventListener("click", () => {
          adjustMinutes(5);
        });
      }
      if (pomodoroStartBtn) {
        pomodoroStartBtn.addEventListener("click", start);
      }
      if (pomodoroPauseBtn) {
        pomodoroPauseBtn.addEventListener("click", pause);
      }
      if (pomodoroResetBtn) {
        pomodoroResetBtn.addEventListener("click", reset);
      }

      if (pomodoroScoreConfirmBtn) {
        pomodoroScoreConfirmBtn.addEventListener("click", () => {
          handleScoreConfirm("complete");
        });
      }
      if (pomodoroScoreIncompleteBtn) {
        pomodoroScoreIncompleteBtn.addEventListener("click", () => {
          handleScoreConfirm("incomplete");
        });
      }
      if (pomodoroScoreCancelBtn) {
        pomodoroScoreCancelBtn.addEventListener("click", () => {
          resolveScoreModal(null);
        });
      }
      if (pomodoroScoreModal) {
        pomodoroScoreModal.addEventListener("click", (event) => {
          if (!isElement(event.target)) return;
          const closeTarget = event.target.closest("[data-score-modal-close]");
          if (closeTarget) {
            resolveScoreModal(null);
          }
        });
      }

      if (pomodoroScoreTitle) {
        pomodoroScoreTitle.addEventListener("click", beginScoreTitleInlineEdit);
        pomodoroScoreTitle.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            getScoreModalTitleValue(getDefaultEntryTitle());
            pomodoroScoreTitle.blur();
            return;
          }
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            getScoreModalTitleValue(getDefaultEntryTitle());
            pomodoroScoreTitle.blur();
          }
        });
        pomodoroScoreTitle.addEventListener("blur", () => {
          getScoreModalTitleValue(getDefaultEntryTitle());
          pomodoroScoreTitle.setAttribute("contenteditable", "false");
        });
      }

      documentRef?.addEventListener("keydown", handleScoreModalKeydown);
      windowRef?.addEventListener("focus", refreshFromClock);
      documentRef?.addEventListener("visibilitychange", refreshFromClock);
    }

    function handleMinutesChange() {
      if (!pomodoroMinutesInput) return;
      const minutes = normalizeMinutes(pomodoroMinutesInput.value);
      pomodoroMinutesInput.value = String(minutes);

      if (timerId) {
        return;
      }

      durationSeconds = minutes * 60;
      secondsLeft = durationSeconds;
      sessionStartedAt = null;
      linkedSessionStartedAt = null;
      expectedEndAt = null;
      updateDisplay();
      updateButtons();
    }

    function adjustMinutes(delta) {
      if (timerId || !pomodoroMinutesInput) return;
      const current = normalizeMinutes(pomodoroMinutesInput.value);
      const next = normalizeMinutes(current + delta);
      if (next === current) {
        updateButtons();
        return;
      }
      pomodoroMinutesInput.value = String(next);
      handleMinutesChange();
    }

    function start() {
      if (timerId) return;

      if (secondsLeft <= 0) {
        reset();
      }
      const now = new Date();
      if (!(sessionStartedAt instanceof Date) || Number.isNaN(sessionStartedAt.getTime())) {
        sessionStartedAt = now;
      }
      if (String(linkedTodoId || "").trim() && !(linkedSessionStartedAt instanceof Date)) {
        linkedSessionStartedAt = sessionStartedAt;
      }
      expectedEndAt = new Date(now.getTime() + Math.max(0, secondsLeft) * 1000);

      timerId = windowRef.setInterval(() => {
        refreshFromClock();
      }, 1000);

      refreshFromClock({ finishOnComplete: false });
      updateDisplay();
      updateButtons();
    }

    function pause() {
      if (!timerId) return;

      if (refreshFromClock()) return;
      windowRef.clearInterval(timerId);
      timerId = null;
      expectedEndAt = null;
      updateButtons();
    }

    function reset() {
      if (timerId) {
        windowRef.clearInterval(timerId);
        timerId = null;
      }

      const minutes = DEFAULT_POMODORO_MINUTES;
      if (pomodoroMinutesInput) {
        pomodoroMinutesInput.value = String(minutes);
      }
      durationSeconds = minutes * 60;
      secondsLeft = durationSeconds;
      linkedTodoId = "";
      linkedSessionStartedAt = null;
      sessionStartedAt = null;
      expectedEndAt = null;
      resolveScoreModal(null);

      updateDisplay();
      updateButtons();
    }

    function refreshFromClock(options = {}) {
      if (!timerId) return false;
      const finishOnComplete = options.finishOnComplete !== false;
      if (!(expectedEndAt instanceof Date) || Number.isNaN(expectedEndAt.getTime())) {
        expectedEndAt = new Date(Date.now() + Math.max(0, secondsLeft) * 1000);
      }

      const remainingSeconds = Math.max(0, Math.ceil((expectedEndAt.getTime() - Date.now()) / 1000));
      secondsLeft = remainingSeconds;
      if (remainingSeconds <= 0 && finishOnComplete) {
        void finish();
        return true;
      }

      updateDisplay();
      updateButtons();
      return false;
    }

    function getLinkedTodo() {
      const id = String(linkedTodoId || "").trim();
      if (!id) return null;
      return getLinkedTodoById(id);
    }

    function getSessionStartedAt() {
      if (linkedSessionStartedAt instanceof Date && !Number.isNaN(linkedSessionStartedAt.getTime())) {
        return linkedSessionStartedAt;
      }
      if (sessionStartedAt instanceof Date && !Number.isNaN(sessionStartedAt.getTime())) {
        return sessionStartedAt;
      }
      return null;
    }

    function clearSessionTiming() {
      sessionStartedAt = null;
      expectedEndAt = null;
      linkedTodoId = "";
      linkedSessionStartedAt = null;
    }

    function getSessionDurationSeconds(endDate) {
      const elapsedByCounter = Math.max(0, durationSeconds - secondsLeft);
      if (!(endDate instanceof Date) || Number.isNaN(endDate.getTime())) {
        return Math.max(5 * 60, elapsedByCounter || durationSeconds || DEFAULT_POMODORO_MINUTES * 60);
      }
      const startedAt = getSessionStartedAt();
      if (startedAt) {
        const elapsedByClock = Math.max(0, Math.round((endDate.getTime() - startedAt.getTime()) / 1000));
        return Math.max(5 * 60, elapsedByCounter, elapsedByClock);
      }
      return Math.max(5 * 60, elapsedByCounter || durationSeconds || DEFAULT_POMODORO_MINUTES * 60);
    }

    function buildSessionRange(endDate, sessionDurationSeconds) {
      if (!(endDate instanceof Date) || Number.isNaN(endDate.getTime())) {
        return { ok: false, message: "番茄钟时间范围无效，请重试。" };
      }
      const safeDurationSeconds = Math.max(5 * 60, Math.round(Number(sessionDurationSeconds) || 0));
      const startDate = new Date(endDate.getTime() - safeDurationSeconds * 1000);
      const date = formatDateForInput(startDate);
      const startValue = formatTimeForInput(startDate);
      const endValue = formatTimeForInput(endDate);
      const validation = validateEntryInput(date, startValue, endValue);
      if (!validation.ok) {
        return { ok: false, message: validation.message || "番茄钟时间范围无效，请重试。" };
      }
      return {
        ok: true,
        startDate,
        endDate,
        date,
        start: startValue,
        end: endValue,
        durationHours: validation.duration,
        durationSeconds: safeDurationSeconds,
        durationMinutes: Math.max(5, Math.round(safeDurationSeconds / 60)),
      };
    }

    async function finish(options = {}) {
      if (finishInProgress) return;
      finishInProgress = true;
      refreshFromClock({ finishOnComplete: false });
      if (timerId) {
        windowRef.clearInterval(timerId);
        timerId = null;
      }
      try {
        const linkedTodo = getLinkedTodo();
        const linkedTodoMode = Boolean(linkedTodo && !linkedTodo.completed);
        if (!linkedTodoMode) {
          linkedTodoId = "";
          linkedSessionStartedAt = null;
        }
        const forcedAction = String(options.forcedAction || "").trim();
        const completedAt = new Date();
        const completedDurationSeconds = getSessionDurationSeconds(completedAt);
        const sessionRange = buildSessionRange(completedAt, completedDurationSeconds);
        if (!sessionRange.ok) {
          alertFn(sessionRange.message || "番茄钟记录失败，请重试。");
          clearSessionTiming();
          updateDisplay();
          updateButtons();
          return;
        }

        secondsLeft = 0;
        updateDisplay();
        updateButtons();

        const titleFallback = linkedTodoMode ? getLinkedTodoTitleFallback(linkedTodo) : getDefaultEntryTitle();
        const result = await requestScores(DEFAULT_SCORE, DEFAULT_SCORE, {
          linkedTodoMode,
          defaultTitle: titleFallback,
        });
        if (!result) {
          clearSessionTiming();
          return;
        }

        const action = forcedAction || String(result.action || "complete");
        if (linkedTodoMode) {
          const saved =
            action === "incomplete"
              ? recordLinkedTodoSession(linkedTodo, result, sessionRange)
              : completeLinkedTodoSession(linkedTodo, result, sessionRange);
          if (!saved) {
            alertFn(action === "incomplete" ? "未能写入番茄钟记录，请稍后重试。" : "未能完成关联待办，请稍后重试。");
          }
          clearSessionTiming();
          return;
        }

        savePomodoroEntry({
          endDate: sessionRange.endDate,
          durationSeconds: sessionRange.durationSeconds,
          title: result.title,
          quality: result.quality,
          happiness: result.happiness,
        });
        clearSessionTiming();
      } finally {
        finishInProgress = false;
      }
    }

    function requestScores(initialQuality, initialHappiness, options = {}) {
      const linkedTodoMode = Boolean(options && options.linkedTodoMode);
      const fallbackTitle = String(options?.defaultTitle || "").trim();
      const defaultTitle = normalizeEntryTitle(fallbackTitle, getDefaultEntryTitle());
      if (!pomodoroScoreModal || !pomodoroQualityScoreSlider || !pomodoroHappinessScoreSlider || !pomodoroScoreConfirmBtn) {
        const quality = requestScoreByPrompt("质量", initialQuality);
        if (quality === null) return Promise.resolve(null);

        const happiness = requestScoreByPrompt("幸福感", initialHappiness);
        if (happiness === null) return Promise.resolve(null);

        return Promise.resolve({ title: defaultTitle, quality, happiness, action: "complete" });
      }

      if (scoreModalResolver) {
        return Promise.resolve(null);
      }

      pomodoroQualityScoreSlider.value = String(initialQuality);
      pomodoroHappinessScoreSlider.value = String(initialHappiness);
      setScoreModalTitle(defaultTitle, defaultTitle);
      if (pomodoroScoreTitle) {
        pomodoroScoreTitle.setAttribute("contenteditable", "false");
      }
      scoreModalLinkedMode = linkedTodoMode;
      if (pomodoroScoreIncompleteBtn) {
        pomodoroScoreIncompleteBtn.hidden = !linkedTodoMode;
      }
      if (pomodoroScoreConfirmBtn) {
        pomodoroScoreConfirmBtn.textContent = linkedTodoMode ? "完成任务" : "确认评分";
      }
      if (pomodoroScoreDescription) {
        pomodoroScoreDescription.textContent = linkedTodoMode
          ? "请确认本次评分，并选择“完成任务”或“未完成，记录本轮”。"
          : "请确认本次专注的质量与幸福感评分，确认后将直接记录。";
      }

      pomodoroScoreModal.hidden = false;
      updateBodyModalState();
      openScorePicker();

      return new Promise((resolve) => {
        scoreModalResolver = resolve;
      });
    }

    function openScorePicker() {
      if (!pomodoroQualityScoreSlider || !pomodoroHappinessScoreSlider) return;
      if (scoreWheelModule && typeof scoreWheelModule.syncPair === "function") {
        scoreWheelModule.syncPair(pomodoroQualityScoreSlider, pomodoroHappinessScoreSlider);
      }
      if (scoreWheelModule && typeof scoreWheelModule.openForPair === "function") {
        scoreWheelModule.openForPair(pomodoroQualityScoreSlider, pomodoroHappinessScoreSlider);
        return;
      }
      pomodoroQualityScoreSlider.focus();
    }

    function handleScoreConfirm(action = "complete") {
      if (!pomodoroQualityScoreSlider || !pomodoroHappinessScoreSlider) return;
      const quality = Number.parseInt(String(pomodoroQualityScoreSlider.value || ""), 10);
      const happiness = Number.parseInt(String(pomodoroHappinessScoreSlider.value || ""), 10);

      if (!Number.isInteger(quality) || quality < 1 || quality > 10) {
        alertFn("质量评分需为 1 到 10 的整数。");
        openScorePicker();
        return;
      }

      if (!Number.isInteger(happiness) || happiness < 1 || happiness > 10) {
        alertFn("幸福感评分需为 1 到 10 的整数。");
        openScorePicker();
        return;
      }

      resolveScoreModal({
        title: getScoreModalTitleValue(getDefaultEntryTitle()),
        quality,
        happiness,
        action: scoreModalLinkedMode && action === "incomplete" ? "incomplete" : "complete",
      });
    }

    function resolveScoreModal(result) {
      if (!scoreModalResolver) {
        hideScoreModal();
        return;
      }

      const resolver = scoreModalResolver;
      scoreModalResolver = null;
      hideScoreModal();
      resolver(result);
    }

    function hideScoreModal() {
      if (scoreWheelModule && typeof scoreWheelModule.close === "function") {
        scoreWheelModule.close();
      }
      if (pomodoroScoreTitle) {
        pomodoroScoreTitle.setAttribute("contenteditable", "false");
      }
      if (pomodoroScoreIncompleteBtn) {
        pomodoroScoreIncompleteBtn.hidden = true;
      }
      if (pomodoroScoreDescription) {
        pomodoroScoreDescription.textContent = "请确认本次专注的质量与幸福感评分，确认后将直接记录。";
      }
      if (pomodoroScoreConfirmBtn) {
        pomodoroScoreConfirmBtn.textContent = "确认评分";
      }
      scoreModalLinkedMode = false;
      if (pomodoroScoreModal) {
        pomodoroScoreModal.hidden = true;
      }
      updateBodyModalState();
    }

    function handleScoreModalKeydown(event) {
      if (event.key !== "Escape" || !pomodoroScoreModal || pomodoroScoreModal.hidden) return;
      if (scoreWheelModule && typeof scoreWheelModule.isOpen === "function" && scoreWheelModule.isOpen()) {
        event.preventDefault();
        scoreWheelModule.close();
        return;
      }
      if (pomodoroScoreTitle && documentRef?.activeElement === pomodoroScoreTitle) {
        event.preventDefault();
        getScoreModalTitleValue(getDefaultEntryTitle());
        pomodoroScoreTitle.blur();
        return;
      }
      event.preventDefault();
      resolveScoreModal(null);
    }

    function requestScoreByPrompt(label, initialValue) {
      const input = promptFn(`番茄钟完成，请确认${label}评分（1-10）`, String(initialValue));
      if (input === null) return null;

      const value = Number(String(input).trim());
      if (!Number.isInteger(value) || value < 1 || value > 10) {
        alertFn(`${label}评分需为 1 到 10 的整数。`);
        return requestScoreByPrompt(label, initialValue);
      }

      return value;
    }

    function normalizeMinutes(value) {
      const minutes = Number.parseInt(value, 10);
      if (Number.isNaN(minutes)) return DEFAULT_POMODORO_MINUTES;
      return Math.min(120, Math.max(1, minutes));
    }

    function updateDisplay() {
      if (pomodoroDisplay) {
        pomodoroDisplay.textContent = formatClock(secondsLeft);
      }
      updateDial();
      updateRange();
    }

    function updateButtons() {
      const isRunning = Boolean(timerId);
      if (pomodoroDial) {
        pomodoroDial.classList.toggle(POMODORO_DIAL_RUNNING_CLASS, isRunning);
      }

      if (pomodoroStartBtn) {
        pomodoroStartBtn.disabled = isRunning;
      }
      if (pomodoroPauseBtn) {
        pomodoroPauseBtn.disabled = !isRunning;
      }
      if (pomodoroMinutesInput) {
        pomodoroMinutesInput.disabled = isRunning;
      }

      const minutes = normalizeMinutes(pomodoroMinutesInput?.value);
      if (pomodoroMinusFiveBtn) {
        pomodoroMinusFiveBtn.disabled = isRunning || minutes <= 1;
      }
      if (pomodoroPlusFiveBtn) {
        pomodoroPlusFiveBtn.disabled = isRunning || minutes >= 120;
      }
    }

    function updateDial() {
      if (!pomodoroDial) return;
      const isRunning = Boolean(timerId);
      pomodoroDial.classList.toggle(POMODORO_DIAL_RUNNING_CLASS, isRunning);

      const progress = durationSeconds > 0 ? 1 - secondsLeft / durationSeconds : 0;
      const clampedProgress = Math.max(0, Math.min(1, progress));
      const progressDeg = clampedProgress * 360;
      const angleDeg = POMODORO_DIAL_START_DEG + progressDeg;

      pomodoroDial.style.setProperty("--dial-progress", String(clampedProgress));
      pomodoroDial.style.setProperty("--dial-start-angle", `${POMODORO_DIAL_START_DEG}deg`);
      pomodoroDial.style.setProperty("--dial-progress-deg", `${progressDeg}deg`);
      pomodoroDial.style.setProperty("--dial-angle", `${angleDeg}deg`);

      pomodoroDial.setAttribute("aria-label", `番茄钟进度 ${Math.round(clampedProgress * 100)}%，剩余 ${formatClock(secondsLeft)}`);
    }

    function updateRange() {
      if (!pomodoroRange) return;
      if (secondsLeft <= 0) {
        pomodoroRange.textContent = "已完成";
        return;
      }

      const now = new Date();
      const startedAt = getSessionStartedAt() || now;
      const expectedEnd =
        expectedEndAt instanceof Date && !Number.isNaN(expectedEndAt.getTime())
          ? expectedEndAt
          : new Date(now.getTime() + secondsLeft * 1000);
      pomodoroRange.textContent = `${formatTimeForInput(startedAt)} → ${formatTimeForInput(expectedEnd)}`;
    }

    function beginLinkedSession(options = {}) {
      const todoId = String(options.todoId || "").trim();
      if (!todoId) return false;
      const minutes = normalizeMinutes(options.minutes);
      const startedAt = options.startedAt instanceof Date ? options.startedAt : new Date();
      if (pomodoroCategory && options.category) {
        pomodoroCategory.value = String(options.category);
      }
      if (pomodoroMinutesInput) {
        pomodoroMinutesInput.value = String(minutes);
      }
      handleMinutesChange();
      linkedTodoId = todoId;
      linkedSessionStartedAt = startedAt;
      sessionStartedAt = startedAt;
      expectedEndAt = null;
      start();
      return true;
    }

    function isBusy() {
      return Boolean(timerId || finishInProgress);
    }

    function hasLinkedTodoProgress(todoId) {
      const id = String(linkedTodoId || "").trim();
      if (!id || id !== String(todoId || "")) return false;
      return Boolean(timerId || (linkedSessionStartedAt instanceof Date && durationSeconds > secondsLeft));
    }

    function clearLinkedTodo(todoId) {
      if (String(linkedTodoId || "") !== String(todoId || "")) return;
      linkedTodoId = "";
      linkedSessionStartedAt = null;
    }

    return {
      init,
      bindEvents,
      start,
      pause,
      reset,
      finish,
      normalizeMinutes,
      beginLinkedSession,
      isBusy,
      hasLinkedTodoProgress,
      clearLinkedTodo,
    };
  }

  globalScope.TimeQualityPomodoroModule = {
    createPomodoroModule,
  };
  globalScope.createPomodoroModule = createPomodoroModule;
})(typeof window !== "undefined" ? window : globalThis);
