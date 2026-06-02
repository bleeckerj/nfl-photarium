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
