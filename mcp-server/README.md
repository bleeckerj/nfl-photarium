# Photarium MCP Server (photarium-mcp-server)

MCP (Model Context Protocol) server that exposes the full Photarium API surface to AI agents, enabling LLMs to browse, search, manage, and curate a Cloudflare Images catalog.

## Tools


### Discovery & Search

- `photarium_search`
- `photarium_search_text`
- `photarium_search_color`
- `photarium_similar`
- `photarium_antipode`
- `photarium_list`
- `photarium_get`

#### Search Methods Explained

- **`photarium_search`** (Semantic): Uses AI to understand the meaning of your query. "vibe coding illustration" finds images that *look like* vibe coding illustrations, even if they're not tagged that way.

- **`photarium_search_text`** (Text): Traditional search matching exact text in metadata. "hero" finds files named "hero.png" or tagged "hero".

- **`photarium_search_color`** (Color): Finds images with matching dominant colors. "#FF5733" finds orange-toned images.


### Organization

- `photarium_list_folders`
- `photarium_create_folder`
- `photarium_list_namespaces`
- `photarium_update_metadata`
- `photarium_delete`


### Upload

- `photarium_upload_url`
- `photarium_upload_image`


### AI Features

- `photarium_generate_alt`
- `photarium_generate_description`
- `photarium_generate_prompt`
- `photarium_concepts`


### System

- `photarium_vector_status`
- `photarium_generate_embeddings`
- `photarium_backup`
- `photarium_list_backups`


### Download

- `photarium_download_image`

### Additional API Coverage

This MCP server also wraps the remaining Photarium endpoints, including:

- Imports, internal uploads, external uploads, animations, and upload downloads
- Prompt records (get + bulk), extras get/patch, and haiku generation
- Embedding status + batch generation, vector index creation, colors bulk lookup
- Family operations (swap parent, delete family, delete-family job status)
- Share URL generation, rotation, and audit utilities

## Setup

```bash
cd mcp-server
npm install
npm run build
```

## Run the MCP Server

Stdio (default):

```bash
npm run dev
```

HTTP proxy enabled:

```bash
PHOTARIUM_HTTP_ENABLED=true npm run dev
```

## Configuration

Set the base URL of your Photarium instance:

```bash
export PHOTARIUM_BASE_URL=http://localhost:3000
```

Optional HTTP proxy settings (disabled by default):

```bash
export PHOTARIUM_HTTP_ENABLED=true
export PHOTARIUM_HTTP_HOST=127.0.0.1
export PHOTARIUM_HTTP_PORT=8787
```

## Usage with Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "photarium": {
      "command": "node",
      "args": ["/path/to/photarium/mcp-server/dist/index.js"],
      "env": {
        "PHOTARIUM_BASE_URL": "http://localhost:3000"
      }
    }
  }
}
```

## Usage with VS Code (GitHub Copilot)

Add to your VS Code `settings.json`:

```json
{
  "github.copilot.chat.codeGeneration.useInstructionFiles": true,
  "mcp": {
    "servers": {
      "photarium": {
        "command": "node",
        "args": ["${workspaceFolder}/mcp-server/dist/index.js"],
        "env": {
          "PHOTARIUM_BASE_URL": "http://localhost:3000"
        }
      }
    }
  }
}
```

Or in `.vscode/mcp.json`:

```json
{
  "servers": {
    "photarium": {
      "command": "node",
      "args": ["${workspaceFolder}/mcp-server/dist/index.js"],
      "env": {
        "PHOTARIUM_BASE_URL": "http://localhost:3000"
      }
    }
  }
}
```

## Example Queries

Once connected, you can ask the AI:

**Search & Discovery:**
- "Find images related to urban futurism"
- "Search for images with warm orange tones"
- "Show me images similar to image ID abc123"
- "Find images that are the opposite of this one visually"

**Organization:**
- "List all images in the 'blog-posts' folder"
- "What folders are available in the gallery?"
- "Move this image to the 'featured' folder"
- "Add tags 'hero', 'landing' to image abc123"

**AI Analysis:**
- "Generate alt text for this image"
- "Describe this image in detail"
- "What text-to-image prompt would recreate this photo?"
- "What are the semantic qualities of this image?"

**Upload & Management:**
- "Upload this image URL to the 'editorial' namespace"
- "Upload this base64 image into the comfyui folder"
- "Delete image abc123"

## Integration with Editorial Workflow

The Photarium MCP works well alongside editorial MCPs:

```
User: "Write a draft about mundane futurism and include relevant images"

AI workflow:
1. Generate article draft
2. photarium_search("mundane futurism everyday objects") → finds relevant images
3. photarium_generate_description(imageId) → gets image context
4. Combines draft with image URLs and descriptions
```

## Tool Details

### photarium_search

Semantic search using CLIP embeddings. Excellent for:
- Finding images by concept ("minimalist architecture")
- Finding images by mood ("melancholic sunset")
- Finding images by subject ("vintage typewriter")

```json
{
  "query": "futuristic urban landscape at night",
  "limit": 10
}
```

### photarium_similar

Find visually similar images:

```json
{
  "imageId": "abc123",
  "type": "clip",  // or "color"
  "limit": 10
}
```

### photarium_antipode

Find opposite images:

```json
{
  "imageId": "abc123",
  "domain": "clip",  // or "color"
  "method": "stranger"  // CLIP: negate, stranger, otherwise, reflectroid
                        // Color: complementary, histogram, lightness, negative
}
```

### photarium_update_metadata

Update image properties:

```json
{
  "imageId": "abc123",
  "folder": "featured",
  "tags": ["hero", "landing-page"],
  "description": "Hero image for the landing page",
  "altTag": "Modern cityscape at sunset"
}
```

### photarium_concepts

Get semantic analysis:

```json
{
  "imageId": "abc123"
}
```

Returns scores like:
- warm ↔ cold
- minimal ↔ complex
- playful ↔ serious
- bright ↔ dark
- organic ↔ artificial

### photarium_backup

Trigger a Redis database backup. Creates both an RDB snapshot and a compressed bundle with AOF files:

```json
{
  "keepCount": 10,  // optional: number of backups to retain
  "dryRun": false   // optional: preview without actually backing up
}
```

The backup process:
1. Triggers Redis BGSAVE to create an RDB snapshot
2. Triggers BGREWRITEAOF to compact the append-only file
3. Copies dump.rdb from the container
4. Creates a .tgz bundle with RDB + AOF files
5. Rotates old backups to keep only the specified count

### photarium_list_backups

List existing Redis backups with timestamps and sizes:

```json
{}
```

Returns grouped backup sets showing RDB and bundle files for each timestamp.
