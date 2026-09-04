"use strict";

const AI_ACTION_REVIEW_SCHEMA = "guanshi-ai-action-review-v1";

function normalizeText(value, maxLength = 4000) {
  return String(value || "").trim().slice(0, maxLength);
}

function normalizeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeStringList(value, maxItems = 8, maxLength = 160) {
  const source = Array.isArray(value)
    ? value
    : typeof value === "string" && value.trim()
      ? [value]
      : [];
  return Array.from(new Set(source.map((item) => normalizeText(item, maxLength)).filter(Boolean))).slice(0, maxItems);
}

function inferToolMode(tool = {}) {
  const source = normalizeObject(tool);
  const explicit = normalizeText(source.mode || source.toolMode, 40);
  if (explicit) return explicit;
  const name = normalizeText(source.tool_id || source.toolId || source.name || source.tool, 160);
  const scopes = normalizeStringList(source.scopes || source.scope, 12, 80).join(" ");
  if (source.disabled === true || /apply_draft|apply_without/.test(name)) return "disabled";
  if (/^(guanshi\.)?(get|list|read)_/.test(name) || /\bread_/.test(scopes)) return "read";
  if (/create|propose|draft|memory_propose/.test(name) || /create_|draft|propose_/.test(scopes)) return "draft";
  if (/review|insight/.test(name) || /review/.test(scopes)) return "insight";
  if (/read|get|list/.test(name) || /read_/.test(scopes)) return "read";
  return "answer";
}

function normalizeToolForReview(tool = {}, decision = {}) {
  const source = normalizeObject(tool);
  const fallback = normalizeObject(decision);
  const applyPolicy = normalizeObject(source.apply_policy || source.applyPolicy || fallback.applyPolicy);
  const scopes = normalizeStringList(source.scopes || source.scope || fallback.scopes, 20, 80);
  const mode = inferToolMode({
    ...source,
    mode: source.mode || fallback.toolMode || fallback.mode,
    scopes,
  });
  const draftSchema = normalizeStringList(source.draft_schema || source.draftSchema || fallback.draftSchema, 12, 80);
  const artifactPersistence = normalizeText(
    source.artifactPersistence || source.artifact_persistence || fallback.artifactPersistence || "pending",
    40,
  );
  const requiresUserConfirmation =
    source.requiresUserConfirmation === true
    || fallback.requiresUserConfirmation === true
    || mode === "draft";
  return {
    tool_id: normalizeText(source.tool_id || source.toolId || source.name || fallback.tool || fallback.tool_id || fallback.toolId, 160),
    legacy_action: normalizeText(source.legacy_action || source.legacyAction || fallback.legacyAction, 100),
    label: normalizeText(source.label || fallback.label || source.name || source.tool_id || fallback.tool, 160),
    module_id: normalizeText(source.module_id || source.moduleId || fallback.moduleId, 80),
    mode,
    disabled: source.disabled === true || mode === "disabled",
    requiresUserConfirmation,
    artifactPersistence: ["ephemeral", "pending", "persisted"].includes(artifactPersistence)
      ? artifactPersistence
      : "pending",
    scopes,
    draft_schema: draftSchema,
    apply_policy: {
      requiresUiConfirmation: applyPolicy.requiresUiConfirmation !== false || requiresUserConfirmation,
      supportsUndo: applyPolicy.supportsUndo !== false,
      allowExternalApply: applyPolicy.allowExternalApply === true,
    },
  };
}

function semanticNeedsConfirmation(semanticAction = {}) {
  const semantic = normalizeObject(semanticAction);
  return semantic.requiresConfirmation === true;
}

function semanticRequestedApply(semanticAction = {}) {
  const semantic = normalizeObject(semanticAction);
  const args = normalizeObject(semantic.arguments);
  const intent = [
    semantic.intent,
    semantic.action,
    semantic.tool,
    args.action,
    args.intent,
    args.operation,
  ].map((item) => normalizeText(item, 120)).join(" ");
  return semantic.apply === true
    || semantic.canApply === true
    || args.apply === true
    || args.applyDraft === true
    || /\bapply\b|确认并应用|直接写入|立即写入|静默应用/.test(intent);
}

