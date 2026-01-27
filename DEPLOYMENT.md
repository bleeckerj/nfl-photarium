# Deployment Guide

## ⚠️ Critical Security Warning

**Before deploying to a public URL:**

Photarium is currently designed for **trusted environments**. The API route `/api/upload/external` accepts image uploads without authentication. 

If you deploy to Vercel or any public-facing URL, you **must**:
1. Add authentication middleware (e.g., Vercel Authentication, Clerk, or basic HTTP auth).
2. Or use Cloudflare Access / Zero Trust to put the entire application behind a login.

---

## Vercel Deployment

Vercel is the recommended host for the Next.js application, but because Vercel is a serverless platform, it **cannot** run the Docker container for Redis. You essentially split the stack:

1. **Frontend/API**: Runs on Vercel.
2. **Database**: Runs on a managed Redis provider (that supports Redis Stack).

### 1. Redis Strategy

This application requires **Redis Stack** features if you are using the various embeddings (color and semantic search, etc) (specifically `RediSearch` and `RedisJSON`) for vector search functionality. **Standard Redis will not work.**

#### Recommended: Redis Cloud (Managed)
1. Sign up for [Redis Cloud](https://redis.com/try-free/).
2. Create a new subscription/database.
3. Ensure you select a configuration that supports **Redis Stack** (most new databases there do by default, or look for "Search" and "JSON" modules).
4. Get your public endpoint (e.g., `redis-12345.c1.us-central1-2.gce.cloud.redislabs.com:12345`).
5. Get your password.

#### Alternative: Self-Hosted on VPS
You can run the `docker-compose.yml` stack on a standard VPS (DigitalOcean, EC2, Hetzner, etc.).
1. Provision a VPS with Docker installed.
2. Run `docker compose up -d`.
3. Expose port `6379` (securely! use a firewall/VPN).
4. Use that IP as your `REDIS_URL`.

### 2. Vercel Project Setup

1. **Push your code** to a GitHub repository.
2. **Import the project** in Vercel.
3. **Configure Environment Variables** in the Vercel dashboard:

| Variable | Description |
|----------|-------------|
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare Account ID |
| `CLOUDFLARE_API_TOKEN` | Token with rights to edit Images |
| `NEXT_PUBLIC_CLOUDFLARE_ACCOUNT_HASH` | Your Cloudflare Account Hash |
| `CACHE_STORAGE_TYPE` | Set to `redis` |
| `REDIS_URL` | Check format below |

#### Redis URL Format
For Redis Cloud or authenticated instances, ensure the URL includes the password:
```
redis://default:<password>@<host>:<port>
```
Example:
```
redis://default:TopSecretPass123@redis-12345.c1.us-central1-2.gce.cloud.redislabs.com:10001
```

### 3. Build & Deploy

Vercel will detect the Next.js framework automatically.
- **Build Command**: `next build` (default)
- **Install Command**: `npm install` (default)

### 4. Post-Deployment Setup

Once deployed, your new Redis instance will be empty. You need to initialize the vector, index and sync existing images.

You can run these scripts locally (connecting to your **remote** Redis):
1. Update your local `.env.local` to point `REDIS_URL` to your **production** Redis instance temporarily.
2. Run the namespace scan to populate the database:
   ```bash
   npm run namespace:scan
   ```
3. Generate embeddings (if using remote inference or local python script pointing to remote redis):
   *Note: Generating embeddings often requires the Python script `scripts/clip_embed.py` or the JS backfill script. Running this against a remote Redis from your local machine is the easiest path.*

---

## Docker Deployment (Alternative)

If you prefer to deploy the entire stack (App + Redis) in one place (e.g., Railway, Fly.io, or a VPS with Coolify), you can use the `docker-compose.yml`.

1. You may need to create a `Dockerfile` for the Next.js app to run it alongside Redis in a production container setup.
2. The current `docker-compose.yml` only defines Redis (expecting the app to run locally via `npm run dev`). You would need to add the `app` service to `docker-compose.yml`.

---

## Cloudflare Deployment

> **❌ NOT RECOMMENDED for this codebase**

While you can deploy Next.js apps to Cloudflare Pages (via `next-on-pages`), this specific application forces **Node.js dependencies** that are incompatible with the Cloudflare Edge Runtime.

### Critical Limitations
1.  **No `sharp` Support**: The app uses the `sharp` library for:
    - Extracting dominant colors (`src/server/colorExtraction.ts`)
    - Rotating images (`src/server/uploadService.ts`)
    - Reading EXIF data
    *Cloudflare Workers cannot run native binaries like libvips (which sharp relies on).*
2.  **No `puppeteer` Support**: The "Scroll Import" feature uses Puppeteer, which includes a full Chromium binary. This is too large and unsupported on Cloudflare Workers.

### If you MUST use Cloudflare...
You would need to:
1.  **Disable/Remove Features**: Rip out color extraction, local image rotation, and scroll importing.
2.  **Managed Redis Stack**: As with Vercel, you cannot host Redis on Cloudflare.
    *   **Upstash** (The common Cloudflare Redis partner) does **NOT** support the RediSearch (`FT.SEARCH`) commands this app relies on.
    *   **Solution**: You must use **Redis Cloud** (Redis Inc.) as it is the only managed provider that offers full Redis Stack compatibility needed for the vector search.

---

## Simplified Deployment (No Redis)

If you do not need **Vector Search** (finding images by "blue sky" or "similar colors"), you can deploy the application without Redis entirely.

### Trade-offs
- **✅ Easier Deployment**: No need to manage a Redis database.
- **❌ Lose Semantic Search**: The "Search" tab/bar will return an error if used.
- **❌ Lose Color Search**: "Find by color" will not work.
- **✅ Base Features Work**: Uploading, tagging, folder management, and gallery browsing still work perfectly using the built-in file-based cache.

### How to Configure
Simply **omit** the Redis environment variables in your Vercel (or other) configuration.

1.  **Do NOT set** `CACHE_STORAGE_TYPE`. It defaults to `file`.
2.  **Do NOT set** `REDIS_URL`.

The application will automatically fallback to storing metadata in a local `.cache/` folder (which may be ephemeral on Vercel, meaning metadata is refreshed from Cloudflare more often) and disable the vector search API endpoints safely.
