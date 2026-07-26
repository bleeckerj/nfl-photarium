# Photarium Client Sites

`photarium-client-sites` is an adjacent Cloudflare Worker application for temporary client-facing image selection sites.

This repository is intentionally isolated from the main Photarium app:

- no direct imports from Photarium
- no shared internal module paths
- integration only through versioned semantic contracts

## Boundaries

- Photarium remains the internal DAM and curator
- this app owns public delivery, access control, shortlist capture, and project lifecycle

## Development

```bash
npm install
npm run types:worker
cp .dev.vars.example .dev.vars
npm run types:worker
npm run build
npm run test
npm run dev
npm run demo
```

`wrangler dev` expects `.dev.vars` for local-only secrets. In explicit local dev mode,
localhost admin publish routes can run without a configured publish secret.

`npm run dev` starts a managed local worker on the first free port starting at `8788` and writes runtime metadata under `.wrangler/`.

`npm run demo` reuses that worker when available, otherwise starts it, then creates a fresh local published project and prints the secret-link URL for inspection.

`npm run seed:demo` remains available as a low-level helper when you already know the local worker origin.

`npm run stop` stops the managed local worker and clears stale runtime metadata.

## Core Modules

- `src/worker/publishing-contract`: versioned manifest schemas and types
- `src/worker/projects`: project storage and lifecycle
- `src/worker/assets`: published asset snapshots
- `src/worker/access`: secret-link validation and session cookies
- `src/worker/delivery`: view/download policy enforcement
- `src/worker/shortlists`: shortlist capture
- `src/client`: public SPA shell

## Gallery Video Controls

Gallery cards keep the video badge and overlay controls in the media frame while a replaceable media slot handles image and inline-video content. Starting or stopping inline playback updates the card's Play/Stop state; the slot's Pause/Play control follows native video `play` and `pause` events and is hidden when inline playback stops.

Playback-state cleanup removes the video listeners and hides the pause control before the media slot is reused or the card is discarded. The behavior is covered by `test/gallery.playback-state.test.ts`.

## Deployment

This app is designed for Cloudflare Workers with:

- static assets binding
- D1 for project and shortlist storage
- Vectorize for project-scoped similarity

Set secrets before deployment:

- `CLIENT_SITES_PUBLISH_SECRET`
- `ACCESS_LINK_HASH_SECRET`
- `SESSION_SIGNING_SECRET`
- `IMAGES_ACCOUNT_HASH`
- optional `IMAGES_SIGNING_KEY`
