# Namespace Behavior (Cloudflare Images)

This document summarizes the namespace feature, its goals, where it is stored, and how it is applied in the app. It is meant to be shared with another LLM.

## Goals

- Provide logical separation between multiple apps or workflows that share a single Cloudflare Images account.
- Prevent accidental collisions in duplicate detection across unrelated image libraries.
- Allow switching between namespaces in the UI without reconfiguring the backend.
- Allow external automation to upload into a specific namespace (even if the UI is currently viewing another).

## Core Concepts

- **namespace** is a metadata field stored on each Cloudflare image.
- **IMAGE_NAMESPACE** (server) is the default namespace for uploads and filtering.
- **NEXT_PUBLIC_IMAGE_NAMESPACE** (client) is the default namespace the UI loads on startup.
- **UI namespace** can be changed via the gear icon in the gallery header and is persisted in `localStorage`.

## Where the Namespace Is Stored

- Stored in Cloudflare image metadata as `namespace`.
- Included in the cached image model returned by `/api/images`.
- Used to scope duplicate detection and filtering.

## Upload Behavior

- **Internal UI uploads**: `namespace` is appended to the upload `FormData` when present.
- **External uploads** (`/api/upload/external`): accepts `namespace` in multipart `FormData`.
- **Defaulting**:
  - Server uses `IMAGE_NAMESPACE` (or `NEXT_PUBLIC_IMAGE_NAMESPACE`) if no namespace is provided by the client.
  - UI uses `NEXT_PUBLIC_IMAGE_NAMESPACE` as a starting value but can be changed.

## Filtering Behavior

- `/api/images` accepts a `namespace` query parameter.
  - When `namespace` is set, only images in that namespace are returned.
  - When `namespace=__none__`, only images with no namespace are returned.
- The UI passes the current namespace to `/api/images` and filters the gallery accordingly.
- Duplicate detection is scoped to the active namespace:
  - URL duplicate checks use only images with the same namespace.
  - Content hash duplicate checks use only images with the same namespace.

## UI Controls

- A gear icon in the gallery header opens the namespace modal.
  - **Dropdown** options include:
    - `(no namespace)` (maps to `__none__`)
    - Observed namespaces in the current image set
    - `Custom…` input for manual entry
  - The selection is persisted to `localStorage` as:
    - `imageNamespace = "namespace-value"`
    - `imageNamespace = "__none__"` for empty namespace

## “No Namespace” Mode

- Selecting `(no namespace)` filters the gallery to images where `namespace` is missing.
- This is useful during migration when legacy images have no namespace.
- The mode persists across restarts via `localStorage`.

## Migration of Existing Images

- Existing images without a namespace can be backfilled using:
  - `npm run namespace:backfill`
  - Supports `--dry-run`, `--namespace=...`, `--limit=...`, `--page-size=...`
- The script reads `.env.local` for Cloudflare credentials and default namespace.

## API and Docs

- `namespace` is documented in:
  - `README.md`
  - `EXTERNAL_UPLOAD_API.md`
  - `docs/api/README.md`

## Summary

- Namespace is a lightweight, metadata-driven separation layer.
- It is not security; it is a filtering and dedupe scope.
- The UI lets you switch namespaces without restarting the app.
- External tools can upload into specific namespaces regardless of the UI’s active namespace.
