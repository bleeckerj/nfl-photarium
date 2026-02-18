"""
Photarium MCP Bridge Server
============================
Bridges the stdio-based Photarium MCP server to HTTP so that
Codex, LLMs, and other HTTP clients can discover and invoke tools.

Endpoints:
  GET  /tools          — List all available MCP tools
  POST /tool/<name>    — Call a tool by name (JSON body = arguments)
  GET  /openapi.json   — Auto-generated OpenAPI schema
  GET  /health         — Health check
"""

import subprocess
import json
import sys
import os
import threading
import time
from flask import Flask, request, jsonify

app = Flask(__name__)

# ── MCP subprocess management ──────────────────────────────────────────

MCP_CMD = ["node", "/Users/julian/Code/cloud-flare-image-handler/mcp-server/dist/index.js"]
MCP_ENV = {**os.environ, "PHOTARIUM_BASE_URL": "http://localhost:3000"}

_proc = None
_lock = threading.Lock()
_request_id = 0
_initialized = False
_tools_cache = None


def _next_id():
    global _request_id
    _request_id += 1
    return _request_id


def _start_mcp():
    """Launch the MCP server subprocess."""
    global _proc
    _proc = subprocess.Popen(
        MCP_CMD,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=MCP_ENV,
        bufsize=0,
    )
    # Drain stderr in background so it doesn't block
    t = threading.Thread(target=_drain_stderr, daemon=True)
    t.start()


def _drain_stderr():
    """Read and print MCP server stderr for debugging."""
    while _proc and _proc.poll() is None:
        line = _proc.stderr.readline()
        if line:
            sys.stderr.write(f"[MCP] {line.decode('utf-8', errors='replace')}")
            sys.stderr.flush()


def _send_rpc(method, params=None, is_notification=False):
    """Send a JSON-RPC 2.0 message to the MCP server and return the result."""
    global _proc
    if _proc is None or _proc.poll() is not None:
        _start_mcp()
        _do_initialize()

    msg = {"jsonrpc": "2.0", "method": method}
    if params is not None:
        msg["params"] = params

    if is_notification:
        # Notifications have no id and expect no response
        raw = json.dumps(msg) + "\n"
        _proc.stdin.write(raw.encode("utf-8"))
        _proc.stdin.flush()
        return None

    msg["id"] = _next_id()
    raw = json.dumps(msg) + "\n"
    _proc.stdin.write(raw.encode("utf-8"))
    _proc.stdin.flush()

    # Read response line
    resp_line = _proc.stdout.readline()
    if not resp_line:
        raise RuntimeError("MCP server closed stdout unexpectedly")

    resp = json.loads(resp_line.decode("utf-8"))

    if "error" in resp:
        raise RuntimeError(f"MCP error: {resp['error']}")

    return resp.get("result")


def _do_initialize():
    """Perform MCP initialize handshake."""
    global _initialized
    result = _send_rpc("initialize", {
        "protocolVersion": "2024-11-05",
        "capabilities": {},
        "clientInfo": {"name": "photarium-bridge", "version": "1.0.0"},
    })
    # Send initialized notification
    _send_rpc("notifications/initialized", is_notification=True)
    _initialized = True
    sys.stderr.write(f"[Bridge] MCP initialized: {json.dumps(result)}\n")
    sys.stderr.flush()


def _ensure_ready():
    """Make sure MCP is started and initialized."""
    global _proc, _initialized
    if _proc is None or _proc.poll() is not None:
        _initialized = False
        _start_mcp()
        _do_initialize()
    elif not _initialized:
        _do_initialize()


# ── HTTP Endpoints ─────────────────────────────────────────────────────

