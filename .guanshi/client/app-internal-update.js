/* global window */

(function attachTimeQualityInternalUpdateModule(globalScope) {
  "use strict";

  function createInternalUpdateModule(deps = {}) {
    const INTERNAL_UPDATE_STATUS_URL = String(deps.INTERNAL_UPDATE_STATUS_URL || "/api/internal-update/status");
    const INTERNAL_UPDATE_CHECK_URL = String(deps.INTERNAL_UPDATE_CHECK_URL || "/api/internal-update/check");
    const INTERNAL_UPDATE_APPLY_URL = String(deps.INTERNAL_UPDATE_APPLY_URL || "/api/internal-update/apply");
    const INTERNAL_UPDATE_FORCE_APPLY_URL = String(deps.INTERNAL_UPDATE_FORCE_APPLY_URL || "/api/internal-update/force-apply");
    const INTERNAL_UPDATE_BACKUPS_URL = String(deps.INTERNAL_UPDATE_BACKUPS_URL || "/api/internal-update/backups");
    const INTERNAL_UPDATE_BACKUP_RESTORE_URL = String(deps.INTERNAL_UPDATE_BACKUP_RESTORE_URL || "/api/internal-update/backups/restore");

    const windowRef = deps.windowRef || globalScope.window || globalScope;
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
          : () => false;

    const settingsUpdateCurrent = deps.settingsUpdateCurrent || null;
    const settingsUpdateLatest = deps.settingsUpdateLatest || null;
    const settingsUpdateWorktree = deps.settingsUpdateWorktree || null;
    const settingsUpdateRemote = deps.settingsUpdateRemote || null;
    const settingsUpdateDetails = deps.settingsUpdateDetails || null;
    const settingsUpdateCheckBtn = deps.settingsUpdateCheckBtn || null;
    const settingsUpdateApplyBtn = deps.settingsUpdateApplyBtn || null;
    const settingsUpdateForceApplyBtn = deps.settingsUpdateForceApplyBtn || null;
    const settingsUpdateBackupSelect = deps.settingsUpdateBackupSelect || null;
    const settingsUpdateBackupExportBtn = deps.settingsUpdateBackupExportBtn || null;
    const settingsUpdateBackupRestoreBtn = deps.settingsUpdateBackupRestoreBtn || null;
    const settingsUpdateBackupDeleteBtn = deps.settingsUpdateBackupDeleteBtn || null;
    const settingsUpdateBackupStatus = deps.settingsUpdateBackupStatus || null;
    const settingsUpdateStatus = deps.settingsUpdateStatus || null;
    const settingsEnvPlatform = deps.settingsEnvPlatform || null;
    const settingsEnvNode = deps.settingsEnvNode || null;
    const settingsEnvChrome = deps.settingsEnvChrome || null;
    const settingsEnvGit = deps.settingsEnvGit || null;

    let eventsBound = false;
    let loading = false;
    let applying = false;
    let backupLoading = false;
    let currentStatus = null;
    let currentUpdate = null;
    let updateBackups = [];

    function setText(node, value) {
      if (!node) return;
      node.textContent = String(value || "--");
    }

    function setCheckText(node, check, fallback = "--") {
      if (!node) return;
      const text = String(check?.value || fallback || "--").trim() || "--";
      node.textContent = text;
      const tone = getCheckTone(check);
      if (tone) {
        node.dataset.tone = tone;
      } else {
        delete node.dataset.tone;
      }
      const message = String(check?.message || "").trim();
      if (message) {
        node.title = message;
      } else {
        node.removeAttribute("title");
      }
    }

    function setStatus(message, tone = "normal") {
      if (!settingsUpdateStatus) return;
      settingsUpdateStatus.textContent = String(message || "").trim();
      settingsUpdateStatus.dataset.tone = tone;
    }

    function setDetails(message) {
      if (!settingsUpdateDetails) return;
      settingsUpdateDetails.textContent = String(message || "").trim();
    }

    function setBackupStatus(message, tone = "normal") {
      if (!settingsUpdateBackupStatus) return;
      settingsUpdateBackupStatus.textContent = String(message || "").trim();
      settingsUpdateBackupStatus.dataset.tone = tone;
    }

    function getShortCommit(status = currentStatus) {
      const text = String(status?.currentShortCommit || status?.currentCommit || "").trim();
      return text ? text.slice(0, 12) : "";
    }

    function getVersionLabel(status = currentStatus) {
      const version = String(status?.packageVersion || "").trim();
      const tag = String(status?.currentTag || "").trim();
      const shortCommit = getShortCommit(status);
      if (version && tag) return `${version} (${tag})`;
      if (version && shortCommit) return `${version} (${shortCommit})`;
      return version || shortCommit || "--";
    }

    function getRemoteLabel(status = currentStatus) {
      const remoteUrl = String(status?.remoteUrl || "").trim();
      if (!remoteUrl) return "--";
      if (status?.originAllowed) return "GitHub Gumo1995/guanshi-runtime";
      return "远端不匹配";
    }

    function getWorktreeLabel(status = currentStatus) {
      if (!status) return "--";
      if (!status.supportedPlatform) return "仅支持 macOS";
      if (!status.isGitRepo) return "不是源码仓库";
      if (!status.originAllowed) return "远端不匹配";
      if (status.dirty) {
        const tracked = Number(status.dirtySummary?.trackedChanges || 0);
        const untracked = Number(status.dirtySummary?.untrackedFiles || 0);
        if (tracked || untracked) return `有改动（已跟踪 ${tracked}，未跟踪 ${untracked}）`;
        return `有 ${status.dirtyFiles?.length || 0} 项未提交改动`;
      }
      return "干净";
    }

    function getLatestLabel(update = currentUpdate) {
      if (!update) return "--";
      if (update.available) return update.tag || update.version || "--";
      if (update.tag) return `${update.tag}（已是最新）`;
      return "--";
    }

    function getEnvironmentCheck(key) {
      return currentStatus?.environment?.checks?.[key] || null;
    }

    function getCheckTone(check) {
      if (!check) return "";
      if (check.supported === false || (check.required && !check.available)) return "danger";
      if (check.recommended === false) return "warning";
      if (!check.available) return "warning";
      return "success";
    }

    function renderEnvironmentChecks() {
      setCheckText(settingsEnvPlatform, getEnvironmentCheck("macos"));
      setCheckText(settingsEnvNode, getEnvironmentCheck("node"));
      setCheckText(settingsEnvChrome, getEnvironmentCheck("chrome"));
      setCheckText(settingsEnvGit, getEnvironmentCheck("git"));
    }

    function syncButtons() {
      if (settingsUpdateCheckBtn) {
        settingsUpdateCheckBtn.disabled = loading || applying || !fetchFn || !currentStatus?.canCheck;
        settingsUpdateCheckBtn.textContent = loading ? "检查中" : "检查更新";
      }
      if (settingsUpdateApplyBtn) {
        const canApply = Boolean(
          currentUpdate?.available &&
            currentUpdate?.tag &&
            currentStatus?.canApply &&
            !loading &&
            !applying &&
            fetchFn,
        );
        settingsUpdateApplyBtn.disabled = !canApply;
        settingsUpdateApplyBtn.textContent = currentUpdate?.available
          ? `更新到 ${currentUpdate.tag}`
          : "更新到稳定版";
      }
      if (settingsUpdateForceApplyBtn) {
        const canForceApply = Boolean(
          currentUpdate?.available &&
            currentUpdate?.tag &&
            currentStatus?.dirty &&
            currentStatus?.canForceApply &&
            !loading &&
            !applying &&
            fetchFn,
        );
        settingsUpdateForceApplyBtn.disabled = !canForceApply;
      }
      syncBackupButtons();
    }

    function getSelectedBackup() {
      const id = String(settingsUpdateBackupSelect?.value || "").trim();
      return updateBackups.find((backup) => backup.id === id) || null;
    }

    function syncBackupButtons() {
      const selected = getSelectedBackup();
      const available = Boolean(selected && !backupLoading && !applying && fetchFn);
      if (settingsUpdateBackupSelect) settingsUpdateBackupSelect.disabled = backupLoading || applying || updateBackups.length === 0;
      if (settingsUpdateBackupExportBtn) settingsUpdateBackupExportBtn.disabled = !available;
      if (settingsUpdateBackupRestoreBtn) settingsUpdateBackupRestoreBtn.disabled = !available;
      if (settingsUpdateBackupDeleteBtn) settingsUpdateBackupDeleteBtn.disabled = !available;
    }

    function render() {
      renderEnvironmentChecks();
      setText(settingsUpdateCurrent, getVersionLabel());
      setText(settingsUpdateLatest, getLatestLabel());
      setText(settingsUpdateWorktree, getWorktreeLabel());
      setText(settingsUpdateRemote, getRemoteLabel());

      if (!fetchFn) {
        setDetails("当前环境无法访问本地更新接口。");
        setStatus("内部更新不可用。", "danger");
      } else if (currentStatus?.disabledMessage && !currentStatus?.canCheck) {
        setDetails(currentStatus.disabledMessage);
        setStatus("内部更新不可用。", "warning");
      } else if (currentStatus?.dirty) {
        setDetails(
          currentUpdate?.available
            ? "检测到未提交改动。可先自行整理，也可使用“备份并强制更新”保留文件后继续。"
            : "检测到未提交改动。检查到新版本后可选择备份并强制更新。",
        );
      } else if (currentUpdate?.available) {
        const dependencyHint = currentUpdate.dependencyFilesChanged
          ? "依赖文件有变化，更新后可能需要重新安装依赖。"
          : "更新完成后需要重启 App。";
        setDetails(dependencyHint);
      } else if (!currentUpdate) {
        setDetails("未检查。");
      } else {
        setDetails("当前没有更高的稳定 tag。");
      }

      syncButtons();
    }

    async function requestJson(url, options = {}) {
      if (!fetchFn) {
        throw new Error("FETCH_UNAVAILABLE");
      }
      const response = await fetchFn(url, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...(options.headers || {}),
        },
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok) {
        const message = String(payload?.message || response.statusText || "请求失败");
        const error = new Error(message);
        error.payload = payload;
        throw error;
      }
      return payload.result;
    }

    function formatBackupTime(value) {
      const date = new Date(String(value || "").trim());
      if (Number.isNaN(date.getTime())) return "时间未知";
      const datePart = date.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
      const timePart = date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
      return `${datePart} ${timePart}`;
    }

    function formatBackupLabel(backup) {
      const target = String(backup?.targetTag || "").trim();
      return `更新前备份 · ${formatBackupTime(backup?.createdAt)}${target ? ` · ${target}` : ""}`;
    }

    function renderBackupOptions(selectedId = "") {
      const documentRef = globalScope.document;
      if (!settingsUpdateBackupSelect || !documentRef?.createElement) return;
      const nextSelectedId = selectedId || String(settingsUpdateBackupSelect.value || "").trim();
      settingsUpdateBackupSelect.textContent = "";
      if (!updateBackups.length) {
        const option = documentRef.createElement("option");
        option.value = "";
        option.textContent = "暂无更新保护备份";
        settingsUpdateBackupSelect.append(option);
        syncBackupButtons();
        return;
      }
      for (const backup of updateBackups) {
        const option = documentRef.createElement("option");
        option.value = backup.id;
        option.textContent = formatBackupLabel(backup);
        settingsUpdateBackupSelect.append(option);
      }
      const selected = updateBackups.find((backup) => backup.id === nextSelectedId) || updateBackups[0];
      settingsUpdateBackupSelect.value = selected.id;
      syncBackupButtons();
    }

    function formatBackupPreview(backup) {
      if (!backup) return "请选择一份更新保护备份。";
      const tracked = Number(backup.trackedChanges || 0);
      const untracked = Number(backup.untrackedFiles || 0);
      const previous = String(backup.previousTag || backup.previousVersion || "旧版本").trim();
      const target = String(backup.targetTag || "新版本").trim();
      return `从 ${previous} 更新到 ${target} 前保存，含 ${tracked} 项已跟踪改动和 ${untracked} 个未跟踪文件。`;
    }

    async function refreshUpdateBackups({ silent = false } = {}) {
      if (!fetchFn) return;
      backupLoading = true;
      if (!silent) setBackupStatus("正在读取更新保护备份。", "normal");
      syncButtons();
      try {
        const result = await requestJson(INTERNAL_UPDATE_BACKUPS_URL, { method: "GET" });
        updateBackups = Array.isArray(result?.backups) ? result.backups : [];
        renderBackupOptions();
        if (!updateBackups.length) {
          setBackupStatus("暂无更新保护备份。", "normal");
        } else if (!silent) {
          setBackupStatus(`已读取 ${updateBackups.length} 份更新保护备份。`, "success");
        }
      } catch (error) {
        updateBackups = [];
        renderBackupOptions();
        setBackupStatus(error instanceof Error ? error.message : "更新保护备份读取失败。", "danger");
      } finally {
        backupLoading = false;
        syncButtons();
      }
    }

    async function exportSelectedBackup() {
      const backup = getSelectedBackup();
      if (!backup || backupLoading || applying) return;
      backupLoading = true;
      setBackupStatus("正在导出更新保护备份。", "normal");
      syncButtons();
      try {
        const result = await requestJson(INTERNAL_UPDATE_BACKUP_RESTORE_URL, {
          method: "POST",
          body: JSON.stringify({ backupId: backup.id, mode: "export" }),
        });
        setBackupStatus(`已导出副本到 ${String(result?.exportDirectory || "恢复目录")}。`, "success");
      } catch (error) {
        setBackupStatus(error instanceof Error ? error.message : "更新保护备份导出失败。", "danger");
      } finally {
        backupLoading = false;
        syncButtons();
      }
    }

    async function restoreSelectedBackupToOriginal() {
      const backup = getSelectedBackup();
      if (!backup || backupLoading || applying) return;
      const confirmed = confirmFn(
        "恢复到原位置会先导出一份副本。未跟踪文件只会在原位置为空时回写；遇到同名文件会放入恢复目录。已跟踪的源码改动会尝试以补丁恢复，无法套用时保留导出的补丁。是否继续？",
      );
      if (!confirmed) {
        setBackupStatus("已取消恢复。", "normal");
        return;
      }
      backupLoading = true;
      setBackupStatus("正在恢复更新前文件。", "normal");
      syncButtons();
      try {
        const result = await requestJson(INTERNAL_UPDATE_BACKUP_RESTORE_URL, {
          method: "POST",
          body: JSON.stringify({ backupId: backup.id, mode: "original" }),
        });
        const restored = Array.isArray(result?.restoredPaths) ? result.restoredPaths.length : 0;
        const conflicts = Array.isArray(result?.conflictPaths) ? result.conflictPaths.length : 0;
        const patchText = result?.trackedPatchApplied ? "已跟踪改动已恢复。" : String(result?.trackedPatchMessage || "");
        setBackupStatus(`已恢复 ${restored} 个文件，${conflicts} 个同名文件已导出。${patchText}`, "success");
        void loadStatus();
      } catch (error) {
        setBackupStatus(error instanceof Error ? error.message : "更新保护备份恢复失败。", "danger");
      } finally {
        backupLoading = false;
        syncButtons();
      }
    }

    async function deleteSelectedBackup() {
      const backup = getSelectedBackup();
      if (!backup || backupLoading || applying) return;
      const confirmed = confirmFn(`删除 ${formatBackupLabel(backup)} 吗？删除后无法恢复这份更新前文件。`);
      if (!confirmed) return;
      backupLoading = true;
      setBackupStatus("正在删除更新保护备份。", "normal");
      syncButtons();
      try {
        await requestJson(INTERNAL_UPDATE_BACKUPS_URL, {
          method: "DELETE",
          body: JSON.stringify({ backupId: backup.id }),
        });
        await refreshUpdateBackups({ silent: true });
        setBackupStatus("更新保护备份已删除。", "success");
      } catch (error) {
        setBackupStatus(error instanceof Error ? error.message : "更新保护备份删除失败。", "danger");
      } finally {
        backupLoading = false;
        syncButtons();
      }
    }

    async function loadStatus() {
      loading = true;
      syncButtons();
      try {
        const result = await requestJson(INTERNAL_UPDATE_STATUS_URL, { method: "GET" });
        currentStatus = result && typeof result === "object" ? result : null;
        currentUpdate = null;
        if (currentStatus?.canCheck) {
          setStatus("可以检查 GitHub 稳定版本。", "normal");
        } else {
          setStatus(currentStatus?.disabledMessage || "内部更新不可用。", "warning");
        }
      } catch (error) {
        currentStatus = null;
        currentUpdate = null;
        setStatus(error instanceof Error ? error.message : "读取更新状态失败。", "danger");
        setDetails("状态读取失败。");
      } finally {
        loading = false;
        render();
      }
    }

    async function checkForUpdates() {
      loading = true;
      currentUpdate = null;
      setStatus("正在检查 GitHub 稳定 tag。", "normal");
      syncButtons();
      try {
        const result = await requestJson(INTERNAL_UPDATE_CHECK_URL, { method: "POST", body: "{}" });
        currentStatus = result?.status || currentStatus;
        currentUpdate = result?.update || null;
        if (currentUpdate?.available) {
          const blocked = currentStatus?.dirty ? "，但当前工作区不干净" : "";
          setStatus(`发现 ${currentUpdate.tag}${blocked}。`, currentStatus?.dirty ? "warning" : "success");
        } else {
          setStatus("当前已经是最新稳定版本。", "success");
        }
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "检查更新失败。", "danger");
      } finally {
        loading = false;
        render();
      }
    }

    async function applyUpdate() {
      const tag = String(currentUpdate?.tag || "").trim();
      if (!tag || applying || loading) return;
      const dependencyHint = currentUpdate?.dependencyFilesChanged
        ? "\n\n依赖文件有变化，更新后可能需要重新安装依赖。"
        : "";
      const confirmed = confirmFn(`确认更新到 ${tag} 吗？更新完成后需要重启 App。${dependencyHint}`);
      if (!confirmed) {
        setStatus("已取消更新。", "normal");
        return;
      }

      applying = true;
      setStatus(`正在更新到 ${tag}。`, "normal");
      syncButtons();
      try {
        const result = await requestJson(INTERNAL_UPDATE_APPLY_URL, {
          method: "POST",
          body: JSON.stringify({ tag }),
        });
        currentUpdate = {
          ...currentUpdate,
          available: false,
        };
        const nextVersion = String(result?.targetVersion || tag).trim();
        setStatus(`已更新到 ${nextVersion}，请退出并重新打开 App。`, "success");
        setDetails(result?.dependencyFilesChanged ? "依赖文件有变化，重启前请确认依赖已安装。" : "重启后生效。");
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "应用更新失败。", "danger");
      } finally {
        applying = false;
        render();
      }
    }

    async function forceApplyUpdate() {
      const tag = String(currentUpdate?.tag || "").trim();
      if (!tag || applying || loading || !currentStatus?.dirty) return;
      const dependencyHint = currentUpdate?.dependencyFilesChanged
        ? "\n\n依赖文件有变化，更新后可能需要重新安装依赖。"
        : "";
      const confirmed = confirmFn(
        `确认备份当前未提交文件并强制更新到 ${tag} 吗？\n\n观时会把已跟踪改动保存为补丁，并把未跟踪文件移到 .runtime 的更新保护备份中。更新完成后需要重启 App。${dependencyHint}`,
      );
      if (!confirmed) {
        setStatus("已取消强制更新。", "normal");
        return;
      }

      applying = true;
      setStatus(`正在备份文件并更新到 ${tag}。`, "normal");
      syncButtons();
      try {
        const result = await requestJson(INTERNAL_UPDATE_FORCE_APPLY_URL, {
          method: "POST",
          body: JSON.stringify({ tag }),
        });
        currentUpdate = {
          ...currentUpdate,
          available: false,
        };
        const nextVersion = String(result?.targetVersion || tag).trim();
        const backupId = String(result?.backup?.id || "").trim();
        const backupHint = backupId ? `已创建更新保护备份 ${backupId}。` : "当前目录无需额外备份。";
        setStatus(`已更新到 ${nextVersion}，${backupHint}请退出并重新打开 App。`, "success");
        setDetails(result?.dependencyFilesChanged ? "依赖文件有变化，重启前请确认依赖已安装。" : "重启后生效。需要时可在下方恢复更新前文件。");
        void refreshUpdateBackups({ silent: true });
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "强制更新失败。", "danger");
      } finally {
        applying = false;
        render();
      }
    }

    function bindEvents() {
      if (eventsBound) return;
      eventsBound = true;
      if (settingsUpdateCheckBtn) {
        settingsUpdateCheckBtn.addEventListener("click", () => {
          void checkForUpdates();
        });
      }
      if (settingsUpdateApplyBtn) {
        settingsUpdateApplyBtn.addEventListener("click", () => {
          void applyUpdate();
        });
      }
      if (settingsUpdateForceApplyBtn) {
        settingsUpdateForceApplyBtn.addEventListener("click", () => {
          void forceApplyUpdate();
        });
      }
      if (settingsUpdateBackupSelect) {
        settingsUpdateBackupSelect.addEventListener("change", () => {
          setBackupStatus(formatBackupPreview(getSelectedBackup()), "normal");
          syncBackupButtons();
        });
      }
      if (settingsUpdateBackupExportBtn) {
        settingsUpdateBackupExportBtn.addEventListener("click", () => {
          void exportSelectedBackup();
        });
      }
      if (settingsUpdateBackupRestoreBtn) {
        settingsUpdateBackupRestoreBtn.addEventListener("click", () => {
          void restoreSelectedBackupToOriginal();
        });
      }
      if (settingsUpdateBackupDeleteBtn) {
        settingsUpdateBackupDeleteBtn.addEventListener("click", () => {
          void deleteSelectedBackup();
        });
      }
    }

    function init() {
      render();
      void loadStatus();
      void refreshUpdateBackups({ silent: true });
    }

    return {
      init,
      bindEvents,
      render,
      loadStatus,
      checkForUpdates,
      forceApplyUpdate,
      refreshUpdateBackups,
    };
  }

  globalScope.TimeQualityInternalUpdateModule = {
    createInternalUpdateModule,
  };
})(typeof window !== "undefined" ? window : globalThis);
