"use strict";

const fs = require("fs");
const path = require("path");

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

function buildEntryMarkdown(entry) {
  const metadata = {
    schema: MEMORY_ENTRY_SCHEMA,
    id: entry.id,
    type: entry.type,
    title: entry.title,
    status: entry.status,
    strength: entry.strength,
    appliesTo: entry.appliesTo,
    engineReadable: entry.engineReadable,
    userConfirmed: entry.userConfirmed,
    sourceKind: entry.sourceKind,
    sourceRef: entry.sourceRef,
    ruleJson: stringifyJsonField(entry.rule),
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
  const evidence = entry.evidence ? stringifyJsonField(entry.evidence) : "";
  return `${serializeFrontmatter(metadata)}\n## 内容\n\n${entry.body}\n\n## 排程含义\n\n${entry.engineReadable ? "- 可进入排程引擎投影。" : "- 不进入排程引擎投影。"}\n\n## 证据\n\n${evidence || "无结构化证据。"}\n`;
}

function parseEntryMarkdown(markdown, filePath) {
  const parsed = parseFrontmatter(markdown);
  const metadata = parsed.metadata;
  const entry = {
    schema: normalizeText(metadata.schema),
    id: normalizeText(metadata.id),
    type: normalizeText(metadata.type),
    title: normalizeText(metadata.title, 160),
    status: normalizeText(metadata.status || "disabled", 40),
    strength: normalizeText(metadata.strength || "soft", 40),
    appliesTo: normalizeStringList(metadata.appliesTo),
    engineReadable: normalizeBoolean(metadata.engineReadable, false),
    userConfirmed: normalizeBoolean(metadata.userConfirmed, false),
    sourceKind: normalizeText(metadata.sourceKind, 80),
    sourceRef: normalizeText(metadata.sourceRef, 120),
    rule: parseJsonField(metadata.ruleJson, null),
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
  return {
    schema: MEMORY_ENTRY_SCHEMA,
    id: entry.id,
    type: entry.type,
    title: entry.title,
    status: entry.status,
    strength: entry.strength,
    appliesTo: entry.appliesTo,
    engineReadable: entry.engineReadable,
    userConfirmed: entry.userConfirmed,
    sourceKind: entry.sourceKind,
    sourceRef: entry.sourceRef,
    rule: entry.rule || null,
    body: entry.body,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}

function normalizeProposal(input, nowIso) {
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
  return {
    schema: MEMORY_PROPOSAL_SCHEMA,
    proposalId,
    status,
    type: normalizeType(source.type),
    title: normalizeText(source.title, 160),
    body: normalizeText(source.body, 4000),
    strength: normalizeStrength(source.strength || (source.type === "boundary" || source.type === "rule" ? "hard" : "soft")),
    appliesTo: normalizeStringList(source.appliesTo, 16),
    engineReadable: normalizeBoolean(source.engineReadable, !["review", "capability_request"].includes(source.type)),
    rule: source.rule && typeof source.rule === "object" && !Array.isArray(source.rule) ? source.rule : null,
    evidence: source.evidence && typeof source.evidence === "object" ? source.evidence : {},
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
    fs.writeFileSync(indexPath, lines.join("\n"), "utf8");
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
      engineReadable: normalizeBoolean(entry.engineReadable, false),
      userConfirmed: normalizeBoolean(entry.userConfirmed, false),
      body: normalizeText(entry.body, 4000),
      updatedAt: normalizeText(entry.updatedAt, 80) || now(),
      createdAt: normalizeText(entry.createdAt, 80) || now(),
    };
    fs.mkdirSync(entriesDir, { recursive: true });
    fs.writeFileSync(entryPath(normalized.id), buildEntryMarkdown(normalized), "utf8");
    writeIndex(listEntries());
    return sanitizeEntry(normalized);
  }

  function listProposals(status = "") {
    ensureLayout();
    const statusFilter = normalizeText(status, 40);
    const proposals = [];
    for (const item of fs.readdirSync(proposalsDir, { withFileTypes: true })) {
      if (!item.isFile() || !item.name.endsWith(".json")) continue;
      const proposal = readJsonIfExists(path.join(proposalsDir, item.name));
      if (!proposal) continue;
      if (statusFilter && proposal.status !== statusFilter) continue;
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
    const proposal = normalizeProposal(input, now());
    writeJsonAtomic(proposalPath(proposal.proposalId), proposal);
    return proposal;
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

  function confirmProposal(proposalId, input = {}) {
    ensureLayout();
    const proposal = getProposal(proposalId);
    if (proposal.status !== "pending_confirmation") {
      throw createMemoryError("AI_MEMORY_PROPOSAL_NOT_PENDING", "Only pending memory proposals can be confirmed.", 409, { proposalId });
    }
    const timestamp = now();
    const entry = writeEntry({
      id: normalizeText(input.memoryId, 100) || buildEntryIdFromProposal(proposal),
      type: proposal.type,
      title: proposal.title,
      status: "active",
      strength: proposal.strength,
      appliesTo: proposal.appliesTo,
      engineReadable: proposal.engineReadable,
      userConfirmed: true,
      sourceKind: proposal.createdBy?.kind || "ai",
      sourceRef: proposal.proposalId,
      rule: proposal.rule || null,
      body: proposal.body,
      evidence: proposal.evidence || {},
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const nextProposal = {
      ...proposal,
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
    const next = writeEntry({
      ...current,
      title: input.title === undefined ? current.title : normalizeText(input.title, 160),
      body: input.body === undefined ? current.body : normalizeText(input.body, 4000),
      strength: input.strength === undefined ? current.strength : normalizeStrength(input.strength),
      appliesTo: input.appliesTo === undefined ? current.appliesTo : normalizeStringList(input.appliesTo, 16),
      engineReadable: input.engineReadable === undefined ? current.engineReadable : normalizeBoolean(input.engineReadable, current.engineReadable),
      rule: input.rule === undefined ? current.rule : input.rule,
      updatedAt: now(),
    });
    return next;
  }

  function setEntryStatus(memoryId, status) {
    if (!MEMORY_STATUSES.has(status)) {
      throw createMemoryError("AI_MEMORY_STATUS_INVALID", "AI memory status is invalid.", 400, { status });
    }
    const current = getEntry(memoryId);
    const next = writeEntry({ ...current, status, updatedAt: now() });
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

  function getEngineProjections(action = "") {
    const config = readConfig();
    if (!config.enabled || !config.autoInject) return [];
    const actionName = normalizeText(action, 80);
    const entries = listEntries()
      .filter((entry) => entry.status === "active")
      .filter((entry) => entry.userConfirmed)
      .filter((entry) => entry.engineReadable)
      .filter((entry) => !["review", "capability_request"].includes(entry.type))
      .filter((entry) => !actionName || !entry.appliesTo.length || entry.appliesTo.includes(actionName) || entry.appliesTo.includes("schedule_draft"))
      .slice(0, Math.max(1, Number.parseInt(String(config.maxInjectedEntries || 12), 10)));
    return entries.map((entry) => ({
      schema: MEMORY_PROJECTION_SCHEMA,
      memoryId: entry.id,
      type: entry.type,
      strength: entry.strength,
      rule: entry.rule || null,
      status: entry.status,
      title: entry.title,
    }));
  }

  return {
    baseDir,
    confirmProposal,
    createProposal,
    deleteEntry,
    getEngineProjections,
    getEntry,
    getProposal,
    listEntries,
    listProposals,
    patchEntry,
    readConfig,
    rejectProposal,
    setEntryStatus,
  };
}

module.exports = {
  MEMORY_ENTRY_SCHEMA,
  MEMORY_PROPOSAL_SCHEMA,
  MEMORY_PROJECTION_SCHEMA,
  createAiMemoryStore,
  createMemoryError,
};
