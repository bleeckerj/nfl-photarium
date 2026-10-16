# Instagram ingestion

Use the Photarium MCP single-URL tool for an explicitly supplied Instagram post or reel URL. It runs this CLI with the existing persistent Chromium session, uploads to the fixed `cf-instagram` namespace, and appends the result to `data/instagram/<owner>.ndjson`.

The Photarium web server must be running at the tool's configured `apiBase`. Start the existing development server with `npm run dev:server` when needed. Authentication setup is a separate, explicitly requested operation.

For slideshows, the importer finds the requested post inside embedded JSON and existing page API responses. It selects the largest image candidate for each carousel child and retains slide order. An `img_index` URL selects that child. The media-info fallback decodes the shortcode into an exact numeric ID.

The command fails if extraction is incomplete or an attempted upload fails. Upload failures are retained in the appended NDJSON record. A completed upload requires a returned asset ID for every expected asset; the caller should read those IDs back through Photarium before reporting completion.

Module ownership:

- `single-url-workflow.mjs`: single-post orchestration and result persistence.
- `single-url-record.mjs`: record recovery and completion checks.
- `single-url-extract.mjs`: DOM extraction and compatible API re-exports.
- `page-media.mjs`: exact-post lookup in structured page data and responses.
- `media-api.mjs`: authenticated API requests and shortcode conversion.
- `records.mjs`: media selection and source-record mapping shared with profile ingestion.
