"use strict";

const fs = require("fs");
const path = require("path");
const readline = require("readline");

const { createMcpToolRuntime } = require("./ai/ai-mcp-tools");

const SERVER_DIR = __dirname;
const DEV_ROOT = path.resolve(SERVER_DIR, "..", "..");
const IS_DEV_LAYOUT = fs.existsSync(path.join(DEV_ROOT, "src", "client", "index.html"));
const ROOT_DIR = IS_DEV_LAYOUT ? DEV_ROOT : path.resolve(SERVER_DIR, "..");
const DEFAULT_DATA_DIR = IS_DEV_LAYOUT ? ROOT_DIR : path.join(ROOT_DIR, ".runtime");
const DATA_DIR = process.env.GUANSHI_DATA_DIR || process.env.TIMEQUALITY_DATA_DIR
  ? path.resolve(process.env.GUANSHI_DATA_DIR || process.env.TIMEQUALITY_DATA_DIR)
  : DEFAULT_DATA_DIR;

function readPackageVersion() {
  const candidates = [
    path.join(SERVER_DIR, "package.json"),
    path.join(ROOT_DIR, "package.json"),
  ];
  for (const candidate of candidates) {
    try {
      return JSON.parse(fs.readFileSync(candidate, "utf8")).version || "";
    } catch {
      // Try the next layout. Development keeps package.json at the repo root;
      // generated runtime keeps it under .guanshi next to this entrypoint.
    }
  }
  return "";
}

const runtime = createMcpToolRuntime({
  dataDir: DATA_DIR,
  packageVersion: process.env.GUANSHI_MCP_PACKAGE_VERSION || readPackageVersion(),
});

function writeMessage(message) {
  if (!message) return;
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function handleRawLine(line) {
  const text = String(line || "").trim();
  if (!text) return;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    writeMessage({
      jsonrpc: "2.0",
      id: null,
      error: {
        code: -32700,
        message: "Parse error",
      },
    });
    return;
  }
  const messages = Array.isArray(parsed) ? parsed : [parsed];
  const responses = messages.map((message) => runtime.handleJsonRpcMessage(message)).filter(Boolean);
  if (Array.isArray(parsed)) {
    if (responses.length) writeMessage(responses);
    return;
  }
  if (responses[0]) writeMessage(responses[0]);
}

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

rl.on("line", handleRawLine);
