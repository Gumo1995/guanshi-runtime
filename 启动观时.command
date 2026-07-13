#!/bin/zsh
set -e

APP_DIR="${0:A:h}"
SERVER_ENTRY="$APP_DIR/.guanshi/server.js"
RUNTIME_DIR="$APP_DIR/.runtime"
PID_FILE="$RUNTIME_DIR/server.pid"
PORT_FILE="$RUNTIME_DIR/server.port"
LOG_FILE="$RUNTIME_DIR/server.log"
RUNTIME_CONFIG_FILE="$RUNTIME_DIR/runtime_config.json"
DEFAULT_PORT="8080"
PORT="${TIMEQUALITY_PORT:-}"

mkdir -p "$RUNTIME_DIR"

open_guanshi_url() {
  local target_url="$1"
  if [ "$CHROME_AVAILABLE" = "1" ]; then
    open -na "Google Chrome" --args --app="$target_url" >/dev/null 2>&1 || open "$target_url"
  else
    open "$target_url"
  fi
}

is_guanshi_service_on_port() {
  local target_port="$1"
  local status_url="http://127.0.0.1:$target_port/api/runtime/status"
  node -e '
const http = require("http");
const url = process.argv[1];
const req = http.get(url, { timeout: 800 }, (res) => {
  let body = "";
  res.setEncoding("utf8");
  res.on("data", (chunk) => { body += chunk; });
  res.on("end", () => {
    try {
      const parsed = JSON.parse(body || "{}");
      process.exit(res.statusCode === 200 && parsed && parsed.app === "guanshi" ? 0 : 1);
    } catch {
      process.exit(1);
    }
  });
});
req.on("timeout", () => {
  req.destroy();
  process.exit(1);
});
req.on("error", () => process.exit(1));
' "$status_url" >/dev/null 2>&1
}

if ! command -v node >/dev/null 2>&1; then
  echo "未找到 Node.js。请先安装 Node.js LTS 版本。"
  echo "下载地址：https://nodejs.org/"
  echo
  read "?按回车键关闭窗口..."
  exit 1
fi

NODE_VERSION="$(node -p 'process.versions.node' 2>/dev/null || echo "")"
NODE_MAJOR="${NODE_VERSION%%.*}"
if ! [[ "$NODE_MAJOR" =~ '^[0-9]+$' ]] || [ "$NODE_MAJOR" -lt 18 ]; then
  echo "当前 Node.js 版本过旧：${NODE_VERSION:-未知}"
  echo "请先安装 Node.js LTS 版本后再启动观时。"
  echo "下载地址：https://nodejs.org/"
  echo
  read "?按回车键关闭窗口..."
  exit 1
fi
NODE_LTS="$(node -p 'process.release && process.release.lts ? process.release.lts : ""' 2>/dev/null || echo "")"
if [ -z "$NODE_LTS" ]; then
  echo "当前 Node.js 版本不是 LTS：${NODE_VERSION:-未知}"
  echo "观时会继续启动，但建议用户版安装 Node.js LTS。"
  echo
fi

CHROME_AVAILABLE="0"
if [ -d "/Applications/Google Chrome.app" ] || [ -d "$HOME/Applications/Google Chrome.app" ] || [ -d "/System/Volumes/Data/Applications/Google Chrome.app" ]; then
  CHROME_AVAILABLE="1"
else
  echo "未找到 Google Chrome。"
  echo "观时会继续启动本地网页，但独立窗口和安装为 App 需要先安装 Chrome。"
  echo "下载地址：https://www.google.com/chrome/"
  echo
fi

if ! command -v git >/dev/null 2>&1; then
  echo "未找到 Git。"
  echo "观时可以继续使用，但设置里的在线更新功能不可用。"
  echo
fi

if [ -z "$PORT" ] && [ -f "$RUNTIME_CONFIG_FILE" ]; then
  PORT="$(node -e '
const fs = require("fs");
const file = process.argv[1];
try {
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  const port = Number.parseInt(String(parsed && parsed.port || ""), 10);
  if (Number.isInteger(port) && port >= 1 && port <= 65535) {
    process.stdout.write(String(port));
  }
} catch {}
' "$RUNTIME_CONFIG_FILE" 2>/dev/null || true)"
fi
PORT="${PORT:-$DEFAULT_PORT}"

if ! [[ "$PORT" =~ '^[0-9]+$' ]] || [ "$PORT" -lt 1 ] || [ "$PORT" -gt 65535 ]; then
  echo "端口配置无效：$PORT"
  echo "请使用 1 到 65535 之间的数字。"
  echo
  read "?按回车键关闭窗口..."
  exit 1
fi

if [ ! -f "$SERVER_ENTRY" ]; then
  echo "没有找到观时运行文件：$SERVER_ENTRY"
  echo "请确认这个文件夹完整下载。"
  echo
  read "?按回车键关闭窗口..."
  exit 1
fi

if [ -f "$PID_FILE" ]; then
  EXISTING_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [ -n "$EXISTING_PID" ] && kill -0 "$EXISTING_PID" >/dev/null 2>&1; then
    PORT="$(cat "$PORT_FILE" 2>/dev/null || echo "$PORT")"
    URL="http://127.0.0.1:$PORT/"
    open_guanshi_url "$URL"
    echo "观时已经在运行：$URL"
    echo
    read "?按回车键关闭窗口..."
    exit 0
  fi
fi

if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  if is_guanshi_service_on_port "$PORT"; then
    URL="http://127.0.0.1:$PORT/"
    open_guanshi_url "$URL"
    echo "观时已经在运行：$URL"
    echo "$PORT" > "$PORT_FILE"
    echo
    read "?按回车键关闭窗口..."
    exit 0
  fi

  echo "端口 $PORT 已被其他程序占用，观时未切换到新端口。"
  echo "这样可以避免浏览器把数据识别成另一份本地站点数据。"
  echo "请关闭占用端口的程序后重新启动；如确需临时端口，可在终端设置 TIMEQUALITY_PORT 后启动。"
  echo
  read "?按回车键关闭窗口..."
  exit 1
fi

cd "$APP_DIR"
TIMEQUALITY_DATA_DIR="$RUNTIME_DIR" PORT="$PORT" nohup node "$SERVER_ENTRY" > "$LOG_FILE" 2>&1 &
SERVER_PID="$!"
echo "$SERVER_PID" > "$PID_FILE"
echo "$PORT" > "$PORT_FILE"

sleep 1

if ! kill -0 "$SERVER_PID" >/dev/null 2>&1; then
  echo "观时启动失败。日志位置：$LOG_FILE"
  echo
  tail -n 20 "$LOG_FILE" 2>/dev/null || true
  echo
  read "?按回车键关闭窗口..."
  exit 1
fi

URL="http://127.0.0.1:$PORT/"
open_guanshi_url "$URL"

echo "观时已启动：$URL"
echo "日志位置：$LOG_FILE"
echo
read "?按回车键关闭窗口..."
