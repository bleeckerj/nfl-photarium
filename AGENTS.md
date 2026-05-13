# Repository Operating Instructions

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
