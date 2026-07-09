const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const SERVER_DIR = __dirname;
const DEV_ROOT = path.resolve(SERVER_DIR, "..", "..");
const DEV_CLIENT_DIR = path.join(DEV_ROOT, "src", "client");
const IS_DEV_LAYOUT = fs.existsSync(path.join(DEV_CLIENT_DIR, "index.html"));
const IS_RUNTIME_APP_LAYOUT = !IS_DEV_LAYOUT && fs.existsSync(path.join(SERVER_DIR, "client", "index.html"));
const ROOT_DIR = IS_DEV_LAYOUT ? DEV_ROOT : IS_RUNTIME_APP_LAYOUT ? path.resolve(SERVER_DIR, "..") : SERVER_DIR;
const CLIENT_DIR = IS_DEV_LAYOUT ? DEV_CLIENT_DIR : IS_RUNTIME_APP_LAYOUT ? path.join(SERVER_DIR, "client") : ROOT_DIR;
const PUBLIC_DIR = IS_DEV_LAYOUT
  ? path.join(ROOT_DIR, "public")
  : IS_RUNTIME_APP_LAYOUT
    ? path.join(SERVER_DIR, "public")
    : ROOT_DIR;
const RUNTIME_SCRIPTS_DIR = IS_DEV_LAYOUT
  ? path.join(ROOT_DIR, "runtime", "scripts")
  : IS_RUNTIME_APP_LAYOUT
    ? path.join(SERVER_DIR, "scripts")
    : path.join(ROOT_DIR, "scripts");
const PACKAGE_DIR = IS_DEV_LAYOUT ? ROOT_DIR : IS_RUNTIME_APP_LAYOUT ? SERVER_DIR : ROOT_DIR;
const DATA_DIR = process.env.TIMEQUALITY_DATA_DIR
  ? path.resolve(process.env.TIMEQUALITY_DATA_DIR)
  : ROOT_DIR;
const CALENDAR_SYNC_FILE_PATH = path.join(DATA_DIR, "calendar_sync.json");
const INTERNAL_UPDATE_STATE_FILE_PATH = path.join(DATA_DIR, "internal_update_state_v151.json");
const PORT = Number.parseInt(process.env.PORT || "8080", 10);
const HOST = process.env.HOST || "127.0.0.1";

if (DATA_DIR !== ROOT_DIR) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch {
    // ignore runtime directory creation failures; subsequent read/write will surface precise errors
  }
}

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};
const MAX_JSON_BODY_BYTES = 2 * 1024 * 1024;
const TODO_SYNC_STATES = new Set(["dirty", "synced", "conflict", "error"]);
const INTERNAL_UPDATE_ALLOWED_GITHUB_OWNER = "gumo1995";
const INTERNAL_UPDATE_ALLOWED_GITHUB_REPO = "guanshi-runtime";
const INTERNAL_UPDATE_STABLE_TAG_PATTERN = /^v(\d+)\.(\d+)\.(\d+)$/;
const INTERNAL_UPDATE_GIT_TIMEOUT_MS = 90000;
const MIN_SUPPORTED_NODE_MAJOR = 18;

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function isPathInside(filePath, baseDir) {
  const relativePath = path.relative(baseDir, filePath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function getStaticBases(relativePath) {
  const bases = [];
  if (relativePath === "index.html" || relativePath.endsWith(".css") || relativePath.endsWith(".js")) {
    bases.push(CLIENT_DIR);
  }
  if (
    relativePath === "favicon.ico" ||
    relativePath === "manifest.webmanifest" ||
    relativePath === "service-worker.js" ||
    relativePath.startsWith("assets/")
  ) {
    bases.push(PUBLIC_DIR);
  }
  if (!bases.length) bases.push(CLIENT_DIR, PUBLIC_DIR);
  return Array.from(new Set(bases));
}

function getSafePathname(requestPathname) {
  let decodedPath = "";
  try {
    decodedPath = decodeURIComponent(requestPathname);
  } catch {
    return null;
  }

  const normalized = path.normalize(decodedPath).replace(/^(\.\.[/\\])+/, "");
  const finalPath = normalized === "/" ? "/index.html" : normalized;
  const relativePath = finalPath.replace(/^[/\\]+/, "");
  let fallbackPath = "";
  for (const baseDir of getStaticBases(relativePath)) {
    const resolvedPath = path.resolve(baseDir, relativePath);
    if (!isPathInside(resolvedPath, baseDir)) continue;
    if (fs.existsSync(resolvedPath)) return resolvedPath;
    if (!fallbackPath) fallbackPath = resolvedPath;
  }
  return fallbackPath || null;
}

function runMacCalendarExportSwiftOnce() {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(RUNTIME_SCRIPTS_DIR, "export-mac-calendar.swift");
    const outputPath = CALENDAR_SYNC_FILE_PATH;
    const child = spawn(
      "xcrun",
      [
        "swift",
        scriptPath,
        "--output",
        outputPath,
        "--days-back",
        "30",
        "--days-forward",
        "60",
      ],
      { cwd: ROOT_DIR },
    );

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
        return;
      }

      reject(
        new Error(
          `swift exited with code ${code}. ${stderr.trim() || stdout.trim() || "No error output"}`,
        ),
      );
    });
  });
}

function runMacCalendarListCalendarsSwiftOnce() {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(RUNTIME_SCRIPTS_DIR, "list-mac-calendars.swift");
    const child = spawn("xcrun", ["swift", scriptPath], { cwd: ROOT_DIR });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `swift exited with code ${code}. ${stderr.trim() || stdout.trim() || "No error output"}`,
          ),
        );
        return;
      }

      try {
        const payload = JSON.parse(stdout.trim() || "{}");
        resolve(payload);
      } catch {
        reject(new Error("INVALID_CALENDAR_LIST_JSON"));
      }
    });
  });
}

function runMacReminderListListsSwiftOnce() {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(RUNTIME_SCRIPTS_DIR, "list-mac-reminder-lists.swift");
    const child = spawn("xcrun", ["swift", scriptPath], { cwd: ROOT_DIR });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `swift exited with code ${code}. ${stderr.trim() || stdout.trim() || "No error output"}`,
          ),
        );
        return;
      }

      try {
        const payload = JSON.parse(stdout.trim() || "{}");
        resolve(payload);
      } catch {
        reject(new Error("INVALID_REMINDER_LIST_JSON"));
      }
    });
  });
}

function collectRequestBody(req, maxBytes = MAX_JSON_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error("BODY_TOO_LARGE"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });

    req.on("error", (error) => {
      reject(error);
    });
  });
}

function parseJsonBody(raw) {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("INVALID_JSON");
  }
}

function createHttpError(code, message, statusCode = 400, details = {}) {
  const error = new Error(message || code);
  error.code = code;
  error.statusCode = statusCode;
  error.details = details && typeof details === "object" ? details : {};
  return error;
}

function readPackageVersion() {
  try {
    const raw = fs.readFileSync(path.join(PACKAGE_DIR, "package.json"), "utf8");
    const parsed = JSON.parse(raw);
    return String(parsed?.version || "").trim();
  } catch {
    return "";
  }
}

function parseStableUpdateVersion(value) {
  const match = INTERNAL_UPDATE_STABLE_TAG_PATTERN.exec(String(value || "").trim());
  if (!match) return null;
  const parts = match.slice(1).map((item) => Number.parseInt(item, 10));
  if (parts.some((item) => !Number.isInteger(item) || item < 0)) return null;
  return {
    tag: `v${parts[0]}.${parts[1]}.${parts[2]}`,
    version: `${parts[0]}.${parts[1]}.${parts[2]}`,
    parts,
  };
}

function parsePackageVersion(value) {
  const text = String(value || "").trim();
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (!match) return null;
  const parts = match.slice(1).map((item) => Number.parseInt(item, 10));
  if (parts.some((item) => !Number.isInteger(item) || item < 0)) return null;
  return {
    version: `${parts[0]}.${parts[1]}.${parts[2]}`,
    parts,
  };
}

function compareVersionParts(left, right) {
  const leftParts = Array.isArray(left?.parts) ? left.parts : [];
  const rightParts = Array.isArray(right?.parts) ? right.parts : [];
  for (let index = 0; index < 3; index += 1) {
    const leftValue = Number(leftParts[index] || 0);
    const rightValue = Number(rightParts[index] || 0);
    if (leftValue > rightValue) return 1;
    if (leftValue < rightValue) return -1;
  }
  return 0;
}

function parseGithubRemoteUrl(remoteUrl) {
  const text = String(remoteUrl || "").trim();
  if (!text) return null;

  const patterns = [
    /^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i,
    /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i,
    /^ssh:\/\/git@github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (!match) continue;
    return {
      owner: String(match[1] || "").trim().toLowerCase(),
      repo: String(match[2] || "").trim().toLowerCase(),
    };
  }

  return null;
}

function isAllowedInternalUpdateOrigin(remoteUrl) {
  const parsed = parseGithubRemoteUrl(remoteUrl);
  return Boolean(
    parsed &&
      parsed.owner === INTERNAL_UPDATE_ALLOWED_GITHUB_OWNER &&
      parsed.repo === INTERNAL_UPDATE_ALLOWED_GITHUB_REPO,
  );
}

function appendLimitedText(current, next, limit = 120000) {
  const combined = `${current || ""}${String(next || "")}`;
  if (combined.length <= limit) return combined;
  return combined.slice(combined.length - limit);
}

function runGitCommand(args, { timeoutMs = INTERNAL_UPDATE_GIT_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    if (!Array.isArray(args) || !args.length || args.some((item) => typeof item !== "string")) {
      reject(createHttpError("INVALID_GIT_ARGS", "Invalid git command arguments.", 500));
      return;
    }

    const child = spawn("git", args, {
      cwd: ROOT_DIR,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      reject(createHttpError("GIT_TIMEOUT", `git ${args.join(" ")} timed out.`, 504));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout = appendLimitedText(stdout, chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr = appendLimitedText(stderr, chunk);
    });

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(createHttpError("GIT_UNAVAILABLE", error.message || "git is unavailable.", 503));
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const result = {
        code,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      };
      if (code === 0) {
        resolve(result);
        return;
      }
      reject(
        createHttpError(
          "GIT_COMMAND_FAILED",
          result.stderr || result.stdout || `git ${args.join(" ")} failed with code ${code}.`,
          400,
          { args, code },
        ),
      );
    });
  });
}

