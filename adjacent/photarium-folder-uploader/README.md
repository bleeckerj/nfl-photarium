# Photarium Folder Uploader

A standalone local folder watcher for Photarium. It uploads newly detected images to a configured namespace, applies configured fixed tags at upload time, and waits for Photarium's durable background enrichment jobs to verify their results.

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

The watcher only processes image files placed directly in `watchPath`. It leaves source files in place and uses a content-hash checkpoint to avoid re-uploading renamed or copied files in the same namespace. The `tags` array is sent directly to the canonical upload workflow, which queues semantic tag generation by default.

## CleanShotX listener

From this directory, start the dedicated CleanShotX listener with:

```bash
npm run listen:cleanshot
```

It watches `/Users/julian/OMATA Dropbox/Julian Bleecker/CleanShotX/`, uploads to the `cf-cleanshot` namespace, and applies the fixed `screenshot` tag to every upload. The command builds the watcher before starting it. Leave the terminal open while it runs and press `Ctrl-C` to stop it.

The listener uses the durable checkpoint at `~/.photarium-folder-uploader/state.json`. It scans existing eligible files on startup and then watches for new top-level image files. The MCP wrapper is launched with HTTP compatibility disabled because this listener uses the MCP stdio connection.

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

Fixed upload tags can be configured alongside the namespace:

```json
{
  "namespace": "cf-cleanshot",
  "tags": ["screenshot"]
}
```

These fixed tags are preserved alongside Photarium's generated semantic tags.

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

The Photarium Node runtime starts the semantic-tag worker automatically. For a
separately supervised deployment or diagnostics, start it from the repository
root with:

```bash
npm run semantic-tags:worker
```

Redis must be running first (`npm run redis:start` or as part of the full development startup). The worker reads the same durable queue used by web uploads, MCP uploads, and ingestion scripts.

## Failure and retry behavior

Upload and description generation are checkpointed separately. Semantic tagging is owned by Photarium's durable queue: the watcher stores the returned job ID, polls its status, and marks the tags stage complete only after the worker verifies persistence. If enrichment fails after upload, the next attempt resumes from the missing stage and does not upload the image again.

Semantic tagging is enabled for uploads by default. An individual workflow can explicitly send `generateSemanticTags=false`; `AUTO_TAGS_ON_UPLOAD=false` remains an emergency global disable switch. When Redis is unavailable, the image upload still succeeds and returns a visible retryable semantic-tag error.

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
