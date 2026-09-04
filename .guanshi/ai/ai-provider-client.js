"use strict";

const crypto = require("crypto");
const { TextDecoder } = require("util");

const {
  buildProviderHealth,
  createProviderError,
  resolveProviderCapabilities,
  resolveProviderApiKey,
} = require("./ai-provider-registry");
const { redactSensitiveValue } = require("./ai-redaction");

const CHAT_BODY_MAX_MESSAGES = 24;
const CHAT_BODY_MAX_TEXT_LENGTH = 50000;
const AI_PROVIDER_COMPLETION_SCHEMA = "guanshi-ai-provider-completion-v1";

function normalizeMessageRole(role) {
  const value = String(role || "").trim();
  if (value === "system" || value === "user" || value === "assistant") return value;
  throw createProviderError("AI_CHAT_MESSAGE_ROLE_INVALID", "AI chat message role is invalid.", 400, { role: value });
}

function normalizeChatText(value, label) {
  const text = String(value || "").trim();
  if (!text) {
    throw createProviderError("AI_CHAT_MESSAGE_EMPTY", "AI chat message content is required.", 400, { label });
  }
  if (text.length > CHAT_BODY_MAX_TEXT_LENGTH) {
    throw createProviderError("AI_CHAT_MESSAGE_TOO_LONG", "AI chat message content is too long.", 400, {
      label,
      length: text.length,
      maxLength: CHAT_BODY_MAX_TEXT_LENGTH,
    });
  }
  return text;
}

function normalizeChatMessages(input = {}) {
  if (Array.isArray(input.messages)) {
    const sourceMessages = input.messages.length <= CHAT_BODY_MAX_MESSAGES
      ? input.messages
      : input.messages[0]?.role === "system"
        ? [input.messages[0], ...input.messages.slice(-(CHAT_BODY_MAX_MESSAGES - 1))]
        : input.messages.slice(-CHAT_BODY_MAX_MESSAGES);
    const messages = sourceMessages.map((message, index) => ({
      role: normalizeMessageRole(message?.role),
      content: normalizeChatText(message?.content, `messages[${index}].content`),
    }));
    if (!messages.length) {
      throw createProviderError("AI_CHAT_MESSAGES_REQUIRED", "AI chat messages are required.", 400);
    }
    return messages;
  }

  return [
    {
      role: "user",
      content: normalizeChatText(input.text, "text"),
    },
  ];
}

function collectResponseHeaders(response) {
  const headers = response?.headers;
  if (!headers) return {};
  if (typeof headers.entries === "function") {
    return Object.fromEntries(Array.from(headers.entries()));
  }
  if (typeof headers.forEach === "function") {
    const result = {};
    headers.forEach((value, key) => {
      result[key] = value;
    });
    return result;
  }
  return {};
}

function buildRequestTrace(chatRequest, requestBodyText) {
  return redactSensitiveValue({
    schema: "guanshi-ai-provider-request-trace-v1",
    method: "POST",
    providerType: chatRequest.providerType,
    url: chatRequest.url,
    headers: chatRequest.headers || {},
    bodyText: requestBodyText,
    body: chatRequest.body || {},
    note: "Headers are recorded after redaction; Authorization/x-api-key values are never exposed.",
  }, { maxStringLength: 60000 });
}

function hashTraceText(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function summarizeReasoningForTrace(value) {
  if (typeof value === "string") {
    return {
      omitted: true,
      charCount: value.length,
      sha256: hashTraceText(value),
    };
  }
  if (Array.isArray(value)) {
    const serialized = JSON.stringify(value);
    return {
      omitted: true,
      itemCount: value.length,
      charCount: serialized.length,
      sha256: hashTraceText(serialized),
    };
  }
  return value;
}

function sanitizeProviderPayloadForTrace(value, key = "", depth = 0) {
  if (depth > 12) return "[trace depth omitted]";
  if (/reasoning[_-]?content|reasoningContent/i.test(key)) return summarizeReasoningForTrace(value);
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeProviderPayloadForTrace(item, "", depth + 1));
  }
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [
    childKey,
    sanitizeProviderPayloadForTrace(childValue, childKey, depth + 1),
  ]));
}

