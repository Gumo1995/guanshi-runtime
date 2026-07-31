"use strict";

const AI_CONFIG_SCHEMA = "guanshi-ai-config-v1";

const PROVIDER_TYPES = {
  "openai-compatible": {
    type: "openai-compatible",
    label: "OpenAI-compatible",
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4.1-mini",
    requiresBaseUrl: true,
    requiresModel: true,
    requiresApiKey: true,
    supportsStreaming: true,
    supportsJsonMode: true,
    envKeyNames: ["OPENAI_API_KEY"],
  },
  anthropic: {
    type: "anthropic",
    label: "Anthropic",
    defaultBaseUrl: "https://api.anthropic.com",
    defaultModel: "claude-3-5-sonnet-latest",
    requiresBaseUrl: true,
    requiresModel: true,
    requiresApiKey: true,
    supportsStreaming: true,
    supportsJsonMode: false,
    envKeyNames: ["ANTHROPIC_API_KEY"],
  },
  "hermes-webui": {
    type: "hermes-webui",
    label: "Hermes WebUI",
    defaultBaseUrl: "http://127.0.0.1:8088",
    defaultModel: "",
    requiresBaseUrl: true,
    requiresModel: false,
    requiresApiKey: false,
    supportsStreaming: true,
    supportsJsonMode: false,
    envKeyNames: [],
  },
  ollama: {
    type: "ollama",
    label: "Ollama",
    defaultBaseUrl: "http://127.0.0.1:11434/v1",
    defaultModel: "llama3.1",
    requiresBaseUrl: true,
    requiresModel: true,
    requiresApiKey: false,
    supportsStreaming: true,
    supportsJsonMode: true,
    envKeyNames: [],
  },
  "lm-studio": {
    type: "lm-studio",
    label: "LM Studio",
    defaultBaseUrl: "http://127.0.0.1:1234/v1",
    defaultModel: "local-model",
    requiresBaseUrl: true,
    requiresModel: true,
    requiresApiKey: false,
    supportsStreaming: true,
    supportsJsonMode: true,
    envKeyNames: [],
  },
  custom: {
    type: "custom",
    label: "Custom Gateway",
    defaultBaseUrl: "",
    defaultModel: "",
    requiresBaseUrl: true,
    requiresModel: true,
    requiresApiKey: false,
    supportsStreaming: true,
    supportsJsonMode: false,
    envKeyNames: [],
  },
};

const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{1,63}$/;
const METADATA_HOSTS = new Set(["169.254.169.254", "metadata.google.internal"]);

function createProviderError(code, message, statusCode = 400, details = {}) {
  const error = new Error(message || code);
  error.code = code;
  error.statusCode = statusCode;
  error.details = details && typeof details === "object" ? details : {};
  return error;
}

function listProviderTypes() {
  return Object.values(PROVIDER_TYPES).map((provider) => ({ ...provider }));
}

function getProviderType(providerType) {
  const type = String(providerType || "").trim();
  const definition = PROVIDER_TYPES[type];
  if (!definition) {
    throw createProviderError("AI_PROVIDER_TYPE_UNSUPPORTED", "AI provider type is not supported.", 400, { type });
  }
  return definition;
}

function normalizeProviderId(value) {
  const id = String(value || "").trim();
  if (!PROVIDER_ID_PATTERN.test(id)) {
    throw createProviderError("AI_PROVIDER_ID_INVALID", "AI provider id is invalid.", 400, { id });
  }
  return id;
}

function normalizeOptionalString(value, maxLength = 500) {
  const text = String(value || "").trim();
  return text.slice(0, maxLength);
}

function normalizeEnvKeyName(value) {
  const name = normalizeOptionalString(value, 100);
  if (!name) return "";
  if (!/^[A-Z_][A-Z0-9_]*$/.test(name)) {
    throw createProviderError("AI_PROVIDER_ENV_KEY_INVALID", "AI provider env key name is invalid.", 400, { name });
  }
  return name;
}

function isLoopbackHostname(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "::1" || host === "0:0:0:0:0:0:0:1" || /^127(?:\.\d{1,3}){3}$/.test(host);
}

function isMetadataHostname(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  return METADATA_HOSTS.has(host);
}

