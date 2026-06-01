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
