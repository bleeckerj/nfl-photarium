#!/usr/bin/env bash
set -euo pipefail

print_usage() {
  cat <<'EOF'
Refresh Discord downloads, then run fs:ingest for each channel folder.

Usage:
  bash scripts/discord-refresh-and-fs-ingest.sh [options]

Options:
  --discord-repo <path>        Path to chester-downloads-discord-images repo
                               (default: /Users/julian/Code/chester-downloads-discord-images)
  --images-root <path>         Directory containing per-channel subdirectories
                               (default: <discord-repo>/images)
  --namespace <name>           Default namespace for fs:ingest
                               (default: cf-midjourney)
  --visually-namespace <n>     Namespace for channel folders matching "visually"
                               (default: cf-default)
  --autotrader-namespace <n>   Namespace for channel folders matching "autotrader"
                               (default: cf-autotrader)
  --api-base <url>             API base for fs:ingest
                               (default: http://localhost:3000)
  --checkpoint-file <path>     Shared checkpoint file for all channel ingests
                               (default: data/fs-ingest-checkpoints/discord-shared-multi-namespace.json)
  --tags <csv>                 Base tags passed to fs:ingest
                               (default: discord,nfl-discord)
  --append-image-tag <tag>     Optional appended image tag
  --description-prefix <text>  Prefix for fs:ingest descriptions
  --tag-count <n>              AI tag count target
                               (default: 3)
  --concurrency <n>            fs:ingest concurrency
                               (default: 2)
  --throttle-ms <n>            Delay between upload requests
                               (default: 2000)
  --no-ai-metadata             Disable --ai-metadata in fs:ingest
  --include-path-tags          Enable --include-path-tags in fs:ingest
  --include-filename           Enable --include-filename in fs:ingest
  --hash-cache-backfill-only   Pass through to fs:ingest
  --assume-uploaded            Pass through to fs:ingest (requires hash-cache-backfill-only)
  --report-cache               Pass through to fs:ingest
  --dry-run                    Pass through to fs:ingest
  --verbose                    Pass through to fs:ingest
  --skip-discord-refresh       Skip the Discord scripts and only run fs:ingest loop
  --skip-ingest                Run Discord scripts only
  --help                       Show this help
EOF
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

DISCORD_REPO="/Users/julian/Code/chester-downloads-discord-images"
DEFAULT_NAMESPACE="cf-midjourney"
VISUALLY_NAMESPACE="cf-default"
AUTOTRADER_NAMESPACE="cf-autotrader"
API_BASE="http://localhost:3000"
TAGS="discord,nfl-discord"
TAG_COUNT="3"
CONCURRENCY="2"
THROTTLE_MS="2000"
USE_AI_METADATA=1
INCLUDE_PATH_TAGS=0
INCLUDE_FILENAME=0
PASS_VERBOSE=0
PASS_DRY_RUN=0
PASS_HASH_BACKFILL_ONLY=0
PASS_ASSUME_UPLOADED=0
PASS_REPORT_CACHE=0
SKIP_DISCORD_REFRESH=0
SKIP_INGEST=0
APPEND_IMAGE_TAG=""
DESCRIPTION_PREFIX=""
IMAGES_ROOT=""
CHECKPOINT_FILE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --discord-repo)
      DISCORD_REPO="$2"
      shift 2
      ;;
    --images-root)
      IMAGES_ROOT="$2"
      shift 2
      ;;
    --namespace)
      DEFAULT_NAMESPACE="$2"
      shift 2
      ;;
    --visually-namespace)
      VISUALLY_NAMESPACE="$2"
      shift 2
      ;;
    --autotrader-namespace)
      AUTOTRADER_NAMESPACE="$2"
      shift 2
      ;;
    --api-base)
      API_BASE="$2"
      shift 2
      ;;
    --checkpoint-file)
      CHECKPOINT_FILE="$2"
      shift 2
      ;;
    --tags)
      TAGS="$2"
      shift 2
      ;;
    --append-image-tag)
      APPEND_IMAGE_TAG="$2"
      shift 2
      ;;
    --description-prefix)
      DESCRIPTION_PREFIX="$2"
      shift 2
      ;;
    --tag-count)
      TAG_COUNT="$2"
      shift 2
      ;;
    --concurrency)
      CONCURRENCY="$2"
      shift 2
      ;;
    --throttle-ms)
      THROTTLE_MS="$2"
      shift 2
      ;;
    --no-ai-metadata)
      USE_AI_METADATA=0
      shift
      ;;
    --include-path-tags)
      INCLUDE_PATH_TAGS=1
      shift
      ;;
    --include-filename)
      INCLUDE_FILENAME=1
      shift
      ;;
    --hash-cache-backfill-only)
      PASS_HASH_BACKFILL_ONLY=1
      shift
      ;;
    --assume-uploaded)
      PASS_ASSUME_UPLOADED=1
      shift
      ;;
    --report-cache)
      PASS_REPORT_CACHE=1
      shift
      ;;
    --dry-run)
      PASS_DRY_RUN=1
      shift
      ;;
    --verbose)
      PASS_VERBOSE=1
      shift
      ;;
    --skip-discord-refresh)
      SKIP_DISCORD_REFRESH=1
      shift
      ;;
    --skip-ingest)
      SKIP_INGEST=1
      shift
      ;;
    --help|-h)
      print_usage
      exit 0
      ;;
    *)
      echo "[error] Unknown option: $1" >&2
      print_usage
      exit 1
      ;;
  esac
