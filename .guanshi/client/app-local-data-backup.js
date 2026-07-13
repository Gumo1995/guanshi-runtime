/* global window */

(function attachLocalDataBackupModule(globalScope) {
  "use strict";

  function createLocalDataBackupModule(deps = {}) {
    const {
      DATA_EXPORT_SCHEMA = "timequality-local-storage-export-v1",
      DATA_EXPORT_STORAGE_PREFIX = "time_quality_",
      LOCAL_DATA_BACKUP_URL = "/api/local-data/backup",
      LOCAL_DATA_LATEST_URL = "/api/local-data/latest",
      LOCAL_DATA_SNAPSHOTS_URL = "/api/local-data/snapshots",
      LOCAL_DATA_RESTORE_URL = "/api/local-data/restore",
      STORAGE_KEY = "time_quality_journal_v1",
      TODO_STORAGE_KEY = "time_quality_todos_v1",
      CATEGORY_STORAGE_KEY = "time_quality_categories_v1",
      localStorageRef = globalScope.localStorage || null,
      windowRef = globalScope,
      documentRef = globalScope.document || null,
      setTimeoutFn = globalScope.setTimeout ? globalScope.setTimeout.bind(globalScope) : setTimeout,
      clearTimeoutFn = globalScope.clearTimeout ? globalScope.clearTimeout.bind(globalScope) : clearTimeout,
      fetchFn = globalScope.fetch ? globalScope.fetch.bind(globalScope) : null,
      confirmFn = typeof windowRef.confirm === "function" ? windowRef.confirm.bind(windowRef) : () => false,
      settingsDataSnapshotSelect = null,
      settingsDataSnapshotRefreshBtn = null,
      settingsDataSnapshotPreviewBtn = null,
      settingsDataSnapshotRestoreBtn = null,
      settingsDataSnapshotDeleteBtn = null,
      settingsDataSnapshotStatus = null,
    } = deps;

    const CORE_DATA_KEYS = new Set([STORAGE_KEY, TODO_STORAGE_KEY, CATEGORY_STORAGE_KEY]);
    const BACKUP_DEBOUNCE_MS = 1200;
    let backupTimer = null;
    let restoreCheckComplete = false;
    let recoveryEventsBound = false;
    let recoveryBusy = false;
    let snapshots = [];

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

    function hasExportableStorage(snapshot) {
      if (!snapshot || typeof snapshot !== "object") return false;
      return Object.values(snapshot).some((value) => {
        const normalized = String(value || "").trim();
        return normalized && normalized !== "[]" && normalized !== "{}" && normalized !== "null";
      });
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
      if (!hasExportableStorage(payload.storage)) return { ok: false, skipped: "empty-storage" };
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

    function applyStorageSnapshot(storageSnapshot, { replaceExisting = false } = {}) {
      const nextSnapshot = normalizeImportedStorage(storageSnapshot);
      const keys = Object.keys(nextSnapshot);
      if (!keys.length || !localStorageRef) return { restored: 0 };
      if (replaceExisting) {
        const existingKeys = [];
        for (let index = 0; index < localStorageRef.length; index += 1) {
          const key = localStorageRef.key(index);
          if (key && key.startsWith(DATA_EXPORT_STORAGE_PREFIX)) existingKeys.push(key);
        }
        for (const key of existingKeys) {
          if (!Object.prototype.hasOwnProperty.call(nextSnapshot, key)) localStorageRef.removeItem(key);
        }
      }
      for (const key of keys) {
        localStorageRef.setItem(key, nextSnapshot[key]);
      }
      return { restored: keys.length };
    }

    function setRecoveryStatus(message, tone = "normal") {
      if (!settingsDataSnapshotStatus) return;
      settingsDataSnapshotStatus.textContent = String(message || "").trim();
      settingsDataSnapshotStatus.dataset.tone = tone;
    }

    function getSelectedSnapshot() {
      const id = String(settingsDataSnapshotSelect?.value || "").trim();
      return snapshots.find((snapshot) => snapshot.id === id) || null;
    }

    function formatSnapshotTime(value) {
      const date = new Date(String(value || "").trim());
      if (Number.isNaN(date.getTime())) return "时间未知";
      const datePart = date.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
      const timePart = date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
      return `${datePart} ${timePart}`;
    }

    function formatSnapshotLabel(snapshot) {
      const prefix = snapshot?.isLatest ? "最新备份" : "滚动快照";
      return `${prefix} · ${formatSnapshotTime(snapshot?.capturedAt)}`;
    }

    function formatSnapshotPreview(snapshot) {
      if (!snapshot) return "请选择一个本地快照。";
      const entries = Number.isFinite(Number(snapshot.stats?.entries)) ? Number(snapshot.stats.entries) : 0;
      const todos = Number.isFinite(Number(snapshot.stats?.todos)) ? Number(snapshot.stats.todos) : 0;
      const keys = Number.isFinite(Number(snapshot.storageKeys)) ? Number(snapshot.storageKeys) : 0;
      const type = snapshot.isLatest ? "最新备份" : "滚动快照";
      return `${type}保存于 ${formatSnapshotTime(snapshot.capturedAt)}，含 ${entries} 条记录、${todos} 个待办和 ${keys} 项本地数据。`;
    }

    function syncRecoveryButtons() {
      const selected = getSelectedSnapshot();
      const available = Boolean(selected && !recoveryBusy);
      if (settingsDataSnapshotSelect) settingsDataSnapshotSelect.disabled = recoveryBusy || snapshots.length === 0;
      if (settingsDataSnapshotRefreshBtn) settingsDataSnapshotRefreshBtn.disabled = recoveryBusy || !fetchFn;
      if (settingsDataSnapshotPreviewBtn) settingsDataSnapshotPreviewBtn.disabled = !available;
      if (settingsDataSnapshotRestoreBtn) settingsDataSnapshotRestoreBtn.disabled = !available;
      if (settingsDataSnapshotDeleteBtn) {
        settingsDataSnapshotDeleteBtn.disabled = !available || Boolean(selected?.isLatest);
      }
    }

    function renderSnapshotOptions(selectedId = "") {
      if (!settingsDataSnapshotSelect || !documentRef?.createElement) return;
      const nextSelectedId = selectedId || String(settingsDataSnapshotSelect.value || "").trim();
      settingsDataSnapshotSelect.textContent = "";
      if (!snapshots.length) {
        const option = documentRef.createElement("option");
        option.value = "";
        option.textContent = "暂无可恢复快照";
        settingsDataSnapshotSelect.append(option);
        syncRecoveryButtons();
        return;
      }
      for (const snapshot of snapshots) {
        const option = documentRef.createElement("option");
        option.value = snapshot.id;
        option.textContent = formatSnapshotLabel(snapshot);
        settingsDataSnapshotSelect.append(option);
      }
      const selected = snapshots.find((snapshot) => snapshot.id === nextSelectedId) || snapshots[0];
      settingsDataSnapshotSelect.value = selected.id;
      syncRecoveryButtons();
    }

    async function requestJson(url, options = {}) {
      if (!fetchFn) throw new Error("本地数据接口不可用。");
      const response = await fetchFn(url, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...(options.headers || {}),
        },
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok) {
        throw new Error(String(payload?.message || `请求失败（${response.status}）`));
      }
      return payload.result;
    }

    async function refreshSnapshotList({ silent = false } = {}) {
      if (!fetchFn) return;
      recoveryBusy = true;
      if (!silent) setRecoveryStatus("正在读取本地快照。", "normal");
      syncRecoveryButtons();
      try {
        const result = await requestJson(LOCAL_DATA_SNAPSHOTS_URL, { method: "GET" });
        snapshots = Array.isArray(result?.snapshots) ? result.snapshots : [];
        renderSnapshotOptions();
        if (!snapshots.length) {
          setRecoveryStatus("还没有可恢复的本地快照。", "normal");
        } else if (!silent) {
          setRecoveryStatus(`已读取 ${snapshots.length} 份本地快照。`, "success");
        }
      } catch (error) {
        snapshots = [];
        renderSnapshotOptions();
        setRecoveryStatus(error instanceof Error ? error.message : "本地快照读取失败。", "danger");
      } finally {
        recoveryBusy = false;
        syncRecoveryButtons();
      }
    }

    function previewSelectedSnapshot() {
      const selected = getSelectedSnapshot();
      setRecoveryStatus(formatSnapshotPreview(selected), selected ? "normal" : "warning");
    }

    async function restoreSelectedSnapshot() {
      const selected = getSelectedSnapshot();
      if (!selected || recoveryBusy) return;
      const confirmed = confirmFn(
        "恢复此快照会覆盖当前浏览器中的待办、日历记录、评分、分类和其他观时本地数据。\n\n观时会先保存一份“恢复前快照”。此操作不会修改 macOS 日历或提醒事项。是否继续？",
      );
      if (!confirmed) {
        setRecoveryStatus("已取消恢复。", "normal");
        return;
      }
      recoveryBusy = true;
      setRecoveryStatus("正在保存恢复前快照。", "normal");
      syncRecoveryButtons();
      try {
        const result = await requestJson(LOCAL_DATA_RESTORE_URL, {
          method: "POST",
          body: JSON.stringify({
            snapshotId: selected.id,
            currentSnapshot: buildPayload("before-restore"),
          }),
        });
        const payload = result?.snapshot;
        if (String(payload?.schema || "") !== DATA_EXPORT_SCHEMA || !hasExportableStorage(payload?.storage)) {
          throw new Error("所选快照不可恢复。");
        }
        const restored = applyStorageSnapshot(payload.storage, { replaceExisting: true });
        if (!restored.restored) throw new Error("所选快照没有可恢复的数据。");
        setRecoveryStatus("已保存恢复前快照，正在恢复并刷新页面。", "success");
        setTimeoutFn(() => {
          if (typeof windowRef.location?.reload === "function") windowRef.location.reload();
        }, 180);
      } catch (error) {
        setRecoveryStatus(error instanceof Error ? error.message : "本地快照恢复失败。", "danger");
      } finally {
        recoveryBusy = false;
        syncRecoveryButtons();
      }
    }

    async function deleteSelectedSnapshot() {
      const selected = getSelectedSnapshot();
      if (!selected || selected.isLatest || recoveryBusy) return;
      const confirmed = confirmFn(`删除 ${formatSnapshotLabel(selected)} 吗？删除后无法恢复该快照。`);
      if (!confirmed) return;
      recoveryBusy = true;
      setRecoveryStatus("正在删除本地快照。", "normal");
      syncRecoveryButtons();
      try {
        await requestJson(LOCAL_DATA_SNAPSHOTS_URL, {
          method: "DELETE",
          body: JSON.stringify({ snapshotId: selected.id }),
        });
        await refreshSnapshotList({ silent: true });
        setRecoveryStatus("本地快照已删除。", "success");
      } catch (error) {
        setRecoveryStatus(error instanceof Error ? error.message : "本地快照删除失败。", "danger");
      } finally {
        recoveryBusy = false;
        syncRecoveryButtons();
      }
    }

    function initRecoveryControls() {
      if (!recoveryEventsBound) {
        recoveryEventsBound = true;
        settingsDataSnapshotRefreshBtn?.addEventListener("click", () => {
          void refreshSnapshotList();
        });
        settingsDataSnapshotPreviewBtn?.addEventListener("click", previewSelectedSnapshot);
        settingsDataSnapshotRestoreBtn?.addEventListener("click", () => {
          void restoreSelectedSnapshot();
        });
        settingsDataSnapshotDeleteBtn?.addEventListener("click", () => {
          void deleteSelectedSnapshot();
        });
        settingsDataSnapshotSelect?.addEventListener("change", () => {
          syncRecoveryButtons();
          previewSelectedSnapshot();
        });
      }
      void refreshSnapshotList({ silent: true });
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
      initRecoveryControls,
    };
  }

  globalScope.TimeQualityLocalDataBackupModule = {
    createLocalDataBackupModule,
  };
})(typeof window !== "undefined" ? window : globalThis);
