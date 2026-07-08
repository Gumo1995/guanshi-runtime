/* global window */

(function attachTimeQualityInternalUpdateModule(globalScope) {
  "use strict";

  function createInternalUpdateModule(deps = {}) {
    const INTERNAL_UPDATE_STATUS_URL = String(deps.INTERNAL_UPDATE_STATUS_URL || "/api/internal-update/status");
    const INTERNAL_UPDATE_CHECK_URL = String(deps.INTERNAL_UPDATE_CHECK_URL || "/api/internal-update/check");
    const INTERNAL_UPDATE_APPLY_URL = String(deps.INTERNAL_UPDATE_APPLY_URL || "/api/internal-update/apply");

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
    const settingsUpdateStatus = deps.settingsUpdateStatus || null;

    let eventsBound = false;
    let loading = false;
    let applying = false;
    let currentStatus = null;
    let currentUpdate = null;

    function setText(node, value) {
      if (!node) return;
      node.textContent = String(value || "--");
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
      if (status.dirty) return `有 ${status.dirtyFiles?.length || 0} 项未提交改动`;
      return "干净";
    }

    function getLatestLabel(update = currentUpdate) {
      if (!update) return "--";
      if (update.available) return update.tag || update.version || "--";
      if (update.tag) return `${update.tag}（已是最新）`;
      return "--";
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
    }

    function render() {
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
        setDetails("请先提交或清理当前源码改动，再执行更新。");
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
    }

    function init() {
      render();
      void loadStatus();
    }

    return {
      init,
      bindEvents,
      render,
      loadStatus,
      checkForUpdates,
    };
  }

  globalScope.TimeQualityInternalUpdateModule = {
    createInternalUpdateModule,
  };
})(typeof window !== "undefined" ? window : globalThis);
