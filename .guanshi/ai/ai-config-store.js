"use strict";

const fs = require("fs");
const path = require("path");

const {
  AI_CONFIG_SCHEMA,
  createProviderError,
  normalizeProviderConfig,
  sanitizeProviderConfig,
} = require("./ai-provider-registry");

function writeJsonAtomic(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, filePath);
}

function readJsonIfExists(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw createProviderError("AI_CONFIG_READ_FAILED", "AI config could not be read.", 500);
  }
}

function normalizeRawConfig(raw) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const providers = source.providers && typeof source.providers === "object" && !Array.isArray(source.providers)
    ? source.providers
    : {};
  return {
    schema: AI_CONFIG_SCHEMA,
    activeProviderId: String(source.activeProviderId || "").trim(),
    providers,
    updatedAt: String(source.updatedAt || "").trim(),
  };
}

function normalizeProviderEntries(input) {
  if (Array.isArray(input)) {
    return input.map((provider) => [String(provider?.id || provider?.providerId || "").trim(), provider]);
  }
  if (input && typeof input === "object") {
    return Object.entries(input);
  }
  return [];
}

function sanitizeConfig(config, env = process.env) {
  const providers = {};
  for (const [id, provider] of Object.entries(config.providers || {})) {
    providers[id] = sanitizeProviderConfig(provider, env);
  }
  return {
    schema: AI_CONFIG_SCHEMA,
    activeProviderId: config.activeProviderId || "",
    providers,
    updatedAt: config.updatedAt || "",
  };
}

function createAiConfigStore(options = {}) {
  const dataDir = options.dataDir ? path.resolve(options.dataDir) : process.cwd();
  const filePath = options.filePath ? path.resolve(options.filePath) : path.join(dataDir, "ai_config.json");
  const env = options.env || process.env;

  function readConfig() {
    return normalizeRawConfig(readJsonIfExists(filePath));
  }

  function readSanitizedConfig() {
    return sanitizeConfig(readConfig(), env);
  }

  function saveConfig(input) {
    const existing = readConfig();
    const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
    const nextProviders = { ...existing.providers };
    const entries = normalizeProviderEntries(source.providers);

    for (const [rawId, rawProvider] of entries) {
      const providerInput = {
        ...(rawProvider && typeof rawProvider === "object" ? rawProvider : {}),
        id: String(rawProvider?.id || rawProvider?.providerId || rawId || "").trim(),
      };
      const existingProvider = nextProviders[providerInput.id] || {};
      const normalized = normalizeProviderConfig(providerInput, existingProvider);
      nextProviders[normalized.id] = normalized;
    }

    let activeProviderId = String(source.activeProviderId ?? existing.activeProviderId ?? "").trim();
    if (!activeProviderId && entries.length === 1) {
      activeProviderId = normalizeProviderConfig(
        {
          ...(entries[0][1] && typeof entries[0][1] === "object" ? entries[0][1] : {}),
          id: String(entries[0][1]?.id || entries[0][1]?.providerId || entries[0][0] || "").trim(),
        },
        nextProviders[String(entries[0][0] || "").trim()] || {},
      ).id;
    }
    if (activeProviderId && !nextProviders[activeProviderId]) {
      throw createProviderError("AI_ACTIVE_PROVIDER_NOT_FOUND", "Active AI provider was not found.", 404, { activeProviderId });
    }

    const payload = {
      schema: AI_CONFIG_SCHEMA,
      activeProviderId,
      providers: nextProviders,
      updatedAt: new Date().toISOString(),
    };
    writeJsonAtomic(filePath, payload);
    return payload;
  }

  function getProvider(providerId = "") {
    const config = readConfig();
    const id = String(providerId || config.activeProviderId || "").trim();
    if (!id) {
      throw createProviderError("AI_PROVIDER_NOT_CONFIGURED", "No active AI provider is configured.", 404);
    }
    const provider = config.providers[id];
    if (!provider) {
      throw createProviderError("AI_PROVIDER_NOT_FOUND", "AI provider was not found.", 404, { providerId: id });
    }
    return provider;
  }

  return {
    filePath,
    getProvider,
    readConfig,
    readSanitizedConfig,
    saveConfig,
  };
}

module.exports = {
  createAiConfigStore,
  sanitizeConfig,
};
