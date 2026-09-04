(function attachTimeQualityAiUiReactionsModule(globalScope) {
  "use strict";

  const UI_CONTEXT_TRANSITION_SCHEMA = "guanshi-ui-context-transition-v1";

  function normalizeText(value, maxLength = 200) {
    return String(value || "").trim().slice(0, maxLength);
  }

  function normalizeStringList(value, maxItems = 40, maxLength = 120) {
    const source = Array.isArray(value) ? value : value ? [value] : [];
    return Array.from(new Set(source
      .map((item) => normalizeText(item, maxLength))
      .filter(Boolean)))
      .slice(0, Math.max(1, maxItems));
  }

  function normalizeObject(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  }

  function normalizeActionId(action) {
    const value = normalizeText(action, 120);
    if (!value) return "";
    return value.includes(".") ? value : `time.${value}`;
  }

  function normalizeViewContext(value) {
    const source = normalizeObject(value);
    return {
      activeView: normalizeText(source.activeView || source.view || "overview", 80),
      surface: normalizeText(source.surface || source.activeView || source.view || "overview", 80),
      filters: normalizeObject(source.filters),
      selection: normalizeObject(source.selection),
    };
  }

  function normalizeSurfaceEntry(entry) {
    const source = normalizeObject(entry);
    const config = normalizeObject(source.context_surface || source.contextSurface);
    const view = normalizeText(config.view, 80);
    if (!view) return null;
    const surfaceIds = normalizeStringList(config.surface_ids || config.surfaceIds || config.surfaces, 20, 80);
    return {
      surfaceRef: normalizeText(source.ui_id || source.uiId, 120),
      label: normalizeText(source.label || view, 120),
      view,
      surfaceIds: surfaceIds.length ? surfaceIds : [view],
      provides: normalizeStringList(config.provides, 20, 80),
      contextModes: normalizeStringList(config.context_modes || config.contextModes, 30, 80),
      actionRefs: normalizeStringList(config.action_refs || config.actionRefs, 30, 120),
      intentTerms: normalizeStringList(config.intent_terms || config.intentTerms, 60, 80),
      priority: Number.isFinite(Number(config.priority)) ? Number(config.priority) : 0,
      reaction: normalizeObject(config.reaction),
    };
  }

  function getSurfaceEntries(registryPayload) {
    const source = normalizeObject(registryPayload);
    const uiRegistry = Array.isArray(source.ui_registry) ? source.ui_registry : [];
    return uiRegistry.map(normalizeSurfaceEntry).filter(Boolean);
  }

  function getRequestedCapabilities(referenceScope, contextRequest) {
    const request = normalizeObject(contextRequest);
    const requestIncludes = normalizeStringList(request.include, 20, 80);
    if (requestIncludes.length) {
      return Array.from(new Set(requestIncludes.map((item) => {
        if (["todoDetails", "selectedObjects"].includes(item)) return "selectedTodo";
        if (["calendarBusyBlocks"].includes(item)) return "busyBlocks";
        if (["pageWorkContext", "projectTodos", "tagTodos", "statusTodos"].includes(item)) return "todos";
        return item;
      })));
    }
    const includes = normalizeObject(referenceScope?.includes);
    return ["selectedTodo", "selectedReading", "todos", "entries", "busyBlocks"].filter((key) => includes[key] === true);
  }

  function countIntentMatches(text, terms) {
    const source = normalizeText(text, 4000).toLocaleLowerCase("zh-CN");
    if (!source) return 0;
    return terms.reduce((count, term) => (
      source.includes(normalizeText(term, 80).toLocaleLowerCase("zh-CN")) ? count + 1 : count
    ), 0);
  }

  function actionMatches(action, refs) {
    const legacy = normalizeText(action, 120);
    const actionId = normalizeActionId(legacy);
    return refs.some((ref) => ref === legacy || ref === actionId || (legacy && ref.endsWith(`.${legacy}`)));
  }

  function surfaceMatches(viewContext, entry) {
    const view = normalizeText(viewContext?.activeView, 80);
    const surface = normalizeText(viewContext?.surface, 80);
    return view === entry.view || entry.surfaceIds.includes(surface);
  }

  function createAiUiReactionsModule(deps = {}) {
    const getViewContext = typeof deps.getViewContext === "function" ? deps.getViewContext : () => ({});
    const setActiveView = typeof deps.setActiveView === "function" ? deps.setActiveView : () => {};
    const setSettingsTab = typeof deps.setSettingsTab === "function" ? deps.setSettingsTab : () => {};
    const setSelectedTodoId = typeof deps.setSelectedTodoId === "function" ? deps.setSelectedTodoId : () => {};
    const requestTodoScrollToTodayGroup =
      typeof deps.requestTodoScrollToTodayGroup === "function" ? deps.requestTodoScrollToTodayGroup : () => {};
    const render = typeof deps.render === "function" ? deps.render : () => {};

    function resolveSurfaceExpectation(options = {}) {
      const referenceScope = normalizeObject(options.referenceScope);
      const resolvedMode = normalizeText(referenceScope.resolvedMode || referenceScope.requestedMode, 80);
      if (
        resolvedMode === "none"
        || (normalizeText(options.contextAccessMode, 80) === "no_reference" && resolvedMode !== "view_liuyao_reading")
      ) {
        return null;
      }

      const requestedCapabilities = getRequestedCapabilities(referenceScope, options.contextRequest);
      if (!requestedCapabilities.length) return null;

      const currentViewContext = normalizeViewContext(options.viewContext || getViewContext());
      const action = normalizeText(options.action, 120);
      const text = normalizeText(options.text, 4000);
      const preferredSurfaceRef = normalizeText(options.preferredSurfaceRef, 120);
      const mode = normalizeText(referenceScope.resolvedMode || referenceScope.requestedMode, 80);
      const entries = getSurfaceEntries(options.registryPayload);
      const ranked = entries.map((entry) => {
        const coverage = requestedCapabilities.filter((capability) => entry.provides.includes(capability)).length;
        const intentMatches = countIntentMatches(text, entry.intentTerms);
        const matchedAction = actionMatches(action, entry.actionRefs);
        const matchedMode = !entry.contextModes.length || entry.contextModes.includes(mode);
        if (!coverage || !matchedMode) return null;
        const matchedPreferredSurface = Boolean(preferredSurfaceRef && entry.surfaceRef === preferredSurfaceRef);
        if (preferredSurfaceRef && !matchedPreferredSurface) return null;
        if (!intentMatches && !matchedAction && !options.contextRequest && !matchedPreferredSurface) return null;
        const fullCoverage = coverage === requestedCapabilities.length;
        const score = (
          coverage * 10 +
          (fullCoverage ? 5 : 0) +
          (matchedPreferredSurface ? 1000 : 0) +
          intentMatches * 30 +
          (matchedAction ? 24 : 0) +
          (surfaceMatches(currentViewContext, entry) ? 2 : 0) +
          entry.priority
        );
        return { entry, score, coverage, intentMatches, matchedAction, matchedPreferredSurface };
      }).filter(Boolean).sort((left, right) => right.score - left.score || right.coverage - left.coverage);

      const selected = ranked[0];
      if (!selected) return null;
      const source = selected.matchedPreferredSurface
        ? "context_resolution_surface"
        : selected.intentMatches
        ? "explicit_user_surface_intent"
        : selected.matchedAction
          ? "action_surface_contract"
          : "context_request_fulfillment";
      return {
        schema: "guanshi-ui-expectation-v1",
        surfaceRef: selected.entry.surfaceRef,
        label: selected.entry.label,
        view: selected.entry.view,
        surfaceIds: selected.entry.surfaceIds,
        requestedCapabilities,
        source,
        priority: selected.intentMatches || selected.matchedAction ? "required" : "suggested",
        reason: `${source}:${requestedCapabilities.join(",")}`,
        reaction: {
          schema: "guanshi-ui-reaction-v1",
          trigger: "before_context_request",
          view: selected.entry.view,
          ...selected.entry.reaction,
        },
      };
    }

    function reconcile(expectation, options = {}) {
      const target = normalizeObject(expectation);
      const targetView = normalizeText(target.view || target.reaction?.view, 80);
      if (!targetView) return null;
      const before = normalizeViewContext(getViewContext());
      const phase = normalizeText(options.phase || "before_context_request", 80);
      const scrollMode = normalizeText(target.reaction?.scroll, 80);
      const selectedTodoId = normalizeText(options.selectedTodoId || target.target?.id, 120);
      let changed = false;

      if (scrollMode === "today_group" && before.activeView !== targetView) {
        requestTodoScrollToTodayGroup();
      }
      if (before.activeView !== targetView) {
        setActiveView(targetView);
        changed = true;
      }
      const settingsTab = normalizeText(target.reaction?.settings_tab || target.reaction?.settingsTab, 80);
      if (targetView === "settings" && settingsTab) {
        setSettingsTab(settingsTab, { scroll: false });
        changed = true;
      }
      if (selectedTodoId && targetView === "todo") {
        setSelectedTodoId(selectedTodoId);
        changed = true;
      }
      if (!changed && scrollMode === "today_group" && options.ensureVisible === true) {
        requestTodoScrollToTodayGroup();
        render();
      }

      const after = normalizeViewContext(getViewContext());
      return {
        schema: UI_CONTEXT_TRANSITION_SCHEMA,
        phase,
        surfaceRef: normalizeText(target.surfaceRef, 120),
        source: normalizeText(target.source, 80),
        priority: normalizeText(target.priority, 40),
        reason: normalizeText(target.reason, 300),
        requestedCapabilities: normalizeStringList(target.requestedCapabilities, 20, 80),
        changed,
        status: after.activeView === targetView ? (changed ? "applied" : "already_satisfied") : "not_satisfied",
        before: {
          activeView: before.activeView,
          surface: before.surface,
        },
        after: {
          activeView: after.activeView,
          surface: after.surface,
        },
      };
    }

    return {
      getSurfaceEntries,
      resolveSurfaceExpectation,
      reconcile,
    };
  }

  globalScope.TimeQualityAiUiReactionsModule = { createAiUiReactionsModule };
})(typeof window !== "undefined" ? window : globalThis);