function reviewActionPolicy(input = {}) {
  const source = normalizeObject(input);
  const decision = normalizeObject(source.decision);
  const semanticAction = normalizeObject(source.semanticAction || decision.semanticAction);
  const tool = normalizeToolForReview(source.tool || source.toolConfig || decision, decision);
  const surface = normalizeText(source.surface || source.origin || "assistant", 40);
  const requestedApply = source.requestedApply === true || semanticRequestedApply(semanticAction);
  const missingFields = normalizeStringList(semanticAction.missingFields, 8, 80);
  const warnings = normalizeStringList(semanticAction.warnings, 8, 160);
  const requiresConfirmation =
    tool.requiresUserConfirmation === true
    || semanticNeedsConfirmation(semanticAction)
    || (tool.apply_policy.requiresUiConfirmation === true && tool.mode === "draft");
  const createsPendingArtifact = tool.mode === "draft"
    || (tool.draft_schema.length > 0 && tool.artifactPersistence !== "ephemeral")
    || requiresConfirmation;
  const writesUserData = createsPendingArtifact || requestedApply;
  const reasons = [];
  const guardrails = [];

  if (tool.disabled) {
    reasons.push("tool_disabled");
    guardrails.push("disabled_tool_blocked");
  }
  if (requestedApply && tool.apply_policy.allowExternalApply !== true) {
    reasons.push("external_apply_not_allowed");
    guardrails.push("external_apply_disabled");
  }
  if (requiresConfirmation) {
    reasons.push("ui_confirmation_required");
    guardrails.push("draft_requires_user_confirmation");
  }
  if (missingFields.length) {
    reasons.push("missing_fields_need_user_review");
    guardrails.push("missing_fields_visible");
  }
  if (surface === "mcp" && writesUserData) {
    guardrails.push("mcp_can_create_pending_only");
  }
  if (!reasons.length) reasons.push("deterministic_review_passed");

  let status = "allowed";
  if (tool.disabled || (requestedApply && tool.apply_policy.allowExternalApply !== true)) {
    status = "blocked";
  } else if (requiresConfirmation || createsPendingArtifact) {
    status = "needs_confirmation";
  } else if (missingFields.length || warnings.length) {
    status = "needs_review";
  }

  return {
    schema: AI_ACTION_REVIEW_SCHEMA,
    status,
    surface,
    tool: tool.tool_id,
    action: tool.legacy_action || tool.tool_id,
    moduleId: tool.module_id,
    toolMode: tool.mode,
    draftSchema: tool.draft_schema,
    artifactPersistence: tool.artifactPersistence,
    requiresConfirmation,
    canApply: status === "allowed" && requestedApply && tool.apply_policy.allowExternalApply === true,
    canExecuteWithoutConfirmation: status !== "blocked" && !requiresConfirmation && !createsPendingArtifact,
    writesUserData,
    requestedApply,
    permissions: {
      canApply: status === "allowed" && requestedApply && tool.apply_policy.allowExternalApply === true,
      requiresGuanshiUiConfirmation: requiresConfirmation || createsPendingArtifact,
      allowExternalApply: tool.apply_policy.allowExternalApply === true,
    },
    guardrails: Array.from(new Set(guardrails)),
    reasons: Array.from(new Set(reasons)),
    missingFields,
    warnings,
  };
}

function reviewAssistantDecision(decision = {}, semanticAction = {}) {
  return reviewActionPolicy({
    surface: "assistant",
    decision,
    semanticAction,
    tool: decision,
  });
}

function reviewMcpToolDefinition(tool = {}, args = {}) {
  const source = normalizeObject(tool);
  const mode = inferToolMode(source);
  return reviewActionPolicy({
    surface: "mcp",
    tool: {
      name: source.name,
      mode,
      disabled: source.disabled === true,
      scopes: source.scopes || source.scope,
      requiresUserConfirmation: mode === "draft" || /^guanshi\.create_|^guanshi\.propose_/.test(normalizeText(source.name, 160)),
      apply_policy: {
        requiresUiConfirmation: true,
        supportsUndo: true,
        allowExternalApply: false,
      },
    },
    semanticAction: {
      action: source.name,
      arguments: args,
      requiresConfirmation: mode === "draft",
    },
  });
}

module.exports = {
  AI_ACTION_REVIEW_SCHEMA,
  reviewActionPolicy,
  reviewAssistantDecision,
  reviewMcpToolDefinition,
};
