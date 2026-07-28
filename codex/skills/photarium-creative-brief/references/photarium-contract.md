# Photarium Creative-Derivation Contract

## Required MCP sequence

Source-based Codex imagegen:

1. `photarium_upload_from_path` or `photarium_upload_url` when no source ID exists.
2. `photarium_generate_description` and `photarium_generate_alt` for a newly registered source.
3. `photarium_prepare_creative_brief_generation`.
4. `photarium_download_image`, then `view_image`.
5. Built-in `image_gen` with the prepared prompt and local reference.
6. Inspect the generated output.
7. `photarium_upload_from_path` with `parentId` set to the source image.
8. `photarium_record_creative_brief_result`.
9. `photarium_image_metadata` and `photarium_prompt_history` for final verification.

`photarium_generate_from_creative_brief` executes only for `provider: photarium_openai`. For `codex_imagegen` and `comfyui`, it returns a handoff plan and does not generate or upload the image.

## Completion invariant

The workflow is complete only when all of these are true:

- The child has a Photarium ID and hosted delivery URL.
- The child exists and is linked to the source or its family root.
- The final prompt is stored on the child and the derivation history.
- The provider is recorded.
- Actual dimensions and aspect ratio are recorded.
- Description and alt text are saved.
- Final metadata readback succeeds.

## Defaults

- Provider: `codex_imagegen`.
- Namespace: source namespace, otherwise Photarium's configured `IMAGE_NAMESPACE`.
- Folder: source folder, otherwise `creative-brief-derivations`.
- Relationship: `brief_led` unless the user specifies another relationship.
- No automatic provider fallback.
