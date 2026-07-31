"use strict";

const fs = require("fs");
const path = require("path");

const { createAiConfigStore } = require("./ai-config-store");
const { createDomainModuleRegistry } = require("./ai-domain-module-registry");
const { createAiDraftStore } = require("./ai-draft-store");
const { createAiMemoryStore } = require("./ai-memory-store");
const { createMcpToolRuntime } = require("./ai-mcp-tools");
const {
  AI_CONTEXT_ENVELOPE_SCHEMA,
  AI_MODEL_INPUT_TRACE_SCHEMA,
  AI_PLANNER_PROMPT_SCHEMA,
  AI_TURN_TRACE_SCHEMA,
  AI_WRITER_PROMPT_SCHEMA,
  AI_WRITER_TASK_SCHEMA,
  buildAnswerWriterMessages,
  buildAssistantResultFromPlan,
  createAssistantAnswerStreamFilter,
  executeAiAssistantTurn,
  executeAssistantToolDecision,
  planAssistantTurn,
  sanitizeAssistantAnswerText,
} = require("./ai-assistant-orchestrator");
const { executeAiWorkflow } = require("./ai-workflows");
const { fetchProviderChat, streamProviderChatText } = require("./ai-provider-client");
const { redactSensitiveValue } = require("./ai-redaction");
const { reviewActionPolicy } = require("./ai-action-governance");
const {
  buildProviderHealth,
  createProviderError,
  listProviderTypes,
  testProviderConnection,
} = require("./ai-provider-registry");
const {
  buildModelMemoryContext,
  renderModelMemoryPromptBlock,
  summarizeModelMemoryContext,
} = require("./ai-context-composer");

const AI_ROUTE_MAX_BODY_BYTES = 256 * 1024;
const AI_ASSISTANT_STREAM_TEXT_CHUNK_SIZE = 36;
const AI_ASSISTANT_STREAM_TEXT_DELAY_MS = 12;
const AI_ASSISTANT_PROMPT_AUDIT_SCHEMA = "guanshi-ai-assistant-prompt-audit-v1";

function delay(ms) {
  const duration = Number(ms);
  if (!Number.isFinite(duration) || duration <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, duration));
}

function sendRouteError(sendJson, res, error, fallbackCode) {
  const status = Number(error?.statusCode || 400);
  const stage = String(error?.stage || error?.details?.stage || "").trim();
  sendJson(res, status, {
    ok: false,
    error: String(error?.code || fallbackCode || "AI_ROUTE_FAILED"),
    stage,
    message: error instanceof Error ? redactSensitiveValue(error.message, { maxStringLength: 500 }) : "AI route failed.",
    details: redactSensitiveValue({
      ...(error?.details && typeof error.details === "object" ? error.details : {}),
      ...(stage ? { stage } : {}),
    }, { maxStringLength: 2000 }),
  });
}

function serializeRouteError(error, fallbackCode) {
  const status = Number(error?.statusCode || 400);
  const stage = String(error?.stage || error?.details?.stage || "").trim();
  return redactSensitiveValue({
    ok: false,
    error: String(error?.code || fallbackCode || "AI_ROUTE_FAILED"),
    stage,
    status,
    message: error instanceof Error ? error.message : "AI route failed.",
    details: {
      ...(error?.details && typeof error.details === "object" ? error.details : {}),
      ...(stage ? { stage } : {}),
    },
  }, { maxStringLength: 2000 });
}

function startSseResponse(res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  if (typeof res.flushHeaders === "function") {
    try {
      res.flushHeaders();
    } catch {
      // ignore unavailable flush support
    }
  }
}

function writeSseEvent(res, event, payload) {
  const safeEvent = String(event || "message").replace(/[^\w.-]/g, "") || "message";
  const safePayload = redactSensitiveValue(payload && typeof payload === "object" ? payload : {}, { maxStringLength: 12000 });
  res.write(`event: ${safeEvent}\n`);
  res.write(`data: ${JSON.stringify(safePayload)}\n\n`);
}

function splitTextDeltas(text, chunkSize = AI_ASSISTANT_STREAM_TEXT_CHUNK_SIZE) {
  const value = String(text || "");
  if (!value) return [];
  const size = Math.max(12, Math.min(120, Number.parseInt(String(chunkSize), 10) || AI_ASSISTANT_STREAM_TEXT_CHUNK_SIZE));
  const chunks = [];
  for (let index = 0; index < value.length; index += size) {
    chunks.push(value.slice(index, index + size));
  }
  return chunks;
}

function normalizeRouteObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function resolveNowIso(now) {
  try {
    const value = typeof now === "function" ? now() : now;
    const date = value ? new Date(value) : new Date();
    if (Number.isFinite(date.getTime())) return date.toISOString();
  } catch {
    // Fall back to wall-clock time when a test clock is malformed.
  }
  return new Date().toISOString();
}

