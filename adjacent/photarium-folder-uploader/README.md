# Photarium Folder Uploader

A standalone local folder watcher for Photarium. It uploads newly detected images to a configured namespace, then asks Photarium to generate a detailed description and semantic tags describing the image content.

Operational metadata stays in the local checkpoint. The utility does not add filenames, paths, namespaces, provider names, workflow names, or watcher labels as image tags.

## Setup

```bash
npm install
npm run build
cp config.example.json photarium-folder-uploader.json
```

Edit `photarium-folder-uploader.json`, then run:

```bash
npm start -- --config ./photarium-folder-uploader.json
```

The watcher only processes image files placed directly in `watchPath`. It leaves source files in place and uses a content-hash checkpoint to avoid re-uploading renamed or copied files in the same namespace.

## Connection modes

HTTP is the default:

```json
{
  "connection": {
    "mode": "http",
    "baseUrl": "http://localhost:3000"
  }
}
```

MCP uses the Photarium MCP server over stdio:

```json
{
  "connection": {
    "mode": "mcp",
    "command": "node",
    "args": ["/absolute/path/to/photarium/mcp-server/dist/index.js"],
    "cwd": "/absolute/path/to/photarium"
  }
}
```

The MCP server process inherits the utility's environment, including the Photarium server configuration. Keep credentials in the environment or approved secret storage rather than in this JSON file.

## Failure and retry behavior

Upload, description generation, and tag generation are checkpointed separately. If enrichment fails after upload, the next attempt resumes from the missing stage and does not upload the image again. A bounded retry is scheduled while the watcher is running; unfinished entries are retried on a later restart.

Useful commands:

```bash
npm start -- --config ./photarium-folder-uploader.json --once
npm start -- --config ./photarium-folder-uploader.json --dry-run
npm start -- --config ./photarium-folder-uploader.json --namespace client-archive
```

## Tests

```bash
npm run typecheck
npm test
npm run build
```
