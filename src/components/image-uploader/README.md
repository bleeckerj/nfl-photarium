# Image Uploader Components And Hooks

## Responsibilities

- This folder owns uploader controls, upload activity state, queue helpers, file normalization, and upload orchestration hooks.
- UI controls should stay presentational; request building and queue mutation should live in focused hooks or helper modules.

## Public Entrypoints

- Keep `src/components/ImageUploader.tsx` as the public default component import.
- Keep queue and upload data contracts in `types.ts`.
- Keep file/archive helpers in `fileHelpers.ts`.

## Relevant Tests

- `__tests__/imageUploaderHelpers.test.ts`
- `__tests__/uploadExternalRoute.test.ts`
- `__tests__/uploadRoute.test.ts`
- `__tests__/variationUploadService.test.ts`

## Do Not Add

- Do not call protected upstream services directly from browser code.
- Do not add new archive or media parsing behavior to the entrypoint component.
- Do not duplicate upload request normalization that belongs in server routes or upload services.