done

if [[ -z "${IMAGES_ROOT}" ]]; then
  IMAGES_ROOT="${DISCORD_REPO}/images"
fi
if [[ -z "${CHECKPOINT_FILE}" ]]; then
  CHECKPOINT_FILE="${REPO_ROOT}/data/fs-ingest-checkpoints/discord-shared-multi-namespace.json"
fi

if [[ ! -d "${DISCORD_REPO}" ]]; then
  echo "[error] Discord repo not found: ${DISCORD_REPO}" >&2
  exit 1
fi
if [[ ! -d "${IMAGES_ROOT}" ]]; then
  echo "[error] Images root not found: ${IMAGES_ROOT}" >&2
  exit 1
fi

run_discord_refresh() {
  local py_bin
  if [[ -x "${DISCORD_REPO}/.venv/bin/python" ]]; then
    py_bin="${DISCORD_REPO}/.venv/bin/python"
  else
    py_bin="python3"
  fi

  echo "[discord] using python: ${py_bin}"
  pushd "${DISCORD_REPO}" >/dev/null
  echo "[discord] updating channels_last_ids.json"
  "${py_bin}" find_last_ids_per_channel.py
  echo "[discord] downloading latest content from configured channels"
  "${py_bin}" download_images_from_discord_channel.py
  popd >/dev/null
}

