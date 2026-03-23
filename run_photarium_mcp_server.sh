#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MCP_DIR="$ROOT_DIR/mcp-server"
ACTION="${1:-start}"

if [[ ! -d "$MCP_DIR" ]]; then
  echo "Missing mcp-server directory at $MCP_DIR" >&2
  exit 1
fi

resolve_bin() {
  local name="$1"
  shift
  if command -v "$name" >/dev/null 2>&1; then
    command -v "$name"
    return 0
  fi
  local candidate
  for candidate in "$@"; do
    if [[ -x "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  echo "Unable to find $name. Add it to PATH or install it in a standard location." >&2
  return 1
}

NODE_BIN="$(resolve_bin node /usr/local/bin/node /opt/homebrew/bin/node /opt/local/bin/node)"

if [[ ! -f "$MCP_DIR/dist/index.js" ]]; then
  echo "Build output missing. Running npm run build..." >&2
  NPM_BIN="$(resolve_bin npm /usr/local/bin/npm /opt/homebrew/bin/npm /opt/local/bin/npm)"
  (cd "$MCP_DIR" && "$NPM_BIN" run build)
fi

export PHOTARIUM_BASE_URL="${PHOTARIUM_BASE_URL:-http://127.0.0.1:3000}"
export PHOTARIUM_HTTP_ENABLED="${PHOTARIUM_HTTP_ENABLED:-true}"
export PHOTARIUM_HTTP_HOST="${PHOTARIUM_HTTP_HOST:-127.0.0.1}"
export PHOTARIUM_HTTP_PORT="${PHOTARIUM_HTTP_PORT:-8787}"

prepare_runtime_env() {
  if [[ "$PHOTARIUM_HTTP_ENABLED" != "true" ]]; then
    unset PHOTARIUM_HTTP_PORT
  fi
}

port_pids() {
  lsof -tiTCP:"$PHOTARIUM_HTTP_PORT" -sTCP:LISTEN 2>/dev/null || true
}

show_port_owners() {
  local pids
  pids="$(port_pids)"
  if [[ -z "$pids" ]]; then
    echo "No listener on ${PHOTARIUM_HTTP_HOST}:${PHOTARIUM_HTTP_PORT}"
    return 1
  fi
  echo "Listener(s) on ${PHOTARIUM_HTTP_HOST}:${PHOTARIUM_HTTP_PORT}:"
  while IFS= read -r pid; do
    [[ -z "$pid" ]] && continue
    ps -p "$pid" -ww -o pid,ppid,args
  done <<< "$pids"
  return 0
}

stop_listeners() {
  local pids
  pids="$(port_pids)"
  if [[ -z "$pids" ]]; then
    echo "Nothing to stop on :$PHOTARIUM_HTTP_PORT"
    return 0
  fi
  echo "Stopping listener(s) on :$PHOTARIUM_HTTP_PORT -> $pids"
  while IFS= read -r pid; do
    [[ -z "$pid" ]] && continue
    kill "$pid" 2>/dev/null || true
  done <<< "$pids"
  sleep 0.3
  local still
  still="$(port_pids)"
  if [[ -n "$still" ]]; then
    echo "Force-killing remaining: $still"
    while IFS= read -r pid; do
      [[ -z "$pid" ]] && continue
      kill -9 "$pid" 2>/dev/null || true
    done <<< "$still"
  fi
}

case "$ACTION" in
  status)
    show_port_owners || true
    ;;
  stop)
    stop_listeners
    ;;
  restart)
    if [[ "$PHOTARIUM_HTTP_ENABLED" == "true" ]]; then
      stop_listeners
    fi
    prepare_runtime_env
    exec "$NODE_BIN" "$MCP_DIR/dist/index.js"
    ;;
  start)
    if [[ "$PHOTARIUM_HTTP_ENABLED" == "true" ]]; then
      if show_port_owners >/dev/null 2>&1; then
        if [[ "${KILL_IF_OCCUPIED:-0}" == "1" ]]; then
          echo "Port $PHOTARIUM_HTTP_PORT is occupied; KILL_IF_OCCUPIED=1 so restarting..."
          stop_listeners
        else
          echo "Port $PHOTARIUM_HTTP_PORT is already in use."
          show_port_owners || true
          echo "Use: $0 stop   (or KILL_IF_OCCUPIED=1 $0 start)"
          exit 1
        fi
      fi
    fi
    prepare_runtime_env
    exec "$NODE_BIN" "$MCP_DIR/dist/index.js"
    ;;
  *)
    echo "Usage: $0 [start|stop|restart|status]" >&2
    exit 2
    ;;
esac
