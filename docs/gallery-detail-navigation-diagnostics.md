# Gallery Detail Navigation Diagnostics

## Scope

This note documents the intended behavior and current source-code loci for the image-detail navigation buttons:

- `Show in gallery`
- `Show in namespace`

It is diagnostic only. It does not propose or apply a code fix.

## Intended User Behavior

### Show in gallery

From an image detail page for image `X`, `Show in gallery` is intended to show image `X` in the global gallery order across all namespaces.

The expected outcome is not simply:

- navigate to `/`
- set the gallery namespace selector to `All namespaces`
- show page 1 with the newest assets

The expected outcome is:

- navigate to the gallery in `All namespaces`
- find image `X` within the gallery's natural ordering
- request or compute the gallery page that contains image `X`
- render that page
- show image `X` inline in its normal position among adjacent gallery assets
- ideally scroll/highlight image `X` so it is easy to locate

In other words, this button should answer: "Where does this asset live in the full gallery stream?"

### Show in namespace

From an image detail page for image `X`, `Show in namespace` is intended to show image `X` in the gallery scoped to `X`'s own namespace.

The expected outcome is not simply:

- navigate to `/`
- switch the namespace selector to `X.namespace`
- show page 1 with the newest assets in that namespace

The expected outcome is:

- switch the active gallery namespace to `X.namespace`
- find image `X` within that namespace's natural gallery ordering
- request or compute the gallery page that contains image `X`
- render that page
- show image `X` inline in its normal position among adjacent same-namespace gallery assets
- ideally scroll/highlight image `X` so the user can immediately see it and the assets around it

In other words, this button should answer: "Where does this asset live among its namespace neighbors?"

## Natural Gallery Order

The server-side gallery query currently defines natural order in [src/server/galleryQuery.ts](/Users/julian/Code/cloud-flare-image-handler/src/server/galleryQuery.ts):

```ts
const sorted = [...duplicateFiltered].sort((a, b) => Date.parse(b.uploaded ?? '') - Date.parse(a.uploaded ?? ''));
```

That means the natural order is descending upload time: newest first.

When a focus asset id is provided, the same function computes:

- the focused asset's index in the sorted result set
- the page containing that index
- a page slice containing that asset
- focus metadata with `found`, `index`, `ordinal`, `page`, `pageSize`, and `total`

The important point: the server already has the conceptual behavior needed for both buttons. The client has to reliably send the right `namespace` and `focus` query and then render the returned page.

## Detail Page Button Locus

The two button handlers live in [src/app/images/[id]/page.tsx](/Users/julian/Code/cloud-flare-image-handler/src/app/images/[id]/page.tsx).

### Show in gallery handler

Current relevant shape:

```ts
const handleShowInGalleryOrder = useCallback(() => {
  if (!id) return;
  router.push(
    buildCanonicalGalleryHref({
      assetId: id,
      namespace: '__all__',
    }),
    { scroll: false }
  );
}, [id, router]);
```

This builds a URL like:

```txt
/?gns=__all__&focus=<image-id>
```

That URL means:

- `gns=__all__`: gallery namespace scope should be all namespaces
- `focus=<image-id>`: gallery should locate this asset in natural gallery order

### Show in namespace handler

Current relevant shape:

```ts
const handleShowInNamespace = useCallback(() => {
  if (!id) return;
  const targetNamespace = image?.namespace?.trim();
  if (!targetNamespace) {
    toast.push('This image does not have a namespace to show.');
    return;
  }
  clearGalleryReturnState();
  clearGalleryReturnSnapshot();
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(GALLERY_NAMESPACE_STORAGE_KEY, targetNamespace);
  }
  router.push(
    buildCanonicalGalleryHref({
      assetId: id,
      namespace: targetNamespace,
    }),
    { scroll: false }
  );
}, [id, image?.namespace, router, toast]);
```

This builds a URL like:

```txt
/?gns=<image-namespace>&focus=<image-id>
```

That URL means:

