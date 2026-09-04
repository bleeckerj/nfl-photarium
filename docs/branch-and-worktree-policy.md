# Branch And Worktree Policy

`main` is the repository integration branch. A completed change must be reachable from `main`; a commit that exists only in a detached worktree or task branch is incomplete.

## Required workflow

1. Make the change in the active `main` checkout or in a clearly named task worktree.
2. Run the narrowest relevant tests first. Run `npm run lint` and `npm run build` for TypeScript, React, route, server, script, or import-boundary changes; use `npm run hygiene` for broad or release-facing work.
3. Commit only the task files after the relevant checks pass. Record unrelated dirty files and leave them untouched.
4. Merge the tested commit into `main` in the same work session. Verify it with `git merge-base --is-ancestor <commit> main` and verify the resulting `main` checkout.
5. Remove the temporary worktree and task branch after the merge. Keep a branch only when it is explicitly designated as an active long-lived workstream with an owner and purpose.

## Safety rules

- Never discard, reset, or overwrite unrelated uncommitted files to make a branch switch or merge possible. Stop and resolve the ownership boundary first.
- Never report implementation complete while the tested commit remains outside `main`.
- Do not merge a branch with failing relevant checks. Preserve it, document the exact failure, and keep it out of the completion path until repaired and retested.
- Do not push or delete remote branches without explicit authorization.

## Completion check

Before handing work back, confirm:

```bash
git status --short
git log -1 --oneline main
git merge-base --is-ancestor <tested-commit> main
git worktree list
```

The final report must identify the merge commit, verification results, and any remaining dirty files or intentionally retained branches/worktrees.
