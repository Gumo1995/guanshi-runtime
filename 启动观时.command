#!/bin/zsh
set -e

APP_DIR="${0:A:h}"
SERVER_ENTRY="$APP_DIR/.guanshi/server.js"
RUNTIME_DIR="$APP_DIR/.runtime"
PID_FILE="$RUNTIME_DIR/server.pid"
PORT_FILE="$RUNTIME_DIR/server.port"
LOG_FILE="$RUNTIME_DIR/server.log"

mkdir -p "$RUNTIME_DIR"

if ! command -v node >/dev/null 2>&1; then
  echo "未找到 Node.js。请先安装 Node.js LTS 版本。"
  echo "下载地址：https://nodejs.org/"
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
    PORT="$(cat "$PORT_FILE" 2>/dev/null || echo 8080)"
    URL="http://127.0.0.1:$PORT/"
    open -na "Google Chrome" --args --app="$URL" >/dev/null 2>&1 || open "$URL"
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
open -na "Google Chrome" --args --app="$URL" >/dev/null 2>&1 || open "$URL"

echo "观时已启动：$URL"
echo "日志位置：$LOG_FILE"
echo
read "?按回车键关闭窗口..."
