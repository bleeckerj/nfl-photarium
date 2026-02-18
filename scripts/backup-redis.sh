#!/bin/bash

#
# Redis Backup Script for Photarium
#
# Backs up the Redis container data to a local directory with timestamp.
# Supports automatic rotation to keep only recent backups.
#
# Usage:
#   ./scripts/backup-redis.sh [options]
#
# Options:
#   --dir=<path>       Backup directory (default: ./backups/redis)
#   --keep=<n>         Number of backups to keep (default: 10)
#   --retention-days=<n> Remove backups older than n days (default: 30)
#   --container=<name> Container name (default: photarium-redis)
#   --quiet            Suppress output except errors
#   --dry-run          Show what would be done without doing it
#
# Examples:
#   # Basic backup
#   ./scripts/backup-redis.sh
#
#   # Keep only last 5 backups
#   ./scripts/backup-redis.sh --keep=5
#
#   # Custom backup directory
#   ./scripts/backup-redis.sh --dir=/path/to/backups
#
# Scheduling with cron (every 6 hours):
#   0 */6 * * * cd /Users/julian/Code/cloud-flare-image-handler && ./scripts/backup-redis.sh --quiet
#

set -e

# Default configuration
BACKUP_DIR="./backups/redis"
KEEP_COUNT=10
RETENTION_DAYS=30
CONTAINER="photarium-redis"
QUIET=false
DRY_RUN=false

# Parse arguments
for arg in "$@"; do
  case $arg in
    --dir=*)
      BACKUP_DIR="${arg#*=}"
      ;;
    --keep=*)
      KEEP_COUNT="${arg#*=}"
      ;;
    --retention-days=*)
      RETENTION_DAYS="${arg#*=}"
      ;;
    --container=*)
      CONTAINER="${arg#*=}"
      ;;
    --quiet)
      QUIET=true
      ;;
    --dry-run)
      DRY_RUN=true
      ;;
    --help|-h)
      head -35 "$0" | tail -32
      exit 0
      ;;
  esac
done

# Logging helper
log() {
  if [ "$QUIET" = false ]; then
    echo "$@"
  fi
}

error() {
  echo "ERROR: $@" >&2
}

get_mtime_epoch() {
  local file="$1"
  if stat -f "%m" "$file" >/dev/null 2>&1; then
    stat -f "%m" "$file"
  else
    stat -c "%Y" "$file"
  fi
}

# Timestamp for backup file (include timezone offset, e.g. 20260206-091937-0800)
TIMESTAMP=$(date +%Y%m%d-%H%M%S%z)
BACKUP_FILE="redis-backup-${TIMESTAMP}.rdb"
BACKUP_BUNDLE_FILE="redis-backup-${TIMESTAMP}.tgz"

log "═══════════════════════════════════════════════════════"
log "Redis Backup"
log "═══════════════════════════════════════════════════════"
log "Container:   $CONTAINER"
log "Backup dir:  $BACKUP_DIR"
log "Backup file: $BACKUP_FILE"
log "Bundle file: $BACKUP_BUNDLE_FILE"
log "Keep count:  $KEEP_COUNT"
log "Retention:   ${RETENTION_DAYS} days"
log "───────────────────────────────────────────────────────"

wait_for_redis_field_zero() {
  local field="$1"
  local timeout_seconds="${2:-600}"
  local elapsed=0

  while true; do
    local value
    value=$(docker exec "$CONTAINER" redis-cli INFO persistence 2>/dev/null | awk -F: -v f="$field" '$1==f {gsub("\r","",$2); print $2; exit}')
    if [ -z "$value" ] || [ "$value" = "0" ]; then
      return 0
    fi
    sleep 1
    elapsed=$((elapsed + 1))
    if [ "$elapsed" -ge "$timeout_seconds" ]; then
      error "Timed out waiting for $field to become 0"
      return 1
    fi
  done
}

# Check if container is running
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
  error "Container '$CONTAINER' is not running"
  exit 1
fi

# Create backup directory if needed
if [ "$DRY_RUN" = false ]; then
  mkdir -p "$BACKUP_DIR"
fi

log ""
log "Step 1: Triggering Redis BGSAVE..."
if [ "$DRY_RUN" = false ]; then
  docker exec "$CONTAINER" redis-cli BGSAVE > /dev/null

  # Wait for background save to complete
  log "         Waiting for save to complete..."
  wait_for_redis_field_zero "rdb_bgsave_in_progress" 1200 || true
  
  # Check if save succeeded
  LASTSAVE=$(docker exec "$CONTAINER" redis-cli LASTSAVE)
  log "         Last save: $LASTSAVE"
fi

log ""
log "Step 1b: Triggering Redis BGREWRITEAOF (compact AOF)..."
if [ "$DRY_RUN" = false ]; then
  docker exec "$CONTAINER" redis-cli BGREWRITEAOF > /dev/null || true
  log "         Waiting for rewrite to complete..."
  wait_for_redis_field_zero "aof_rewrite_in_progress" 1800 || true
fi

log ""
log "Step 2: Copying dump.rdb from container..."
if [ "$DRY_RUN" = false ]; then
  docker cp "${CONTAINER}:/data/dump.rdb" "${BACKUP_DIR}/${BACKUP_FILE}"
  
  # Get file size
  FILESIZE=$(ls -lh "${BACKUP_DIR}/${BACKUP_FILE}" | awk '{print $5}')
  log "         Created: ${BACKUP_DIR}/${BACKUP_FILE} ($FILESIZE)"
else
  log "         [DRY RUN] Would copy to ${BACKUP_DIR}/${BACKUP_FILE}"
fi

