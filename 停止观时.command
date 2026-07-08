#!/bin/zsh
set -e

APP_DIR="${0:A:h}"
RUNTIME_DIR="$APP_DIR/.runtime"
PID_FILE="$RUNTIME_DIR/server.pid"
PORT_FILE="$RUNTIME_DIR/server.port"

if [ ! -f "$PID_FILE" ]; then
  echo "没有找到正在运行的观时服务。"
  echo
  read "?按回车键关闭窗口..."
  exit 0
fi

SERVER_PID="$(cat "$PID_FILE" 2>/dev/null || true)"

if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" >/dev/null 2>&1; then
  kill "$SERVER_PID"
  echo "已停止观时服务。"
else
  echo "观时服务已经不在运行。"
fi

rm -f "$PID_FILE" "$PORT_FILE"
echo
read "?按回车键关闭窗口..."
