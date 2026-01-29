# Photarium FAQ

## Why do some images not show up in semantic search for certain keywords?

Photarium uses two different search systems:

- **Semantic search** (the search bar with "semantic" or "CLIP" mode):
  - Uses OpenAI CLIP embeddings to find images that are conceptually similar to your query.
  - CLIP encodes the *entire scene* (objects, style, context, mood) into a vector.
  - A query like "dog" will find images that look like typical dogs, but a painting of dogs playing poker may not rank highly unless you search for "dogs playing poker" or something more specific.
  - This is because CLIP considers all aspects of the image, not just the presence of a single object.

- **Text filter** (the gallery filter bar):
  - Searches literal text fields: filename, tags, description, alt text, Prompt This, etc.
  - Finds images where the word appears in metadata, regardless of visual content.

**Tip:** Use semantic search for "find images like this concept" and text filter for "find images where someone wrote this word".

---

## How do I set up Redis for Photarium?

Photarium requires Redis Stack for vector search and extras storage. To set up Redis:

1. **Install Docker Desktop** (if not already installed)
2. **Start Redis Stack** using Docker Compose:

   ```sh
   docker compose up -d
   ```
   (This uses the `docker-compose.yml` in the repo, which sets up Redis Stack with persistence enabled.)

3. **Check Redis is running:**
   ```sh
   docker compose ps
   ```
   You should see a `redis` service listed as running.

4. **Backups:**
   - Use the provided `scripts/backup-redis.sh` to create backups (includes both RDB and AOF files).
   - See `docs/redis-backup.md` for details.

---

## What are namespaces and how do I use them?

Namespaces let you organize images into logical groups (e.g., by project, client, or source).

- Each image has a `namespace` field in its metadata.
- The gallery and API support filtering by namespace (e.g., `/?gns=my-namespace`).
- Namespaces are especially useful for large installations or multi-tenant setups.
- You can view, create, and manage namespaces via the UI or API.

**Tip:** Use namespaces to keep unrelated image sets separate and to speed up search/filtering.

---

For more, see the main README and the `docs/` folder.
