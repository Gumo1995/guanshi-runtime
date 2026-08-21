(function attachTimeQualitySettingsModule(globalScope) {
  if (!globalScope) return;

  function requireFunction(deps, key) {
    const value = deps[key];
    if (typeof value !== "function") {
      throw new Error(`TimeQualitySettingsModule missing required function dependency: ${key}`);
    }
    return value;
  }

  function normalizeList(value) {
    return Array.isArray(value) ? value : [];
  }

  function createSettingsModule(deps = {}) {
    const CATEGORY_STORAGE_KEY = String(deps.CATEGORY_STORAGE_KEY || "time_quality_categories_v1");
    const QUOTE_POOL_KEY = String(deps.QUOTE_POOL_KEY || "time_quality_quote_pool_v1");
    const QUOTE_LIBRARY_KEY = String(deps.QUOTE_LIBRARY_KEY || "time_quality_quote_library_v1");
    const DATA_EXPORT_SCHEMA = String(deps.DATA_EXPORT_SCHEMA || "timequality-local-storage-export-v1");
    const DATA_EXPORT_STORAGE_PREFIX = String(deps.DATA_EXPORT_STORAGE_PREFIX || "time_quality_");
    const RUNTIME_CONFIG_URL = String(deps.RUNTIME_CONFIG_URL || "/api/runtime/config");
    const CACHE_RESET_ONCE_KEY = String(deps.CACHE_RESET_ONCE_KEY || "time_quality_cache_reset_once_v2");
    const SETTINGS_TAB_STORAGE_KEY = String(deps.SETTINGS_TAB_STORAGE_KEY || "time_quality_settings_tab_v1");
    const SETTINGS_TAB_IDS = ["ai-connect", "memory", "capabilities", "sync", "app", "preferences"];
    const DEFAULT_CATEGORIES = normalizeList(deps.DEFAULT_CATEGORIES).map((item) => String(item));
    const MOTIVATION_QUOTES = normalizeList(deps.MOTIVATION_QUOTES).map((item) => ({
      text: String(item?.text || ""),
      author: String(item?.author || ""),
    }));

    const documentRef = deps.documentRef || globalScope.document || null;
    const windowRef = deps.windowRef || globalScope.window || globalScope;
    const localStorageRef = deps.localStorageRef || globalScope.localStorage || null;
    const escapeHtml = requireFunction(deps, "escapeHtml");
    const getActiveView = requireFunction(deps, "getActiveView");
    const getCategories = requireFunction(deps, "getCategories");
    const setCategories = requireFunction(deps, "setCategories");
    const getMotivationQuotes = requireFunction(deps, "getMotivationQuotes");
    const setMotivationQuotes = requireFunction(deps, "setMotivationQuotes");
    const getQuoteState = requireFunction(deps, "getQuoteState");
    const setQuoteState = requireFunction(deps, "setQuoteState");
    const getEntries = requireFunction(deps, "getEntries");
    const getTodos = requireFunction(deps, "getTodos");
    const render = requireFunction(deps, "render");
    const syncTodoCategoryTriggerLabel = requireFunction(deps, "syncTodoCategoryTriggerLabel");
    const updateTodoCategorySuggestionOptions = requireFunction(deps, "updateTodoCategorySuggestionOptions");
    const isTodoCategorySuggestionMenuOpen = requireFunction(deps, "isTodoCategorySuggestionMenuOpen");
    const scheduleLocalDataBackup =
      typeof deps.scheduleLocalDataBackup === "function" ? deps.scheduleLocalDataBackup : () => {};
    const backupLocalDataNow =
      typeof deps.backupLocalDataNow === "function"
        ? deps.backupLocalDataNow
        : () => Promise.resolve({ ok: false, skipped: "unavailable" });
    const fetchFn =
      typeof deps.fetchFn === "function"
        ? deps.fetchFn
        : typeof windowRef.fetch === "function"
          ? windowRef.fetch.bind(windowRef)
          : null;

    const alertFn =
      typeof deps.alertFn === "function"
        ? deps.alertFn
        : typeof windowRef.alert === "function"
          ? windowRef.alert.bind(windowRef)
          : () => {};
    const confirmFn =
      typeof deps.confirmFn === "function"
        ? deps.confirmFn
        : typeof windowRef.confirm === "function"
          ? windowRef.confirm.bind(windowRef)
          : () => false;
    const setTimeoutFn =
      typeof deps.setTimeoutFn === "function"
        ? deps.setTimeoutFn
        : typeof windowRef.setTimeout === "function"
          ? windowRef.setTimeout.bind(windowRef)
          : globalScope.setTimeout.bind(globalScope);
    const reloadPage =
      typeof deps.reloadPage === "function"
        ? deps.reloadPage
        : () => {
          if (windowRef.location && typeof windowRef.location.reload === "function") {
            windowRef.location.reload();
          }
        };

    const heroQuote = deps.heroQuote || null;
    const pomodoroCategory = deps.pomodoroCategory || null;
    const todoCategoryInput = deps.todoCategoryInput || null;
    const calendarEventEditCategory = deps.calendarEventEditCategory || null;
    const settingsCategoryList = deps.settingsCategoryList || null;
    const settingsCategoryAddInput = deps.settingsCategoryAddInput || null;
    const settingsCategoryAddBtn = deps.settingsCategoryAddBtn || null;
    const settingsCategoryResetBtn = deps.settingsCategoryResetBtn || null;
    const settingsQuoteEditor = deps.settingsQuoteEditor || null;
    const settingsQuoteSaveBtn = deps.settingsQuoteSaveBtn || null;
    const settingsQuoteResetBtn = deps.settingsQuoteResetBtn || null;
    const settingsQuoteStatus = deps.settingsQuoteStatus || null;
    const settingsDataExportBtn = deps.settingsDataExportBtn || null;
    const settingsDataImportBtn = deps.settingsDataImportBtn || null;
    const settingsDataImportInput = deps.settingsDataImportInput || null;
    const settingsDataStatus = deps.settingsDataStatus || null;
    const settingsRuntimePortInput = deps.settingsRuntimePortInput || null;
    const settingsRuntimePortSaveBtn = deps.settingsRuntimePortSaveBtn || null;
    const settingsRuntimePortStatus = deps.settingsRuntimePortStatus || null;

    let eventsBound = false;
    let activeSettingsTab = loadSettingsTab();

    function isHtmlSelect(node) {
      return typeof globalScope.HTMLSelectElement !== "undefined" && node instanceof globalScope.HTMLSelectElement;
    }

    function isHtmlInput(node) {
      return typeof globalScope.HTMLInputElement !== "undefined" && node instanceof globalScope.HTMLInputElement;
    }

    function isHtmlElement(node) {
      return typeof globalScope.HTMLElement !== "undefined" && node instanceof globalScope.HTMLElement;
    }

    function isElement(node) {
      return typeof globalScope.Element !== "undefined" && node instanceof globalScope.Element;
    }

    function normalizeSettingsTab(value) {
      const text = String(value || "").trim();
      return SETTINGS_TAB_IDS.includes(text) ? text : SETTINGS_TAB_IDS[0];
    }

    function loadSettingsTab() {
      try {
        return normalizeSettingsTab(localStorageRef?.getItem(SETTINGS_TAB_STORAGE_KEY));
      } catch {
        return SETTINGS_TAB_IDS[0];
      }
    }

    function saveSettingsTab(value) {
      try {
        localStorageRef?.setItem(SETTINGS_TAB_STORAGE_KEY, normalizeSettingsTab(value));
      } catch {
        // ignore storage failures
      }
    }

    function getSettingsTabButtons() {
      if (!documentRef?.querySelectorAll) return [];
      return Array.from(documentRef.querySelectorAll("[data-settings-tab-target]"));
    }

    function getSettingsTabPanels() {
      if (!documentRef?.querySelectorAll) return [];
      return Array.from(documentRef.querySelectorAll("[data-settings-page]"));
    }

    function renderSettingsTabs() {
      activeSettingsTab = normalizeSettingsTab(activeSettingsTab);

      for (const button of getSettingsTabButtons()) {
        const tabId = normalizeSettingsTab(button.dataset?.settingsTabTarget);
        const isActive = tabId === activeSettingsTab;
        button.classList?.toggle("is-active", isActive);
        button.setAttribute?.("aria-selected", isActive ? "true" : "false");
        button.setAttribute?.("tabindex", isActive ? "0" : "-1");
      }

      for (const panel of getSettingsTabPanels()) {
        const tabId = normalizeSettingsTab(panel.dataset?.settingsPage);
        const isActive = tabId === activeSettingsTab;
        panel.hidden = !isActive;
        panel.classList?.toggle("is-active", isActive);
      }

      return activeSettingsTab;
    }

    function focusSettingsTabButton(tabId) {
      const normalized = normalizeSettingsTab(tabId);
      const button = getSettingsTabButtons().find((item) => normalizeSettingsTab(item.dataset?.settingsTabTarget) === normalized);
      button?.focus?.();
    }

    function scrollSettingsPanelToTop(options = {}) {
      const panel = documentRef?.querySelector?.(".settings-panel");
      if (!panel) return;
      if (typeof panel.scrollTo === "function") {
        panel.scrollTo({ top: 0, behavior: options.smooth === false ? "auto" : "smooth" });
        return;
      }
      panel.scrollTop = 0;
    }

    function setActiveSettingsTab(tabId, options = {}) {
      const next = normalizeSettingsTab(tabId);
      const changed = activeSettingsTab !== next;
      activeSettingsTab = next;
      saveSettingsTab(next);
      renderSettingsTabs();
      if (options.focus) focusSettingsTabButton(next);
      if (options.scroll && changed && getActiveView() === "settings") scrollSettingsPanelToTop(options);
      return next;
    }

    function handleSettingsTabClick(event) {
      const button = event?.currentTarget || (isElement(event?.target) ? event.target.closest("[data-settings-tab-target]") : null);
      if (!button) return;
      setActiveSettingsTab(button.dataset?.settingsTabTarget, { scroll: true });
    }

    function handleSettingsTabKeydown(event) {
      const key = String(event?.key || "");
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(key)) return;

      const buttons = getSettingsTabButtons();
      if (!buttons.length) return;
      const currentIndex = Math.max(0, buttons.indexOf(event.currentTarget));
      let nextIndex = currentIndex;
      if (key === "Home") nextIndex = 0;
      if (key === "End") nextIndex = buttons.length - 1;
      if (key === "ArrowLeft") nextIndex = (currentIndex + buttons.length - 1) % buttons.length;
      if (key === "ArrowRight") nextIndex = (currentIndex + 1) % buttons.length;

      event.preventDefault?.();
      setActiveSettingsTab(buttons[nextIndex]?.dataset?.settingsTabTarget, { focus: true, scroll: true });
    }

    function initSettingsTabs() {
      activeSettingsTab = loadSettingsTab();
      renderSettingsTabs();
    }

    function getActiveSettingsTab() {
      return normalizeSettingsTab(activeSettingsTab);
    }

    function normalizeCategoryName(value) {
      return String(value || "").trim().replace(/\s+/g, " ").slice(0, 20);
    }

    function normalizeCategoryList(value) {
      const source = Array.isArray(value) ? value : [];
      const unique = [];
      const seen = new Set();

      for (const item of source) {
        const text = normalizeCategoryName(item);
        if (!text || seen.has(text)) continue;
        seen.add(text);
        unique.push(text);
        if (unique.length >= 32) break;
      }

      if (!unique.length) {
        return [...DEFAULT_CATEGORIES];
      }
      return unique;
    }

    function getCategoryList() {
      return normalizeCategoryList(getCategories());
    }

    function loadCategories() {
      try {
        const raw = localStorageRef?.getItem(CATEGORY_STORAGE_KEY);
        if (!raw) return [...DEFAULT_CATEGORIES];
        const parsed = JSON.parse(raw);
        return normalizeCategoryList(parsed);
      } catch {
        return [...DEFAULT_CATEGORIES];
      }
    }

    function saveCategories(value) {
      const normalized = normalizeCategoryList(value);
      try {
        localStorageRef?.setItem(CATEGORY_STORAGE_KEY, JSON.stringify(normalized));
        scheduleLocalDataBackup("categories-save");
      } catch {
        // ignore storage failures
      }
    }

    function applyCategoryOptionsToSelect(selectNode, preferredValue = "") {
      if (!isHtmlSelect(selectNode) || !documentRef) return;
      const categories = getCategoryList();
      const preferred = String(preferredValue || "").trim();
      const fallback = categories[0] || "工作";
      const resolved = categories.includes(preferred) ? preferred : fallback;

      const options = categories.map((name) => {
        const option = documentRef.createElement("option");
        option.value = name;
        option.textContent = name;
        return option;
      });
      selectNode.replaceChildren(...options);
      selectNode.value = categories.includes(resolved) ? resolved : fallback;
    }

    function applyCategoryOptionsToAllSelectors() {
      applyCategoryOptionsToSelect(pomodoroCategory, pomodoroCategory?.value);
      applyCategoryOptionsToSelect(todoCategoryInput, todoCategoryInput?.value);
      applyCategoryOptionsToSelect(calendarEventEditCategory, calendarEventEditCategory?.value);
      syncTodoCategoryTriggerLabel();
      updateTodoCategorySuggestionOptions({ forceShow: isTodoCategorySuggestionMenuOpen() });
    }

    function renderCategoryManager() {
      if (!settingsCategoryList) return;
      if (getActiveView() !== "settings") return;
      const focused = documentRef?.activeElement;
      if (
        isHtmlElement(focused) &&
        settingsCategoryList.contains(focused) &&
        focused.classList.contains("settings-category-name")
      ) {
        return;
      }

      const categories = getCategoryList();
      settingsCategoryList.innerHTML = categories
        .map((name, index) => {
          const canMoveUp = index > 0;
          const canMoveDown = index < categories.length - 1;
          const canDelete = categories.length > 1;
          return `
            <div class="settings-category-row" data-index="${index}">
              <span class="settings-category-order">${index + 1}</span>
              <input
                class="settings-category-name"
                type="text"
                data-index="${index}"
                value="${escapeHtml(name)}"
                maxlength="20"
                aria-label="分类名称 ${index + 1}"
              />
              <div class="settings-category-actions">
                <button type="button" data-action="edit" data-index="${index}" aria-label="编辑分类">编辑</button>
                <button type="button" data-action="up" data-index="${index}" ${canMoveUp ? "" : "disabled"} aria-label="上移分类">↑</button>
                <button type="button" data-action="down" data-index="${index}" ${canMoveDown ? "" : "disabled"} aria-label="下移分类">↓</button>
                <button type="button" data-action="delete" data-index="${index}" ${canDelete ? "" : "disabled"} aria-label="删除分类">删除</button>
              </div>
            </div>
          `;
        })
        .join("");
    }

    function commitCategoryList(nextCategories) {
      const currentCategories = getCategoryList();
      const normalized = normalizeCategoryList(nextCategories);
      const hasChanged =
        normalized.length !== currentCategories.length ||
        normalized.some((item, index) => item !== currentCategories[index]);
      if (!hasChanged) return false;

      setCategories(normalized);
      saveCategories(normalized);
      applyCategoryOptionsToAllSelectors();
      render();
      return true;
    }

    function handleCategoryAdd() {
      if (!settingsCategoryAddInput) return;
      const categories = getCategoryList();
      const nextName = normalizeCategoryName(settingsCategoryAddInput.value);
      if (!nextName) {
        alertFn("请输入分类名称。");
        settingsCategoryAddInput.focus();
        return;
      }
      if (categories.includes(nextName)) {
        alertFn("分类名称已存在，请更换。");
        settingsCategoryAddInput.focus();
        settingsCategoryAddInput.select();
        return;
      }

      const created = commitCategoryList([...categories, nextName]);
      if (!created) return;
      settingsCategoryAddInput.value = "";
      settingsCategoryAddInput.focus();
    }

    function updateCategoryAtIndex(index, rawValue) {
      const categories = getCategoryList();
      if (!Number.isInteger(index) || index < 0 || index >= categories.length) return;
      const nextName = normalizeCategoryName(rawValue);
      if (!nextName) {
        alertFn("分类名称不能为空。");
        renderCategoryManager();
        return;
      }
      if (categories.some((name, currentIndex) => currentIndex !== index && name === nextName)) {
        alertFn("分类名称已存在，请更换。");
        renderCategoryManager();
        return;
      }
      const nextCategories = [...categories];
      nextCategories[index] = nextName;
      commitCategoryList(nextCategories);
    }

    function handleCategoryListClick(event) {
      if (!isElement(event.target)) return;
      const button = event.target.closest("button[data-action][data-index]");
      if (!button) return;
      const categories = getCategoryList();
      const action = String(button.dataset.action || "");
      const index = Number.parseInt(String(button.dataset.index || "-1"), 10);
      if (!Number.isInteger(index) || index < 0 || index >= categories.length) return;

      if (action === "edit") {
        const input = settingsCategoryList?.querySelector(`input.settings-category-name[data-index="${index}"]`);
        if (isHtmlInput(input)) {
          input.focus();
          input.select();
        }
        return;
      }

      if (action === "up" && index > 0) {
        const next = [...categories];
        [next[index - 1], next[index]] = [next[index], next[index - 1]];
        commitCategoryList(next);
        return;
      }

      if (action === "down" && index < categories.length - 1) {
        const next = [...categories];
        [next[index], next[index + 1]] = [next[index + 1], next[index]];
        commitCategoryList(next);
        return;
      }

      if (action === "delete") {
        if (categories.length <= 1) {
          alertFn("至少保留一个分类。");
          return;
        }
        const next = categories.filter((_, currentIndex) => currentIndex !== index);
        commitCategoryList(next);
      }
    }

    function handleCategoryListChange(event) {
      if (!isElement(event.target)) return;
      const input = event.target.closest("input.settings-category-name[data-index]");
      if (!isHtmlInput(input)) return;
      const index = Number.parseInt(String(input.dataset.index || "-1"), 10);
      if (!Number.isInteger(index)) return;
      updateCategoryAtIndex(index, input.value);
    }

    function handleCategoryListKeydown(event) {
      if (!isElement(event.target)) return;
      const input = event.target.closest("input.settings-category-name[data-index]");
      if (!isHtmlInput(input)) return;
      if (event.key !== "Enter") return;
      event.preventDefault();
      input.blur();
    }

    function handleCategoryReset() {
      commitCategoryList([...DEFAULT_CATEGORIES]);
    }

    function initCategoryConfiguration() {
      const normalized = normalizeCategoryList(getCategories());
      setCategories(normalized);
      saveCategories(normalized);
      applyCategoryOptionsToAllSelectors();
      renderCategoryManager();
    }

    function normalizeQuoteText(value) {
      return String(value || "").trim().replace(/\s+/g, " ").slice(0, 120);
    }

    function normalizeQuoteAuthor(value) {
      return String(value || "").trim().replace(/\s+/g, " ").slice(0, 40);
    }

    function parseQuoteLine(line) {
      const raw = String(line || "").trim();
      if (!raw) return null;

      const separators = ["——", "--", "—", " - "];
      let text = raw;
      let author = "";

      for (const separator of separators) {
        const index = raw.lastIndexOf(separator);
        if (index > 0) {
          text = raw.slice(0, index).trim();
          author = raw.slice(index + separator.length).trim();
          break;
        }
      }

      text = normalizeQuoteText(text);
      author = normalizeQuoteAuthor(author || "佚名");
      if (!text) return null;
      return { text, author };
    }

    function normalizeQuoteItem(item) {
      if (!item) return null;
      if (typeof item === "string") return parseQuoteLine(item);
      const text = normalizeQuoteText(item.text);
      const author = normalizeQuoteAuthor(item.author || "佚名");
      if (!text) return null;
      return { text, author };
    }

    function cloneDefaultMotivationQuotes() {
      return MOTIVATION_QUOTES.map((item) => ({ text: item.text, author: item.author }));
    }

    function normalizeQuoteLibrary(value) {
      const source = Array.isArray(value) ? value : [];
      const normalized = [];
      const seen = new Set();

      for (const item of source) {
        const quote = normalizeQuoteItem(item);
        if (!quote) continue;
        const key = `${quote.text}__${quote.author}`;
        if (seen.has(key)) continue;
        seen.add(key);
        normalized.push(quote);
        if (normalized.length >= 200) break;
      }

      if (!normalized.length) {
        return cloneDefaultMotivationQuotes();
      }
      return normalized;
    }

    function loadMotivationQuotes() {
      try {
        const raw = localStorageRef?.getItem(QUOTE_LIBRARY_KEY);
        if (!raw) return cloneDefaultMotivationQuotes();
        const parsed = JSON.parse(raw);
        return normalizeQuoteLibrary(parsed);
      } catch {
        return cloneDefaultMotivationQuotes();
      }
    }

    function saveMotivationQuotes(list) {
      const normalized = normalizeQuoteLibrary(list);
      try {
        localStorageRef?.setItem(QUOTE_LIBRARY_KEY, JSON.stringify(normalized));
        scheduleLocalDataBackup("quote-library-save");
      } catch {
        // ignore storage failures
      }
    }

    function getCurrentMotivationQuotes() {
      const motivationQuotes = getMotivationQuotes();
      if (Array.isArray(motivationQuotes) && motivationQuotes.length) {
        return motivationQuotes;
      }
      return cloneDefaultMotivationQuotes();
    }

    function loadQuoteState() {
      const defaultState = { pool: [], lastIndex: null };
      const quoteCount = getCurrentMotivationQuotes().length;

      try {
        const raw = localStorageRef?.getItem(QUOTE_POOL_KEY);
        if (!raw) return defaultState;

        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") return defaultState;

        const pool = Array.isArray(parsed.pool)
          ? [...new Set(parsed.pool)].filter((index) => {
            return Number.isInteger(index) && index >= 0 && index < quoteCount;
          })
          : [];

        const lastIndex =
          Number.isInteger(parsed.lastIndex) &&
            parsed.lastIndex >= 0 &&
            parsed.lastIndex < quoteCount
            ? parsed.lastIndex
            : null;

        return { pool, lastIndex };
      } catch {
        return defaultState;
      }
    }

    function saveQuoteState(state = getQuoteState()) {
      try {
        localStorageRef?.setItem(QUOTE_POOL_KEY, JSON.stringify(state));
        scheduleLocalDataBackup("quote-pool-save");
      } catch {
        // ignore storage failures
      }
    }

    function resetQuoteStateForLibrary() {
      const nextState = { pool: [], lastIndex: null };
      setQuoteState(nextState);
      saveQuoteState(nextState);
    }

    function parseQuoteEditorContent(text) {
      const lines = String(text || "").split(/\r?\n/);
      const normalized = [];
      const seen = new Set();
      for (const line of lines) {
        const quote = parseQuoteLine(line);
        if (!quote) continue;
        const key = `${quote.text}__${quote.author}`;
        if (seen.has(key)) continue;
        seen.add(key);
        normalized.push(quote);
        if (normalized.length >= 200) break;
      }
      return normalized;
    }

    function formatQuoteLibraryForEditor(list = getCurrentMotivationQuotes()) {
      return normalizeQuoteLibrary(list)
        .map((item) => `${item.text} —— ${item.author}`)
        .join("\n");
    }

    function setQuoteStatus(message, tone = "normal") {
      if (!settingsQuoteStatus) return;
      const text = String(message || "").trim();
      settingsQuoteStatus.textContent = text;
      settingsQuoteStatus.dataset.tone = tone;
    }

    function renderQuoteManager() {
      if (!settingsQuoteEditor) return;
      if (getActiveView() !== "settings") return;
      if (documentRef?.activeElement === settingsQuoteEditor) return;
      settingsQuoteEditor.value = formatQuoteLibraryForEditor();
    }

    function getNextMotivationQuote() {
      const quoteLibrary = getCurrentMotivationQuotes();
      if (!quoteLibrary.length) {
        return { text: "保持节奏，持续前进。", author: "Satori" };
      }

      const currentState = getQuoteState() || { pool: [], lastIndex: null };
      const nextState = {
        pool: Array.isArray(currentState.pool) ? [...currentState.pool] : [],
        lastIndex: Number.isInteger(currentState.lastIndex) ? currentState.lastIndex : null,
      };

      if (!nextState.pool.length) {
        nextState.pool = quoteLibrary.map((_, index) => index).filter((index) => {
          return quoteLibrary.length <= 1 || index !== nextState.lastIndex;
        });
      }

      const randomPos = Math.floor(Math.random() * nextState.pool.length);
      const [pickedIndex] = nextState.pool.splice(randomPos, 1);
      nextState.lastIndex = pickedIndex;
      setQuoteState(nextState);
      saveQuoteState(nextState);

      return quoteLibrary[pickedIndex] || quoteLibrary[0];
    }

    function renderHeroQuote() {
      if (!heroQuote) return;
      const quote = getNextMotivationQuote();
      heroQuote.innerHTML = `
        <p class="hero-quote-line">
          <span class="hero-quote-text">“${escapeHtml(quote.text)}”</span>
          <span class="hero-quote-author">—— ${escapeHtml(quote.author)}</span>
        </p>
      `;
    }

    function handleQuoteSave() {
      if (!settingsQuoteEditor) return;
      const nextQuotes = parseQuoteEditorContent(settingsQuoteEditor.value);
      if (!Array.isArray(nextQuotes) || nextQuotes.length < 1) {
        alertFn("请至少保留一条语录。");
        settingsQuoteEditor.focus();
        return;
      }

      setMotivationQuotes(nextQuotes);
      saveMotivationQuotes(nextQuotes);
      resetQuoteStateForLibrary();
      renderQuoteManager();
      renderHeroQuote();
      setQuoteStatus(`已保存 ${nextQuotes.length} 条语录。`, "success");
    }

    function handleQuoteReset() {
      const defaultQuotes = cloneDefaultMotivationQuotes();
      setMotivationQuotes(defaultQuotes);
      saveMotivationQuotes(defaultQuotes);
      resetQuoteStateForLibrary();
      renderQuoteManager();
      renderHeroQuote();
      setQuoteStatus("已恢复默认语录。", "normal");
    }

    function setDataStatus(message, tone = "normal") {
      if (!settingsDataStatus) return;
      settingsDataStatus.textContent = String(message || "").trim();
      settingsDataStatus.dataset.tone = tone;
    }

    function setRuntimePortStatus(message, tone = "normal") {
      if (!settingsRuntimePortStatus) return;
      settingsRuntimePortStatus.textContent = String(message || "").trim();
      settingsRuntimePortStatus.dataset.tone = tone;
    }

    function normalizeRuntimePort(value) {
      const port = Number.parseInt(String(value || "").trim(), 10);
      if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
      return port;
    }

    async function initRuntimePortConfiguration() {
      if (!settingsRuntimePortInput || !fetchFn) return;
      try {
        const response = await fetchFn(RUNTIME_CONFIG_URL, { headers: { Accept: "application/json" } });
        if (!response.ok) throw new Error(`RUNTIME_CONFIG_LOAD_${response.status}`);
        const payload = await response.json();
        const configuredPort = normalizeRuntimePort(payload?.result?.port) || 8080;
        const currentPort = normalizeRuntimePort(payload?.result?.currentPort);
        settingsRuntimePortInput.value = String(configuredPort);
        const currentText = currentPort ? `当前运行端口 ${currentPort}` : "当前运行端口未知";
        const nextText = configuredPort === currentPort ? "已生效" : "重启后生效";
        setRuntimePortStatus(`${currentText}，${nextText}。`, configuredPort === currentPort ? "normal" : "warning");
      } catch {
        settingsRuntimePortInput.value = settingsRuntimePortInput.value || "8080";
        setRuntimePortStatus("端口配置读取失败，可保存后下次启动生效。", "warning");
      }
    }

    async function handleRuntimePortSave() {
      if (!settingsRuntimePortInput || !fetchFn) return;
      const port = normalizeRuntimePort(settingsRuntimePortInput.value);
      if (!port) {
        setRuntimePortStatus("请输入 1 到 65535 之间的端口号。", "danger");
        settingsRuntimePortInput.focus();
        return;
      }

      try {
        settingsRuntimePortSaveBtn?.setAttribute("disabled", "disabled");
        const response = await fetchFn(RUNTIME_CONFIG_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ port }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(String(payload?.message || `RUNTIME_CONFIG_SAVE_${response.status}`));
        const currentPort = normalizeRuntimePort(payload?.result?.currentPort);
        const restartRequired = Boolean(payload?.result?.restartRequired);
        const currentText = currentPort ? `当前运行端口 ${currentPort}` : "当前运行端口未知";
        const suffix = restartRequired ? "重启观时后生效" : "已生效";
        setRuntimePortStatus(`已保存端口 ${port}，${currentText}，${suffix}。`, restartRequired ? "warning" : "success");
      } catch {
        setRuntimePortStatus("端口保存失败，请稍后重试。", "danger");
      } finally {
        settingsRuntimePortSaveBtn?.removeAttribute("disabled");
      }
    }

    function collectExportableLocalStorage() {
      const snapshot = {};
      const keys = [];
      if (!localStorageRef) return snapshot;
      for (let index = 0; index < localStorageRef.length; index += 1) {
        const key = localStorageRef.key(index);
        if (!key || !key.startsWith(DATA_EXPORT_STORAGE_PREFIX)) continue;
        keys.push(key);
      }
      keys.sort((left, right) => left.localeCompare(right, "zh-CN"));
      for (const key of keys) {
        const value = localStorageRef.getItem(key);
        if (typeof value !== "string") continue;
        snapshot[key] = value;
      }
      return snapshot;
    }

    function buildDataExportFileName() {
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, "0");
      const day = String(now.getDate()).padStart(2, "0");
      const hour = String(now.getHours()).padStart(2, "0");
      const minute = String(now.getMinutes()).padStart(2, "0");
      const second = String(now.getSeconds()).padStart(2, "0");
      return `timequality-data-${year}${month}${day}-${hour}${minute}${second}.json`;
    }

    function downloadTextFile(filename, content, type = "application/json;charset=utf-8") {
      const BlobCtor = globalScope.Blob || windowRef.Blob;
      const URLRef = globalScope.URL || windowRef.URL;
      if (!documentRef || typeof BlobCtor !== "function" || !URLRef) return;
      const blob = new BlobCtor([content], { type });
      const url = URLRef.createObjectURL(blob);
      const anchor = documentRef.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      documentRef.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeoutFn(() => URLRef.revokeObjectURL(url), 0);
    }

    function handleDataExport() {
      try {
        const storage = collectExportableLocalStorage();
        const keys = Object.keys(storage);
        if (!keys.length) {
          setDataStatus("当前没有可导出的本地数据。", "warning");
          return;
        }
        const entries = getEntries();
        const todos = getTodos();
        const categories = getCategoryList();
        const payload = {
          schema: DATA_EXPORT_SCHEMA,
          exportedAt: new Date().toISOString(),
          source: {
            origin: String(windowRef.location?.origin || ""),
            href: String(windowRef.location?.href || ""),
          },
          stats: {
            entries: Array.isArray(entries) ? entries.length : 0,
            todos: Array.isArray(todos) ? todos.length : 0,
            categories: Array.isArray(categories) ? categories.length : 0,
          },
          storage,
        };
        const fileName = buildDataExportFileName();
        downloadTextFile(fileName, JSON.stringify(payload, null, 2));
        setDataStatus(`导出成功：${keys.length} 项，文件名 ${fileName}。`, "success");
      } catch {
        setDataStatus("导出失败，请稍后重试。", "danger");
      }
    }

    function normalizeImportedStorage(raw) {
      if (!raw || typeof raw !== "object") return {};
      const output = {};
      for (const [key, value] of Object.entries(raw)) {
        const normalizedKey = String(key || "").trim();
        if (!normalizedKey || !normalizedKey.startsWith(DATA_EXPORT_STORAGE_PREFIX)) continue;
        if (typeof value === "string") {
          output[normalizedKey] = value;
          continue;
        }
        try {
          output[normalizedKey] = JSON.stringify(value);
        } catch {
          // skip invalid value
        }
      }
      return output;
    }

    function applyImportedStorageSnapshot(storageSnapshot) {
      const nextSnapshot = normalizeImportedStorage(storageSnapshot);
      const nextKeys = Object.keys(nextSnapshot);
      if (!nextKeys.length) {
        return { imported: 0 };
      }
      if (!localStorageRef) return { imported: 0 };

      const existingKeys = [];
      for (let index = 0; index < localStorageRef.length; index += 1) {
        const key = localStorageRef.key(index);
        if (!key || !key.startsWith(DATA_EXPORT_STORAGE_PREFIX)) continue;
        existingKeys.push(key);
      }
      for (const key of existingKeys) {
        localStorageRef.removeItem(key);
      }
      for (const key of nextKeys) {
        localStorageRef.setItem(key, nextSnapshot[key]);
      }
      if (!localStorageRef.getItem(CACHE_RESET_ONCE_KEY)) {
        localStorageRef.setItem(CACHE_RESET_ONCE_KEY, "1");
      }
      return { imported: nextKeys.length };
    }

    function handleDataImportClick() {
      if (!settingsDataImportInput) return;
      settingsDataImportInput.click();
    }

    async function handleDataImportChange(event) {
      const input = event?.target;
      if (!isHtmlInput(input)) return;
      const file = input.files?.[0];
      if (!file) return;

      try {
        const fileText = await file.text();
        const parsed = JSON.parse(fileText);
        const schema = String(parsed?.schema || "");
        if (schema !== DATA_EXPORT_SCHEMA) {
          setDataStatus("导入失败：文件格式不匹配。", "danger");
          return;
        }
        const storage = normalizeImportedStorage(parsed?.storage);
        const itemCount = Object.keys(storage).length;
        if (!itemCount) {
          setDataStatus("导入失败：文件中没有可用数据。", "danger");
          return;
        }

        const confirmed = confirmFn(`将覆盖当前本地数据并刷新页面，确认导入 ${itemCount} 项数据吗？`);
        if (!confirmed) {
          setDataStatus("已取消导入。", "normal");
          return;
        }

        const result = applyImportedStorageSnapshot(storage);
        await backupLocalDataNow("manual-import");
        setDataStatus(`导入成功：${result.imported} 项，正在刷新。`, "success");
        setTimeoutFn(() => reloadPage(), 160);
      } catch {
        setDataStatus("导入失败：文件解析错误。", "danger");
      } finally {
        input.value = "";
      }
    }

    function bindEvents() {
      if (eventsBound) return;
      eventsBound = true;

      for (const button of getSettingsTabButtons()) {
        button.addEventListener("click", handleSettingsTabClick);
        button.addEventListener("keydown", handleSettingsTabKeydown);
      }
      renderSettingsTabs();

      if (settingsCategoryAddBtn) {
        settingsCategoryAddBtn.addEventListener("click", handleCategoryAdd);
      }
      if (settingsCategoryAddInput) {
        settingsCategoryAddInput.addEventListener("keydown", (event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          handleCategoryAdd();
        });
      }
      if (settingsCategoryResetBtn) {
        settingsCategoryResetBtn.addEventListener("click", handleCategoryReset);
      }
      if (settingsCategoryList) {
        settingsCategoryList.addEventListener("click", handleCategoryListClick);
        settingsCategoryList.addEventListener("change", handleCategoryListChange);
        settingsCategoryList.addEventListener("keydown", handleCategoryListKeydown);
      }
      if (settingsQuoteSaveBtn) {
        settingsQuoteSaveBtn.addEventListener("click", handleQuoteSave);
      }
      if (settingsQuoteResetBtn) {
        settingsQuoteResetBtn.addEventListener("click", handleQuoteReset);
      }
      if (settingsDataExportBtn) {
        settingsDataExportBtn.addEventListener("click", handleDataExport);
      }
      if (settingsDataImportBtn) {
        settingsDataImportBtn.addEventListener("click", handleDataImportClick);
      }
      if (settingsDataImportInput) {
        settingsDataImportInput.addEventListener("change", (event) => {
          void handleDataImportChange(event);
        });
      }
      if (settingsRuntimePortSaveBtn) {
        settingsRuntimePortSaveBtn.addEventListener("click", () => {
          void handleRuntimePortSave();
        });
      }
      if (settingsRuntimePortInput) {
        settingsRuntimePortInput.addEventListener("keydown", (event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          void handleRuntimePortSave();
        });
      }
    }

    return {
      loadCategories,
      loadMotivationQuotes,
      loadQuoteState,
      getCurrentMotivationQuotes,
      initSettingsTabs,
      initCategoryConfiguration,
      initRuntimePortConfiguration,
      bindEvents,
      getActiveSettingsTab,
      renderCategoryManager,
      renderQuoteManager,
      renderHeroQuote,
      renderSettingsTabs,
      setActiveSettingsTab,
      setQuoteStatus,
    };
  }

  globalScope.TimeQualitySettingsModule = {
    createSettingsModule,
  };
})(typeof window !== "undefined" ? window : globalThis);
