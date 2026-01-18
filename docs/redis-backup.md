# Redis Backup & Restore

This guide covers backing up and restoring the Redis database that stores CLIP and color embeddings for Photarium's semantic search features.

## Overview

Photarium uses Redis Stack with RediSearch for vector similarity search. The embeddings are computationally expensive to generate (~5-10 seconds per image), so regular backups are essential.

**What's stored in Redis:**
- CLIP embeddings (512-dimensional vectors)
- Color embeddings (dominant colors, average color)
- Vector search indexes

## Quick Start

```bash
# Run a backup now
./scripts/backup-redis.sh

# Check your backups
ls -la ./backups/redis/
```

## Backup Script

### Location

```
scripts/backup-redis.sh
```

### Usage

```bash
./scripts/backup-redis.sh [options]
```

### Options

| Option | Default | Description |
|--------|---------|-------------|
| `--dir=<path>` | `./backups/redis` | Directory to store backups |
| `--keep=<n>` | `10` | Number of backups to retain |
| `--container=<name>` | `photarium-redis` | Docker container name |
| `--quiet` | off | Suppress output (for cron jobs) |
| `--dry-run` | off | Show what would happen without doing it |

### Examples

```bash
# Basic backup with default settings
./scripts/backup-redis.sh

# Keep only last 5 backups
./scripts/backup-redis.sh --keep=5

# Backup to custom directory
./scripts/backup-redis.sh --dir=/Volumes/Backup/redis

# Dry run to see what would happen
./scripts/backup-redis.sh --dry-run

# Quiet mode for automated scripts
./scripts/backup-redis.sh --quiet
```

### Output

```
═══════════════════════════════════════════════════════
Redis Backup
═══════════════════════════════════════════════════════
Container:   photarium-redis
Backup dir:  ./backups/redis
Backup file: redis-backup-20260117-230436.rdb
Keep count:  10
───────────────────────────────────────────────────────

Step 1: Triggering Redis BGSAVE...
         Waiting for save to complete...
         Last save: 1768719876

Step 2: Copying dump.rdb from container...
         Created: ./backups/redis/redis-backup-20260117-230436.rdb (5.0M)

Step 3: Rotating old backups (keeping last 10)...
         1 backups found, no rotation needed

───────────────────────────────────────────────────────
Current backups:
  -rw-r--r--  1 julian  staff  5.0M Jan 17 23:04 redis-backup-20260117-230436.rdb

✓ Backup complete!
═══════════════════════════════════════════════════════
```

## Scheduled Backups

### Using Cron (macOS/Linux)

```bash
# Edit your crontab
crontab -e

# Add one of these lines:

# Every 6 hours
0 */6 * * * cd /Users/julian/Code/cloud-flare-image-handler && ./scripts/backup-redis.sh --quiet

# Daily at 2:00 AM
0 2 * * * cd /Users/julian/Code/cloud-flare-image-handler && ./scripts/backup-redis.sh --quiet

# Every 12 hours
0 */12 * * * cd /Users/julian/Code/cloud-flare-image-handler && ./scripts/backup-redis.sh --quiet

# Weekly on Sunday at 3:00 AM
0 3 * * 0 cd /Users/julian/Code/cloud-flare-image-handler && ./scripts/backup-redis.sh --quiet
```

### Using launchd (macOS)

Create `~/Library/LaunchAgents/com.photarium.redis-backup.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.photarium.redis-backup</string>
    <key>ProgramArguments</key>
    <array>
        <string>/Users/julian/Code/cloud-flare-image-handler/scripts/backup-redis.sh</string>
        <string>--quiet</string>
    </array>
    <key>StartInterval</key>
    <integer>21600</integer> <!-- Every 6 hours (in seconds) -->
    <key>WorkingDirectory</key>
    <string>/Users/julian/Code/cloud-flare-image-handler</string>
    <key>StandardOutPath</key>
    <string>/tmp/redis-backup.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/redis-backup-error.log</string>
</dict>
</plist>
```

Load the schedule:

```bash
launchctl load ~/Library/LaunchAgents/com.photarium.redis-backup.plist
```

## Restore from Backup

### Step 1: Stop the Redis Container

```bash
docker stop photarium-redis
```

### Step 2: Copy Backup into Container

```bash
# List available backups
ls -la ./backups/redis/

# Copy the desired backup (replace filename)
docker cp ./backups/redis/redis-backup-20260117-230436.rdb photarium-redis:/data/dump.rdb
```

### Step 3: Restart Redis

```bash
docker start photarium-redis
```

### Step 4: Verify

```bash
# Check Redis is responding
docker exec photarium-redis redis-cli PING

# Check key count
docker exec photarium-redis redis-cli DBSIZE

# Check vector index exists
docker exec photarium-redis redis-cli FT._LIST
```

## Manual Backup Commands

If you prefer to run commands manually:

```bash
# Trigger a background save
docker exec photarium-redis redis-cli BGSAVE

# Wait and check last save time
docker exec photarium-redis redis-cli LASTSAVE

# Copy the dump file out
docker cp photarium-redis:/data/dump.rdb ./my-backup.rdb
```

## Backup Storage Recommendations

### Local Backups

The default `./backups/redis/` directory works for local development. For production:

```bash
# Backup to external drive
./scripts/backup-redis.sh --dir=/Volumes/ExternalDrive/photarium-backups/redis

# Backup to network share
./scripts/backup-redis.sh --dir=/mnt/nas/backups/photarium/redis
```

### Cloud Backups

After local backup, sync to cloud storage:

```bash
# AWS S3
aws s3 sync ./backups/redis/ s3://your-bucket/photarium/redis-backups/

# Google Cloud Storage
gsutil rsync -r ./backups/redis/ gs://your-bucket/photarium/redis-backups/

# Backblaze B2
b2 sync ./backups/redis/ b2://your-bucket/photarium/redis-backups/
```

### Backup Size Estimates

| Images | Approximate Backup Size |
|--------|------------------------|
| 500 | ~5 MB |
| 2,000 | ~20 MB |
| 10,000 | ~100 MB |
| 50,000 | ~500 MB |

## Troubleshooting

### Container Not Found

```
ERROR: Container 'photarium-redis' is not running
```

**Solution:** Start the Redis container:

```bash
docker start photarium-redis

# Or if it doesn't exist, recreate it:
docker run -d --name photarium-redis -p 6379:6379 redis/redis-stack:latest
```

### Permission Denied

```
Permission denied copying dump.rdb
```

**Solution:** Check Docker has access to the backup directory:

```bash
# Create directory with proper permissions
mkdir -p ./backups/redis
chmod 755 ./backups/redis
```

### Backup File is Empty or Corrupt

```bash
# Check Redis health
docker exec photarium-redis redis-cli INFO persistence

# Force a synchronous save (blocks until complete)
docker exec photarium-redis redis-cli SAVE
```

### After Restore, Indexes Missing

If vector search doesn't work after restore:

```bash
# Recreate the vector index
curl -X POST http://localhost:3000/api/embeddings/reindex
```

Or restart the app - it will recreate indexes on startup.

## Related Documentation

- [Remote Hash Cache](./remote-hash-cache.md) - Understanding Redis caching
- [Embedding Generation](./FUTURE_SEARCH_FEATURES.md) - How embeddings are created
- [Docker Setup](../README.md#redis-setup) - Initial Redis configuration
