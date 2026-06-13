# Photarium MCP Tools

## Discovery & Search
- `photarium_search`
- `photarium_search_text`
- `photarium_search_metadata` (field-aware metadata search: choose fields, match mode, case sensitivity)
- `photarium_search_color`
- `photarium_similar`
- `photarium_antipode`
- `photarium_list`
- `photarium_get`

## Organization
- `photarium_list_folders`
- `photarium_create_folder`
- `photarium_list_namespaces`
- `photarium_update_metadata`
- `photarium_delete`

## Upload
- `photarium_upload_url`
- `photarium_upload_image`
- `photarium_crop_variant` (width-preserving still/animated WebP crop uploaded as a source image variant)
- `photarium_fs_ingest` (recursive local image/video ingest by directory tree)
  - supports `throttleMs` to pace upload requests globally
  - automatically caches successful uploads locally and skips unchanged files on reruns

## Image Tools
- `photarium_image_tools_list`
- `photarium_image_tool_run`
- `photarium_image_tool_preview`
- `photarium_image_tool_run_get`
- `photarium_image_tool_preview_get`

The image-tool runtime tools mirror Photarium's `/api/image-tools` manifest, run, preview, and status endpoints. `request` is optional for run and preview calls; when present, it is merged with the selected tool manifest's `defaultRequest`, including open-ended `params` for tool-specific controls.

### Crop Variants

`photarium_crop_variant` downloads a Photarium image's original bytes, creates a full-width crop, uploads the result as WebP, and attaches it as a variant of the source image unless `parentId` is supplied.

Supported anchors are `top`, `center`, and `bottom`. The default is `bottom`. The default aspect ratio is `4:5`; common UI/API presets are `1:1`, `3:2`, `4:5`, `5:4`, `9:16`, and `16:9`. Still images and animated WebP/GIF sources are supported. Animated outputs preserve frame delays when the source metadata provides them.

Example:

```json
{
  "imageId": "source-image-id",
  "aspectRatio": "1:1",
  "anchor": "center",
  "quality": 90,
  "filename": "source-square-center.webp",
  "tags": ["square-crop"]
}
```

The crop preserves source width. If the requested ratio needs more height than the source image or animation frame has, the tool fails clearly instead of padding or scaling.

## AI Features
- `photarium_generate_alt`
- `photarium_generate_description`
- `photarium_generate_prompt`
- `photarium_generate_image`
- `photarium_generate_from_references`
- `photarium_semantic_merge`
- `photarium_concepts`

### Image Generation

The image generation tools call OpenAI image generation from the Photarium MCP server and upload generated outputs back into Photarium. They require `OPENAI_API_KEY` in the MCP server environment.

- `photarium_generate_image` creates a new image from a text prompt.
- `photarium_generate_from_references` creates a new image from a prompt plus Photarium image IDs or direct image URLs.
- `photarium_semantic_merge` semantically blends multiple source images into a new generated image. It is synthesis, not exact compositing.

All three tools support `dryRun: true` for request-shape testing without OpenAI or upload side effects.

Example text-to-image dry run:

```json
{
  "prompt": "A calm product photograph of a countertop espresso machine in a contemporary kitchen",
  "dryRun": true,
  "outputFormat": "png",
  "namespace": "generated-test",
  "folder": "mcp-smoke"
}
```

Example reference generation:

```json
{
  "prompt": "Create a premium appliance-ad image using the first source for brand tone and the second source for product form.",
  "references": [
    {
      "imageId": "brand-reference-id",
      "role": "brand_reference",
      "instructions": "Use color and tone only; do not reproduce exact logo geometry."
    },
    {
      "imageId": "product-reference-id",
      "role": "subject_reference"
    }
  ],
  "namespace": "generated-images",
  "folder": "reference-generations"
}
```

Example semantic merge:

```json
{
  "mergeBrief": "Blend the refined kitchen mood of the first source with the industrial design language of the second source.",
  "sources": [
    { "imageId": "style-source-id", "role": "style_reference" },
    { "imageId": "object-source-id", "role": "subject_reference" }
  ],
  "tags": ["generated", "semantic-merge"]
}
```

Testing checklist:

1. `cd mcp-server && npm run build`
2. From the repo root, run `npm test -- photariumMcp`
3. Use `dryRun: true` for all three tools and confirm the returned payload includes the expected `mode`, OpenAI endpoint, output format, upload target, and source provenance.
4. For live smoke tests, set `PHOTARIUM_BASE_URL` and `OPENAI_API_KEY`, use a dedicated test namespace/folder, and verify the uploaded result has prompt provenance.
5. For reference tests, include both raster and SVG Photarium images and confirm SVG sources are rasterized with a warning.
6. For semantic merge tests, confirm the result is conceptually blended and not treated as exact logo or pixel placement.

## System
- `photarium_vector_status`
- `photarium_generate_embeddings`
- `photarium_backup`
- `photarium_list_backups`

## Download
- `photarium_download_image`

## HTTP Help
- `GET /help` - list MCP HTTP proxy endpoints and discoverability hints
- `GET /help/<tool-name>` - show schema + HTTP call pattern for a specific tool (example: `/help/photarium_fs_ingest`)
