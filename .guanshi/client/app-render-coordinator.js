/* global window */

(function attachTimeQualityRenderCoordinatorModule(globalScope) {
  "use strict";

  function requireFunction(deps, key) {
    const value = deps[key];
    if (typeof value !== "function") {
      throw new Error(`TimeQualityRenderCoordinatorModule missing required function dependency: ${key}`);
    }
    return value;
  }

  function createRenderCoordinatorModule(deps = {}) {
    const {
      appViews = [],
      sidebarNavItems = [],
      settingsQuoteStatus,
      requestAnimationFrameFn =
        typeof globalScope.requestAnimationFrame === "function"
          ? globalScope.requestAnimationFrame.bind(globalScope)
          : (callback) => globalScope.setTimeout(callback, 0),
    } = deps;

    const getEntries = requireFunction(deps, "getEntries");
    const getCategories = requireFunction(deps, "getCategories");
    const getCurrentRange = requireFunction(deps, "getCurrentRange");
    const setActiveViewState = requireFunction(deps, "setActiveViewState");
    const syncRangeSwitchButtons = requireFunction(deps, "syncRangeSwitchButtons");
    const getRangeEntries = requireFunction(deps, "getRangeEntries");
    const isAnalyzableEntry = requireFunction(deps, "isAnalyzableEntry");
    const syncProjectTagLibraries = requireFunction(deps, "syncProjectTagLibraries");
    const renderHeroQuote = requireFunction(deps, "renderHeroQuote");
    const renderOverview = requireFunction(deps, "renderOverview");
    const renderCalendar = requireFunction(deps, "renderCalendar");
    const renderTodos = requireFunction(deps, "renderTodos");
    const renderReview = requireFunction(deps, "renderReview");
    const renderCategoryManager = requireFunction(deps, "renderCategoryManager");
    const renderSyncSettingsControls = requireFunction(deps, "renderSyncSettingsControls");
    const renderQuoteManager = requireFunction(deps, "renderQuoteManager");
    const renderAiSettings = typeof deps.renderAiSettings === "function" ? deps.renderAiSettings : () => {};
    const syncSearchAfterRender = requireFunction(deps, "syncSearchAfterRender");
    const scheduleFirstScreenPanelFit = requireFunction(deps, "scheduleFirstScreenPanelFit");
    const closeScoreWheel = requireFunction(deps, "closeScoreWheel");
    const setCalendarNeedsViewportReset = requireFunction(deps, "setCalendarNeedsViewportReset");
    const syncCalendarCustomScrollbar = requireFunction(deps, "syncCalendarCustomScrollbar");
    const getCurrentMotivationQuotes = requireFunction(deps, "getCurrentMotivationQuotes");
    const setQuoteStatus = requireFunction(deps, "setQuoteStatus");
    const ensureOptionsLoadedForSettingsView = requireFunction(deps, "ensureOptionsLoadedForSettingsView");
    const ensureAiSettingsLoadedForSettingsView =
      typeof deps.ensureAiSettingsLoadedForSettingsView === "function"
        ? deps.ensureAiSettingsLoadedForSettingsView
        : () => {};
    const renderTopTodoSyncHub = requireFunction(deps, "renderTopTodoSyncHub");
    const getSelectedTodo = requireFunction(deps, "getSelectedTodo");
    const syncTodoLayout = typeof deps.syncTodoLayout === "function" ? deps.syncTodoLayout : () => {};

    function render() {
      const entries = getEntries();
      syncRangeSwitchButtons();
      const filtered = getRangeEntries(entries, getCurrentRange());
      const analyzable = filtered.filter(isAnalyzableEntry);
      syncProjectTagLibraries();
      renderHeroQuote();
      renderOverview(analyzable, getCategories());
      renderCalendar(entries);
      renderTodos();
      renderReview();
      renderCategoryManager();
      renderSyncSettingsControls();
      renderQuoteManager();
      renderAiSettings();
      syncSearchAfterRender();
      scheduleFirstScreenPanelFit();
    }

    function setActiveView(view) {
      const available = new Set(appViews.map((node) => String(node.dataset.view || "")));
      const target = available.has(view) ? view : "overview";
      closeScoreWheel();
      setActiveViewState(target);

      for (const node of appViews) {
        const isActive = node.dataset.view === target;
        node.classList.toggle("is-active", isActive);
        node.hidden = !isActive;
      }

      for (const nav of sidebarNavItems) {
        nav.classList.toggle("is-active", nav.dataset.view === target);
      }

      if (target === "overview") {
        render();
      }

      if (target === "calendar") {
        setCalendarNeedsViewportReset(true);
        renderCalendar(getEntries());
        requestAnimationFrameFn(() => {
          syncCalendarCustomScrollbar();
        });
      }

      if (target === "todo") {
        renderTodos();
        requestAnimationFrameFn(() => {
          syncTodoLayout();
        });
      }

      if (target === "settings") {
        renderCategoryManager();
        renderSyncSettingsControls();
        renderQuoteManager();
        renderAiSettings();
        if (settingsQuoteStatus) {
          setQuoteStatus(`当前语录 ${getCurrentMotivationQuotes().length} 条。`, "normal");
        }
        ensureOptionsLoadedForSettingsView();
        ensureAiSettingsLoadedForSettingsView();
      }

      renderTopTodoSyncHub(getSelectedTodo());
    }

    return {
      render,
      setActiveView,
    };
  }

  globalScope.TimeQualityRenderCoordinatorModule = { createRenderCoordinatorModule };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = globalScope.TimeQualityRenderCoordinatorModule;
  }
})(typeof window !== "undefined" ? window : globalThis);
