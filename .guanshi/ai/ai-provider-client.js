"use strict";

const { TextDecoder } = require("util");

const {
  buildProviderHealth,
  createProviderError,
  resolveProviderApiKey,
} = require("./ai-provider-registry");
const { redactSensitiveValue } = require("./ai-redaction");

const CHAT_BODY_MAX_MESSAGES = 24;
const CHAT_BODY_MAX_TEXT_LENGTH = 12000;

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
    throw createProviderError("AI_CHAT_MESSAGE_TOO_LONG", "AI chat message content is too long.", 400, { label });
  }
  return text;
}

function normalizeChatMessages(input = {}) {
  if (Array.isArray(input.messages)) {
    const messages = input.messages.slice(0, CHAT_BODY_MAX_MESSAGES).map((message, index) => ({
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

function buildResponseTrace(response, payload = null, rawText = "", extra = {}) {
  return redactSensitiveValue({
    schema: extra.schema || "guanshi-ai-provider-response-trace-v1",
    httpStatus: Number(response?.status || 0) || 0,
    ok: response?.ok === true,
    headers: collectResponseHeaders(response),
    bodyText: rawText,
    parsedBody: payload,
    ...extra,
  }, { maxStringLength: 60000 });
}

function normalizeNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
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
    return {
      providerType: provider.type,
      url: getOpenAiCompatibleUrl(provider),
      headers,
      body: {
        model: provider.model,
        messages,
        temperature,
        stream,
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
  const response = await fetchImpl(chatRequest.url, {
    method: "POST",
    headers: chatRequest.headers,
    body: requestBodyText,
  });
  return {
    chatRequest: {
      providerType: chatRequest.providerType,
      url: chatRequest.url,
      stream: chatRequest.body.stream,
    },
    requestTrace: buildRequestTrace(chatRequest, requestBodyText),
    response,
  };
}

async function streamProviderChatText(provider, input = {}, options = {}) {
  const { chatRequest, requestTrace, response } = await fetchProviderChat(provider, input, {
    env: options.env || process.env,
    fetchImpl: options.fetchImpl,
    allowExternalRequest: options.allowExternalRequest === true,
    stream: true,
  });

  if (!response.ok) {
    let body = "";
    try {
      body = (await response.text()).slice(0, 2000);
    } catch {
      body = "";
    }
    throw createProviderError("AI_PROVIDER_STREAM_HTTP_STATUS", "AI provider stream request failed.", 502, {
      httpStatus: response.status,
      body,
    });
  }

  const onDelta = typeof options.onDelta === "function" ? options.onDelta : () => {};
  const deltas = [];
  const rawChunks = [];

  function emitDelta(delta) {
    const text = normalizeStreamDelta(delta);
    if (!text) return;
    deltas.push(text);
    onDelta(text);
  }

  if (!response.body || typeof response.body.getReader !== "function") {
    const rawText = await response.text();
    rawChunks.push(rawText);
    let payload = rawText;
    try {
      payload = JSON.parse(rawText);
    } catch {
      payload = rawText;
    }
    emitDelta(extractProviderFullText(payload) || rawText);
    return {
      chatRequest,
      requestTrace,
      responseTrace: buildResponseTrace(response, payload, rawText, {
        schema: "guanshi-ai-provider-stream-response-trace-v1",
        parsedDeltas: deltas.map((delta, index) => ({ index: index + 1, delta })),
        rawChunks: rawChunks.map((chunk, index) => ({ index: index + 1, text: chunk })),
      }),
      text: deltas.join(""),
      deltas,
    };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      const rawChunk = decoder.decode(next.value || Buffer.alloc(0), { stream: true });
      rawChunks.push(rawChunk);
      buffer += rawChunk;
      const parsed = parseSseOrJsonFrames(buffer);
      buffer = parsed.buffer;
      for (const frame of parsed.frames) {
        for (const payload of parseStreamFramePayloads(frame)) {
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
      emitDelta(extractStreamTextDelta(chatRequest.providerType, payload));
    }
  } finally {
    if (typeof reader.releaseLock === "function") reader.releaseLock();
  }

  return {
    chatRequest,
    requestTrace,
    responseTrace: buildResponseTrace(response, null, "", {
      schema: "guanshi-ai-provider-stream-response-trace-v1",
      parsedDeltas: deltas.map((delta, index) => ({ index: index + 1, delta })),
      rawChunks: rawChunks.map((chunk, index) => ({ index: index + 1, text: chunk })),
    }),
    text: deltas.join(""),
    deltas,
  };
}

module.exports = {
  buildProviderChatRequest,
  fetchProviderChat,
  streamProviderChatText,
  normalizeChatMessages,
};