function summarizeRawChunksForTrace(rawChunks) {
  return rawChunks.map((chunk, index) => ({
    index: index + 1,
    charCount: String(chunk || "").length,
    sha256: hashTraceText(chunk),
  }));
}

function buildResponseTrace(response, payload = null, rawText = "", extra = {}) {
  const safePayload = sanitizeProviderPayloadForTrace(payload);
  const safeExtra = sanitizeProviderPayloadForTrace(extra);
  const safeBodyText = payload && typeof payload === "object"
    ? JSON.stringify(safePayload)
    : rawText;
  return redactSensitiveValue({
    schema: extra.schema || "guanshi-ai-provider-response-trace-v1",
    httpStatus: Number(response?.status || 0) || 0,
    ok: response?.ok === true,
    headers: collectResponseHeaders(response),
    bodyText: safeBodyText,
    parsedBody: safePayload,
    ...safeExtra,
  }, { maxStringLength: 60000 });
}

function normalizeNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function normalizeProviderFinishReason(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "unknown";
  if (["stop", "end_turn", "stop_sequence", "completed"].includes(raw)) return "stop";
  if (["length", "max_tokens", "model_context_window_exceeded"].includes(raw)) return "length";
  if (["content_filter", "safety", "refusal"].includes(raw)) return "content_filter";
  if (["tool_calls", "tool_use"].includes(raw)) return "tool_calls";
  if (["insufficient_system_resource", "overloaded"].includes(raw)) return "insufficient_system_resource";
  return raw;
}

function extractProviderFinishReason(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "";
  const choice = Array.isArray(payload.choices) ? payload.choices[0] : null;
  return choice?.finish_reason
    || choice?.finishReason
    || payload.stop_reason
    || payload.stopReason
    || payload.delta?.stop_reason
    || payload.delta?.stopReason
    || payload.finish_reason
    || payload.finishReason
    || "";
}

function normalizeProviderUsage(payload) {
  const usage = payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload.usage && typeof payload.usage === "object" ? payload.usage : {})
    : {};
  const details = usage.completion_tokens_details && typeof usage.completion_tokens_details === "object"
    ? usage.completion_tokens_details
    : {};
  const promptTokens = Math.max(0, Number(usage.prompt_tokens ?? usage.input_tokens ?? 0) || 0);
  const completionTokens = Math.max(0, Number(usage.completion_tokens ?? usage.output_tokens ?? 0) || 0);
  const reasoningTokens = Math.max(0, Number(details.reasoning_tokens ?? usage.reasoning_tokens ?? 0) || 0);
  const totalTokens = Math.max(0, Number(usage.total_tokens ?? (promptTokens + completionTokens)) || 0);
  return { promptTokens, completionTokens, reasoningTokens, totalTokens };
}

function normalizeProviderCompletionMeta(provider, payload, options = {}) {
  const capabilities = resolveProviderCapabilities(provider);
  const rawFinishReason = extractProviderFinishReason(payload);
  const finishReason = normalizeProviderFinishReason(rawFinishReason);
  const usage = normalizeProviderUsage(payload);
  const hasContent = options.hasContent === true || Boolean(String(extractProviderFullText(payload) || "").trim());
  const complete = finishReason === "stop"
    || (finishReason === "unknown" && capabilities.requiresFinishReason !== true && hasContent);
  return {
    schema: AI_PROVIDER_COMPLETION_SCHEMA,
    providerFamily: capabilities.providerFamily,
    finishReason,
    rawFinishReason: String(rawFinishReason || ""),
    complete,
    truncated: finishReason === "length",
    interrupted: ["content_filter", "insufficient_system_resource"].includes(finishReason),
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    reasoningTokens: usage.reasoningTokens,
    totalTokens: usage.totalTokens,
    retryCount: Math.max(0, Number(options.retryCount || 0) || 0),
    durationMs: Math.max(0, Number(options.durationMs || 0) || 0),
    timeToFirstTokenMs: Math.max(0, Number(options.timeToFirstTokenMs || 0) || 0),
    requiresFinishReason: capabilities.requiresFinishReason === true,
  };
}