function buildPromptAuditRecord(result, options = {}) {
  const createdAt = resolveNowIso(options.now);
  const snapshot = normalizeRouteObject(result?.contextSnapshot);
  const modelInput = normalizeRouteObject(snapshot.modelInput);
  const modelOutput = normalizeRouteObject(snapshot.modelOutput);
  const turnTrace = normalizeRouteObject(snapshot.turnTrace);
  return redactSensitiveValue({
    schema: AI_ASSISTANT_PROMPT_AUDIT_SCHEMA,
    recordId: `prompt_audit_${createdAt.replace(/[^0-9]/g, "").slice(0, 14)}_${String(result?.requestId || "assistant").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80)}`,
    createdAt,
    requestId: result?.requestId || "",
    mode: result?.mode || "",
    provider: result?.provider || {},
    promptContracts: {
      planner: snapshot.promptContracts?.planner || AI_PLANNER_PROMPT_SCHEMA,
      writer: snapshot.promptContracts?.writer || "",
      contextEnvelope: snapshot.promptContracts?.contextEnvelope || AI_CONTEXT_ENVELOPE_SCHEMA,
      writerTask: snapshot.promptContracts?.writerTask || (result?.decision?.writerTask ? AI_WRITER_TASK_SCHEMA : ""),
      modelInput: modelInput.schema || AI_MODEL_INPUT_TRACE_SCHEMA,
      turnTrace: turnTrace.schema || AI_TURN_TRACE_SCHEMA,
    },
    decision: result?.decision || {},
    semanticAction: snapshot.semanticAction || result?.semanticAction || result?.decision?.semanticAction || {},
    actionReview: snapshot.actionReview || result?.actionReview || result?.decision?.actionReview || {},
    semanticFeedback: snapshot.semanticFeedback || {},
    contextRequest: snapshot.contextRequest || result?.contextRequest || result?.decision?.contextRequest || null,
    contextGrant: snapshot.contextGrant || result?.contextSnapshot?.contextGrant || null,
    contextGuard: snapshot.contextGuard || result?.contextGuard || result?.decision?.contextGuard || null,
    contextAccessPolicy: snapshot.context?.contextAccessPolicy || result?.contextSnapshot?.context?.contextAccessPolicy || null,
    context: snapshot.context || {},
    memory: {
      included: snapshot.memory?.included === true,
      mode: snapshot.memory?.mode || "",
      action: snapshot.memory?.action || "",
      count: Number(snapshot.memory?.count || 0) || 0,
      entries: Array.isArray(snapshot.memory?.entries) ? snapshot.memory.entries : [],
      promptBlock: snapshot.memory?.promptBlock || "",
    },
    modelInput,
    modelOutput,
    turnTrace,
    workflow: result?.workflow
      ? {
        action: result.workflow?.request?.action || "",
        artifactKinds: Array.isArray(result.workflow?.artifacts)
          ? result.workflow.artifacts.map((artifact) => artifact?.kind || "").filter(Boolean)
          : [],
      }
      : null,
    answerPreview: String(result?.answer || "").trim().slice(0, 1000),
  }, { maxStringLength: 60000 });
}

function getPromptAuditDir(dataDir) {
  return path.join(dataDir, "ai-logs", "assistant");
}

