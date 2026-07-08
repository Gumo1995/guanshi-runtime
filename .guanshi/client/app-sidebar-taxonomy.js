(function attachTimeQualitySidebarTaxonomyModule(globalScope) {
  if (!globalScope) return;

  function requireFunction(deps, key) {
    const value = deps[key];
    if (typeof value !== "function") {
      throw new Error(`TimeQualitySidebarTaxonomyModule missing required function dependency: ${key}`);
    }
    return value;
  }

  function createSidebarTaxonomyModule(deps = {}) {
    const SIDEBAR_TAXONOMY_RANGE_STORAGE_KEY = String(deps.SIDEBAR_TAXONOMY_RANGE_STORAGE_KEY || "");
    const SIDEBAR_PROJECT_COLLAPSE_STORAGE_KEY = String(deps.SIDEBAR_PROJECT_COLLAPSE_STORAGE_KEY || "");

    const sidebarProjectList = deps.sidebarProjectList || null;
    const sidebarTagList = deps.sidebarTagList || null;
    const sidebarTaxonomyRangeControl = deps.sidebarTaxonomyRangeControl || null;
    const localStorageRef = deps.localStorageRef || globalScope.localStorage || null;

    const escapeHtml = requireFunction(deps, "escapeHtml");
    const normalizeProjectName = requireFunction(deps, "normalizeProjectName");
    const normalizeTodoTags = requireFunction(deps, "normalizeTodoTags");
    const getProjectPathSegments = requireFunction(deps, "getProjectPathSegments");
    const buildProjectPathFromSegments = requireFunction(deps, "buildProjectPathFromSegments");
    const getTodayDateInputValue = requireFunction(deps, "getTodayDateInputValue");
    const formatDateForInput = requireFunction(deps, "formatDateForInput");
    const addDays = requireFunction(deps, "addDays");
    const isValidDateInput = requireFunction(deps, "isValidDateInput");
    const loadCollapsedProjectPathSet = requireFunction(deps, "loadCollapsedProjectPathSet");
    const toggleCollapsedProjectPath = requireFunction(deps, "toggleCollapsedProjectPath");
    const isProjectPathHiddenByCollapsed = requireFunction(deps, "isProjectPathHiddenByCollapsed");
    const getTodos = requireFunction(deps, "getTodos");
    const getEntries = requireFunction(deps, "getEntries");
    const setProjectLibrary = requireFunction(deps, "setProjectLibrary");
    const setTagLibrary = requireFunction(deps, "setTagLibrary");
    const renderProjectTagSuggestions = requireFunction(deps, "renderProjectTagSuggestions");

    let eventsBound = false;
    let sidebarTaxonomyRange = loadRange();
    let sidebarProjectCollapsedPaths = loadCollapsedProjectPathSet(SIDEBAR_PROJECT_COLLAPSE_STORAGE_KEY);
    let projectTreeLibrary = [];
    let sidebarTagLibrary = [];

    function normalizeRange(value) {
      const text = String(value || "").trim();
      return ["week", "month", "all"].includes(text) ? text : "all";
    }

    function loadRange() {
      try {
        return normalizeRange(localStorageRef?.getItem(SIDEBAR_TAXONOMY_RANGE_STORAGE_KEY));
      } catch {
        return "all";
      }
    }

    function saveRange(value) {
      try {
        localStorageRef?.setItem(SIDEBAR_TAXONOMY_RANGE_STORAGE_KEY, normalizeRange(value));
      } catch {
        // Ignore storage failures.
      }
    }

    function getRangeBounds(rangeValue = sidebarTaxonomyRange) {
      const range = normalizeRange(rangeValue);
      if (range === "all") return null;
      const todayText = getTodayDateInputValue();
      const today = new Date(`${todayText}T00:00:00`);
      if (Number.isNaN(today.getTime())) return null;
      const daysBack = range === "week" ? 6 : 29;
      return {
        start: formatDateForInput(addDays(today, -daysBack)),
        end: todayText,
      };
    }

    function isDateInRange(dateText, rangeValue = sidebarTaxonomyRange) {
      const range = normalizeRange(rangeValue);
      if (range === "all") return true;
      const date = String(dateText || "").trim();
      if (!isValidDateInput(date)) return false;
      const bounds = getRangeBounds(range);
      if (!bounds) return true;
      return date >= bounds.start && date <= bounds.end;
    }

    function shouldIncludeTodo(todo, rangeValue = "all") {
      return isDateInRange(todo?.dueDate, rangeValue);
    }

    function shouldIncludeEntry(entry, rangeValue = "all") {
      return isDateInRange(entry?.date, rangeValue);
    }

    function syncRangeButtons() {
      if (!sidebarTaxonomyRangeControl) return;
      const range = normalizeRange(sidebarTaxonomyRange);
      for (const button of sidebarTaxonomyRangeControl.querySelectorAll("button[data-range]")) {
        const isActive = normalizeRange(button.dataset.range) === range;
        button.classList.toggle("is-active", isActive);
        button.setAttribute("aria-pressed", isActive ? "true" : "false");
      }
    }

    function handleRangeClick(event) {
      const button = event.target instanceof Element ? event.target.closest("button[data-range]") : null;
      if (!button || !sidebarTaxonomyRangeControl?.contains(button)) return;
      const nextRange = normalizeRange(button.dataset.range);
      if (nextRange === sidebarTaxonomyRange) return;
      sidebarTaxonomyRange = nextRange;
      saveRange(sidebarTaxonomyRange);
      syncProjectTagLibraries();
    }

    function extractEntryProjectFromNote(note) {
      const text = String(note || "");
      if (!text) return "";
      const match = text.match(/(?:^|\n)\s*项目:\s*([^\n]+)/);
      if (!match) return "";
      return normalizeProjectName(match[1] || "");
    }

    function extractEntryTagsFromNote(note) {
      const text = String(note || "");
      if (!text) return [];
      const match = text.match(/(?:^|\n)\s*标签:\s*([^\n]+)/);
      if (!match) return [];
      return normalizeTodoTags(match[1] || "");
    }

    function getEntryProjectForLibrary(entry) {
      const direct = normalizeProjectName(entry?.project);
      if (direct) return direct;
      return extractEntryProjectFromNote(entry?.note);
    }

    function getEntryTagsForLibrary(entry) {
      const direct = normalizeTodoTags(entry?.tags || []);
      if (direct.length) return direct;
      return extractEntryTagsFromNote(entry?.note);
    }

    function collectProjectTagLibraries(options = {}) {
      const range = normalizeRange(options.range);
      const projectCountMap = new Map();
      const tagCountMap = new Map();
      const bumpCount = (map, key) => {
        if (!key) return;
        map.set(key, (map.get(key) || 0) + 1);
      };

      for (const todo of getTodos()) {
        if (!shouldIncludeTodo(todo, range)) continue;
        const project = normalizeProjectName(todo?.project);
        if (project) bumpCount(projectCountMap, project);
        const tags = normalizeTodoTags(todo?.tags || []);
        for (const tag of tags) {
          bumpCount(tagCountMap, tag);
        }
      }

      for (const entry of getEntries()) {
        if (!shouldIncludeEntry(entry, range)) continue;
        const project = getEntryProjectForLibrary(entry);
        if (project) bumpCount(projectCountMap, project);
        const tags = getEntryTagsForLibrary(entry);
        for (const tag of tags) {
          bumpCount(tagCountMap, tag);
        }
      }

      const sorter = (a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        return a.name.localeCompare(b.name, "zh-CN");
      };

      const projects = Array.from(projectCountMap.entries())
        .map(([name, count]) => ({ name, count }))
        .sort(sorter);
      const projectNodes = buildProjectTreeFromCountMap(projectCountMap);
      const tags = Array.from(tagCountMap.entries())
        .map(([name, count]) => ({ name, count }))
        .sort(sorter);

      return { projects, projectNodes, tags };
    }

    function buildProjectTreeFromCountMap(projectCountMap) {
      if (!(projectCountMap instanceof Map) || !projectCountMap.size) return [];
      const nodeMap = new Map();

      const ensureNode = (path, name, level, parentPath) => {
        if (nodeMap.has(path)) return nodeMap.get(path);
        const node = {
          path,
          name,
          level,
          parentPath,
          totalCount: 0,
          directCount: 0,
          children: [],
        };
        nodeMap.set(path, node);
        return node;
      };

      for (const [projectPath, countRaw] of projectCountMap.entries()) {
        const count = Number(countRaw) || 0;
        if (count <= 0) continue;
        const parts = getProjectPathSegments(projectPath);
        if (!parts.length) continue;
        for (let index = 0; index < parts.length; index += 1) {
          const partial = parts.slice(0, index + 1);
          const path = buildProjectPathFromSegments(partial);
          const parentPath = index > 0 ? buildProjectPathFromSegments(parts.slice(0, index)) : "";
          const node = ensureNode(path, partial[index], index + 1, parentPath);
          node.totalCount += count;
          if (index === parts.length - 1) {
            node.directCount += count;
          }
        }
      }

      for (const node of nodeMap.values()) {
        if (!node.parentPath) continue;
        const parent = nodeMap.get(node.parentPath);
        if (parent) {
          parent.children.push(node);
        }
      }

      const sorter = (a, b) => {
        if (b.totalCount !== a.totalCount) return b.totalCount - a.totalCount;
        return String(a.name || "").localeCompare(String(b.name || ""), "zh-CN");
      };
      const roots = Array.from(nodeMap.values()).filter((node) => !node.parentPath).sort(sorter);
      const flatNodes = [];

      const visit = (node) => {
        flatNodes.push(node);
        node.children.sort(sorter);
        for (const child of node.children) {
          visit(child);
        }
      };

      for (const root of roots) {
        visit(root);
      }

      return flatNodes;
    }

    function render() {
      syncRangeButtons();

      if (sidebarProjectList) {
        if (!projectTreeLibrary.length) {
          sidebarProjectList.innerHTML = '<p class="sidebar-taxonomy-empty">暂无项目</p>';
        } else {
          const rows = [];
          for (const item of projectTreeLibrary) {
            if (isProjectPathHiddenByCollapsed(item.path, sidebarProjectCollapsedPaths)) continue;
            const level = Math.max(1, Math.min(3, Number(item.level) || 1));
            const hasChildren = Array.isArray(item.children) && item.children.length > 0;
            const collapsed = hasChildren && sidebarProjectCollapsedPaths.has(item.path);
            const toggleHtml = hasChildren
              ? `<button
                  class="sidebar-taxonomy-toggle${collapsed ? " is-collapsed" : ""}"
                  type="button"
                  data-project-path="${escapeHtml(item.path)}"
                  aria-label="${collapsed ? "展开子项目" : "收起子项目"}"
                  title="${collapsed ? "展开子项目" : "收起子项目"}"
                ></button>`
              : '<span class="sidebar-taxonomy-toggle-placeholder" aria-hidden="true"></span>';
            rows.push(`
              <p class="sidebar-taxonomy-item sidebar-taxonomy-item-level-${level}" title="${escapeHtml(item.path)}">
                ${toggleHtml}
                <span class="sidebar-taxonomy-label">${escapeHtml(item.name)}</span>
                <span class="sidebar-taxonomy-count">${Math.max(0, Number(item.totalCount) || 0)}</span>
              </p>
            `);
          }
          sidebarProjectList.innerHTML = rows.join("");
        }
      }

      if (sidebarTagList) {
        if (!sidebarTagLibrary.length) {
          sidebarTagList.innerHTML = '<p class="sidebar-taxonomy-empty">暂无标签</p>';
        } else {
          sidebarTagList.innerHTML = sidebarTagLibrary
            .map(
              (item) =>
                `<p class="sidebar-taxonomy-item"># ${escapeHtml(item.name)} <span class="sidebar-taxonomy-count">${item.count}</span></p>`,
            )
            .join("");
        }
      }
    }

    function syncProjectTagLibraries() {
      const allTime = collectProjectTagLibraries({ range: "all" });
      const sidebarScoped = sidebarTaxonomyRange === "all"
        ? allTime
        : collectProjectTagLibraries({ range: sidebarTaxonomyRange });
      setProjectLibrary(allTime.projects);
      setTagLibrary(allTime.tags);
      projectTreeLibrary = sidebarScoped.projectNodes;
      sidebarTagLibrary = sidebarScoped.tags;
      render();
      renderProjectTagSuggestions();
    }

    function handleProjectTreeClick(event) {
      const toggleBtn = event.target.closest("button.sidebar-taxonomy-toggle[data-project-path]");
      if (!toggleBtn) return;
      const path = String(toggleBtn.dataset.projectPath || "");
      if (!path) return;
      toggleCollapsedProjectPath(sidebarProjectCollapsedPaths, SIDEBAR_PROJECT_COLLAPSE_STORAGE_KEY, path);
      render();
    }

    function bindEvents() {
      if (eventsBound) return;
      eventsBound = true;
      if (sidebarTaxonomyRangeControl) {
        sidebarTaxonomyRangeControl.addEventListener("click", handleRangeClick);
      }
      if (sidebarProjectList) {
        sidebarProjectList.addEventListener("click", handleProjectTreeClick);
      }
    }

    return {
      bindEvents,
      normalizeRange,
      loadRange,
      saveRange,
      getRangeBounds,
      isDateInRange,
      shouldIncludeTodo,
      shouldIncludeEntry,
      syncRangeButtons,
      handleRangeClick,
      extractEntryProjectFromNote,
      extractEntryTagsFromNote,
      getEntryProjectForLibrary,
      getEntryTagsForLibrary,
      collectProjectTagLibraries,
      buildProjectTreeFromCountMap,
      render,
      syncProjectTagLibraries,
      handleProjectTreeClick,
    };
  }

  globalScope.TimeQualitySidebarTaxonomyModule = {
    createSidebarTaxonomyModule,
  };
})(typeof window !== "undefined" ? window : globalThis);
