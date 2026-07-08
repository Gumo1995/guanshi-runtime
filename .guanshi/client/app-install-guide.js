/* global window */

(function attachTimeQualityInstallGuideModule(globalScope) {
  "use strict";

  function createInstallGuideModule(deps = {}) {
    const INSTALL_GUIDE_DISMISSED_KEY = String(
      deps.INSTALL_GUIDE_DISMISSED_KEY || "time_quality_install_guide_dismissed_v1",
    );

    const windowRef = deps.windowRef || globalScope.window || globalScope;
    const navigatorRef = deps.navigatorRef || windowRef.navigator || null;
    const localStorageRef = deps.localStorageRef || windowRef.localStorage || null;
    const locationRef = deps.locationRef || windowRef.location || null;
    const setActiveView = typeof deps.setActiveView === "function" ? deps.setActiveView : null;

    const installGuideBanner = deps.installGuideBanner || null;
    const installGuideBannerInstallBtn = deps.installGuideBannerInstallBtn || null;
    const installGuideBannerSettingsBtn = deps.installGuideBannerSettingsBtn || null;
    const installGuideBannerDismissBtn = deps.installGuideBannerDismissBtn || null;
    const settingsInstallMode = deps.settingsInstallMode || null;
    const settingsInstallBtn = deps.settingsInstallBtn || null;
    const settingsInstallCopyBtn = deps.settingsInstallCopyBtn || null;
    const settingsInstallStatus = deps.settingsInstallStatus || null;

    let eventsBound = false;
    let serviceWorkerRegistered = false;
    let deferredInstallPrompt = null;
    let promptAvailable = false;
    let installed = false;

    function safeGetLocalStorage(key) {
      try {
        return localStorageRef ? localStorageRef.getItem(key) : "";
      } catch {
        return "";
      }
    }

    function safeSetLocalStorage(key, value) {
      try {
        if (localStorageRef) localStorageRef.setItem(key, value);
      } catch {
        // ignore localStorage write failures
      }
    }

    function isStandaloneDisplayMode() {
      const matchMediaFn = typeof windowRef.matchMedia === "function" ? windowRef.matchMedia.bind(windowRef) : null;
      if (matchMediaFn && matchMediaFn("(display-mode: standalone)").matches) return true;
      if (matchMediaFn && matchMediaFn("(display-mode: window-controls-overlay)").matches) return true;
      return Boolean(navigatorRef?.standalone);
    }

    function isChromeLike() {
      const brands = Array.isArray(navigatorRef?.userAgentData?.brands) ? navigatorRef.userAgentData.brands : [];
      if (brands.some((item) => /Chromium|Google Chrome/i.test(String(item?.brand || "")))) return true;
      const userAgent = String(navigatorRef?.userAgent || "");
      if (/Edg|OPR|Firefox/i.test(userAgent)) return false;
      return /Chrome|Chromium/i.test(userAgent);
    }

    function isLocalHttpOrigin() {
      const protocol = String(locationRef?.protocol || "");
      const hostname = String(locationRef?.hostname || "");
      return (
        protocol === "https:" ||
        (protocol === "http:" && (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"))
      );
    }

    function isBannerDismissed() {
      return safeGetLocalStorage(INSTALL_GUIDE_DISMISSED_KEY) === "1";
    }

    function setStatus(message, tone = "normal") {
      if (!settingsInstallStatus) return;
      settingsInstallStatus.textContent = String(message || "").trim();
      settingsInstallStatus.dataset.tone = tone;
    }

    function setModeLabel(label, tone = "normal") {
      if (!settingsInstallMode) return;
      settingsInstallMode.textContent = String(label || "").trim() || "--";
      settingsInstallMode.dataset.tone = tone;
    }

    function syncInstallButton(button, fallbackLabel = "查看步骤") {
      if (!button) return;
      button.disabled = false;
      button.textContent = promptAvailable ? "安装观时" : fallbackLabel;
    }

    function render() {
      installed = isStandaloneDisplayMode();
      const chromeLike = isChromeLike();
      const localOrigin = isLocalHttpOrigin();

      if (installed) {
        setModeLabel("独立窗口", "success");
        setStatus("当前已是独立窗口；如还没固定到启动台或 Dock，可继续按步骤安装。", "success");
      } else if (!chromeLike) {
        setModeLabel("需要 Chrome", "warning");
        setStatus("请先用 Chrome 打开当前地址，再按步骤安装。", "warning");
      } else if (!localOrigin) {
        setModeLabel("来源受限", "warning");
        setStatus("请从本机 127.0.0.1 或 localhost 地址打开后安装。", "warning");
      } else if (promptAvailable) {
        setModeLabel("可安装", "success");
        setStatus("可以直接点击安装，也可以按步骤从 Chrome 菜单安装。", "success");
      } else {
        setModeLabel("手动安装", "normal");
        setStatus("如果没有安装按钮，请用 Chrome 菜单创建快捷方式并勾选作为窗口打开。", "normal");
      }

      syncInstallButton(settingsInstallBtn, "查看步骤");
      syncInstallButton(installGuideBannerInstallBtn, "安装");

      if (installGuideBanner) {
        installGuideBanner.hidden = isBannerDismissed();
      }
    }

    async function registerServiceWorker() {
      if (serviceWorkerRegistered || !navigatorRef?.serviceWorker || !isLocalHttpOrigin()) return;
      serviceWorkerRegistered = true;
      try {
        await navigatorRef.serviceWorker.register("/service-worker.js", { scope: "/" });
      } catch {
        // Manual Chrome installation remains available from the browser menu.
      } finally {
        render();
      }
    }

    async function promptInstall(options = {}) {
      if (!promptAvailable || !deferredInstallPrompt) {
        setStatus("请用 Chrome 地址栏安装图标，或菜单中的创建快捷方式完成安装。", "normal");
        if (options.fallbackToSettings) openSettingsGuide();
        return;
      }
      const promptEvent = deferredInstallPrompt;
      deferredInstallPrompt = null;
      promptAvailable = false;
      try {
        await promptEvent.prompt();
        const choice = await promptEvent.userChoice;
        setStatus(choice?.outcome === "accepted" ? "安装已开始。" : "已取消安装。", "normal");
      } catch {
        setStatus("请从 Chrome 菜单手动创建快捷方式。", "warning");
      } finally {
        render();
      }
    }

    async function copyCurrentAddress() {
      const href = String(locationRef?.href || "");
      if (!href) {
        setStatus("当前地址不可复制。", "warning");
        return;
      }
      try {
        if (!navigatorRef?.clipboard?.writeText) throw new Error("CLIPBOARD_UNAVAILABLE");
        await navigatorRef.clipboard.writeText(href);
        setStatus("已复制当前地址。", "success");
      } catch {
        setStatus(href, "normal");
      }
    }

    function openSettingsGuide() {
      if (setActiveView) setActiveView("settings");
      setStatus("按卡片中的步骤完成安装。", "normal");
    }

    function dismissBanner() {
      safeSetLocalStorage(INSTALL_GUIDE_DISMISSED_KEY, "1");
      render();
    }

    function bindEvents() {
      if (eventsBound) return;
      eventsBound = true;

      settingsInstallBtn?.addEventListener("click", () => {
        void promptInstall();
      });
      installGuideBannerInstallBtn?.addEventListener("click", () => {
        void promptInstall({ fallbackToSettings: true });
      });
      settingsInstallCopyBtn?.addEventListener("click", () => {
        void copyCurrentAddress();
      });
      installGuideBannerSettingsBtn?.addEventListener("click", openSettingsGuide);
      installGuideBannerDismissBtn?.addEventListener("click", dismissBanner);

      windowRef.addEventListener("beforeinstallprompt", (event) => {
        event.preventDefault();
        deferredInstallPrompt = event;
        promptAvailable = true;
        render();
      });

      windowRef.addEventListener("appinstalled", () => {
        installed = true;
        safeSetLocalStorage(INSTALL_GUIDE_DISMISSED_KEY, "1");
        setStatus("已安装为独立应用。", "success");
        render();
      });
    }

    function init() {
      render();
      void registerServiceWorker();
    }

    return {
      init,
      bindEvents,
      render,
      promptInstall,
      copyCurrentAddress,
    };
  }

  globalScope.TimeQualityInstallGuideModule = {
    createInstallGuideModule,
  };
})(typeof window !== "undefined" ? window : globalThis);