- `gns=<image-namespace>`: gallery namespace scope should become the image's namespace
- `focus=<image-id>`: gallery should locate this asset in natural namespace-scoped order

## URL Builder Locus

The canonical focus URL helper lives in [src/components/gallery/focusNavigation.ts](/Users/julian/Code/cloud-flare-image-handler/src/components/gallery/focusNavigation.ts).

Relevant pieces:

```ts
export const GALLERY_NAMESPACE_QUERY_PARAM = 'gns';
export const GALLERY_FOCUS_QUERY_PARAM = 'focus';
export const GALLERY_NAMESPACE_STORAGE_KEY = 'imageNamespace';
```

```ts
export const buildCanonicalGalleryHref = ({
  assetId,
  namespace,
}: {
  assetId: string;
  namespace?: string | null;
}) => {
  const normalizedAssetId = assetId.trim();
  if (!normalizedAssetId) {
    return '/';
  }

  const params = new URLSearchParams();
  params.set(GALLERY_NAMESPACE_QUERY_PARAM, typeof namespace === 'string' ? namespace : '');
  params.set(GALLERY_FOCUS_QUERY_PARAM, normalizedAssetId);
  return `/?${params.toString()}`;
};
```

The same module parses the gallery URL:

```ts
export const parseGalleryNamespaceFromSearch = (search: string): string | undefined => {
  if (!search) return undefined;
  const params = new URLSearchParams(normalizeSearch(search));
  if (!params.has(GALLERY_NAMESPACE_QUERY_PARAM)) {
    return undefined;
  }
  return params.get(GALLERY_NAMESPACE_QUERY_PARAM) ?? '';
};
```

```ts
export const parseCanonicalGalleryFocusFromSearch = (
  search: string
): CanonicalGalleryFocusTarget | null => {
  if (!search) return null;
  const params = new URLSearchParams(normalizeSearch(search));
  const assetId = params.get(GALLERY_FOCUS_QUERY_PARAM)?.trim();
  if (!assetId) {
    return null;
  }

  return {
    assetId,
    namespace: parseGalleryNamespaceFromSearch(search) ?? '',
  };
};
```

## Root Gallery Page Locus

The root page lives in [src/app/page.tsx](/Users/julian/Code/cloud-flare-image-handler/src/app/page.tsx).

It owns the active gallery namespace state:

```ts
const envDefaultNamespace = process.env.NEXT_PUBLIC_IMAGE_NAMESPACE || 'cf-default';
const searchParams = useSearchParams();
const search = searchParams.toString();
const galleryInstanceKey = search ? `gallery:${search}` : 'gallery';
const [namespace, setNamespace] = useState<string>(envDefaultNamespace);
```

It synchronizes the namespace from the URL or localStorage:

```ts
useEffect(() => {
  if (typeof window === 'undefined') return;
  const queryNamespace = parseGalleryNamespaceFromSearch(search);
  const stored = window.localStorage.getItem(GALLERY_NAMESPACE_STORAGE_KEY);
  const nextNamespace =
    queryNamespace !== undefined
      ? (queryNamespace || envDefaultNamespace)
      : stored === '__none__'
        ? envDefaultNamespace
        : stored === '__all__'
          ? '__all__'
          : stored || envDefaultNamespace;
  if (queryNamespace !== undefined) {
    if (nextNamespace === '__all__') {
      window.localStorage.setItem(GALLERY_NAMESPACE_STORAGE_KEY, '__all__');
    } else {
      window.localStorage.setItem(GALLERY_NAMESPACE_STORAGE_KEY, nextNamespace);
    }
  }
  setNamespace((prev) => (prev === nextNamespace ? prev : nextNamespace));
}, [envDefaultNamespace, search]);
```

It renders the gallery:

```tsx
<ImageGallery
  key={galleryInstanceKey}
  ref={galleryRef}
  refreshTrigger={refreshTrigger}
  namespace={namespace}
  onNamespaceChange={handleNamespaceChange}
/>
```

