# Phase 1 Test Plan: Comfy Workflow Intelligence

## Scope
Phase 1 adds backend capabilities for:
- detecting and extracting Comfy workflow metadata from uploaded images
- generating prompt candidates heuristically from workflow nodes
- composing deterministic workflow intent text from prompts, descriptions, and node signatures
- persisting workflow intelligence in extras storage (not Cloudflare metadata)
- generating/storing workflow intent embeddings for ANN retrieval
- querying Comfy workflows with reasoned re-ranking signals

## Quality Gates
Every incremental addition must satisfy all relevant gates before moving to the next increment:
1. New/updated unit tests pass.
2. Existing impacted integration tests pass.
3. No lint violations introduced.
4. No TypeScript type regressions.

## Incremental Validation Strategy

### Increment 1: Workflow analysis primitives
Files expected:
- `src/server/comfy/workflowAnalysis.ts`
- `__tests__/workflowAnalysis.test.ts`

Test cases:
1. Detect API graph node-map workflows (`{ "1": { class_type, inputs } }`).
2. Detect UI graph workflows (`{ nodes: [...] }`).
3. Extract prompt candidates from common prompt-like keys (`text`, `prompt`, `positive`, `negative`).
4. Ignore non-string and empty prompt values.
5. Deduplicate normalized prompt candidates preserving first occurrence.
6. Extract node class signatures deterministically (stable ordering).
7. Compose deterministic `workflow_intent_text` from:
   - prompt candidates
   - image description parts (alt/description/caption)
   - key node signatures/settings summary
8. Ensure output is bounded (max length clamp) and stable across repeated runs.

Command gate:
- `npm test -- __tests__/workflowAnalysis.test.ts`

### Increment 2: Extras schema + persistence
Files expected:
- `src/server/imageExtras.ts` (schema extension)
- `src/server/comfy/workflowExtras.ts`
- `__tests__/workflowExtras.test.ts`

Test cases:
1. Persist `workflow_json` and retrieval by image id.
2. Persist `prompt_candidates[]` and deterministic ordering.
3. Persist `image_description` parts and merged `workflow_intent_text`.
4. Include versioned metadata fields (`intentTextVersion`, `embeddingModel`, `embeddingVersion`).
5. No writes for non-Comfy images when payload is empty.
6. Patch behavior preserves existing extras fields (`promptThis`, timestamps).

Command gate:
- `npm test -- __tests__/workflowExtras.test.ts`

### Increment 3: Embedding + Redis ANN index service
Files expected:
- `src/server/comfy/workflowIntentSearch.ts`
- `__tests__/workflowIntentSearch.test.ts`

Test cases:
1. Creates index if absent; no-op if present.
2. Stores embedding vectors with expected dimensions and metadata fields.
3. Rejects invalid embedding dimensions.
4. ANN search returns sorted candidates with distances.
5. Search supports limit/offset constraints and safe bounds.
6. Redis outages fail gracefully with typed error surface.

Command gate:
- `npm test -- __tests__/workflowIntentSearch.test.ts`

### Increment 4: Upload ingestion integration
Files expected:
- `src/server/uploadService.ts`
- `src/app/api/upload/external/route.ts`
- optional helper module(s)

Test cases:
1. Comfy upload triggers extras persistence and intent indexing path.
2. Non-Comfy upload skips workflow persistence/indexing path.
3. Upload still succeeds if extras or index persistence fails (best effort, logged).
4. Existing metadata behavior unchanged (`generatedBy`, `comfyMetadataDetected`).

Command gates:
- `npm test -- __tests__/uploadExternalRoute.test.ts`
- `npm test -- __tests__/comfyMetadata.test.ts`
- any new upload-service-specific tests

### Increment 5: Query API + re-ranking
Files expected:
- `src/app/api/workflows/search/route.ts` (or equivalent)
- optional helper modules for scoring/reranking
- `__tests__/workflowSearchRoute.test.ts`

Test cases:
1. Filters corpus to Comfy images only (`generatedBy="comfyui" || comfyMetadataDetected=true`).
2. Embeds query and performs ANN lookup on workflow intent vectors.
3. Re-ranks by weighted score using:
   - ANN similarity
   - CLIP text-to-image similarity
   - prompt/node keyword overlap
4. Returns workflow payload + representative image + reason match.
5. Handles missing vectors/empty corpus with clear response.
6. Input validation for query/limit fields.

Command gate:
- `npm test -- __tests__/workflowSearchRoute.test.ts`

## Final Regression Sweep
Commands:
1. `npm test`
2. `npm run lint`

Pass criteria:
- all tests passing
- zero lint errors/warnings (for changed files and global run)
- no unhandled promise rejections or runtime errors in tests

## Non-Goals for Phase 1
- perfect prompt extraction from arbitrary custom nodes
- full visual graph rendering UI
- production-scale recall tuning of rank weights

## Risk Controls
1. Keep extraction heuristic modules isolated and unit-tested.
2. Use deterministic normalization to avoid embedding drift.
3. Store large workflow JSON in extras storage only.
4. Mark all new schema fields with explicit version metadata.
5. Keep upload path resilient: workflow persistence/indexing is best effort.
