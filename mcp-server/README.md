# Photarium MCP Server (photarium-mcp-server)

MCP (Model Context Protocol) server that exposes the full Photarium API surface to AI agents, enabling LLMs to browse, search, manage, and curate a Cloudflare Images catalog.

## Tools


### Discovery & Search

- `photarium_search`
- `photarium_search_text`
- `photarium_search_metadata`
- `photarium_search_color`
- `photarium_similar`
- `photarium_antipode`
- `photarium_list`
- `photarium_get`

#### Search Methods Explained

- **`photarium_search`** (Semantic): Uses AI to understand the meaning of your query. "vibe coding illustration" finds images that *look like* vibe coding illustrations, even if they're not tagged that way.

- **`photarium_search_text`** (Text): Traditional search matching exact text in metadata. "hero" finds files named "hero.png" or tagged "hero".

- **`photarium_search_metadata`** (Field-aware): Like text search but you choose which fields to scan (filename, folder, tags, description, alt text, namespace, source/original URLs), the match mode (`contains`, `exact`, `prefix`, `regex`), and case sensitivity. Each result reports which fields matched. Use for precise filename or field-scoped lookups, e.g. filename `prefix` "hero-" or an `exact` tag.

- **`photarium_search_color`** (Color): Finds images with matching dominant colors. "#FF5733" finds orange-toned images.


### Organization

- `photarium_list_folders`
- `photarium_create_folder`
- `photarium_list_namespaces`
- `photarium_rename_namespace`
- `photarium_delete_namespace`
- `photarium_update_metadata`
- `photarium_delete`

Namespace admin tools default to `dryRun: true`. Live namespace rename/delete calls require `dryRun: false` and the matching confirmation token.


### Upload

- `photarium_upload_url`
- `photarium_upload_image`
- `photarium_crop_variant` (width-preserving still/animated WebP crop uploaded as a source image variant)
- `photarium_fs_ingest` (recursive local image/video ingest from a directory tree)
  - includes local checkpointing to skip unchanged files on reruns (avoids repeat AI/API work)

### Instagram

These tools wrap the existing repository Instagram scripts and reuse their authenticated Chromium profile, NDJSON, checkpoint, and Photarium upload behavior.

- `photarium_instagram_auth`
- `photarium_instagram_ingest_profile`
- `photarium_instagram_ingest_single_url`
- `photarium_instagram_replay_videos`
- `photarium_instagram_recover_videos`

Instagram stories are not currently exposed by the repository scripts, so story ingest is not implemented in this MCP surface yet.

#### Crop Variants

`photarium_crop_variant` creates a width-preserving WebP crop from original Photarium image bytes and uploads it as a variant. It supports still images and animated WebP/GIF sources. Animated output preserves frame delays when source metadata includes them.

Defaults:

- `aspectRatio`: `4:5`
- `anchor`: `bottom`
- `quality`: `90`
- `parentId`: source `imageId`

Common ratios exposed in the UI are `1:1`, `3:2`, `4:5`, `5:4`, `9:16`, and `16:9`. The tool also accepts any positive `width:height` value. It rejects crops that cannot fit the source height because v1 preserves full width without padding or scaling.

Example:

```json
{
  "imageId": "source-image-id",
  "aspectRatio": "1:1",
  "anchor": "center",
  "filename": "source-square-center.webp"
}
```


### Image Tools

- `photarium_image_tools_list`
- `photarium_image_tool_run`
- `photarium_image_tool_preview`
- `photarium_image_tool_run_get`
- `photarium_image_tool_preview_get`

These tools expose Photarium's server-side image-tool manifests plus asynchronous run, preview, and status records. Run and preview requests accept optional manifest overrides and pass open-ended `params` through to the selected image tool.


### AI Features

- `photarium_generate_alt`
- `photarium_generate_description`
- `photarium_generate_prompt`
- `photarium_generate_image`
- `photarium_generate_from_references`
- `photarium_semantic_merge`
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
- Image-tool manifests, runs, previews, and status records
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

Image generation tools also require an OpenAI API key in the MCP server environment:

```bash
export OPENAI_API_KEY=your_api_key_here
```

Optional image generation settings:

```bash
export PHOTARIUM_OPENAI_IMAGE_MODEL=gpt-image-2
export OPENAI_API_BASE_URL=https://api.openai.com/v1
```

Optional HTTP proxy settings (disabled by default):

```bash
export PHOTARIUM_HTTP_ENABLED=true
export PHOTARIUM_HTTP_HOST=127.0.0.1
export PHOTARIUM_HTTP_PORT=8787
```

HTTP proxy helper endpoints:

```bash
curl http://127.0.0.1:8787/help
curl http://127.0.0.1:8787/help/photarium_fs_ingest
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
- "Preview renaming namespace old-space to new-space"
- "Preview deleting namespace old-space"
- "Move this image to the 'featured' folder"
- "Add tags 'hero', 'landing' to image abc123"

**AI Analysis:**
- "Generate alt text for this image"
- "Describe this image in detail"
- "What text-to-image prompt would recreate this photo?"
- "What are the semantic qualities of this image?"
- "Generate a new product image from this prompt and store it in the `generated` namespace"
- "Use image abc123 as a style reference and image def456 as a subject reference for a new generated image"
- "Semantically merge these two images into a new visual direction without exact logo placement"

**Upload & Management:**
- "Upload this image URL to the 'editorial' namespace"
- "Upload this base64 image into the comfyui folder"
- "Recursively ingest ~/Code/chester-downloads-discord-images into the midjourney namespace and use AI for display names and tags"
- "Recursively ingest ~/Code/chester-downloads-discord-images into the midjourney namespace and throttle uploads to 500ms between requests"
- "Ingest this Instagram reel URL into the default ig-videos namespace using the saved browser profile"
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

### photarium_generate_image

Generate a new image from text and upload it back into Photarium. The tool stores generation provenance in the uploaded image prompt record.

```json
{
  "prompt": "A refined product photograph of a countertop espresso machine in a calm contemporary kitchen",
  "size": "1536x1024",
  "quality": "high",
  "outputFormat": "png",
  "namespace": "generated-images",
  "folder": "kitchen-ai",
  "tags": ["generated", "product-ad"],
  "description": "Generated KitchenAI espresso-machine ad concept"
}
```

Use `dryRun: true` to validate the request shape without calling OpenAI or uploading:

```json
{
  "prompt": "A quiet product image of a ceramic mug",
  "dryRun": true
}
```

### photarium_generate_from_references

Generate a new image from a prompt plus one or more Photarium image IDs or direct image URLs. References are generative guidance, not exact placement.

```json
{
  "prompt": "Create a premium kitchen-appliance advertisement with a calm editorial mood",
  "references": [
    {
      "imageId": "5a2d51d8-25f9-44c1-b7f8-86c3a874c800",
      "role": "brand_reference",
      "instructions": "Use the color and brand tone as loose direction; do not reproduce the mark exactly."
    },
    {
      "url": "https://example.com/source-product.png",
      "role": "subject_reference",
      "instructions": "Use the product category and silhouette as inspiration."
    }
  ],
  "namespace": "generated-images",
  "folder": "reference-generations",
  "tags": ["generated", "reference"]
}
```

Supported reference roles:

- `style_reference`
- `subject_reference`
- `composition_reference`
- `brand_reference`
- `logo_reference`
- `semantic_source`

SVG or otherwise unsupported Photarium source images are rasterized to PNG before being sent as image inputs.

### photarium_semantic_merge

Generate a new image by semantically merging multiple source images. This is for synthesis of mood, visual language, subject matter, material cues, or brand direction. It does not preserve exact logos, pixels, or layout.

```json
{
  "mergeBrief": "Blend the premium appliance-ad mood of the first source with the industrial-design language of the second source.",
  "prompt": "Keep the result photorealistic, domestic, refined, and suitable for editorial ad placement.",
  "sources": [
    {
      "imageId": "source-style-id",
      "role": "style_reference"
    },
    {
      "imageId": "source-product-id",
      "role": "subject_reference"
    }
  ],
  "outputFormat": "webp",
  "namespace": "generated-images",
  "folder": "semantic-merges",
  "tags": ["generated", "semantic-merge"]
}
```

If you need exact placement, for example placing an exact logo over a generated image, use a deterministic compositing workflow outside `photarium_semantic_merge`.

## Testing Image Generation Tools

Recommended validation sequence:

1. Build the MCP server:

   ```bash
   cd mcp-server
   npm run build
   ```

2. Run the MCP-related tests from the repository root:

   ```bash
   npm test -- photariumMcp
   ```

3. Verify dry-run behavior through the built executor. This does not call OpenAI or upload:

   ```bash
   cd mcp-server
   node -e "import('./dist/app.js').then(async ({createPhotariumMcpApp}) => { const app = createPhotariumMcpApp(); const result = await app.executor.invoke('photarium_generate_image', {prompt:'dry run product photo', dryRun:true}, {transport:'stdio'}); console.log(result.content[0].text); })"
   ```

4. For live smoke testing, start Photarium locally, set `PHOTARIUM_BASE_URL` and `OPENAI_API_KEY`, then call `photarium_generate_image` with a low-cost prompt and a dedicated test namespace/folder such as `generated-test/mcp-smoke`.

5. Test reference handling with one raster Photarium image ID and one SVG Photarium image ID. Confirm the returned provenance lists source IDs, roles, and any rasterization warning.

6. Test semantic merge with two existing image IDs. Confirm the result is uploaded as a new image and the stored prompt record includes `mode: "semantic_merge"` and source provenance.

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