async function runGitText(args, options) {
  const result = await runGitCommand(args, options);
  return result.stdout;
}

function normalizeGitStatusLines(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);
}

function normalizeTagList(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseNodeVersionMajor(versionText) {
  const match = String(versionText || "").match(/^v?(\d+)(?:\.\d+){0,2}$/);
  if (!match) return null;
  const major = Number.parseInt(match[1], 10);
  return Number.isFinite(major) ? major : null;
}

function createEnvironmentCheck({
  key,
  label,
  required = false,
  requiredFor = "",
  available = false,
  supported = available,
  recommended = supported,
  value = "",
  version = "",
  path: foundPath = "",
  message = "",
}) {
  return {
    key,
    label,
    required: Boolean(required),
    requiredFor: String(requiredFor || ""),
    available: Boolean(available),
    supported: Boolean(supported),
    recommended: Boolean(recommended),
    value: String(value || ""),
    version: String(version || ""),
    path: String(foundPath || ""),
    message: String(message || ""),
  };
}

function runEnvironmentCommand(command, args = [], { timeoutMs = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT_DIR,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      reject(new Error(`${command} check timed out.`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const output = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n").trim();
      if (code === 0) {
        resolve(output);
      } else {
        reject(new Error(output || `${command} exited with code ${code}.`));
      }
    });
  });
}

function collectMacChromeEnvironmentCheck() {
  if (process.platform !== "darwin") {
    return createEnvironmentCheck({
      key: "chrome",
      label: "Google Chrome",
      requiredFor: "standalone-app",
      available: false,
      supported: false,
      value: "不支持",
      message: "Chrome 独立窗口体验当前只按 macOS 用户版检查。",
    });
  }

  const candidates = [
    "/Applications/Google Chrome.app",
    path.join(process.env.HOME || "", "Applications", "Google Chrome.app"),
    "/System/Volumes/Data/Applications/Google Chrome.app",
  ].filter(Boolean);
  const chromePath = candidates.find((candidate) => fs.existsSync(candidate)) || "";

  return createEnvironmentCheck({
    key: "chrome",
    label: "Google Chrome",
    requiredFor: "standalone-app",
    available: Boolean(chromePath),
    supported: Boolean(chromePath),
    value: chromePath ? "已安装" : "未找到",
    path: chromePath,
    message: chromePath
      ? "可以使用 Chrome 独立窗口和安装为 App 的体验。"
      : "可以继续打开本地网页，但独立窗口和安装为 App 需要先安装 Google Chrome。",
  });
}

async function collectGitEnvironmentCheck() {
  try {
    const version = await runEnvironmentCommand("git", ["--version"], { timeoutMs: 5000 });
    return createEnvironmentCheck({
      key: "git",
      label: "Git",
      requiredFor: "online-update",
      available: true,
      supported: true,
      value: version || "已安装",
      version,
      message: "Git 可用，在线更新还需要当前文件夹保留 .git 且远端指向公开用户版仓库。",
    });
  } catch (error) {
    return createEnvironmentCheck({
      key: "git",
      label: "Git",
      requiredFor: "online-update",
      available: false,
      supported: false,
      value: "未找到",
      message: "未找到 Git。观时可以继续使用，但在线更新不可用。",
    });
  }
}

async function collectRuntimeEnvironmentStatus() {
  const nodeMajor = parseNodeVersionMajor(process.version);
  const nodeSupported = typeof nodeMajor === "number" && nodeMajor >= MIN_SUPPORTED_NODE_MAJOR;
  const nodeIsLts = Boolean(process.release?.lts);
  const checks = {
    macos: createEnvironmentCheck({
      key: "macos",
      label: "macOS",
      required: true,
      available: process.platform === "darwin",
      supported: process.platform === "darwin",
      value: process.platform === "darwin" ? `macOS（${process.arch}）` : process.platform,
      message: process.platform === "darwin" ? "支持当前 macOS 本地运行方式。" : "当前产品只支持 macOS。",
    }),
    node: createEnvironmentCheck({
      key: "node",
      label: "Node.js",
      required: true,
      available: true,
      supported: nodeSupported,
      recommended: nodeSupported && nodeIsLts,
      value: process.version,
      version: process.version,
      message: !nodeSupported
        ? `Node.js 版本过旧，请安装 Node.js LTS（建议 ${MIN_SUPPORTED_NODE_MAJOR} 或更高）。`
        : nodeIsLts
          ? "Node.js LTS 版本可用于观时本地服务。"
          : "当前 Node.js 版本可运行，但建议用户版安装 Node.js LTS。",
    }),
    chrome: collectMacChromeEnvironmentCheck(),
    git: await collectGitEnvironmentCheck(),
  };

  const warningMessages = [];
  if (checks.node.supported && !checks.node.recommended) warningMessages.push(checks.node.message);
  if (!checks.chrome.available) warningMessages.push(checks.chrome.message);
  if (!checks.git.available) warningMessages.push(checks.git.message);

  const blockingMessages = Object.values(checks)
    .filter((check) => check.required && !check.supported)
    .map((check) => check.message)
    .filter(Boolean);

  return {
    checkedAt: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    minimumNodeMajor: MIN_SUPPORTED_NODE_MAJOR,
    checks,
    summary: {
      canLaunch: checks.macos.supported && checks.node.supported,
      canUseChromeApp: checks.macos.supported && checks.chrome.available,
      canUseOnlineUpdatePrerequisites: checks.macos.supported && checks.node.supported && checks.git.available,
      blockingMessages,
      warningMessages,
    },
  };
}

function isInternalUpdateGitRepoAvailable() {
  return fs.existsSync(path.join(ROOT_DIR, ".git"));
}

async function collectInternalUpdateGitStatus({ includeDirty = true } = {}) {
  const packageVersion = readPackageVersion();
  const environment = await collectRuntimeEnvironmentStatus();
  const result = {
    platform: process.platform,
    supportedPlatform: process.platform === "darwin",
    sourceRoot: ROOT_DIR,
    packageVersion,
    environment,
    isGitRepo: isInternalUpdateGitRepoAvailable(),
    remoteUrl: "",
    originAllowed: false,
    branch: "",
    currentCommit: "",
    currentShortCommit: "",
    currentTag: "",
    dirty: false,
    dirtyFiles: [],
    canCheck: false,
    canApply: false,
    disabledReason: "",
    disabledMessage: "",
  };

  if (!result.supportedPlatform) {
    result.disabledReason = "unsupported-platform";
    result.disabledMessage = "内部更新仅支持 macOS。";
    return result;
  }

  if (!environment.checks.node.supported) {
    result.disabledReason = "unsupported-node-version";
    result.disabledMessage = environment.checks.node.message;
    return result;
  }

  if (!environment.checks.git.available) {
    result.disabledReason = "missing-git-command";
    result.disabledMessage = "未找到 Git。可以继续使用观时，但在线更新不可用。";
    return result;
  }

  if (!result.isGitRepo) {
    result.disabledReason = "missing-git-repo";
    result.disabledMessage = "当前运行目录不是源码 Git 仓库，内部更新不可用。";
    return result;
  }

  try {
    result.remoteUrl = await runGitText(["config", "--get", "remote.origin.url"], { timeoutMs: 10000 });
  } catch {
    result.remoteUrl = "";
  }
  result.originAllowed = isAllowedInternalUpdateOrigin(result.remoteUrl);
  if (!result.originAllowed) {
    result.disabledReason = "origin-not-allowed";
    result.disabledMessage = "当前 origin 不是允许的 GitHub 仓库。";
    return result;
  }

  try {
    result.currentCommit = await runGitText(["rev-parse", "HEAD"], { timeoutMs: 10000 });
    result.currentShortCommit = await runGitText(["rev-parse", "--short=12", "HEAD"], { timeoutMs: 10000 });
  } catch {
    result.currentCommit = "";
    result.currentShortCommit = "";
  }

  try {
    result.branch = await runGitText(["rev-parse", "--abbrev-ref", "HEAD"], { timeoutMs: 10000 });
  } catch {
    result.branch = "";
  }

  try {
    const tagsAtHead = normalizeTagList(await runGitText(["tag", "--points-at", "HEAD"], { timeoutMs: 10000 }));
    const stableTagsAtHead = tagsAtHead.filter((tag) => parseStableUpdateVersion(tag));
    result.currentTag = stableTagsAtHead[0] || "";
  } catch {
    result.currentTag = "";
  }

  if (includeDirty) {
    try {
      result.dirtyFiles = normalizeGitStatusLines(
        await runGitText(["status", "--porcelain"], { timeoutMs: 10000 }),
      );
      result.dirty = result.dirtyFiles.length > 0;
    } catch {
      result.dirtyFiles = [];
      result.dirty = false;
    }
  }

  result.canCheck = true;
  result.canApply = !result.dirty;
  if (result.dirty) {
    result.disabledReason = "dirty-worktree";
    result.disabledMessage = "当前源码目录有未提交改动，不能直接更新。";
  }
  return result;
}

async function ensureInternalUpdateEnvironment({ requireClean = false } = {}) {
  const status = await collectInternalUpdateGitStatus({ includeDirty: true });
  if (!status.supportedPlatform) {
    throw createHttpError("UNSUPPORTED_PLATFORM", status.disabledMessage, 400, { status });
  }
  if (status.disabledReason === "unsupported-node-version") {
    throw createHttpError("UNSUPPORTED_NODE_VERSION", status.disabledMessage, 400, { status });
  }
  if (status.disabledReason === "missing-git-command") {
    throw createHttpError("GIT_UNAVAILABLE", status.disabledMessage, 503, { status });
  }
  if (!status.isGitRepo) {
    throw createHttpError("MISSING_GIT_REPO", status.disabledMessage, 400, { status });
  }
  if (!status.originAllowed) {
    throw createHttpError("ORIGIN_NOT_ALLOWED", status.disabledMessage, 403, { status });
  }
  if (requireClean && status.dirty) {
    throw createHttpError("DIRTY_WORKTREE", status.disabledMessage, 409, { status });
  }
  return status;
}

