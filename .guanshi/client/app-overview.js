(function attachTimeQualityOverviewModule(globalScope) {
  function createOverviewModule(deps = {}) {
    const {
      documentRef = globalScope.document,
      windowRef = globalScope,
      metricHours,
      metricQuality,
	      metricHappiness,
	      metricGolden,
	      qualityIndex,
	      overviewJudgment,
	      insight,
	      barsWrap,
      scatterWrap,
      SCATTER_PADDING_PERCENT,
      SCATTER_BASE_DURATION_HOURS,
      SCATTER_BASE_DIAMETER,
      SCATTER_MIN_DIAMETER,
      SCATTER_MAX_DIAMETER,
    } = deps;

    const requestFrame =
      windowRef && typeof windowRef.requestAnimationFrame === "function"
        ? windowRef.requestAnimationFrame.bind(windowRef)
        : (callback) => globalScope.setTimeout(() => callback(Date.now()), 16);

    function sumBy(list, getter) {
      return list.reduce((sum, item) => sum + getter(item), 0);
    }

    function weightedAverage(list, field) {
      const totalHours = sumBy(list, (item) => item.duration);
      if (!totalHours) return 0;

      const weighted = sumBy(list, (item) => item[field] * item.duration);
      return weighted / totalHours;
    }

    function getPeriod(hour) {
      if (hour >= 5 && hour < 12) return "早晨";
      if (hour >= 12 && hour < 18) return "下午";
      if (hour >= 18 && hour < 24) return "晚间";
      return "深夜";
    }

	    function setAnimatedText(element, target, suffix = "", fixed = 0) {
      if (!element) return;
      const from = Number(element.dataset.value || 0);
      const to = Number(target || 0);
      const start = performance.now();
      const duration = 420;

      function frame(now) {
        const progress = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - progress, 3);
        const value = from + (to - from) * eased;
        element.textContent = `${value.toFixed(fixed)}${suffix}`;

        if (progress < 1) {
          requestFrame(frame);
        } else {
          element.dataset.value = String(to);
        }
      }

	      requestFrame(frame);
	    }

	    function escapeHtml(value) {
	      return String(value ?? "")
	        .replaceAll("&", "&amp;")
	        .replaceAll("<", "&lt;")
	        .replaceAll(">", "&gt;")
	        .replaceAll('"', "&quot;")
	        .replaceAll("'", "&#039;");
	    }

	    function getLocalDateText(date = new Date()) {
	      const year = date.getFullYear();
	      const month = String(date.getMonth() + 1).padStart(2, "0");
	      const day = String(date.getDate()).padStart(2, "0");
	      return `${year}-${month}-${day}`;
	    }

	    function isDateText(value) {
	      return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "").trim());
	    }

	    function formatHoursLabel(hours) {
	      const safeHours = Math.max(0, Number(hours) || 0);
	      if (safeHours < 1) return `${Math.round(safeHours * 60)}m`;
	      return `${safeHours.toFixed(safeHours >= 10 ? 0 : 1)}h`;
	    }

	    function getTodoWorkloadMinutes(todo) {
	      const remaining = Number(todo?.remainingMinutes);
	      if (Number.isFinite(remaining) && remaining >= 0) return Math.min(24 * 60, remaining);
	      const estimated = Number(todo?.estimatedMinutes);
	      if (Number.isFinite(estimated) && estimated > 0) return Math.min(24 * 60, estimated);
	      return 60;
	    }

	    function renderJudgment(context = {}) {
	      if (!overviewJudgment) return;
	      const allEntries = Array.isArray(context.entries) ? context.entries : [];
	      const allTodos = Array.isArray(context.todos) ? context.todos : [];
	      const today = getLocalDateText();
	      const tomorrow = getLocalDateText(new Date(Date.now() + 24 * 60 * 60 * 1000));
	      const todayEntries = allEntries.filter((entry) => String(entry?.date || "").trim() === today);
	      const arrangedHours = sumBy(todayEntries, (entry) => Math.max(0, Number(entry?.duration) || 0));
	      const activeTodos = allTodos.filter((todo) => !todo?.completed);
	      const dueOrOverdueTodos = activeTodos.filter((todo) => {
	        const dueDate = String(todo?.dueDate || "").trim();
	        return isDateText(dueDate) && dueDate <= today;
	      });
	      const dueTomorrowTodos = activeTodos.filter((todo) => String(todo?.dueDate || "").trim() === tomorrow);
	      const pendingMinutes = sumBy(dueOrOverdueTodos, getTodoWorkloadMinutes);
	      const pendingHours = pendingMinutes / 60;
	      const totalLoadHours = arrangedHours + pendingHours;
	      const freeHours = Math.max(0, 8 - totalLoadHours);
	      const overdueCount = dueOrOverdueTodos.filter((todo) => String(todo?.dueDate || "").trim() < today).length;
	      const dueTodayCount = dueOrOverdueTodos.length - overdueCount;

	      let status = "宽松";
	      let tone = "loose";
	      let recommendation = "适合先处理一个清晰产出，再补充计划。";
	      if (totalLoadHours > 9) {
	        status = "超载";
	        tone = "overloaded";
	        recommendation = "先压缩低收益安排，只保留必须完成的事项。";
	      } else if (totalLoadHours > 7) {
	        status = "紧张";
	        tone = "tight";
	        recommendation = "先锁定截止风险，再安排可推迟任务。";
	      } else if (totalLoadHours > 4) {
	        status = "正常";
	        tone = "normal";
	        recommendation = "保持节奏，优先完成今日到期任务。";
	      }

	      const biggestRisk = overdueCount
	        ? `${overdueCount} 项已过期`
	        : dueTodayCount
	          ? `${dueTodayCount} 项今日到期`
	          : dueTomorrowTodos.length
	            ? `${dueTomorrowTodos.length} 项明日到期`
	            : pendingHours >= 4
	              ? "待处理工作量偏高"
	              : "暂无明显截止风险";

	      overviewJudgment.innerHTML = `
	        <div class="overview-judgment-main">
	          <div>
	            <p class="overview-judgment-kicker">今日状态</p>
	            <h2 data-tone="${tone}">${escapeHtml(status)}</h2>
	          </div>
	          <p>${escapeHtml(recommendation)}</p>
	        </div>
	        <div class="overview-judgment-risk">
	          <span>最大风险</span>
	          <strong>${escapeHtml(biggestRisk)}</strong>
	        </div>
	        <div class="overview-judgment-metrics" aria-label="今日时间指标">
	          <div>
	            <span>已安排</span>
	            <strong>${formatHoursLabel(arrangedHours)}</strong>
	          </div>
	          <div>
	            <span>可用余量</span>
	            <strong>${formatHoursLabel(freeHours)}</strong>
	          </div>
	          <div>
	            <span>待处理</span>
	            <strong>${formatHoursLabel(pendingHours)}</strong>
	          </div>
	          <div>
	            <span>未完成</span>
	            <strong>${activeTodos.length}</strong>
	          </div>
	        </div>
	      `;
	    }

	    function renderMetrics(list) {
      if (!list.length) {
        setAnimatedText(metricHours, 0, "h", 1);
        setAnimatedText(metricQuality, 0, "", 1);
        setAnimatedText(metricHappiness, 0, "", 1);
        setAnimatedText(metricGolden, 0, "h", 1);
        setAnimatedText(qualityIndex, 0, "", 0);
        return;
      }

      const totalHours = sumBy(list, (item) => item.duration);
      const avgQuality = weightedAverage(list, "quality");
      const avgHappiness = weightedAverage(list, "happiness");
      const goldenHours = sumBy(
        list.filter((item) => item.quality >= 8 && item.happiness >= 8),
        (item) => item.duration,
      );

      const index = Math.min(100, (avgQuality * 0.62 + avgHappiness * 0.38) * 10);

      setAnimatedText(metricHours, totalHours, "h", 1);
      setAnimatedText(metricQuality, avgQuality, "", 1);
      setAnimatedText(metricHappiness, avgHappiness, "", 1);
      setAnimatedText(metricGolden, goldenHours, "h", 1);
      setAnimatedText(qualityIndex, index, "", 0);
    }

    function renderInsight(list) {
      if (!insight) return;
      if (!list.length) {
        insight.innerHTML = "<p>暂无可分析数据。先记录一天，系统会生成质量与幸福感建议。</p>";
        return;
      }

      const totalHours = sumBy(list, (item) => item.duration);
      const avgQuality = weightedAverage(list, "quality");
      const avgHappiness = weightedAverage(list, "happiness");
      const goldenHours = sumBy(
        list.filter((item) => item.quality >= 8 && item.happiness >= 8),
        (item) => item.duration,
      );

      const periodStats = {
        早晨: { score: 0, duration: 0 },
        下午: { score: 0, duration: 0 },
        晚间: { score: 0, duration: 0 },
        深夜: { score: 0, duration: 0 },
      };

      for (const item of list) {
        const hour = Number(item.start.split(":")[0]);
        const period = getPeriod(hour);
        const score = (item.quality + item.happiness) / 2;
        periodStats[period].score += score * item.duration;
        periodStats[period].duration += item.duration;
      }

      let bestPeriod = "早晨";
      let bestPeriodScore = -1;
      for (const [period, data] of Object.entries(periodStats)) {
        if (!data.duration) continue;
        const score = data.score / data.duration;
        if (score > bestPeriodScore) {
          bestPeriod = period;
          bestPeriodScore = score;
        }
      }

      const intensity = goldenHours / totalHours;

      let status = "节奏稳定";
      let suggestion = "保持现在的节奏，把高质量区块固定在同一时间段。";

      if (avgQuality < 6 && avgHappiness < 6) {
        status = "偏消耗";
        suggestion = "当前投入回报较低，建议压缩低收益任务，给休息和运动留出明确时段。";
      } else if (avgQuality >= 7.5 && avgHappiness >= 7.5) {
        status = "高质量高幸福";
        suggestion = "可以把本周期的安排作为模板，优先复制能带来成就和愉悦的活动组合。";
      } else if (avgQuality > avgHappiness + 1.2) {
        status = "高效但偏紧绷";
        suggestion = "效率不错，但幸福感偏低，建议在高强度任务后插入短恢复活动。";
      } else if (avgHappiness > avgQuality + 1.2) {
        status = "轻松但产出不足";
        suggestion = "状态放松，下一步可以用 1-2 个明确目标提高任务完成度。";
      }

      insight.innerHTML = `
        <p>
          当前状态：<strong>${status}</strong>。你在 <strong>${bestPeriod}</strong> 的综合评分最高，
          高质量高幸福时长占比 <strong>${(intensity * 100).toFixed(0)}%</strong>。
          ${suggestion}
        </p>
      `;
    }

    function renderBars(list, categories = []) {
      if (!barsWrap) return;
      barsWrap.innerHTML = "";

      if (!list.length) {
        barsWrap.innerHTML = '<p class="empty-tip">暂无数据</p>';
        return;
      }

      const categoryStats = Object.fromEntries(
        categories.map((name) => [
          name,
          { hours: 0, qualityWeighted: 0, happinessWeighted: 0 },
        ]),
      );

      for (const item of list) {
        if (!categoryStats[item.category]) {
          categoryStats[item.category] = { hours: 0, qualityWeighted: 0, happinessWeighted: 0 };
        }

        const duration = Number(item.duration) || 0;
        if (duration <= 0) continue;

        categoryStats[item.category].hours += duration;
        categoryStats[item.category].qualityWeighted += item.quality * duration;
        categoryStats[item.category].happinessWeighted += item.happiness * duration;
      }

      const sorted = Object.entries(categoryStats)
        .filter(([, value]) => value.hours > 0)
        .sort((a, b) => b[1].hours - a[1].hours);

      const max = sorted[0][1].hours || 1;
      for (const [name, stats] of sorted) {
        const hours = stats.hours;
        const width = (hours / max) * 100;
        const avgQuality = stats.qualityWeighted / hours;
        const avgHappiness = stats.happinessWeighted / hours;

        const row = documentRef.createElement("div");
        row.className = "bar-row";
        row.innerHTML = `
          <span class="bar-label">${name}</span>
          <div class="bar-track"><div class="bar-fill" data-width="${width}"></div></div>
          <span class="bar-metrics">
            <span class="bar-value">${hours.toFixed(1)}h</span>
            <span class="bar-metric-value">${avgQuality.toFixed(1)}</span>
            <span class="bar-metric-value">${avgHappiness.toFixed(1)}</span>
          </span>
        `;
        barsWrap.appendChild(row);
      }

      requestFrame(() => {
        for (const bar of barsWrap.querySelectorAll(".bar-fill")) {
          bar.style.width = `${bar.dataset.width}%`;
        }
      });
    }

    function renderScatter(list) {
      if (!scatterWrap) return;
      scatterWrap.innerHTML = "";
      const chartSpan = 100 - SCATTER_PADDING_PERCENT * 2;

      for (const [index, item] of list.entries()) {
        const x = SCATTER_PADDING_PERCENT + ((item.quality - 1) / 9) * chartSpan;
        const y = SCATTER_PADDING_PERCENT + ((10 - item.happiness) / 9) * chartSpan;
        const safeDuration = Math.max(0.1, Number(item.duration) || 0);
        const sizeScale = Math.sqrt(safeDuration / SCATTER_BASE_DURATION_HOURS);
        const size = Math.max(
          SCATTER_MIN_DIAMETER,
          Math.min(SCATTER_MAX_DIAMETER, SCATTER_BASE_DIAMETER * sizeScale),
        );

        const point = documentRef.createElement("div");
        point.className = "point";
        point.style.left = `calc(${x}% - ${size / 2}px)`;
        point.style.top = `calc(${y}% - ${size / 2}px)`;
        point.style.width = `${size}px`;
        point.style.height = `${size}px`;
        point.style.animationDelay = `${index * 50}ms`;
        point.title = `${item.category}｜质量${item.quality} 幸福${item.happiness}｜${item.duration.toFixed(1)}h`;
        scatterWrap.appendChild(point);
      }
    }

	    function render(list, categories = [], context = {}) {
	      const safeList = Array.isArray(list) ? list : [];
	      const safeCategories = Array.isArray(categories) ? categories : [];
	      renderJudgment(context);
	      renderMetrics(safeList);
      renderInsight(safeList);
      renderBars(safeList, safeCategories);
      renderScatter(safeList);
    }

    return {
      render,
      renderMetrics,
      renderInsight,
      renderBars,
      renderScatter,
    };
  }

  globalScope.TimeQualityOverviewModule = {
    createOverviewModule,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = globalScope.TimeQualityOverviewModule;
  }
})(typeof window !== "undefined" ? window : globalThis);
