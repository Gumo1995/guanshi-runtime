"use strict";

const fs = require("fs");
const path = require("path");

const { SCHEDULE_DRAFT_SCHEMA, createScheduleDraft } = require("./ai-scheduler");

function createDraftError(code, message, statusCode = 400, details = {}) {
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

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw createDraftError("AI_DRAFT_NOT_FOUND", "AI schedule draft was not found.", 404);
    }
    throw createDraftError("AI_DRAFT_READ_FAILED", "AI schedule draft could not be read.", 500);
  }
}

function normalizeId(value, label = "draftId") {
  const id = String(value || "").trim();
  if (!/^[a-z0-9][a-z0-9_-]{1,120}$/.test(id)) {
    throw createDraftError("AI_DRAFT_ID_INVALID", "AI draft id is invalid.", 400, { label, id });
  }
  return id;
}

function sanitizeDraft(draft) {
  return {
    schema: SCHEDULE_DRAFT_SCHEMA,
    draftId: draft.draftId,
    source: draft.source || {},
    status: draft.status || "pending",
    dateRange: draft.dateRange || {},
    summary: String(draft.summary || ""),
    changes: Array.isArray(draft.changes) ? draft.changes : [],
    conflicts: Array.isArray(draft.conflicts) ? draft.conflicts : [],
    impact: draft.impact || {},
    undo: draft.undo || { transactionId: null, restorable: true },
    createdAt: String(draft.createdAt || ""),
    updatedAt: String(draft.updatedAt || draft.createdAt || ""),
  };
}

function createAiDraftStore(options = {}) {
  const dataDir = options.dataDir ? path.resolve(options.dataDir) : process.cwd();
  const draftDir = options.draftDir ? path.resolve(options.draftDir) : path.join(dataDir, "ai-drafts");
  const now = typeof options.now === "function" ? options.now : () => new Date().toISOString();

  function ensureLayout() {
    fs.mkdirSync(draftDir, { recursive: true });
  }

  function draftPath(draftId) {
    return path.join(draftDir, `${normalizeId(draftId)}.json`);
  }

  function saveDraft(draft) {
    ensureLayout();
    if (!draft || draft.schema !== SCHEDULE_DRAFT_SCHEMA) {
      throw createDraftError("AI_DRAFT_SCHEMA_INVALID", "AI schedule draft schema is invalid.", 400);
    }
    const payload = sanitizeDraft({
      ...draft,
      status: draft.status || "pending",
      updatedAt: now(),
    });
    writeJsonAtomic(draftPath(payload.draftId), payload);
    return payload;
  }

  function createDraft(input) {
    return saveDraft(createScheduleDraft(input, { now }));
  }

  function getDraft(draftId) {
    const draft = readJson(draftPath(draftId));
    if (draft.schema !== SCHEDULE_DRAFT_SCHEMA) {
      throw createDraftError("AI_DRAFT_SCHEMA_INVALID", "AI schedule draft schema is invalid.", 500);
    }
    return sanitizeDraft(draft);
  }

  function listDrafts(status = "") {
    ensureLayout();
    const drafts = [];
    const statusFilter = String(status || "").trim();
    for (const item of fs.readdirSync(draftDir, { withFileTypes: true })) {
      if (!item.isFile() || !item.name.endsWith(".json")) continue;
      try {
        const draft = sanitizeDraft(readJson(path.join(draftDir, item.name)));
        if (statusFilter && draft.status !== statusFilter) continue;
        drafts.push(draft);
      } catch {
        // Skip corrupt draft files while preserving the rest.
      }
    }
    drafts.sort((left, right) => String(right.updatedAt || right.createdAt).localeCompare(String(left.updatedAt || left.createdAt)));
    return drafts;
  }

  function setDraftStatus(draftId, status) {
    if (!["pending", "rejected", "confirmed", "applied", "failed", "undone"].includes(status)) {
      throw createDraftError("AI_DRAFT_STATUS_INVALID", "AI draft status is invalid.", 400, { status });
    }
    const current = getDraft(draftId);
    if (current.status !== "pending" && status !== current.status) {
      throw createDraftError("AI_DRAFT_STATUS_LOCKED", "Only pending drafts can change status in this release.", 409, { draftId });
    }
    return saveDraft({ ...current, status, updatedAt: now() });
  }

  return {
    createDraft,
    getDraft,
    listDrafts,
    saveDraft,
    setDraftStatus,
  };
}

module.exports = {
  createAiDraftStore,
  createDraftError,
};