function pickLatestStableTag(tags, currentVersionText) {
  const currentVersion = parsePackageVersion(currentVersionText);
  const stableTags = normalizeTagList(Array.isArray(tags) ? tags.join("\n") : tags)
    .map((tag) => parseStableUpdateVersion(tag))
    .filter(Boolean)
    .sort((left, right) => compareVersionParts(right, left));
  const latest = stableTags[0] || null;
  const newer = currentVersion
    ? stableTags.find((item) => compareVersionParts(item, currentVersion) > 0) || null
    : latest;
  return { latest, newer, stableTags };
}

async function getGitCommitForRef(ref) {
  return runGitText(["rev-list", "-n", "1", ref], { timeoutMs: 10000 });
}

async function getChangedFilesBetweenRefs(leftRef, rightRef, filePaths) {
  if (!leftRef || !rightRef || !Array.isArray(filePaths) || !filePaths.length) return [];
  const output = await runGitText(["diff", "--name-only", leftRef, rightRef, "--", ...filePaths], {
    timeoutMs: 10000,
  });
  return normalizeTagList(output);
}

function getInternalUpdatePackageFilePaths() {
  const packagePaths = [
    path.relative(ROOT_DIR, path.join(PACKAGE_DIR, "package.json")) || "package.json",
    path.relative(ROOT_DIR, path.join(PACKAGE_DIR, "package-lock.json")) || "package-lock.json",
    "package.json",
    "package-lock.json",
  ];
  return Array.from(new Set(packagePaths.map((item) => item.replace(/\\/g, "/"))));
}

async function checkInternalUpdate() {
  const status = await ensureInternalUpdateEnvironment({ requireClean: false });
  await runGitCommand(["fetch", "--tags", "origin"], { timeoutMs: INTERNAL_UPDATE_GIT_TIMEOUT_MS });
  const tagOutput = await runGitText(["tag", "--list", "v[0-9]*.[0-9]*.[0-9]*"], { timeoutMs: 10000 });
  const { latest, newer } = pickLatestStableTag(tagOutput, status.packageVersion);
  let targetCommit = "";
  let changedFiles = [];

  if (newer) {
    targetCommit = await getGitCommitForRef(newer.tag);
    changedFiles = await getChangedFilesBetweenRefs("HEAD", newer.tag, getInternalUpdatePackageFilePaths());
  }

  return {
    status: await collectInternalUpdateGitStatus({ includeDirty: true }),
    latestStableTag: latest,
    update: newer
      ? {
        available: true,
        tag: newer.tag,
        version: newer.version,
        targetCommit,
        changedFiles,
        dependencyFilesChanged: changedFiles.some((file) => /(^|\/)package(-lock)?\.json$/.test(file)),
      }
      : {
        available: false,
        tag: latest?.tag || "",
        version: latest?.version || "",
        targetCommit: "",
        changedFiles: [],
        dependencyFilesChanged: false,
      },
  };
}

function writeInternalUpdateState(payload) {
  try {
    fs.writeFileSync(INTERNAL_UPDATE_STATE_FILE_PATH, JSON.stringify(payload, null, 2), "utf8");
  } catch {
    // ignore state persistence failures
  }
}

async function applyInternalUpdate(targetTag) {
  const parsedTarget = parseStableUpdateVersion(targetTag);
  if (!parsedTarget) {
    throw createHttpError("INVALID_UPDATE_TAG", "只允许 vX.Y.Z 格式的稳定 tag。", 400);
  }

  const status = await ensureInternalUpdateEnvironment({ requireClean: true });
  const currentVersion = parsePackageVersion(status.packageVersion);
  if (currentVersion && compareVersionParts(parsedTarget, currentVersion) <= 0) {
    throw createHttpError("TAG_NOT_NEWER", "目标 tag 不高于当前版本。", 400, { status, target: parsedTarget });
  }

  await runGitCommand(["fetch", "--tags", "origin"], { timeoutMs: INTERNAL_UPDATE_GIT_TIMEOUT_MS });
  const targetCommit = await runGitText(["rev-parse", "--verify", `refs/tags/${parsedTarget.tag}^{commit}`], {
    timeoutMs: 10000,
  });
  const changedFiles = await getChangedFilesBetweenRefs("HEAD", `refs/tags/${parsedTarget.tag}`, [
    ...getInternalUpdatePackageFilePaths(),
  ]);
  const updateState = {
    startedAt: new Date().toISOString(),
    sourceRoot: ROOT_DIR,
    remoteUrl: status.remoteUrl,
    previousVersion: status.packageVersion,
    previousCommit: status.currentCommit,
    previousShortCommit: status.currentShortCommit,
    previousTag: status.currentTag,
    targetTag: parsedTarget.tag,
    targetVersion: parsedTarget.version,
    targetCommit,
    changedFiles,
  };
  writeInternalUpdateState(updateState);

  await runGitCommand(["checkout", "--detach", `refs/tags/${parsedTarget.tag}`], {
    timeoutMs: INTERNAL_UPDATE_GIT_TIMEOUT_MS,
  });

  return {
    ...updateState,
    completedAt: new Date().toISOString(),
    restartRequired: true,
    dependencyFilesChanged: changedFiles.some((file) => /(^|\/)package(-lock)?\.json$/.test(file)),
    stateFile: INTERNAL_UPDATE_STATE_FILE_PATH,
  };
}

function normalizeClock(value) {
  const text = String(value || "").trim();
  if (!/^\d{2}:\d{2}$/.test(text)) return null;
  const [hourText, minuteText] = text.split(":");
  const hour = Number.parseInt(hourText, 10);
  const minute = Number.parseInt(minuteText, 10);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function parseOptionalScore(value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 10) {
    return parsed;
  }
  return null;
}

function validatePushEventPayload(payload) {
  const title = String(payload?.title || "").trim();
  const date = String(payload?.date || "").trim();
  const start = normalizeClock(payload?.start);
  const end = normalizeClock(payload?.end);
  const note = String(payload?.note || "").trim();
  const category = String(payload?.category || "").trim();
  const quality = parseOptionalScore(payload?.quality);
  const happiness = parseOptionalScore(payload?.happiness);
  const sourceId = String(payload?.sourceId || "").trim();
  const eventId = String(payload?.eventId || payload?.externalCalendarId || "").trim();

  if (!title) {
    throw new Error("INVALID_TITLE");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("INVALID_DATE");
  }
  if (!start || !end) {
    throw new Error("INVALID_TIME_RANGE");
  }

  return {
    title: title.slice(0, 120),
    date,
    start,
    end,
    note: note.slice(0, 1000),
    category: category.slice(0, 60),
    quality,
    happiness,
    sourceId: sourceId.slice(0, 120),
    eventId: eventId.slice(0, 240),
    calendarId: String(payload?.calendarId || "").trim().slice(0, 260),
    calendarName: String(payload?.calendarName || "").trim().slice(0, 120),
  };
}

function isValidDateInput(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "").trim());
}

function formatDateFromIso(isoText) {
  const parsed = new Date(String(isoText || "").trim());
  if (Number.isNaN(parsed.getTime())) return "";
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatClockFromIso(isoText) {
  const parsed = new Date(String(isoText || "").trim());
  if (Number.isNaN(parsed.getTime())) return "";
  return `${String(parsed.getHours()).padStart(2, "0")}:${String(parsed.getMinutes()).padStart(2, "0")}`;
}

function validateTaskSyncPayload(rawTask) {
  const taskId = String(rawTask?.taskId || rawTask?.id || rawTask?.sourceId || "").trim();
  if (!taskId) {
    throw new Error("INVALID_TASK_ID");
  }

  const payload = validatePushEventPayload({
    ...rawTask,
    sourceId: String(rawTask?.sourceId || taskId),
    eventId: String(rawTask?.eventId || rawTask?.externalCalendarId || ""),
  });

  return {
    taskId: taskId.slice(0, 120),
    payload,
  };
}

function validateTaskDeletePayload(rawTask) {
  const taskId = String(rawTask?.taskId || rawTask?.id || "").trim();
  const eventId = String(rawTask?.eventId || rawTask?.externalCalendarId || "").trim();
  if (!taskId) {
    throw new Error("INVALID_TASK_ID");
  }
  if (!eventId) {
    throw new Error("INVALID_EVENT_ID");
  }
  return {
    taskId: taskId.slice(0, 120),
    eventId: eventId.slice(0, 240),
  };
}

function normalizeIsoDateTime(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const parsed = new Date(text.replace(" ", "T"));
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString();
}

function normalizeReminderRepeat(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text || text === "none" || text === "off") return "none";
  if (text === "once" || text === "single") return "once";
  if (text === "daily" || text === "weekly" || text === "monthly") return text;
  return "none";
}

function validateTaskReminderSyncPayload(rawTask) {
  const taskId = String(rawTask?.taskId || rawTask?.id || rawTask?.sourceId || "").trim();
  if (!taskId) {
    throw new Error("INVALID_TASK_ID");
  }

  const title = String(rawTask?.title || "").trim();
  const dueDate = String(rawTask?.dueDate || rawTask?.date || "").trim();
  const dueTime = normalizeClock(rawTask?.dueTime || rawTask?.start);
  if (!title) {
    throw new Error("INVALID_TITLE");
  }
  if (!isValidDateInput(dueDate)) {
    throw new Error("INVALID_DUE_DATE");
  }
  if (!dueTime) {
    throw new Error("INVALID_DUE_TIME");
  }

  const reminderId = String(rawTask?.reminderId || rawTask?.externalReminderId || "").trim();
  const alarmAt = normalizeIsoDateTime(
    rawTask?.alarmAt || rawTask?.reminderAt || rawTask?.reminder || "",
  );
  const sourceId = String(rawTask?.sourceId || taskId).trim();
  const note = String(rawTask?.note || "").trim();
  const repeat = normalizeReminderRepeat(rawTask?.repeat || "");

  return {
    taskId: taskId.slice(0, 120),
    payload: {
      title: title.slice(0, 120),
      dueDate,
      dueTime,
      note: note.slice(0, 1000),
      sourceId: sourceId.slice(0, 120),
      reminderId: reminderId.slice(0, 240),
      alarmAt,
      repeat,
      calendarId: String(rawTask?.calendarId || "").trim().slice(0, 260),
      calendarName: String(rawTask?.calendarName || "").trim().slice(0, 120),
    },
  };
}

