# Redis VPS Migration Plan

This plan moves Photarium's Redis database from the local Docker container to a cloud-hosted primary Redis instance, while keeping local backups and a local rollback path.

The preferred target is a DigitalOcean VPS running the same Redis Stack Docker image used locally. Redis Cloud remains a valid managed alternative, but the main advantage of Redis Cloud is operations management, not application compatibility.

## Current Redis Shape

Sizing snapshot captured during the May 2026 planning pass:

| Metric | Current value |
|--------|---------------|
| Redis container | `photarium-redis` |
| Docker image | `redis/redis-stack:latest` |
| Total Redis keys | 74,924 |
| Redis logical memory, `used_memory` | 483.5 MB |
| Redis peak memory | 1.49 GB |
| Live Docker memory use | 1.71 GiB |
| Redis data directory | 565 MB |
| `dump.rdb` | 165 MB |
| AOF artifacts | About 386 MB |
| Backup bundle size | About 281-282 MB |

Key distribution:

| Prefix | Keys |
|--------|------|
| `image:*` | 40,476 |
| `photarium:extras:*` | 27,833 |
| `workflow_intent:*` | 4,648 |
| `photarium:cache:*` | 1,464 |
| `collision:signal:*` | 503 |

Search indexes:

| Index | Docs | Vector footprint |
|-------|------|------------------|
| `idx:images` | 40,476 | About 93 MB |
| `idx:workflow_intent` | 4,648 | About 10 MB |
| `signal_embeddings` | 503 | About 6 MB |

Redis Stack modules currently present include Search, JSON, Bloom, TimeSeries, RedisGears, and RedisCompat. This matters because the app uses RediSearch/vector commands and should not be moved to a generic Redis-compatible cache unless semantic/color search is intentionally disabled.

## Hosting Decision

### Recommended: DigitalOcean VPS with Docker

Use a DigitalOcean Droplet and run Redis Stack in Docker. This keeps the runtime close to local development:

- Same Redis Stack distribution.
- Same RediSearch/vector behavior.
- Same RDB/AOF persistence format.
- Same Docker backup and restore mental model.
- Lowest migration risk from a platform-compatibility perspective.

Recommended Droplet size:

| Droplet | Base cost | With weekly backups | With daily backups | Judgment |
|---------|-----------|---------------------|--------------------|----------|
| 2 GB / 1 vCPU / 50 GB | $12/mo | $14.40/mo | $15.60/mo | Bare minimum, tight memory |
| 2 GB / 2 vCPU / 60 GB | $18/mo | $21.60/mo | $23.40/mo | Better CPU, still tight memory |
| 4 GB / 2 vCPU / 80 GB | $24/mo | $28.80/mo | $31.20/mo | Recommended |
| 8 GB / 4 vCPU / 160 GB | $48/mo | $57.60/mo | $62.40/mo | Growth tier |

Choose the 4 GB Droplet unless cost is the overriding concern. The current container already uses about 1.71 GiB RSS, and Redis persistence work such as AOF rewrite and BGSAVE needs temporary memory headroom.

### Alternative: Redis Cloud

Redis Cloud is useful when managed operations are worth more than container portability:

- Provider-managed patching and upgrades.
- Provider-managed backups and persistence.
- HA/failover options on paid plans.
- Built-in monitoring and alerts.
- TLS/auth handled as a managed product feature.

Redis Cloud's 250 MB Essentials tier is too small for the current database. A 1 GB plan is the minimum viable size, and a 2.5 GB plan is the safer sizing target. Current public pricing confirms Essentials starts at $5/mo and Pro starts at $200/mo, but exact 1 GB and 2.5 GB Essentials prices should be checked in the Redis Cloud pricing flow before choosing.

Redis Cloud is a different platform than the local container. It is likely compatible with Redis Stack workloads, but it is not the exact same runtime. Validate `FT.CREATE`, `FT.SEARCH`, vector search, `MODULE LIST` behavior, import/restore behavior, and app health before committing.

### Not Recommended: Generic Managed Redis or Valkey

Avoid generic Redis-compatible cache offerings for this app unless vector search is no longer required. Photarium stores CLIP embeddings, color histograms, workflow intent embeddings, and Redis search indexes. Compatibility must include the RediSearch/vector command surface, not only basic Redis keys.

## Target VPS Architecture

Run Redis as the only critical service on the Droplet.

Recommended filesystem layout:

```text
/opt/photarium/
  docker-compose.yml
  backups/
    redis/
  redis-data/
```

Recommended Compose shape:

```yaml
services:
  redis:
    image: redis/redis-stack:latest
    container_name: photarium-redis
    ports:
      - "127.0.0.1:6379:6379"
      - "127.0.0.1:8001:8001"
    volumes:
      - /opt/photarium/redis-data:/data
    environment:
      - REDIS_ARGS=--appendonly yes
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped
```

For the first migration, keep `redis/redis-stack:latest` to match local behavior. After the move is stable, pin a specific Redis Stack tag or digest so future restarts do not silently upgrade Redis.

Do not expose `6379` or `8001` publicly. Use one of:

- SSH tunnel from the local machine to the VPS.
- Tailscale or another private network.
- Cloud firewall rules that allow Redis only from trusted private addresses.

If the Next.js app continues running locally, an SSH tunnel keeps the app configuration simple:

```bash
ssh -N -L 6379:127.0.0.1:6379 photarium-redis
```

Then local `.env.local` can keep:

```dotenv
CACHE_STORAGE_TYPE=redis
EXTRAS_STORAGE_TYPE=redis
REDIS_URL=redis://localhost:6379
```

If connecting directly over a private network instead of a tunnel, store the private Redis URL in `.env.local`. Do not put Redis credentials in client-side code, public environment variables, shell history, screenshots, or logs.

## Migration Procedure

1. Stop app writes before the final backup.

   Pause ingestion jobs, import scripts, background listeners, and any local app process that can write to Redis.

2. Capture a fresh local backup.

   ```bash
   ./scripts/backup-redis.sh --dir=/Users/julian/Backups/photarium-redis --keep=20
   ```

   The existing local backup set was stale during planning, so do not migrate from an old backup unless that is intentional.

3. Record baseline health.

   ```bash
   docker exec photarium-redis redis-cli INFO memory
   docker exec photarium-redis redis-cli INFO persistence
   docker exec photarium-redis redis-cli DBSIZE
   docker exec photarium-redis redis-cli FT._LIST
   ```

4. Provision the Droplet.

   Install Docker, create `/opt/photarium/redis-data`, create `/opt/photarium/backups/redis`, and start the Redis Stack Compose service.

5. Copy the backup to the VPS.

   ```bash
   rsync -avz /Users/julian/Backups/photarium-redis/redis-backup-YYYYMMDD-HHMMSS.tgz photarium-redis:/opt/photarium/backups/redis/
   ```

6. Restore into the VPS container.

   Stop Redis first, extract the backup bundle, copy `dump.rdb` and any AOF artifacts into `/opt/photarium/redis-data`, then start Redis.

   If the migration backup was taken after writes were paused, restoring only `dump.rdb` is acceptable and avoids carrying over stale AOF state. Redis will create new AOF files after startup because append-only persistence is enabled.

7. Verify the VPS Redis instance.

   ```bash
   docker exec photarium-redis redis-cli PING
   docker exec photarium-redis redis-cli DBSIZE
   docker exec photarium-redis redis-cli FT._LIST
   docker exec photarium-redis redis-cli INFO memory
   docker exec photarium-redis redis-cli INFO persistence
   ```

8. Point the app at the cloud Redis instance.

   Update `.env.local` through the approved local configuration mechanism. Do not use inline environment overrides for normal app runs.

9. Start the app and verify user-facing behavior.

   Check:

   - `/api/images/vectors/status`
   - Gallery load
   - Image detail page metadata
   - Semantic search
   - Color search
   - Workflow intent search, if used

10. Keep local Redis as rollback for at least one week.

    Do not delete the local Docker volume immediately. If remote Redis fails, stop the app, point `.env.local` back to local Redis, start local Redis, and restart the app.

## Local Backup Routine After Migration

The cloud Redis instance becomes primary. The local machine becomes a backup sink.

If the repo and `scripts/backup-redis.sh` are present on the VPS:

```bash
ssh photarium-redis 'cd /opt/photarium && ./scripts/backup-redis.sh --dir=/opt/photarium/backups/redis --keep=20'
rsync -avz photarium-redis:/opt/photarium/backups/redis/ /Users/julian/Backups/photarium-redis-cloud/
```

Run this manually:

- Before large cleanup or reassignment scripts.
- After large imports or embedding backfills.
- Weekly if the catalog changes regularly.
- Monthly if the catalog is mostly stable.

Keep at least:

- Provider-level Droplet backups or snapshots.
- Local pulled Redis backup bundles.
- One additional off-machine copy, such as external disk, NAS, or object storage.

## Re-Sizing Checks

Re-run these before resizing or changing providers:

```bash
docker exec photarium-redis redis-cli INFO memory
docker exec photarium-redis redis-cli MEMORY STATS
docker exec photarium-redis redis-cli DBSIZE
docker exec photarium-redis redis-cli FT.INFO idx:images
docker exec photarium-redis redis-cli FT.INFO idx:workflow_intent
docker exec photarium-redis redis-cli FT.INFO signal_embeddings
docker stats --no-stream photarium-redis
```

Upgrade from the 4 GB Droplet when either of these becomes true:

- Docker memory use is consistently above 3 GiB.
- Redis `used_memory_peak` exceeds 2.5 GiB.
- AOF rewrites or backups cause memory pressure.
- Search/indexing feels slow during normal use.

## Sources

- DigitalOcean Droplet pricing: https://www.digitalocean.com/pricing/droplets
- DigitalOcean backup pricing: https://www.digitalocean.com/pricing/backups
- Redis Cloud pricing: https://redis.io/pricing/
- Redis Cloud Essentials plans: https://redis.io/docs/latest/operate/rc/subscriptions/view-essentials-subscription/essentials-plan-details/
- Redis backup guide: ./redis-backup.md
