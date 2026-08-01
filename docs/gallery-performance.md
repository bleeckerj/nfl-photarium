# Gallery Performance And Cache Invariants

## Scope

This note documents how the gallery read path stays fast without serving stale
data, and the invariants any future change must preserve. It covers the version
counters, the HTTP revalidation contract, the memo layers, and the read/write
rules that keep them correct.

Read this before adding a new store, a new write path, or a new field to the
`/api/images` response.

## The Core Rule

**Reads must not invalidate. Writes must.**

Every gallery cache — server memos, HTTP ETags, and the client's warm page
snapshots — is keyed on version counters. If a read path bumps a counter,
every cache misses and the gallery pays a full catalog rescan. If a write path
fails to bump one, clients keep serving stale data behind a `304`.

Both failure modes are silent. Neither shows up as an error.

## Version Counters

Three per-process counters describe everything a gallery response derives from:

| Counter | Owner | Bumped by |
| --- | --- | --- |
| `contentVersion` | [src/server/cloudflareImageCache.ts](../src/server/cloudflareImageCache.ts) | `upsertCachedImage` when the merged record differs from the existing one; `removeCachedImage` always; background reconcile only when the catalog contents differ; size backfill only when a size was actually discovered |
| folder-override version | [src/server/imageExtras.ts](../src/server/imageExtras.ts) | every extras write, and any refresh that observes a changed revision token |
| video catalog version | [src/server/videoCatalogStorage.ts](../src/server/videoCatalogStorage.ts) | video record upsert/remove/invalidate, when the record set fingerprint changed |

Accessors: `getCacheStats().contentVersion`, `getImageFolderOverridesVersion()`,
`getVideoAssetCatalogVersion()`.

The common thread: re-observing identical data does **not** bump. That property
is what makes these counters usable as cache keys — a periodic refresh or a
redundant write must not look like a data change.

### The equality guard in `upsertCachedImage`

`upsertCachedImage` deep-compares the merged record against the existing one via
`cachedImageRecordsEqual` in
[src/server/cloudflareImageReconciliation.ts](../src/server/cloudflareImageReconciliation.ts).
When they are equal it returns early: no version bump, no journal mutation, no
metadata-override scheduling.

This exists because the image detail route
([src/app/api/images/[id]/route.ts](../src/app/api/images/[id]/route.ts))
enriches a record with Redis-side vector metadata and writes it back. The
enrichment returns a fresh object for essentially every image, so **viewing a
detail page used to invalidate every gallery cache in the process** — which is
what made returning to the gallery slow.

The comparator is deliberately a deep comparison over the whole record rather
than a hand-listed field set: a field the comparator does not know about can
then only cause a spurious bump (slow but correct), never a suppressed real
change (fast but wrong).

## HTTP Revalidation

`/api/images` and `/api/namespaces` serve a version-keyed weak `ETag` with:

```http
Cache-Control: private, no-cache, must-revalidate
ETag: W/"g1-<instance>-<hash>"
```

`no-cache` means *store the body, but always revalidate* — not *do not store*.
The browser sends `If-None-Match` on every request; when the version triple is
unchanged the route answers `304` before doing any assembly work. There is no
TTL and therefore no staleness window: freshness is identical to the previous
`no-store` behavior, but an unchanged dataset costs a `304` instead of
reassembling and re-downloading the full payload.

Tag construction lives in `buildGalleryCollectionEtag`
([src/server/galleryResponseDiagnostics.ts](../src/server/galleryResponseDiagnostics.ts)).
Inputs:

- `/api/images` (`g1` prefix): all three version counters plus the request's
  query string.
- `/api/namespaces` (`ns1` prefix): catalog version, video catalog version, and
  the registry file's `updatedAt`.

Both fold in a **per-process instance id**. The counters are in-process and
reset arbitrarily on restart, so a tag is only comparable against tags issued by
the same process. The instance id makes any cross-process or post-restart
validation a guaranteed miss (a full `200`), which errs toward freshness.

The tag is computed *before* assembly and reused on the response. If a version
bumps mid-request the response carries the slightly stale tag, so the next
conditional request is a full `200` — again erring toward freshness.

### Requests that never get an ETag

Requests that merge Redis-side color, aspect, or embedding metadata are excluded
from ETagging entirely, because that data has **no version counter** and
background embedding jobs mutate it:

- `includeVectorMeta=1`
- `embedding` filter other than `none`
- any aspect filter (`aspectRatioClass`, `aspectRatio`, `aspectRatioClasses`)

These always receive a full `200`. If you ever add a version counter for the
Redis metadata, fold it into the tag and this exclusion can be removed.

### Client side