function validateTaskReminderCompletePayload(rawTask) {
  const taskId = String(rawTask?.taskId || rawTask?.id || "").trim();
  const reminderId = String(rawTask?.reminderId || rawTask?.externalReminderId || "").trim();
  const sourceId = String(rawTask?.sourceId || taskId).trim();
  if (!taskId) {
    throw new Error("INVALID_TASK_ID");
  }
  if (!reminderId && !sourceId) {
    throw new Error("INVALID_REMINDER_ID");
  }
  const action = String(rawTask?.action || "").trim().toLowerCase() === "disable" ? "disable" : "complete";
  return {
    taskId: taskId.slice(0, 120),
    reminderId: reminderId.slice(0, 240),
    sourceId: sourceId.slice(0, 120),
    action,
    completedAt: normalizeIsoDateTime(rawTask?.completedAt || ""),
  };
}

async function readCalendarSyncPayload() {
  const raw = await fs.promises.readFile(CALENDAR_SYNC_FILE_PATH, "utf8");
  return parseJsonBody(raw);
}

function parseTimeQualityMetaFromUrl(urlText) {
  const text = String(urlText || "").trim();
  if (!text) return null;

  let parsed = null;
  try {
    parsed = new URL(text);
  } catch {
    return null;
  }

  if (String(parsed.protocol || "").toLowerCase() !== "timequality:") {
    return null;
  }

  const taskId = String(
    parsed.searchParams.get("taskId")
      || parsed.searchParams.get("sourceId")
      || parsed.searchParams.get("id")
      || "",
  ).trim();
  if (!taskId) return null;

  return {
    taskId: taskId.slice(0, 120),
    quality: parseOptionalScore(parsed.searchParams.get("quality")),
    happiness: parseOptionalScore(parsed.searchParams.get("happiness")),
  };
}

function parseTimeQualityMetaFromNote(noteText) {
  const text = String(noteText || "").replace(/\r\n/g, "\n").trim();
  if (!text) return null;

  const taskMatch = text.match(/(?:来源任务|任务ID|taskId)\s*[:：]\s*([^\n\r]+)/i);
  if (!taskMatch || !taskMatch[1]) return null;

  const lines = text.split("\n");
  const markerIndex = lines.findIndex((line) => /^\[TimeQuality/i.test(line.trim()));
  const noteBody = (markerIndex >= 0 ? lines.slice(0, markerIndex) : lines).join("\n").trim();

  const qualityMatch = text.match(/质量\s*[:：]\s*(\d{1,2})/i);
  const happinessMatch = text.match(/幸福(?:感)?\s*[:：]\s*(\d{1,2})/i);
  const quality = qualityMatch ? parseOptionalScore(qualityMatch[1]) : null;
  const happiness = happinessMatch ? parseOptionalScore(happinessMatch[1]) : null;

  return {
    taskId: String(taskMatch[1]).trim().slice(0, 120),
    noteBody,
    quality,
    happiness,
  };
}

function parseTimeQualityMeta(noteText, urlText = "") {
  const note = String(noteText || "").replace(/\r\n/g, "\n").trim();
  const urlMeta = parseTimeQualityMetaFromUrl(urlText);
  const noteMeta = parseTimeQualityMetaFromNote(note);

  if (urlMeta?.taskId) {
    return {
      taskId: urlMeta.taskId,
      noteBody: note,
      quality: urlMeta.quality ?? noteMeta?.quality ?? null,
      happiness: urlMeta.happiness ?? noteMeta?.happiness ?? null,
    };
  }

  return noteMeta;
}

function sanitizeTodoForMerge(rawTodo) {
  const id = String(rawTodo?.id || rawTodo?.taskId || "").trim();
  if (!id) return null;

  return {
    id,
    title: String(rawTodo?.title || "").trim(),
    dueDate: String(rawTodo?.dueDate || "").trim(),
    startTime: normalizeClock(rawTodo?.startTime) || "",
    endTime: normalizeClock(rawTodo?.endTime) || "",
    note: String(rawTodo?.note || "").trim(),
    qualityScore: parseOptionalScore(rawTodo?.qualityScore),
    happinessScore: parseOptionalScore(rawTodo?.happinessScore),
    updatedAt: String(rawTodo?.updatedAt || "").trim(),
    syncedAt: String(rawTodo?.syncedAt || rawTodo?.lastSyncedAt || "").trim(),
    externalCalendarId: String(rawTodo?.externalCalendarId || "").trim(),
    completed: Boolean(rawTodo?.completed),
    syncState: TODO_SYNC_STATES.has(String(rawTodo?.syncState || "").trim())
      ? String(rawTodo?.syncState || "").trim()
      : "dirty",
  };
}

function parseTimestampMs(value) {
  const ms = Date.parse(String(value || "").trim());
  return Number.isFinite(ms) ? ms : null;
}

function extractTaskPatchesFromExportEvents(events) {
  const latestPatchByTaskId = new Map();
  for (const event of events) {
    if (!event || typeof event !== "object") continue;

    const noteText = String(event.note || event.notes || event.description || "").trim();
    const urlText = String(event.url || event.urlString || "").trim();
    const meta = parseTimeQualityMeta(noteText, urlText);
    if (!meta?.taskId) continue;

    const dueDateRaw = String(event.date || "").trim();
    const startRaw = normalizeClock(event.startTime) || formatClockFromIso(event.start);
    const endRaw = normalizeClock(event.endTime) || formatClockFromIso(event.end);
    const dateFromIso = formatDateFromIso(event.start);
    const dueDate = isValidDateInput(dueDateRaw)
      ? dueDateRaw
      : isValidDateInput(dateFromIso)
        ? dateFromIso
        : "";
    const modifiedAtRaw = String(event.modifiedAt || event.lastModifiedDate || "").trim();
    const modifiedAt = parseTimestampMs(modifiedAtRaw) !== null ? modifiedAtRaw : "";

    const taskId = String(meta.taskId || "").trim();
    if (!taskId) continue;

    const patch = {
      taskId: meta.taskId,
      remote: {
        title: String(event.title || "").trim().slice(0, 120),
        dueDate,
        startTime: startRaw || "",
        endTime: endRaw || "",
        note: meta.noteBody,
        qualityScore: meta.quality,
        happinessScore: meta.happiness,
        externalCalendarId: String(event.externalId || event.eventId || event.id || "").trim(),
        modifiedAt,
      },
    };

    const patchTime = parseTimestampMs(event.start);
    const fallbackTime = parseTimestampMs(`${dueDate}T${startRaw || "00:00"}:00`);
    const timestamp =
      parseTimestampMs(modifiedAt) ?? patchTime ?? fallbackTime ?? 0;
    const existing = latestPatchByTaskId.get(taskId);
    if (!existing || timestamp >= existing.timestamp) {
      latestPatchByTaskId.set(taskId, { timestamp, patch });
    }
  }
  return Array.from(latestPatchByTaskId.values()).map((item) => item.patch);
}

function hasLocalDirtyAfterSync(todo) {
  if (!todo.syncedAt || !todo.updatedAt) return false;
  const syncedMs = Date.parse(todo.syncedAt);
  const updatedMs = Date.parse(todo.updatedAt);
  if (!Number.isFinite(syncedMs) || !Number.isFinite(updatedMs)) return false;
  return updatedMs > syncedMs;
}

function isStaleRemotePatchForCleanSyncedTodo(todo, remote) {
  if (String(todo?.syncState || "").trim() !== "synced") return false;
  if (hasLocalDirtyAfterSync(todo)) return false;
  const syncedMs = parseTimestampMs(todo?.syncedAt);
  const remoteModifiedMs = parseTimestampMs(remote?.modifiedAt);
  if (syncedMs === null || remoteModifiedMs === null) return false;
  return remoteModifiedMs < syncedMs;
}

function computeTodoRemoteDiff(todo, remote) {
  const changedFields = [];
  const comparers = [
    ["title", String(todo.title || ""), String(remote.title || "")],
    ["dueDate", String(todo.dueDate || ""), String(remote.dueDate || "")],
    ["startTime", String(todo.startTime || ""), String(remote.startTime || "")],
    ["endTime", String(todo.endTime || ""), String(remote.endTime || "")],
    ["note", String(todo.note || ""), String(remote.note || "")],
    ["externalCalendarId", String(todo.externalCalendarId || ""), String(remote.externalCalendarId || "")],
  ];

  for (const [field, current, next] of comparers) {
    if (field === "note") {
      if (current !== next) {
        changedFields.push(field);
      }
      continue;
    }

    if (next && current !== next) {
      changedFields.push(field);
    }
  }

  if (Number.isInteger(remote.qualityScore) && remote.qualityScore !== Number(todo.qualityScore || 0)) {
    changedFields.push("qualityScore");
  }
  if (Number.isInteger(remote.happinessScore) && remote.happinessScore !== Number(todo.happinessScore || 0)) {
    changedFields.push("happinessScore");
  }

  return changedFields;
}

function mergeRemotePatches(localTodos, remotePatches) {
  const todoMap = new Map(localTodos.map((todo) => [todo.id, todo]));
  const updates = [];
  const conflicts = [];
  let unmatched = 0;

  for (const patch of remotePatches) {
    const localTodo = todoMap.get(String(patch.taskId || ""));
    if (!localTodo) {
      unmatched += 1;
      continue;
    }

    const changedFields = computeTodoRemoteDiff(localTodo, patch.remote);
    if (!changedFields.length) {
      continue;
    }

    if (isStaleRemotePatchForCleanSyncedTodo(localTodo, patch.remote)) {
      continue;
    }

    const hasLocalDirty = hasLocalDirtyAfterSync(localTodo) || localTodo.syncState === "dirty";
    if (hasLocalDirty) {
      const localUpdatedMs = parseTimestampMs(localTodo.updatedAt);
      const remoteModifiedMs = parseTimestampMs(patch.remote?.modifiedAt);

      if (localUpdatedMs !== null && remoteModifiedMs !== null) {
        if (remoteModifiedMs > localUpdatedMs) {
          updates.push({
            taskId: patch.taskId,
            changedFields,
            remote: patch.remote,
          });
          continue;
        }

        if (localUpdatedMs > remoteModifiedMs) {
          continue;
        }
      }

      conflicts.push({
        taskId: patch.taskId,
        changedFields,
        remote: patch.remote,
      });
      continue;
    }

    updates.push({
      taskId: patch.taskId,
      changedFields,
      remote: patch.remote,
    });
  }

  return {
    updates,
    conflicts,
    unmatched,
    scanned: remotePatches.length,
  };
}

function addDays(baseDate, days) {
  const date = new Date(baseDate.getTime());
  date.setDate(date.getDate() + Number(days || 0));
  return date;
}

function parseDateInput(value) {
  const text = String(value || "").trim();
  if (!isValidDateInput(text)) return null;
  const [yearText, monthText, dayText] = text.split("-");
  const year = Number.parseInt(yearText, 10);
  const month = Number.parseInt(monthText, 10);
  const day = Number.parseInt(dayText, 10);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  const date = new Date(year, month - 1, day, 0, 0, 0, 0);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function buildRemoteEventIdSet(events) {
  const set = new Set();
  for (const event of events) {
    if (!event || typeof event !== "object") continue;
    const id = String(event.externalId || event.eventId || event.id || "").trim();
    if (!id) continue;
    set.add(id);
  }
  return set;
}

function detectRemoteDeletedTodos(localTodos, events, payloadMeta = {}) {
  const remoteEventIds = buildRemoteEventIdSet(events);
  const generatedAt = new Date(String(payloadMeta.generatedAt || "").trim());
  const baseDate = Number.isNaN(generatedAt.getTime()) ? new Date() : generatedAt;

  const parsedDaysBack = Number.parseInt(String(payloadMeta.daysBack ?? ""), 10);
  const parsedDaysForward = Number.parseInt(String(payloadMeta.daysForward ?? ""), 10);
  const daysBack = Number.isInteger(parsedDaysBack) && parsedDaysBack >= 0 ? parsedDaysBack : 30;
  const daysForward = Number.isInteger(parsedDaysForward) && parsedDaysForward >= 0 ? parsedDaysForward : 60;

  const windowStart = addDays(baseDate, -daysBack);
  windowStart.setHours(0, 0, 0, 0);
  const windowEnd = addDays(baseDate, daysForward);
  windowEnd.setHours(23, 59, 59, 999);

  const deleted = [];
  for (const todo of localTodos) {
    if (!todo || typeof todo !== "object") continue;
    if (todo.completed) continue;

    const externalCalendarId = String(todo.externalCalendarId || "").trim();
    if (!externalCalendarId) continue;
    if (todo.syncState !== "synced") continue;
    if (hasLocalDirtyAfterSync(todo)) continue;

    const dueDate = parseDateInput(todo.dueDate);
    if (!dueDate) continue;
    if (dueDate < windowStart || dueDate > windowEnd) continue;
    if (remoteEventIds.has(externalCalendarId)) continue;

    deleted.push({
      taskId: String(todo.id || "").trim(),
      externalCalendarId,
    });
  }

  return deleted;
}

function normalizeCalendarGroupValue(value) {
  return String(value || "").trim().replace(/\s+/g, "");
}

function buildCalendarGroup(sourceName, calendarName) {
  const source = String(sourceName || "").trim();
  const calendar = String(calendarName || "").trim();
  if (source && calendar) return `${source}/${calendar}`;
  return source || calendar || "";
}

function normalizeSyncCalendarTarget(rawTarget) {
  const target = rawTarget && typeof rawTarget === "object" ? rawTarget : {};
  const calendarId = String(target.calendarId || target.id || "").trim();
  const calendarName = String(target.calendarName || target.name || "").trim();
  const sourceName = String(target.sourceName || target.source || "").trim();
  const group = normalizeCalendarGroupValue(
    String(target.group || "").trim() || buildCalendarGroup(sourceName, calendarName),
  );

  if (!calendarId && !group && !calendarName) {
    return null;
  }

  return {
    calendarId: calendarId.slice(0, 260),
    calendarName: calendarName.slice(0, 120),
    sourceName: sourceName.slice(0, 120),
    group,
  };
}

function isEventInTargetCalendar(event, targetCalendar) {
  if (!targetCalendar) return true;

  const targetId = String(targetCalendar.calendarId || "").trim();
  if (targetId) {
    const eventCalendarId = String(event?.calendarId || event?.calendarIdentifier || "").trim();
    if (eventCalendarId) {
      return eventCalendarId === targetId;
    }
  }

  const targetGroup = normalizeCalendarGroupValue(
    targetCalendar.group || buildCalendarGroup(targetCalendar.sourceName, targetCalendar.calendarName),
  );
  if (targetGroup) {
    const eventGroup = normalizeCalendarGroupValue(
      String(event?.group || event?.calendarGroup || "").trim()
      || buildCalendarGroup(event?.sourceName || event?.calendarSource, event?.calendarName || event?.calendar),
    );
    if (eventGroup) {
      return eventGroup === targetGroup;
    }
  }

  const targetCalendarName = String(targetCalendar.calendarName || "").trim().toLowerCase();
  if (targetCalendarName) {
    const eventCalendarName = String(event?.calendarName || event?.calendar || "").trim().toLowerCase();
    if (eventCalendarName) {
      return eventCalendarName === targetCalendarName;
    }
  }

  return true;
}

function filterEventsByTargetCalendar(events, targetCalendar) {
  const list = Array.isArray(events) ? events : [];
  if (!targetCalendar) return list;
  return list.filter((event) => isEventInTargetCalendar(event, targetCalendar));
}

function runMacCalendarCreateEventSwiftOnce(payload) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(RUNTIME_SCRIPTS_DIR, "push-mac-calendar-event.swift");
    const args = [
      "swift",
      scriptPath,
      "--title",
      payload.title,
      "--date",
      payload.date,
      "--start",
      payload.start,
      "--end",
      payload.end,
      "--category",
      payload.category,
      "--note",
      payload.note,
      "--source-id",
      payload.sourceId,
    ];

    if (Number.isInteger(payload.quality)) {
      args.push("--quality", String(payload.quality));
    }
    if (Number.isInteger(payload.happiness)) {
      args.push("--happiness", String(payload.happiness));
    }
    if (payload.eventId) {
      args.push("--event-id", String(payload.eventId));
    }

    if (payload.calendarId) {
      args.push("--calendar-id", payload.calendarId);
    }
    if (payload.calendarName) {
      args.push("--calendar", payload.calendarName);
    }

    const child = spawn("xcrun", args, { cwd: ROOT_DIR });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `swift exited with code ${code}. ${stderr.trim() || stdout.trim() || "No error output"}`,
          ),
        );
        return;
      }

      let payloadResult = null;
      try {
        payloadResult = JSON.parse(stdout.trim());
      } catch {
        payloadResult = { ok: true, raw: stdout.trim() };
      }
      resolve({ payload: payloadResult, stderr: stderr.trim() });
    });
  });
}