function normalizeBaseUrl(rawBaseUrl, providerType) {
  const definition = getProviderType(providerType);
  const raw = normalizeOptionalString(rawBaseUrl || definition.defaultBaseUrl || "", 500);
  if (!raw) {
    if (definition.requiresBaseUrl) {
      throw createProviderError("AI_PROVIDER_BASE_URL_REQUIRED", "AI provider baseUrl is required.", 400);
    }
    return "";
  }

  let url;
  try {
    url = new URL(raw);
  } catch {
    throw createProviderError("AI_PROVIDER_BASE_URL_INVALID", "AI provider baseUrl is invalid.", 400, { baseUrl: raw });
  }

  if (url.username || url.password) {
    throw createProviderError("AI_PROVIDER_BASE_URL_CREDENTIALS_BLOCKED", "Provider baseUrl must not contain credentials.", 400);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw createProviderError("AI_PROVIDER_BASE_URL_PROTOCOL_BLOCKED", "Provider baseUrl must use http or https.", 400);
  }
  if (isMetadataHostname(url.hostname)) {
    throw createProviderError("AI_PROVIDER_BASE_URL_METADATA_BLOCKED", "Provider baseUrl must not target metadata services.", 400);
  }
  if (url.protocol === "http:" && !isLoopbackHostname(url.hostname)) {
    throw createProviderError(
      "AI_PROVIDER_BASE_URL_HTTP_REMOTE_BLOCKED",
      "Plain http provider baseUrl is allowed only for local loopback providers.",
      400,
      { hostname: url.hostname },
    );
  }

  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/$/, "");
}

function getSecretTail(value) {
  const text = String(value || "");
  if (!text) return "";
  return text.slice(-4);
}

function resolveProviderApiKey(provider, env = process.env) {
  const envName = normalizeOptionalString(provider?.apiKeyEnvName, 100);
  const envValue = envName ? String(env?.[envName] || "") : "";
  if (envValue) {
    return {
      configured: true,
      source: "env",
      tail: getSecretTail(envValue),
      value: envValue,
    };
  }
  const stored = String(provider?.apiKey || "");
  return {
    configured: Boolean(stored),
    source: stored ? "stored" : "none",
    tail: getSecretTail(stored),
    value: stored,
  };
}

function normalizeProviderConfig(input, existing = {}) {
  const source = input && typeof input === "object" ? input : {};
  const id = normalizeProviderId(source.id || existing.id || source.providerId);
  const type = String(source.type || source.providerType || existing.type || id).trim();
  const definition = getProviderType(type);
  const enabled = typeof source.enabled === "boolean" ? source.enabled : Boolean(existing.enabled);
  const baseUrl = normalizeBaseUrl(source.baseUrl ?? existing.baseUrl ?? definition.defaultBaseUrl, definition.type);
  const model = normalizeOptionalString(source.model ?? existing.model ?? definition.defaultModel, 160);

  if (definition.requiresModel && !model) {
    throw createProviderError("AI_PROVIDER_MODEL_REQUIRED", "AI provider model is required.", 400, { id, type });
  }

  const apiKeyEnvName = normalizeEnvKeyName(source.apiKeyEnvName ?? existing.apiKeyEnvName ?? definition.envKeyNames[0] ?? "");
  let apiKey = String(existing.apiKey || "");
  if (source.clearApiKey === true) {
    apiKey = "";
  } else if (typeof source.apiKey === "string" && source.apiKey.trim()) {
    apiKey = source.apiKey.trim();
  }

  return {
    id,
    type: definition.type,
    enabled,
    baseUrl,
    model,
    apiKey,
    apiKeyEnvName,
    apiKeyTail: getSecretTail(apiKey),
    updatedAt: new Date().toISOString(),
  };
}

function sanitizeProviderConfig(provider, env = process.env) {
  const source = provider && typeof provider === "object" ? provider : {};
  const definition = getProviderType(source.type || "custom");
  const apiKey = resolveProviderApiKey(source, env);
  return {
    id: source.id,
    type: definition.type,
    label: definition.label,
    enabled: Boolean(source.enabled),
    baseUrl: normalizeOptionalString(source.baseUrl, 500),
    model: normalizeOptionalString(source.model, 160),
    requiresApiKey: Boolean(definition.requiresApiKey),
    apiKeyConfigured: Boolean(apiKey.configured),
    apiKeySource: apiKey.source,
    apiKeyTail: apiKey.tail,
    apiKeyEnvName: normalizeOptionalString(source.apiKeyEnvName, 100),
    supportsStreaming: Boolean(definition.supportsStreaming),
    supportsJsonMode: Boolean(definition.supportsJsonMode),
    updatedAt: normalizeOptionalString(source.updatedAt, 80),
  };
}

