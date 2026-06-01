# Video Detail Components And Hooks

## Responsibilities

- This folder owns video-detail presentation, frame extraction panels, animated WebP controls, and video-specific transforms.
- Shared image/video family behavior should move to common asset-family helpers instead of being copied between detail pages.

## Public Entrypoints

- Keep `src/app/videos/[id]/page.tsx` as the route entrypoint.
- Keep pure video detail helpers in `videoTransforms.ts`.

## Relevant Tests

- `__tests__/videoDetailTransforms.test.ts`
- `__tests__/videoAnimatedWebpRoute.test.ts`
- `__tests__/videoFramesRoute.test.ts`
- `__tests__/videoUploadService.test.ts`

## Do Not Add

- Do not add Cloudflare Stream or Mux client logic to components.
- Do not duplicate image-detail family/adoption logic when a shared helper can express the behavior.
- Do not put new frame parsing or video-download inference in the page component.
