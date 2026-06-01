# Page Import Server Helpers

## Responsibilities

- This folder owns server-side page import request parsing, scroll capture, media candidate normalization, and archive diagnostics.
- Route files should parse requests, call these helpers, and translate results to `NextResponse`.

## Public Entrypoints

- Keep existing API routes under `src/app/api/import/page/**`.
- Export focused helpers from narrowly named files such as `scrollRequest.ts`, `scrollMediaCandidates.ts`, and `scrollArchiveDiagnostics.ts`.

## Relevant Tests

- `__tests__/importPageRoute.test.ts`
- `__tests__/importPageUploadRoute.test.ts`
- `__tests__/importPageScrollStreamRoute.test.ts`
- `__tests__/pageImportEnrichmentPriority.test.ts`

## Do Not Add

- Do not put browser automation details directly in route handlers.
- Do not duplicate private-host or allow-insecure checks across routes.
- Do not emit terse mutation logs from import repair workflows; keep operator output readable.
