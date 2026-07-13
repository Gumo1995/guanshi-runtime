/* global window */

(function attachLocalDataBackupModule(globalScope) {
  "use strict";

  function createLocalDataBackupModule(deps = {}) {
    const {
      DATA_EXPORT_SCHEMA = "timequality-local-storage-export-v1",
      DATA_EXPORT_STORAGE_PREFIX = "time_quality_",
      LOCAL_DATA_BACKUP_URL = "/api/local-data/backup",
      LOCAL_DATA_LATEST_URL = "/api/local-data/latest",
      STORAGE_KEY = "time_quality_journal_v1",
      TODO_STORAGE_KEY = "time_quality_todos_v1",
      CATEGORY_STORAGE_KEY = "time_quality_categories_v1",
      localStorageRef = globalScope.localStorage || null,
      windowRef = globalScope,
      setTimeoutFn = globalScope.setTimeout ? globalScope.setTimeout.bind(globalScope) : setTimeout,
      clearTimeoutFn = globalScope.clearTimeout ? globalScope.clearTimeout.bind(globalScope) : clearTimeout,
      fetchFn = globalScope.fetch ? globalScope.fetch.bind(globalScope) : null,
    } = deps;

    const CORE_DATA_KEYS = new Set([STORAGE_KEY, TODO_STORAGE_KEY, CATEGORY_STORAGE_KEY]);
    const BACKUP_DEBOUNCE_MS = 1200;
    let backupTimer = null;
    let restoreCheckComplete = false;

    function getStorageSnapshot() {
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
        if (typeof value === "string") snapshot[key] = value;
      }
      return snapshot;
    }

    function parseStoredArray(value) {
      try {
        const parsed = JSON.parse(String(value || ""));
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }

    function hasMeaningfulStorage(snapshot) {
      if (!snapshot || typeof snapshot !== "object") return false;
      const entries = parseStoredArray(snapshot[STORAGE_KEY]);
      const todos = parseStoredArray(snapshot[TODO_STORAGE_KEY]);
      if (entries.length > 0 || todos.length > 0) return true;

      for (const key of Object.keys(snapshot)) {
        if (!CORE_DATA_KEYS.has(key)) continue;
        const value = String(snapshot[key] || "").trim();
        if (value && value !== "[]" && value !== "{}" && value !== "null") return true;
      }
      return false;
    }

    function buildPayload(reason = "auto") {
      const storage = getStorageSnapshot();
      return {
        schema: DATA_EXPORT_SCHEMA,
        exportedAt: new Date().toISOString(),
        reason: String(reason || "auto").slice(0, 80),
        source: {
          origin: String(windowRef.location?.origin || ""),
          href: String(windowRef.location?.href || ""),
        },
        stats: {
          entries: parseStoredArray(storage[STORAGE_KEY]).length,
          todos: parseStoredArray(storage[TODO_STORAGE_KEY]).length,
          storageKeys: Object.keys(storage).length,
        },
        storage,
      };
    }

    async function backupNow(reason = "auto") {
      if (!fetchFn || !restoreCheckComplete) return { ok: false, skipped: "restore-check-pending" };
      const payload = buildPayload(reason);
      if (!hasMeaningfulStorage(payload.storage)) return { ok: false, skipped: "empty-storage" };
      const response = await fetchFn(LOCAL_DATA_BACKUP_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error(`LOCAL_DATA_BACKUP_FAILED_${response.status}`);
      return response.json();
    }

    function scheduleBackup(reason = "auto") {
      if (!fetchFn) return;
      if (backupTimer) clearTimeoutFn(backupTimer);
      backupTimer = setTimeoutFn(() => {
        backupTimer = null;
        void backupNow(reason).catch(() => {
          // Backup failures must not block local editing.
        });
      }, BACKUP_DEBOUNCE_MS);
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
          // skip invalid snapshot entries
        }
      }
      return output;
    }

    function applyStorageSnapshot(storageSnapshot) {
      const nextSnapshot = normalizeImportedStorage(storageSnapshot);
      const keys = Object.keys(nextSnapshot);
      if (!keys.length || !localStorageRef) return { restored: 0 };
      for (const key of keys) {
        localStorageRef.setItem(key, nextSnapshot[key]);
      }
      return { restored: keys.length };
    }

    async function restoreLatestIfNeeded() {
      if (!fetchFn || !localStorageRef) {
        restoreCheckComplete = true;
        return { ok: false, skipped: "unavailable" };
      }
      try {
        const currentSnapshot = getStorageSnapshot();
        if (hasMeaningfulStorage(currentSnapshot)) {
          restoreCheckComplete = true;
          return { ok: true, skipped: "current-storage-present" };
        }

        const response = await fetchFn(LOCAL_DATA_LATEST_URL, { headers: { Accept: "application/json" } });
        if (!response.ok) {
          restoreCheckComplete = true;
          return { ok: false, skipped: `latest-${response.status}` };
        }

        const payload = await response.json();
        if (String(payload?.schema || "") !== DATA_EXPORT_SCHEMA || !hasMeaningfulStorage(payload?.storage)) {
          restoreCheckComplete = true;
          return { ok: false, skipped: "latest-empty" };
        }

        const result = applyStorageSnapshot(payload.storage);
        restoreCheckComplete = true;
        if (result.restored > 0 && typeof windowRef.location?.reload === "function") {
          windowRef.location.reload();
        }
        return { ok: true, restored: result.restored };
      } catch {
        restoreCheckComplete = true;
        return { ok: false, skipped: "restore-failed" };
      }
    }

    return {
      buildPayload,
      backupNow,
      scheduleBackup,
      restoreLatestIfNeeded,
    };
  }

  globalScope.TimeQualityLocalDataBackupModule = {
    createLocalDataBackupModule,
  };
})(typeof window !== "undefined" ? window : globalThis);
