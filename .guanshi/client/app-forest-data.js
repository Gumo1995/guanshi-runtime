/* Pure projection: Entries remain the only source of truth. */
(function (scope) {
  "use strict";
  const hash = (value) => {
    let n = 2166136261;
    for (const c of String(value)) n = Math.imul(n ^ c.charCodeAt(0), 16777619);
    n = Math.imul(n ^ (n >>> 16), 0x85ebca6b);
    n = Math.imul(n ^ (n >>> 13), 0xc2b2ae35);
    return (n ^ (n >>> 16)) >>> 0;
  };
  function dateKey(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function validDate(s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const d = new Date(`${s}T12:00:00`);
    return Number.isFinite(+d) && dateKey(d) === s;
  }
  function clock(s) {
    if (!/^\d{2}:\d{2}$/.test(String(s))) return null;
    const [h, m] = s.split(":").map(Number);
    return h < 24 && m < 60 ? h * 60 + m : null;
  }
  function score(v) {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 1 && n <= 10 ? n : null;
  }
  function buildSnapshot(entries, options = {}) {
    const now = options.now ? new Date(options.now) : new Date();
    const today = dateKey(now),
      range = ["7", "30", "all"].includes(String(options.range))
        ? String(options.range)
        : "30";
    const first = new Date(now);
    first.setDate(first.getDate() - (range === "7" ? 6 : 29));
    const start = range === "all" ? "0000-01-01" : dateKey(first);
    const seen = new Set(),
      trees = [],
      invalid = [];
    for (const entry of Array.isArray(entries) ? entries : []) {
      if (!entry || typeof entry !== "object") {
        invalid.push({ reason: "无效记录" });
        continue;
      }
      const id = String(entry.id || "").trim(),
        date = String(entry.date || "");
      if (!id || !validDate(date)) {
        invalid.push({ id, reason: "缺少唯一编号或有效日期" });
        continue;
      }
      if (seen.has(id)) continue;
      seen.add(id);
      const from = clock(entry.start),
        to = clock(entry.end);
      let minutes = Number(entry.duration) * 60;
      if (!(Number.isFinite(minutes) && minutes > 0))
        minutes = from !== null && to !== null ? (to - from + 1440) % 1440 : 0;
      if (
        !(minutes > 0 && Number.isFinite(minutes)) ||
        from === null ||
        to === null
      ) {
        invalid.push({ id, reason: "时间或时长无效" });
        continue;
      }
      const begins = new Date(`${date}T${entry.start}:00`);
      const ends = new Date(`${date}T${entry.end}:00`);
      if (to <= from) ends.setDate(ends.getDate() + 1);
      if (+ends > +now || date < start) continue;
      const q = score(entry.quality),
        h = score(entry.happiness),
        unrated = Boolean(entry.needsReview) || q === null || h === null;
      const category = String(entry.category || "未分类");
      const species =
        {
          工作: 0,
          学习: 1,
          休息: 2,
          运动: 0,
          社交: 2,
          兴趣: 1,
          家务: 0,
          通勤: 1,
        }[category] ?? 0;
      const stage = minutes < 25 ? 0 : minutes < 60 ? 1 : minutes < 120 ? 2 : 3;
      const seed = hash(id);
      let x = 6, z = 0;
      for (let attempt = 0; attempt < 64; attempt++) {
        const salt = attempt ? ":" + attempt : "";
        const angle = (hash(id + ":angle" + salt) / 4294967296) * Math.PI * 2;
        const radius = Math.sqrt((hash(id + ":radius" + salt) + 0.5) / 4294967296) * 12;
        const nearCabin = hash(id + ":grove") % 100 < 48;
        const groveRadius = 5.6 + (radius / 12) * 2.8;
        x = nearCabin ? -4.5 + Math.cos(angle) * groveRadius : Math.cos(angle) * radius;
        z = nearCabin ? -1 + Math.sin(angle) * groveRadius : Math.sin(angle) * radius;
        const cabin = x > -7.8 && x < -1.2 && z > -4.6 && z < 1.6;
        const pond = ((x + 6) / 5) ** 2 + ((z - 7) / 4.5) ** 2 < 1;
        if (!cabin && !pond && Math.hypot(x, z) <= 12) break;
        if (attempt === 63) { x = 6; z = 0; }
      }
      trees.push({
        id,
        date,
        month: date.slice(0, 7),
        minutes,
        title: String(entry.title || category),
        category,
        source: String(entry.source || ""),
        note: String(entry.note || ""),
        quality: q,
        happiness: h,
        unrated,
        external: Boolean(options.isImportedExternalEntry?.(entry)),
        species,
        stage,
        fullness: unrated ? 1 : q <= 3 ? 0.72 : q <= 6 ? 0.9 : 1.12,
        flowers: unrated || h <= 3 ? 0 : h <= 6 ? 1 : 2,
        x,
        z,
        rotation: (seed % 628) / 100,
        beginMs: +begins,
        endMs: +ends,
      });
    }
    trees.sort(
      (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
    );
    const months = [...new Set(trees.map((t) => t.month))].sort().reverse();
    const keyword = String(options.search || "")
      .trim()
      .toLowerCase();
    const scoped = trees.filter(
      (t) =>
        (!options.month || t.month === options.month) &&
        (!options.until || t.date <= options.until) &&
        (!keyword ||
          `${t.title} ${t.category} ${t.source} ${t.note}`
            .toLowerCase()
            .includes(keyword)) &&
        (!options.unratedOnly || t.unrated),
    );
    let latestEnd = -Infinity,
      overlap = false;
    for (const t of [...scoped].sort((a, b) => a.beginMs - b.beginMs)) {
      if (t.beginMs < latestEnd) overlap = true;
      latestEnd = Math.max(latestEnd, t.endMs);
    }
    return {
      ruleVersion: 4,
      range,
      trees: scoped,
      months,
      monthCounts: Object.fromEntries(
        months.map((m) => [m, trees.filter((t) => t.month === m).length]),
      ),
      totalRecordedMinutes: scoped.reduce((s, t) => s + t.minutes, 0),
      unratedCount: scoped.filter((t) => t.unrated).length,
      invalid,
      overlap,
      visibleRange: {
        start: scoped[0]?.date || (range === "all" ? today : start),
        end: options.until || today,
      },
    };
  }
  scope.TimeQualityForestData = { buildSnapshot, hash, dateKey };
  if (typeof module !== "undefined" && module.exports)
    module.exports = scope.TimeQualityForestData;
})(typeof window !== "undefined" ? window : globalThis);