The gallery fetches with `cache: 'no-cache'`, not `'no-store'`
([src/components/ImageGallery.tsx](../src/components/ImageGallery.tsx)). That is
what makes the browser attach `If-None-Match` and transparently serve the cached
body on a `304` — `response.ok` is true and the JSON is the cached body, so no
other client code changes were needed.

## Memo Layers

Two server-side memo layers sit behind the same version keys:

- **Scope assembly** — [src/server/galleryScopeAssembly.ts](../src/server/galleryScopeAssembly.ts).
  Holds the passes that iterate the full catalog: video→image Comfy provenance,
  namespace filtering, the video record projection, the family merge, the media
  filter, and folder-override application. LRU, 8 entries.
- **Query scope + projection** — [src/server/galleryQuery.ts](../src/server/galleryQuery.ts).
  Family summary map and facets (8 entries), plus the filtered/sorted projection
  (24 entries).

Both are keyed on the version triple plus the scope parameters (namespace, media
filter, family target, video limit).

The two key layers have different jobs, and the distinction matters:

- The **scope key** describes the visible dataset: the version triple, the scope
  parameters, and the hidden-folder / hidden-tag / hidden-namespace lists. The
  hidden lists belong here because facet counts are computed over the
  hidden-filtered base — a facet list must not count rows the user has hidden.
  Row-selecting filters must never enter this key, or the assembly and facet
  work would be recomputed per filter combination, which is the whole cost the
  memo exists to avoid.
- The **projection key** extends the scope key with the filters that select and
  order rows: search, folder, tag, favorites, comfy, embedding, aspect, and
  date. It is a per-filter-combination cache of the filtered and sorted result,
  bounded to 24 entries.

Pagination is applied after both, so page number enters neither key.

`clearGalleryQueryScopeMemo()` clears all three and is the single entry point
tests should use.

The catalog is large (~19k images in the reference install). Any new per-request
pass that iterates it belongs inside the assembly memo, not in the route.

## Diagnostics

Every `/api/images` response carries:

| Header | Meaning |
| --- | --- |
| `Server-Timing` | Per-stage durations (`cache_load`, `scope_assembly`, `gallery_query`, `extras_load`, `serialization`, `total`) |
| `X-Photarium-Catalog-Version` | Current `contentVersion` |
| `X-Photarium-Catalog-Source` | `memory`, `persistent`, or `empty` |
| `X-Photarium-Catalog-Age-MS` | Time since last reconcile |
| `X-Photarium-Reconciling` | `1` while a background refresh is in flight |
| `X-Photarium-Payload-KB` | Serialized response size |
| `X-Photarium-Request-ID` | Correlates with the slow-response server log |

Responses slower than 500ms also log a `[ImagesAPI] Slow response` line with the
full timing and catalog breakdown.

**To confirm the read path is not invalidating**: load the gallery, open an image
detail page, return, and check that `X-Photarium-Catalog-Version` is unchanged
across all three requests. If it moves on a pure read, something on that path is
writing to the catalog.

## Family Route And The Candidate Pool

`/api/images/[id]/family` serves two very different payloads:

- **Family (always):** the target, its root, and the root's children — resolved
  from the raw in-memory catalog, mapped through `toFamilyAsset`, and
  extras-merged for only those few ids. This must stay O(family), not
  O(catalog): the previous shape mapped all ~19k records and MGET'd extras for
  every id on every request, costing seconds per call.
- **Candidates (`includeCandidates=1` only):** the full catalog projected to
  `SlimCandidateAsset` ([src/server/familyCandidatePool.ts](../src/server/familyCandidatePool.ts))
  — only the fields the adopt-variation UI and its client-side classification
  read. Absent values are omitted (never empty strings/arrays) because the
  detail pages shallow-merge these records over richer state. The pool is
  memoized behind the version triple; the builder awaits
  `getImageFolderOverrides()` once to arm the extras version counter before
  keying on it.

The wrapper `assignmentCandidates` array no longer exists on the wire: both
detail pages rebuild availability classification client-side
(`buildVariantAssignmentCandidates` over the merged pool), so the server ships
each asset once instead of ~3× (which is what produced ~95 MB responses).

**The client never prefetches the pool.** It loads only on a real adopt-panel
interaction (search, filter, non-default scope) or the empty-state
"Browse all assets" button. A scope that merely *defaulted* to `'all'` for a
namespace-less asset is not an interaction — both detail pages compare against
`getDefaultAdoptVariationScope` and ignore scope until the per-id default has
been applied. Mutation refreshes (`refreshImageList`) fetch family only; a
previously loaded pool persists in client state.

## Aspect-Ratio Probes

When a record lacks `aspectRatio`, `useImageAspectRatio` probes the
**`thumbnail` (w=150) variant** — resizing preserves the ratio at a fraction of
the bytes. The only `public`-variant probe is the detail page's own
dimensions display, which needs true pixel dimensions. Both `AspectRatioDisplay`
components accept a preset `aspectRatio` prop and skip the probe entirely when
the record carries one; run `npm run aspect:backfill` to persist
dimensions/ratios server-side so probes rarely fire at all.

