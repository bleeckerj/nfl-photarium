# `run_photarium_mcp_server.sh` README

Helper script to run the Photarium MCP server (`mcp-server/dist/index.js`) with lifecycle commands and listener diagnostics.

## Location

- `cloud-flare-image-handler/run_photarium_mcp_server.sh`

## Commands

From `cloud-flare-image-handler/`:

```bash
./run_photarium_mcp_server.sh start
./run_photarium_mcp_server.sh stop
./run_photarium_mcp_server.sh restart
./run_photarium_mcp_server.sh status
```

## Started automatically by `npm run dev`

`scripts/start-photarium.mjs` (the `npm run dev` supervisor) launches this script with `start` once Photarium reports healthy, and stops it on Ctrl-C. It sets `KILL_IF_OCCUPIED=1` so a stale bridge on the port is replaced. Set `PHOTARIUM_MCP_BRIDGE=0` to skip it, for example when you run the bridge by hand from another terminal.

Image-detail tools such as Creative Brief call the bridge over HTTP; the Next app reads `PHOTARIUM_MCP_URL` (default `http://127.0.0.1:8787`) to find it, so keep that in step with `PHOTARIUM_HTTP_PORT` if you change the port. When the bridge is down those tools now fail with a message naming this script rather than a bare `fetch failed`.

## Port configuration

Defaults:

- Host: `127.0.0.1`
- Port: `8787`

Set via environment variables:

- `PHOTARIUM_HTTP_HOST`
- `PHOTARIUM_HTTP_PORT`

Example:

```bash
PHOTARIUM_HTTP_PORT=8790 ./run_photarium_mcp_server.sh start
```

## Base URL configuration

This MCP server proxies to the Photarium app/API base URL.

- Env var: `PHOTARIUM_BASE_URL`
- Default: `http://127.0.0.1:3000`

Example:

```bash
PHOTARIUM_BASE_URL=http://127.0.0.1:3001 PHOTARIUM_HTTP_PORT=8790 ./run_photarium_mcp_server.sh restart
```

## Port conflict behavior

If `start` finds a listener on the configured port, it exits with process info.

To force replacement:

```bash
KILL_IF_OCCUPIED=1 ./run_photarium_mcp_server.sh start
```

## Build behavior

If `mcp-server/dist/index.js` is missing, the script runs `npm run build` in `mcp-server/` automatically.