run_ingest_all() {
  local channel_count=0
  local success_count=0
  local skipped_count=0
  local dir_name
  local ingest_namespace
  local channel_name
  local channel_id
  local channel_tag
  local ingest_tags
  local ingest_description_prefix
  local dir_name_lower

  shopt -s nullglob
  for channel_dir in "${IMAGES_ROOT}"/*; do
    [[ -d "${channel_dir}" ]] || continue
    [[ -d "${channel_dir}/images" ]] || continue
    channel_count=$((channel_count + 1))
    dir_name="$(basename "${channel_dir}")"
    channel_name="${dir_name}"
    channel_id=""
    if [[ "${dir_name}" =~ ^(.+)_([0-9]{6,})$ ]]; then
      channel_name="${BASH_REMATCH[1]}"
      channel_id="${BASH_REMATCH[2]}"
    fi
    channel_tag="$(printf '%s' "${channel_name}" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^[:alnum:]_ -]+/ /g; s/[[:space:]]+/-/g; s/-+/-/g; s/^-+//; s/-+$//')"
    if [[ -z "${channel_tag}" ]]; then
      if [[ -n "${channel_id}" ]]; then
        channel_tag="discord-channel-${channel_id}"
      else
        channel_tag="discord-channel"
      fi
    fi
    ingest_tags="${TAGS},${channel_tag}"

    dir_name_lower="$(printf '%s' "${dir_name}" | tr '[:upper:]' '[:lower:]')"
    ingest_namespace="${DEFAULT_NAMESPACE}"
    if [[ "${dir_name_lower}" == *"visually"* ]]; then
      ingest_namespace="${VISUALLY_NAMESPACE}"
    elif [[ "${dir_name_lower}" == *"autotrader"* ]]; then
      ingest_namespace="${AUTOTRADER_NAMESPACE}"
    fi

    if [[ "${ingest_namespace}" == "${DEFAULT_NAMESPACE}" ]]; then
      ingest_tags="${ingest_tags},midjourney"
    fi

    ingest_description_prefix="Channel: ${channel_name}"
    if [[ -n "${DESCRIPTION_PREFIX}" ]]; then
      ingest_description_prefix="${DESCRIPTION_PREFIX} | ${ingest_description_prefix}"
    fi

    echo "[ingest] (${channel_count}) ${dir_name} namespace=${ingest_namespace} channelTag=${channel_tag}"

    cmd=(
      npm run fs:ingest --silent -- 
      --root "${channel_dir}/images"
      --namespace "${ingest_namespace}"
      --api-base "${API_BASE}"
      --checkpoint-file "${CHECKPOINT_FILE}"
      --tags "${ingest_tags}"
      --tag-count "${TAG_COUNT}"
      --concurrency "${CONCURRENCY}"
      --throttle-ms "${THROTTLE_MS}"
      --description-prefix "${ingest_description_prefix}"
    )

    if [[ "${USE_AI_METADATA}" -eq 1 ]]; then
      cmd+=(--ai-metadata)
    fi
    if [[ "${INCLUDE_PATH_TAGS}" -eq 1 ]]; then
      cmd+=(--include-path-tags)
    fi
    if [[ "${INCLUDE_FILENAME}" -eq 1 ]]; then
      cmd+=(--include-filename)
    fi
    if [[ -n "${APPEND_IMAGE_TAG}" ]]; then
      cmd+=(--append-image-tag "${APPEND_IMAGE_TAG}")
    fi
    if [[ "${PASS_HASH_BACKFILL_ONLY}" -eq 1 ]]; then
      cmd+=(--hash-cache-backfill-only)
    fi
    if [[ "${PASS_ASSUME_UPLOADED}" -eq 1 ]]; then
      cmd+=(--assume-uploaded)
    fi
    if [[ "${PASS_REPORT_CACHE}" -eq 1 ]]; then
      cmd+=(--report-cache)
    fi
    if [[ "${PASS_DRY_RUN}" -eq 1 ]]; then
      cmd+=(--dry-run)
    fi
    if [[ "${PASS_VERBOSE}" -eq 1 ]]; then
      cmd+=(--verbose)
    fi

    if "${cmd[@]}"; then
      success_count=$((success_count + 1))
    else
      skipped_count=$((skipped_count + 1))
      echo "[ingest][warn] failed for ${dir_name}; continuing" >&2
    fi
  done
  shopt -u nullglob

  echo "[ingest][done] total=${channel_count} success=${success_count} failed=${skipped_count}"
}

echo "[config] discordRepo=${DISCORD_REPO}"
echo "[config] imagesRoot=${IMAGES_ROOT}"
echo "[config] defaultNamespace=${DEFAULT_NAMESPACE}"
echo "[config] visuallyNamespace=${VISUALLY_NAMESPACE}"
echo "[config] autotraderNamespace=${AUTOTRADER_NAMESPACE}"
echo "[config] checkpointFile=${CHECKPOINT_FILE}"

if [[ "${SKIP_DISCORD_REFRESH}" -eq 0 ]]; then
  run_discord_refresh
else
  echo "[discord] skipped"
fi

if [[ "${SKIP_INGEST}" -eq 0 ]]; then
  run_ingest_all
else
  echo "[ingest] skipped"
fi