function buildProviderDiagnostics(provider, env = process.env) {
  const diagnostics = [];
  const definition = getProviderType(provider?.type || "custom");
  const apiKey = resolveProviderApiKey(provider, env);

  if (!provider?.enabled) {
    diagnostics.push({ code: "AI_PROVIDER_DISABLED", severity: "info", message: "Provider is saved but disabled." });
  }
  if (definition.requiresBaseUrl && !normalizeOptionalString(provider?.baseUrl)) {
    diagnostics.push({ code: "AI_PROVIDER_BASE_URL_REQUIRED", severity: "error", message: "Provider baseUrl is required." });
  }
  if (definition.requiresModel && !normalizeOptionalString(provider?.model)) {
    diagnostics.push({ code: "AI_PROVIDER_MODEL_REQUIRED", severity: "error", message: "Provider model is required." });
  }
  if (definition.requiresApiKey && !apiKey.configured) {
    diagnostics.push({ code: "AI_PROVIDER_API_KEY_REQUIRED", severity: "error", message: "Provider API key is required." });
  }

  return diagnostics;
}

function buildProviderHealth(provider, env = process.env) {
  const sanitized = sanitizeProviderConfig(provider, env);
  const diagnostics = buildProviderDiagnostics(provider, env);
  const hasBlockingError = diagnostics.some((item) => item.severity === "error");
  return {
    ok: !hasBlockingError,
    provider: sanitized,
    diagnostics,
    networkTested: false,
  };
}

async function testProviderConnection(provider, options = {}) {
  const env = options.env || process.env;
  const performNetworkCheck = options.performNetworkCheck === true;
  const baseHealth = buildProviderHealth(provider, env);
  if (!performNetworkCheck || !baseHealth.ok) return baseHealth;

  if (typeof options.fetchImpl !== "function" && typeof fetch !== "function") {
    return {
      ...baseHealth,
      ok: false,
      diagnostics: [
        ...baseHealth.diagnostics,
        { code: "AI_PROVIDER_FETCH_UNAVAILABLE", severity: "error", message: "Fetch API is unavailable in this runtime." },
      ],
      networkTested: false,
    };
  }

  const fetchImpl = options.fetchImpl || fetch;
  const apiKey = resolveProviderApiKey(provider, env);
  const timeoutMs = Number.isInteger(options.timeoutMs) ? options.timeoutMs : 8000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const modelsUrl = `${String(provider.baseUrl || "").replace(/\/$/, "")}/models`;
    const headers = {};
    if (apiKey.value) headers.Authorization = `Bearer ${apiKey.value}`;
    const response = await fetchImpl(modelsUrl, {
      method: "GET",
      headers,
      signal: controller.signal,
    });
    return {
      ...baseHealth,
      ok: response.status >= 200 && response.status < 500,
      diagnostics: [
        ...baseHealth.diagnostics,
        {
          code: response.ok ? "AI_PROVIDER_NETWORK_OK" : "AI_PROVIDER_NETWORK_HTTP_STATUS",
          severity: response.ok ? "info" : "warning",
          message: `Provider /models returned HTTP ${response.status}.`,
        },
      ],
      networkTested: true,
      httpStatus: response.status,
    };
  } catch (error) {
    return {
      ...baseHealth,
      ok: false,
      diagnostics: [
        ...baseHealth.diagnostics,
        {
          code: error?.name === "AbortError" ? "AI_PROVIDER_NETWORK_TIMEOUT" : "AI_PROVIDER_NETWORK_FAILED",
          severity: "error",
          message: error instanceof Error ? error.message : "Provider network check failed.",
        },
      ],
      networkTested: true,
    };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  AI_CONFIG_SCHEMA,
  PROVIDER_TYPES,
  buildProviderDiagnostics,
  buildProviderHealth,
  createProviderError,
  getProviderType,
  listProviderTypes,
  normalizeBaseUrl,
  normalizeProviderConfig,
  normalizeProviderId,
  resolveProviderApiKey,
  sanitizeProviderConfig,
  testProviderConnection,
};
