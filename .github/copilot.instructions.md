---
applyTo: '**/**'
---
# CODE INSTRUCTIONS FOR PHOTARIUM PROJECT
## Style
* Ensure modularity and separation of concerns.
* Use descriptive names for variables, functions, classes, and files.
* Prefer `async/await` for asynchronous code.
* Use TypeScript interfaces/types for object shapes; prefer `interface` over `type` for objects.
* Use `unknown` instead of `any`; narrow types with type guards.
* Keep functions and methods focused on a single responsibility.
* No monolithic files; break large components/services into smaller ones.
* Keep code well-documented with comments where necessary.

## EMOJIS and Documetation
* Use emojis in console output and logs to enhance readability (e.g., ✓ for success, ⚠ for warnings, ✗ for errors).
* DO NOT use EMOJIS in production user-facing UI components or documentation, marketing website, etc. Only use SVG icons from icons8.com or similar.

## Stand-alone scripts
When creating stand-alone scripts in the `scripts/` directory:
* Use clear, descriptive names for the script files.
* Include a comment at the top explaining the script's purpose and usage.
* Ensure scripts can be run from the command line with appropriate arguments.
* Provide extra verbose stdout and logging by default for visibility into operations.

# Testing
Attempt to load the application via curl to identify if there are any runtime issues in the response. Do this for the main API routes and key pages.

Provide comprehensive tests for all new features and bug fixes. Use Vitest for unit tests and integration tests. Mock external dependencies where appropriate.

For external API calls, use mocking libraries to simulate responses and avoid hitting real endpoints during tests.

Do not assume new functionality works before you have written and thoroughly run tests to confirm it.

Tests should cover:
- Normal cases
- Edge cases
- Error handling

# Photarium - AI Coding Instructions

## Code Style Guide
* Maintain modularity, separation of concerns, and single responsibility principle. 
* No monolithic files; break large components/services into smaller ones.
* Use descriptive names for variables, functions, classes, and files.
* Prefer `async/await` over `.then()` for asynchronous code.
* Use TypeScript interfaces/types for object shapes; prefer `interface` over `type` for objects.
* Use `unknown` instead of `any`; narrow types with type guards.

## Architecture Overview

Photarium is a Next.js 16 App Router application that wraps Cloudflare Images API with local metadata management. Key architectural decisions:

- **No database** - Cloudflare Images stores everything; local cache provides fast reads
- **Two-tier caching** - In-memory (`globalThis` singleton) + persistent storage (file or Redis)
- **Server/client split** - `src/server/` for server-only code, `src/utils/` for shared utilities

### Core Data Flow
```
Cloudflare Images API → cloudflareImageCache.ts (fetch + transform) → API routes → React components
                                    ↓
                          cacheStorage.ts (file or Redis persistence)
```

## Key Files & Patterns

### Server Layer (`src/server/`)
- `cloudflareImageCache.ts` - Central cache with `getCachedImages()`, `upsertCachedImage()`. Uses `Symbol.for()` for HMR-safe global state
- `cacheStorage.ts` - Storage abstraction (`ICacheStorage` interface). Switch via `CACHE_STORAGE_TYPE=file|redis`
- `uploadService.ts` - Image upload with duplicate detection, EXIF extraction, content hashing
- `duplicateDetector.ts` - Finds duplicates by `originalUrl` or `contentHash`

### API Routes (`src/app/api/`)
- All routes return CORS headers via `withCors()` helper
- Dynamic params use `{ params }: { params: Promise<{ id: string }> }` (Next.js 15+ pattern)
- Standard error shape: `{ error: string, details?: unknown }`

### Components (`src/components/`)
- `ImageGallery.tsx` - Main gallery (~3000 lines). Heavy use of `useMemo` for filtering chains
- Components use `'use client'` directive; no Server Components in use currently

## Conventions

