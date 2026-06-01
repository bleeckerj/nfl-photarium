# Maintainability Baseline

Baseline commit: `b977c88 chore: baseline current refactor state`

## Size Audit

- Command: `npm run size:audit`
- Result: passed with warnings and temporary allowlist entries.
- Original allowlist count before category thresholds: 13.
- Structured category audit count after threshold split: 17.

## Baseline Lint

- Command: `npm run lint`
- Result: failed before this maintainability pass.
- Primary errors: explicit `any` in existing tests/utilities and unescaped entity errors in existing React markup.
- Existing warnings include hook dependency warnings, unused symbols, and `next/no-img-element` warnings.

## Baseline Tests

- Command: `npm test`
- Result: failed before this maintainability pass.
- Failing file: `__tests__/clientSiteManifestBuilder.test.ts`.
- Failure summary: image manifest fixture lacks `variants`; video manifest mock lacks `resolveVideoDownloadUrls`.

## Refactor Boundary

Treat this baseline as the boundary between existing work and new maintainability refactor changes. New changes should be verified with targeted tests first and should not hide baseline failures.
