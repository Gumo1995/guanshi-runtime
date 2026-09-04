/* global window */

(function attachLiuyaoModelModule(globalScope) {
  "use strict";

  const DEFAULT_STORAGE_KEY = "time_quality_liuyao_readings_v1";
  const DEFAULT_MAX_READINGS = 120;

  function createLiuyaoModelModule(deps = {}) {
    const localStorageRef = deps.localStorageRef || globalScope.localStorage || null;
    const storageKey = String(deps.storageKey || DEFAULT_STORAGE_KEY);
    const onChange = typeof deps.onChange === "function" ? deps.onChange : () => {};
    const maxReadings = Number.isInteger(deps.maxReadings) && deps.maxReadings > 0
      ? deps.maxReadings
      : DEFAULT_MAX_READINGS;
    let readings = [];

    function normalizeReading(value) {
      if (!value || typeof value !== "object" || value.schema !== "guanshi-liuyao-reading-v1") return null;
      if (!value.id || !value.primary || !Array.isArray(value.lineValues) || value.lineValues.length !== 6) return null;
      return value;
    }

    function load() {
      try {
        const parsed = JSON.parse(localStorageRef?.getItem(storageKey) || "[]");
        readings = Array.isArray(parsed) ? parsed.map(normalizeReading).filter(Boolean).slice(0, maxReadings) : [];
      } catch {
        readings = [];
      }
      return getAll();
    }

    function persist() {
      try {
        localStorageRef?.setItem(storageKey, JSON.stringify(readings.slice(0, maxReadings)));
        return true;
      } catch {
        return false;
      }
    }

    function getAll() {
      return readings.slice();
    }

    function getById(id) {
      return readings.find((item) => item.id === id) || null;
    }

    function save(reading) {
      const normalized = normalizeReading(reading);
      if (!normalized) throw new Error("无法保存无效的六爻卦例");
      readings = [normalized, ...readings.filter((item) => item.id !== normalized.id)].slice(0, maxReadings);
      if (!persist()) throw new Error("当前浏览器无法保存卦例");
      onChange({ reason: "save", readingId: normalized.id });
      return normalized;
    }

    function remove(id) {
      const before = readings.length;
      readings = readings.filter((item) => item.id !== id);
      if (readings.length !== before && !persist()) throw new Error("删除后无法更新本地卦例");
      if (readings.length !== before) onChange({ reason: "remove", readingId: id });
      return readings.length !== before;
    }

    function clear() {
      readings = [];
      try {
        localStorageRef?.removeItem(storageKey);
        onChange({ reason: "clear" });
        return true;
      } catch {
        return false;
      }
    }

    load();

    return {
      storageKey,
      load,
      getAll,
      getById,
      save,
      remove,
      clear,
    };
  }

  globalScope.TimeQualityLiuyaoModelModule = {
    DEFAULT_STORAGE_KEY,
    createLiuyaoModelModule,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = globalScope.TimeQualityLiuyaoModelModule;
  }
})(typeof window !== "undefined" ? window : globalThis);
