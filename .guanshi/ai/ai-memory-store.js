"use strict";

const fs = require("fs");
const path = require("path");

const {
  entryAppliesToAction,
  normalizeEntryMatch,
  normalizeMatch,
} = require("./ai-memory-selector");
const {
  getMemoryRuleRegistrySummary,
  validateMemoryRule,
} = require("./ai-memory-rule-registry");
const {
  MEMORY_POLICY_VERSION,
  analyzeMemoryRelation,
  buildMemoryRelationSubjectKey,
  getDefaultModelReadable,
  getEffectiveEngineStatus,
  getMemoryValidity,
  isAmbiguousMemorySubjectKey,
  normalizeMemoryCandidate,
  memoriesAreExactDuplicates,
  memoryScopesOverlap,
  validateMemoryCandidate,
} = require("./ai-memory-policy");

const MEMORY_CONFIG_SCHEMA = "guanshi-ai-memory-config-v1";
const MEMORY_INDEX_SCHEMA = "guanshi-ai-memory-index-v1";
const MEMORY_ENTRY_SCHEMA = "guanshi-ai-memory-entry-v1";
const MEMORY_PROPOSAL_SCHEMA = "guanshi-ai-memory-proposal-v1";
const PRINCIPLE_MEMORY_PROPOSAL_SCHEMA = "guanshi-principle-memory-proposal-v1";
const MEMORY_PROJECTION_SCHEMA = "guanshi-memory-engine-projection-v1";

const MEMORY_TYPES = new Set(["profile", "principle", "habit", "boundary", "preference", "rule", "playbook", "capability_request", "review"]);
const MEMORY_STRENGTHS = new Set(["hard", "soft", "observed"]);
const MEMORY_STATUSES = new Set(["active", "disabled", "deleted"]);
const PROPOSAL_STATUSES = new Set(["pending_confirmation", "confirmed", "rejected", "expired"]);
const CREATED_BY_KINDS = new Set(["ai", "mcp_agent", "local_review", "user_manual"]);
const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{1,96}$/;

function createMemoryError(code, message, statusCode = 400, details = {}) {
  const error = new Error(message || code);
  error.code = code;
  error.statusCode = statusCode;
  error.details = details && typeof details === "object" ? details : {};
  return error;
}

function writeJsonAtomic(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, filePath);
}

function writeTextAtomic(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, String(text), "utf8");
  fs.renameSync(tempPath, filePath);
}

function readJsonIfExists(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw createMemoryError("AI_MEMORY_JSON_READ_FAILED", "AI memory JSON could not be read.", 500, { filePath });
  }
}

function normalizeText(value, maxLength = 4000) {
  return String(value || "").trim().slice(0, maxLength);
}

function slugify(value, fallback = "memory") {
  const ascii = normalizeText(value, 120)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return ascii || fallback;
}

function normalizeId(value, label) {
  const id = normalizeText(value, 120);
  if (!ID_PATTERN.test(id)) {
    throw createMemoryError("AI_MEMORY_ID_INVALID", "AI memory id is invalid.", 400, { label, id });
  }
  return id;
}

function normalizeType(value) {
  const type = normalizeText(value, 40);
  if (!MEMORY_TYPES.has(type)) {
    throw createMemoryError("AI_MEMORY_TYPE_INVALID", "AI memory type is invalid.", 400, { type });
  }
  return type;
}

function normalizeStrength(value) {
  const strength = normalizeText(value || "soft", 40);
  if (!MEMORY_STRENGTHS.has(strength)) {
    throw createMemoryError("AI_MEMORY_STRENGTH_INVALID", "AI memory strength is invalid.", 400, { strength });
  }
  return strength;
}

function normalizeStringList(value, maxItems = 12) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => normalizeText(item, 80)).filter(Boolean).slice(0, maxItems);
}

function normalizeBoolean(value, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeCreatedBy(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const kind = normalizeText(source.kind || "ai", 40);
  if (!CREATED_BY_KINDS.has(kind)) {
    throw createMemoryError("AI_MEMORY_CREATED_BY_INVALID", "AI memory createdBy kind is invalid.", 400, { kind });
  }
  return {
    kind,
    name: normalizeText(source.name || "guanshi", 120),
  };
}

function parseJsonField(value, fallback = null) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function stringifyJsonField(value) {
  if (value === undefined || value === null) return "";
  return JSON.stringify(value);
}

function frontmatterValueToString(value) {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return value.map((item) => String(item));
  return String(value ?? "");
}

function serializeFrontmatter(metadata) {
  const lines = ["---"];
  for (const [key, rawValue] of Object.entries(metadata)) {
    const value = frontmatterValueToString(rawValue);
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) lines.push(`  - ${item}`);
    } else {
      lines.push(`${key}: ${value}`);
    }
  }
  lines.push("---");
  return `${lines.join("\n")}\n`;
}

function parseFrontmatter(markdown) {
  const text = String(markdown || "");
  if (!text.startsWith("---\n")) return { metadata: {}, body: text };
  const endIndex = text.indexOf("\n---", 4);
  if (endIndex < 0) return { metadata: {}, body: text };
  const raw = text.slice(4, endIndex).split(/\r?\n/);
  const metadata = {};
  let activeArrayKey = "";
  for (const line of raw) {
    const arrayMatch = /^\s*-\s+(.*)$/.exec(line);
    if (arrayMatch && activeArrayKey) {
      metadata[activeArrayKey].push(arrayMatch[1].trim());
      continue;
    }
    activeArrayKey = "";
    const match = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1];
    const value = match[2].trim();
    if (!value) {
      metadata[key] = [];
      activeArrayKey = key;
    } else if (value === "true" || value === "false") {
      metadata[key] = value === "true";
    } else {
      metadata[key] = value;
    }
  }
  return {
    metadata,
    body: text.slice(endIndex + 4).replace(/^\r?\n/, ""),
  };
}

