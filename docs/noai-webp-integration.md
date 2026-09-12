# No-AI Demarker WebP integration

Implemented in Photarium on 2026-09-11, using the local noai-watermark checkout at tested commit `e30635f`.

The image-detail No-AI Demarker and `photarium_demark_images` now accept PNG, JPEG, and WebP originals. The existing `PHOTARIUM_NOAI_WATERMARK_ROOT` and `PHOTARIUM_NOAI_WATERMARK_PYTHON` configuration selects the library and Python runtime. Rebuild the MCP with `npm run build --prefix mcp-server`; existing MCP connections must reconnect to load the updated JavaScript. The Photarium image-tool route is already active locally. No remote application deployment or git push was performed.

Use **Metadata only** in the image-detail tool, or call:

```json
{"imageIds":["e7fafb81-3126-4efb-00bc-e041da8e7d00"],"mode":"metadata"}
```

Static WebP supports both processing modes and retains WebP output. Regeneration uses the library's lossless WebP default. Animated WebP supports metadata cleanup; regeneration rejects it before model initialization. The source format is determined from its bytes. Original downloads must succeed without delivery-variant fallback. Each requested run creates a new child under the canonical family parent, including when another child has identical bytes.

File verification reports format, dimensions, AI metadata, C2PA, inspection completeness, and whether pixels were regenerated. Pixel-watermark detection is unavailable and its result stays null. JPEG inspection limitations remain explicit. The hosted original must match the locally verified output by SHA-256 before success is reported. Source description, alt text, folder, URLs, tags, namespace, and lineage are retained. Photarium's existing automatic enrichment queue still applies to uploads. Processing provenance is recorded in Extras Storage; it does not replace the source description.

## Live verification

Source: `e7fafb81-3126-4efb-00bc-e041da8e7d00`, a 1168 x 1456 WebP in `cf-nokia`, under family parent `787cd049-da4e-4a43-6fa6-770c55713c00`.

- Image-tool run: `06b56d57-961e-4754-846b-4c6d6a7c1b03`; child `47cd2bc2-797e-4026-b1a4-1f21d460bc00`.
- Fresh stdio MCP run: child `d6c74c7c-61f0-4fb4-385a-d247c4da9f00`.
- [Image-tool child](https://imagedelivery.net/gaLGizR3kCgx5yRLtiRIOw/47cd2bc2-797e-4026-b1a4-1f21d460bc00/public).
- [Direct MCP child](https://imagedelivery.net/gaLGizR3kCgx5yRLtiRIOw/d6c74c7c-61f0-4fb4-385a-d247c4da9f00/public).

Both hosted originals match the verified 1,612,782-byte WebP with SHA-256 `58e70a7c17df683fadfa2d01cf602b5ea343e5cda2f36402d6035b2fd7ce20ff`. A separate original download and decoded RGBA comparison confirmed identical pixels to the source. AI metadata and C2PA are absent, dimensions match, and inspection is complete. Catalog and Extras readback confirmed the source description, alt text, tags, namespace, family relationship, and processing record.

These live runs used metadata cleanup. Real model inference was not exercised. The connected MCP process in the originating Codex task predates the rebuild; a fresh stdio connection passed the complete workflow.

## Checks

- `npm run hygiene:targeted`: 75 tests passed across nine files.
- `npm run lint`: zero errors or warnings.
- `npm run build`: production build passed, including TypeScript and prerendering.
- `npm run build --prefix mcp-server`: passed.
- Python worker integration: four tests passed, covering alpha/pixel preservation, animation preservation, animation rejection before model creation, and PNG/JPEG compatibility.
- `npm run hygiene`: size and lint passed; full suite recorded 1,089 passed, two skipped, and one existing failure before the final three added tests. The failing `photariumMcpAspectRatioVariant.test.ts` case was reproduced independently from unchanged HEAD `9f7c27a`; its mocked reference materialization returns HTTP 404. A separate production build passed.

The existing Next.js middleware deprecation and size-audit maintenance warnings remain. Temporary logs and hosted-byte comparison records are in `/private/tmp/photarium-webp-*` and are not committed.

## Uncommitted files outside this change

The following files remain outside the source commit. Build outputs are deliberately unstaged; the other work was present before this task.

MCP compiled artifacts (existing output plus the WebP rebuild):

```text
mcp-server/dist/contracts/index.js
mcp-server/dist/runtime/ai/handlers.js
mcp-server/dist/runtime/ai/image-generation.d.ts
mcp-server/dist/runtime/ai/image-generation.js
mcp-server/dist/runtime/index.js
mcp-server/dist/runtime/instagram/commands.d.ts
mcp-server/dist/runtime/instagram/commands.js
mcp-server/dist/runtime/instagram/tools.js
mcp-server/dist/runtime/upload/client.d.ts
mcp-server/dist/runtime/upload/client.js
mcp-server/dist/runtime/upload/handlers.js
mcp-server/dist/runtime/upload/ingest-commands.js
mcp-server/dist/runtime/upload/tools.js
mcp-server/dist/contracts/demark.d.ts
mcp-server/dist/contracts/demark.js
mcp-server/dist/runtime/demark/handlers.d.ts
mcp-server/dist/runtime/demark/handlers.js
mcp-server/dist/runtime/demark/hosted-verification.d.ts
mcp-server/dist/runtime/demark/hosted-verification.js
mcp-server/dist/runtime/demark/naming.d.ts
mcp-server/dist/runtime/demark/naming.js
mcp-server/dist/runtime/demark/service.d.ts
mcp-server/dist/runtime/demark/service.js
mcp-server/dist/runtime/demark/tools.d.ts
mcp-server/dist/runtime/demark/tools.js
mcp-server/dist/runtime/demark/types.d.ts
mcp-server/dist/runtime/demark/types.js
mcp-server/dist/runtime/demark/worker-runner.d.ts
mcp-server/dist/runtime/demark/worker-runner.js
```

OMATA source ingest:

```text
scripts/omata-source-image-ingest.mjs
```

Existing media production outputs:

```text
output/playwright/Dclwqa9ijj5-10.png
output/speech/john-deere-11s-dialogue.txt
output/speech/john-deere-11s-instructions.txt
output/speech/john-deere-11s-voiceover.wav
output/speech/john-deere-360-voiceover-instructions.txt
output/speech/john-deere-360-voiceover.txt
output/speech/john-deere-360-voiceover.wav
output/speech/john-deere-6502-yardwalker-dialogue.txt
output/speech/john-deere-6502-yardwalker-instructions.txt
output/speech/john-deere-6502-yardwalker-voiceover.wav
output/transcribe/john-deere-11s/audio.m4a
output/transcribe/john-deere-11s/transcript.txt
output/transcribe/john-deere-360/audio.m4a
output/transcribe/john-deere-360/clean-audio.m4a
output/transcribe/john-deere-360/clean-transcript.txt
output/transcribe/john-deere-360/full-orbit-clean-audio.m4a
output/transcribe/john-deere-360/full-orbit-clean-transcript.txt
output/transcribe/john-deere-360/transcript.txt
output/transcribe/john-deere-6502-yardwalker/audio.m4a
output/transcribe/john-deere-6502-yardwalker/transcript.txt
```

Existing SynthID assessment:

```text
synthid-robustness-assessment-skeleton.md
```
