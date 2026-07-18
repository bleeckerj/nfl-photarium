# Folder Operations Policy

Folders are durable collections for projects, publications, references, campaigns, and archives. Images may remain unfiled. One-off generation and upload work should use an existing approved folder or remain unfiled; it should not create a date- or timestamp-named folder.

## Naming policy

New folder names are normalized to lowercase kebab case and limited to 64 characters. Reserved values such as `all`, `no-folder`, and `unfiled` are rejected. Date-only, UUID-like, filename-like, and prompt-like names should be avoided. Examples of suitable names include:

- `project-andsons`
- `reference-product-photography`
- `publication-newsletter`
- `archive-2026`

Existing names remain visible so they can be reviewed and cleaned up by an operator.

## Operator workflow

`GET /api/folders` returns the folder list plus `folderStats`. Each entry includes the assigned image count, last upload, status, and policy issues. Singleton, empty, and policy-invalid folders are candidates for review.

Folder deletion removes the folder assignment and folder registry entry. It preserves image assets. A delete request with `dryRun=true` returns the affected image count without mutating data. Image or family deletion is a separate destructive operation.

Before a cleanup batch, create a Photarium/Redis backup and save the proposed source, target, namespace, and affected image IDs. Merges and bulk moves should be implemented as resumable, idempotent jobs before being exposed for large batches.