This page is important because the detail page handlers do not pass data directly into `ImageGallery`; they navigate to a URL. The root page must interpret the URL and provide the right namespace prop to `ImageGallery`.

## ImageGallery Focus Locus

The main gallery component lives in [src/components/ImageGallery.tsx](/Users/julian/Code/cloud-flare-image-handler/src/components/ImageGallery.tsx).

On initial render, it reads the focus target from `window.location.search`:

```ts
const initialFocusTargetRef = useRef(
  typeof window === 'undefined' ? null : parseCanonicalGalleryFocusFromSearch(window.location.search)
);
```

If a focus target exists, it avoids restoring stale return state:

```ts
const initialGalleryReturnStateRef = useRef<NormalizedGalleryReturnState | null>(
  initialFocusTargetRef.current ? null : getFreshGalleryReturnState()
);
```

It also neutralizes stored filters when focus mode is active:

```ts
const storedPreferencesRef = useRef(
  getStoredPreferences(namespace, initialGalleryReturnStateRef.current, {
    neutralizeFilters: Boolean(initialFocusTargetRef.current),
  })
);
```

During fetch, it conditionally sends `focus=<asset-id>` to `/api/images`:

```ts
const focusTarget = initialFocusTargetRef.current;
const activeNamespace = namespace ?? '';
const focusAssetId =
  focusTarget && !focusAppliedRef.current && focusTarget.namespace === activeNamespace
    ? focusTarget.assetId
    : undefined;
```

The fetch URL is built with:

```ts
const url = buildGalleryImagesUrl({
  forceRefresh,
  namespace,
  videoLimitOverride,
  includeExtrasForGallery,
  showMotionAssetsOnly: showMotionAssetsOnlyRef.current,
  serverQuery: galleryServerQueryRef.current,
  focusAssetId,
});
```

`buildGalleryImagesUrl` adds:

```ts
if (focusAssetId?.trim()) {
  params.set('focus', focusAssetId.trim());
}
```

After the response returns, the gallery stores server focus metadata:

```ts
setServerFocus(
  responseFocus &&
    typeof responseFocus.assetId === 'string' &&
    typeof responseFocus.found === 'boolean' &&
    typeof responseFocus.index === 'number' &&
    typeof responseFocus.ordinal === 'number' &&
    typeof responseFocus.page === 'number' &&
    typeof responseFocus.pageSize === 'number' &&
    typeof responseFocus.total === 'number'
    ? {
        assetId: responseFocus.assetId,
        found: responseFocus.found,
        index: responseFocus.index,
        ordinal: responseFocus.ordinal,
        page: responseFocus.page,
        pageSize: responseFocus.pageSize,
        total: responseFocus.total,
      }
    : null
);
```

Then a focus effect tries to verify and reveal the focused asset:

```ts
if (!serverFocus.found) {
  focusAppliedRef.current = true;
  setFocusNotice('The requested asset could not be placed in gallery order.');
  return;
}

const targetPage = serverFocus.page;
if (pageIndex !== targetPage) {
  goToPageNumber(targetPage);
  return;
}

const scopedAsset = galleryImages.find((entry) => entry.id === focusTarget.assetId);
if (!scopedAsset) {
  focusAppliedRef.current = true;
  setFocusNotice('The requested asset is not available in this gallery scope.');
  return;
}

const isOnLoadedPage = filteredImages.some((entry) => entry.id === focusTarget.assetId);
if (!isOnLoadedPage) {
  focusAppliedRef.current = true;
  setFocusNotice('The requested asset could not be placed in gallery order.');
  return;
}

focusAppliedRef.current = true;
setFocusNotice(`Image ${serverFocus.ordinal.toLocaleString()} of ${serverFocus.total.toLocaleString()}`);
setFocusedGalleryAssetId(focusTarget.assetId);
```

Finally it scrolls to the card:

```ts
window.requestAnimationFrame(() => {
  const target = document.querySelector<HTMLElement>(
    `[data-gallery-asset-id="${focusTarget.assetId}"]`
  );
  target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
});
```

