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
- `photarium_rename_namespace`
- `photarium_delete_namespace`
- `photarium_update_metadata`
- `photarium_delete`

Namespace admin tools wrap `/api/namespaces`. `photarium_rename_namespace` uses `PATCH` and `photarium_delete_namespace` uses `DELETE`. Both default to `dryRun: true`; live runs require `dryRun: false` plus `confirm: "RENAME_NAMESPACE"` or `confirm: "DELETE_NAMESPACE"` respectively.

## Upload
- `photarium_upload_url`
- `photarium_upload_image`
- `photarium_crop_variant` (width-preserving still/animated WebP crop uploaded as a source image variant)
- `photarium_fs_ingest` (recursive local image/video ingest by directory tree)
  - supports `throttleMs` to pace upload requests globally
  - automatically caches successful uploads locally and skips unchanged files on reruns

## Instagram
- `photarium_instagram_auth` (interactive login/session validation through the existing Chromium profile flow)
- `photarium_instagram_ingest_profile` (feed/profile ingest through `scripts/instagram-ingest.mjs ingest`)
- `photarium_instagram_ingest_single_url` (single post/reel ingest; preserves the existing default namespace and fallback username)
- `photarium_instagram_replay_videos` (replay video uploads from Instagram NDJSON)
- `photarium_instagram_recover_videos` (resolve missing video URLs, then optionally replay uploads)

These tools wrap the current repository scripts and return captured command, stdout, stderr, and exit code. Instagram stories are not currently implemented in the repository scripts, so story ingest is outside this MCP surface for now.

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
- `photarium_generate_tags`
- `photarium_generate_prompt`
- `photarium_prepare_creative_brief_generation`
- `photarium_prompt_history`
- `photarium_record_creative_brief_result`
- `photarium_generate_from_creative_brief`
- `photarium_generate_image`
- `photarium_generate_from_references`
- `photarium_aspect_ratio_variant`
- `photarium_semantic_merge`
- `photarium_concepts`

### Image Generation

Creative-brief generation is provider-neutral. Photarium owns source-image context, prompt derivation, derivation history, and catalog provenance. It does not invoke Codex's built-in imagegen tool or another MCP server from the Photarium server.

- `photarium_prepare_creative_brief_generation` creates and persists a `CreativeBriefGenerationPlan` without generating an image.
- `photarium_generate_prompt` accepts `creativeBrief`, `sourceRelationship`, and optional `aspectRatio`; a non-empty brief creates a new derivation while leaving the canonical recreation prompt unchanged unless `saveAsCurrent: true` is supplied.
- `photarium_prompt_history` returns prior briefs, prompts, providers, ratios, reference roles, and generated children for a source image.
- `photarium_generate_from_creative_brief` executes directly only when `provider: "photarium_openai"` is selected. `codex_imagegen` and `comfyui` return a handoff plan for the agent/provider layer.
- `photarium_record_creative_brief_result` records an externally generated child, provider/job ID, actual dimensions, and actual aspect ratio after Codex or ComfyUI completes.

For a ComfyUI handoff, the agent must resolve a declared workflow capability/configured workflow ID that accepts the source image, positive prompt, optional negative prompt, and ratio or dimensions. It should use the ComfyUI MCP upload/run/watch/download flow, then upload the result to Photarium with `parentId` set to the source image and call `photarium_record_creative_brief_result`. The existing aspect-ratio adjustment workflow is a separate reframing operation and should not be selected as a general creative-transformation workflow by inference.

Supported source relationships are `brief_led`, `faithful_adaptation`, `related_design`, and `inspired_concept`. A non-empty brief is interpreted as a transformation request. The relationship controls how much of the source form is retained; it does not silently add a “make it distinct” instruction when the relationship is `brief_led`.

Aspect ratios normalize to forms such as `1:1`, `4:5`, `16:9`, and `9:16`. Providers receive the normalized target, and recorded results retain both the requested and actual ratio when available. Exact post-processing remains a separate operation.

The image generation tools call OpenAI image generation from the Photarium MCP server and upload generated outputs back into Photarium. They require `OPENAI_API_KEY` in the MCP server environment.

- `photarium_generate_image` creates a new image from a text prompt.
- `photarium_generate_from_references` creates a new image from a prompt plus Photarium image IDs or direct image URLs.
- `photarium_aspect_ratio_variant` edits a Photarium image ID or direct image URL into a new target aspect ratio while preserving the full source image, then uploads it as a variant when `imageId` is provided.
- `photarium_semantic_merge` semantically blends multiple source images into a new generated image. It is synthesis, not exact compositing.

The direct Image API default is `gpt-image-2`; set `PHOTARIUM_OPENAI_IMAGE_MODEL` to test or pin a different OpenAI image model.

The image-generation tools support `dryRun: true` for request-shape testing without OpenAI or upload side effects.

`photarium_aspect_ratio_variant` is for reframing without source-image loss. It asks the image model to preserve the full visible source and extend or recompose the surrounding canvas as needed. Use `photarium_crop_variant` when an intentional crop is wanted.

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

Example aspect-ratio variant:

```json
{
  "imageId": "d3eab243-1067-47d3-980d-06418b1f7400",
  "aspectRatio": "4:5",
  "outputFormat": "png",
  "dryRun": true
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
