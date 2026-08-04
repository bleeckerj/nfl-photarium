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

## Folder inheritance invariant

Every source-based derivative inherits the parent image's folder exactly. A null or absent parent folder remains null or absent on the child. Never invent, select, or create a fallback folder, including `creative-brief-derivations`. If the upload flow cannot preserve the parent folder, stop and ask the operator rather than creating or using a different folder.

## Defaults

- Provider: `codex_imagegen`.
- Namespace: source namespace, otherwise Photarium's configured `IMAGE_NAMESPACE`.
- Folder: exact source folder; if the source is unfiled, leave the derivative unfiled.
- Relationship: `brief_led` unless the user specifies another relationship.
- No automatic provider fallback.
