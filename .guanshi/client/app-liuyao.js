/* global window */

(function attachLiuyaoModule(globalScope) {
  "use strict";

  function createLiuyaoListState(model) {
    const draftReadings = new Map();

    function normalizeId(value) {
      return String(value || "").trim();
    }

    function stage(reading) {
      const readingId = normalizeId(reading?.id);
      if (!readingId) return false;
      draftReadings.delete(readingId);
      draftReadings.set(readingId, reading);
      return true;
    }

    function removeDraft(readingId) {
      return draftReadings.delete(normalizeId(readingId));
    }

    function hasDraft(readingId) {
      return draftReadings.has(normalizeId(readingId));
    }

    function getEntries() {
      const savedReadings = model.getAll();
      const savedIds = new Set(savedReadings.map((reading) => normalizeId(reading?.id)).filter(Boolean));
      const pendingNew = Array.from(draftReadings.values())
        .filter((reading) => !savedIds.has(normalizeId(reading?.id)))
        .reverse()
        .map((reading) => ({ reading, state: "pending", isSaved: false, isPending: true }));
      const saved = savedReadings.map((reading) => {
        const readingId = normalizeId(reading?.id);
        const pendingReading = draftReadings.get(readingId);
        return pendingReading
          ? { reading: pendingReading, state: "pending_update", isSaved: true, isPending: true }
          : { reading, state: "saved", isSaved: true, isPending: false };
      });
      return [...pendingNew, ...saved];
    }

    function getEntryById(readingId) {
      const normalizedId = normalizeId(readingId);
      return getEntries().find((entry) => normalizeId(entry.reading?.id) === normalizedId) || null;
    }

    function resolveById(readingId) {
      return getEntryById(readingId)?.reading || null;
    }

    return {
      stage,
      removeDraft,
      hasDraft,
      getEntries,
      getEntryById,
      resolveById,
    };
  }

  function toggleLiuyaoReadingSelection(currentReading, candidateReading) {
    if (!candidateReading) return currentReading || null;
    return String(currentReading?.id || "") === String(candidateReading.id || "") ? null : candidateReading;
  }

  function createLiuyaoModule(deps = {}) {
    const engine = deps.engine || globalScope.TimeQualityLiuyaoEngineModule;
    const model = deps.model;
    const documentRef = deps.documentRef || globalScope.document;
    const windowRef = deps.windowRef || globalScope;
    const confirmFn = typeof deps.confirmFn === "function"
      ? deps.confirmFn
      : typeof windowRef.confirm === "function"
        ? windowRef.confirm.bind(windowRef)
        : () => false;
    const onSelectionChange = typeof deps.onSelectionChange === "function" ? deps.onSelectionChange : () => {};

    if (!engine || typeof engine.buildReading !== "function") throw new Error("六爻排盘内核未加载");
    if (!model || typeof model.getAll !== "function") throw new Error("六爻本地记录模块未加载");

    const listState = createLiuyaoListState(model);

    let initialized = false;
    let currentReading = null;
    let activeLocalPanel = "cast";
    let activeChartView = "primary";
    let activeChartReadingId = "";
    let refs = {};

    function escapeHtml(value) {
      return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
    }

    function getRefs() {
      return {
        view: documentRef.getElementById("view-liuyao"),
        form: documentRef.getElementById("liuyao-form"),
        question: documentRef.getElementById("liuyao-question"),
        category: documentRef.getElementById("liuyao-category"),
        focus: documentRef.getElementById("liuyao-focus"),
        dateTime: documentRef.getElementById("liuyao-datetime"),
        timezone: documentRef.getElementById("liuyao-timezone"),
        lineSelects: Array.from(documentRef.querySelectorAll("[data-liuyao-line-value]")),
        tossButton: documentRef.getElementById("liuyao-toss"),
        resetButton: documentRef.getElementById("liuyao-reset"),
        saveButton: documentRef.getElementById("liuyao-save"),
        status: documentRef.getElementById("liuyao-status"),
        empty: documentRef.getElementById("liuyao-empty"),
        reading: documentRef.getElementById("liuyao-reading"),
        readingHeading: documentRef.getElementById("liuyao-reading-heading"),
        readingQuestion: documentRef.getElementById("liuyao-reading-question"),
        historyList: documentRef.getElementById("liuyao-history-list"),
        historyCount: documentRef.getElementById("liuyao-history-count"),
        clearHistoryButton: documentRef.getElementById("liuyao-history-clear"),
        localTabHistory: documentRef.getElementById("liuyao-local-tab-history"),
        localTabCast: documentRef.getElementById("liuyao-local-tab-cast"),
        localPanelHistory: documentRef.getElementById("liuyao-local-panel-history"),
        localPanelCast: documentRef.getElementById("liuyao-local-panel-cast"),
        interpretationEmpty: documentRef.getElementById("liuyao-interpretation-empty"),
        interpretationContent: documentRef.getElementById("liuyao-interpretation-content"),
      };
    }

    function notifySelectionChange() {
      try {
        onSelectionChange(currentReading);
      } catch {
        // Selection sync is non-critical to deterministic chart rendering.
      }
    }

    function setLocalPanel(panelName, options = {}) {
      activeLocalPanel = panelName === "history" ? "history" : "cast";
      const isHistory = activeLocalPanel === "history";
      if (refs.localTabHistory) {
        refs.localTabHistory.classList.toggle("is-active", isHistory);
        refs.localTabHistory.setAttribute("aria-selected", String(isHistory));
        refs.localTabHistory.tabIndex = isHistory ? 0 : -1;
      }
      if (refs.localTabCast) {
        refs.localTabCast.classList.toggle("is-active", !isHistory);
        refs.localTabCast.setAttribute("aria-selected", String(!isHistory));
        refs.localTabCast.tabIndex = isHistory ? -1 : 0;
      }
      if (refs.localPanelHistory) refs.localPanelHistory.hidden = !isHistory;
      if (refs.localPanelCast) refs.localPanelCast.hidden = isHistory;
      if (!isHistory && options.refreshClock === true) updateCastClock();
      if (options.focus === true) (isHistory ? refs.localTabHistory : refs.localTabCast)?.focus?.();
    }

    function pad(value) {
      return String(value).padStart(2, "0");
    }

    function formatDateTimeLocal(date) {
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }

    function roundToMinute(date) {
      const next = new Date(date.getTime());
      next.setSeconds(0, 0);
      return next;
    }

    function getTimeZoneLabel(date) {
      const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "本地时区";
      const minutes = -date.getTimezoneOffset();
      const sign = minutes >= 0 ? "+" : "-";
      const absolute = Math.abs(minutes);
      return `${zone} · UTC${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`;
    }

    function updateCastClock(value = new Date()) {
      const date = roundToMinute(value);
      if (refs.dateTime) refs.dateTime.value = formatDateTimeLocal(date);
      if (refs.timezone) refs.timezone.textContent = `设备时区：${getTimeZoneLabel(date)}`;
      return date;
    }

    function readManualCastTime() {
      const raw = String(refs.dateTime?.value || "").trim();
      const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(raw);
      if (!match) throw new Error("请填写真实起卦时间。");
      const [, yearText, monthText, dayText, hourText, minuteText] = match;
      const parts = [yearText, monthText, dayText, hourText, minuteText].map(Number);
      const date = new Date(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], 0, 0);
      const valid = date.getFullYear() === parts[0]
        && date.getMonth() === parts[1] - 1
        && date.getDate() === parts[2]
        && date.getHours() === parts[3]
        && date.getMinutes() === parts[4];
      if (!valid) throw new Error("起卦时间无效，请重新填写。");
      return date;
    }

    function setStatus(message, tone = "normal") {
      if (!refs.status) return;
      refs.status.textContent = message || "";
      refs.status.dataset.tone = tone;
      refs.status.hidden = !message;
    }

    function requireQuestion() {
      const question = String(refs.question?.value || "").trim();
      if (question) return question;
      setStatus("请先写下本次所问事项。", "warning");
      refs.question?.focus();
      return "";
    }

    function requireFocus() {
      const focus = String(refs.focus?.value || "").trim();
      if (focus) return focus;
      setStatus("请选择这次判断的对象或重点。", "warning");
      refs.focus?.focus();
      return "";
    }

    function getLineValues() {
      const selects = refs.lineSelects
        .slice()
        .sort((a, b) => Number(a.dataset.liuyaoLineValue) - Number(b.dataset.liuyaoLineValue));
      const incomplete = selects.find((select) => !["6", "7", "8", "9"].includes(String(select.value)));
      if (incomplete) {
        incomplete.focus?.();
        throw new Error("请按初爻到上爻完整选择六次结果。");
      }
      return selects.map((select) => Number(select.value));
    }

    function setLineValues(values) {
      const normalized = engine.normalizeLineValues(values);
      refs.lineSelects.forEach((select) => {
        const index = Number(select.dataset.liuyaoLineValue) - 1;
        select.value = String(normalized[index]);
      });
    }

    function createReading(extra = {}) {
      const question = requireQuestion();
      if (!question) return null;
      const focus = requireFocus();
      if (!focus) return null;
      const date = extra.castTime instanceof Date ? extra.castTime : updateCastClock();
      const dateTimeText = formatDateTimeLocal(date);
      const timezone = getTimeZoneLabel(date);
      if (refs.dateTime) refs.dateTime.value = dateTimeText;
      if (refs.timezone) refs.timezone.textContent = `设备时区：${timezone}`;
      return engine.buildReading({
        question,
        category: refs.category?.value || "其他",
        focus,
        dateTime: date,
        dateTimeText,
        timezone,
        lineValues: getLineValues(),
        tosses: extra.tosses || [],
      });
    }

    function renderYaoGlyph(line, options = {}) {
      const changed = Boolean(options.changed);
      const yinYang = line.yinYang || "阴";
      const classes = ["liuyao-yao", yinYang === "阳" ? "is-yang" : "is-yin"];
      if (line.isMoving || options.isMoving) classes.push("is-moving");
      if (changed) classes.push("is-changed");
      const segments = yinYang === "阳"
        ? '<span class="liuyao-yao-segment"></span>'
        : '<span class="liuyao-yao-segment"></span><span class="liuyao-yao-gap"></span><span class="liuyao-yao-segment"></span>';
      return `<span class="${classes.join(" ")}" aria-label="${yinYang}爻">${segments}</span>`;
    }

    function renderLineFlags(line) {
      const flags = [];
      if (line.strength?.monthState) flags.push({ label: line.strength.monthState, tone: "strength" });
      if (line.isVoid) flags.push("空");
      if (line.isMonthBreak) flags.push("月破");
      if (line.isDayClash) flags.push("日冲");
      if (line.isMonthCombined) flags.push({ label: "月合", tone: "support" });
      if (line.isDayCombined) flags.push({ label: "日合", tone: "support" });
      if (line.isDarkMovingCandidate) flags.push({ label: "暗动候选", tone: "moving" });
      return flags.map((item) => {
        const value = typeof item === "string" ? { label: item, tone: "risk" } : item;
        return `<span class="liuyao-fact-flag is-${escapeHtml(value.tone)}">${escapeHtml(value.label)}</span>`;
      }).join("");
    }

    function renderHiddenSpirits(line) {
      if (!Array.isArray(line.hiddenSpirits) || !line.hiddenSpirits.length) return '<span class="liuyao-muted">—</span>';
      return line.hiddenSpirits.map((item) => `<span class="liuyao-hidden-spirit">伏 ${escapeHtml(item.relation)} ${escapeHtml(item.najia)}${escapeHtml(item.wuxing)}</span>`).join("");
    }

    function renderHexagram(chart, options = {}) {
      if (!chart) return "";
      const isChanged = Boolean(options.changed);
      const tableOnly = Boolean(options.tableOnly);
      const primaryLines = options.primaryLines || [];
      const rows = chart.lines.slice().reverse().map((line) => {
        const primaryLine = primaryLines[line.position - 1];
        const isMoving = Boolean(primaryLine?.isMoving);
        const changedLine = isChanged && isMoving ? primaryLine?.changedLine : null;
        const displayLine = changedLine || line;
        const rowClasses = ["liuyao-line-row"];
        if (isMoving) rowClasses.push("is-moving");
        if (line.shiYing) rowClasses.push(`is-${line.shiYing === "世" ? "shi" : "ying"}`);
        const transformationLabel = (isChanged ? primaryLine : line)?.transformation?.relation || "";
        const motion = !isChanged && line.isMoving
          ? `<span class="liuyao-moving-label">${escapeHtml(line.movingType)} · ${line.value}${transformationLabel ? ` · ${escapeHtml(transformationLabel)}` : ""}</span>`
          : isChanged && isMoving
            ? `<span class="liuyao-moving-label">之${transformationLabel ? ` · ${escapeHtml(transformationLabel)}` : ""}</span>`
            : "";
        return `
          <div class="${rowClasses.join(" ")}" data-liuyao-line-position="${Number(line.position) || 0}">
            <span class="liuyao-line-position">${escapeHtml(line.label)}</span>
            <span class="liuyao-line-spirit">${escapeHtml(displayLine.spirit)}</span>
            <span class="liuyao-line-hidden">${isChanged ? '<span class="liuyao-muted">—</span>' : renderHiddenSpirits(line)}</span>
            <span class="liuyao-line-relation"><strong>${escapeHtml(displayLine.relation)}</strong><small>${escapeHtml(displayLine.najia)} · ${escapeHtml(displayLine.wuxing)}</small></span>
            <span class="liuyao-line-glyph">${renderYaoGlyph(displayLine, { changed: isChanged, isMoving })}${motion}</span>
            <span class="liuyao-line-state">${escapeHtml(line.shiYing || "")}${isChanged ? "" : renderLineFlags(line)}</span>
          </div>`;
      }).join("");

      return `
        <section class="liuyao-hexagram-card${isChanged ? " is-changed" : ""}${tableOnly ? " is-detail-table" : ""}" aria-label="${escapeHtml(isChanged ? "变卦" : "本卦")} ${escapeHtml(chart.name)}">
          ${tableOnly ? "" : `<header class="liuyao-hexagram-head">
            <div>
              <span>${isChanged ? "变卦" : "本卦"}</span>
              <h3>${escapeHtml(chart.name)}</h3>
            </div>
            <div class="liuyao-palace-badge">${escapeHtml(chart.palace)}宫 · ${escapeHtml(chart.palaceWuxing)} · ${escapeHtml(chart.type)}</div>
          </header>`}
          <div class="liuyao-lines-head" aria-hidden="true">
            <span>爻位</span><span>六神</span><span>伏神</span><span>六亲 · 纳甲</span><span>卦爻</span><span>世应</span>
          </div>
          <div class="liuyao-lines">${rows}</div>
          <p class="liuyao-image-note">${escapeHtml(chart.image)}</p>
        </section>`;
    }

    function renderTimeFacts(reading) {
      const time = reading.time;
      const facts = [
        ["年", time.year.text],
        ["月", time.month.text],
        ["日", time.day.text],
        ["时", time.hour.text],
        ["旬空", time.voidBranches.join("")],
        ["月建", time.month.branch],
      ];
      return facts.map(([label, value]) => `<span class="liuyao-time-chip"><small>${label}</small><strong>${escapeHtml(value)}</strong></span>`).join("");
    }

    function renderUseSpiritSummary(reading) {
      const analysis = reading.analysis;
      const useSpirit = analysis?.useSpirit;
      if (!useSpirit) return "";
      const candidates = Array.isArray(useSpirit.candidates) ? useSpirit.candidates : [];
      const candidateText = candidates.length
        ? candidates.map((item) => `${item.hidden ? item.label : item.label}${item.shiYing ? `(${item.shiYing})` : ""} · ${item.relation}${item.najia} · ${item.strength?.monthState || ""}`).join("；")
        : "未自动取用";
      const supporting = analysis.supportingRelations;
      const warning = Array.isArray(analysis.warnings) ? analysis.warnings[0] : "";
      return `
        <section class="liuyao-analysis-strip" aria-label="确定性取用与旺衰摘要">
          <span><small>判断重点</small><strong>${escapeHtml(analysis.focusLabel || "未指定")}</strong></span>
          <span><small>${useSpirit.mode === "position" ? "取纲" : "用神"}</small><strong>${escapeHtml(useSpirit.target || "待明确")}</strong><em>${escapeHtml(candidateText)}</em></span>
          ${supporting ? `<span><small>原 · 忌 · 仇</small><strong>${escapeHtml(`${supporting.originalSpirit.relation} · ${supporting.opposingSpirit.relation} · ${supporting.enemySpirit.relation}`)}</strong></span>` : ""}
          ${warning ? `<p>${escapeHtml(warning)}</p>` : ""}
        </section>`;
    }

    function renderOverviewLines(chart, options = {}) {
      const primaryLines = options.primaryLines || [];
      return chart.lines.slice().reverse().map((line) => {
        const primaryLine = primaryLines[line.position - 1];
        return renderYaoGlyph(line, {
          changed: Boolean(options.changed),
          isMoving: Boolean(primaryLine?.isMoving || line.isMoving),
        });
      }).join("");
    }

    function renderTransformationOverview(reading) {
      const primary = reading.primary;
      const changed = reading.changed;
      const movingLabel = reading.movingPositions.length ? `${reading.movingPositions.length} 动` : "静卦";
      const renderSide = (chart, options = {}) => {
        const view = options.changed ? "changed" : "primary";
        const isActive = activeChartView === view;
        return `
        <button class="liuyao-transformation-side${options.changed ? " is-changed" : ""}${isActive ? " is-active" : ""}" type="button" data-liuyao-chart-view="${view}" aria-pressed="${isActive}" aria-label="查看${options.changed ? "变卦" : "本卦"} ${escapeHtml(chart.name)}详情">
          <div class="liuyao-transformation-lines" aria-hidden="true">${renderOverviewLines(chart, options)}</div>
          <div class="liuyao-transformation-copy">
            <span>${options.changed ? "变卦" : "本卦"}</span>
            <strong>${escapeHtml(chart.name)}</strong>
            <small>${options.changed && chart.interpretationBasis
              ? `六亲沿用${escapeHtml(chart.interpretationBasis.palace)}宫 · 世应沿用本卦`
              : `${escapeHtml(chart.palace)}宫 · ${escapeHtml(chart.palaceWuxing)} · ${escapeHtml(chart.type)}`}</small>
          </div>
        </button>`;
      };
      return `
        <section class="liuyao-transformation-card${changed ? " has-change" : " is-static"}" aria-label="卦象变化总览">
          ${renderSide(primary)}
          <div class="liuyao-transformation-arrow" aria-label="${escapeHtml(movingLabel)}">
            <span>${changed ? "→" : "静"}</span>
            <small>${escapeHtml(movingLabel)}</small>
          </div>
          ${changed ? renderSide(changed, { changed: true, primaryLines: primary.lines }) : ""}
        </section>`;
    }

    function renderReading() {
      if (!refs.empty || !refs.reading || !refs.saveButton) return;
      const hasReading = Boolean(currentReading);
      refs.empty.hidden = hasReading;
      refs.reading.hidden = !hasReading;
      if (!hasReading) {
        activeChartView = "primary";
        activeChartReadingId = "";
      } else if (activeChartReadingId !== String(currentReading.id || "") || (!currentReading.changed && activeChartView === "changed")) {
        activeChartView = "primary";
        activeChartReadingId = String(currentReading.id || "");
      }
      if (refs.readingQuestion) {
        refs.readingQuestion.textContent = hasReading ? currentReading.question : "所问事项";
        refs.readingQuestion.title = hasReading ? currentReading.question : "";
      }
      if (refs.readingHeading) {
        refs.readingHeading.textContent = hasReading ? `${currentReading.category} · ${currentReading.method}` : "卦象";
      }
      const isPending = Boolean(currentReading && listState.hasDraft(currentReading.id));
      const isSaved = Boolean(currentReading && model.getById(currentReading.id));
      refs.saveButton.disabled = !hasReading || !isPending;
      refs.saveButton.textContent = !hasReading
        ? "保存"
        : isPending
          ? isSaved ? "保存更新" : "保存"
          : "已保存";
      if (!hasReading) {
        refs.reading.innerHTML = "";
        return;
      }

      const changedTitle = currentReading.changed ? ` → ${currentReading.changed.name}` : " · 静卦";
      refs.reading.innerHTML = `
        <div class="liuyao-reading-head">
          <div>
            <h2>${escapeHtml(currentReading.primary.name)}${escapeHtml(changedTitle)}</h2>
          </div>
          <span class="liuyao-moving-summary">${currentReading.movingPositions.length ? `${currentReading.movingPositions.length} 个动爻` : "无动爻"}</span>
        </div>
        <div class="liuyao-time-facts">${renderTimeFacts(currentReading)}</div>
        ${renderUseSpiritSummary(currentReading)}
        ${renderTransformationOverview(currentReading)}
        <div class="liuyao-hexagram-grid">
          ${activeChartView === "changed" && currentReading.changed
            ? renderHexagram(currentReading.changed, { tableOnly: true, changed: true, primaryLines: currentReading.primary.lines })
            : renderHexagram(currentReading.primary, { tableOnly: true })}
        </div>
        <footer class="liuyao-reading-foot">
          <span>${escapeHtml(currentReading.time.dayBoundary)} · 月建以节气划分</span>
          <span>${escapeHtml(currentReading.timezone)}</span>
        </footer>`;
    }

    function renderInterpretation() {
      if (!refs.interpretationEmpty || !refs.interpretationContent) return;
      const interpretations = Array.isArray(currentReading?.interpretations) ? currentReading.interpretations : [];
      const latest = interpretations.at(-1) || null;
      refs.interpretationEmpty.hidden = Boolean(latest);
      refs.interpretationContent.hidden = !latest;
      if (!latest) {
        refs.interpretationContent.innerHTML = "";
        const title = refs.interpretationEmpty.querySelector?.("strong");
        const copy = refs.interpretationEmpty.querySelector?.("p");
        if (title) title.textContent = currentReading ? "卦象已就绪" : "等待问卦";
        if (copy) copy.textContent = currentReading
          ? "在左侧 AI 中围绕当前卦自然提问，解读会同步显示在这里。"
          : "直接在左侧 AI 输入所问之事，回复与详细解卦会同时出现。";
        return;
      }

      const sections = Array.isArray(latest.sections) ? latest.sections : [];
      const recommendationPattern = /timing|recommend|advice|action|risk|时机|建议|行动|推进|风险/i;
      const recommendationSections = sections.filter((section) => recommendationPattern.test(`${section?.id || ""} ${section?.title || ""}`));
      const evidenceSections = sections.filter((section) => !recommendationSections.includes(section));
      const uncertaintyList = Array.isArray(latest.uncertainties) ? latest.uncertainties : [];
      const previous = interpretations.slice(0, -1).reverse();
      const renderFactRefs = (section) => {
        const factRefs = Array.isArray(section?.factRefs) ? section.factRefs : [];
        return factRefs.length
          ? `<div class="liuyao-interpretation-facts">${factRefs.map((fact) => `<span data-liuyao-fact-ref="${escapeHtml(fact)}">${escapeHtml(fact)}</span>`).join("")}</div>`
          : "";
      };
      refs.interpretationContent.innerHTML = `
        <article class="liuyao-interpretation-summary">
          <div class="liuyao-interpretation-summary-head">
            <span>一句话结论</span>
            <time>${latest.sourceAction === "interpret_hexagram" ? "本轮追问" : "初次解卦"} · ${escapeHtml(formatHistoryTime(latest.createdAt))}</time>
          </div>
          <strong class="liuyao-interpretation-summary-title">${escapeHtml(latest.summary || latest.answer || "解读已完成。")}</strong>
        </article>
        ${evidenceSections.length ? `
          <section class="liuyao-interpretation-group is-evidence">
            <h3>关键依据</h3>
            <div class="liuyao-evidence-list">
              ${evidenceSections.map((section, index) => `
                <article class="liuyao-evidence-item" data-liuyao-interpretation-section="${escapeHtml(section?.id || `section-${index + 1}`)}">
                  <span class="liuyao-evidence-index">${String(index + 1).padStart(2, "0")}</span>
                  <div>
                    <h4>${escapeHtml(section?.title || "补充解读")}</h4>
                    <p>${escapeHtml(section?.content || "")}</p>
                    ${renderFactRefs(section)}
                  </div>
                </article>`).join("")}
            </div>
          </section>` : ""}
        ${recommendationSections.length ? `
          <section class="liuyao-interpretation-group is-advice">
            <h3>现实建议</h3>
            <div class="liuyao-advice-list">
              ${recommendationSections.map((section, index) => `
                <article class="liuyao-advice-item" data-liuyao-interpretation-section="${escapeHtml(section?.id || `advice-${index + 1}`)}">
                  <span class="liuyao-advice-index">${index + 1}</span>
                  <div>
                    <h4>${escapeHtml(section?.title || "行动建议")}</h4>
                    <p>${escapeHtml(section?.content || "")}</p>
                    ${renderFactRefs(section)}
                  </div>
                </article>`).join("")}
            </div>
          </section>` : ""}
        ${uncertaintyList.length ? `
          <section class="liuyao-interpretation-caveats">
            <h3>需要保留的余地</h3>
            <ul>${uncertaintyList.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
          </section>` : ""}
        ${previous.length ? `
          <section class="liuyao-interpretation-history">
            <h3>此前解读</h3>
            ${previous.map((item) => `
              <article>
                <span>${escapeHtml(formatHistoryTime(item.createdAt))}</span>
                <p>${escapeHtml(item.summary || item.answer || "")}</p>
              </article>`).join("")}
          </section>` : ""}`;
    }

    function formatHistoryTime(value) {
      const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
      return match ? `${match[1]}.${match[2]}.${match[3]} ${match[4]}:${match[5]}` : String(value || "");
    }

    function renderHistory() {
      if (!refs.historyList || !refs.historyCount || !refs.clearHistoryButton) return;
      const entries = listState.getEntries();
      const savedCount = model.getAll().length;
      refs.historyCount.textContent = String(entries.length);
      refs.clearHistoryButton.disabled = savedCount === 0;
      const renderEntry = (entry) => {
        const reading = entry.reading;
        const isActive = currentReading?.id === reading.id;
        const stateLabel = entry.state === "pending_update" ? "未保存更新" : entry.state === "pending" ? "未保存" : "已保存";
        const deleteLabel = entry.state === "pending_update"
          ? `放弃未保存更新 ${reading.question}`
          : entry.state === "pending"
            ? `移除未保存卦象 ${reading.question}`
            : `删除卦例 ${reading.question}`;
        return `
        <article class="liuyao-history-item${isActive ? " is-active" : ""}${entry.isPending ? " is-pending" : " is-saved"}" data-liuyao-reading-state="${escapeHtml(entry.state)}">
          <button class="liuyao-history-open" type="button" data-liuyao-open="${escapeHtml(reading.id)}" aria-pressed="${isActive ? "true" : "false"}" title="${isActive ? "再次点击取消选择" : "选择此卦继续问询"}">
            <span class="liuyao-history-meta"><span>${escapeHtml(formatHistoryTime(reading.dateTime))} · ${escapeHtml(reading.category)}</span><em>${escapeHtml(stateLabel)}</em></span>
            <strong>${escapeHtml(reading.primary.name)}${reading.changed ? ` → ${escapeHtml(reading.changed.name)}` : " · 静卦"}</strong>
            <span class="liuyao-history-question">${escapeHtml(reading.question)}</span>
          </button>
          <button class="liuyao-history-delete" type="button" data-liuyao-delete="${escapeHtml(reading.id)}" aria-label="${escapeHtml(deleteLabel)}" title="${escapeHtml(deleteLabel)}">×</button>
        </article>`;
      };
      const renderGroup = (key, label, groupEntries, emptyLabel) => `
        <section class="liuyao-history-group is-${key}" data-liuyao-history-group="${key}">
          <header class="liuyao-history-group-head">
            <div class="liuyao-history-group-title">
              <span>${escapeHtml(label)}</span>
              <b>${groupEntries.length}</b>
            </div>
            <div class="liuyao-history-group-actions" data-liuyao-history-actions="${key}"></div>
          </header>
          <div class="liuyao-history-group-list">
            ${groupEntries.length ? groupEntries.map(renderEntry).join("") : `<p class="liuyao-history-group-empty">${escapeHtml(emptyLabel)}</p>`}
          </div>
        </section>`;
      const pendingEntries = entries.filter((entry) => entry.isPending);
      const savedEntries = entries.filter((entry) => !entry.isPending);
      refs.historyList.innerHTML = [
        renderGroup("pending", "本次未保存", pendingEntries, "暂无未保存卦象"),
        renderGroup("saved", "已保存卦例", savedEntries, "暂无已保存卦例"),
      ].join("");
      refs.historyList.querySelector('[data-liuyao-history-actions="pending"]')?.append(refs.saveButton);
      refs.historyList.querySelector('[data-liuyao-history-actions="saved"]')?.append(refs.clearHistoryButton);
    }

    function render() {
      renderReading();
      renderInterpretation();
      renderHistory();
      setLocalPanel(activeLocalPanel);
    }

    function syncFormFromReading(reading) {
      if (!reading) return;
      if (refs.question) refs.question.value = reading.question || "";
      if (refs.category) refs.category.value = reading.category || "其他";
      if (refs.focus) refs.focus.value = reading.focus || "";
      setLineValues(reading.lineValues);
      const instantMs = Number(reading.time?.input?.instantMs);
      const date = Number.isFinite(instantMs) ? new Date(instantMs) : new Date(reading.dateTime);
      if (Number.isFinite(date.getTime())) updateCastClock(date);
    }

    function rebuildReadingFacts(reading) {
      if (!reading || reading.analysis?.schema === "guanshi-liuyao-analysis-v1") return reading;
      try {
        const rebuilt = engine.buildReading({
          id: reading.id,
          question: reading.question,
          category: reading.category,
          focus: reading.focus,
          dateTime: reading.time?.input || new Date(reading.dateTime),
          dateTimeText: reading.dateTime,
          timezone: reading.timezone,
          createdAt: reading.createdAt,
          lineValues: reading.lineValues,
          tosses: reading.tosses,
        });
        return {
          ...rebuilt,
          interpretations: Array.isArray(reading.interpretations) ? reading.interpretations : [],
        };
      } catch {
        return reading;
      }
    }

    function handleManualCast(event) {
      event?.preventDefault?.();
      try {
        const castTime = readManualCastTime();
        const reading = createReading({ castTime });
        if (!reading) return;
        currentReading = reading;
        listState.stage(reading);
        setLocalPanel("history");
        render();
        notifySelectionChange();
        setStatus("排盘完成。当前结果尚未保存。", "success");
      } catch (error) {
        setStatus(error.message || "排盘失败，请检查输入。", "error");
      }
    }

    function handleToss() {
      const castTime = updateCastClock();
      if (!requireQuestion() || !requireFocus()) return;
      try {
        const toss = engine.tossHexagram();
        setLineValues(toss.lineValues);
        const reading = createReading({ tosses: toss.tosses, castTime });
        if (!reading) return;
        currentReading = reading;
        listState.stage(reading);
        setLocalPanel("history");
        render();
        notifySelectionChange();
        setStatus("已完成六次三钱起卦。当前结果尚未保存。", "success");
      } catch (error) {
        setStatus(error.message || "随机起卦失败。", "error");
      }
    }

    function handleReset() {
      currentReading = null;
      if (refs.form) refs.form.reset();
      updateCastClock();
      render();
      notifySelectionChange();
      setStatus("已清空起卦台，临时卦象与历史卦例未受影响。", "normal");
    }

    function handleSave() {
      if (!currentReading) return;
      try {
        model.save(currentReading);
        listState.removeDraft(currentReading.id);
        currentReading = model.getById(currentReading.id) || currentReading;
        render();
        notifySelectionChange();
        setStatus("卦例已保存到当前设备。", "success");
      } catch (error) {
        setStatus(error.message || "保存失败。", "error");
      }
    }

    function handleHistoryClick(event) {
      const openButton = event.target.closest?.("[data-liuyao-open]");
      if (openButton) {
        const reading = rebuildReadingFacts(listState.resolveById(openButton.dataset.liuyaoOpen));
        if (!reading) return;
        currentReading = toggleLiuyaoReadingSelection(currentReading, reading);
        if (currentReading) syncFormFromReading(currentReading);
        render();
        notifySelectionChange();
        setStatus(currentReading ? "已选择卦象；再次点击可取消选择。" : "已取消选择当前卦。", "normal");
        return;
      }

      const deleteButton = event.target.closest?.("[data-liuyao-delete]");
      if (!deleteButton) return;
      const entry = listState.getEntryById(deleteButton.dataset.liuyaoDelete);
      const reading = entry?.reading;
      if (!entry || !reading) return;
      if (entry.state === "pending_update") {
        if (!confirmFn(`放弃“${reading.question}”尚未保存的更新，恢复已保存版本吗？`)) return;
        listState.removeDraft(reading.id);
        if (currentReading?.id === reading.id) {
          currentReading = model.getById(reading.id) || null;
          if (currentReading) syncFormFromReading(currentReading);
        }
        render();
        notifySelectionChange();
        setStatus("已放弃未保存更新，保留原卦例。", "normal");
        return;
      }
      if (entry.state === "pending") {
        if (!confirmFn(`确认移除“${reading.question}”这条未保存卦象吗？`)) return;
        listState.removeDraft(reading.id);
        if (currentReading?.id === reading.id) currentReading = null;
        render();
        notifySelectionChange();
        setStatus("未保存卦象已移除。", "normal");
        return;
      }
      if (!confirmFn(`确认删除“${reading.question}”这条卦例吗？`)) return;
      try {
        model.remove(reading.id);
        if (currentReading?.id === reading.id) currentReading = null;
        render();
        notifySelectionChange();
        setStatus("卦例已删除。", "normal");
      } catch (error) {
        setStatus(error.message || "删除失败。", "error");
      }
    }

    function selectLatestReading(options = {}) {
      if (currentReading) return currentReading;
      const reading = rebuildReadingFacts(listState.getEntries()[0]?.reading);
      if (!reading) return null;
      currentReading = reading;
      syncFormFromReading(currentReading);
      setLocalPanel("history");
      render();
      notifySelectionChange();
      setStatus(
        options.source === "ai_follow_up"
          ? "已自动选择最近一卦，正在继续解读。"
          : "已选择最近一卦。",
        "normal",
      );
      return currentReading;
    }

    function handleReadingClick(event) {
      const chartButton = event.target.closest?.("[data-liuyao-chart-view]");
      if (!chartButton || !currentReading) return;
      const nextView = chartButton.dataset.liuyaoChartView === "changed" ? "changed" : "primary";
      if (nextView === "changed" && !currentReading.changed) return;
      if (activeChartView === nextView) return;
      activeChartView = nextView;
      renderReading();
    }

    function handleClearHistory() {
      const savedReadings = model.getAll();
      const count = savedReadings.length;
      if (!count || !confirmFn(`确认清空当前设备上的 ${count} 条六爻卦例吗？此操作不可撤销。`)) return;
      if (!model.clear()) {
        setStatus("清空失败，请检查浏览器存储权限。", "error");
        return;
      }
      if (currentReading && savedReadings.some((reading) => reading.id === currentReading.id) && !listState.hasDraft(currentReading.id)) {
        currentReading = null;
      }
      render();
      notifySelectionChange();
      setStatus("历史卦例已清空。", "normal");
    }

    function applyAiResult(workflow, meta = {}) {
      const action = String(workflow?.request?.action || "").trim();
      if (!["create_hexagram", "interpret_hexagram"].includes(action)) return false;
      const incomingReading = workflow?.result?.reading;
      const incomingInterpretation = workflow?.result?.interpretation;
      if (!incomingReading || !Array.isArray(incomingReading.lineValues) || incomingReading.lineValues.length !== 6) return false;
      try {
        engine.normalizeLineValues(incomingReading.lineValues);
      } catch {
        return false;
      }

      const existingInterpretations = Array.isArray(incomingReading.interpretations)
        ? incomingReading.interpretations.slice()
        : currentReading?.id === incomingReading.id && Array.isArray(currentReading.interpretations)
          ? currentReading.interpretations.slice()
          : [];
      if (incomingInterpretation && typeof incomingInterpretation === "object" && !Array.isArray(incomingInterpretation)) {
        const interpretationId = String(
          incomingInterpretation.interpretationId
            || incomingInterpretation.id
            || `liuyao-interpretation-${meta.turnId || Date.now()}`,
        );
        const normalizedInterpretation = {
          ...incomingInterpretation,
          interpretationId,
          readingId: String(incomingReading.id || incomingInterpretation.readingId || ""),
          turnId: String(meta.turnId || incomingInterpretation.turnId || ""),
          sourceAction: action,
          answer: String(meta.answer || workflow?.result?.answer || incomingInterpretation.answer || ""),
          createdAt: String(incomingInterpretation.createdAt || new Date().toISOString()),
        };
        const previousIndex = existingInterpretations.findIndex((item) => String(item?.interpretationId || item?.id) === interpretationId);
        if (previousIndex >= 0) existingInterpretations[previousIndex] = normalizedInterpretation;
        else existingInterpretations.push(normalizedInterpretation);
      }
      currentReading = {
        ...incomingReading,
        interpretations: existingInterpretations.slice(-20),
      };
      listState.stage(currentReading);
      syncFormFromReading(currentReading);
      setLocalPanel("history");
      render();
      notifySelectionChange();
      setStatus(
        meta.interpretationFailed === true
          ? action === "create_hexagram"
            ? "卦盘已生成，但解读未完成；当前卦尚未保存。"
            : "当前卦已保留，但本次追问解读未完成。"
          : meta.pendingInterpretation === true
          ? action === "create_hexagram"
            ? "卦盘已生成，正在解读；当前卦尚未保存。"
            : "已定位当前卦，正在继续解读。"
          : action === "create_hexagram"
            ? "问卦与解读已完成，当前卦尚未保存。"
            : "追问解读已同步，当前修改尚未保存。",
        meta.interpretationFailed === true ? "error" : meta.pendingInterpretation === true ? "normal" : "success",
      );
      return true;
    }

    function init() {
      if (initialized) return;
      refs = getRefs();
      if (!refs.view || !refs.form) return;
      initialized = true;
      updateCastClock();
      refs.form.addEventListener("submit", handleManualCast);
      refs.tossButton?.addEventListener("click", handleToss);
      refs.resetButton?.addEventListener("click", handleReset);
      refs.saveButton?.addEventListener("click", handleSave);
      refs.historyList?.addEventListener("click", handleHistoryClick);
      refs.reading?.addEventListener("click", handleReadingClick);
      refs.clearHistoryButton?.addEventListener("click", handleClearHistory);
      refs.localTabHistory?.addEventListener("click", () => setLocalPanel("history"));
      refs.localTabCast?.addEventListener("click", () => setLocalPanel("cast", { refreshClock: true }));
      currentReading = null;
      activeLocalPanel = model.getAll().length ? "history" : "cast";
      render();
      notifySelectionChange();
    }

    return {
      init,
      render,
      getCurrentReading: () => currentReading,
      getAllReadings: () => listState.getEntries().map((entry) => entry.reading),
      selectLatestReading,
      getActiveLocalPanel: () => activeLocalPanel,
      setLocalPanel,
      applyAiResult,
    };
  }

  globalScope.TimeQualityLiuyaoModule = {
    createLiuyaoModule,
    createLiuyaoListState,
    toggleLiuyaoReadingSelection,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = globalScope.TimeQualityLiuyaoModule;
  }
})(typeof window !== "undefined" ? window : globalThis);
