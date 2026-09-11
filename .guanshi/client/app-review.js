/* The review route is retained for AI/context compatibility; its UI is Time Forest. */
(function (scope) {
  "use strict";
  function createReviewModule(deps = {}) {
    const root = document.getElementById("view-review");
    const $ = (id) => root.querySelector("#" + id),
      escape = deps.escapeHtml;
    let range = "all",
      month = "",
      until = "",
      unratedOnly = false,
      page = 0,
      selected = "",
      snapshot = null,
      scene = null,
      loading = false,
      failed = false,
      visible = false,
      signature = "",
      drawn = "",
      epoch = 0;
    let autoRotate = !scope.matchMedia("(prefers-reduced-motion: reduce)").matches;
    try { const saved = localStorage.getItem("guanshi-forest-auto-rotate"); if (saved !== null) autoRotate = saved === "true"; } catch {}
    $("forest-auto-rotate").setAttribute("aria-pressed", String(autoRotate));
    $("forest-auto-rotate").onclick = () => {
      autoRotate = !autoRotate;
      $("forest-auto-rotate").setAttribute("aria-pressed", String(autoRotate));
      try { localStorage.setItem("guanshi-forest-auto-rotate", String(autoRotate)); } catch {}
      scene?.setAutoRotate(autoRotate);
    };
    const host = $("forest-canvas"), list = $("forest-record-list");
    function setStatus(message = "", retry = false) {
      $("forest-status").textContent = message;
      $("forest-status-row").hidden = !message;
      $("forest-retry").hidden = !retry;
    }
    function select(id) {
      selected = id;
      if (id) root.querySelector(".forest-records").open = false;
      scene?.select(id);
      renderDetail();
      for (const b of root.querySelectorAll("[data-tree]"))
        b.setAttribute("aria-pressed", String(b.dataset.tree === id));
    }
    function renderDetail() {
      const t = snapshot?.trees.find((t) => t.id === selected);
      const box = $("forest-detail");
      box.hidden = !t;
      if (!t) return;
      box.innerHTML = `<button class="forest-close" type="button" aria-label="关闭记录详情">×</button><span class="forest-eyebrow">这一段时间</span><h3>${escape(t.title)}</h3><p>${escape(t.date)} · ${Math.round(t.minutes)} 分钟</p><div class="forest-scores"><span>质量 <strong>${t.quality ?? "—"}<small>/10</small></strong></span><span>幸福感 <strong>${t.happiness ?? "—"}<small>/10</small></strong></span></div><p class="forest-category">${escape(t.category)}</p><p class="forest-origin">${t.external ? "日历记录" + (t.unrated ? "，待确认" : "") : escape({ manual: "手动记录", "todo-completed": "完成待办", "todo-recurring-completed": "周期待办完成", "pomodoro-session": "番茄钟记录" }[t.source] || "时间记录")}${t.unrated ? " · 待评分" : ""}</p><button class="forest-primary" type="button" data-open-record>查看与评分</button>`;
      box.querySelector(".forest-close").onclick = () => select("");
      box.querySelector("[data-open-record]").onclick = () =>
        deps.openEntry(t.id);
    }
    async function ensureScene() {
      if (scene || loading || failed || !visible) return;
      loading = true;
      const generation = ++epoch;
      setStatus("正在载入森林…");
      try {
        const module = await import("/assets/forest/scene.mjs");
        const built = await module.createForestScene(host, select, () => {
          failed = true;
          scene?.dispose();
          scene = null;
          setStatus("森林显示已中断，请重试。", true);
        });
        if (generation !== epoch) {
          built.dispose();
          return;
        }
        scene = built;
        scene.setAutoRotate(autoRotate);
        scene.update(currentTrees());
        scene.select(selected);
        scene.setVisible(visible);
        drawn = signature;
        setStatus();
      } catch (error) {
        if (generation !== epoch) return;
        failed = true;
        setStatus("森林加载失败，请重试。", true);
      } finally {
        if (generation === epoch) loading = false;
      }
    }
    function currentTrees() {
      return snapshot ? snapshot.trees.slice(page * 300, (page + 1) * 300) : [];
    }
    function renderReview() {
      visible = !root.hidden;
      if (!visible) {
        scene?.setVisible(false);
        return;
      }
      const base = deps.forestData.buildSnapshot(deps.getEntries(), {
        range,
        isImportedExternalEntry: deps.isImportedExternalEntry,
      });
      if (!base.months.includes(month)) month = base.months[0] || "";
      const monthStart = month ? month + "-01" : "";
      const today = deps.forestData.dateKey(new Date());
      const monthEnd = month
        ? deps.forestData.dateKey(
            new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0),
          )
        : today;
      const maxDate = monthEnd < today ? monthEnd : today;
      if (until && (until < monthStart || until > maxDate)) until = "";
      snapshot = deps.forestData.buildSnapshot(deps.getEntries(), {
        range,
        month,
        until: until || maxDate,
        unratedOnly,
        search: deps.getGlobalSearchTerm(),
        isImportedExternalEntry: deps.isImportedExternalEntry,
      });
      page = Math.min(
        page,
        Math.max(0, Math.ceil(snapshot.trees.length / 300) - 1),
      );
      const items = currentTrees();
      $("forest-summary").innerHTML =
        `<span><span class="forest-metric-label">种下的树</span><span><strong>${snapshot.trees.length}</strong> 棵</span></span><span><span class="forest-metric-label">记录的时间</span><span><strong>${(snapshot.totalRecordedMinutes / 60).toFixed(1)}</strong> 小时</span></span><span><span class="forest-metric-label">等待回顾</span><span><strong>${snapshot.unratedCount}</strong> 段</span></span>`;
      $("forest-month").innerHTML = base.months.length
        ? base.months
            .map(
              (m) =>
                `<option value="${m}" ${m === month ? "selected" : ""}>${m.slice(0, 4)}年 ${Number(m.slice(5))}月</option>`,
            )
            .join("")
        : '<option value="">尚无林区</option>';
      const scopeNotes = [
        snapshot.overlap ? "记录时长包含重叠时段" : "",
        snapshot.invalid.length ? `${snapshot.invalid.length} 条记录时间不完整，暂未种树` : "",
      ].filter(Boolean).join(" · ");
      $("forest-scope").textContent = scopeNotes;
      $("forest-scope").hidden = !scopeNotes;
      $("forest-empty").hidden = items.length > 0;
      $("forest-empty").textContent =
        unratedOnly || deps.getGlobalSearchTerm() || until
          ? "这个筛选范围还没有树，试试调整条件。"
          : "记录一段时间，让森林开始生长。";
      $("forest-pagination").hidden = snapshot.trees.length <= 300;
      $("forest-page-label").textContent =
        `林地 ${page + 1} / ${Math.max(1, Math.ceil(snapshot.trees.length / 300))}`;
      $("forest-prev").disabled = page === 0;
      $("forest-next").disabled = (page + 1) * 300 >= snapshot.trees.length;
      const nextSignature = JSON.stringify(items);
      if (signature !== nextSignature) {
        signature = nextSignature;
        list.innerHTML =
          items
            .map(
              (t) =>
                `<button type="button" data-tree="${escape(t.id)}" aria-pressed="false"><span>${escape(t.title)}</span><small>${escape(t.date)} · ${Math.round(t.minutes)}分钟 · 质量 ${t.quality ?? "—"} / 幸福 ${t.happiness ?? "—"}${t.unrated ? " · 待评分" : ""}</small></button>`,
            )
            .join("") || "<p>当前没有符合条件的记录。</p>";
      }
      if (selected && !snapshot.trees.some((t) => t.id === selected))
        selected = "";
      renderDetail();
      if (scene) {
        scene.setVisible(true);
        if (drawn !== signature) {
          scene.update(items);
          drawn = signature;
        }
      } else ensureScene();
      scene?.select(selected);
    }
    root.addEventListener("click", (event) => {
      const b = event.target.closest("button");
      if (!b) return;
      if (b.dataset.tree) select(b.dataset.tree);
    });
    $("forest-month").onchange = (e) => {
      month = e.target.value;
      until = "";
      page = 0;
      renderReview();
    };
    $("forest-unrated").onchange = (e) => {
      unratedOnly = e.target.checked;
      page = 0;
      renderReview();
    };
    $("forest-prev").onclick = () => {
      page--;
      renderReview();
    };
    $("forest-next").onclick = () => {
      page++;
      renderReview();
    };
    $("forest-reset").onclick = () => scene?.reset();
    $("forest-zoom-in").onclick = () => scene?.zoom(1.2);
    $("forest-zoom-out").onclick = () => scene?.zoom(1 / 1.2);
    $("forest-retry").onclick = () => {
      failed = false;
      scene?.dispose();
      scene = null;
      loading = false;
      epoch++;
      renderReview();
    };
    return {
      renderReview,
      getVisibleRange: () => snapshot?.visibleRange,
      getRange: () => range,
      dispose: () => {
        epoch++;
        scene?.dispose();
        scene = null;
      },
      getDiagnostics: () => ({
        mode: "3d",
        failed,
        visible,
        count: currentTrees().length,
        ...scene?.stats(),
      }),
    };
  }
  scope.TimeQualityReviewModule = { createReviewModule };
})(typeof window !== "undefined" ? window : globalThis);
