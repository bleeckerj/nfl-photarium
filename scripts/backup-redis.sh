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

# Timestamp for backup file
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_FILE="redis-backup-${TIMESTAMP}.rdb"

log "═══════════════════════════════════════════════════════"
log "Redis Backup"
log "═══════════════════════════════════════════════════════"
log "Container:   $CONTAINER"
log "Backup dir:  $BACKUP_DIR"
log "Backup file: $BACKUP_FILE"
log "Keep count:  $KEEP_COUNT"
log "───────────────────────────────────────────────────────"

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
  sleep 2
  
  # Check if save succeeded
  LASTSAVE=$(docker exec "$CONTAINER" redis-cli LASTSAVE)
  log "         Last save: $LASTSAVE"
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
log "Step 3: Rotating old backups (keeping last $KEEP_COUNT)..."
if [ "$DRY_RUN" = false ]; then
  # Count existing backups
  BACKUP_COUNT=$(ls -1 "${BACKUP_DIR}"/redis-backup-*.rdb 2>/dev/null | wc -l | tr -d ' ')
  
  if [ "$BACKUP_COUNT" -gt "$KEEP_COUNT" ]; then
    # Calculate how many to delete
    DELETE_COUNT=$((BACKUP_COUNT - KEEP_COUNT))
    log "         Found $BACKUP_COUNT backups, removing $DELETE_COUNT oldest..."
    
    # Delete oldest backups
    ls -1t "${BACKUP_DIR}"/redis-backup-*.rdb | tail -n "$DELETE_COUNT" | while read -r file; do
      log "         Removing: $(basename "$file")"
      rm "$file"
    done
  else
    log "         $BACKUP_COUNT backups found, no rotation needed"
  fi
else
  log "         [DRY RUN] Would check and rotate backups"
fi

log ""
log "───────────────────────────────────────────────────────"

# List current backups
if [ "$QUIET" = false ] && [ "$DRY_RUN" = false ]; then
  log "Current backups:"
  ls -lht "${BACKUP_DIR}"/redis-backup-*.rdb 2>/dev/null | head -"$KEEP_COUNT" | while read -r line; do
    echo "  $line"
  done
fi

log ""
log "✓ Backup complete!"
log "═══════════════════════════════════════════════════════"
