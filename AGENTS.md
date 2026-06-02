# Repository Operating Instructions

## Reasonable Commenting

Code comments should explain intent, constraints, tradeoffs, and non-obvious behavior that a future maintainer would otherwise have to rediscover.

Prefer comments for:
- Boundary decisions, invariants, and assumptions that are not obvious from types or names.
- External service quirks, API limitations, migration constraints, and compatibility workarounds.
- Complex algorithms, concurrency behavior, cache invalidation, retry behavior, or data-repair reasoning.
- Security-sensitive decisions, especially around credentials, server/client boundaries, and access controls.

Avoid comments that merely restate the code, narrate simple assignments, or preserve outdated context. When behavior changes, update or remove nearby comments in the same change.

Public modules, scripts, and operational workflows should have README or inline usage documentation when their setup, side effects, or failure modes are not self-evident.

## Maintainable Architecture Contract

Every code change must preserve clear ownership boundaries. UI composition, UI state, domain workflows, request parsing, service calls, persistence, serialization, and operational CLI behavior belong in separate modules when the repository already has a place for them.

When touching large or mixed-responsibility files, Codex must actively reduce the maintenance burden:
- Do not add new responsibilities to a file that is already near or above its size-audit warning threshold.
- Extract reusable logic into focused hooks, services, mappers, validators, or script library modules before adding more branches to a monolith.
- Keep top-level React pages and components as composition shells where practical. Data fetching, mutations, filtering, pagination, upload orchestration, and workflow decisions should live in named hooks or server/service modules.
- Keep Next.js route files thin. Routes should parse input, call a server helper/service, and return a response. Validation, normalization, private-host checks, Cloudflare/Redis calls, and response mapping should live under `src/server/**` or a feature server module.
- Keep operational scripts split into CLI entrypoints plus reusable config, provider/client, pipeline, and reporter modules once a script grows beyond a narrow one-off command.
- Prefer improving the existing local pattern over introducing a second architecture style for the same concern.

New abstractions must have a real maintenance purpose: reducing meaningful duplication, clarifying ownership, isolating side effects, or making behavior testable. Avoid broad rewrites that do not directly support the task.

## TypeScript And Contract Discipline

TypeScript errors are implementation defects, not cleanup items for later.

Codex must:
- Use explicit domain types, typed request/response contracts, and typed props for cross-module boundaries.
- Avoid `any`. If an external or dynamic value is genuinely unknown, use `unknown`, narrow it locally, and keep the unsafe boundary small.
- Keep public exports, route response shapes, component props, and package scripts backward compatible unless the user explicitly requests a breaking change.
- Update all call sites when changing a type contract. A refactor is incomplete until the production build validates every import/export and prop contract.
- Avoid type assertions that bypass the real contract. Assertions are acceptable only at narrow external boundaries, test mocks, or serialization edges where runtime validation or local narrowing backs them up.
- Preserve server/client boundaries. Server-only types, secrets, filesystem access, network credentials, and privileged service calls must not move into client components.

When tests need mocks, mock the current public contract completely. A stale mock that omits a newly used export is a test defect and must be fixed with the code change.

## Cleanliness And Warning Policy

Lint warnings are maintenance debt. New work must not add ESLint warnings, TypeScript warnings, unused disable comments, unused variables, hook dependency warnings, or JSX escaping violations.

Before calling work complete:
- `npm run lint` must finish with zero errors and zero warnings.
- New `eslint-disable` comments require a local explanation and must be removed when the rule no longer fires.
- Unused variables should be removed. For deliberate secret-stripping destructures, make the discard explicit with `void` so the intent is visible.
- React hook dependency warnings must be fixed by stabilizing values, moving logic, or declaring dependencies honestly.
- JSX text must escape quotes and apostrophes when the configured lint rules require it.

Size-audit warnings are allowed only as tracked maintainability signals. Size-audit failures and expired allowlist entries must be fixed or renewed with an owner-style reason and expiry.

## Refactor Safety Checklist

For any refactor that moves code, splits files, or changes shared contracts, Codex must check these before finishing:
- Existing public entrypoints still exist, or moved helpers are re-exported from the previous module.
- Routes keep the same URLs, methods, status semantics, and response shapes unless a tested bug fix intentionally changes behavior.
- Feature state remains owned by the narrowest responsible hook/module.
- Tests cover moved pure helpers, request parsers, response mappers, and script library modules when behavior is non-trivial.
- `npm run build` passes after import moves, prop changes, hook reordering, route changes, or client/server boundary changes.

## Human-Readable CLI Output

Scripts that review, repair, move, assign, delete, or otherwise mutate assets must print semantically legible stdout.

Required per-item output for repair/mutation scripts:
- Use color-coded statuses when stdout supports ANSI colors, with `NO_COLOR=1` support.
- Show the action as a meaningful phrase, not only an internal enum.
- Show the asset ID and filename.
- Show the current namespace and target namespace as `from -> to`.
- Show the reason the action is being taken.
- Show family/root context when the action is based on variants or parentage.
- Show evidence used to infer the target, such as namespace-bearing family members.
- Show whether the action is a dry-run, verified update, already-target, skip, or failure.

Color conventions:
- Green: verified successful update or target namespace.
- Blue/cyan: dry-run or already-target informational state.
- Yellow: fallback assignments, missing/current namespace, or skipped item.
- Red: failed verification or errors.
- Gray: low-priority detail such as absent evidence.

Avoid terse logs such as `Assigned <date> <id> <filename>` for data repair tasks. That output hides the decision being made and is not acceptable for cleanup work.

## Build And Compatibility Gate

Leaving the repository in a non-building state is a release-blocking failure.

For any code change, Codex must run the strongest practical verification before calling the work done or committing it:
- Run `npm run hygiene:targeted` for the touched files whenever the change maps to targeted checks.
- Run `npm run build` before every commit that touches TypeScript, React, Next.js app/routes, server code, shared types, package scripts, or refactors that move imports across module boundaries.
- Run `npm run hygiene` before broad refactors, release-facing changes, or any change that could affect multiple app surfaces. In this repository `npm run hygiene` is the full local gate and must include size audit, lint, tests, and production build.
- If a focused change truly cannot run the production build, Codex must state the blocker explicitly, keep the change uncommitted unless the user authorizes otherwise, and provide the exact command that still needs to pass.

Targeted lint and unit tests are not sufficient evidence that the app builds. Next.js production build catches TypeScript, static prerender, client/server boundary, import/export, Suspense, and route compatibility failures that `vitest` and ESLint can miss. After refactors, missing imports, widened/narrowed prop contracts, route helper collisions, and hook ordering issues must be found by `npm run build`, not by the next human.

Compatibility expectations:
- Preserve existing public entrypoints, route URLs, response shapes, package scripts, and component exports unless the task explicitly changes them.
- When moving code between modules, run a production build to validate import/export compatibility across client, server, and route bundles.
- When touching Next.js pages or components that use `useSearchParams`, routing hooks, browser APIs, or client components, verify the production build so prerender and Suspense requirements are checked.
- When changing upload, import, namespace, image detail, image tools, gallery, or uploader flows, run the targeted tests selected by `npm run hygiene:targeted`; add or update tests when the changed behavior is not already covered.
- Treat pre-existing warnings as warnings only after confirming there are no new errors. Do not bury new failures under known warnings.
