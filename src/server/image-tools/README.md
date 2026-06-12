# Image Tools Server Helpers

## Responsibilities

- This folder owns image-tool manifests, registries, execution, run storage, preview storage, and provider adapters.
- UI components and API routes should call these helpers instead of duplicating tool execution logic.

## Public Entrypoints

- Keep tool API routes under `src/app/api/image-tools/**`.
- Keep provider-neutral contracts in `types.ts`.
- Keep tool registration in `registry.ts` and provider-specific behavior in adapter modules.

## Relevant Tests

- `__tests__/imageToolsRegistry.test.ts`
- `__tests__/imageToolsRoutes.test.ts`
- `__tests__/grainradEngine.test.ts`
- `__tests__/grainradAdapter.test.ts`
- `__tests__/sourceImageValidation.test.ts`

## Do Not Add

- Do not expose provider credentials or internal endpoints to client components.
- Do not put provider-specific execution branches in API routes.
- Do not store long-running run state in UI-only modules.
