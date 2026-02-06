## Plan: “Prompt This” Image-to-Prompt Feature

Add a new image action that generates a high-quality text-to-image prompt from an existing image, stores it durably (without hitting Cloudflare metadata limits), exposes it via an API endpoint, and supports backfilling for a namespace.

### Steps
1. Add a Redis-backed “prompt store” helper in src/server (new file, e.g. src/server/promptThis.ts) that can `getPrompt(imageId)` and `setPrompt(imageId, prompt, model, version)`.
2. Add `POST /api/images/[id]/prompt` (new route under src/app/api/images/[id]/prompt/route.ts) that:
   - checks Redis availability; if missing returns 503 but never crashes
   - generates a prompt from the image URL (w=300 variant) using an LLM/vision provider
   - stores the result in Redis and returns it
   - supports `?force=1` or body `{ force: true }` to regenerate
3. Add `GET /api/images/[id]/prompt` to return any stored prompt for the image (and metadata like createdAt/model/version).
4. Add a “PROMPT THIS” button + display box on the image detail page src/app/images/[id]/page.tsx near existing generate actions (ALT/description/haiku/concepts). Use the same toast/error patterns you already use.
5. Add a backfill script in scripts/ (e.g. scripts/backfill-prompts.mjs) that pages through `/api/images?namespace=...` and calls `/api/images/:id/prompt` with concurrency and retry/backoff; include `--dry-run`, `--limit`, `--force`, `--namespace`.
6. Update docs page (/docs) via docblocks on the new route so it’s browsable, and optionally add a small unit test for the prompt store helper.

### Further Considerations
1. Storage choice: Redis hash per image (recommended) vs Cloudflare metadata overrides (risk: Cloudflare metadata size limits). Redis is safest for long prompts.
2. Model/provider: OpenAI Vision vs Anthropic vs local; keep provider behind a small adapter so it’s swappable.
3. Degraded mode: if Redis is down, either return 503 (strict) or return the generated prompt but warn it wasn’t saved (more user-friendly).
