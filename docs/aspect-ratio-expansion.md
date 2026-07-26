# Generative aspect-ratio expansion

Photarium’s image detail page supports deterministic crops and generative expansion. Expand preserves the full source image and generates only the added canvas area, then shows a preview before saving the result as a child variant.

## Providers

The Expand modal supports Automatic, OpenAI image edit, and ComfyUI workflow providers.

Automatic uses `PHOTARIUM_ASPECT_RATIO_PROVIDER` when set. With the default `auto` value, Photarium prefers OpenAI when `OPENAI_API_KEY` is configured and otherwise uses ComfyUI when its workflow is configured. Provider failures are reported directly; Photarium does not silently retry another provider.

OpenAI uses `OPENAI_API_KEY` and `PHOTARIUM_OPENAI_IMAGE_MODEL` (default `gpt-image-2`).

ComfyUI requires:

- `COMFY_BASE_URL`
- `COMFY_ASPECT_RATIO_WORKFLOW_PATH` or the existing `COMFY_WORKFLOW_PATH`

The default workflow expects the node IDs documented in `.env.example`. Override them with the `COMFY_ASPECT_RATIO_*_NODE` variables when the workflow differs. The workflow must accept an input image, an aspect-ratio value, and an output image node. Photarium also passes optional positive/negative prompts and seed values when those fields exist.

## Detail-page flow

1. Open an image detail page and choose `Crop / expand`.
2. Select `Expand`, a target ratio, placement, and provider.
3. Add optional expansion instructions, negative prompt, or ComfyUI seed.
4. Generate the preview.
5. Review the generated image and accept it as a child variant.

Accepted variants inherit the source namespace, folder, and tags. Photarium records the requested provider, resolved provider, aspect ratio, placement, model or workflow path, job ID, seed, output dimensions, and MIME type in the image-tool provenance record.