@app.route("/", methods=["GET"])
def index():
    return """<!DOCTYPE html>
<html><head><title>Photarium MCP Bridge</title>
<style>body{font-family:system-ui;max-width:700px;margin:40px auto;padding:0 20px;color:#333}
a{color:#2563eb}code{background:#f1f5f9;padding:2px 6px;border-radius:4px}
pre{background:#f1f5f9;padding:16px;border-radius:8px;overflow-x:auto}</style></head>
<body>
<h1>Photarium MCP Bridge</h1>
<p>HTTP bridge to the Photarium MCP server (stdio &rarr; HTTP).</p>
<h2>Endpoints</h2>
<ul>
<li><a href="/health"><code>GET /health</code></a> &mdash; Health check</li>
<li><a href="/tools"><code>GET /tools</code></a> &mdash; List all tools</li>
<li><code>POST /tool/&lt;name&gt;</code> &mdash; Call a tool (JSON body = arguments)</li>
<li><a href="/openapi.json"><code>GET /openapi.json</code></a> &mdash; OpenAPI schema</li>
</ul>
<h2>Example</h2>
<pre>curl -X POST http://127.0.0.1:5002/tool/photarium_search_text \\
  -H "Content-Type: application/json" \\
  -d '{"query":"blue car","limit":5}'</pre>
</body></html>"""


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "mcp_running": _proc is not None and _proc.poll() is None})


@app.route("/tools", methods=["GET"])
def list_tools():
    global _tools_cache
    with _lock:
        _ensure_ready()
        result = _send_rpc("tools/list", {})
    tools = result.get("tools", [])
    _tools_cache = tools

    # Return a simplified view
    summary = []
    for t in tools:
        summary.append({
            "name": t["name"],
            "description": t.get("description", ""),
            "parameters": t.get("inputSchema", {}),
        })
    return jsonify({"tools": summary, "count": len(summary)})


@app.route("/tool/<tool_name>", methods=["POST"])
def call_tool(tool_name):
    args = request.json or {}
    with _lock:
        _ensure_ready()
        result = _send_rpc("tools/call", {"name": tool_name, "arguments": args})

    # Parse the text content if it's JSON
    if result and "content" in result:
        for item in result["content"]:
            if item.get("type") == "text":
                try:
                    item["parsed"] = json.loads(item["text"])
                except (json.JSONDecodeError, TypeError):
                    pass

    is_error = result.get("isError", False) if result else False
    status_code = 400 if is_error else 200
    return jsonify(result), status_code


@app.route("/openapi.json", methods=["GET"])
def openapi_schema():
    """Generate an OpenAPI schema from discovered MCP tools."""
    global _tools_cache
    if _tools_cache is None:
        with _lock:
            _ensure_ready()
            result = _send_rpc("tools/list", {})
        _tools_cache = result.get("tools", [])

    paths = {}
    for t in _tools_cache:
        tool_name = t["name"]
        schema = t.get("inputSchema", {"type": "object", "properties": {}})
        paths[f"/tool/{tool_name}"] = {
            "post": {
                "summary": t.get("description", tool_name),
                "operationId": tool_name,
                "requestBody": {
                    "required": True,
                    "content": {
                        "application/json": {
                            "schema": schema,
                        }
                    },
                },
                "responses": {
                    "200": {"description": "Successful tool call"},
                    "400": {"description": "Tool error"},
                },
            }
        }

    openapi = {
        "openapi": "3.0.0",
        "info": {
            "title": "Photarium MCP Bridge",
            "version": "1.0.0",
            "description": "HTTP bridge to the Photarium MCP server tools",
        },
        "servers": [{"url": f"http://127.0.0.1:{os.environ.get('BRIDGE_PORT', '5002')}"}],
        "paths": paths,
    }
    return jsonify(openapi)


# ── Main ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    port = int(os.environ.get("BRIDGE_PORT", "5002"))
    print("Starting Photarium MCP Bridge Server...")

    # Start MCP immediately
    _start_mcp()
    _do_initialize()
    print(f"  MCP server initialized with {_proc.pid if _proc else '?'} PID")

    print(f"  GET  http://127.0.0.1:{port}/tools        — list tools")
    print(f"  POST http://127.0.0.1:{port}/tool/<name>   — call a tool")
    print(f"  GET  http://127.0.0.1:{port}/openapi.json  — OpenAPI schema")
    print(f"  GET  http://127.0.0.1:{port}/health        — health check")
    print()
    app.run(host="127.0.0.1", port=port, debug=False)