## Other Read-Path Costs

- **Grid variant.** The gallery grid requests the `w=600` Cloudflare variant, not
  full-resolution originals. See [Variants](./variants.md).
- **Extras revision token.** The folder-override map refresh is gated on a
  storage-side revision token so it can skip a full-keyspace `SCAN` + `MGET`
  when nothing was written. See [Image Extras](./image-extras.md).
- **Catalog cold fetch.** `fetchAllCloudflareImagePages`
  ([src/server/cloudflareImageListFetcher.ts](../src/server/cloudflareImageListFetcher.ts))
  fetches page 1 alone, then continues in concurrent waves of 6, stopping at the
  wave containing a short page. The Cloudflare list API exposes no total count,
  so the end is detected by page length.
- **Single serialization.** The response body is `JSON.stringify`'d once; the
  payload-size diagnostic is derived from that same string.
- **Folder inventory.** `/api/folders` reads the in-memory catalog with extras
  folder overrides applied (`listCatalogImagesWithFolderOverrides` in
  [src/server/folderInventory.ts](../src/server/folderInventory.ts)), not a live
  Cloudflare list call. The previous direct call was un-paginated and silently
  saw only the API's first page.

## Client Render Path

- **No blanking on refetch.** The gallery renders its loading skeleton only when
  there are no images to show. A hydrated grid stays visible while a fetch is in
  flight (stale-while-revalidate), and swaps when the response lands.
- **Remount key.** [src/app/page.tsx](../src/app/page.tsx) keys `<ImageGallery>`
  on the `focus` param only. Return-state params (`gpage`, `gns`, `gcolor`) are
  consumed once and stripped via `history.replaceState`, so keying on the full
  query string would remount — and blank — the gallery on every return from a
  detail page.
- **Scroll ownership.** A pending return-state restore owns the scroll position;
  the mount-time scroll-to-top is skipped in that case so the two do not race.
  The restore and the return-param URL cleanup live in
  `useGalleryReturnNavigation`
  ([src/components/gallery/hooks/useGalleryReturnNavigation.ts](../src/components/gallery/hooks/useGalleryReturnNavigation.ts)).

### Known limitation: scroll restore lands short

The restore schedules `window.scrollTo({ top: savedScrollY })` inside a
double-`requestAnimationFrame`. On a long page that fires before the grid has
laid out to full height, so the browser clamps the target to the document height
available at that instant and the page lands near the top instead of at the
saved offset.

Observed on the reference install: saved `scrollY` of 1200 restores to ~57.
The save side is correct — `galleryReturnStateV1` holds the right value — so this
is purely a restore-timing problem.

This predates the current performance work; gating the mount-time scroll-to-top
stopped it from *overwriting* the restore, but did not make the restore land.
A fix needs the scroll deferred until the grid has its final height — for example
retrying until `document.documentElement.scrollHeight` can accommodate the target,
or restoring after the tiles' layout settles rather than after two frames.
- **Page-scoped enrichment.** Color and Prompt This enrichment fetch only the
  visible page, request their chunks concurrently, and merge into a single state
  update. Per-chunk state updates previously re-rendered every visible card.

## Checklist For New Work

When adding a write path that changes gallery-visible data:

- [ ] It bumps one of the three version counters (usually implicitly, by going
      through `upsertCachedImage` or an extras write).
- [ ] If it introduces a new store, either wire it into an existing counter or
      add a new counter **and** fold it into both routes' ETags.
- [ ] Verify: capture the ETag, perform the write, confirm the next request is a
      `200` with a different tag and the new data.

When adding a read path or enrichment:

- [ ] It does not write to the catalog, or its write is genuinely a discovery
      that a user would see.
- [ ] Verify: `X-Photarium-Catalog-Version` is unchanged across repeated reads.

When adding a per-request computation over the catalog:

- [ ] It lives inside the assembly memo, keyed on the version triple.
- [ ] Per-request filters stay outside the memo key.

## Regression Tests

- `__tests__/cloudflareImageCache.test.ts` — upsert idempotency: an identical
  re-upsert leaves `contentVersion` unchanged; a changed field and a first-time
  enrichment discovery both bump it.
- `__tests__/imagesRouteVideoIntegration.test.ts` — conditional request returns
  `304`, a version bump returns `200`, and unversioned-metadata requests never
  carry an ETag.
- `__tests__/namespacesRoute.test.ts` — revalidation headers and the `304` path.

Route tests mock `@/server/videoCatalogStorage`; those mocks must include
`getVideoAssetCatalogVersion` or the route throws.