function createRequestAbortContext(options = {}) {
  const controller = new AbortController();
  const timeoutMs = Math.round(normalizeNumber(options.timeoutMs, 60000, 10, 300000));
  const externalSignal = options.signal;
  let abortError = null;
  let timer = null;
  let cleaned = false;
  let rejectAbort = null;
  const abortPromise = new Promise((resolve, reject) => {
    rejectAbort = reject;
  });
  // Promise.race always installs a rejection handler; keep this branch pending until abort.
  void abortPromise.catch(() => {});

  function abort(error) {
    if (abortError) return;
    abortError = error || createProviderError("AI_PROVIDER_REQUEST_ABORTED", "AI provider request was cancelled.", 499);
    try {
      controller.abort(abortError);
    } catch {
      controller.abort();
    }
    rejectAbort(abortError);
  }

  function onExternalAbort() {
    abort(createProviderError("AI_PROVIDER_REQUEST_ABORTED", "AI provider request was cancelled.", 499));
  }

  if (externalSignal?.aborted) onExternalAbort();
  else externalSignal?.addEventListener?.("abort", onExternalAbort, { once: true });
  timer = setTimeout(() => {
    abort(createProviderError("AI_PROVIDER_REQUEST_TIMEOUT", "AI provider request timed out.", 504, { timeoutMs }));
  }, timeoutMs);

  return {
    signal: controller.signal,
    timeoutMs,
    abortPromise,
    abort,
    get error() {
      return abortError;
    },
    cleanup() {
      if (cleaned) return;
      cleaned = true;
      clearTimeout(timer);
      externalSignal?.removeEventListener?.("abort", onExternalAbort);
    },
  };
}

async function runAbortable(operation, abortContext) {
  try {
    return await Promise.race([Promise.resolve(operation), abortContext.abortPromise]);
  } catch (error) {
    if (abortContext.error) throw abortContext.error;
    if (error?.name === "AbortError") {
      throw createProviderError("AI_PROVIDER_REQUEST_ABORTED", "AI provider request was cancelled.", 499);
    }
    throw error;
  }
}

async function readStreamChunk(reader, abortContext, idleTimeoutMs = 0) {
  if (!(idleTimeoutMs > 0)) return runAbortable(reader.read(), abortContext);
  let timer = null;
  const idlePromise = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      const error = createProviderError(
        "AI_PROVIDER_STREAM_IDLE_TIMEOUT",
        "AI provider stream stopped producing data.",
        504,
        { idleTimeoutMs },
      );
      abortContext.abort(error);
      reject(error);
    }, idleTimeoutMs);
  });
  try {
    return await Promise.race([runAbortable(reader.read(), abortContext), idlePromise]);
  } finally {
    clearTimeout(timer);
  }
}

function getOpenAiCompatibleUrl(provider) {
  return `${String(provider.baseUrl || "").replace(/\/$/, "")}/chat/completions`;
}

function getAnthropicUrl(provider) {
  return `${String(provider.baseUrl || "").replace(/\/$/, "")}/v1/messages`;
}

function splitAnthropicMessages(messages) {
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  const conversation = messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role === "assistant" ? "assistant" : "user",
      content: message.content,
    }));
  return { system, messages: conversation };
}

function normalizeStreamDelta(value) {
  return String(value || "");
}

function extractProviderFullText(payload) {
  if (typeof payload === "string") return payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "";
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const choiceText = choices
    .map((choice) => (
      choice?.delta?.content ||
      choice?.delta?.text ||
      choice?.message?.content ||
      choice?.text ||
      ""
    ))
    .filter(Boolean)
    .join("");
  if (choiceText) return choiceText;
  if (Array.isArray(payload.content)) {
    return payload.content
      .map((item) => (typeof item === "string" ? item : item?.text || ""))
      .filter(Boolean)
      .join("");
  }
  return payload.output_text || payload.response || payload.message?.content || payload.delta?.text || payload.delta?.content || "";
}

