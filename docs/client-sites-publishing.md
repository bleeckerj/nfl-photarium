# Client Sites Publishing

Photarium now includes a minimal semantic publishing surface for the adjacent `photarium-client-sites` Worker app.

## Endpoints

### `POST /api/client-sites/manifest`

Builds a versioned `PublishedProjectManifest` from explicit Photarium image ids.

Expected payload:

```json
{
  "project": {
    "id": "remote-project-id",
    "publicSlug": "opaque-public-slug",
    "title": "Client Review",
    "status": "published",
    "expiresAt": "2026-05-01T00:00:00.000Z",
    "sourceNamespaces": ["campaign-a"]
  },
  "selection": {
    "imageIds": ["img-1", "img-2"]
  }
}
```

### `POST /api/client-sites/publish`

Creates a remote client-site project when needed, builds a manifest, and publishes it to the adjacent Worker app.

Expected payload:

```json
{
  "targetBaseUrl": "https://photos.example.com",
  "publishSecret": "shared-publish-secret",
  "project": {
    "title": "Client Review",
    "expiresAt": "2026-05-01T00:00:00.000Z",
    "sourceNamespaces": ["campaign-a"]
  },
  "selection": {
    "imageIds": ["img-1", "img-2"]
  }
}
```

For local development targets such as `http://127.0.0.1:8788`, the publish secret
can be omitted. The adjacent worker allows localhost admin publish calls when
`LOCAL_DEV_MODE=true`.

## Design Notes

- Photarium does not import or depend on the adjacent app's source code.
- Publishing is contract-based and HTTP-only.
- Public asset ids are derived deterministically from the remote project slug and the source image id, so re-publish operations remain stable.