## API Locus

The `/api/images` route lives in [src/app/api/images/route.ts](/Users/julian/Code/cloud-flare-image-handler/src/app/api/images/route.ts).

It reads:

```ts
const focusAssetId = request.nextUrl.searchParams.get('focus')?.trim() || '';
const namespaceParam = request.nextUrl.searchParams.get('namespace');
```

It maps namespace values:

```ts
const namespace =
  namespaceParam === '__none__'
    ? ''
    : namespaceParam === '__all__'
      ? null
      : namespaceParam !== null
        ? namespaceParam.trim()
        : defaultNamespace;
```

Then it filters images/videos to that namespace and delegates to `queryGalleryAssets(...)`, passing the focus asset id.

## Server Query Locus

The server-side focused page calculation is in [src/server/galleryQuery.ts](/Users/julian/Code/cloud-flare-image-handler/src/server/galleryQuery.ts).

Relevant behavior:

```ts
const sorted = [...duplicateFiltered].sort((a, b) => Date.parse(b.uploaded ?? '') - Date.parse(a.uploaded ?? ''));
const safePage = Math.max(1, Math.floor(page));
const safePageSize = Math.max(1, Math.floor(pageSize));
const total = sorted.length;
const totalPages = Math.max(1, Math.ceil(total / safePageSize));
const normalizedFocusAssetId = focusAssetId?.trim() ?? '';
const focusIndex = normalizedFocusAssetId
  ? sorted.findIndex((asset) => asset.id === normalizedFocusAssetId)
  : -1;
const focusPage = focusIndex >= 0
  ? Math.floor(focusIndex / safePageSize) + 1
  : null;
const pageIndex = focusPage ?? Math.min(safePage, totalPages);
```

The page slice uses `pageIndex`, so if focus is found, the returned images should be the page containing the focused asset:

```ts
const start = (pageIndex - 1) * safePageSize;
const images = sorted.slice(start, start + safePageSize);
```

This is the intended core mechanism for both buttons.

## Why These Features May Not Be Working

### 1. Show in gallery does not clear stale return state or namespace storage before navigation

`Show in namespace` currently clears gallery return state and writes the target namespace into localStorage.

`Show in gallery` does not.

That means `Show in gallery` navigates to:

```txt
/?gns=__all__&focus=<image-id>
```

but stale client state may still exist from the previous gallery session:

- `galleryReturnStateV1`
- `galleryReturnSnapshotV1`
- `imageNamespace`
- warm cache state inside `ImageGallery`
- stored gallery preferences, including current page and filters

The focus path attempts to ignore return state when `focus` is present, but namespace state and first-render timing can still matter.

### 2. Root page namespace is updated in an effect, after the gallery component is constructed

In [src/app/page.tsx](/Users/julian/Code/cloud-flare-image-handler/src/app/page.tsx), namespace starts as:

```ts
const [namespace, setNamespace] = useState<string>(envDefaultNamespace);
```

The URL namespace is applied later in `useEffect`.

For `/?gns=__all__&focus=<id>`, the first render may still pass `envDefaultNamespace` to `ImageGallery`, not `__all__`.

Inside `ImageGallery`, the focus target is accepted only if:

```ts
focusTarget.namespace === activeNamespace
```

If the gallery's first fetch occurs while `namespace` is still the default namespace, then:

- focus target namespace is `__all__`
- active namespace is something like `cf-default`
- `focusAssetId` is not sent to the API
- the API returns page 1 of the current namespace/default scope

After the root effect sets namespace to `__all__`, a second fetch may happen, but the initial state machine may already be on normal page-1 behavior.

This is a strong candidate reason for the observed behavior: "Show in gallery reverts to All namespaces and takes us to the latest images on the 1st page."

### 3. `ImageGallery` reads focus from `window.location.search` only into an initial ref

The focus target is stored here:

```ts
const initialFocusTargetRef = useRef(
  typeof window === 'undefined' ? null : parseCanonicalGalleryFocusFromSearch(window.location.search)
);
```

Because this is a ref initialized once, any navigation that changes the URL without a clean remount can leave the gallery using an old or missing focus target.

The root page currently uses:

```tsx
key={galleryInstanceKey}
```

where:

```ts
const galleryInstanceKey = search ? `gallery:${search}` : 'gallery';
```

That is meant to force remounts when the search string changes. But it also means correctness depends on the timing and stability of `useSearchParams().toString()` during navigation.

If the key does not change when expected, or if it changes before namespace has been derived from the URL, focus mode can be skipped or mis-scoped.

### 4. Focus canonicalization clears filters asynchronously

When a focus target exists, an effect clears filters:

```ts
clearFilters();
clearColorSearch();
```

This happens after render. Meanwhile, `fetchImages` may already have read `galleryServerQueryRef.current`, which was initialized from stored preferences:

```ts
const galleryServerQueryRef = useRef<GalleryServerQueryState>({
  page: storedPreferencesRef.current.currentPage ?? 1,
  pageSize: storedPreferencesRef.current.pageSize ?? DEFAULT_PAGE_SIZE,
  search: storedPreferencesRef.current.searchTerm ?? '',
  folder: storedPreferencesRef.current.selectedFolder ?? 'all',
  ...
});
```

The code tries to neutralize stored preferences when focus exists:

```ts
neutralizeFilters: Boolean(initialFocusTargetRef.current)
```

But if `initialFocusTargetRef.current` is missing or namespace-mismatched during initial setup, the gallery may fetch with stored filters/page state instead of the neutral focus state.

### 5. Client page state and server returned page can disagree

The server returns the focused page in `pagination.page`.

The client also has local `currentPage`/`pageIndex` state from `useGalleryFilters`.

The focus reveal effect checks:

```ts
const targetPage = serverFocus.page;
if (pageIndex !== targetPage) {
  goToPageNumber(targetPage);
  return;
}
```

This can cause a second state update/fetch cycle. If that cycle drops `focusAssetId` or uses a changed query state, the UI can fall back to a normal page view.

### 6. `Show in gallery` and `Show in namespace` are not symmetric

Currently, `Show in namespace` does extra state cleanup:

```ts
clearGalleryReturnState();
clearGalleryReturnSnapshot();
window.localStorage.setItem(GALLERY_NAMESPACE_STORAGE_KEY, targetNamespace);
```

`Show in gallery` only navigates:

```ts
router.push(buildCanonicalGalleryHref({ assetId: id, namespace: '__all__' }))
```

This asymmetry means `Show in gallery` is more exposed to stale return state, stale namespace storage, and timing issues than `Show in namespace`.

Even if `gns=__all__` is present in the URL, the app's storage and initial render path may still make the gallery behave like a normal namespace switch rather than a focused placement.

## Summary Of Expected Code Flow

The ideal flow for both buttons is:

1. Detail page builds canonical gallery URL:
   - `Show in gallery`: `/?gns=__all__&focus=<image-id>`
   - `Show in namespace`: `/?gns=<image-namespace>&focus=<image-id>`
2. Root page derives initial namespace synchronously from `gns`.
3. Root page passes that namespace into `ImageGallery`.
4. `ImageGallery` parses `focus`.
5. `ImageGallery` clears/ignores stored filters and return snapshots for focus mode.
6. `ImageGallery` calls `/api/images?namespace=<scope>&focus=<image-id>&page=<page>&pageSize=<size>`.
7. API filters to the requested namespace scope.
8. `queryGalleryAssets` sorts by uploaded time descending.
9. `queryGalleryAssets` calculates the page containing the focused asset.
10. API returns that page and focus metadata.
11. `ImageGallery` renders that returned page.
12. `ImageGallery` scrolls/highlights the focused asset.

The observed failures suggest the flow is breaking before or during steps 2-6, not in the server's focused page calculation.

