# Architecture

## Intent

This app provides temporary public-facing project sites that expose a curated subset of Photarium assets without exposing Photarium itself.

## Runtime

- Worker routes own access control and API responses
- static assets binding serves the SPA shell
- D1 stores project snapshots and shortlist submissions
- Vectorize is reserved for project-scoped similarity and clustering

## Design Rules

- one file, one reason to change
- no god routes, god services, or generic dumping-ground utilities
- public contracts are validated at the edge
- lifecycle policy is centralized, not duplicated in handlers

## Integration

The only supported integration boundary is the publishing contract:

- `PublishedProjectManifest`
- `PublishedProjectDelta`
- `ProjectStatusChange`
- `ClientShortlistSubmission`

