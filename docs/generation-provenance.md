# Generation Provenance Policy

Every generated or edited raster output must be uploaded with a provenance receipt and verified before the workflow is complete. This applies to previews, variants, pinned OpenAI calls, native Photarium generation, built-in image generation, and external providers. Ordinary reference uploads remain compatible without a receipt.

## Upload and verification

Use Photarium MCP uploads with `generated: true` and either `provenanceReceiptPath` or `provenanceReceipt` (JSON text). Declared generated uploads without a receipt fail before image storage. Receipt validation also precedes image storage. The response includes `provenanceSave` with the image ID, receipt ID, and retention status. If an image upload succeeds but receipt storage fails, preserve the image ID and retry receipt attachment; do not generate or upload a duplicate.

Use `photarium_provenance_attach` to backfill an existing image, `photarium_provenance_list` to read its history, and `photarium_provenance_get` to retrieve exact receipt JSON. Attachment verifies the output SHA-256, byte count, and dimensions against privileged original bytes. It never uses a resized delivery variant. Provide direct `sourceImageIds` when the original receipt has no Photarium identifiers; these are declared source relationships, distinct from the canonical family parent.

Completion requires a successful receipt readback as well as the image ID, hosted URL, saved prompt, description, alt text, dimensions/aspect ratio, namespace, and parentage checks required by the creative-derivation policy. Native generation creates its receipt automatically and reports `upload.complete: false` if retention fails.

## Receipt schema

Preserve the original schema-version-1 JSON text exactly when a provider helper produces it. Required fields are `schema_version: 1`, `model`, `created_at`, `request`, and one to ten `outputs`. Each output requires a lowercase SHA-256, positive byte count, and `[width, height]`. Record provider, endpoint, requested parameters, returned parameters, usage, request ID, generation IDs, source hashes, and mask evidence when available. Native edits hash the actual reference bytes submitted to the provider.

For an opaque provider, create a receipt using the observed final prompt, provider, timestamp, and output file evidence. Set `model: "unavailable"` and omit unavailable request IDs or settings. A requested alias is not evidence of a dated model snapshot. Preserve that distinction. Receipt validation limits JSON to 1 MB and rejects credential fields, credential-like strings, embedded base64, and access-bearing URLs.

## Durable storage and history

Receipts use the existing Extras Storage backend, outside Cloudflare's limited metadata:

- `generation-receipt:<receiptSha256>` stores immutable exact JSON.
- `generation-binding:<imageId>:<receiptSha256>` stores an immutable verified association.
- `generation-summary:<imageId>` provides a compact availability record for batched gallery reads.
- `generation-provenance-meta:revision` invalidates gallery ETags after attachment.
- `generation-tombstone:<imageId>` records image deletion while retaining receipts and associations.

Redis uses atomic `SET NX` and no TTL. File storage publishes complete temporary files atomically without overwriting existing receipts. Retries return the original association; concurrent distinct receipts remain in history. Lists group receipts whose JSON content differs only in whitespace or object key order, provided the output index, persisted hash, and declared source IDs also match. Verification against original bytes is preferred when selecting a representative. Every exact JSON record and its byte-hash ID remain retrievable. Upload associations retain both generated-source and persisted hashes when upload normalization changes bytes. A matching upload-source hash verifies provider output; it does not claim persisted bytes are identical.

Include every `photarium:extras:generation-*` key in Redis persistence and backup procedures. File deployments must retain and back up the configured `EXTRAS_STORAGE_DIR`. Cache purges do not remove provenance. Deletion records remain for audit; any separate receipt-purge operation requires explicit authorization. Restore verification must compare downloaded receipt bytes to the receipt ID and reopen the associated image history.

## Availability and access

Gallery cards and list rows show a FileClock icon titled “Generation provenance receipt available” when a verified association exists. Image detail shows receipt history, model, settings, hashes, declared sources, an expandable JSON viewer, and a JSON download. The viewer fetches the receipt when opened and displays formatted JSON within the page. Gallery responses contain only availability; full receipts and private filesystem paths are retrieved on demand.

`GET /api/images/:id/provenance` lists associations. Adding `?receiptId=<sha256>` downloads exact JSON; appending `&view=inline` returns the same bytes with inline disposition for the viewer. `POST` accepts `{ "receipt": "<JSON text>", "sourceImageIds": ["<id>"] }`. These endpoints use private, non-cacheable responses. Default access is limited to same-origin loopback operator requests; remote access requires the server-only `PHOTARIUM_PROVENANCE_TOKEN` bearer credential. The MCP client reads this credential from its existing environment. Do not put it in browser configuration or public variables. A remote browser without operator authentication can see availability but cannot retrieve internal receipts.

Provenance belongs in Photarium's operator interface and internal records. Keep public titles, descriptions, captions, alt text, and delivery metadata consistent with the visible artifact.