function extractStreamTextDelta(providerType, payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "";
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const choiceText = choices
    .map((choice) => (
      choice?.delta?.content ||
      choice?.delta?.text ||
      choice?.message?.content ||
      choice?.text ||
      ""
    ))
    .filter(Boolean)
    .join("");
  if (choiceText) return choiceText;

  if (providerType === "anthropic") {
    if (payload.type === "content_block_delta" && payload.delta?.text) return payload.delta.text;
    if (payload.type === "content_block_start" && payload.content_block?.text) return payload.content_block.text;
  }

  if (Array.isArray(payload.content)) {
    return payload.content
      .map((item) => (typeof item === "string" ? item : item?.text || ""))
      .filter(Boolean)
      .join("");
  }

  return payload.delta?.text || payload.delta?.content || payload.output_text || payload.response || "";
}

function parseSseOrJsonFrames(buffer) {
  const frames = [];
  let nextBuffer = buffer;
  if (nextBuffer.includes("\n\n")) {
    const parts = nextBuffer.split(/\n\n/);
    nextBuffer = parts.pop() || "";
    frames.push(...parts);
    return { frames, buffer: nextBuffer };
  }
  const lines = nextBuffer.split(/\r?\n/);
  nextBuffer = lines.pop() || "";
  frames.push(...lines.filter((line) => line.trim().startsWith("{") || line.trim().startsWith("data:")));
  return { frames, buffer: nextBuffer };
}

function parseStreamFramePayloads(frame) {
  const text = String(frame || "").trim();
  if (!text || text.startsWith(":")) return [];
  const dataLines = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    } else if (line.trim().startsWith("{")) {
      dataLines.push(line.trim());
    }
  }
  return dataLines
    .map((line) => line.trim())
    .filter((line) => line && line !== "[DONE]")
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function buildProviderChatRequest(provider, input = {}, options = {}) {
  const health = buildProviderHealth(provider, options.env || process.env);
  if (!health.ok) {
    throw createProviderError("AI_PROVIDER_NOT_READY", "AI provider is not ready.", 409, { diagnostics: health.diagnostics });
  }
  if (!provider.enabled) {
    throw createProviderError("AI_PROVIDER_DISABLED", "AI provider is disabled.", 409);
  }

  const messages = normalizeChatMessages(input);
  const stream = options.stream === true;
  const apiKey = resolveProviderApiKey(provider, options.env || process.env);
  const temperature = normalizeNumber(input.temperature, 0.2, 0, 2);
  const maxTokens = Math.round(normalizeNumber(input.maxTokens, 1200, 1, 8000));
  const capabilities = resolveProviderCapabilities(provider);

  if (provider.type === "anthropic") {
    const anthropicMessages = splitAnthropicMessages(messages);
    const headers = {
      "content-type": "application/json",
      "anthropic-version": "2023-06-01",
    };
    if (apiKey.value) headers["x-api-key"] = apiKey.value;
    return {
      providerType: provider.type,
      url: getAnthropicUrl(provider),
      headers,
      body: {
        model: provider.model,
        max_tokens: maxTokens,
        temperature,
        stream,
        ...(anthropicMessages.system ? { system: anthropicMessages.system } : {}),
        messages: anthropicMessages.messages,
      },
    };
  }

  if (
    provider.type === "openai-compatible"
    || provider.type === "ollama"
    || provider.type === "lm-studio"
    || provider.type === "custom"
  ) {
    const headers = { "content-type": "application/json" };
    if (apiKey.value) headers.authorization = `Bearer ${apiKey.value}`;
    const outputLimit = capabilities.outputLimitField
      ? { [capabilities.outputLimitField]: maxTokens }
      : {};
    const thinking = capabilities.supportsThinkingControl && ["enabled", "disabled"].includes(input.thinking)
      ? { thinking: { type: input.thinking } }
      : {};
    const reasoningEffort = capabilities.supportsReasoningEffort && ["low", "high", "max"].includes(input.reasoningEffort)
      ? { reasoning_effort: input.reasoningEffort }
      : {};
    const responseFormat = input.responseFormat === "json_object"
      && capabilities.supportsJsonMode
      && capabilities.jsonModeFormat === "openai"
      ? { response_format: { type: "json_object" } }
      : {};
    return {
      providerType: provider.type,
      url: getOpenAiCompatibleUrl(provider),
      headers,
      body: {
        model: provider.model,
        messages,
        temperature,
        stream,
        ...outputLimit,
        ...thinking,
        ...reasoningEffort,
        ...responseFormat,
      },
    };
  }

  throw createProviderError(
    "AI_PROVIDER_CHAT_UNSUPPORTED",
    "This provider does not support direct chat calls in v1.5.15.",
    400,
    { type: provider.type },
  );
}

