# Image Detail Components And Hooks

## Responsibilities

- This folder owns image-detail presentation, local detail transforms, detail-specific hooks, and image tool panels.
- The app page owns routing and workflow composition; reusable detail logic should live here or in `src/server/**` when it crosses a server boundary.

## Public Entrypoints

- Keep `src/app/images/[id]/page.tsx` as the route entrypoint.
- Keep shared detail props and contracts in `types.ts`.
- Keep pure formatting and sorting helpers in `detailTransforms.ts`.

## Relevant Tests

- `__tests__/imageDetailTransforms.test.ts`
- `__tests__/imageRouteEmbeddingStatus.test.ts`
- `__tests__/imageDeleteRoute.test.ts`
- `__tests__/animationReorderRoute.test.ts`

## Do Not Add

- Do not place server mutation implementation, Cloudflare write logic, or credentialed service calls in client components.
- Do not add new image-family business rules directly to the route page when a hook or server helper can own them.
- Do not add one-off metadata formatting helpers to large components; put them in `detailTransforms.ts` or a focused module.
