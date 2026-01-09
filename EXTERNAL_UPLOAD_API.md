## External Upload API

You can push images into this service from other local tools (Astro, scripts, etc.) via the new endpoint:

- **Endpoint**: `POST http://localhost:3000/api/upload/external`
- **Configuration**: Set `DISABLE_EXTERNAL_API=true` in `.env` to completely disable this endpoint.
- **CORS**: Open to any origin (handy for local multi-port setups)
- **Content-Type**: `multipart/form-data`

| Field | Required | Notes |
| --- | --- | --- |
| `file` | ✅ | Binary image file (max 10 MB, must be `image/*`). |
| `folder` | ❌ | Optional folder name (e.g., `astro-uploads`). |
| `tags` | ❌ | Comma-separated list (`landing, hero`). |
| `description` | ❌ | Brief text description. |
| `originalUrl` | ❌ | Reference URL of the asset (used for duplicate detection). |
| `sourceUrl` | ❌ | Page or site where the asset was found. |
| `namespace` | ❌ | Optional namespace override (defaults to `IMAGE_NAMESPACE`). |
| `parentId` | ❌ | Cloudflare image ID to treat this upload as a variant of. |

**Sample response**

```json
{
   "id": "abc123",
   "filename": "photo.png",
   "url": "https://imagedelivery.net/<hash>/abc123/public",
   "variants": ["…/public", "…/thumbnail"],
   "uploaded": "2025-11-28T17:05:12.345Z",
   "folder": "astro-uploads",
   "tags": ["astro", "cloudflare"],
   "description": "Hero image",
   "sourceUrl": "https://example.com/page",
   "namespace": "app-a",
   "parentId": "parent-image-id"
}
```

**cURL example**

```bash
curl -X POST http://localhost:3000/api/upload/external \
   -F "file=@./photo.png" \
   -F "folder=astro-uploads" \
   -F "tags=astro,cloudflare"
```

### Uploading via a remote URL

If your external process only knows the image’s URL, you can reuse the same flow that the UI relies on: call `POST /api/import` with `{ "url": "https://…" }`, let the server download the asset, and return a base64 blob plus `name`, `type`, and `originalUrl`. Once you have that payload, convert the base64 data back into bytes (e.g., `Buffer.from(data, "base64")` in Node or a `Blob` in the browser), wrap it in a `File`/`Blob`, and append it to `FormData` before POSTing to `/api/upload/external`. Include any optional metadata (`folder`, `tags`, `description`, `originalUrl`, `parentId`, etc.) in the same `FormData` so Cloudflare’s metadata is populated.

**Example (Node script)**

```js
import fetch from "node-fetch";
import FormData from "form-data";

const importResponse = await fetch("http://localhost:3000/api/import", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ url: "https://example.com/hero.jpg" }),
});
const importData = await importResponse.json();
const buffer = Buffer.from(importData.data, "base64");

const formData = new FormData();
formData.append("file", buffer, {
  filename: importData.name,
  contentType: importData.type,
});
formData.append("folder", "astro-uploads");
formData.append("originalUrl", importData.originalUrl);
formData.append("sourceUrl", "https://example.com/page");
formData.append("namespace", "app-a");

const uploadResponse = await fetch("http://localhost:3000/api/upload/external", {
  method: "POST",
  body: formData,
});
const result = await uploadResponse.json();
console.log("Cloudflare URL:", result.url);
```

The API response includes `url` (permanent Cloudflare delivery) and a `variants` array, so once the POST succeeds you immediately know which CDN link to use.

### Parent + variant relationships

Variants are ordinary Cloudflare images whose metadata includes a `variationParentId`. You can set that relationship in two ways:

- **On upload**: include `parentId` in the `multipart/form-data` POST to `/api/upload/external`.
- **After upload**: patch an existing image with `parentId` via `PATCH /api/images/{id}/update`.

There is no app-level cap on how many variants a parent can have; the link is just a metadata field stored on each variant. The parent does not maintain a reverse list, so to find variants you filter images where `parentId` matches your chosen parent ID (e.g., by client-side filtering of `/api/images` results).

**Example (assign a parent after upload)**

```js
await fetch(`/api/images/${variantId}/update`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ parentId: parentImageId })
});
```

`POST /api/import` now tolerates responses whose `Content-Type` isn’t `image/*` as long as the URL path ends with a known image extension (`.jpg`, `.png`, `.webp`, etc.). The route infers the MIME from the extension and proceeds, so S3 links that stream `application/octet-stream` often upload without extra work. If the source URL lacks an image-like header or extension, download the bytes yourself, tag them with the desired MIME, and post directly to `/api/upload/external` so the upload still treats the blob as an image.

### Rotating stored images

If an asset looks sideways because of EXIF metadata, rotate it server-side via `POST /api/images/{id}/rotate`. The endpoint downloads the chosen Cloudflare variant, runs it through `sharp().rotate()` (or `rotate(degrees)` when you pass `direction: "left"` or `"right"`), re-uploads the corrected bytes with the original metadata, and returns the new Cloudflare delivery URL/variants plus `rotatedFromId` so you can track the replacement.

**Request body**

```json
{
  "direction": "right"
}
```

- `direction` can be `"left"` or `"right"` to rotate a specific 90° step.  
- Omitting `direction` (or sending `{ "auto": true }`) simply honors the EXIF orientation flag.

**Sample fetch**

```js
const response = await fetch(`/api/images/${imageId}/rotate`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ direction: 'right' })
});
const body = await response.json();
console.log('New Cloudflare URL', body.url);
```

The response also includes `message` advising that a new Cloudflare URL was created; update any persisted references, and consider showing a persistent toast warning that the old delivery URL must be replaced.

### Error details for 400 responses

When `/api/upload/external` returns 400, the body is still JSON and includes an `error` string that explains what validation failed (e.g., `"No file provided"`, `"File must be an image"`, `"File size must be less than 10MB"`). For duplicate filenames you also get a `duplicates` array with summaries of the existing assets so you can surface (“Duplicate filename detected…”) or skip retries. Always parse the JSON body instead of relying on the status text so you see the actionable message.

```json
{
  "error": "Duplicate filename \"hero.png\" detected",
  "duplicates": [
    { "id": "xyz", "filename": "hero.png", "folder": "website-images" }
  ]
}
```

If you are routing the call through another client or proxy, log or display the `error` field from the response before retrying so you know exactly why the upload was rejected.