### Environment Variables
- Required: `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `NEXT_PUBLIC_CLOUDFLARE_ACCOUNT_HASH`
- Optional: `IMAGE_NAMESPACE`, `OPENAI_API_KEY`, `CACHE_STORAGE_TYPE`, `REDIS_URL`

### Metadata Storage
Cloudflare Images metadata is JSON-stringified into a single `meta` field with 1024-byte limit. Use `enforceCloudflareMetadataLimit()` before upload.

### Image Variants
Standard variants defined in `src/utils/imageUtils.ts`:
- `public` (original), `w=300`, `w=600`, `w=900`, `w=1200`, `w=150`
- Always append `?format=webp` unless already specified

### TypeScript
- Use `@/` path alias for imports (configured in tsconfig)
- Prefer `interface` over `type` for object shapes
- Use `unknown` over `any`; narrow with type guards

## Commands

```bash
npm run dev              # Start with Turbopack
npm run test             # Vitest tests
npm run redis:start      # Start Redis Stack (Docker)
npm run redis:stop       # Stop Redis
npm run lint             # ESLint
```

### Utility Scripts (`scripts/`)
```bash
npm run audit:broken     # Check for 404/410 images
npm run namespace:scan   # Scan images for namespace metadata
npm run diag:duplicates  # Diagnose duplicate images
```

## Testing

Tests in `__tests__/` use Vitest with `vi.mock()`. Pattern for API route tests:
```typescript
import { POST } from '@/app/api/upload/external/route';
const request = new NextRequest(new Request(url, { method: 'POST', body: formData }));
const response = await POST(request);
```

## Common Tasks

### Adding a new API route
1. Create `src/app/api/{name}/route.ts`
2. Export `GET`, `POST`, etc. async functions
3. Wrap responses with `withCors()` if external access needed
4. Update cache via `upsertCachedImage()` after mutations

### Modifying image metadata shape
1. Update `CachedCloudflareImage` interface in `cloudflareImageCache.ts`
2. Update `transformImage()` to extract new field from Cloudflare meta
3. Bump `CACHE_VERSION` in `cacheStorage.ts` to invalidate old caches

### Adding gallery filters
Filters chain in `ImageGallery.tsx` via `useMemo`:
`baseFilteredImages` → `duplicateFilteredImages` → `brokenFilteredImages` → `sortedImages` → `dateFilteredImages`

## Agent Workflow Requirements

**CRITICAL: Test everything you build.** Follow this workflow for all changes:

1. **Before coding** - Run `npm run dev` to ensure clean startup (no warnings/errors)
2. **After coding** - Run `npm run test` to verify no regressions
3. **Check for errors** - Use `get_errors` tool to verify TypeScript compiles cleanly
4. **Verify runtime** - If you changed server code, restart dev server and check console for warnings
5. **Fix before moving on** - Do not proceed to next task if there are errors or warnings

### Error/Warning Zero Tolerance
- **TypeScript errors** - Fix immediately; never suppress with `@ts-ignore`
- **ESLint warnings** - Fix or explicitly disable with comment explaining why
- **Console warnings** - Investigate and resolve (e.g., React key warnings, deprecations)
- **Build warnings** - Address before considering task complete

### Testing Checklist
```bash
npm run test             # Must pass
npm run lint             # Must pass
npm run dev              # Must start without errors/warnings
```

## Redis & Vector Search Roadmap

### Current State (Phase 1 ✓)
- `src/server/cacheStorage.ts` - `ICacheStorage` interface with file and Redis implementations
- `docker-compose.yml` - Redis Stack container with RediSearch modules
- Environment: `CACHE_STORAGE_TYPE=redis`, `REDIS_URL=redis://localhost:6379`

### Phase 2: Vector Search Infrastructure (Next)
Redis Stack includes RediSearch for vector similarity. Implementation plan:

1. **Create vector index schema** in Redis for CLIP embeddings (768-dim float vectors)
2. **Add embedding fields** to `CachedCloudflareImage` interface:
   ```typescript
   clipEmbedding?: number[];      // 768-dim CLIP vector
   colorHistogram?: number[];     // Color distribution vector
   dominantColors?: string[];     // Hex codes of top 5 colors
   ```
3. **Bump `CACHE_VERSION`** when adding new fields

### Phase 3: Embedding Generation
- **CLIP embeddings** via Cloudflare Workers AI (`@cf/openai/clip-vit-base-patch32`)
- **Color extraction** via client-side canvas or sharp on upload
- Generate on upload, batch-process existing images

### Phase 4: Search API
New endpoints to implement:
- `GET /api/images/similar?id={id}` - Find visually similar images (CLIP)
- `GET /api/images/similar-colors?id={id}` - Find images with similar palette
- `POST /api/images/search-by-image` - Upload image to find similar

### Redis Commands Reference
```bash
npm run redis:start      # Start Redis Stack
npm run redis:stop       # Stop Redis
npm run redis:logs       # View logs
npm run redis:status     # Check status
```

RedisInsight UI: http://localhost:8001 (when Redis is running)

### Key Files for Vector Search
- `src/server/cacheStorage.ts` - Add vector operations to `RedisCacheStorage`
- `src/server/embeddingService.ts` - (to create) CLIP embedding generation
- `src/server/vectorSearch.ts` - (to create) Redis vector query helpers
- `docs/FUTURE_SEARCH_FEATURES.md` - Detailed implementation notes
