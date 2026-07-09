#!/bin/zsh
set -e

APP_DIR="${0:A:h}"
SERVER_ENTRY="$APP_DIR/.guanshi/server.js"
RUNTIME_DIR="$APP_DIR/.runtime"
PID_FILE="$RUNTIME_DIR/server.pid"
PORT_FILE="$RUNTIME_DIR/server.port"
LOG_FILE="$RUNTIME_DIR/server.log"

mkdir -p "$RUNTIME_DIR"

open_guanshi_url() {
  local target_url="$1"
  if [ "$CHROME_AVAILABLE" = "1" ]; then
    open -na "Google Chrome" --args --app="$target_url" >/dev/null 2>&1 || open "$target_url"
  else
    open "$target_url"
  fi
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
    PORT="$(cat "$PORT_FILE" 2>/dev/null || echo 8080)"
    URL="http://127.0.0.1:$PORT/"
    open_guanshi_url "$URL"
    echo "观时已经在运行：$URL"
    echo
    read "?按回车键关闭窗口..."
    exit 0
  fi
fi

PORT=""
for CANDIDATE in {8080..8090}; do
  if ! lsof -nP -iTCP:"$CANDIDATE" -sTCP:LISTEN >/dev/null 2>&1; then
    PORT="$CANDIDATE"
    break
  fi
done

if [ -z "$PORT" ]; then
  echo "8080 到 8090 端口都被占用，暂时无法启动观时。"
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
