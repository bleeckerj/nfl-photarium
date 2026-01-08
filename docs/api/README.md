# Cloudflare Image Management API

This API powers both the internal gallery UI and any external automation via HTTP requests. It wraps Cloudflare Images with local metadata (folders, tags, descriptions, canonical variants, etc.). This document focuses on searching assets and retrieving URLs at multiple sizes.

## Authentication

All `/api/*` routes live within the Next.js app. If you expose it externally, protect requests the same way you secured `/api/upload/external` (e.g., proxy with API keys or Basic Auth). The endpoints described here do not ship with auth baked in.

## Search images

```
GET /api/images?search=<query>&folder=<folder>&tag=<tag>&onlyCanonical=true
```

Parameters:

| Param            | Type    | Description                                                                 |
|------------------|---------|-----------------------------------------------------------------------------|
| `search`         | string  | Free text. Matches filename, folder, alt text, tags, original/source URLs, variants |
| `folder`         | string  | Exact folder name. Use `all` for everything, `no-folder` for unfiled items  |
| `tag`            | string  | Exact tag                                                                  |
| `onlyCanonical`  | boolean | `true` to only return parent (non-variant) images                          |
| `namespace`      | string  | Optional namespace filter (defaults to `IMAGE_NAMESPACE`)                  |


Response:

```jsonc
{
  "images": [
    {
      "id": "58f27351-...-f498",
      "filename": "ghostwriter-selectric-screen.jpg",
      "uploaded": "2025-12-05T21:59:41.036Z",
      "folder": "static-assets-2025",
      "tags": ["ghostwriter", "case-study"],
      "description": "Short blurb…",
      "originalUrl": "/images/projects/2025/ghostwriter/…",
      "sourceUrl": "https://example.com/projects/ghostwriter",
      "namespace": "app-a",
      "altTag": "Two typewriter screens…",
      "parentId": null,
      "linkedAssetId": "…",
      "variants": [
        "https://imagedelivery.net/<hash>/<id>/public",
        "https://imagedelivery.net/<hash>/<id>/w=300?format=webp",
        "https://imagedelivery.net/<hash>/<id>/w=600?format=webp",
        "https://imagedelivery.net/<hash>/<id>/w=900?format=webp",
        "https://imagedelivery.net/<hash>/<id>/w=1200?format=webp",
        "https://imagedelivery.net/<hash>/<id>/w=150?format=webp"
      ]
    }
  ],
  "cache": { "lastFetched": 1733438400000, "ttlMs": 300000 }
}
```

Notes:
- The API already stores URLs for every Cloudflare variant. By default most entries have the `public` (original) plus `small/medium/large/xlarge/thumbnail` transforms.
- Variants are the raw Cloudflare URLs, so they are immediately usable in the browser or CDN.
- The `cache` block is informational (server-side metadata cache stats).

### Example query

Fetch every “ghostwriter” asset in the `static-assets-2025` folder:

```sh
curl "https://your-host/api/images?search=ghostwriter&folder=static-assets-2025"
```

### Paginated search (custom endpoint)

If you need deterministic pagination beyond the default `GET /api/images`, use the new `GET /api/uploads` endpoint added for the hash-cache. It accepts `page`, `pageSize`, and `folder`, returns every upload with the canonical Cloudflare URL, size, and metadata. Combine it with client-side filtering for large catalogs.

```
GET /api/uploads?page=1&pageSize=100&folder=static-assets-2025
```

The response includes:

```jsonc
{
  "page": 1,
  "pageSize": 100,
  "hasMore": true,
  "uploads": [
    {
      "uploadId": "58f27351-...-f498",
      "cloudflareUrl": "https://imagedelivery.net/…/public",
      "folder": "static-assets-2025",
      "filename": "ghostwriter-selectric-screen.jpg",
      "originalUrl": "/images/projects/…",
      "bytes": 533654,
      "contentHash": "sha256:abc123…",
      "createdAt": "2025-12-05T21:59:41.036Z"
    }
  ]
}
```

Use `/api/uploads/:uploadId/download` if you need a binary stream to compute your own hash.

## Rendering multiple sizes

On the client, prefer the existing helper `getMultipleImageUrls(image.id, ['small','medium','large','original'])` from `src/utils/imageUtils.ts`. When consuming the API externally, you already receive direct variant URLs, so no additional transform is required.

## Future enhancements

- If you need broader query filters (e.g., multiple tags, date ranges), consider adding query params in `/api/images` and reuse the `filterImagesForGallery` utility.
- For authenticated external access, create a thin proxy route that enforces API keys before hitting `/api/images`.
