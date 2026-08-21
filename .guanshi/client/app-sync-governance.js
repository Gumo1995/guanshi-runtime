/* global window */

(function attachTimeQualitySyncGovernanceModule(globalScope) {
  "use strict";

  const FIELD_META = {
    title: { label: "标题", fallback: "未填写" },
    dueDate: { label: "日期", fallback: "未安排" },
    startTime: { label: "开始", fallback: "未安排" },
    endTime: { label: "结束", fallback: "未安排" },
    note: { label: "备注", fallback: "无" },
    qualityScore: { label: "质量", fallback: "未评分" },
    happinessScore: { label: "幸福感", fallback: "未评分" },
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function normalizeIssue(raw, index = 0) {
    const issue = raw && typeof raw === "object" ? raw : {};
    const type = ["conflict", "missing", "failure"].includes(String(issue.type || ""))
      ? String(issue.type)
      : "failure";
    const id = String(issue.id || `${type}-${index + 1}`).trim();
    const local = issue.local && typeof issue.local === "object" ? { ...issue.local } : {};
    const remote = issue.remote && typeof issue.remote === "object" ? { ...issue.remote } : {};
    const changedFields = Array.from(new Set(
      (Array.isArray(issue.changedFields) ? issue.changedFields : [])
        .map((field) => String(field || "").trim())
        .filter((field) => FIELD_META[field]),
    ));
    const recommendationFields = issue.recommendation?.fields && typeof issue.recommendation.fields === "object"
      ? { ...issue.recommendation.fields }
      : {};
    return {
      ...issue,
      id,
      type,
      taskId: String(issue.taskId || "").trim(),
      subject: String(issue.subject || local.title || "同步项目").trim() || "同步项目",
      message: String(issue.message || "同步过程中出现问题。").trim(),
      local,
      remote,
      changedFields,
      localLabel: String(issue.localLabel || "Todo").trim() || "Todo",
      remoteLabel: String(issue.remoteLabel || "Calendar").trim() || "Calendar",
      recommendation: {
        title: String(issue.recommendation?.title || "保留本地数据，确认后再同步").trim(),
        reason: String(issue.recommendation?.reason || "未确认前不会覆盖任何一侧。").trim(),
        fields: recommendationFields,
      },
    };
  }

  function createSyncGovernanceModule(deps = {}) {
    const modal = deps.modal || null;
    const issueNav = deps.issueNav || null;
    const content = deps.content || null;
    const normalCount = deps.normalCount || null;
    const remainingCount = deps.remainingCount || null;
    const updateBodyModalState = typeof deps.updateBodyModalState === "function"
      ? deps.updateBodyModalState
      : () => {};
    const onAction = typeof deps.onAction === "function" ? deps.onAction : async () => ({ resolved: false });

    let issues = [];
    let activeIndex = 0;
    let completedCount = 0;
    let trigger = "manual";
    let busy = false;

    function isOpen() {
      return Boolean(modal && !modal.hidden);
    }

    function getIssues() {
      return issues.map((issue) => ({ ...issue }));
    }

    function getActiveIssue() {
      return issues[activeIndex] || null;
    }

    function formatFieldValue(field, value) {
      const meta = FIELD_META[field] || { fallback: "—" };
      const text = String(value ?? "").trim();
      return text || meta.fallback;
    }

    function renderIssueNav() {
      if (!issueNav) return;
      issueNav.innerHTML = issues.map((issue, index) => `
        <button
          class="sync-governance-step${index === activeIndex ? " is-active" : ""}"
          type="button"
          data-sync-governance-step="${index}"
          aria-label="问题 ${index + 1}：${escapeHtml(issue.subject)}"
          aria-current="${index === activeIndex ? "step" : "false"}"
        >${index + 1}</button>
      `).join("");
    }

    function renderConflict(issue) {
      const localLabel = issue.localLabel || "Todo";
      const remoteLabel = issue.remoteLabel || "Calendar";
      const fields = issue.changedFields.length
        ? issue.changedFields
        : Object.keys(FIELD_META).filter((field) => formatFieldValue(field, issue.local[field]) !== formatFieldValue(field, issue.remote[field]));
      const visibleFields = fields.filter((field) => field !== "externalCalendarId");
      const diffRows = visibleFields.map((field) => {
        const recommendedSource = String(issue.recommendation.fields[field] || "local") === "remote" ? "remote" : "local";
        return `
          <div class="sync-governance-diff-row">
            <span class="sync-governance-diff-field">${escapeHtml(FIELD_META[field].label)}</span>
            <span class="sync-governance-diff-value${recommendedSource === "local" ? " is-recommended" : ""}">
              ${escapeHtml(formatFieldValue(field, issue.local[field]))}
              ${recommendedSource === "local" ? '<i class="sync-governance-recommend-mark">建议</i>' : ""}
            </span>
            <span class="sync-governance-diff-value${recommendedSource === "remote" ? " is-recommended" : ""}">
              ${escapeHtml(formatFieldValue(field, issue.remote[field]))}
              ${recommendedSource === "remote" ? '<i class="sync-governance-recommend-mark">建议</i>' : ""}
            </span>
          </div>
        `;
      }).join("");
      const choices = visibleFields.map((field) => {
        const recommendedSource = String(issue.recommendation.fields[field] || "local") === "remote" ? "remote" : "local";
        return `
          <div class="sync-governance-choice-row">
            <span>${escapeHtml(FIELD_META[field].label)}</span>
            <span class="sync-governance-segmented" data-sync-choice-group="${escapeHtml(field)}">
              <button class="${recommendedSource === "local" ? "is-selected" : ""}" type="button" data-sync-choice-field="${escapeHtml(field)}" data-sync-choice-source="local">${escapeHtml(localLabel)}</button>
              <button class="${recommendedSource === "remote" ? "is-selected" : ""}" type="button" data-sync-choice-field="${escapeHtml(field)}" data-sync-choice-source="remote">${escapeHtml(remoteLabel)}</button>
            </span>
          </div>
        `;
      }).join("");

      return `
        <div class="sync-governance-kicker"><span>需要选择</span><small>问题 ${activeIndex + 1} / ${issues.length} · ${escapeHtml(issue.subject)}</small></div>
        <h3>${escapeHtml(localLabel)} 与 ${escapeHtml(remoteLabel)} 的内容不同</h3>
        <section class="sync-governance-recommendation">
          <div class="sync-governance-recommend-icon">✓</div>
          <div>
            <small>建议方案</small>
            <h4>${escapeHtml(issue.recommendation.title)}</h4>
            <p>${escapeHtml(issue.recommendation.reason)}</p>
          </div>
        </section>
        <p class="sync-governance-section-label">仅显示 ${visibleFields.length} 处差异</p>
        <div class="sync-governance-diff">
          <div class="sync-governance-diff-head"><span>字段</span><span>${escapeHtml(localLabel)}</span><span>${escapeHtml(remoteLabel)}</span></div>
          ${diffRows || '<p class="sync-governance-empty">未找到可比较字段，可保留 Todo 后重试。</p>'}
        </div>
        <div class="sync-governance-choice-editor" data-sync-choice-editor hidden>${choices}</div>
        <details class="sync-governance-evidence">
          <summary>查看判断依据</summary>
          <p>${escapeHtml(issue.message)}</p>
        </details>
        <div class="sync-governance-actions">
          <button class="btn-primary" type="button" data-sync-governance-action="apply-recommendation">采用建议并同步</button>
          <button class="btn-secondary" type="button" data-sync-governance-action="keep-todo">全部保留 ${escapeHtml(localLabel)}</button>
          <button class="sync-governance-ghost" type="button" data-sync-governance-action="customize">逐项选择</button>
          <button class="sync-governance-ghost" type="button" data-sync-governance-action="later">稍后处理</button>
        </div>
      `;
    }

    function renderMissing(issue) {
      const date = formatFieldValue("dueDate", issue.local.dueDate);
      const start = formatFieldValue("startTime", issue.local.startTime);
      return `
        <div class="sync-governance-kicker"><span>远端缺失</span><small>问题 ${activeIndex + 1} / ${issues.length} · ${escapeHtml(issue.subject)}</small></div>
        <h3>Todo 仍存在，但 Calendar 中已找不到事件</h3>
        <section class="sync-governance-recommendation is-warning">
          <div class="sync-governance-recommend-icon">↻</div>
          <div>
            <small>建议方案</small>
            <h4>${escapeHtml(issue.recommendation.title)}</h4>
            <p>${escapeHtml(issue.recommendation.reason)}</p>
          </div>
        </section>
        <p class="sync-governance-section-label">差异状态</p>
        <div class="sync-governance-state-compare">
          <div><small>Todo</small><strong>${escapeHtml(issue.subject)}</strong><p>${escapeHtml(`${date} · ${start}`)}</p></div>
          <b>→</b>
          <div><small>Calendar</small><strong>未找到事件</strong><p>可能被删除或未完整读取</p></div>
        </div>
        <details class="sync-governance-evidence">
          <summary>查看判断依据</summary>
          <p>${escapeHtml(issue.message)}</p>
        </details>
        <div class="sync-governance-actions">
          <button class="btn-primary" type="button" data-sync-governance-action="recreate-calendar">采用建议并同步</button>
          <button class="btn-secondary sync-governance-danger" type="button" data-sync-governance-action="delete-local">采用 Calendar 删除</button>
          <button class="sync-governance-ghost" type="button" data-sync-governance-action="later">稍后处理</button>
        </div>
      `;
    }

    function renderFailure(issue) {
      return `
        <div class="sync-governance-kicker"><span>同步失败</span><small>问题 ${activeIndex + 1} / ${issues.length} · ${escapeHtml(issue.subject)}</small></div>
        <h3>${escapeHtml(issue.heading || "这项数据未能完成同步")}</h3>
        <section class="sync-governance-recommendation is-danger">
          <div class="sync-governance-recommend-icon">!</div>
          <div>
            <small>建议方案</small>
            <h4>${escapeHtml(issue.recommendation.title)}</h4>
            <p>${escapeHtml(issue.recommendation.reason)}</p>
          </div>
        </section>
        <div class="sync-governance-error"><strong>失败原因：</strong>${escapeHtml(issue.message)}</div>
        <div class="sync-governance-actions">
          <button class="btn-primary" type="button" data-sync-governance-action="retry">重新尝试</button>
          <button class="btn-secondary" type="button" data-sync-governance-action="copy-error">复制错误信息</button>
          <button class="sync-governance-ghost" type="button" data-sync-governance-action="later">稍后处理</button>
        </div>
      `;
    }

    function render() {
      const issue = getActiveIssue();
      renderIssueNav();
      if (normalCount) normalCount.textContent = String(completedCount);
      if (remainingCount) remainingCount.textContent = String(issues.length);
      if (!content) return;
      if (!issue) {
        content.innerHTML = `
          <div class="sync-governance-complete">
            <span>✓</span>
            <h3>同步问题已处理完成</h3>
            <p>Todo 与 Calendar 已按你的选择更新。</p>
            <button class="btn-primary" type="button" data-sync-governance-close="true">完成</button>
          </div>
        `;
        return;
      }
      content.innerHTML = issue.type === "conflict"
        ? renderConflict(issue)
        : issue.type === "missing"
          ? renderMissing(issue)
          : renderFailure(issue);
    }

    function open(payload = {}) {
      issues = (Array.isArray(payload.issues) ? payload.issues : []).map(normalizeIssue);
      activeIndex = 0;
      completedCount = Math.max(0, Number(payload.completedCount || 0));
      trigger = String(payload.trigger || "manual") === "automatic" ? "automatic" : "manual";
      render();
      if (!modal) return false;
      modal.hidden = false;
      updateBodyModalState();
      globalScope.setTimeout(() => {
        const focusTarget = modal.querySelector("[data-sync-governance-action], [data-sync-governance-close]");
        if (focusTarget && typeof focusTarget.focus === "function") focusTarget.focus();
      }, 0);
      return true;
    }

    function close() {
      if (!modal || modal.hidden) return;
      modal.hidden = true;
      updateBodyModalState();
    }

    function collectChoices(issue, mode = "recommended") {
      const fields = issue.changedFields.filter((field) => FIELD_META[field]);
      const choices = {};
      for (const field of fields) {
        if (mode === "local") {
          choices[field] = "local";
          continue;
        }
        const selected = modal?.querySelector(`[data-sync-choice-field="${field}"].is-selected`);
        choices[field] = mode === "selected"
          ? String(selected?.dataset?.syncChoiceSource || issue.recommendation.fields[field] || "local")
          : String(issue.recommendation.fields[field] || "local");
      }
      return choices;
    }

    function advanceAfterResolved(issueId) {
      const resolvedIndex = issues.findIndex((issue) => issue.id === issueId);
      if (resolvedIndex >= 0) issues.splice(resolvedIndex, 1);
      if (activeIndex >= issues.length) activeIndex = Math.max(0, issues.length - 1);
      render();
    }

    async function runAction(action) {
      const issue = getActiveIssue();
      if (!issue || busy) return;
      if (action === "later") {
        if (issues.length <= 1) {
          close();
          return;
        }
        activeIndex = (activeIndex + 1) % issues.length;
        render();
        return;
      }
      if (action === "customize") {
        const editor = modal?.querySelector("[data-sync-choice-editor]");
        if (!editor) return;
        editor.hidden = !editor.hidden;
        const button = modal.querySelector('[data-sync-governance-action="customize"]');
        if (button) button.textContent = editor.hidden ? "逐项选择" : "收起逐项选择";
        return;
      }
      if (action === "copy-error") {
        await onAction({ action, issue, trigger, choices: {} });
        return;
      }
      if (action === "delete-local") {
        const confirmed = globalScope.confirm(`确认删除 Todo“${issue.subject}”吗？此操作会采用 Calendar 当前的删除状态。`);
        if (!confirmed) return;
      }
      const choices = action === "keep-todo"
        ? collectChoices(issue, "local")
        : action === "apply-recommendation"
          ? collectChoices(issue, modal?.querySelector("[data-sync-choice-editor]:not([hidden])") ? "selected" : "recommended")
          : {};
      busy = true;
      if (modal) modal.dataset.busy = "true";
      try {
        const result = await onAction({ action, issue, trigger, choices });
        if (result?.resolved) {
          completedCount += 1;
          advanceAfterResolved(issue.id);
        } else if (result?.message && content) {
          const error = content.querySelector(".sync-governance-error");
          if (error) error.innerHTML = `<strong>失败原因：</strong>${escapeHtml(result.message)}`;
        }
      } finally {
        busy = false;
        if (modal) delete modal.dataset.busy;
      }
    }

    function bindEvents() {
      if (!modal) return;
      modal.addEventListener("click", (event) => {
        if (!(event.target instanceof Element)) return;
        const closeTarget = event.target.closest("[data-sync-governance-close]");
        if (closeTarget) {
          close();
          return;
        }
        const step = event.target.closest("[data-sync-governance-step]");
        if (step) {
          const nextIndex = Number(step.dataset.syncGovernanceStep);
          if (Number.isInteger(nextIndex) && nextIndex >= 0 && nextIndex < issues.length) {
            activeIndex = nextIndex;
            render();
          }
          return;
        }
        const choice = event.target.closest("[data-sync-choice-field]");
        if (choice) {
          const field = String(choice.dataset.syncChoiceField || "");
          modal.querySelectorAll(`[data-sync-choice-field="${field}"]`).forEach((button) => {
            button.classList.toggle("is-selected", button === choice);
          });
          return;
        }
        const actionTarget = event.target.closest("[data-sync-governance-action]");
        if (actionTarget) void runAction(String(actionTarget.dataset.syncGovernanceAction || ""));
      });
      globalScope.document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape" || !isOpen()) return;
        event.preventDefault();
        close();
      });
    }

    return { open, close, isOpen, getIssues, bindEvents };
  }

  globalScope.TimeQualitySyncGovernanceModule = {
    createSyncGovernanceModule,
    normalizeIssue,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = globalScope.TimeQualitySyncGovernanceModule;
  }
})(typeof window !== "undefined" ? window : globalThis);