function runMacCalendarDeleteEventSwiftOnce(payload) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(RUNTIME_SCRIPTS_DIR, "delete-mac-calendar-event.swift");
    const args = ["swift", scriptPath, "--event-id", payload.eventId];
    const child = spawn("xcrun", args, { cwd: ROOT_DIR });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `swift exited with code ${code}. ${stderr.trim() || stdout.trim() || "No error output"}`,
          ),
        );
        return;
      }

      let payloadResult = null;
      try {
        payloadResult = JSON.parse(stdout.trim());
      } catch {
        payloadResult = { ok: true, eventId: payload.eventId, raw: stdout.trim() };
      }
      resolve({ payload: payloadResult, stderr: stderr.trim() });
    });
  });
}

function runMacReminderUpsertSwiftOnce(payload) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(RUNTIME_SCRIPTS_DIR, "push-mac-reminder.swift");
    const args = [
      "swift",
      scriptPath,
      "--title",
      payload.title,
      "--due-date",
      payload.dueDate,
      "--due-time",
      payload.dueTime,
      "--note",
      payload.note,
      "--source-id",
      payload.sourceId,
    ];

    if (payload.reminderId) {
      args.push("--reminder-id", String(payload.reminderId));
    }
    if (payload.alarmAt) {
      args.push("--alarm-at", String(payload.alarmAt));
    }
    if (payload.repeat) {
      args.push("--repeat", String(payload.repeat));
    }
    if (payload.calendarId) {
      args.push("--calendar-id", String(payload.calendarId));
    }
    if (payload.calendarName) {
      args.push("--calendar", String(payload.calendarName));
    }

    const child = spawn("xcrun", args, { cwd: ROOT_DIR });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      reject(error);
    });
    child.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `swift exited with code ${code}. ${stderr.trim() || stdout.trim() || "No error output"}`,
          ),
        );
        return;
      }

      let payloadResult = null;
      try {
        payloadResult = JSON.parse(stdout.trim());
      } catch {
        payloadResult = { ok: true, raw: stdout.trim() };
      }
      resolve({ payload: payloadResult, stderr: stderr.trim() });
    });
  });
}

function runMacReminderCompleteSwiftOnce(payload) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(RUNTIME_SCRIPTS_DIR, "complete-mac-reminder.swift");
    const args = ["swift", scriptPath];
    if (payload.reminderId) {
      args.push("--reminder-id", payload.reminderId);
    }
    if (payload.sourceId) {
      args.push("--source-id", payload.sourceId);
    }
    if (payload.action) {
      args.push("--action", payload.action);
    }
    if (payload.completedAt) {
      args.push("--completed-at", payload.completedAt);
    }
    const child = spawn("xcrun", args, { cwd: ROOT_DIR });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      reject(error);
    });
    child.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `swift exited with code ${code}. ${stderr.trim() || stdout.trim() || "No error output"}`,
          ),
        );
        return;
      }

      let payloadResult = null;
      try {
        payloadResult = JSON.parse(stdout.trim());
      } catch {
        payloadResult = { ok: true, raw: stdout.trim() };
      }
      resolve({ payload: payloadResult, stderr: stderr.trim() });
    });
  });
}

function isSwiftCalendarAccessDeniedError(error) {
  const message = error instanceof Error ? error.message : String(error || "");
  return /swift exited with code 2/i.test(message) && /calendar access denied/i.test(message);
}

function isSwiftCalendarToolchainError(error) {
  const message = error instanceof Error ? error.message : String(error || "");
  if (!/swift exited with code \d+/i.test(message)) return false;
  return (
    /this SDK is not supported by the compiler/i.test(message) ||
    /redefinition of module 'SwiftBridging'/i.test(message) ||
    /could not build (Objective-C )?module '(EventKit|Foundation|CoreServices|CoreFoundation|CoreLocation)'/i.test(message) ||
    /failed to build module '(EventKit|Foundation|CoreServices|CoreFoundation|CoreLocation)'/i.test(message)
  );
}

