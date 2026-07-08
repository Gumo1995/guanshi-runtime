(function attachTimeQualityReviewModule(globalScope) {
  if (!globalScope) return;

  function requireFunction(deps, key) {
    const value = deps[key];
    if (typeof value !== "function") {
      throw new Error(`TimeQualityReviewModule missing required function dependency: ${key}`);
    }
    return value;
  }

  function createReviewModule(deps = {}) {
    const getEntries = requireFunction(deps, "getEntries");
    const getTodos = requireFunction(deps, "getTodos");
    const getGlobalSearchTerm = requireFunction(deps, "getGlobalSearchTerm");
    const calcDurationHours = requireFunction(deps, "calcDurationHours");
    const getEntryDisplayTitle = requireFunction(deps, "getEntryDisplayTitle");
    const parseOptionalScore = requireFunction(deps, "parseOptionalScore");
    const sumBy = requireFunction(deps, "sumBy");
    const isValidDateInput = requireFunction(deps, "isValidDateInput");
    const formatDateForInput = requireFunction(deps, "formatDateForInput");
    const formatDate = requireFunction(deps, "formatDate");
    const escapeHtml = requireFunction(deps, "escapeHtml");
    const formatScoreLabel = requireFunction(deps, "formatScoreLabel");
    const isImportedExternalEntry = requireFunction(deps, "isImportedExternalEntry");
    const getTodoCategory = requireFunction(deps, "getTodoCategory");
    const setReviewLegacyVisible = requireFunction(deps, "setReviewLegacyVisible");
    const getReviewLegacyVisible = requireFunction(deps, "getReviewLegacyVisible");
    const getCurrentRange = typeof deps.getCurrentRange === "function" ? deps.getCurrentRange : () => "all";
    const getRangeEntries = typeof deps.getRangeEntries === "function" ? deps.getRangeEntries : null;

    const REVIEW_VISUAL_LOOKBACK_DAYS = Math.max(1, Number.parseInt(String(deps.REVIEW_VISUAL_LOOKBACK_DAYS || 14), 10));

    const reviewVisualSummary = deps.reviewVisualSummary || null;
    const reviewVisualKpis = deps.reviewVisualKpis || null;
    const reviewChartTrend = deps.reviewChartTrend || null;
    const reviewChartCategory = deps.reviewChartCategory || null;
    const reviewChartTimeband = deps.reviewChartTimeband || null;
    const reviewChartMatrix = deps.reviewChartMatrix || null;
    const reviewList = deps.reviewList || null;
    const reviewSummary = deps.reviewSummary || null;
    const reviewDebugTbody = deps.reviewDebugTbody || null;
    const reviewDebugSummary = deps.reviewDebugSummary || null;

    function getEntriesByCurrentRange() {
      const source = Array.isArray(getEntries()) ? getEntries() : [];
      const range = String(getCurrentRange() || "all");
      if (typeof getRangeEntries !== "function") return source;
      if (!range || range === "all") return source;
      return getRangeEntries(source, range);
    }

    function getReviewEntryDurationHours(entry) {
      if (!entry) return 0;
      const existingDuration = Number(entry.duration);
      if (Number.isFinite(existingDuration) && existingDuration > 0) return existingDuration;
      const computedDuration = calcDurationHours(entry.start, entry.end);
      if (Number.isFinite(computedDuration) && computedDuration > 0) return computedDuration;
      return 0;
    }

    function buildReviewVisualEntryDataset() {
      const source = getEntriesByCurrentRange();
      const searchTerm = String(getGlobalSearchTerm() || "").toLowerCase();
      const normalized = [];

      for (const entry of source) {
        if (!entry) continue;
        const durationHours = getReviewEntryDurationHours(entry);
        const title = getEntryDisplayTitle(entry, entry.category || "记录");
        const haystack = `${title} ${entry.category || ""} ${entry.note || ""} ${entry.source || ""} ${entry.calendarGroup || ""}`.toLowerCase();
        if (searchTerm && !haystack.includes(searchTerm)) continue;

        normalized.push({
          entry,
          title,
          date: String(entry.date || ""),
          start: String(entry.start || ""),
          durationHours,
          category: String(entry.category || "未分类"),
          quality: parseOptionalScore(entry.quality),
          happiness: parseOptionalScore(entry.happiness),
          needsReview: Boolean(entry.needsReview),
          source: String(entry.source || ""),
        });
      }

      return normalized;
    }

    function renderReviewVisualKpis(entryList, analyzableList) {
      if (!reviewVisualKpis || !reviewVisualSummary) return;

      const totalEntries = entryList.length;
      const totalHours = sumBy(entryList, (item) => item.durationHours);
      const ratedEntries = analyzableList.length;
      const unratedEntries = entryList.filter((item) => item.needsReview || item.quality === null || item.happiness === null).length;
      const dayCount = new Set(entryList.map((item) => item.date).filter((value) => isValidDateInput(value))).size;

      const avgQuality = ratedEntries
        ? sumBy(analyzableList, (item) => item.quality * item.durationHours) / Math.max(0.001, sumBy(analyzableList, (item) => item.durationHours))
        : 0;
      const avgHappiness = ratedEntries
        ? sumBy(analyzableList, (item) => item.happiness * item.durationHours) / Math.max(0.001, sumBy(analyzableList, (item) => item.durationHours))
        : 0;

      reviewVisualSummary.textContent = `筛选 ${totalEntries} 条 entry · 覆盖 ${dayCount} 天 · 待补评分 ${unratedEntries} 条`;

      reviewVisualKpis.innerHTML = `
    <article class="review-kpi-card">
      <p class="review-kpi-label">Entry 总数</p>
      <p class="review-kpi-value">${totalEntries}</p>
    </article>
    <article class="review-kpi-card">
      <p class="review-kpi-label">累计时长</p>
      <p class="review-kpi-value">${totalHours.toFixed(1)}h</p>
    </article>
    <article class="review-kpi-card">
      <p class="review-kpi-label">平均质量（加权）</p>
      <p class="review-kpi-value">${ratedEntries ? avgQuality.toFixed(1) : "--"}</p>
    </article>
    <article class="review-kpi-card">
      <p class="review-kpi-label">平均幸福（加权）</p>
      <p class="review-kpi-value">${ratedEntries ? avgHappiness.toFixed(1) : "--"}</p>
    </article>
  `;
    }

    function renderReviewTrendChart(entryList) {
      if (!reviewChartTrend) return;

      const rangeToken = String(getCurrentRange() || "all");
      const trendTitleNode = reviewChartTrend.parentElement?.querySelector("h4") || null;
      const labels = [];
      const dayTotals = new Map();
      let emptyText = "暂无 entry 记录。";

      if (rangeToken === "all") {
        if (trendTitleNode) {
          trendTitleNode.textContent = "全部记录时长";
        }
        emptyText = "全部范围暂无 entry 记录。";

        const validDates = [...new Set(entryList.map((item) => String(item.date || "")).filter((value) => isValidDateInput(value)))].sort();
        if (validDates.length) {
          const startDate = new Date(`${validDates[0]}T00:00:00`);
          const endDate = new Date(`${validDates[validDates.length - 1]}T00:00:00`);
          const spanDays = Math.max(1, Math.floor((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000)) + 1);
          const cappedDays = Math.min(spanDays, REVIEW_VISUAL_LOOKBACK_DAYS * 6);
          const cursor = new Date(endDate);
          cursor.setDate(endDate.getDate() - cappedDays + 1);

          if (spanDays > cappedDays && trendTitleNode) {
            trendTitleNode.textContent = `全部记录时长（近 ${cappedDays} 天）`;
          }

          for (let index = 0; index < cappedDays; index += 1) {
            const day = new Date(cursor);
            day.setDate(cursor.getDate() + index);
            const key = formatDateForInput(day);
            labels.push(key);
            dayTotals.set(key, 0);
          }
        }
      } else {
        const days = Math.max(1, Number.parseInt(rangeToken, 10) || REVIEW_VISUAL_LOOKBACK_DAYS);
        if (trendTitleNode) {
          trendTitleNode.textContent = `最近 ${days} 天记录时长`;
        }
        emptyText = `近 ${days} 天暂无 entry 记录。`;

        const baseDate = new Date();
        baseDate.setHours(0, 0, 0, 0);
        for (let index = days - 1; index >= 0; index -= 1) {
          const day = new Date(baseDate);
          day.setDate(baseDate.getDate() - index);
          const key = formatDateForInput(day);
          labels.push(key);
          dayTotals.set(key, 0);
        }
      }

      for (const item of entryList) {
        if (!dayTotals.has(item.date)) continue;
        dayTotals.set(item.date, dayTotals.get(item.date) + item.durationHours);
      }

      const values = labels.map((key) => dayTotals.get(key) || 0);
      const hasData = values.some((value) => value > 0);
      if (!hasData) {
        reviewChartTrend.innerHTML = `<p class="review-chart-empty">${escapeHtml(emptyText)}</p>`;
        return;
      }

      const maxValue = Math.max(0.25, ...values);
      reviewChartTrend.innerHTML = `
    <div class="review-mini-bars">
      ${labels
    .map((key) => {
      const value = dayTotals.get(key) || 0;
      const height = Math.max(4, (value / maxValue) * 100);
      const label = formatDate(key);
      const valueText = value > 0 ? `${value.toFixed(value >= 10 ? 0 : 1)}h` : "";
      return `
          <div class="review-mini-bar-col" title="${escapeHtml(`${label} ${value.toFixed(1)}h`)}">
            <span class="review-mini-bar-val">${escapeHtml(valueText)}</span>
            <span class="review-mini-bar-track"><span class="review-mini-bar-fill" style="height:${height.toFixed(2)}%"></span></span>
            <span class="review-mini-bar-label">${escapeHtml(label)}</span>
          </div>
        `;
    })
    .join("")}
    </div>
  `;
    }

    function renderReviewCategoryChart(entryList) {
      if (!reviewChartCategory) return;

      const stats = new Map();
      for (const item of entryList) {
        const key = String(item.category || "未分类").trim() || "未分类";
        stats.set(key, (stats.get(key) || 0) + item.durationHours);
      }

      const sorted = [...stats.entries()]
        .filter(([, hours]) => hours > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8);

      if (!sorted.length) {
        reviewChartCategory.innerHTML = '<p class="review-chart-empty">暂无可统计的分类时长。</p>';
        return;
      }

      const maxValue = Math.max(...sorted.map(([, value]) => value), 0.25);
      reviewChartCategory.innerHTML = `
    <div class="review-progress-list">
      ${sorted
    .map(([label, value]) => {
      const width = (value / maxValue) * 100;
      return `
          <div class="review-progress-row">
            <span class="review-progress-label">${escapeHtml(label)}</span>
            <span class="review-progress-track"><span class="review-progress-fill" style="width:${width.toFixed(2)}%"></span></span>
            <span class="review-progress-value">${value.toFixed(1)}h</span>
          </div>
        `;
    })
    .join("")}
    </div>
  `;
    }

    function renderReviewTimebandChart(entryList) {
      if (!reviewChartTimeband) return;

      const binDefs = [
        { shortLabel: "子", label: "子时", modernRange: "23:00-00:59", hours: [23, 0] },
        { shortLabel: "丑", label: "丑时", modernRange: "01:00-02:59", hours: [1, 2] },
        { shortLabel: "寅", label: "寅时", modernRange: "03:00-04:59", hours: [3, 4] },
        { shortLabel: "卯", label: "卯时", modernRange: "05:00-06:59", hours: [5, 6] },
        { shortLabel: "辰", label: "辰时", modernRange: "07:00-08:59", hours: [7, 8] },
        { shortLabel: "巳", label: "巳时", modernRange: "09:00-10:59", hours: [9, 10] },
        { shortLabel: "午", label: "午时", modernRange: "11:00-12:59", hours: [11, 12] },
        { shortLabel: "未", label: "未时", modernRange: "13:00-14:59", hours: [13, 14] },
        { shortLabel: "申", label: "申时", modernRange: "15:00-16:59", hours: [15, 16] },
        { shortLabel: "酉", label: "酉时", modernRange: "17:00-18:59", hours: [17, 18] },
        { shortLabel: "戌", label: "戌时", modernRange: "19:00-20:59", hours: [19, 20] },
        { shortLabel: "亥", label: "亥时", modernRange: "21:00-22:59", hours: [21, 22] },
      ];
      const bins = binDefs.map((def, index) => ({
        index,
        shortLabel: def.shortLabel,
        label: def.label,
        modernRange: def.modernRange,
        hours: def.hours,
        count: 0,
        hoursTotal: 0,
      }));
      const hourToBinIndex = new Array(24).fill(-1);
      bins.forEach((bin, binIndex) => {
        for (const hour of bin.hours) {
          if (Number.isInteger(hour) && hour >= 0 && hour <= 23) {
            hourToBinIndex[hour] = binIndex;
          }
        }
      });

      for (const item of entryList) {
        const hour = Number.parseInt(String(item.start || "").split(":")[0], 10);
        if (!Number.isInteger(hour) || hour < 0 || hour > 23) continue;
        const bucketIndex = hourToBinIndex[hour];
        const bucket = bins[bucketIndex];
        if (!bucket) continue;
        bucket.count += 1;
        bucket.hoursTotal += item.durationHours;
      }

      const totalCount = bins.reduce((sum, bin) => sum + bin.count, 0);
      if (!totalCount) {
        reviewChartTimeband.innerHTML = '<p class="review-chart-empty">暂无可统计的时段活跃数据。</p>';
        return;
      }

      const totalHours = bins.reduce((sum, bin) => sum + bin.hoursTotal, 0);
      const maxCount = Math.max(1, ...bins.map((bin) => bin.count));
      const peakBin = bins.reduce((best, current) => (current.count > best.count ? current : best), bins[0]);

      const chartWidth = 100;
      const chartHeight = 56;
      const pointRadius = 1.2;
      const chartSidePadding = pointRadius + 0.5;
      const chartLeft = chartSidePadding;
      const chartRight = chartWidth - chartSidePadding;
      const chartTop = 6;
      const chartBottom = 52;
      const innerWidth = chartRight - chartLeft;
      const innerHeight = chartBottom - chartTop;
      const xStep = bins.length > 1 ? innerWidth / (bins.length - 1) : 0;

      const points = bins.map((bin, index) => {
        const ratio = maxCount > 0 ? bin.count / maxCount : 0;
        const x = chartLeft + index * xStep;
        const y = chartBottom - ratio * innerHeight;
        return { ...bin, x, y };
      });

      const linePath = points
        .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
        .join(" ");
      const areaPath = `${linePath} L ${points[points.length - 1].x.toFixed(2)} ${chartBottom.toFixed(2)} L ${points[0].x.toFixed(2)} ${chartBottom.toFixed(2)} Z`;

      const rawYTickValues = [maxCount, Math.max(1, Math.round(maxCount * 0.5)), 0];
      const yTickValues = [...new Set(rawYTickValues)].sort((a, b) => b - a);
      const yTickMarks = yTickValues
        .map((value) => {
          const ratio = maxCount > 0 ? value / maxCount : 0;
          const y = chartBottom - ratio * innerHeight;
          return `<line x1="${chartLeft.toFixed(2)}" y1="${y.toFixed(2)}" x2="${chartRight.toFixed(2)}" y2="${y.toFixed(2)}"></line>`;
        })
        .join("");
      const yTickLabels = yTickValues
        .map((value) => {
          const ratio = maxCount > 0 ? value / maxCount : 0;
          const y = chartBottom - ratio * innerHeight;
          const topPercent = (y / chartHeight) * 100;
          return `<span class="review-line-ytick" style="top:${topPercent.toFixed(2)}%">${value}</span>`;
        })
        .join("");

      reviewChartTimeband.innerHTML = `
    <div class="review-line-wrap">
      <div class="review-line-main">
        <div class="review-line-yaxis" aria-hidden="true">
          ${yTickLabels}
        </div>
        <div class="review-line-canvas">
          <svg class="review-line-chart" viewBox="0 0 ${chartWidth} ${chartHeight}" preserveAspectRatio="none" role="img" aria-label="按2小时区间统计的时段活跃度折线图">
            <g class="review-line-grid">
              ${yTickMarks}
            </g>
            <g class="review-line-axis">
              <line x1="${chartLeft.toFixed(2)}" y1="${chartTop.toFixed(2)}" x2="${chartLeft.toFixed(2)}" y2="${chartBottom.toFixed(2)}"></line>
              <line x1="${chartLeft.toFixed(2)}" y1="${chartBottom.toFixed(2)}" x2="${chartRight.toFixed(2)}" y2="${chartBottom.toFixed(2)}"></line>
            </g>
            <path class="review-line-area" d="${areaPath}"></path>
            <path class="review-line-path" d="${linePath}"></path>
            ${points
      .map(
        (point) => `
                <circle class="review-line-dot" cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="${pointRadius.toFixed(2)}">
                  <title>${escapeHtml(`${point.label}（${point.modernRange}） · ${point.count} 条 · ${point.hoursTotal.toFixed(1)}h`)}</title>
                </circle>
              `,
      )
      .join("")}
          </svg>
        </div>
      </div>

      <div class="review-line-xlabels">
        ${bins
      .map((bin, index) => {
        const point = points[index];
        const left = point ? point.x : 0;
        return `<span class="review-line-xlabel" style="left:${left.toFixed(2)}%">${escapeHtml(bin.shortLabel)}</span>`;
      })
      .join("")}
      </div>

      <p class="review-line-meta">峰值时段：${escapeHtml(`${peakBin.label}（${peakBin.modernRange}）`)}（${peakBin.count}条，${peakBin.hoursTotal.toFixed(1)}h） · 总计 ${totalCount} 条，${totalHours.toFixed(1)}h</p>
    </div>
  `;
    }

    function renderReviewMatrixChart(analyzableList) {
      if (!reviewChartMatrix) return;
      if (!analyzableList.length) {
        reviewChartMatrix.innerHTML = '<p class="review-chart-empty">暂无评分完整的 entry，可在记录后补评分。</p>';
        return;
      }

      const matrix = Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => ({ count: 0, hours: 0 })));

      const getBucketIndex = (score) => {
        if (score >= 8) return 2;
        if (score >= 5) return 1;
        return 0;
      };

      for (const item of analyzableList) {
        const qualityIndex = getBucketIndex(item.quality);
        const happinessIndex = getBucketIndex(item.happiness);
        const cell = matrix[qualityIndex][happinessIndex];
        cell.count += 1;
        cell.hours += item.durationHours;
      }

      let maxCount = 0;
      for (const row of matrix) {
        for (const cell of row) {
          maxCount = Math.max(maxCount, cell.count);
        }
      }
      const safeMaxCount = Math.max(1, maxCount);
      const rowLabels = ["高质", "中质", "低质"];
      const colLabels = ["低幸", "中幸", "高幸"];
      const rowOrder = [2, 1, 0];

      reviewChartMatrix.innerHTML = `
    <div class="review-matrix-wrap">
      <div class="review-matrix-top-labels">
        <span></span>
        ${colLabels.map((label) => `<span>${escapeHtml(label)}</span>`).join("")}
      </div>
      <div class="review-matrix-grid">
        ${rowOrder
    .map((bucketIndex, rowIndex) => `
            <span class="review-matrix-row-label">${escapeHtml(rowLabels[rowIndex])}</span>
            ${matrix[bucketIndex]
      .map((cell) => {
        const intensity = cell.count <= 0 ? 0 : cell.count / safeMaxCount;
        const alpha = cell.count <= 0 ? 0.08 : 0.14 + intensity * 0.56;
        const valueText = cell.count <= 0 ? "--" : `${cell.count}条`;
        const hoursText = cell.hours > 0 ? `${cell.hours.toFixed(1)}h` : "";
        return `
                  <span class="review-matrix-cell" style="background: rgba(62, 141, 132, ${alpha.toFixed(3)});" title="${escapeHtml(`${valueText} ${hoursText}`)}">
                    <strong>${escapeHtml(valueText)}</strong>
                    <small>${escapeHtml(hoursText)}</small>
                  </span>
                `;
      })
      .join("")}
          `)
    .join("")}
      </div>
      <p class="review-matrix-note">行表示质量（上高下低），列表示幸福（左低右高）。</p>
    </div>
  `;
    }

    function renderReviewVisuals() {
      const entryDataset = buildReviewVisualEntryDataset();
      const analyzable = entryDataset.filter(
        (item) => item.durationHours > 0 && item.quality !== null && item.happiness !== null && !item.needsReview,
      );
      renderReviewVisualKpis(entryDataset, analyzable);
      renderReviewTrendChart(entryDataset);
      renderReviewCategoryChart(entryDataset);
      renderReviewTimebandChart(entryDataset);
      renderReviewMatrixChart(analyzable);
    }

    function renderReviewDebugTable() {
      if (!reviewDebugTbody || !reviewDebugSummary) return;

      const todos = Array.isArray(getTodos()) ? getTodos() : [];
      const entries = getEntriesByCurrentRange();
      const searchTerm = String(getGlobalSearchTerm() || "").toLowerCase();
      const rows = [];

      for (const todo of todos) {
        const timestamp = Date.parse(String(todo.updatedAt || todo.createdAt || ""));
        const stateTags = [];
        stateTags.push(todo.completed ? "completed" : "pending");
        if (todo.syncState) stateTags.push(`sync:${todo.syncState}`);
        if (todo.calendarSynced) stateTags.push("calendarSynced");
        if (todo.repeat && todo.repeat !== "none") stateTags.push(`repeat:${todo.repeat}`);

        const sourceTags = [];
        if (todo.externalCalendarId) sourceTags.push("externalCalendar");
        if (todo.lastSyncError) sourceTags.push("syncError");

        rows.push({
          timestamp: Number.isFinite(timestamp) ? timestamp : 0,
          type: "todo",
          id: String(todo.id || ""),
          title: String(todo.title || ""),
          date: String(todo.dueDate || ""),
          time: `${String(todo.startTime || "--")} - ${String(todo.endTime || "--")}`,
          category: `分类:${getTodoCategory(todo, todo.project)} / 项目:${String(todo.project || "--")}`,
          tags: Array.isArray(todo.tags) ? todo.tags.map((tag) => `#${tag}`).join(" ") : "",
          score: `质${formatScoreLabel(todo.qualityScore)} / 幸${formatScoreLabel(todo.happinessScore)}`,
          stateTags: stateTags.join(" · "),
          source: sourceTags.join(" · ") || "--",
          externalId: String(todo.externalCalendarId || ""),
          linkedId: String(todo.completionEntryId || ""),
          updatedAt: String(todo.updatedAt || todo.createdAt || ""),
          searchText: `${todo.title || ""} ${todo.project || ""} ${todo.category || ""} ${todo.note || ""} ${Array.isArray(todo.tags) ? todo.tags.join(" ") : ""}`.toLowerCase(),
        });
      }

      for (const entry of entries) {
        const timestamp = Date.parse(`${entry.date || ""}T${entry.start || "00:00"}:00`);
        const stateTags = [];
        if (entry.needsReview) stateTags.push("needsReview");
        if (isImportedExternalEntry(entry)) stateTags.push("importedExternal");
        if (entry.source) stateTags.push(`source:${entry.source}`);

        rows.push({
          timestamp: Number.isFinite(timestamp) ? timestamp : 0,
          type: "entry",
          id: String(entry.id || ""),
          title: getEntryDisplayTitle(entry, entry.category || "记录"),
          date: String(entry.date || ""),
          time: `${String(entry.start || "--")} - ${String(entry.end || "--")}`,
          category: String(entry.category || ""),
          tags: entry.calendarGroup ? `group:${entry.calendarGroup}` : "--",
          score: `质${formatScoreLabel(entry.quality)} / 幸${formatScoreLabel(entry.happiness)}`,
          stateTags: stateTags.join(" · ") || "--",
          source: String(entry.source || "--"),
          externalId: String(entry.externalId || ""),
          linkedId: String(entry.linkedTodoId || ""),
          updatedAt: String(entry.updatedAt || entry.createdAt || ""),
          searchText: `${entry.title || ""} ${entry.category || ""} ${entry.note || ""} ${entry.source || ""} ${entry.calendarGroup || ""}`.toLowerCase(),
        });
      }

      const filteredRows = rows
        .filter((row) => !searchTerm || row.searchText.includes(searchTerm))
        .sort((a, b) => b.timestamp - a.timestamp);

      const todoCount = filteredRows.filter((item) => item.type === "todo").length;
      const entryCount = filteredRows.filter((item) => item.type === "entry").length;
      reviewDebugSummary.textContent = `共 ${filteredRows.length} 行（待办 ${todoCount} / 日程 ${entryCount}）`;

      if (!filteredRows.length) {
        reviewDebugTbody.innerHTML = '<tr><td class="is-empty" colspan="13">没有匹配的调试数据。</td></tr>';
        return;
      }

      reviewDebugTbody.innerHTML = filteredRows
        .map(
          (row) => `
      <tr>
        <td>${escapeHtml(row.type)}</td>
        <td>${escapeHtml(row.id || "--")}</td>
        <td>${escapeHtml(row.title || "--")}</td>
        <td>${escapeHtml(row.date || "--")}</td>
        <td>${escapeHtml(row.time || "--")}</td>
        <td>${escapeHtml(row.category || "--")}</td>
        <td>${escapeHtml(row.tags || "--")}</td>
        <td>${escapeHtml(row.score || "--")}</td>
        <td>${escapeHtml(row.stateTags || "--")}</td>
        <td>${escapeHtml(row.source || "--")}</td>
        <td>${escapeHtml(row.externalId || "--")}</td>
        <td>${escapeHtml(row.linkedId || "--")}</td>
        <td>${escapeHtml(row.updatedAt || "--")}</td>
      </tr>
    `,
        )
        .join("");
    }

    function renderReview() {
      renderReviewVisuals();
      setReviewLegacyVisible(getReviewLegacyVisible());
      if (!reviewList || !reviewSummary) return;

      const todos = Array.isArray(getTodos()) ? getTodos() : [];
      const entries = getEntriesByCurrentRange();
      const searchTerm = String(getGlobalSearchTerm() || "").toLowerCase();
      const completedTodos = todos.filter((item) => item.completed);
      const journalEntries = entries.filter((item) => String(item.note || "").trim());
      reviewSummary.textContent = `已完成待办 ${completedTodos.length} 项 · 时间记录 ${entries.length} 条 · 含备注日志 ${journalEntries.length} 条`;

      const records = [];
      for (const todo of completedTodos) {
        records.push({
          timestamp: new Date(todo.completedAt || todo.updatedAt || todo.createdAt || Date.now()).getTime(),
          title: `完成待办：${todo.title}`,
          meta: `${todo.project} · ${todo.dueDate || "未排期"} · 质${formatScoreLabel(todo.qualityScore)} / 幸${formatScoreLabel(todo.happinessScore)}`,
          note: todo.note || "无备注",
        });
      }

      for (const entry of journalEntries) {
        const entryTitle = getEntryDisplayTitle(entry, entry.category || "记录");
        records.push({
          timestamp: new Date(`${entry.date}T${entry.start}:00`).getTime(),
          title: `${entryTitle} · ${entry.date} ${entry.start}-${entry.end}`,
          meta: `质${formatScoreLabel(entry.quality)} / 幸${formatScoreLabel(entry.happiness)}`,
          note: entry.note || "无备注",
        });
      }

      const filtered = records
        .filter((item) => {
          if (!searchTerm) return true;
          const haystack = `${item.title} ${item.meta} ${item.note}`.toLowerCase();
          return haystack.includes(searchTerm);
        })
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 40);

      renderReviewDebugTable();

      if (!filtered.length) {
        reviewList.innerHTML = '<p class="todo-empty">没有匹配的复盘记录。</p>';
        return;
      }

      const rowsHtml = filtered
        .map((item) => {
          const timeText = Number.isFinite(item.timestamp)
            ? new Date(item.timestamp).toLocaleString("zh-CN", { hour12: false })
            : "--";
          return `
        <tr>
          <td>${escapeHtml(item.title)}</td>
          <td>${escapeHtml(item.meta)}</td>
          <td>${escapeHtml(item.note)}</td>
          <td>${escapeHtml(timeText)}</td>
        </tr>
      `;
        })
        .join("");

      reviewList.innerHTML = `
    <div class="review-log-table-wrap">
      <table class="review-log-table">
        <thead>
          <tr>
            <th>标题</th>
            <th>信息</th>
            <th>备注</th>
            <th>时间</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
    </div>
  `;
    }

    return {
      buildReviewVisualEntryDataset,
      renderReviewVisualKpis,
      renderReviewTrendChart,
      renderReviewCategoryChart,
      renderReviewTimebandChart,
      renderReviewMatrixChart,
      renderReviewVisuals,
      renderReview,
      renderReviewDebugTable,
    };
  }

  const existing = globalScope.TimeQualityReviewModule || {};
  globalScope.TimeQualityReviewModule = {
    ...existing,
    createReviewModule,
  };
})(typeof window !== "undefined" ? window : globalThis);
