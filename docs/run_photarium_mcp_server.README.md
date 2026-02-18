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
