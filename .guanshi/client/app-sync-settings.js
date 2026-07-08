(function attachTimeQualitySyncSettingsModule(globalScope) {
  if (!globalScope) return;

  function requireFunction(deps, key) {
    const value = deps[key];
    if (typeof value !== "function") {
      throw new Error(`TimeQualitySyncSettingsModule missing required function dependency: ${key}`);
    }
    return value;
  }

  function normalizeList(value) {
    return Array.isArray(value) ? value : [];
  }

  function createSyncSettingsModule(deps = {}) {
    const SYNC_CALENDAR_TARGET_STORAGE_KEY = String(deps.SYNC_CALENDAR_TARGET_STORAGE_KEY || "");
    const SYNC_CALENDAR_TARGET_CONFIRMED_KEY = String(deps.SYNC_CALENDAR_TARGET_CONFIRMED_KEY || "");
    const DEFAULT_SYNC_TARGET_SOURCE_NAME = String(deps.DEFAULT_SYNC_TARGET_SOURCE_NAME || "iCloud");
    const DEFAULT_SYNC_TARGET_CALENDAR_NAME = String(deps.DEFAULT_SYNC_TARGET_CALENDAR_NAME || "个人");
    const DEFAULT_SYNC_TARGET_GROUP = String(deps.DEFAULT_SYNC_TARGET_GROUP || "iCloud/个人");
    const DEFAULT_REMINDER_TARGET_SOURCE_NAME = String(deps.DEFAULT_REMINDER_TARGET_SOURCE_NAME || "iCloud");
    const DEFAULT_REMINDER_TARGET_LIST_NAME = String(deps.DEFAULT_REMINDER_TARGET_LIST_NAME || "提醒事项");
    const DEFAULT_REMINDER_TARGET_GROUP = String(deps.DEFAULT_REMINDER_TARGET_GROUP || "iCloud/提醒事项");
    const TODO_REMINDER_DEFAULT_LEAD_STORAGE_KEY = String(deps.TODO_REMINDER_DEFAULT_LEAD_STORAGE_KEY || "");
    const TODO_REMINDER_DEFAULT_LEAD_MINUTES = Number.isFinite(Number(deps.TODO_REMINDER_DEFAULT_LEAD_MINUTES))
      ? Number(deps.TODO_REMINDER_DEFAULT_LEAD_MINUTES)
      : 5;
    const TODO_REMINDER_DEFAULT_LEAD_OPTIONS = normalizeList(deps.TODO_REMINDER_DEFAULT_LEAD_OPTIONS)
      .map((item) => Number(item))
      .filter((item) => Number.isFinite(item));
    const EXTERNAL_CALENDAR_LIST_URL = String(deps.EXTERNAL_CALENDAR_LIST_URL || "");
    const EXTERNAL_REMINDER_LIST_URL = String(deps.EXTERNAL_REMINDER_LIST_URL || "");

    const documentRef = deps.documentRef || globalScope.document || null;
    const windowRef = deps.windowRef || globalScope.window || globalScope;
    const localStorageRef = deps.localStorageRef || globalScope.localStorage || null;
    const escapeHtml = requireFunction(deps, "escapeHtml");
    const normalizeExternalCalendarGroupValue = requireFunction(deps, "normalizeExternalCalendarGroupValue");
    const setCalendarSyncStatus = requireFunction(deps, "setCalendarSyncStatus");
    const scheduleAutoBidirectionalSync = requireFunction(deps, "scheduleAutoBidirectionalSync");
    const setActiveView = requireFunction(deps, "setActiveView");
    const renderTopTodoSyncHub = requireFunction(deps, "renderTopTodoSyncHub");
    const getSelectedTodo = requireFunction(deps, "getSelectedTodo");
    const getTodos = requireFunction(deps, "getTodos");
    const saveTodos = requireFunction(deps, "saveTodos");
    const render = requireFunction(deps, "render");
    const isTodoEligibleForReminderSync = requireFunction(deps, "isTodoEligibleForReminderSync");
    const normalizeTodoReminderRepeatValue = requireFunction(deps, "normalizeTodoReminderRepeatValue");
    const todoUsesExplicitReminderDateTime = requireFunction(deps, "todoUsesExplicitReminderDateTime");
    const normalizeTodoReminderDefaultLeadMinutes = requireFunction(deps, "normalizeTodoReminderDefaultLeadMinutes");
    const getTodoReminderLeadLabel = requireFunction(deps, "getTodoReminderLeadLabel");

    const fetchFn =
      typeof deps.fetchFn === "function"
        ? deps.fetchFn
        : typeof globalScope.fetch === "function"
          ? globalScope.fetch.bind(globalScope)
          : null;
    const confirmFn =
      typeof deps.confirmFn === "function"
        ? deps.confirmFn
        : typeof windowRef.confirm === "function"
          ? windowRef.confirm.bind(windowRef)
          : () => true;

    const settingsSyncAllRefreshBtn = deps.settingsSyncAllRefreshBtn || null;
    const settingsSyncCalendarSelect = deps.settingsSyncCalendarSelect || null;
    const settingsSyncCalendarHint = deps.settingsSyncCalendarHint || null;
    const settingsSyncReminderSelect = deps.settingsSyncReminderSelect || null;
    const settingsSyncReminderHint = deps.settingsSyncReminderHint || null;
    const settingsReminderLeadSelect = deps.settingsReminderLeadSelect || null;
    const settingsReminderLeadHint = deps.settingsReminderLeadHint || null;

    let eventsBound = false;
    let syncCalendarTarget = loadSyncCalendarTarget();
    let syncCalendarOptions = [];
    let syncCalendarOptionsLoading = false;
    let syncCalendarOptionsError = "";
    let hasPromptedSyncCalendarTargetSelection = false;
    let syncReminderTarget = loadSyncReminderTarget();
    let syncReminderOptions = [];
    let syncReminderOptionsLoading = false;
    let syncReminderOptionsError = "";
    let todoReminderDefaultLeadMinutes = loadTodoReminderDefaultLeadMinutes();

    function isHtmlSelect(node) {
      return typeof globalScope.HTMLSelectElement !== "undefined" && node instanceof globalScope.HTMLSelectElement;
    }

    function buildCalendarGroup(sourceName, calendarName) {
      const source = String(sourceName || "").trim();
      const name = String(calendarName || "").trim();
      if (source && name) return `${source}/${name}`;
      return source || name || "";
    }

    function normalizeSyncCalendarTarget(raw) {
      const target = raw && typeof raw === "object" ? raw : {};
      const calendarId = String(target.calendarId || target.id || "").trim().slice(0, 260);
      const calendarName = String(target.calendarName || target.name || "").trim().slice(0, 120);
      const sourceName = String(target.sourceName || target.source || "").trim().slice(0, 120);
      const groupRaw = String(target.group || "").trim();
      const group = normalizeExternalCalendarGroupValue(
        groupRaw || buildCalendarGroup(sourceName, calendarName),
      );

      return {
        calendarId,
        calendarName: calendarName || DEFAULT_SYNC_TARGET_CALENDAR_NAME,
        sourceName: sourceName || DEFAULT_SYNC_TARGET_SOURCE_NAME,
        group: group || DEFAULT_SYNC_TARGET_GROUP,
      };
    }

    function createDefaultSyncCalendarTarget() {
      return normalizeSyncCalendarTarget({
        sourceName: DEFAULT_SYNC_TARGET_SOURCE_NAME,
        calendarName: DEFAULT_SYNC_TARGET_CALENDAR_NAME,
      });
    }

    function hasConfirmedSyncCalendarTargetSelection() {
      try {
        return localStorageRef?.getItem(SYNC_CALENDAR_TARGET_CONFIRMED_KEY) === "1";
      } catch {
        return false;
      }
    }

    function markSyncCalendarTargetSelectionConfirmed() {
      try {
        localStorageRef?.setItem(SYNC_CALENDAR_TARGET_CONFIRMED_KEY, "1");
      } catch {
        // ignore storage failures
      }
    }

    function loadSyncCalendarTarget() {
      try {
        const raw = localStorageRef?.getItem(SYNC_CALENDAR_TARGET_STORAGE_KEY);
        if (!raw) return createDefaultSyncCalendarTarget();
        const parsed = JSON.parse(raw);
        return normalizeSyncCalendarTarget(parsed);
      } catch {
        return createDefaultSyncCalendarTarget();
      }
    }

    function saveSyncCalendarTarget(target) {
      const normalized = normalizeSyncCalendarTarget(target);
      try {
        localStorageRef?.setItem(SYNC_CALENDAR_TARGET_STORAGE_KEY, JSON.stringify(normalized));
      } catch {
        // ignore storage failures
      }
    }

    function isSameSyncCalendarTarget(a, b) {
      const left = normalizeSyncCalendarTarget(a);
      const right = normalizeSyncCalendarTarget(b);
      return (
        left.calendarId === right.calendarId &&
        left.calendarName === right.calendarName &&
        left.sourceName === right.sourceName &&
        normalizeExternalCalendarGroupValue(left.group) === normalizeExternalCalendarGroupValue(right.group)
      );
    }

    function getSyncCalendarTargetDisplayText(target = syncCalendarTarget) {
      const normalized = normalizeSyncCalendarTarget(target);
      const source = String(normalized.sourceName || "").trim();
      const name = String(normalized.calendarName || "").trim();
      if (source && name) return `${source}/${name}`;
      return source || name || DEFAULT_SYNC_TARGET_GROUP;
    }

    function normalizeSyncCalendarOption(raw) {
      const item = raw && typeof raw === "object" ? raw : {};
      const normalized = normalizeSyncCalendarTarget(item);
      return {
        calendarId: normalized.calendarId,
        calendarName: normalized.calendarName,
        sourceName: normalized.sourceName,
        group: normalized.group,
        isDefault: Boolean(item.isDefault),
        displayName: getSyncCalendarTargetDisplayText(normalized),
      };
    }

    function findMatchingSyncCalendarOption(target, options = syncCalendarOptions) {
      const normalizedTarget = normalizeSyncCalendarTarget(target);
      const list = Array.isArray(options) ? options : [];
      if (!list.length) return null;

      if (normalizedTarget.calendarId) {
        const matchedById = list.find((item) => String(item.calendarId || "").trim() === normalizedTarget.calendarId);
        if (matchedById) return matchedById;
      }

      const normalizedGroup = normalizeExternalCalendarGroupValue(normalizedTarget.group);
      if (normalizedGroup) {
        const matchedByGroup = list.find(
          (item) => normalizeExternalCalendarGroupValue(item.group) === normalizedGroup,
        );
        if (matchedByGroup) return matchedByGroup;
      }

      const fallbackByName = list.find(
        (item) =>
          String(item.calendarName || "").trim() === normalizedTarget.calendarName &&
          String(item.sourceName || "").trim() === normalizedTarget.sourceName,
      );
      if (fallbackByName) return fallbackByName;

      const defaultPersonal = list.find(
        (item) => normalizeExternalCalendarGroupValue(item.group) === normalizeExternalCalendarGroupValue(DEFAULT_SYNC_TARGET_GROUP),
      );
      if (defaultPersonal) return defaultPersonal;

      const defaultItem = list.find((item) => Boolean(item.isDefault));
      if (defaultItem) return defaultItem;

      return list[0] || null;
    }

    function getSyncCalendarTargetPayload() {
      const resolved = findMatchingSyncCalendarOption(syncCalendarTarget, syncCalendarOptions) || syncCalendarTarget;
      const normalized = normalizeSyncCalendarTarget(resolved);
      return {
        calendarId: normalized.calendarId,
        calendarName: normalized.calendarName,
        sourceName: normalized.sourceName,
        group: normalized.group,
      };
    }

    function maybePromptSyncCalendarTargetSelection() {
      if (hasPromptedSyncCalendarTargetSelection) return;
      if (typeof windowRef === "undefined") return;
      if (windowRef.location?.protocol === "file:") return;
      if (hasConfirmedSyncCalendarTargetSelection()) return;

      const resolvedTarget = findMatchingSyncCalendarOption(syncCalendarTarget, syncCalendarOptions) || syncCalendarTarget;
      const displayText = getSyncCalendarTargetDisplayText(resolvedTarget);
      hasPromptedSyncCalendarTargetSelection = true;

      const confirmed = confirmFn(
        `首次打开项目，请先确认“同步目标日历”。\n当前目标：${displayText}\n\n点击“确定”继续使用当前目标，点击“取消”前往设置切换。`,
      );
      if (confirmed) {
        markSyncCalendarTargetSelectionConfirmed();
        setCalendarSyncStatus(`已确认同步目标：${displayText}。`, "success");
        return;
      }

      setCalendarSyncStatus("请先在设置中选择同步目标日历，再继续同步。", "warning");
      setActiveView("settings");
      if (settingsSyncCalendarSelect) {
        settingsSyncCalendarSelect.focus();
      }
    }

    function renderSettingsSyncRefreshButtonState() {
      if (!settingsSyncAllRefreshBtn) return;
      const isLoading = Boolean(syncCalendarOptionsLoading || syncReminderOptionsLoading);
      settingsSyncAllRefreshBtn.disabled = isLoading;
      settingsSyncAllRefreshBtn.textContent = isLoading ? "刷新中…" : "刷新列表";
    }

    function renderSettingsSyncCalendarControls() {
      if (!settingsSyncCalendarSelect) return;
      const options = Array.isArray(syncCalendarOptions) ? syncCalendarOptions : [];
      const selected = findMatchingSyncCalendarOption(syncCalendarTarget, options);

      const fallbackOption = normalizeSyncCalendarOption(syncCalendarTarget);
      const renderOptions = options.length ? options : [fallbackOption];

      settingsSyncCalendarSelect.innerHTML = renderOptions
        .map((item, index) => {
          const value = String(item.calendarId || item.group || `fallback-${index}`);
          const isSelected =
            selected
              ? String(selected.calendarId || selected.group) === value
              : index === 0;
          return `<option value="${escapeHtml(value)}" ${isSelected ? "selected" : ""}>${escapeHtml(item.displayName || getSyncCalendarTargetDisplayText(item))}</option>`;
        })
        .join("");

      settingsSyncCalendarSelect.disabled = syncCalendarOptionsLoading;
      renderSettingsSyncRefreshButtonState();

      if (settingsSyncCalendarHint) {
        if (syncCalendarOptionsLoading) {
          settingsSyncCalendarHint.textContent = "正在读取可写日历列表…";
        } else if (syncCalendarOptionsError) {
          settingsSyncCalendarHint.textContent = syncCalendarOptionsError;
        } else if (renderOptions.length > 0) {
          settingsSyncCalendarHint.textContent = `当前：${getSyncCalendarTargetDisplayText(selected || syncCalendarTarget)}。切换后自动迁移待办。`;
        } else {
          settingsSyncCalendarHint.textContent = "未读取到可写日历。";
        }
      }
    }

    function markTodosDirtyForSyncCalendarMigration() {
      const todos = getTodos();
      const nowIso = new Date().toISOString();
      let changed = 0;

      for (const todo of todos) {
        if (!todo || todo.completed) continue;
        if (String(todo.syncState || "").trim() === "dirty") continue;

        todo.syncState = "dirty";
        todo.calendarSynced = false;
        todo.lastSyncError = "";
        todo.updatedAt = nowIso;
        changed += 1;
      }

      if (changed > 0) {
        saveTodos(todos);
        render();
      }
      return changed;
    }

    function applySyncCalendarTarget(nextTarget, { triggerMigration = false, showStatus = false } = {}) {
      const normalizedNext = normalizeSyncCalendarTarget(nextTarget);
      const changed = !isSameSyncCalendarTarget(syncCalendarTarget, normalizedNext);
      syncCalendarTarget = normalizedNext;
      saveSyncCalendarTarget(syncCalendarTarget);
      renderSettingsSyncCalendarControls();

      if (!changed) return false;
      if (triggerMigration) {
        const affected = markTodosDirtyForSyncCalendarMigration();
        if (showStatus) {
          setCalendarSyncStatus(
            `已切换同步日历：${getSyncCalendarTargetDisplayText(syncCalendarTarget)}，待迁移 ${affected} 项。`,
            affected > 0 ? "warning" : "muted",
          );
        }
        scheduleAutoBidirectionalSync("sync-target-changed", 300);
      }
      return true;
    }

    function findSyncCalendarOptionByValue(value) {
      const token = String(value || "").trim();
      if (!token) return null;
      return (
        syncCalendarOptions.find(
          (item) =>
            String(item.calendarId || "").trim() === token ||
            String(item.group || "").trim() === token,
        ) || null
      );
    }

    async function refreshSyncCalendarOptions({ manual = false } = {}) {
      if (typeof windowRef !== "undefined" && windowRef.location?.protocol === "file:") {
        syncCalendarOptions = [];
        syncCalendarOptionsError = "请通过本地服务启动后读取日历列表。";
        renderSettingsSyncCalendarControls();
        return false;
      }

      if (!fetchFn || !EXTERNAL_CALENDAR_LIST_URL) {
        syncCalendarOptions = [];
        syncCalendarOptionsError = "同步服务暂不支持读取日历列表。";
        renderSettingsSyncCalendarControls();
        return false;
      }

      syncCalendarOptionsLoading = true;
      syncCalendarOptionsError = "";
      renderSettingsSyncCalendarControls();

      try {
        const response = await fetchFn(`${EXTERNAL_CALENDAR_LIST_URL}?t=${Date.now()}`, { cache: "no-store" });
        if (!response.ok) {
          throw new Error(response.status === 404 ? "CALENDAR_LIST_UNAVAILABLE" : `HTTP_${response.status}`);
        }

        const data = await response.json();
        const listRaw = Array.isArray(data?.result?.calendars) ? data.result.calendars : [];
        const normalized = listRaw
          .map(normalizeSyncCalendarOption)
          .filter((item) => String(item.calendarName || "").trim());

        syncCalendarOptions = normalized;
        syncCalendarOptionsError = normalized.length ? "" : "未读取到可写日历，已回退默认。";
        const resolved = findMatchingSyncCalendarOption(syncCalendarTarget, syncCalendarOptions) || syncCalendarTarget;
        applySyncCalendarTarget(resolved, { triggerMigration: false, showStatus: false });

        if (manual) {
          setCalendarSyncStatus(
            normalized.length
              ? `已刷新同步目标列表，共 ${normalized.length} 个可写日历。`
              : "未读取到可写日历，请检查权限。",
            normalized.length ? "success" : "warning",
          );
        }
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : "UNKNOWN";
        syncCalendarOptionsError =
          message === "CALENDAR_LIST_UNAVAILABLE"
            ? "同步服务暂不支持读取日历列表。"
            : "读取日历列表失败，请检查 Calendar 权限。";
        if (manual) {
          setCalendarSyncStatus(syncCalendarOptionsError, "warning");
        }
        return false;
      } finally {
        syncCalendarOptionsLoading = false;
        renderSettingsSyncCalendarControls();
        if (!manual) {
          maybePromptSyncCalendarTargetSelection();
        }
      }
    }

    function normalizeSyncReminderTarget(raw) {
      const target = raw && typeof raw === "object" ? raw : {};
      const calendarId = String(target.calendarId || target.id || "").trim().slice(0, 260);
      const calendarName = String(target.calendarName || target.name || "").trim().slice(0, 120);
      const sourceName = String(target.sourceName || target.source || "").trim().slice(0, 120);
      const groupRaw = String(target.group || "").trim();
      const group = normalizeExternalCalendarGroupValue(
        groupRaw || buildCalendarGroup(sourceName, calendarName),
      );

      return {
        calendarId,
        calendarName: calendarName || DEFAULT_REMINDER_TARGET_LIST_NAME,
        sourceName: sourceName || DEFAULT_REMINDER_TARGET_SOURCE_NAME,
        group: group || DEFAULT_REMINDER_TARGET_GROUP,
      };
    }

    function createDefaultSyncReminderTarget() {
      return normalizeSyncReminderTarget({
        sourceName: DEFAULT_REMINDER_TARGET_SOURCE_NAME,
        calendarName: DEFAULT_REMINDER_TARGET_LIST_NAME,
      });
    }

    function loadSyncReminderTarget() {
      try {
        const raw = localStorageRef?.getItem(SYNC_REMINDER_TARGET_STORAGE_KEY);
        if (!raw) return createDefaultSyncReminderTarget();
        const parsed = JSON.parse(raw);
        return normalizeSyncReminderTarget(parsed);
      } catch {
        return createDefaultSyncReminderTarget();
      }
    }

    function saveSyncReminderTarget(target) {
      const normalized = normalizeSyncReminderTarget(target);
      try {
        localStorageRef?.setItem(SYNC_REMINDER_TARGET_STORAGE_KEY, JSON.stringify(normalized));
      } catch {
        // ignore storage failures
      }
    }

    function isSameSyncReminderTarget(a, b) {
      const left = normalizeSyncReminderTarget(a);
      const right = normalizeSyncReminderTarget(b);
      return (
        left.calendarId === right.calendarId &&
        left.calendarName === right.calendarName &&
        left.sourceName === right.sourceName &&
        normalizeExternalCalendarGroupValue(left.group) === normalizeExternalCalendarGroupValue(right.group)
      );
    }

    function getSyncReminderTargetDisplayText(target = syncReminderTarget) {
      const normalized = normalizeSyncReminderTarget(target);
      const source = String(normalized.sourceName || "").trim();
      const name = String(normalized.calendarName || "").trim();
      if (source && name) return `${source}/${name}`;
      return source || name || DEFAULT_REMINDER_TARGET_GROUP;
    }

    function normalizeSyncReminderOption(raw) {
      const item = raw && typeof raw === "object" ? raw : {};
      const normalized = normalizeSyncReminderTarget(item);
      return {
        calendarId: normalized.calendarId,
        calendarName: normalized.calendarName,
        sourceName: normalized.sourceName,
        group: normalized.group,
        isDefault: Boolean(item.isDefault),
        displayName: getSyncReminderTargetDisplayText(normalized),
      };
    }

    function findMatchingSyncReminderOption(target, options = syncReminderOptions) {
      const normalizedTarget = normalizeSyncReminderTarget(target);
      const list = Array.isArray(options) ? options : [];
      if (!list.length) return null;

      if (normalizedTarget.calendarId) {
        const matchedById = list.find((item) => String(item.calendarId || "").trim() === normalizedTarget.calendarId);
        if (matchedById) return matchedById;
      }

      const normalizedGroup = normalizeExternalCalendarGroupValue(normalizedTarget.group);
      if (normalizedGroup) {
        const matchedByGroup = list.find(
          (item) => normalizeExternalCalendarGroupValue(item.group) === normalizedGroup,
        );
        if (matchedByGroup) return matchedByGroup;
      }

      const fallbackByName = list.find(
        (item) =>
          String(item.calendarName || "").trim() === normalizedTarget.calendarName &&
          String(item.sourceName || "").trim() === normalizedTarget.sourceName,
      );
      if (fallbackByName) return fallbackByName;

      const defaultItem = list.find((item) => Boolean(item.isDefault));
      if (defaultItem) return defaultItem;

      return list[0] || null;
    }

    function findSyncReminderOptionByValue(value) {
      const token = String(value || "").trim();
      if (!token) return null;
      return (
        syncReminderOptions.find(
          (item) =>
            String(item.calendarId || "").trim() === token ||
            String(item.group || "").trim() === token,
        ) || null
      );
    }

    function getSyncReminderTargetPayload() {
      const resolved = findMatchingSyncReminderOption(syncReminderTarget, syncReminderOptions) || syncReminderTarget;
      const normalized = normalizeSyncReminderTarget(resolved);
      return {
        calendarId: normalized.calendarId,
        calendarName: normalized.calendarName,
        sourceName: normalized.sourceName,
        group: normalized.group,
      };
    }

    function loadTodoReminderDefaultLeadMinutes() {
      try {
        const raw = localStorageRef?.getItem(TODO_REMINDER_DEFAULT_LEAD_STORAGE_KEY);
        if (raw === null) return TODO_REMINDER_DEFAULT_LEAD_MINUTES;
        return normalizeTodoReminderDefaultLeadMinutes(raw);
      } catch {
        return TODO_REMINDER_DEFAULT_LEAD_MINUTES;
      }
    }

    function saveTodoReminderDefaultLeadMinutes(value) {
      const normalized = normalizeTodoReminderDefaultLeadMinutes(value);
      try {
        localStorageRef?.setItem(TODO_REMINDER_DEFAULT_LEAD_STORAGE_KEY, String(normalized));
      } catch {
        // ignore storage failures
      }
    }

    function getTodoReminderDefaultLeadMinutes() {
      return normalizeTodoReminderDefaultLeadMinutes(todoReminderDefaultLeadMinutes);
    }

    function renderSettingsReminderLeadControls() {
      if (!isHtmlSelect(settingsReminderLeadSelect)) return;
      const current = getTodoReminderDefaultLeadMinutes();
      settingsReminderLeadSelect.innerHTML = TODO_REMINDER_DEFAULT_LEAD_OPTIONS
        .map((option) => {
          const selected = option === current ? "selected" : "";
          return `<option value="${option}" ${selected}>${escapeHtml(getTodoReminderLeadLabel(option))}</option>`;
        })
        .join("");

      if (settingsReminderLeadHint) {
        settingsReminderLeadHint.textContent =
          current <= 0
            ? "未填具体提醒时，不提前。"
            : `未填具体提醒时，默认提前 ${current} 分钟。`;
      }
    }

    function markTodosDirtyForReminderLeadMigration() {
      const todos = getTodos();
      const nowIso = new Date().toISOString();
      let changed = 0;

      for (const todo of todos) {
        if (!isTodoEligibleForReminderSync(todo)) continue;
        if (normalizeTodoReminderRepeatValue(todo.repeat) === "none") continue;
        if (todoUsesExplicitReminderDateTime(todo)) continue;
        if (String(todo.reminderSyncState || "").trim() === "dirty") continue;

        todo.reminderSynced = false;
        todo.reminderSyncState = "dirty";
        todo.reminderLastSyncError = "";
        todo.updatedAt = nowIso;
        changed += 1;
      }

      if (changed > 0) {
        saveTodos(todos);
        render();
      }
      return changed;
    }

    function applyTodoReminderDefaultLeadMinutes(nextValue, { triggerMigration = false, showStatus = false } = {}) {
      const normalized = normalizeTodoReminderDefaultLeadMinutes(nextValue);
      const changed = normalized !== getTodoReminderDefaultLeadMinutes();
      todoReminderDefaultLeadMinutes = normalized;
      saveTodoReminderDefaultLeadMinutes(todoReminderDefaultLeadMinutes);
      renderSettingsReminderLeadControls();

      if (!changed) return false;
      if (triggerMigration) {
        const affected = markTodosDirtyForReminderLeadMigration();
        if (showStatus) {
          setCalendarSyncStatus(
            `默认提醒改为“${getTodoReminderLeadLabel(todoReminderDefaultLeadMinutes)}”，待迁移 ${affected} 项。`,
            affected > 0 ? "warning" : "muted",
          );
        }
        scheduleAutoBidirectionalSync("reminder-lead-changed", 300);
      }
      return true;
    }

    function renderSettingsSyncReminderControls() {
      if (!settingsSyncReminderSelect) return;
      const options = Array.isArray(syncReminderOptions) ? syncReminderOptions : [];
      const selected = findMatchingSyncReminderOption(syncReminderTarget, options);
      const fallbackOption = normalizeSyncReminderOption(syncReminderTarget);
      const renderOptions = options.length ? options : [fallbackOption];

      settingsSyncReminderSelect.innerHTML = renderOptions
        .map((item, index) => {
          const value = String(item.calendarId || item.group || `fallback-${index}`);
          const isSelected =
            selected
              ? String(selected.calendarId || selected.group) === value
              : index === 0;
          return `<option value="${escapeHtml(value)}" ${isSelected ? "selected" : ""}>${escapeHtml(item.displayName || getSyncReminderTargetDisplayText(item))}</option>`;
        })
        .join("");

      settingsSyncReminderSelect.disabled = syncReminderOptionsLoading;
      renderSettingsSyncRefreshButtonState();

      if (settingsSyncReminderHint) {
        if (syncReminderOptionsLoading) {
          settingsSyncReminderHint.textContent = "正在读取可写提醒列表…";
        } else if (syncReminderOptionsError) {
          settingsSyncReminderHint.textContent = syncReminderOptionsError;
        } else if (renderOptions.length > 0) {
          settingsSyncReminderHint.textContent = `当前：${getSyncReminderTargetDisplayText(selected || syncReminderTarget)}。切换后自动迁移提醒。`;
        } else {
          settingsSyncReminderHint.textContent = "未读取到可写提醒列表。";
        }
      }
      renderSettingsReminderLeadControls();
    }

    function markTodosDirtyForSyncReminderMigration() {
      const todos = getTodos();
      const nowIso = new Date().toISOString();
      let changed = 0;

      for (const todo of todos) {
        if (!isTodoEligibleForReminderSync(todo)) continue;
        if (normalizeTodoReminderRepeatValue(todo.repeat) === "none") continue;
        if (String(todo.reminderSyncState || "").trim() === "dirty") continue;
        todo.reminderSynced = false;
        todo.reminderSyncState = "dirty";
        todo.reminderLastSyncError = "";
        todo.updatedAt = nowIso;
        changed += 1;
      }

      if (changed > 0) {
        saveTodos(todos);
        render();
      }
      return changed;
    }

    function applySyncReminderTarget(nextTarget, { triggerMigration = false, showStatus = false } = {}) {
      const normalizedNext = normalizeSyncReminderTarget(nextTarget);
      const changed = !isSameSyncReminderTarget(syncReminderTarget, normalizedNext);
      syncReminderTarget = normalizedNext;
      saveSyncReminderTarget(syncReminderTarget);
      renderSettingsSyncReminderControls();

      if (!changed) return false;
      if (triggerMigration) {
        const affected = markTodosDirtyForSyncReminderMigration();
        if (showStatus) {
          setCalendarSyncStatus(
            `已切换提醒列表：${getSyncReminderTargetDisplayText(syncReminderTarget)}，待迁移 ${affected} 项。`,
            affected > 0 ? "warning" : "muted",
          );
        }
        scheduleAutoBidirectionalSync("reminder-target-changed", 300);
      }
      return true;
    }

    async function refreshSyncReminderOptions({ manual = false } = {}) {
      if (typeof windowRef !== "undefined" && windowRef.location?.protocol === "file:") {
        syncReminderOptions = [];
        syncReminderOptionsError = "请通过本地服务启动后读取提醒列表。";
        renderSettingsSyncReminderControls();
        return false;
      }

      if (!fetchFn || !EXTERNAL_REMINDER_LIST_URL) {
        syncReminderOptions = [];
        syncReminderOptionsError = "同步服务暂不支持读取提醒列表。";
        renderSettingsSyncReminderControls();
        return false;
      }

      syncReminderOptionsLoading = true;
      syncReminderOptionsError = "";
      renderSettingsSyncReminderControls();

      try {
        const response = await fetchFn(`${EXTERNAL_REMINDER_LIST_URL}?t=${Date.now()}`, { cache: "no-store" });
        if (!response.ok) {
          throw new Error(response.status === 404 ? "REMINDER_LIST_UNAVAILABLE" : `HTTP_${response.status}`);
        }

        const data = await response.json();
        const listRaw = Array.isArray(data?.result?.calendars) ? data.result.calendars : [];
        const normalized = listRaw
          .map(normalizeSyncReminderOption)
          .filter((item) => String(item.calendarName || "").trim());

        syncReminderOptions = normalized;
        syncReminderOptionsError = normalized.length ? "" : "未读取到可写提醒列表，已回退默认。";
        const resolved = findMatchingSyncReminderOption(syncReminderTarget, syncReminderOptions) || syncReminderTarget;
        applySyncReminderTarget(resolved, { triggerMigration: false, showStatus: false });

        if (manual) {
          setCalendarSyncStatus(
            normalized.length
              ? `已刷新提醒列表，共 ${normalized.length} 个可写列表。`
              : "未读取到可写提醒列表，请检查权限。",
            normalized.length ? "success" : "warning",
          );
        }
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : "UNKNOWN";
        syncReminderOptionsError =
          message === "REMINDER_LIST_UNAVAILABLE"
            ? "同步服务暂不支持读取提醒列表。"
            : "读取提醒列表失败，请检查 Reminders 权限。";
        if (manual) {
          setCalendarSyncStatus(syncReminderOptionsError, "warning");
        }
        return false;
      } finally {
        syncReminderOptionsLoading = false;
        renderSettingsSyncReminderControls();
      }
    }

    async function refreshAllSettingsSyncOptions({ manual = false } = {}) {
      const [calendarResult, reminderResult] = await Promise.allSettled([
        refreshSyncCalendarOptions({ manual: false }),
        refreshSyncReminderOptions({ manual: false }),
      ]);

      const calendarOk = calendarResult.status === "fulfilled" && Boolean(calendarResult.value);
      const reminderOk = reminderResult.status === "fulfilled" && Boolean(reminderResult.value);

      if (manual) {
        if (calendarOk && reminderOk) {
          setCalendarSyncStatus("已刷新日历与提醒列表。", "success");
        } else if (calendarOk || reminderOk) {
          setCalendarSyncStatus("已部分刷新列表，请检查 Calendar / Reminders 权限。", "warning");
        } else {
          setCalendarSyncStatus("刷新列表失败，请检查 Calendar / Reminders 权限。", "warning");
        }
      }

      return calendarOk && reminderOk;
    }

    function renderControls() {
      renderSettingsSyncCalendarControls();
      renderSettingsSyncReminderControls();
    }

    function init() {
      renderControls();
      void refreshSyncCalendarOptions({ manual: false });
      void refreshSyncReminderOptions({ manual: false });
    }

    function ensureOptionsLoadedForSettingsView() {
      renderControls();
      if (!syncCalendarOptionsLoading && syncCalendarOptions.length === 0) {
        void refreshSyncCalendarOptions({ manual: false });
      }
      if (!syncReminderOptionsLoading && syncReminderOptions.length === 0) {
        void refreshSyncReminderOptions({ manual: false });
      }
    }

    function bindEvents() {
      if (eventsBound) return;
      eventsBound = true;

      if (settingsSyncAllRefreshBtn) {
        settingsSyncAllRefreshBtn.addEventListener("click", () => {
          void refreshAllSettingsSyncOptions({ manual: true });
        });
      }
      if (settingsSyncCalendarSelect) {
        settingsSyncCalendarSelect.addEventListener("change", (event) => {
          const target = event.target;
          if (!isHtmlSelect(target)) return;
          const option =
            findSyncCalendarOptionByValue(target.value) ||
            normalizeSyncCalendarTarget({ group: String(target.value || "").trim() });
          const changed = applySyncCalendarTarget(option, { triggerMigration: true, showStatus: true });
          markSyncCalendarTargetSelectionConfirmed();
          if (!changed) return;
          renderTopTodoSyncHub(getSelectedTodo());
        });
      }
      if (settingsSyncReminderSelect) {
        settingsSyncReminderSelect.addEventListener("change", (event) => {
          const target = event.target;
          if (!isHtmlSelect(target)) return;
          const option =
            findSyncReminderOptionByValue(target.value) ||
            normalizeSyncReminderTarget({ group: String(target.value || "").trim() });
          const changed = applySyncReminderTarget(option, { triggerMigration: true, showStatus: true });
          if (!changed) return;
          renderTopTodoSyncHub(getSelectedTodo());
        });
      }
      if (settingsReminderLeadSelect) {
        settingsReminderLeadSelect.addEventListener("change", (event) => {
          const target = event.target;
          if (!isHtmlSelect(target)) return;
          const changed = applyTodoReminderDefaultLeadMinutes(target.value, {
            triggerMigration: true,
            showStatus: true,
          });
          if (!changed) return;
          renderTopTodoSyncHub(getSelectedTodo());
        });
      }
    }

    return {
      init,
      bindEvents,
      renderControls,
      ensureOptionsLoadedForSettingsView,
      refreshAllSettingsSyncOptions,
      refreshSyncCalendarOptions,
      refreshSyncReminderOptions,
      normalizeCalendarTarget: normalizeSyncCalendarTarget,
      getCalendarTarget: () => normalizeSyncCalendarTarget(syncCalendarTarget),
      getCalendarTargetPayload: getSyncCalendarTargetPayload,
      getReminderTargetPayload: getSyncReminderTargetPayload,
      getReminderDefaultLeadMinutes: getTodoReminderDefaultLeadMinutes,
      normalizeReminderLeadMinutes: normalizeTodoReminderDefaultLeadMinutes,
    };
  }

  globalScope.TimeQualitySyncSettingsModule = {
    createSyncSettingsModule,
  };
  globalScope.createSyncSettingsModule = createSyncSettingsModule;
})(typeof window !== "undefined" ? window : globalThis);