function isSwiftCalendarJxaFallbackError(error) {
  return isSwiftCalendarAccessDeniedError(error) || isSwiftCalendarToolchainError(error);
}

function isCalendarBackendUnavailableMessage(message) {
  const text = String(message || "");
  return text.startsWith("swift exited") || text.startsWith("osascript exited");
}

function runJxaScriptOnce(script, env = {}) {
  return new Promise((resolve, reject) => {
    const timeoutMs = 30000;
    let settled = false;
    const child = spawn("osascript", ["-l", "JavaScript"], {
      cwd: ROOT_DIR,
      env: {
        ...process.env,
        ...env,
      },
    });
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill("SIGKILL");
      } catch (_) {}
      reject(new Error(`osascript timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (code !== 0) {
        const output = `${stderr.trim()}\n${stdout.trim()}`.trim();
        const isAutomationDenied =
          /not authorized to send apple events/i.test(output) ||
          /not authorised to send apple events/i.test(output) ||
          /\\(-1743\\)/.test(output);
        const isCalendarMissing = /application can't be found/i.test(output) || /\\(-2700\\)/.test(output);
        if (isAutomationDenied) {
          reject(
            new Error(
              "Apple Events automation access denied. Please enable System Settings > Privacy & Security > Automation > Satori > Calendar.",
            ),
          );
          return;
        }
        if (isCalendarMissing) {
          reject(new Error("Calendar.app not available for AppleScript/JXA access."));
          return;
        }
        reject(
          new Error(
            `osascript exited with code ${code}. ${stderr.trim() || stdout.trim() || "No error output"}`,
          ),
        );
        return;
      }
      resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
    });

    child.stdin.end(script);
  });
}

function buildJxaListCalendarsScript() {
  return `
const app = Application("Calendar");
const generatedAt = (new Date()).toISOString();
const calendars = app.calendars();
const mapped = [];
for (const cal of calendars) {
  let calendarId = "";
  let calendarName = "";
  try { calendarId = String(cal.id() || "").trim(); } catch (_) {}
  try { calendarName = String(cal.name() || "").trim(); } catch (_) {}
  if (!calendarName) continue;
  mapped.push({
    calendarId,
    calendarName,
    sourceName: "",
    group: calendarName,
    isDefault: false
  });
}
console.log(JSON.stringify({ generatedAt, calendars: mapped }));
`;
}

function buildJxaExportScript() {
  return `
ObjC.import("stdlib");
const raw = $.getenv("TIMEQUALITY_EXPORT_CONFIG_JSON");
let config = { daysBack: 30, daysForward: 60 };
if (raw) {
  try {
    const parsed = JSON.parse(ObjC.unwrap(raw));
    if (Number.isInteger(parsed.daysBack) && parsed.daysBack >= 0) config.daysBack = parsed.daysBack;
    if (Number.isInteger(parsed.daysForward) && parsed.daysForward >= 0) config.daysForward = parsed.daysForward;
    if (typeof parsed.targetCalendarId === "string") {
      config.targetCalendarId = String(parsed.targetCalendarId).trim();
    }
    if (typeof parsed.targetCalendarName === "string") {
      config.targetCalendarName = String(parsed.targetCalendarName).trim();
    }
  } catch (_) {}
}

const app = Application("Calendar");
const now = new Date();
const windowStart = new Date(now);
windowStart.setDate(windowStart.getDate() - config.daysBack);
windowStart.setHours(0, 0, 0, 0);
const windowEnd = new Date(now);
windowEnd.setDate(windowEnd.getDate() + config.daysForward);
windowEnd.setHours(23, 59, 59, 999);

const pad = (value) => String(value).padStart(2, "0");
const toDate = (date) =>
  String(date.getFullYear()) + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate());
const toClock = (date) => pad(date.getHours()) + ":" + pad(date.getMinutes());

const outEvents = [];
const calendars = app.calendars();
  for (const cal of calendars) {
  let calendarId = "";
  let calendarName = "";
  try { calendarId = String(cal.id() || "").trim(); } catch (_) {}
  try { calendarName = String(cal.name() || "").trim(); } catch (_) {}
  if (!calendarName) continue;
  if (config.targetCalendarId && calendarId !== config.targetCalendarId) continue;
  if (!config.targetCalendarId && config.targetCalendarName && calendarName !== config.targetCalendarName) continue;
    let events = [];
    try {
      events = cal.events.whose({
        _and: [
          { startDate: { "<": windowEnd } },
          { endDate: { ">": windowStart } }
        ]
      })();
    } catch (_) {
      try {
        events = cal.events();
      } catch (_) {
        continue;
      }
    }

    for (const event of events) {
      let startRaw = null;
      let endRaw = null;
      try { startRaw = event.startDate(); } catch (_) {}
    try { endRaw = event.endDate(); } catch (_) {}
    if (!startRaw || !endRaw) continue;
    const startDate = new Date(startRaw);
    const endDate = new Date(endRaw);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) continue;
    if (!(endDate > windowStart && startDate < windowEnd)) continue;
    if (!(endDate > startDate)) continue;

    let externalId = "";
    let title = "Untitled";
    let note = "";
    let url = "";
    let modifiedAt = null;
    try { externalId = String(event.uid() || "").trim(); } catch (_) {}
    if (!externalId) {
      try { externalId = String(event.id() || "").trim(); } catch (_) {}
    }
    try { title = String(event.summary() || "Untitled").trim() || "Untitled"; } catch (_) {}
    try { note = String(event.description() || "").trim(); } catch (_) {}
    try {
      const rawUrl = event.url();
      if (rawUrl) url = String(rawUrl).trim();
    } catch (_) {}
    try {
      const modifiedRaw = event.modificationDate();
      if (modifiedRaw) modifiedAt = (new Date(modifiedRaw)).toISOString();
    } catch (_) {}

    outEvents.push({
      externalId,
      calendarId,
      calendarName,
      sourceName: "",
      title,
      group: calendarName,
      note,
      url,
      modifiedAt,
      date: toDate(startDate),
      startTime: toClock(startDate),
      endTime: toClock(endDate),
      start: startDate.toISOString(),
      end: endDate.toISOString()
    });
  }
}

console.log(JSON.stringify({
  generatedAt: now.toISOString(),
  source: "mac-calendar-jxa",
  daysBack: config.daysBack,
  daysForward: config.daysForward,
  events: outEvents
}));
`;
}

function buildJxaPushEventScript() {
  return `
ObjC.import("stdlib");
const raw = $.getenv("TIMEQUALITY_PUSH_PAYLOAD_JSON");
if (!raw) {
  throw new Error("MISSING_PAYLOAD");
}
const payload = JSON.parse(ObjC.unwrap(raw));
const app = Application("Calendar");

function parseLocal(dateText, timeText) {
  const m = /^(\\\\d{4})-(\\\\d{2})-(\\\\d{2})$/.exec(String(dateText || ""));
  const t = /^(\\\\d{2}):(\\\\d{2})$/.exec(String(timeText || ""));
  if (!m || !t) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(t[1]);
  const minute = Number(t[2]);
  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

const startDate = parseLocal(payload.date, payload.start);
const endDate = parseLocal(payload.date, payload.end);
if (!startDate || !endDate) {
  throw new Error("INVALID_DATE_TIME");
}
if (!(endDate > startDate)) {
  endDate.setDate(endDate.getDate() + 1);
}

const calendars = app.calendars();
let targetCalendar = null;
if (payload.calendarId) {
  for (const cal of calendars) {
    try {
      if (String(cal.id() || "").trim() === String(payload.calendarId).trim()) {
        targetCalendar = cal;
        break;
      }
    } catch (_) {}
  }
}
if (!targetCalendar && payload.calendarName) {
  for (const cal of calendars) {
    try {
      if (String(cal.name() || "").trim() === String(payload.calendarName).trim()) {
        targetCalendar = cal;
        break;
      }
    } catch (_) {}
  }
}
if (!targetCalendar && calendars.length > 0) {
  targetCalendar = calendars[0];
}
if (!targetCalendar) {
  throw new Error("NO_CALENDAR_FOUND");
}

function buildNote(base, sourceId, quality, happiness) {
  const body = String(base || "").trim();
  return body;
}

const url = payload.sourceId
  ? "timequality://todo?v=1&taskId=" + encodeURIComponent(String(payload.sourceId).trim())
  : "";
const note = buildNote(payload.note, payload.sourceId, payload.quality, payload.happiness);

let targetEvent = null;
if (payload.eventId) {
  for (const cal of calendars) {
    let events = [];
    try { events = cal.events(); } catch (_) { continue; }
    for (const event of events) {
      let uid = "";
      try { uid = String(event.uid() || "").trim(); } catch (_) {}
      if (uid && uid === String(payload.eventId).trim()) {
        targetEvent = event;
        break;
      }
    }
    if (targetEvent) break;
  }
}

if (targetEvent) {
  targetEvent.summary = String(payload.title || "").trim() || "Untitled";
  targetEvent.startDate = startDate;
  targetEvent.endDate = endDate;
  targetEvent.description = note;
  if (url) {
    try { targetEvent.url = url; } catch (_) {}
  }
} else {
  const created = app.Event({
    summary: String(payload.title || "").trim() || "Untitled",
    startDate: startDate,
    endDate: endDate,
    description: note
  });
  if (url) {
    try { created.url = url; } catch (_) {}
  }
  targetCalendar.events.push(created);
  targetEvent = created;
}

let eventId = "";
try { eventId = String(targetEvent.uid() || "").trim(); } catch (_) {}
if (!eventId) {
  try { eventId = String(targetEvent.id() || "").trim(); } catch (_) {}
}
let calendarName = "";
try { calendarName = String(targetCalendar.name() || "").trim(); } catch (_) {}
console.log(JSON.stringify({
  ok: true,
  eventId,
  title: String(payload.title || "").trim() || "Untitled",
  calendar: calendarName,
  start: startDate.toISOString(),
  end: endDate.toISOString()
}));
`;
}

function buildJxaDeleteEventScript() {
  return `
ObjC.import("stdlib");
const raw = $.getenv("TIMEQUALITY_DELETE_PAYLOAD_JSON");
if (!raw) {
  throw new Error("MISSING_PAYLOAD");
}
const payload = JSON.parse(ObjC.unwrap(raw));
const targetId = String(payload.eventId || "").trim();
if (!targetId) {
  throw new Error("INVALID_EVENT_ID");
}

const app = Application("Calendar");
const calendars = app.calendars();
let deleted = 0;
for (const cal of calendars) {
  let events = [];
  try { events = cal.events(); } catch (_) { continue; }
  for (const event of events) {
    let uid = "";
    try { uid = String(event.uid() || "").trim(); } catch (_) {}
    if (uid && uid === targetId) {
      try {
        event.delete();
        deleted += 1;
      } catch (_) {}
    }
  }
}
console.log(JSON.stringify({ ok: true, eventId: targetId, deleted }));
`;
}

async function runMacCalendarExportViaJxa(options = {}) {
  const targetCalendar = normalizeSyncCalendarTarget(options?.targetCalendar);
  const configJson = JSON.stringify({
    daysBack: 30,
    daysForward: 60,
    targetCalendarId: String(targetCalendar?.calendarId || "").trim(),
    targetCalendarName: String(targetCalendar?.calendarName || "").trim(),
  });
  const result = await runJxaScriptOnce(buildJxaExportScript(), {
    TIMEQUALITY_EXPORT_CONFIG_JSON: configJson,
  });
  const parsed = JSON.parse(result.stdout || "{}");
  await fs.promises.writeFile(CALENDAR_SYNC_FILE_PATH, JSON.stringify(parsed, null, 2), "utf8");
  return { stdout: "Exported via JXA fallback", stderr: result.stderr };
}

async function runMacCalendarListCalendarsViaJxa() {
  const result = await runJxaScriptOnce(buildJxaListCalendarsScript());
  return JSON.parse(result.stdout || "{}");
}

async function runMacCalendarCreateEventViaJxa(payload) {
  const result = await runJxaScriptOnce(buildJxaPushEventScript(), {
    TIMEQUALITY_PUSH_PAYLOAD_JSON: JSON.stringify(payload || {}),
  });
  let payloadResult = null;
  try {
    payloadResult = JSON.parse(result.stdout || "{}");
  } catch {
    payloadResult = { ok: true, raw: result.stdout };
  }
  return { payload: payloadResult, stderr: result.stderr };
}

async function runMacCalendarDeleteEventViaJxa(payload) {
  const result = await runJxaScriptOnce(buildJxaDeleteEventScript(), {
    TIMEQUALITY_DELETE_PAYLOAD_JSON: JSON.stringify(payload || {}),
  });
  let payloadResult = null;
  try {
    payloadResult = JSON.parse(result.stdout || "{}");
  } catch {
    payloadResult = { ok: true, raw: result.stdout };
  }
  return { payload: payloadResult, stderr: result.stderr };
}

async function runMacCalendarExportOnce(options = {}) {
  try {
    return await runMacCalendarExportSwiftOnce();
  } catch (error) {
    if (!isSwiftCalendarJxaFallbackError(error)) throw error;
    return runMacCalendarExportViaJxa(options);
  }
}

async function runMacCalendarListCalendarsOnce() {
  try {
    return await runMacCalendarListCalendarsSwiftOnce();
  } catch (error) {
    if (!isSwiftCalendarJxaFallbackError(error)) throw error;
    return runMacCalendarListCalendarsViaJxa();
  }
}

async function runMacCalendarCreateEventOnce(payload) {
  try {
    return await runMacCalendarCreateEventSwiftOnce(payload);
  } catch (error) {
    if (!isSwiftCalendarJxaFallbackError(error)) throw error;
    return runMacCalendarCreateEventViaJxa(payload);
  }
}

async function runMacCalendarDeleteEventOnce(payload) {
  try {
    return await runMacCalendarDeleteEventSwiftOnce(payload);
  } catch (error) {
    if (!isSwiftCalendarJxaFallbackError(error)) throw error;
    return runMacCalendarDeleteEventViaJxa(payload);
  }
}

async function runMacReminderListListsOnce() {
  return runMacReminderListListsSwiftOnce();
}

async function runMacReminderUpsertOnce(payload) {
  return runMacReminderUpsertSwiftOnce(payload);
}

async function runMacReminderCompleteOnce(payload) {
  return runMacReminderCompleteSwiftOnce(payload);
}

const server = http.createServer(async (req, res) => {
  const method = req.method || "GET";
  const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const pathname = requestUrl.pathname;

  if (method === "GET" && pathname === "/api/internal-update/status") {
    try {
      const result = await collectInternalUpdateGitStatus({ includeDirty: true });
      sendJson(res, 200, {
        ok: true,
        message: "Internal updater status loaded",
        result,
      });
    } catch (error) {
      const status = Number(error?.statusCode || 500);
      sendJson(res, status, {
        ok: false,
        error: String(error?.code || "INTERNAL_UPDATE_STATUS_FAILED"),
        message: error instanceof Error ? error.message : "Unknown internal update status error",
        details: error?.details || {},
      });
    }
    return;
  }

  if (method === "POST" && pathname === "/api/internal-update/check") {
    try {
      const result = await checkInternalUpdate();
      sendJson(res, 200, {
        ok: true,
        message: "Internal update check finished",
        result,
      });
    } catch (error) {
      const status = Number(error?.statusCode || 400);
      sendJson(res, status, {
        ok: false,
        error: String(error?.code || "INTERNAL_UPDATE_CHECK_FAILED"),
        message: error instanceof Error ? error.message : "Unknown internal update check error",
        details: error?.details || {},
      });
    }
    return;
  }

  if (method === "POST" && pathname === "/api/internal-update/apply") {
    try {
      const rawBody = await collectRequestBody(req);
      const parsed = parseJsonBody(rawBody);
      const result = await applyInternalUpdate(parsed?.tag);
      sendJson(res, 200, {
        ok: true,
        message: "Internal update applied",
        result,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown internal update apply error";
      let status = Number(error?.statusCode || 400);
      if (errorMessage === "BODY_TOO_LARGE") {
        status = 413;
      }
      sendJson(res, status, {
        ok: false,
        error: String(error?.code || "INTERNAL_UPDATE_APPLY_FAILED"),
        message: errorMessage,
        details: error?.details || {},
      });
    }
    return;
  }

  if (method === "GET" && pathname === "/api/calendars/list") {
    try {
      const result = await runMacCalendarListCalendarsOnce();
      sendJson(res, 200, {
        ok: true,
        message: "Writable calendars loaded",
        result,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown calendar list error";
      let status = 400;
      if (isCalendarBackendUnavailableMessage(errorMessage)) {
        status = 503;
      }
      sendJson(res, status, {
        ok: false,
        error: "MAC_CALENDAR_LIST_FAILED",
        message: errorMessage,
      });
    }
    return;
  }

  if (method === "GET" && pathname === "/api/reminders/lists") {
    try {
      const result = await runMacReminderListListsOnce();
      sendJson(res, 200, {
        ok: true,
        message: "Writable reminder lists loaded",
        result,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown reminder list error";
      let status = 400;
      if (isCalendarBackendUnavailableMessage(errorMessage)) {
        status = 503;
      }
      sendJson(res, status, {
        ok: false,
        error: "MAC_REMINDER_LISTS_FAILED",
        message: errorMessage,
      });
    }
    return;
  }

  if (method === "POST" && pathname === "/api/sync-mac-calendar") {
    try {
      const rawBody = await collectRequestBody(req);
      const parsed = rawBody ? parseJsonBody(rawBody) : {};
      const targetCalendar = normalizeSyncCalendarTarget(parsed?.targetCalendar);
      const result = await runMacCalendarExportOnce({ targetCalendar });
      sendJson(res, 200, {
        ok: true,
        message: "Mac calendar exported once",
        stdout: result.stdout,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown export error";
      const status = errorMessage === "BODY_TOO_LARGE" ? 413 : 503;
      sendJson(res, status, {
        ok: false,
        error: "MAC_CALENDAR_EXPORT_FAILED",
        message: errorMessage,
      });
    }
    return;
  }

  if (method === "POST" && pathname === "/api/push-mac-calendar-event") {
    try {
      const rawBody = await collectRequestBody(req);
      const parsed = parseJsonBody(rawBody);
      const payload = validatePushEventPayload(parsed);
      const result = await runMacCalendarCreateEventOnce(payload);

      sendJson(res, 200, {
        ok: true,
        message: "Event pushed to macOS Calendar.app",
        result: result.payload,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown push error";
      let status = 400;
      if (errorMessage === "BODY_TOO_LARGE") {
        status = 413;
      } else if (isCalendarBackendUnavailableMessage(errorMessage)) {
        status = 503;
      }
      sendJson(res, status, {
        ok: false,
        error: "MAC_CALENDAR_PUSH_FAILED",
        message: errorMessage,
      });
    }
    return;
  }

  if (method === "POST" && pathname === "/api/tasks/sync-to-mac-calendar") {
    try {
      const rawBody = await collectRequestBody(req);
      const parsed = parseJsonBody(rawBody);
      const rawTasks = Array.isArray(parsed?.tasks) ? parsed.tasks : [];
      const defaultTarget = normalizeSyncCalendarTarget(parsed?.targetCalendar);
      if (!rawTasks.length) {
        throw new Error("INVALID_TASKS_PAYLOAD");
      }

      const items = [];
      for (const rawTask of rawTasks) {
        const fallbackTaskId = String(rawTask?.taskId || rawTask?.id || "").trim().slice(0, 120);
        try {
          const mergedTask = {
            ...rawTask,
            calendarId: rawTask?.calendarId || defaultTarget?.calendarId || "",
            calendarName: rawTask?.calendarName || defaultTarget?.calendarName || "",
          };
          const { taskId, payload } = validateTaskSyncPayload(mergedTask);
          const result = await runMacCalendarCreateEventOnce(payload);
          items.push({
            taskId,
            ok: true,
            eventId: String(result?.payload?.eventId || ""),
            calendar: String(result?.payload?.calendar || payload.calendarName || ""),
            syncedAt: new Date().toISOString(),
          });
        } catch (itemError) {
          const itemMessage =
            itemError instanceof Error ? itemError.message : "Unknown task sync error";
          items.push({
            taskId: fallbackTaskId,
            ok: false,
            error: itemMessage,
          });
        }
      }

      const succeeded = items.filter((item) => item.ok).length;
      const failed = items.length - succeeded;
      sendJson(res, 200, {
        ok: true,
        message: "Tasks synced to macOS Calendar.app",
        result: {
          total: items.length,
          succeeded,
          failed,
          items,
        },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown task sync error";
      let status = 400;
      if (errorMessage === "BODY_TOO_LARGE") {
        status = 413;
      } else if (isCalendarBackendUnavailableMessage(errorMessage)) {
        status = 503;
      }
      sendJson(res, status, {
        ok: false,
        error: "MAC_TASKS_SYNC_FAILED",
        message: errorMessage,
      });
    }
    return;
  }

  if (method === "POST" && pathname === "/api/tasks/sync-to-mac-reminders") {
    try {
      const rawBody = await collectRequestBody(req);
      const parsed = parseJsonBody(rawBody);
      const rawTasks = Array.isArray(parsed?.tasks) ? parsed.tasks : [];
      const defaultTarget = normalizeSyncCalendarTarget(parsed?.targetReminderList || parsed?.targetCalendar);
      if (!rawTasks.length) {
        throw new Error("INVALID_TASKS_PAYLOAD");
      }

      const items = [];
      for (const rawTask of rawTasks) {
        const fallbackTaskId = String(rawTask?.taskId || rawTask?.id || "").trim().slice(0, 120);
        try {
          const mergedTask = {
            ...rawTask,
            calendarId: rawTask?.calendarId || defaultTarget?.calendarId || "",
            calendarName: rawTask?.calendarName || defaultTarget?.calendarName || "",
          };
          const { taskId, payload } = validateTaskReminderSyncPayload(mergedTask);
          const result = await runMacReminderUpsertOnce(payload);
          items.push({
            taskId,
            ok: true,
            reminderId: String(result?.payload?.reminderId || ""),
            list: String(result?.payload?.list || payload.calendarName || ""),
            dueAt: String(result?.payload?.dueAt || ""),
            alarmAt: String(result?.payload?.alarmAt || ""),
            syncedAt: new Date().toISOString(),
          });
        } catch (itemError) {
          const itemMessage =
            itemError instanceof Error ? itemError.message : "Unknown reminder sync error";
          items.push({
            taskId: fallbackTaskId,
            ok: false,
            error: itemMessage,
          });
        }
      }

      const succeeded = items.filter((item) => item.ok).length;
      const failed = items.length - succeeded;
      sendJson(res, 200, {
        ok: true,
        message: "Tasks synced to macOS Reminders",
        result: {
          total: items.length,
          succeeded,
          failed,
          items,
        },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown reminder sync error";
      let status = 400;
      if (errorMessage === "BODY_TOO_LARGE") {
        status = 413;
      } else if (isCalendarBackendUnavailableMessage(errorMessage)) {
        status = 503;
      }
      sendJson(res, status, {
        ok: false,
        error: "MAC_TASKS_REMINDER_SYNC_FAILED",
        message: errorMessage,
      });
    }
    return;
  }

  if (method === "POST" && pathname === "/api/tasks/complete-in-mac-reminders") {
    try {
      const rawBody = await collectRequestBody(req);
      const parsed = parseJsonBody(rawBody);
      const rawTasks = Array.isArray(parsed?.tasks) ? parsed.tasks : [];
      if (!rawTasks.length) {
        throw new Error("INVALID_TASKS_PAYLOAD");
      }

      const items = [];
      for (const rawTask of rawTasks) {
        const fallbackTaskId = String(rawTask?.taskId || rawTask?.id || "").trim().slice(0, 120);
        try {
          const payload = validateTaskReminderCompletePayload(rawTask);
          const result = await runMacReminderCompleteOnce(payload);
          items.push({
            taskId: payload.taskId,
            ok: true,
            reminderId: String(result?.payload?.reminderId || payload.reminderId),
            action: payload.action,
            completed: Boolean(result?.payload?.completed),
            notFound: Boolean(result?.payload?.notFound),
            completedAt: String(result?.payload?.completedAt || payload.completedAt || new Date().toISOString()),
          });
        } catch (itemError) {
          const itemMessage =
            itemError instanceof Error ? itemError.message : "Unknown reminder complete error";
          items.push({
            taskId: fallbackTaskId,
            ok: false,
            error: itemMessage,
          });
        }
      }

      const succeeded = items.filter((item) => item.ok).length;
      const failed = items.length - succeeded;
      sendJson(res, 200, {
        ok: true,
        message: "Tasks completed in macOS Reminders",
        result: {
          total: items.length,
          succeeded,
          failed,
          items,
        },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown reminder complete error";
      let status = 400;
      if (errorMessage === "BODY_TOO_LARGE") {
        status = 413;
      } else if (isCalendarBackendUnavailableMessage(errorMessage)) {
        status = 503;
      }
      sendJson(res, status, {
        ok: false,
        error: "MAC_TASKS_REMINDER_COMPLETE_FAILED",
        message: errorMessage,
      });
    }
    return;
  }

  if (method === "POST" && pathname === "/api/tasks/delete-from-mac-calendar") {
    try {
      const rawBody = await collectRequestBody(req);
      const parsed = parseJsonBody(rawBody);
      const rawTasks = Array.isArray(parsed?.tasks) ? parsed.tasks : [];
      if (!rawTasks.length) {
        throw new Error("INVALID_TASKS_PAYLOAD");
      }

      const items = [];
      for (const rawTask of rawTasks) {
        const fallbackTaskId = String(rawTask?.taskId || rawTask?.id || "").trim().slice(0, 120);
        try {
          const payload = validateTaskDeletePayload(rawTask);
          const result = await runMacCalendarDeleteEventOnce(payload);
          items.push({
            taskId: payload.taskId,
            ok: true,
            eventId: String(result?.payload?.eventId || payload.eventId || ""),
            deleted: Boolean(result?.payload?.deleted),
            notFound: Boolean(result?.payload?.notFound),
            deletedAt: new Date().toISOString(),
          });
        } catch (itemError) {
          const itemMessage =
            itemError instanceof Error ? itemError.message : "Unknown task delete error";
          items.push({
            taskId: fallbackTaskId,
            ok: false,
            error: itemMessage,
          });
        }
      }

      const succeeded = items.filter((item) => item.ok).length;
      const failed = items.length - succeeded;
      sendJson(res, 200, {
        ok: true,
        message: "Tasks deleted from macOS Calendar.app",
        result: {
          total: items.length,
          succeeded,
          failed,
          items,
        },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown task delete error";
      let status = 400;
      if (errorMessage === "BODY_TOO_LARGE") {
        status = 413;
      } else if (isCalendarBackendUnavailableMessage(errorMessage)) {
        status = 503;
      }
      sendJson(res, status, {
        ok: false,
        error: "MAC_TASKS_DELETE_FAILED",
        message: errorMessage,
      });
    }
    return;
  }

  if (method === "POST" && pathname === "/api/tasks/pull-from-mac-calendar") {
    try {
      const rawBody = await collectRequestBody(req);
      const parsed = parseJsonBody(rawBody);
      const triggerExport = parsed?.triggerExport !== false;
      const targetCalendar = normalizeSyncCalendarTarget(parsed?.targetCalendar);
      const localTodos = Array.isArray(parsed?.todos)
        ? parsed.todos.map(sanitizeTodoForMerge).filter(Boolean)
        : [];

      if (triggerExport) {
        await runMacCalendarExportOnce({ targetCalendar });
      }

      const payload = await readCalendarSyncPayload();
      const events = Array.isArray(payload?.events)
        ? payload.events
        : Array.isArray(payload)
          ? payload
          : [];
      const filteredEvents = filterEventsByTargetCalendar(events, targetCalendar);
      const taskPatches = extractTaskPatchesFromExportEvents(filteredEvents);
      const mergeResult = mergeRemotePatches(localTodos, taskPatches);
      const deleted = detectRemoteDeletedTodos(localTodos, filteredEvents, {
        generatedAt: payload?.generatedAt,
        daysBack: payload?.daysBack,
        daysForward: payload?.daysForward,
      });

      sendJson(res, 200, {
        ok: true,
        message: "Pulled updates from macOS Calendar.app",
        result: {
          ...mergeResult,
          deleted,
          exportedEvents: events.length,
          filteredEvents: filteredEvents.length,
          targetCalendar,
          generatedAt: String(payload?.generatedAt || new Date().toISOString()),
        },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown task pull error";
      let status = 400;
      if (errorMessage === "BODY_TOO_LARGE") {
        status = 413;
      } else if (isCalendarBackendUnavailableMessage(errorMessage)) {
        status = 503;
      } else if (errorMessage.includes("ENOENT")) {
        status = 404;
      }
      sendJson(res, status, {
        ok: false,
        error: "MAC_TASKS_PULL_FAILED",
        message: errorMessage,
      });
    }
    return;
  }

  if ((method === "GET" || method === "HEAD") && pathname === "/calendar_sync.json") {
    fs.readFile(CALENDAR_SYNC_FILE_PATH, (error, content) => {
      if (error) {
        if (error.code === "ENOENT") {
          res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Not Found");
          return;
        }

        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Internal Server Error");
        return;
      }

      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      if (method === "HEAD") {
        res.end();
        return;
      }
      res.end(content);
    });
    return;
  }

  if (method !== "GET" && method !== "HEAD") {
    res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Method Not Allowed");
    return;
  }

  const targetPath = getSafePathname(pathname);
  if (!targetPath) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return;
  }

  fs.readFile(targetPath, (error, content) => {
    if (error) {
      if (error.code === "ENOENT") {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Not Found");
        return;
      }

      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Internal Server Error");
      return;
    }

    const ext = path.extname(targetPath).toLowerCase();
    const type = MIME_TYPES[ext] || "application/octet-stream";
    const headers = {
      "Content-Type": type,
    };

    if ([".html", ".css", ".js", ".json", ".webmanifest"].includes(ext)) {
      headers["Cache-Control"] = "no-store";
    }

    res.writeHead(200, headers);
    if (method === "HEAD") {
      res.end();
      return;
    }
    res.end(content);
  });
});

server.on("error", (error) => {
  console.error(`Server failed: ${error.message}`);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`Server running at http://${HOST}:${PORT}`);
});