function getBodyContent(markdownBody) {
  const text = String(markdownBody || "");
  const marker = "## 内容";
  const index = text.indexOf(marker);
  if (index < 0) return text.trim();
  return text.slice(index + marker.length).split(/\n##\s+/)[0].trim();
}

function getSectionContent(markdownBody, heading) {
  const text = String(markdownBody || "");
  const marker = `## ${heading}`;
  const index = text.indexOf(marker);
  if (index < 0) return "";
  return text.slice(index + marker.length).split(/\n##\s+/)[0].trim();
}

function buildEntryMarkdown(entry) {
  const metadata = {
    schema: MEMORY_ENTRY_SCHEMA,
    id: entry.id,
    type: entry.type,
    title: entry.title,
    status: entry.status,
    strength: entry.strength,
    appliesTo: entry.appliesTo,
    policyVersion: entry.policyVersion || MEMORY_POLICY_VERSION,
    subjectKey: entry.subjectKey || "",
    modelReadable: entry.modelReadable,
    engineReadable: entry.engineReadable,
    userConfirmed: entry.userConfirmed,
    sourceKind: entry.sourceKind,
    sourceRef: entry.sourceRef,
    matchJson: stringifyJsonField(entry.match),
    matchMode: entry.matchMode || (Object.keys(entry.match || {}).length ? "any" : "global"),
    ruleJson: stringifyJsonField(entry.rule),
    validFrom: entry.validFrom || "",
    validUntil: entry.validUntil || "",
    reviewAfter: entry.reviewAfter || "",
    confidence: entry.confidence === null || entry.confidence === undefined ? "" : entry.confidence,
    supersedes: entry.supersedes || [],
    supersededBy: entry.supersededBy || "",
    evidenceJson: stringifyJsonField(entry.evidence),
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
  const evidence = entry.evidence && Object.keys(entry.evidence).length ? stringifyJsonField(entry.evidence) : "";
  return `${serializeFrontmatter(metadata)}\n## 内容\n\n${entry.body}\n\n## 本地规则权限\n\n${entry.engineReadable ? "- 已允许规则注册表校验；仅有真实执行器支持的规则会生效。" : "- 未授权本地规则执行，仅可按模型读取权限供 AI 参考。"}\n\n## 证据\n\n${evidence || "无结构化证据。"}\n`;
}

function parseEntryMarkdown(markdown, filePath) {
  const parsed = parseFrontmatter(markdown);
  const metadata = parsed.metadata;
  const evidenceSection = getSectionContent(parsed.body, "证据");
  const structuredEvidence = parseJsonField(metadata.evidenceJson, null)
    || parseJsonField(evidenceSection, null);
  const entry = {
    schema: normalizeText(metadata.schema),
    id: normalizeText(metadata.id),
    type: normalizeText(metadata.type),
    title: normalizeText(metadata.title, 160),
    status: normalizeText(metadata.status || "disabled", 40),
    strength: normalizeText(metadata.strength || "soft", 40),
    appliesTo: normalizeStringList(metadata.appliesTo),
    policyVersion: normalizeText(metadata.policyVersion, 80) || "legacy-v1",
    subjectKey: normalizeText(metadata.subjectKey, 160),
    modelReadable: typeof metadata.modelReadable === "boolean" ? metadata.modelReadable : undefined,
    engineReadable: normalizeBoolean(metadata.engineReadable, false),
    userConfirmed: normalizeBoolean(metadata.userConfirmed, false),
    sourceKind: normalizeText(metadata.sourceKind, 80),
    sourceRef: normalizeText(metadata.sourceRef, 120),
    match: normalizeMatch(parseJsonField(metadata.matchJson, {})),
    matchMode: normalizeText(metadata.matchMode, 40),
    rule: parseJsonField(metadata.ruleJson, null),
    validFrom: normalizeText(metadata.validFrom, 80),
    validUntil: normalizeText(metadata.validUntil, 80),
    reviewAfter: normalizeText(metadata.reviewAfter, 80),
    confidence: metadata.confidence === undefined || metadata.confidence === "" || Array.isArray(metadata.confidence)
      ? null
      : Number(metadata.confidence),
    supersedes: normalizeStringList(metadata.supersedes),
    supersededBy: normalizeText(metadata.supersededBy, 120),
    evidence: structuredEvidence
      || (evidenceSection && evidenceSection !== "无结构化证据。"
        ? { source: "legacy_markdown", quote: evidenceSection }
        : {}),
    body: getBodyContent(parsed.body),
    createdAt: normalizeText(metadata.createdAt, 80),
    updatedAt: normalizeText(metadata.updatedAt, 80),
    filePath,
  };
  if (entry.schema !== MEMORY_ENTRY_SCHEMA) {
    throw createMemoryError("AI_MEMORY_ENTRY_SCHEMA_INVALID", "AI memory entry schema is invalid.", 500, { filePath });
  }
  if (!MEMORY_STATUSES.has(entry.status)) entry.status = "disabled";
  return entry;
}

function sanitizeEntry(entry) {
  const validity = getMemoryValidity(entry);
  const ruleStatus = entry.rule ? validateMemoryRule(entry.rule) : { known: false, valid: false, consumers: [] };
  const modelReadable = typeof entry.modelReadable === "boolean"
    ? entry.modelReadable
    : entry.engineReadable !== false && getDefaultModelReadable(entry.type);
  const engineStatus = entry.engineReadable === false
    ? { effective: false, reason: "engine_read_disabled" }
    : ruleStatus.valid && ruleStatus.consumers.length
      ? { effective: true, reason: "supported" }
      : { effective: false, reason: ruleStatus.known ? "rule_target_unsupported" : "rule_not_projectable" };
  return {
    schema: MEMORY_ENTRY_SCHEMA,
    id: entry.id,
    type: entry.type,
    title: entry.title,
    status: entry.status,
    strength: entry.strength,
    appliesTo: entry.appliesTo,
    policyVersion: entry.policyVersion || "legacy-v1",
    subjectKey: entry.subjectKey || "",
    modelReadable,
    engineReadable: entry.engineReadable,
    effectiveModelReadable: modelReadable && !["review", "capability_request"].includes(entry.type),
    effectiveEngineReadable: engineStatus.effective,
    engineSupportStatus: engineStatus.reason,
    userConfirmed: entry.userConfirmed,
    sourceKind: entry.sourceKind,
    sourceRef: entry.sourceRef,
    match: normalizeMatch(entry.match),
    matchMode: entry.matchMode || (Object.keys(normalizeMatch(entry.match)).length ? "any" : "global"),
    rule: entry.rule || null,
    validFrom: entry.validFrom || "",
    validUntil: entry.validUntil || "",
    reviewAfter: entry.reviewAfter || "",
    validityStatus: validity.status,
    reviewDue: validity.reviewDue,
    confidence: Number.isFinite(entry.confidence) ? entry.confidence : null,
    supersedes: normalizeStringList(entry.supersedes),
    supersededBy: entry.supersededBy || "",
    evidence: entry.evidence && typeof entry.evidence === "object" ? entry.evidence : {},
    body: entry.body,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}

function normalizeProposal(input, nowIso, options = {}) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const proposalId = normalizeId(source.proposalId || `proposal_${nowIso.replace(/[^0-9]/g, "").slice(0, 14)}`, "proposalId");
  const schema = normalizeText(source.schema || MEMORY_PROPOSAL_SCHEMA);
  if (schema !== MEMORY_PROPOSAL_SCHEMA && schema !== PRINCIPLE_MEMORY_PROPOSAL_SCHEMA) {
    throw createMemoryError("AI_MEMORY_PROPOSAL_SCHEMA_INVALID", "AI memory proposal schema is invalid.", 400, { schema });
  }
  const status = normalizeText(source.status || "pending_confirmation", 40);
  if (!PROPOSAL_STATUSES.has(status)) {
    throw createMemoryError("AI_MEMORY_PROPOSAL_STATUS_INVALID", "AI memory proposal status is invalid.", 400, { status });
  }
  const policy = validateMemoryCandidate(source, {
    allowLegacyCapabilityRequest: options.allowLegacyCapabilityRequest === true,
  });
  if (policy.validation.errors.length) {
    const capabilityDeprecated = policy.validation.errors.includes("capability_request_deprecated");
    throw createMemoryError(
      capabilityDeprecated ? "AI_MEMORY_TYPE_DEPRECATED" : "AI_MEMORY_PROPOSAL_POLICY_INVALID",
      capabilityDeprecated ? "Capability requests are product feedback, not user memory." : "AI memory proposal does not satisfy the memory policy.",
      400,
      { validation: policy.validation },
    );
  }
  const candidate = policy.candidate;
  return {
    schema: MEMORY_PROPOSAL_SCHEMA,
    proposalId,
    status,
    policyVersion: candidate.policyVersion,
    type: normalizeType(candidate.type),
    subjectKey: candidate.subjectKey,
    title: candidate.title,
    body: candidate.body,
    strength: normalizeStrength(candidate.strength),
    appliesTo: candidate.appliesTo,
    modelReadable: candidate.modelReadable,
    engineReadable: candidate.engineReadable,
    matchMode: candidate.matchMode,
    match: candidate.match,
    rule: candidate.rule,
    validFrom: candidate.validFrom,
    validUntil: candidate.validUntil,
    reviewAfter: candidate.reviewAfter,
    confidence: candidate.confidence,
    operationIntent: candidate.operationIntent,
    targetMemoryIds: candidate.targetMemoryIds,
    supersedes: candidate.supersedes,
    evidence: candidate.evidence,
    candidateSource: normalizeText(source.candidateSource, 80),
    normalizedFields: normalizeStringList(source.normalizedFields, 24),
    validation: policy.validation,
    effectiveModelReadable: policy.effectiveModelReadable,
    effectiveEngineReadable: policy.effectiveEngineReadable,
    engineSupportStatus: policy.effectiveEngineReadable ? "supported" : policy.ruleStatus.known ? "rule_target_unsupported" : "rule_not_projectable",
    createdBy: normalizeCreatedBy(source.createdBy),
    createdAt: normalizeText(source.createdAt, 80) || nowIso,
    updatedAt: nowIso,
  };
}

function createAiMemoryStore(options = {}) {
  const dataDir = options.dataDir ? path.resolve(options.dataDir) : process.cwd();
  const baseDir = options.baseDir ? path.resolve(options.baseDir) : path.join(dataDir, "ai-memory");
  const entriesDir = path.join(baseDir, "entries");
  const proposalsDir = path.join(baseDir, "proposals");
  const archiveDir = path.join(baseDir, "archive");
  const configPath = path.join(baseDir, ".config.json");
  const indexPath = path.join(baseDir, "MEMORY.md");
  const now = typeof options.now === "function" ? options.now : () => new Date().toISOString();

  function ensureLayout() {
    fs.mkdirSync(entriesDir, { recursive: true });
    fs.mkdirSync(proposalsDir, { recursive: true });
    fs.mkdirSync(archiveDir, { recursive: true });
    if (!fs.existsSync(configPath)) writeJsonAtomic(configPath, defaultConfig());
    if (!fs.existsSync(indexPath)) writeIndex([]);
  }

  function defaultConfig() {
    return {
      schema: MEMORY_CONFIG_SCHEMA,
      enabled: true,
      autoExtract: false,
      autoInject: true,
      defaultInjectionMode: "active_relevant",
      allowReviewSuggestions: true,
      allowExternalAgentRead: true,
      allowExternalAgentWrite: false,
      maxInjectedEntries: 12,
      memoryPolicyMode: "strict_v2",
      updatedAt: now(),
    };
  }

  function readConfig() {
    ensureLayout();
    const raw = readJsonIfExists(configPath) || {};
    return {
      ...defaultConfig(),
      ...raw,
      schema: MEMORY_CONFIG_SCHEMA,
      allowExternalAgentWrite: false,
    };
  }

  function patchConfig(input = {}) {
    const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
    const current = readConfig();
    const next = { ...current };
    for (const key of ["enabled", "autoExtract", "autoInject", "allowReviewSuggestions", "allowExternalAgentRead"]) {
      if (typeof source[key] === "boolean") next[key] = source[key];
    }
    if (source.maxInjectedEntries !== undefined) {
      const maxInjectedEntries = Number.parseInt(String(source.maxInjectedEntries), 10);
      if (!Number.isInteger(maxInjectedEntries) || maxInjectedEntries < 1 || maxInjectedEntries > 24) {
        throw createMemoryError("AI_MEMORY_CONFIG_LIMIT_INVALID", "Memory injection limit must be between 1 and 24.", 400);
      }
      next.maxInjectedEntries = maxInjectedEntries;
    }
    if (source.memoryPolicyMode !== undefined) {
      const memoryPolicyMode = normalizeText(source.memoryPolicyMode, 40);
      if (!["legacy", "shadow", "strict_v2"].includes(memoryPolicyMode)) {
        throw createMemoryError("AI_MEMORY_POLICY_MODE_INVALID", "Memory policy mode must be legacy, shadow, or strict_v2.", 400);
      }
      next.memoryPolicyMode = memoryPolicyMode;
    }
    next.schema = MEMORY_CONFIG_SCHEMA;
    next.allowExternalAgentWrite = false;
    next.updatedAt = now();
    writeJsonAtomic(configPath, next);
    return next;
  }

  function writeIndex(entries) {
    const active = entries.filter((entry) => entry.status === "active");
    const disabled = entries.filter((entry) => entry.status === "disabled");
    const lines = [
      "# Guanshi AI Memory Index",
      "",
      `schema: ${MEMORY_INDEX_SCHEMA}`,
      `updated: ${now()}`,
      "",
      "## Active",
      "",
      ...active.map((entry) => `- [${entry.type}] ${entry.title} -> entries/${entry.id}.md`),
      "",
      "## Disabled",
      "",
      ...disabled.map((entry) => `- [${entry.type}] ${entry.title} -> entries/${entry.id}.md`),
      "",
    ];
    fs.mkdirSync(baseDir, { recursive: true });
    writeTextAtomic(indexPath, lines.join("\n"));
  }

  function entryPath(memoryId) {
    return path.join(entriesDir, `${normalizeId(memoryId, "memoryId")}.md`);
  }

  function proposalPath(proposalId) {
    return path.join(proposalsDir, `${normalizeId(proposalId, "proposalId")}.json`);
  }

  function listEntries() {
    ensureLayout();
    const entries = [];
    for (const item of fs.readdirSync(entriesDir, { withFileTypes: true })) {
      if (!item.isFile() || !item.name.endsWith(".md")) continue;
      const filePath = path.join(entriesDir, item.name);
      try {
        entries.push(parseEntryMarkdown(fs.readFileSync(filePath, "utf8"), filePath));
      } catch {
        // Skip corrupt entries; focused guard covers writer output.
      }
    }
    entries.sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
    return entries.map(sanitizeEntry);
  }

  function getEntry(memoryId) {
    ensureLayout();
    const filePath = entryPath(memoryId);
    try {
      return sanitizeEntry(parseEntryMarkdown(fs.readFileSync(filePath, "utf8"), filePath));
    } catch (error) {
      if (error?.code === "ENOENT") {
        throw createMemoryError("AI_MEMORY_ENTRY_NOT_FOUND", "AI memory entry was not found.", 404, { memoryId });
      }
      throw error;
    }
  }

  function writeEntry(entry) {
    const normalized = {
      ...entry,
      id: normalizeId(entry.id, "memoryId"),
      type: normalizeType(entry.type),
      title: normalizeText(entry.title, 160),
      status: MEMORY_STATUSES.has(entry.status) ? entry.status : "disabled",
      strength: normalizeStrength(entry.strength),
      appliesTo: normalizeStringList(entry.appliesTo, 16),
      policyVersion: normalizeText(entry.policyVersion, 80) || MEMORY_POLICY_VERSION,
      subjectKey: normalizeText(entry.subjectKey, 160),
      modelReadable: typeof entry.modelReadable === "boolean" ? entry.modelReadable : getDefaultModelReadable(entry.type),
      engineReadable: normalizeBoolean(entry.engineReadable, false),
      userConfirmed: normalizeBoolean(entry.userConfirmed, false),
      match: normalizeMatch(entry.match),
      matchMode: normalizeText(entry.matchMode, 40) || (Object.keys(normalizeMatch(entry.match)).length ? "any" : "global"),
      validFrom: normalizeText(entry.validFrom, 80),
      validUntil: normalizeText(entry.validUntil, 80),
      reviewAfter: normalizeText(entry.reviewAfter, 80),
      confidence: entry.confidence === null || entry.confidence === undefined || entry.confidence === ""
        ? null
        : Number.isFinite(Number(entry.confidence)) ? Number(entry.confidence) : null,
      supersedes: normalizeStringList(entry.supersedes),
      supersededBy: normalizeText(entry.supersededBy, 120),
      evidence: entry.evidence && typeof entry.evidence === "object" ? entry.evidence : {},
      body: normalizeText(entry.body, 4000),
      updatedAt: normalizeText(entry.updatedAt, 80) || now(),
      createdAt: normalizeText(entry.createdAt, 80) || now(),
    };
    fs.mkdirSync(entriesDir, { recursive: true });
    writeTextAtomic(entryPath(normalized.id), buildEntryMarkdown(normalized));
    writeIndex(listEntries());
    return sanitizeEntry(normalized);
  }

  function listProposals(status = "") {
    ensureLayout();
    const statusFilter = normalizeText(status, 40);
    const proposals = [];
    const entries = listEntries();
    for (const item of fs.readdirSync(proposalsDir, { withFileTypes: true })) {
      if (!item.isFile() || !item.name.endsWith(".json")) continue;
      const proposal = readJsonIfExists(path.join(proposalsDir, item.name));
      if (!proposal) continue;
      if (statusFilter && proposal.status !== statusFilter) continue;
      if (proposal.status === "pending_confirmation") {
        proposal.relation = analyzeMemoryRelation(proposal, entries);
      }
      proposals.push(proposal);
    }
    proposals.sort((left, right) => String(right.updatedAt || right.createdAt).localeCompare(String(left.updatedAt || left.createdAt)));
    return proposals;
  }

  function getProposal(proposalId) {
    ensureLayout();
    const proposal = readJsonIfExists(proposalPath(proposalId));
    if (!proposal) {
      throw createMemoryError("AI_MEMORY_PROPOSAL_NOT_FOUND", "AI memory proposal was not found.", 404, { proposalId });
    }
    return proposal;
  }

  function createProposal(input) {
    ensureLayout();
    const requestedId = normalizeText(input?.proposalId, 120);
    const existing = requestedId ? readJsonIfExists(proposalPath(requestedId)) : null;
    if (existing && existing.status !== "pending_confirmation") {
      throw createMemoryError("AI_MEMORY_PROPOSAL_NOT_PENDING", "Only pending memory proposals can be updated.", 409, { proposalId: requestedId });
    }
    const proposal = normalizeProposal({ ...input, createdAt: existing?.createdAt || input?.createdAt }, now());
    const entries = listEntries();
    const relation = analyzeMemoryRelation(proposal, entries);
    proposal.relation = relation;
    writeJsonAtomic(proposalPath(proposal.proposalId), proposal);
    return proposal;
  }

  function validateProposal(input) {
    const proposal = normalizeProposal(input, now());
    return {
      proposal,
      validation: proposal.validation,
      relation: analyzeMemoryRelation(proposal, listEntries()),
      effectiveModelReadable: proposal.effectiveModelReadable,
      effectiveEngineReadable: proposal.effectiveEngineReadable,
      engineSupportStatus: proposal.engineSupportStatus,
    };
  }

  function buildEntryIdFromProposal(proposal) {
    const base = `memory_${proposal.type}_${slugify(proposal.title, proposal.proposalId)}`.slice(0, 96);
    let candidate = base;
    let suffix = 2;
    while (fs.existsSync(path.join(entriesDir, `${candidate}.md`))) {
      candidate = `${base.slice(0, 90)}_${suffix}`;
      suffix += 1;
    }
    return candidate;
  }

  function archiveEntryRevision(memoryId, timestamp) {
    const previousMarkdown = fs.readFileSync(entryPath(memoryId), "utf8");
    const revisionDir = path.join(archiveDir, "revisions", memoryId);
    fs.mkdirSync(revisionDir, { recursive: true });
    fs.writeFileSync(path.join(revisionDir, `${timestamp.replace(/[^0-9]/g, "").slice(0, 14)}.md`), previousMarkdown, "utf8");
    return previousMarkdown;
  }

  function selectCanonicalReplacementTarget(entries, requestedId = "") {
    const requested = entries.find((entry) => entry.id === requestedId);
    if (requested) return requested;
    return [...entries].sort((left, right) => {
      const leftUser = ["user", "user_manual"].includes(left.sourceKind) ? 1 : 0;
      const rightUser = ["user", "user_manual"].includes(right.sourceKind) ? 1 : 0;
      if (leftUser !== rightUser) return rightUser - leftUser;
      const createdDiff = String(left.createdAt || "9999").localeCompare(String(right.createdAt || "9999"));
      if (createdDiff !== 0) return createdDiff;
      return String(left.id).localeCompare(String(right.id));
    })[0];
  }

  function confirmProposal(proposalId, input = {}) {
    ensureLayout();
    const proposal = getProposal(proposalId);
    if (proposal.status !== "pending_confirmation") {
      throw createMemoryError("AI_MEMORY_PROPOSAL_NOT_PENDING", "Only pending memory proposals can be confirmed.", 409, { proposalId });
    }
    const refreshed = normalizeProposal(proposal, now());
    const relation = analyzeMemoryRelation(refreshed, listEntries());
    const resolution = input.resolution && typeof input.resolution === "object" ? input.resolution : {};
    const resolutionMode = normalizeText(resolution.mode, 40);
    if (relation.kind === "unresolved_update") {
      throw createMemoryError("AI_MEMORY_UPDATE_TARGET_REQUIRED", "The requested memory update has no matching active target.", 409, { relation });
    }
    if (relation.kind === "duplicate" && (!resolutionMode || resolutionMode === "reuse_existing")) {
      const existingEntryId = relation.relatedMemoryIds[0];
      const nextProposal = {
        ...proposal,
        validation: refreshed.validation,
        relation,
        status: "confirmed",
        confirmedBy: normalizeText(input.confirmedBy || "user", 80),
        entryId: existingEntryId,
        reusedExisting: true,
        updatedAt: now(),
      };
      writeJsonAtomic(proposalPath(proposal.proposalId), nextProposal);
      return { proposal: nextProposal, entry: getEntry(existingEntryId) };
    }
    if (relation.kind === "update" && relation.relatedMemoryIds.length === 1) {
      const targetMemoryId = relation.relatedMemoryIds[0];
      const previousEntry = getEntry(targetMemoryId);
      const timestamp = now();
      const previousMarkdown = archiveEntryRevision(targetMemoryId, timestamp);
      let entry;
      try {
        entry = writeEntry({
          ...previousEntry,
          id: targetMemoryId,
          type: refreshed.type,
          policyVersion: refreshed.policyVersion,
          subjectKey: refreshed.subjectKey,
          title: refreshed.title,
          status: "active",
          strength: refreshed.strength,
          appliesTo: refreshed.appliesTo,
          modelReadable: refreshed.modelReadable,
          engineReadable: refreshed.engineReadable,
          userConfirmed: true,
          sourceKind: refreshed.createdBy?.kind || previousEntry.sourceKind || "ai",
          sourceRef: refreshed.proposalId,
          match: refreshed.match || {},
          matchMode: refreshed.matchMode,
          rule: refreshed.rule || null,
          validFrom: refreshed.validFrom,
          validUntil: refreshed.validUntil,
          reviewAfter: refreshed.reviewAfter,
          confidence: refreshed.confidence,
          supersedes: previousEntry.supersedes || [],
          supersededBy: "",
          body: refreshed.body,
          evidence: refreshed.evidence || {},
          createdAt: previousEntry.createdAt,
          updatedAt: timestamp,
        });
      } catch (error) {
        fs.writeFileSync(entryPath(targetMemoryId), previousMarkdown, "utf8");
        writeIndex(listEntries());
        throw error;
      }
      const nextProposal = {
        ...proposal,
        validation: refreshed.validation,
        relation,
        status: "confirmed",
        confirmedBy: normalizeText(input.confirmedBy || "user", 80),
        entryId: entry.id,
        updatedExisting: true,
        updatedAt: timestamp,
      };
      writeJsonAtomic(proposalPath(proposal.proposalId), nextProposal);
      return { proposal: nextProposal, entry };
    }
    if (relation.kind === "conflict" && resolutionMode !== "replace_existing") {
      throw createMemoryError("AI_MEMORY_CONFLICT_RESOLUTION_REQUIRED", "Memory conflict requires an explicit replacement choice.", 409, { relation });
    }
    if (resolutionMode === "keep_parallel" && relation.kind !== "parallel") {
      throw createMemoryError("AI_MEMORY_PARALLEL_SCOPE_INVALID", "Overlapping memory scopes cannot remain active in parallel.", 409, { relation });
    }
    const requestedTargetMemoryIds = normalizeStringList([
      ...normalizeStringList(resolution.targetMemoryIds, 24),
      normalizeText(resolution.targetMemoryId, 120),
    ], 24);
    if (resolutionMode === "replace_existing") {
      const relatedSet = new Set(relation.relatedMemoryIds);
      const requestedSet = new Set(requestedTargetMemoryIds);
      const complete = relatedSet.size === requestedSet.size && [...relatedSet].every((memoryId) => requestedSet.has(memoryId));
      if (!complete) {
        throw createMemoryError(
          "AI_MEMORY_REPLACEMENT_TARGETS_INCOMPLETE",
          "Replacement confirmation must include every overlapping active memory.",
          409,
          { relation, targetMemoryIds: requestedTargetMemoryIds },
        );
      }
    }
    const timestamp = now();
    if (resolutionMode === "replace_existing") {
      const targets = requestedTargetMemoryIds.map((memoryId) => getEntry(memoryId));
      const canonicalTarget = selectCanonicalReplacementTarget(targets, normalizeText(resolution.canonicalMemoryId, 120));
      const previousMarkdownById = new Map();
      for (const target of targets) previousMarkdownById.set(target.id, archiveEntryRevision(target.id, timestamp));
      let entry;
      try {
        entry = writeEntry({
          ...canonicalTarget,
          id: canonicalTarget.id,
          type: refreshed.type,
          policyVersion: refreshed.policyVersion,
          subjectKey: refreshed.subjectKey,
          title: refreshed.title,
          status: "active",
          strength: refreshed.strength,
          appliesTo: refreshed.appliesTo,
          modelReadable: refreshed.modelReadable,
          engineReadable: refreshed.engineReadable,
          userConfirmed: true,
          sourceKind: refreshed.createdBy?.kind || canonicalTarget.sourceKind || "ai",
          sourceRef: refreshed.proposalId,
          match: refreshed.match || {},
          matchMode: refreshed.matchMode,
          rule: refreshed.rule || null,
          validFrom: refreshed.validFrom,
          validUntil: refreshed.validUntil,
          reviewAfter: refreshed.reviewAfter,
          confidence: refreshed.confidence,
          supersedes: Array.from(new Set([...(canonicalTarget.supersedes || []), ...targets.filter((target) => target.id !== canonicalTarget.id).map((target) => target.id)])),
          supersededBy: "",
          body: refreshed.body,
          evidence: refreshed.evidence || {},
          createdAt: canonicalTarget.createdAt,
          updatedAt: timestamp,
        });
        for (const target of targets) {
          if (target.id === canonicalTarget.id) continue;
          writeEntry({ ...target, status: "disabled", supersededBy: canonicalTarget.id, updatedAt: timestamp });
        }
      } catch (error) {
        for (const [memoryId, markdown] of previousMarkdownById.entries()) {
          fs.writeFileSync(entryPath(memoryId), markdown, "utf8");
        }
        writeIndex(listEntries());
        throw error;
      }
      const nextProposal = {
        ...proposal,
        validation: refreshed.validation,
        relation,
        status: "confirmed",
        confirmedBy: normalizeText(input.confirmedBy || "user", 80),
        entryId: entry.id,
        updatedExisting: true,
        consolidatedExisting: targets.length > 1,
        replacedMemoryIds: targets.map((target) => target.id),
        updatedAt: timestamp,
      };
      try {
        writeJsonAtomic(proposalPath(proposal.proposalId), nextProposal);
      } catch (error) {
        for (const [memoryId, markdown] of previousMarkdownById.entries()) {
          fs.writeFileSync(entryPath(memoryId), markdown, "utf8");
        }
        writeIndex(listEntries());
        throw error;
      }
      return { proposal: nextProposal, entry };
    }
    const entryId = normalizeText(input.memoryId, 100) || buildEntryIdFromProposal(refreshed);
    let entry;
    try {
      entry = writeEntry({
      id: entryId,
      type: proposal.type,
      policyVersion: refreshed.policyVersion,
      subjectKey: refreshed.subjectKey,
      title: proposal.title,
      status: "active",
      strength: proposal.strength,
      appliesTo: proposal.appliesTo,
      modelReadable: refreshed.modelReadable,
      engineReadable: proposal.engineReadable,
      userConfirmed: true,
      sourceKind: proposal.createdBy?.kind || "ai",
      sourceRef: proposal.proposalId,
      match: proposal.match || {},
      matchMode: refreshed.matchMode,
      rule: proposal.rule || null,
      validFrom: refreshed.validFrom,
      validUntil: refreshed.validUntil,
      reviewAfter: refreshed.reviewAfter,
      confidence: refreshed.confidence,
      supersedes: refreshed.supersedes,
      body: proposal.body,
      evidence: proposal.evidence || {},
      createdAt: timestamp,
      updatedAt: timestamp,
      });
    } catch (error) {
      try {
        if (fs.existsSync(entryPath(entryId))) fs.unlinkSync(entryPath(entryId));
      } catch {
        // Best-effort rollback; original error remains authoritative.
      }
      writeIndex(listEntries());
      throw error;
    }
    const nextProposal = {
      ...proposal,
      validation: refreshed.validation,
      relation,
      status: "confirmed",
      confirmedBy: normalizeText(input.confirmedBy || "user", 80),
      entryId: entry.id,
      updatedAt: timestamp,
    };
    writeJsonAtomic(proposalPath(proposal.proposalId), nextProposal);
    return { proposal: nextProposal, entry };
  }

  function rejectProposal(proposalId, input = {}) {
    const proposal = getProposal(proposalId);
    if (proposal.status !== "pending_confirmation") {
      throw createMemoryError("AI_MEMORY_PROPOSAL_NOT_PENDING", "Only pending memory proposals can be rejected.", 409, { proposalId });
    }
    const nextProposal = {
      ...proposal,
      status: "rejected",
      rejectedBy: normalizeText(input.rejectedBy || "user", 80),
      rejectionReason: normalizeText(input.reason, 500),
      updatedAt: now(),
    };
    writeJsonAtomic(proposalPath(proposal.proposalId), nextProposal);
    return nextProposal;
  }

  function patchEntry(memoryId, input = {}) {
    const current = getEntry(memoryId);
    const policy = validateMemoryCandidate({
      ...current,
      title: input.title === undefined ? current.title : normalizeText(input.title, 160),
      body: input.body === undefined ? current.body : normalizeText(input.body, 4000),
      strength: input.strength === undefined ? current.strength : normalizeStrength(input.strength),
      appliesTo: input.appliesTo === undefined ? current.appliesTo : normalizeStringList(input.appliesTo, 16),
      engineReadable: input.engineReadable === undefined ? current.engineReadable : normalizeBoolean(input.engineReadable, current.engineReadable),
      modelReadable: input.modelReadable === undefined ? current.modelReadable : normalizeBoolean(input.modelReadable, current.modelReadable),
      subjectKey: input.subjectKey === undefined ? current.subjectKey : normalizeText(input.subjectKey, 160),
      match: input.match === undefined ? current.match : normalizeMatch(input.match),
      matchMode: input.matchMode === undefined ? current.matchMode : normalizeText(input.matchMode, 40),
      rule: input.rule === undefined ? current.rule : input.rule,
      validFrom: input.validFrom === undefined ? current.validFrom : normalizeText(input.validFrom, 80),
      validUntil: input.validUntil === undefined ? current.validUntil : normalizeText(input.validUntil, 80),
      reviewAfter: input.reviewAfter === undefined ? current.reviewAfter : normalizeText(input.reviewAfter, 80),
      confidence: input.confidence === undefined ? current.confidence : Number(input.confidence),
    }, { allowLegacyCapabilityRequest: false });
    if (policy.validation.errors.length) {
      throw createMemoryError("AI_MEMORY_ENTRY_POLICY_INVALID", "AI memory update does not satisfy the memory policy.", 400, {
        validation: policy.validation,
      });
    }
    const relation = analyzeMemoryRelation(policy.candidate, listEntries().filter((entry) => entry.id !== current.id));
    if (["duplicate", "conflict"].includes(relation.kind)) {
      throw createMemoryError("AI_MEMORY_ENTRY_RELATION_CONFLICT", "AI memory update overlaps an existing active memory.", 409, { relation });
    }
    return writeEntry({
      ...current,
      ...policy.candidate,
      updatedAt: now(),
    });
  }

  function setEntryStatus(memoryId, status) {
    if (!MEMORY_STATUSES.has(status)) {
      throw createMemoryError("AI_MEMORY_STATUS_INVALID", "AI memory status is invalid.", 400, { status });
    }
    const current = getEntry(memoryId);
    if (status === "active") {
      const relation = analyzeMemoryRelation(current, listEntries().filter((entry) => entry.id !== current.id));
      if (["duplicate", "conflict"].includes(relation.kind)) {
        throw createMemoryError("AI_MEMORY_RESTORE_CONFLICT", "Memory cannot be restored while an overlapping active memory exists.", 409, { relation });
      }
    }
    const next = writeEntry({
      ...current,
      status,
      ...(status === "active" ? { supersededBy: "" } : {}),
      updatedAt: now(),
    });
    return next;
  }

  function deleteEntry(memoryId, input = {}) {
    const current = getEntry(memoryId);
    const permanent = input.permanent !== false;
    const filePath = entryPath(memoryId);
    if (permanent) {
      fs.unlinkSync(filePath);
      writeIndex(listEntries());
      return { deleted: true, permanent: true, memoryId: current.id };
    }
    const archived = writeEntry({ ...current, status: "deleted", updatedAt: now() });
    writeIndex(listEntries());
    return { deleted: true, permanent: false, entry: archived };
  }

  function getEngineProjections(input = "") {
    const config = readConfig();
    if (!config.enabled || !config.autoInject) return [];
    const source = input && typeof input === "object" && !Array.isArray(input) ? input : { action: input };
    const target = normalizeText(source.target || "scheduler", 80);
    const action = source.action || "";
    const actionName = normalizeText(action, 80);
    const entries = listEntries()
      .filter((entry) => entry.status === "active")
      .filter((entry) => entry.userConfirmed)
      .filter((entry) => entry.engineReadable)
      .filter((entry) => !["review", "capability_request"].includes(entry.type))
      .filter((entry) => !entry.supersededBy)
      .filter((entry) => getMemoryValidity(entry, now()).status === "valid")
      .filter((entry) => entryAppliesToAction(entry, actionName))
      .filter((entry) => getEffectiveEngineStatus(entry, target).effective)
      .slice(0, Math.max(1, Number.parseInt(String(config.maxInjectedEntries || 12), 10)));
    return entries.map((entry) => ({
      schema: MEMORY_PROJECTION_SCHEMA,
      memoryId: entry.id,
      type: entry.type,
      strength: entry.strength,
      rule: entry.rule || null,
      match: normalizeEntryMatch(entry),
      status: entry.status,
      title: entry.title,
      target,
    }));
  }

  function getHealth() {
    const entries = listEntries();
    const categorizedItems = entries.map((entry) => {
      const issues = [];
      const capabilities = [];
      const relationSubjectKey = buildMemoryRelationSubjectKey(entry);
      if (!entry.subjectKey) issues.push("legacy_subject_missing");
      if (entry.status === "active" && isAmbiguousMemorySubjectKey(relationSubjectKey)) issues.push("subject_ambiguous");
      if (
        entry.status === "active"
        && entry.rule?.kind === "task_duration_estimate"
        && entry.subjectKey
        && relationSubjectKey
        && entry.subjectKey !== relationSubjectKey
      ) issues.push("subject_key_semantic_mismatch");
      if (entry.reviewDue) issues.push("review_due");
      if (entry.validityStatus === "expired") issues.push("validity_expired");
      if (entry.engineReadable && !entry.effectiveEngineReadable) capabilities.push(entry.engineSupportStatus || "engine_unsupported");
      if (entry.type === "capability_request") issues.push("legacy_capability_request");
      if (entry.status === "active" && entry.subjectKey) {
        const relation = analyzeMemoryRelation(entry, entries.filter((other) => other.id !== entry.id));
        if (relation.kind === "duplicate") issues.push("subject_duplicate");
        if (relation.kind === "conflict") issues.push("subject_conflict");
      }
      return { memoryId: entry.id, title: entry.title, issues, capabilities };
    });
    const items = categorizedItems.filter((item) => item.issues.length);
    const capabilityItems = categorizedItems.filter((item) => item.capabilities.length);
    const counts = items
      .flatMap((item) => item.issues)
      .reduce((acc, issue) => ({ ...acc, [issue]: (acc[issue] || 0) + 1 }), {});
    const capabilityCounts = capabilityItems
      .flatMap((item) => item.capabilities)
      .reduce((acc, issue) => ({ ...acc, [issue]: (acc[issue] || 0) + 1 }), {});
    const conflictItems = items.filter((item) => item.issues.some((issue) => ["subject_duplicate", "subject_conflict"].includes(issue)));
    const reviewItems = items.filter((item) => item.issues.some((issue) => !["subject_duplicate", "subject_conflict"].includes(issue)));
    return {
      schema: "guanshi-ai-memory-health-v1",
      policyVersion: "memory-health-v3",
      total: entries.length,
      issueCount: items.length,
      conflictCount: conflictItems.length,
      reviewCount: reviewItems.length,
      capabilityCount: capabilityItems.length,
      counts,
      capabilityCounts,
      items,
      categories: {
        conflicts: conflictItems,
        reviews: reviewItems,
        capabilities: capabilityItems,
      },
      repairPlan: getRepairPlan(entries),
    };
  }

  function getRepairPlan(entriesInput = null) {
    const entries = (Array.isArray(entriesInput) ? entriesInput : listEntries())
      .filter((entry) => entry.status === "active" && !entry.supersededBy);
    const groups = new Map();
    for (const entry of entries) {
      const subjectKey = buildMemoryRelationSubjectKey(entry);
      if (!subjectKey) continue;
      if (!groups.has(subjectKey)) groups.set(subjectKey, []);
      groups.get(subjectKey).push(entry);
    }
    const suggestions = [];
    for (const entry of entries) {
      const semanticSubjectKey = buildMemoryRelationSubjectKey(entry);
      if (isAmbiguousMemorySubjectKey(semanticSubjectKey)) {
        suggestions.push({
          subjectKey: semanticSubjectKey,
          kind: "ambiguous_subject",
          memoryIds: [entry.id],
          titles: [entry.title],
          suggestedAction: "review_topic_before_reactivation",
          requiresConfirmation: true,
        });
      } else if (entry.rule?.kind === "task_duration_estimate" && entry.subjectKey !== semanticSubjectKey) {
        suggestions.push({
          subjectKey: semanticSubjectKey,
          kind: "subject_normalization",
          memoryIds: [entry.id],
          titles: [entry.title],
          suggestedAction: "normalize_subject_and_match",
          requiresConfirmation: true,
        });
      }
    }
    for (const [subjectKey, group] of groups.entries()) {
      if (group.length < 2) continue;
      const overlappingIds = new Set();
      let hasConflict = false;
      let hasDuplicate = false;
      for (let leftIndex = 0; leftIndex < group.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < group.length; rightIndex += 1) {
          const left = group[leftIndex];
          const right = group[rightIndex];
          if (!memoryScopesOverlap(left, right)) continue;
          overlappingIds.add(left.id);
          overlappingIds.add(right.id);
          if (memoriesAreExactDuplicates(left, right)) hasDuplicate = true;
          else hasConflict = true;
        }
      }
      if (!overlappingIds.size) continue;
      suggestions.push({
        subjectKey,
        kind: hasConflict ? "conflict" : hasDuplicate ? "duplicate" : "review",
        memoryIds: [...overlappingIds].sort(),
        titles: group.filter((entry) => overlappingIds.has(entry.id)).map((entry) => entry.title),
        suggestedAction: hasConflict ? "choose_canonical_value_and_consolidate" : "consolidate_duplicates",
        requiresConfirmation: true,
      });
    }
    return {
      schema: "guanshi-ai-memory-repair-plan-v1",
      generatedAt: now(),
      readOnly: true,
      suggestionCount: suggestions.length,
      suggestions,
    };
  }

  function recordSelectorShadowComparison(input = {}) {
    ensureLayout();
    const legacyMemoryIds = normalizeStringList(input.legacyMemoryIds, 24);
    const strictMemoryIds = normalizeStringList(input.strictMemoryIds, 24);
    const legacySet = new Set(legacyMemoryIds);
    const strictSet = new Set(strictMemoryIds);
    const record = {
      schema: "guanshi-ai-memory-selector-shadow-v1",
      createdAt: now(),
      action: normalizeText(input.action, 100),
      legacyMemoryIds,
      strictMemoryIds,
      onlyLegacy: legacyMemoryIds.filter((memoryId) => !strictSet.has(memoryId)),
      onlyStrict: strictMemoryIds.filter((memoryId) => !legacySet.has(memoryId)),
    };
    const auditDir = path.join(baseDir, "audit");
    fs.mkdirSync(auditDir, { recursive: true });
    fs.appendFileSync(path.join(auditDir, "selector-shadow.jsonl"), `${JSON.stringify(record)}\n`, "utf8");
    return record;
  }

  return {
    baseDir,
    confirmProposal,
    createProposal,
    deleteEntry,
    getEngineProjections,
    getHealth,
    getRepairPlan,
    getRuleRegistry: getMemoryRuleRegistrySummary,
    getEntry,
    getProposal,
    listEntries,
    listProposals,
    patchEntry,
    patchConfig,
    recordSelectorShadowComparison,
    readConfig,
    rejectProposal,
    setEntryStatus,
    validateProposal,
  };
}

module.exports = {
  MEMORY_ENTRY_SCHEMA,
  MEMORY_PROPOSAL_SCHEMA,
  MEMORY_PROJECTION_SCHEMA,
  createAiMemoryStore,
  createMemoryError,
};