log ""
log "Step 2b: Creating bundle with dump.rdb + AOF file(s)..."
if [ "$DRY_RUN" = false ]; then
  AOF_TMP_DIR="${BACKUP_DIR}/.aof-tmp-${TIMESTAMP}"
  rm -rf "$AOF_TMP_DIR" 2>/dev/null || true
  mkdir -p "$AOF_TMP_DIR"

  # Include the just-copied dump.rdb in the bundle.
  cp "${BACKUP_DIR}/${BACKUP_FILE}" "${AOF_TMP_DIR}/dump.rdb"

  # Copy AOF artifacts if present.
  HAS_AOF=false
  if docker exec "$CONTAINER" sh -lc 'test -f /data/appendonly.aof' >/dev/null 2>&1; then
    docker cp "${CONTAINER}:/data/appendonly.aof" "${AOF_TMP_DIR}/appendonly.aof"
    HAS_AOF=true
  fi
  if docker exec "$CONTAINER" sh -lc 'test -d /data/appendonlydir' >/dev/null 2>&1; then
    docker cp "${CONTAINER}:/data/appendonlydir" "${AOF_TMP_DIR}/appendonlydir"
    HAS_AOF=true
  fi

  if [ "$HAS_AOF" = true ]; then
    tar -czf "${BACKUP_DIR}/${BACKUP_BUNDLE_FILE}" -C "$AOF_TMP_DIR" .
    BUNDLE_SIZE=$(ls -lh "${BACKUP_DIR}/${BACKUP_BUNDLE_FILE}" | awk '{print $5}')
    log "         Created: ${BACKUP_DIR}/${BACKUP_BUNDLE_FILE} ($BUNDLE_SIZE)"
  else
    # Still create a bundle with dump.rdb for a single-file restore path, but tell the user AOF was absent.
    tar -czf "${BACKUP_DIR}/${BACKUP_BUNDLE_FILE}" -C "$AOF_TMP_DIR" dump.rdb
    BUNDLE_SIZE=$(ls -lh "${BACKUP_DIR}/${BACKUP_BUNDLE_FILE}" | awk '{print $5}')
    log "         Created: ${BACKUP_DIR}/${BACKUP_BUNDLE_FILE} ($BUNDLE_SIZE)"
    log "         Note: No AOF artifacts found in /data (appendonly.aof/appendonlydir)."
  fi

  rm -rf "$AOF_TMP_DIR" 2>/dev/null || true
else
  log "         [DRY RUN] Would create ${BACKUP_DIR}/${BACKUP_BUNDLE_FILE} containing dump.rdb + AOF file(s)"
fi

log ""
log "Step 3: Rotating old backups (older than ${RETENTION_DAYS} days, then keeping last $KEEP_COUNT)..."
if [ "$DRY_RUN" = false ]; then
  NOW_EPOCH=$(date +%s)
  RETENTION_SECONDS=$((RETENTION_DAYS * 86400))
  AGED_REMOVED=0

  for file in "${BACKUP_DIR}"/redis-backup-*.rdb; do
    [ -e "$file" ] || continue
    mtime_epoch=$(get_mtime_epoch "$file")
    age_seconds=$((NOW_EPOCH - mtime_epoch))
    if [ "$age_seconds" -gt "$RETENTION_SECONDS" ]; then
      base=$(basename "$file")
      ts="${base#redis-backup-}"
      ts="${ts%.rdb}"
      log "         Removing (age>${RETENTION_DAYS}d): $base"
      rm "$file"
      if [ -f "${BACKUP_DIR}/redis-backup-${ts}.tgz" ]; then
        log "         Removing: redis-backup-${ts}.tgz"
        rm "${BACKUP_DIR}/redis-backup-${ts}.tgz"
      fi
      AGED_REMOVED=$((AGED_REMOVED + 1))
    fi
  done

  BACKUP_COUNT=$(ls -1 "${BACKUP_DIR}"/redis-backup-*.rdb 2>/dev/null | wc -l | tr -d ' ')

  if [ "$BACKUP_COUNT" -gt "$KEEP_COUNT" ]; then
    DELETE_COUNT=$((BACKUP_COUNT - KEEP_COUNT))
    log "         Found $BACKUP_COUNT backups after age-rotation, removing $DELETE_COUNT oldest by count..."

    ls -1t "${BACKUP_DIR}"/redis-backup-*.rdb | tail -n "$DELETE_COUNT" | while read -r file; do
      base=$(basename "$file")
      ts="${base#redis-backup-}"
      ts="${ts%.rdb}"
      log "         Removing (count): $base"
      rm "$file"
      if [ -f "${BACKUP_DIR}/redis-backup-${ts}.tgz" ]; then
        log "         Removing: redis-backup-${ts}.tgz"
        rm "${BACKUP_DIR}/redis-backup-${ts}.tgz"
      fi
    done
  else
    if [ "$AGED_REMOVED" -gt 0 ]; then
      log "         Removed $AGED_REMOVED backup(s) by age; $BACKUP_COUNT backups remain"
    else
      log "         $BACKUP_COUNT backups found, no rotation needed"
    fi
  fi
else
  log "         [DRY RUN] Would remove backups older than ${RETENTION_DAYS} days, then enforce keep-count=${KEEP_COUNT}"
fi

log ""
log "───────────────────────────────────────────────────────"

# List current backups
if [ "$QUIET" = false ] && [ "$DRY_RUN" = false ]; then
  log "Current backups:"
  ls -lht "${BACKUP_DIR}"/redis-backup-*.tgz 2>/dev/null | head -"$KEEP_COUNT" | while read -r line; do
    echo "  $line"
  done
  ls -lht "${BACKUP_DIR}"/redis-backup-*.rdb 2>/dev/null | head -"$KEEP_COUNT" | while read -r line; do
    echo "  $line"
  done
fi

log ""
log "✓ Backup complete!"
log "═══════════════════════════════════════════════════════"