function appendPromptAuditRecord(dataDir, result, options = {}) {
  const record = buildPromptAuditRecord(result, options);
  const auditDir = getPromptAuditDir(dataDir);
  const filePath = path.join(auditDir, `${record.createdAt.slice(0, 10)}.jsonl`);
  fs.mkdirSync(auditDir, { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, "utf8");
  return {
    schema: AI_ASSISTANT_PROMPT_AUDIT_SCHEMA,
    ok: true,
    recordId: record.recordId,
    file: path.relative(dataDir, filePath),
    createdAt: record.createdAt,
  };
}

function attachPromptAudit(dataDir, result, options = {}) {
  if (!result || typeof result !== "object") return null;
  try {
    result.promptAudit = appendPromptAuditRecord(dataDir, result, options);
    return result.promptAudit;
  } catch (error) {
    result.promptAudit = {
      schema: AI_ASSISTANT_PROMPT_AUDIT_SCHEMA,
      ok: false,
      error: String(error?.code || error?.message || "AI_PROMPT_AUDIT_WRITE_FAILED").slice(0, 160),
    };
    return result.promptAudit;
  }
}

function readPromptAuditRecords(dataDir, limit) {
  const auditDir = getPromptAuditDir(dataDir);
  const maxRecords = Math.max(1, Math.min(100, Number.parseInt(String(limit || 20), 10) || 20));
  let files;
  try {
    files = fs.readdirSync(auditDir)
      .filter((file) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(file))
      .sort()
      .reverse();
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const records = [];
  for (const file of files) {
    const filePath = path.join(auditDir, file);
    const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean).reverse();
    for (const line of lines) {
      try {
        records.push(JSON.parse(line));
      } catch {
        // Skip malformed historical audit lines without breaking the inspector.
      }
      if (records.length >= maxRecords) return records;
    }
  }
  return records;
}

function collectWorkflowPendingEvents(workflow) {
  const result = workflow?.result && typeof workflow.result === "object" ? workflow.result : {};
  const artifacts = Array.isArray(workflow?.artifacts) ? workflow.artifacts : [];
  const events = [];
  for (const artifact of artifacts) {
    if (artifact?.kind === "schedule_draft" && artifact.draft) {
      events.push({
        kind: "schedule_draft",
        artifact,
        draft: artifact.draft,
      });
    }
    if (artifact?.kind === "memory_proposal" && artifact.proposal) {
      events.push({
        kind: "memory_proposal",
        artifact,
        proposal: artifact.proposal,
      });
    }
  }
  if (workflow?.request?.action === "parse_task" && Array.isArray(result.items) && result.items.length) {
    events.push({
      kind: "todo_draft",
      action: "parse_task",
      result: { items: result.items },
    });
  }
  if (workflow?.request?.action === "breakdown_task" && Array.isArray(result.children) && result.children.length) {
    events.push({
      kind: "todo_draft",
      action: "breakdown_task",
      result: { items: result.children },
    });
  }
  return events;
}

function createAiRoutes(options = {}) {
  const sendJson = options.sendJson;
  const collectRequestBody = options.collectRequestBody;
  const parseJsonBody = options.parseJsonBody;
  if (typeof sendJson !== "function" || typeof collectRequestBody !== "function" || typeof parseJsonBody !== "function") {
    throw new Error("AI routes require sendJson, collectRequestBody, and parseJsonBody helpers.");
  }

  const store = createAiConfigStore({
    dataDir: options.dataDir,
    env: options.env || process.env,
  });
  const domainModules = createDomainModuleRegistry(options.domainModules ? { modules: options.domainModules } : {});
  const memoryStore = createAiMemoryStore({
    dataDir: options.dataDir,
    now: options.now,
  });
  const draftStore = createAiDraftStore({
    dataDir: options.dataDir,
    now: options.now,
  });
  const mcpRuntime = createMcpToolRuntime({
    dataDir: options.dataDir,
    draftStore,
    memoryStore,
    now: options.now,
    packageVersion: options.packageVersion,
  });
  const dataDir = options.dataDir ? path.resolve(options.dataDir) : process.cwd();
  const maxBodyBytes = Number.isInteger(options.maxBodyBytes) ? options.maxBodyBytes : AI_ROUTE_MAX_BODY_BYTES;

  async function readRequestJson(req) {
    const rawBody = await collectRequestBody(req, maxBodyBytes);
    return parseJsonBody(rawBody);
  }

  async function readProviderErrorText(response) {
    try {
      return (await response.text()).slice(0, 2000);
    } catch {
      return "";
    }
  }

  async function pipeProviderStream(response, res) {
    if (!response.body || typeof response.body.getReader !== "function") {
      throw createProviderError("AI_PROVIDER_STREAM_UNAVAILABLE", "Provider response stream is unavailable.", 502);
    }
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
    });
    const reader = response.body.getReader();
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        if (next.value) res.write(Buffer.from(next.value));
      }
    } finally {
      res.end();
      if (typeof reader.releaseLock === "function") reader.releaseLock();
    }
  }

  async function emitAssistantTurnResult(res, result) {
    const delayMs = Object.prototype.hasOwnProperty.call(options, "aiStreamChunkDelayMs")
      ? Number(options.aiStreamChunkDelayMs)
      : AI_ASSISTANT_STREAM_TEXT_DELAY_MS;
    const answer = String(result?.answer || "").trim();
    const chunks = splitTextDeltas(answer);
    for (const chunk of chunks) {
      writeSseEvent(res, "text_delta", {
        schema: "guanshi-ai-run-event-v1",
        type: "text_delta",
        delta: chunk,
        requestId: result?.requestId || "",
      });
      await delay(delayMs);
    }
    if (result?.workflow) {
      writeSseEvent(res, "workflow_result", {
        schema: "guanshi-ai-run-event-v1",
        type: "workflow_result",
        requestId: result.requestId,
        action: result.workflow?.request?.action || "",
        workflow: result.workflow,
      });
      for (const pending of collectWorkflowPendingEvents(result.workflow)) {
        writeSseEvent(res, "pending_created", {
          schema: "guanshi-ai-run-event-v1",
          type: "pending_created",
          requestId: result.requestId,
          pending,
        });
      }
    }
  }

  async function emitAssistantAnswerWriterStream(res, plannerResult, runId) {
    writeSseEvent(res, "status", {
      schema: "guanshi-ai-run-event-v1",
      type: "status",
      runId,
      requestId: plannerResult.request.requestId,
      stage: "answer_writer",
      label: "生成回答",
    });
    const writerMessages = buildAnswerWriterMessages(plannerResult.request, plannerResult.decision, plannerResult.toolCatalog, {
      modelContext: plannerResult.modelContext,
      memoryPromptBlock: plannerResult.memoryPromptBlock,
      memoryStore,
    });
    const visibleStream = createAssistantAnswerStreamFilter((delta) => {
      writeSseEvent(res, "text_delta", {
        schema: "guanshi-ai-run-event-v1",
        type: "text_delta",
        runId,
        requestId: plannerResult.request.requestId,
        delta,
      });
    });
    const writerResult = await streamProviderChatText(plannerResult.provider, {
      messages: writerMessages,
      allowExternalRequest: true,
      temperature: 0.4,
      maxTokens: 1400,
    }, {
      env: options.env || process.env,
      fetchImpl: options.fetchImpl,
      allowExternalRequest: true,
      onDelta(delta) {
        visibleStream.push(delta);
      },
    });
    visibleStream.flush();
    const writerAnswer = sanitizeAssistantAnswerText(writerResult.text);
    const answer = writerAnswer || sanitizeAssistantAnswerText(plannerResult.decision.handoff || plannerResult.providerText);
    if (!writerAnswer && answer) {
      for (const chunk of splitTextDeltas(answer)) {
        writeSseEvent(res, "text_delta", {
          schema: "guanshi-ai-run-event-v1",
          type: "text_delta",
          runId,
          requestId: plannerResult.request.requestId,
          delta: chunk,
        });
      }
    }
    return buildAssistantResultFromPlan(plannerResult, null, {
      answer,
      stream: true,
      writerMessages,
      writerOutput: writerAnswer || answer,
      writerRequestTrace: writerResult.requestTrace,
      writerResponseTrace: writerResult.responseTrace,
      now: options.now,
    });
  }

  async function handle(req, res, route) {
    const method = route?.method || req.method || "GET";
    const pathname = route?.pathname || "";
    if (!pathname.startsWith("/api/ai/")) return false;

    if (method === "GET" && pathname === "/api/ai/providers") {
      sendJson(res, 200, {
        ok: true,
        message: "AI providers loaded",
        result: {
          providerTypes: listProviderTypes(),
          config: store.readSanitizedConfig(),
        },
      });
      return true;
    }

    if (method === "GET" && pathname === "/api/ai/config") {
      sendJson(res, 200, {
        ok: true,
        message: "AI config loaded",
        result: store.readSanitizedConfig(),
      });
      return true;
    }

    if (method === "GET" && pathname === "/api/ai/modules") {
      const includeDisabled = route?.requestUrl?.searchParams?.get("includeDisabled") === "true";
      sendJson(res, 200, {
        ok: true,
        message: "AI domain modules loaded",
        result: domainModules.listModules({ includeDisabled }),
      });
      return true;
    }

    if (method === "GET" && pathname === "/api/ai/action-registry") {
      const moduleId = route?.requestUrl?.searchParams?.get("module") || "time";
      const includeDisabled = route?.requestUrl?.searchParams?.get("includeDisabled") === "true";
      try {
        sendJson(res, 200, {
          ok: true,
          message: "AI action registry loaded",
          result: moduleId ? domainModules.getActionRegistry(moduleId) : domainModules.listActionRegistries({ includeDisabled }),
        });
      } catch (error) {
        sendRouteError(sendJson, res, error, "AI_ACTION_REGISTRY_READ_FAILED");
      }
      return true;
    }

    const domainModuleToolsMatch = pathname.match(/^\/api\/ai\/modules\/([^/]+)\/tools$/);
    if (method === "GET" && domainModuleToolsMatch) {
      try {
        const moduleId = decodeURIComponent(domainModuleToolsMatch[1]);
        sendJson(res, 200, {
          ok: true,
          message: "AI domain module tools loaded",
          result: domainModules.listTools(moduleId),
        });
      } catch (error) {
        sendRouteError(sendJson, res, error, "AI_DOMAIN_MODULE_TOOLS_FAILED");
      }
      return true;
    }

    const domainModuleMatch = pathname.match(/^\/api\/ai\/modules\/([^/]+)$/);
    if (method === "GET" && domainModuleMatch) {
      try {
        const moduleId = decodeURIComponent(domainModuleMatch[1]);
        sendJson(res, 200, {
          ok: true,
          message: "AI domain module loaded",
          result: {
            module: domainModules.getModule(moduleId),
          },
        });
      } catch (error) {
        sendRouteError(sendJson, res, error, "AI_DOMAIN_MODULE_READ_FAILED");
      }
      return true;
    }

    if (method === "GET" && pathname === "/api/ai/mcp/status") {
      const clientId = route?.requestUrl?.searchParams?.get("clientId") || "";
      const result = mcpRuntime.callTool("guanshi.get_status", {}, { clientId });
      sendJson(res, result.isError ? 400 : 200, {
        ok: !result.isError,
        message: result.isError ? "Guanshi MCP status failed" : "Guanshi MCP status loaded",
        result,
      });
      return true;
    }

    if (method === "GET" && pathname === "/api/ai/mcp/tools") {
      const clientId = route?.requestUrl?.searchParams?.get("clientId") || "";
      sendJson(res, 200, {
        ok: true,
        message: "Guanshi MCP tools loaded",
        result: mcpRuntime.listTools(clientId),
      });
      return true;
    }

    if (method === "POST" && pathname === "/api/ai/mcp/call") {
      try {
        const parsed = await readRequestJson(req);
        const toolName = parsed?.tool || parsed?.name;
        const args = parsed?.arguments && typeof parsed.arguments === "object" && !Array.isArray(parsed.arguments)
          ? parsed.arguments
          : parsed?.args && typeof parsed.args === "object" && !Array.isArray(parsed.args)
            ? parsed.args
            : {};
        const result = mcpRuntime.callTool(toolName, args, { clientId: parsed?.clientId || args.clientId });
        sendJson(res, result.isError ? 400 : 200, {
          ok: !result.isError,
          message: result.isError ? "Guanshi MCP tool failed" : "Guanshi MCP tool completed",
          result,
        });
      } catch (error) {
        sendRouteError(sendJson, res, error, "AI_MCP_TOOL_CALL_FAILED");
      }
      return true;
    }

    if (method === "POST" && pathname === "/api/ai/mcp/jsonrpc") {
      try {
        const parsed = await readRequestJson(req);
        const messages = Array.isArray(parsed) ? parsed : [parsed];
        const responses = messages.map((message) => mcpRuntime.handleJsonRpcMessage(message)).filter(Boolean);
        sendJson(res, 200, {
          ok: true,
          message: "Guanshi MCP JSON-RPC handled",
          result: Array.isArray(parsed) ? responses : responses[0] || null,
        });
      } catch (error) {
        sendRouteError(sendJson, res, error, "AI_MCP_JSONRPC_FAILED");
      }
      return true;
    }

    if (method === "POST" && pathname === "/api/ai/actions") {
      try {
        const parsed = await readRequestJson(req);
        const workflow = executeAiWorkflow(parsed, {
          draftStore,
          memoryStore,
        }, {
          now: options.now,
        });
        sendJson(res, 200, {
          ok: true,
          message: "AI action completed",
          result: workflow,
        });
      } catch (error) {
        sendRouteError(sendJson, res, error, "AI_ACTION_FAILED");
      }
      return true;
    }

    if (method === "POST" && pathname === "/api/ai/actions/review") {
      try {
        const parsed = await readRequestJson(req);
        const requestedTool = parsed?.toolId || parsed?.tool || parsed?.decision?.tool || "";
        let tool = parsed?.toolConfig || parsed?.tool || {};
        if (typeof requestedTool === "string" && requestedTool.includes(".")) {
          try {
            tool = domainModules.getTool(requestedTool);
          } catch {
            tool = { tool_id: requestedTool, disabled: true };
          }
        }
        const result = reviewActionPolicy({
          ...parsed,
          tool,
        });
        sendJson(res, result.status === "blocked" ? 400 : 200, {
          ok: result.status !== "blocked",
          message: result.status === "blocked" ? "AI action review blocked" : "AI action review completed",
          result,
        });
      } catch (error) {
        sendRouteError(sendJson, res, error, "AI_ACTION_REVIEW_FAILED");
      }
      return true;
    }

    if (method === "GET" && pathname === "/api/ai/assistant/audit") {
      try {
        const limit = route?.requestUrl?.searchParams?.get("limit") || "20";
        sendJson(res, 200, {
          ok: true,
          message: "AI assistant prompt audit loaded",
          result: {
            schema: AI_ASSISTANT_PROMPT_AUDIT_SCHEMA,
            records: readPromptAuditRecords(dataDir, limit),
          },
        });
      } catch (error) {
        sendRouteError(sendJson, res, error, "AI_ASSISTANT_PROMPT_AUDIT_READ_FAILED");
      }
      return true;
    }

    if (method === "POST" && pathname === "/api/ai/assistant/stream") {
      startSseResponse(res);
      const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const emitRouteAssistantEvent = (event) => {
        if (!event?.type) return;
        if (event.type === "workflow_result") return;
        writeSseEvent(res, event.type, {
          schema: "guanshi-ai-run-event-v1",
          runId,
          ...event,
        });
      };
      try {
        writeSseEvent(res, "run_started", {
          schema: "guanshi-ai-run-event-v1",
          type: "run_started",
          runId,
        });
        const parsed = await readRequestJson(req);
        const plannerResult = await planAssistantTurn(parsed, {
          domainModules,
          env: options.env || process.env,
          fetchImpl: options.fetchImpl,
          getProvider: (providerId) => store.getProvider(providerId),
          memoryStore,
          now: options.now,
          onEvent: emitRouteAssistantEvent,
        });
        let result;
        if (plannerResult.decision.type === "need_more_context") {
          result = buildAssistantResultFromPlan(plannerResult, null, { stream: false, now: options.now });
          await emitAssistantTurnResult(res, result);
        } else if (plannerResult.decision.type === "answer") {
          result = await emitAssistantAnswerWriterStream(res, plannerResult, runId);
        } else {
          const workflow = executeAssistantToolDecision(plannerResult, {
            draftStore,
            memoryStore,
          }, {
            now: options.now,
            onEvent: emitRouteAssistantEvent,
          });
          result = buildAssistantResultFromPlan(plannerResult, workflow, { stream: false, now: options.now });
          await emitAssistantTurnResult(res, result);
        }
        attachPromptAudit(dataDir, result, { now: options.now });
        writeSseEvent(res, "done", {
          schema: "guanshi-ai-run-event-v1",
          type: "done",
          runId,
          requestId: result.requestId,
          result,
        });
      } catch (error) {
        writeSseEvent(res, "error", {
          schema: "guanshi-ai-run-event-v1",
          type: "error",
          runId,
          ...serializeRouteError(error, "AI_ASSISTANT_STREAM_FAILED"),
        });
      } finally {
        res.end();
      }
      return true;
    }

    if (method === "POST" && pathname === "/api/ai/assistant") {
      try {
        const parsed = await readRequestJson(req);
        const result = await executeAiAssistantTurn(parsed, {
          draftStore,
          memoryStore,
        }, {
          domainModules,
          env: options.env || process.env,
          fetchImpl: options.fetchImpl,
          getProvider: (providerId) => store.getProvider(providerId),
          now: options.now,
        });
        attachPromptAudit(dataDir, result, { now: options.now });
        sendJson(res, 200, {
          ok: true,
          message: result.mode === "need_more_context" ? "AI assistant requested more context" : result.mode === "tool" ? "AI assistant selected a tool" : "AI assistant answered",
          result,
        });
      } catch (error) {
        sendRouteError(sendJson, res, error, "AI_ASSISTANT_FAILED");
      }
      return true;
    }

    if (method === "GET" && pathname === "/api/ai/memory") {
      sendJson(res, 200, {
        ok: true,
        message: "AI memory loaded",
        result: {
          entries: memoryStore.listEntries(),
          config: memoryStore.readConfig(),
        },
      });
      return true;
    }

    if (method === "GET" && pathname === "/api/ai/memory/projections") {
      const action = route?.requestUrl?.searchParams?.get("action") || "";
      sendJson(res, 200, {
        ok: true,
        message: "AI memory projections loaded",
        result: {
          action,
          projections: memoryStore.getEngineProjections(action),
        },
      });
      return true;
    }

    if (method === "GET" && pathname === "/api/ai/memory/system-prompt") {
      const searchParams = route?.requestUrl?.searchParams;
      const action = searchParams?.get("action") || "";
      const includeMemory = searchParams?.get("includeMemory") || "active_index_only";
      const maxItems = searchParams?.get("maxItems") || "";
      const memoryContext = buildModelMemoryContext({
        memoryStore,
        action,
        contextPolicy: {
          includeMemory,
          ...(maxItems ? { maxItems } : {}),
        },
      });
      sendJson(res, 200, {
        ok: true,
        message: "AI memory system prompt loaded",
        result: {
          action,
          body: renderModelMemoryPromptBlock(memoryContext),
          memory: summarizeModelMemoryContext(memoryContext),
        },
      });
      return true;
    }

    if (method === "GET" && pathname === "/api/ai/memory/proposals") {
      const status = route?.requestUrl?.searchParams?.get("status") || "";
      sendJson(res, 200, {
        ok: true,
        message: "AI memory proposals loaded",
        result: {
          proposals: memoryStore.listProposals(status),
        },
      });
      return true;
    }

    if (method === "POST" && pathname === "/api/ai/memory/proposals") {
      try {
        const parsed = await readRequestJson(req);
        const proposal = memoryStore.createProposal(parsed);
        sendJson(res, 200, {
          ok: true,
          message: "AI memory proposal created",
          result: { proposal },
        });
      } catch (error) {
        sendRouteError(sendJson, res, error, "AI_MEMORY_PROPOSAL_CREATE_FAILED");
      }
      return true;
    }

    const memoryProposalConfirmMatch = pathname.match(/^\/api\/ai\/memory\/proposals\/([^/]+)\/confirm$/);
    if (method === "POST" && memoryProposalConfirmMatch) {
      try {
        const parsed = await readRequestJson(req);
        const result = memoryStore.confirmProposal(memoryProposalConfirmMatch[1], parsed);
        sendJson(res, 200, {
          ok: true,
          message: "AI memory proposal confirmed",
          result,
        });
      } catch (error) {
        sendRouteError(sendJson, res, error, "AI_MEMORY_PROPOSAL_CONFIRM_FAILED");
      }
      return true;
    }

    const memoryProposalRejectMatch = pathname.match(/^\/api\/ai\/memory\/proposals\/([^/]+)\/reject$/);
    if (method === "POST" && memoryProposalRejectMatch) {
      try {
        const parsed = await readRequestJson(req);
        const proposal = memoryStore.rejectProposal(memoryProposalRejectMatch[1], parsed);
        sendJson(res, 200, {
          ok: true,
          message: "AI memory proposal rejected",
          result: { proposal },
        });
      } catch (error) {
        sendRouteError(sendJson, res, error, "AI_MEMORY_PROPOSAL_REJECT_FAILED");
      }
      return true;
    }

    const memoryDisableMatch = pathname.match(/^\/api\/ai\/memory\/([^/]+)\/disable$/);
    if (method === "POST" && memoryDisableMatch) {
      try {
        const entry = memoryStore.setEntryStatus(memoryDisableMatch[1], "disabled");
        sendJson(res, 200, {
          ok: true,
          message: "AI memory disabled",
          result: { entry },
        });
      } catch (error) {
        sendRouteError(sendJson, res, error, "AI_MEMORY_DISABLE_FAILED");
      }
      return true;
    }

    const memoryRestoreMatch = pathname.match(/^\/api\/ai\/memory\/([^/]+)\/restore$/);
    if (method === "POST" && memoryRestoreMatch) {
      try {
        const entry = memoryStore.setEntryStatus(memoryRestoreMatch[1], "active");
        sendJson(res, 200, {
          ok: true,
          message: "AI memory restored",
          result: { entry },
        });
      } catch (error) {
        sendRouteError(sendJson, res, error, "AI_MEMORY_RESTORE_FAILED");
      }
      return true;
    }

    const memoryEntryMatch = pathname.match(/^\/api\/ai\/memory\/([^/]+)$/);
    if (method === "GET" && memoryEntryMatch) {
      try {
        const entry = memoryStore.getEntry(memoryEntryMatch[1]);
        sendJson(res, 200, {
          ok: true,
          message: "AI memory entry loaded",
          result: { entry },
        });
      } catch (error) {
        sendRouteError(sendJson, res, error, "AI_MEMORY_ENTRY_READ_FAILED");
      }
      return true;
    }

    if (method === "PATCH" && memoryEntryMatch) {
      try {
        const parsed = await readRequestJson(req);
        const entry = memoryStore.patchEntry(memoryEntryMatch[1], parsed);
        sendJson(res, 200, {
          ok: true,
          message: "AI memory entry updated",
          result: { entry },
        });
      } catch (error) {
        sendRouteError(sendJson, res, error, "AI_MEMORY_ENTRY_UPDATE_FAILED");
      }
      return true;
    }

    if (method === "DELETE" && memoryEntryMatch) {
      try {
        const parsed = await readRequestJson(req);
        const result = memoryStore.deleteEntry(memoryEntryMatch[1], parsed);
        sendJson(res, 200, {
          ok: true,
          message: "AI memory entry deleted",
          result,
        });
      } catch (error) {
        sendRouteError(sendJson, res, error, "AI_MEMORY_ENTRY_DELETE_FAILED");
      }
      return true;
    }

    if (method === "GET" && pathname === "/api/ai/schedule-drafts") {
      const status = route?.requestUrl?.searchParams?.get("status") || "";
      sendJson(res, 200, {
        ok: true,
        message: "AI schedule drafts loaded",
        result: {
          drafts: draftStore.listDrafts(status),
        },
      });
      return true;
    }

    if (method === "POST" && pathname === "/api/ai/schedule-drafts") {
      try {
        const parsed = await readRequestJson(req);
        const action = parsed?.action || "plan_today";
        const input = {
          ...parsed,
          memoryProjections: Array.isArray(parsed?.memoryProjections)
            ? parsed.memoryProjections
            : memoryStore.getEngineProjections(action),
        };
        const draft = draftStore.createDraft(input);
        sendJson(res, 200, {
          ok: true,
          message: "AI schedule draft created",
          result: { draft },
        });
      } catch (error) {
        sendRouteError(sendJson, res, error, "AI_SCHEDULE_DRAFT_CREATE_FAILED");
      }
      return true;
    }

    const scheduleDraftConfirmMatch = pathname.match(/^\/api\/ai\/schedule-drafts\/([^/]+)\/confirm$/);
    if (method === "POST" && scheduleDraftConfirmMatch) {
      try {
        const draft = draftStore.setDraftStatus(scheduleDraftConfirmMatch[1], "confirmed");
        sendJson(res, 200, {
          ok: true,
          message: "AI schedule draft confirmed",
          result: { draft },
        });
      } catch (error) {
        sendRouteError(sendJson, res, error, "AI_SCHEDULE_DRAFT_CONFIRM_FAILED");
      }
      return true;
    }

    const scheduleDraftRejectMatch = pathname.match(/^\/api\/ai\/schedule-drafts\/([^/]+)\/reject$/);
    if (method === "POST" && scheduleDraftRejectMatch) {
      try {
        const draft = draftStore.setDraftStatus(scheduleDraftRejectMatch[1], "rejected");
        sendJson(res, 200, {
          ok: true,
          message: "AI schedule draft rejected",
          result: { draft },
        });
      } catch (error) {
        sendRouteError(sendJson, res, error, "AI_SCHEDULE_DRAFT_REJECT_FAILED");
      }
      return true;
    }

    const scheduleDraftMatch = pathname.match(/^\/api\/ai\/schedule-drafts\/([^/]+)$/);
    if (method === "GET" && scheduleDraftMatch) {
      try {
        const draft = draftStore.getDraft(scheduleDraftMatch[1]);
        sendJson(res, 200, {
          ok: true,
          message: "AI schedule draft loaded",
          result: { draft },
        });
      } catch (error) {
        sendRouteError(sendJson, res, error, "AI_SCHEDULE_DRAFT_READ_FAILED");
      }
      return true;
    }

    if (method === "POST" && pathname === "/api/ai/config") {
      try {
        const parsed = await readRequestJson(req);
        store.saveConfig(parsed);
        sendJson(res, 200, {
          ok: true,
          message: "AI config saved",
          result: store.readSanitizedConfig(),
        });
      } catch (error) {
        const fallbackCode = error instanceof Error && error.message === "BODY_TOO_LARGE"
          ? "AI_CONFIG_BODY_TOO_LARGE"
          : "AI_CONFIG_SAVE_FAILED";
        const statusError = error instanceof Error && error.message === "BODY_TOO_LARGE"
          ? Object.assign(error, { statusCode: 413, code: fallbackCode })
          : error;
        sendRouteError(sendJson, res, statusError, fallbackCode);
      }
      return true;
    }

    if (method === "POST" && pathname === "/api/ai/providers/test") {
      try {
        const parsed = await readRequestJson(req);
        const provider = store.getProvider(parsed?.providerId);
        const result = parsed?.network === true
          ? await testProviderConnection(provider, {
            env: options.env || process.env,
            performNetworkCheck: true,
            timeoutMs: 8000,
          })
          : buildProviderHealth(provider, options.env || process.env);
        sendJson(res, 200, {
          ok: true,
          message: result.networkTested ? "AI provider network check completed" : "AI provider config checked",
          result,
        });
      } catch (error) {
        const fallbackCode = error instanceof Error && error.message === "BODY_TOO_LARGE"
          ? "AI_PROVIDER_TEST_BODY_TOO_LARGE"
          : "AI_PROVIDER_TEST_FAILED";
        const statusError = error instanceof Error && error.message === "BODY_TOO_LARGE"
          ? Object.assign(error, { statusCode: 413, code: fallbackCode })
          : error;
        sendRouteError(sendJson, res, statusError, fallbackCode);
      }
      return true;
    }

    if (method === "POST" && pathname === "/api/ai/chat") {
      try {
        const parsed = await readRequestJson(req);
        const provider = store.getProvider(parsed?.providerId);
        const { chatRequest, response } = await fetchProviderChat(provider, parsed, {
          env: options.env || process.env,
          fetchImpl: options.fetchImpl,
          allowExternalRequest: parsed?.allowExternalRequest === true,
          stream: false,
        });
        const providerText = await response.text();
        if (!response.ok) {
          throw createProviderError("AI_PROVIDER_CHAT_HTTP_STATUS", "AI provider chat request failed.", 502, {
            httpStatus: response.status,
            body: providerText.slice(0, 2000),
          });
        }
        let providerPayload = providerText;
        try {
          providerPayload = JSON.parse(providerText);
        } catch {
          providerPayload = providerText.slice(0, 12000);
        }
        const safeProviderPayload = redactSensitiveValue(providerPayload, { maxStringLength: 12000 });
        sendJson(res, 200, {
          ok: true,
          message: "AI provider chat completed",
          result: {
            providerType: chatRequest.providerType,
            stream: false,
            providerPayload: safeProviderPayload,
          },
        });
      } catch (error) {
        sendRouteError(sendJson, res, error, "AI_PROVIDER_CHAT_FAILED");
      }
      return true;
    }

    if (method === "POST" && pathname === "/api/ai/chat/stream") {
      try {
        const parsed = await readRequestJson(req);
        const provider = store.getProvider(parsed?.providerId);
        const { response } = await fetchProviderChat(provider, parsed, {
          env: options.env || process.env,
          fetchImpl: options.fetchImpl,
          allowExternalRequest: parsed?.allowExternalRequest === true,
          stream: true,
        });
        if (!response.ok) {
          const body = await readProviderErrorText(response);
          throw createProviderError("AI_PROVIDER_STREAM_HTTP_STATUS", "AI provider stream request failed.", 502, {
            httpStatus: response.status,
            body,
          });
        }
        await pipeProviderStream(response, res);
      } catch (error) {
        if (res.headersSent) {
          try {
            res.end();
          } catch {
            // ignore stream cleanup failure
          }
        } else {
          sendRouteError(sendJson, res, error, "AI_PROVIDER_STREAM_FAILED");
        }
      }
      return true;
    }

    sendJson(res, 404, {
      ok: false,
      error: "AI_ROUTE_NOT_FOUND",
      message: "AI route was not found.",
    });
    return true;
  }

  return {
    handle,
    draftStore,
    memoryStore,
    store,
  };
}

module.exports = {
  createAiRoutes,
};
