# Gallery Components And Hooks

## Responsibilities

- `ImageGallery.tsx` at `src/components/ImageGallery.tsx` is the public gallery entrypoint.
- Files in this folder own gallery controls, result rendering, modals, bulk state, stored preferences, and gallery-specific view models.
- Hooks in `hooks/` should own gallery state orchestration that is reusable across the gallery shell and related controls.

## Bulk Selection IDs

`GalleryBulkEditModal.tsx` exposes the current selection as both a comma-separated CSV string and a formatted JSON array. The copy actions delegate clipboard work and toast feedback to `useGalleryBulkUiState`, keeping the modal responsible for format selection and loading state.

Keep both representations derived from `selectedImages` so the preview and copied payload cannot drift apart. Empty selections disable both copy actions.

## Public Entrypoints

- Keep `src/components/ImageGallery.tsx` as the default import target for app code.
- Keep shared gallery types in `types.ts` and pure helpers in `utils.ts` or narrowly named helper modules.

## Relevant Tests

- `__tests__/galleryQuery.test.ts`
- `__tests__/imageGalleryMotionAssets.test.ts`
- `__tests__/galleryFilter.test.ts`
- `__tests__/galleryFolderOptions.test.ts`

## Do Not Add

- Do not add route fetching, Cloudflare API calls, or cache persistence directly to presentational components.
- Do not duplicate gallery query behavior already owned by `src/server/galleryQuery.ts` or `src/server/galleryQueryRoute.ts`.
- Do not expand the public gallery entrypoint with new bulk workflow logic when a focused hook or helper can own it.
