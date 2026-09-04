"use strict";

const AI_PROVIDER_STAGE_POLICY_SCHEMA = "guanshi-ai-provider-stage-policy-v1";

const STAGE_POLICIES = Object.freeze({
  planner: Object.freeze({
    stage: "planner",
    maxTokens: 2000,
    temperature: 0.1,
    thinking: "disabled",
    reasoningEffort: "low",
    responseFormat: "json_object",
    timeoutMs: 30000,
    idleTimeoutMs: 0,
    maxRetries: 1,
  }),
  answer_writer: Object.freeze({
    stage: "answer_writer",
    maxTokens: 2400,
    temperature: 0.4,
    thinking: "disabled",
    reasoningEffort: "low",
    responseFormat: "text",
    timeoutMs: 60000,
    idleTimeoutMs: 20000,
    maxRetries: 0,
  }),
  liuyao_writer: Object.freeze({
    stage: "liuyao_writer",
    maxTokens: 4000,
    temperature: 0.35,
    thinking: "enabled",
    reasoningEffort: "low",
    responseFormat: "json_object",
    timeoutMs: 60000,
    idleTimeoutMs: 0,
    maxRetries: 1,
  }),
  chat: Object.freeze({
    stage: "chat",
    maxTokens: 2400,
    temperature: 0.4,
    thinking: "disabled",
    reasoningEffort: "low",
    responseFormat: "text",
    timeoutMs: 60000,
    idleTimeoutMs: 20000,
    maxRetries: 0,
  }),
});

function normalizeInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  const resolved = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(min, Math.min(max, resolved));
}

function getProviderStagePolicy(stage, overrides = {}) {
  const key = String(stage || "chat").trim();
  const base = STAGE_POLICIES[key] || STAGE_POLICIES.chat;
  const source = overrides && typeof overrides === "object" ? overrides : {};
  return {
    schema: AI_PROVIDER_STAGE_POLICY_SCHEMA,
    ...base,
    maxTokens: normalizeInteger(source.maxTokens, base.maxTokens, 1, 8000),
    timeoutMs: normalizeInteger(source.timeoutMs, base.timeoutMs, 1000, 300000),
    idleTimeoutMs: normalizeInteger(source.idleTimeoutMs, base.idleTimeoutMs, 0, 120000),
    maxRetries: normalizeInteger(source.maxRetries, base.maxRetries, 0, 1),
    ...(typeof source.temperature === "number" ? { temperature: Math.max(0, Math.min(2, source.temperature)) } : {}),
    ...(source.thinking ? { thinking: source.thinking } : {}),
    ...(source.reasoningEffort ? { reasoningEffort: source.reasoningEffort } : {}),
    ...(source.responseFormat ? { responseFormat: source.responseFormat } : {}),
  };
}

function getProviderStageAttemptPolicy(stage, attempt = 1, overrides = {}) {
  const policy = getProviderStagePolicy(stage, overrides);
  const attemptNumber = normalizeInteger(attempt, 1, 1, 2);
  if (policy.stage === "liuyao_writer" && attemptNumber > 1) {
    return {
      ...policy,
      thinking: "disabled",
      timeoutMs: Math.min(policy.timeoutMs, 45000),
    };
  }
  return policy;
}

function shouldRetryProviderError(error) {
  const code = String(error?.code || "");
  const status = Number(error?.details?.httpStatus || error?.statusCode || 0);
  if (code === "AI_PROVIDER_REQUEST_ABORTED") return false;
  if (code === "AI_PROVIDER_REQUEST_TIMEOUT" || code === "AI_PROVIDER_STREAM_IDLE_TIMEOUT") return true;
  if (status === 429 || status >= 500) return true;
  return code === "AI_PROVIDER_INSUFFICIENT_SYSTEM_RESOURCE";
}

module.exports = {
  AI_PROVIDER_STAGE_POLICY_SCHEMA,
  getProviderStageAttemptPolicy,
  getProviderStagePolicy,
  shouldRetryProviderError,
};