async function fetchProviderChat(provider, input = {}, options = {}) {
  if (options.allowExternalRequest !== true) {
    throw createProviderError("AI_EXTERNAL_REQUEST_NOT_CONFIRMED", "External AI request requires explicit confirmation.", 409);
  }
  const fetchImpl = options.fetchImpl || (typeof fetch === "function" ? fetch : null);
  if (typeof fetchImpl !== "function") {
    throw createProviderError("AI_PROVIDER_FETCH_UNAVAILABLE", "Fetch API is unavailable in this runtime.", 500);
  }

  const chatRequest = buildProviderChatRequest(provider, input, {
    env: options.env || process.env,
    stream: options.stream === true,
  });
  const requestBodyText = JSON.stringify(chatRequest.body);
  const abortContext = createRequestAbortContext({
    signal: options.signal,
    timeoutMs: options.timeoutMs,
  });
  const startedAt = Date.now();
  try {
    const response = await runAbortable(fetchImpl(chatRequest.url, {
      method: "POST",
      headers: chatRequest.headers,
      body: requestBodyText,
      signal: abortContext.signal,
    }), abortContext);
    const result = {
      chatRequest: {
        providerType: chatRequest.providerType,
        url: chatRequest.url,
        stream: chatRequest.body.stream,
      },
      requestTrace: buildRequestTrace(chatRequest, requestBodyText),
      response,
      startedAt,
    };
    if (options.holdSignalUntilConsumed === true) {
      result.abortContext = abortContext;
    } else {
      abortContext.cleanup();
    }
    return result;
  } catch (error) {
    abortContext.cleanup();
    throw error;
  }
}

async function fetchProviderChatCompletion(provider, input = {}, options = {}) {
  const providerResult = await fetchProviderChat(provider, input, {
    ...options,
    stream: false,
    holdSignalUntilConsumed: true,
  });
  const { abortContext, response } = providerResult;
  try {
    const rawText = await runAbortable(response.text(), abortContext);
    let payload = rawText;
    try {
      payload = JSON.parse(rawText);
    } catch {
      payload = rawText;
    }
    const durationMs = Date.now() - providerResult.startedAt;
    return {
      ...providerResult,
      payload,
      rawText,
      responseTrace: buildResponseTrace(response, payload, rawText),
      completionMeta: normalizeProviderCompletionMeta(provider, payload, {
        hasContent: Boolean(String(extractProviderFullText(payload) || rawText).trim()),
        retryCount: options.retryCount,
        durationMs,
        timeToFirstTokenMs: durationMs,
      }),
    };
  } finally {
    abortContext.cleanup();
  }
}

async function streamProviderChatText(provider, input = {}, options = {}) {
  const providerResult = await fetchProviderChat(provider, input, {
    env: options.env || process.env,
    fetchImpl: options.fetchImpl,
    allowExternalRequest: options.allowExternalRequest === true,
    stream: true,
    signal: options.signal,
    timeoutMs: options.timeoutMs,
    holdSignalUntilConsumed: true,
  });
  const { chatRequest, requestTrace, response, abortContext, startedAt } = providerResult;

  if (!response.ok) {
    let body = "";
    try {
      body = (await runAbortable(response.text(), abortContext)).slice(0, 2000);
    } catch {
      body = "";
    } finally {
      abortContext.cleanup();
    }
    throw createProviderError("AI_PROVIDER_STREAM_HTTP_STATUS", "AI provider stream request failed.", 502, {
      httpStatus: response.status,
      body,
    });
  }

  const onDelta = typeof options.onDelta === "function" ? options.onDelta : () => {};
  const deltas = [];
  const rawChunks = [];
  const completionPayloads = [];
  let firstTokenAt = 0;

  function emitDelta(delta) {
    const text = normalizeStreamDelta(delta);
    if (!text) return;
    if (!firstTokenAt) firstTokenAt = Date.now();
    deltas.push(text);
    onDelta(text);
  }

  if (!response.body || typeof response.body.getReader !== "function") {
    try {
      const rawText = await runAbortable(response.text(), abortContext);
      rawChunks.push(rawText);
      let payload = rawText;
      try {
        payload = JSON.parse(rawText);
      } catch {
        payload = rawText;
      }
      emitDelta(extractProviderFullText(payload) || rawText);
      const durationMs = Date.now() - startedAt;
      return {
        chatRequest,
        requestTrace,
        responseTrace: buildResponseTrace(response, payload, rawText, {
          schema: "guanshi-ai-provider-stream-response-trace-v1",
          parsedDeltas: deltas.map((delta, index) => ({ index: index + 1, delta })),
          rawChunks: summarizeRawChunksForTrace(rawChunks),
        }),
        completionMeta: normalizeProviderCompletionMeta(provider, payload, {
          hasContent: deltas.join("").trim().length > 0,
          retryCount: options.retryCount,
          durationMs,
          timeToFirstTokenMs: firstTokenAt ? firstTokenAt - startedAt : durationMs,
        }),
        text: deltas.join(""),
        deltas,
      };
    } finally {
      abortContext.cleanup();
    }
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  try {
    while (true) {
      const next = await readStreamChunk(reader, abortContext, Number(options.idleTimeoutMs || 0));
      if (next.done) break;
      const rawChunk = decoder.decode(next.value || Buffer.alloc(0), { stream: true });
      rawChunks.push(rawChunk);
      buffer += rawChunk;
      const parsed = parseSseOrJsonFrames(buffer);
      buffer = parsed.buffer;
      for (const frame of parsed.frames) {
        for (const payload of parseStreamFramePayloads(frame)) {
          completionPayloads.push(payload);
          emitDelta(extractStreamTextDelta(chatRequest.providerType, payload));
        }
      }
    }
    const flushChunk = decoder.decode();
    if (flushChunk) {
      rawChunks.push(flushChunk);
      buffer += flushChunk;
    }
    for (const payload of parseStreamFramePayloads(buffer)) {
      completionPayloads.push(payload);
      emitDelta(extractStreamTextDelta(chatRequest.providerType, payload));
    }
  } catch (error) {
    try {
      await reader.cancel?.();
    } catch {
      // Ignore cleanup failure; preserve the original timeout/cancel error.
    }
    throw error;
  } finally {
    if (typeof reader.releaseLock === "function") reader.releaseLock();
    abortContext.cleanup();
  }

  const reverseCompletionPayloads = [...completionPayloads].reverse();
  const finishPayload = reverseCompletionPayloads.find((payload) => extractProviderFinishReason(payload)) || {};
  const usagePayload = reverseCompletionPayloads.find((payload) => payload?.usage && typeof payload.usage === "object") || {};
  const completionPayload = {
    ...finishPayload,
    ...(usagePayload.usage ? { usage: usagePayload.usage } : {}),
  };
  const durationMs = Date.now() - startedAt;
  return {
    chatRequest,
    requestTrace,
    responseTrace: buildResponseTrace(response, null, "", {
      schema: "guanshi-ai-provider-stream-response-trace-v1",
      parsedDeltas: deltas.map((delta, index) => ({ index: index + 1, delta })),
      rawChunks: summarizeRawChunksForTrace(rawChunks),
    }),
    completionMeta: normalizeProviderCompletionMeta(provider, completionPayload, {
      hasContent: deltas.join("").trim().length > 0,
      retryCount: options.retryCount,
      durationMs,
      timeToFirstTokenMs: firstTokenAt ? firstTokenAt - startedAt : durationMs,
    }),
    text: deltas.join(""),
    deltas,
  };
}

module.exports = {
  AI_PROVIDER_COMPLETION_SCHEMA,
  buildProviderChatRequest,
  fetchProviderChat,
  fetchProviderChatCompletion,
  normalizeProviderCompletionMeta,
  streamProviderChatText,
  normalizeChatMessages,
};
