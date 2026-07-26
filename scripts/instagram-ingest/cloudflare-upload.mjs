import path from "node:path";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchImageBuffer(imageUrl) {
  const res = await fetch(imageUrl, {
    headers: {
      "user-agent": "Mozilla/5.0",
      referer: "https://www.instagram.com/",
      origin: "https://www.instagram.com",
    },
  });
  if (!res.ok) throw new Error(`Fetch failed (${res.status})`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const contentType = (res.headers.get("content-type") || "").split(";")[0].trim();
  return { bytes, contentType };
}

export async function suggestDisplayNameFromBuffer({
  apiBase,
  imageBytes,
  imageMime,
  filename,
  folder,
  existingTags = [],
}) {
  const form = new FormData();
  form.append("file", new Blob([imageBytes], { type: imageMime || "image/jpeg" }), filename);
  form.append("filename", filename);
  if (folder) form.append("folder", folder);
  if (Array.isArray(existingTags) && existingTags.length > 0) {
    form.append("tags", existingTags.join(","));
  }

  const res = await fetch(`${apiBase}/api/display-name/suggest`, {
    method: "POST",
    body: form,
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(payload?.error || `Display-name request failed (${res.status})`);
  }

  return {
    displayName:
      typeof payload?.displayName === "string" && payload.displayName.trim()
        ? payload.displayName.trim()
        : undefined,
    model: typeof payload?.model === "string" ? payload.model : undefined,
  };
}

function isRetryableVideoPushError(message) {
  const m = (message || "").toLowerCase();
  return (
    m.includes("stream api request failed (520)") ||
    m.includes("stream api request failed (502)") ||
    m.includes("stream api request failed (503)") ||
    m.includes("stream api request failed (504)") ||
    m.includes("timed out") ||
    m.includes("timeout")
  );
}

export function extensionFromUrl(url) {
  try {
    const pathname = new URL(url).pathname;
    const ext = path.extname(pathname).toLowerCase();
    return ext && ext.length <= 5 ? ext : ".jpg";
  } catch {
    return ".jpg";
  }
}

export function parseInstagramMediaUrl(instagramUrl) {
  try {
    const parsed = new URL(instagramUrl);
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null;
    const rawImgIndex = parsed.searchParams.get("img_index");
    const imgIndex =
      rawImgIndex && /^\d+$/.test(rawImgIndex) && Number.parseInt(rawImgIndex, 10) > 0
        ? Number.parseInt(rawImgIndex, 10)
        : null;

    for (let i = 0; i < parts.length - 1; i += 1) {
      const kind = parts[i]?.toLowerCase();
      if (kind !== "p" && kind !== "reel" && kind !== "reels" && kind !== "tv") continue;
      const shortcode = parts[i + 1] || null;
      if (!shortcode) return null;
      const profileUsername = i > 0 ? parts[i - 1] || null : null;
      const canonical = new URL(`https://www.instagram.com/${kind}/${shortcode}/`);
      if (imgIndex != null) canonical.searchParams.set("img_index", String(imgIndex));
      return {
        kind,
        shortcode,
        profileUsername,
        imgIndex,
        canonicalUrl: canonical.toString(),
      };
    }

    return null;
  } catch {
    return null;
  }
}

export function extractShortcodeFromInstagramUrl(instagramUrl) {
  return parseInstagramMediaUrl(instagramUrl)?.shortcode || null;
}

export function extractProfileUsernameFromInstagramUrl(instagramUrl) {
  return parseInstagramMediaUrl(instagramUrl)?.profileUsername || null;
}

export function buildInstagramUploadTags(primaryUsername, profileUsername) {
  const tags = ["instagram"];
  const cleanPrimary = typeof primaryUsername === "string" ? primaryUsername.trim() : "";
  const cleanProfile = typeof profileUsername === "string" ? profileUsername.trim() : "";
  if (cleanPrimary) tags.push(cleanPrimary);
  if (cleanProfile) tags.push(cleanProfile);
  return [...new Set(tags)];
}

export function appendSourceLabel(current, next) {
  const cleanNext = typeof next === "string" ? next.trim() : "";
  if (!cleanNext) return current || "";
  const parts = typeof current === "string" && current.trim() ? current.split("+").map((p) => p.trim()).filter(Boolean) : [];
  if (!parts.includes(cleanNext)) parts.push(cleanNext);
  return parts.join("+");
}

function scoreVideoUrlForUpload(videoUrl) {
  try {
    const parsed = new URL(videoUrl);
    const pathname = parsed.pathname.toLowerCase();
    const hasVideoExt = /\.(mp4|webm|mov|m4v|ogv|ogg)$/.test(pathname);
    const hasByteRangeHint =
      parsed.searchParams.has("bytestart") ||
      parsed.searchParams.has("byteend") ||
      parsed.searchParams.has("range");

    let score = 0;
    if (hasVideoExt) score += 20;
    if (!hasByteRangeHint) score += 60;
    if (hasByteRangeHint) score -= 40;
    if (parsed.searchParams.get("bytestart") === "0") score += 5;
    if (parsed.searchParams.has("oe")) score += 5;
    score += Math.min(10, pathname.length / 50);
    return score;
  } catch {
    return -100;
  }
}

function decodeInstagramEfg(videoUrl) {
  try {
    const parsed = new URL(videoUrl);
    const encoded = parsed.searchParams.get("efg");
    if (!encoded) return "";
    let normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
    while (normalized.length % 4 !== 0) normalized += "=";
    return Buffer.from(normalized, "base64").toString("utf8");
  } catch {
    return "";
  }
}

function isLikelyAudioOnlyInstagramVideoUrl(videoUrl) {
  const decoded = decodeInstagramEfg(videoUrl).toLowerCase();
  if (!decoded) return false;
  const vencodeTagMatch = decoded.match(/"vencode_tag"\s*:\s*"([^"]+)"/);
  const vencodeTag = (vencodeTagMatch?.[1] || "").toLowerCase();
  return /(^|[._-])audio([._-]|$)/.test(vencodeTag);
}

function sanitizeVideoUrlForUpload(videoUrl) {
  try {
    const parsed = new URL(videoUrl);
    parsed.hash = "";
    parsed.searchParams.delete("bytestart");
    parsed.searchParams.delete("byteend");
    parsed.searchParams.delete("range");
    parsed.searchParams.sort();
    return parsed.toString();
  } catch {
    return videoUrl;
  }
}

function normalizeVideoUrlKey(videoUrl) {
  return sanitizeVideoUrlForUpload(videoUrl);
}

export function reduceVideoUrlsForUpload(videoUrls) {
  if (!Array.isArray(videoUrls) || videoUrls.length <= 1) {
    return Array.isArray(videoUrls)
      ? videoUrls
          .filter((videoUrl) => typeof videoUrl === "string" && videoUrl.startsWith("http"))
          .map((videoUrl) => sanitizeVideoUrlForUpload(videoUrl))
          .filter((videoUrl) => !isLikelyAudioOnlyInstagramVideoUrl(videoUrl))
      : [];
  }

  const bestByKey = new Map();
  for (const videoUrl of videoUrls) {
    if (typeof videoUrl !== "string" || !videoUrl.startsWith("http")) continue;
    const sanitizedUrl = sanitizeVideoUrlForUpload(videoUrl);
    if (isLikelyAudioOnlyInstagramVideoUrl(sanitizedUrl)) continue;
    const key = normalizeVideoUrlKey(sanitizedUrl);
    const score = scoreVideoUrlForUpload(sanitizedUrl);
    const current = bestByKey.get(key);
    if (!current || score > current.score) {
      bestByKey.set(key, { videoUrl: sanitizedUrl, score });
    }
  }

  const reduced = [...bestByKey.values()]
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.videoUrl);

  const preferred = reduced.filter((videoUrl) => scoreVideoUrlForUpload(videoUrl) >= 0);
  return preferred.length > 0 ? preferred : reduced;
}

function contentTypeToExt(contentType) {
  const ct = (contentType || "").toLowerCase();
  if (ct.includes("jpeg") || ct.includes("jpg")) return ".jpg";
  if (ct.includes("png")) return ".png";
  if (ct.includes("webp")) return ".webp";
  if (ct.includes("gif")) return ".gif";
  if (ct.includes("svg")) return ".svg";
  return ".jpg";
}

function normalizeUploadNamespace(namespace) {
  const trimmed = typeof namespace === "string" ? namespace.trim() : "";
  if (!trimmed || trimmed === "undefined" || trimmed === "__all__" || trimmed === "__none__") {
    throw new Error("A specific upload namespace is required.");
  }
  return trimmed;
}

export async function pushImageToCloudflare({
  apiBase,
  imageUrl,
  username,
  uploadTags,
  shortcode,
  sourcePageUrl,
  description,
  instagramSource,
  namespace,
  log,
  displayName,
  fetchedImage,
}) {
  const { bytes, contentType } = fetchedImage ?? await fetchImageBuffer(imageUrl);
  const ext = contentTypeToExt(contentType || imageUrl);
  const safeShortcode = shortcode || `ig_${Date.now()}`;
  const fileName = `${safeShortcode}${ext}`;
  const fileBlob = new Blob([bytes], { type: contentType || "image/jpeg" });
  const uploadNamespace = normalizeUploadNamespace(namespace);

  const form = new FormData();
  form.append("file", fileBlob, fileName);
  form.append("folder", "instagram");
  form.append("tags", Array.isArray(uploadTags) && uploadTags.length > 0 ? uploadTags.join(",") : `instagram,${username}`);
  form.append("sourceUrl", sourcePageUrl);
  form.append("originalUrl", imageUrl);
  form.append("namespace", uploadNamespace);
  if (displayName) form.append("displayName", displayName);
  if (description) form.append("description", description);
  if (instagramSource) form.append("instagramSource", JSON.stringify(instagramSource));

  const endpoint = `${apiBase}/api/upload/external`;
  log.trace(`cloudflare_push_start endpoint=${endpoint} file=${fileName} namespace=${uploadNamespace}`);
  const res = await fetch(endpoint, { method: "POST", body: form });
  const bodyText = await res.text();
  let body = null;
  try {
    body = JSON.parse(bodyText);
  } catch {
    body = null;
  }

  if (!res.ok) {
    if (res.status === 409 && Array.isArray(body?.duplicates) && body.duplicates.length > 0) {
      const duplicateIds = body.duplicates.map((d) => d.id).filter(Boolean);
      if (description || instagramSource || sourcePageUrl) {
        for (const duplicateId of duplicateIds) {
          try {
            await patchExistingImageMetadata({
              apiBase,
              imageId: duplicateId,
              description,
              sourceUrl: sourcePageUrl,
              instagramSource,
              log,
            });
          } catch (error) {
            log.warn(
              `cloudflare_duplicate_metadata_failed image_id=${duplicateId} err=${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
      }
      return {
        alreadyExists: true,
        duplicateIds,
      };
    }
    const err = body?.error || body?.message || `HTTP ${res.status}`;
    throw new Error(err);
  }

  return {
    alreadyExists: false,
    id: body?.id || null,
    url: body?.url || null,
    variants: Array.isArray(body?.variants) ? body.variants : [],
  };
}

async function patchExistingImageMetadata({
  apiBase,
  imageId,
  description,
  sourceUrl,
  instagramSource,
  log,
}) {
  const payload = {
    ...(description ? { description } : {}),
    ...(sourceUrl ? { sourceUrl } : {}),
    ...(instagramSource ? { instagramSource } : {}),
  };
  if (Object.keys(payload).length === 0) return;

  const endpoint = `${apiBase}/api/images/${encodeURIComponent(imageId)}/extras`;
  const res = await fetch(endpoint, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `Metadata patch failed (${res.status})`);
  }
  log.trace(`cloudflare_duplicate_metadata_ok image_id=${imageId}`);
}

export async function ingestImageToCloudflare({
  apiBase,
  imageUrl,
  username,
  uploadTags,
  shortcode,
  sourcePageUrl,
  description,
  instagramSource,
  namespace,
  log,
  aiDisplayName = false,
}) {
  let fetchedImage;
  let displayName;

  if (aiDisplayName) {
    fetchedImage = await fetchImageBuffer(imageUrl);
    const ext = contentTypeToExt(fetchedImage.contentType || imageUrl);
    const safeShortcode = shortcode || `ig_${Date.now()}`;
    const filename = `${safeShortcode}${ext}`;

    try {
      const ai = await suggestDisplayNameFromBuffer({
        apiBase,
        imageBytes: fetchedImage.bytes,
        imageMime: fetchedImage.contentType || "image/jpeg",
        filename,
        folder: "instagram",
        existingTags: Array.isArray(uploadTags) ? uploadTags : [],
      });
      displayName = ai.displayName;
      if (displayName) {
        log.trace(
          `cloudflare_ai_display_name_ok shortcode=${shortcode ?? "n/a"} model=${ai.model ?? "unknown"} display_name=${displayName}`,
        );
      }
    } catch (error) {
      log.warn(
        `cloudflare_ai_display_name_failed shortcode=${shortcode ?? "n/a"} image=${imageUrl} err=${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return pushImageToCloudflare({
    apiBase,
    imageUrl,
    username,
    uploadTags,
    shortcode,
    sourcePageUrl,
    description,
    instagramSource,
    namespace,
    log,
    displayName,
    fetchedImage,
  });
}

export async function pushVideoToCloudflare({
  apiBase,
  videoUrl,
  username,
  uploadTags,
  shortcode,
  sourcePageUrl,
  description,
  namespace,
  log,
}) {
  const sanitizedVideoUrl = sanitizeVideoUrlForUpload(videoUrl);
  const endpoint = `${apiBase}/api/import/page/upload-video`;
  const safeShortcode = shortcode || `ig_video_${Date.now()}`;
  const { bytes, contentType } = await fetchImageBuffer(sanitizedVideoUrl);
  const uploadNamespace = normalizeUploadNamespace(namespace);
  log.trace(
    `cloudflare_video_source_fetched shortcode=${safeShortcode} namespace=${uploadNamespace} bytes=${bytes.byteLength} content_type=${contentType || "unknown"}`,
  );
  const ext = contentTypeToExt(contentType || "video/mp4");
  const fileName = `${safeShortcode}${ext === ".jpg" ? ".mp4" : ext}`;
  const fileBlob = new Blob([bytes], { type: contentType || "video/mp4" });

  const form = new FormData();
  form.append("file", fileBlob, fileName);
  form.append("folder", "instagram");
  form.append("tags", Array.isArray(uploadTags) && uploadTags.length > 0 ? uploadTags.join(",") : `instagram,${username}`);
  form.append("originalUrl", sanitizedVideoUrl);
  form.append("sourceUrl", sourcePageUrl);
  form.append("namespace", uploadNamespace);
  if (description) form.append("description", description);

  log.trace(
    `cloudflare_video_push_start endpoint=${endpoint} shortcode=${shortcode || "n/a"} mode=file_upload file=${fileName} namespace=${uploadNamespace}`,
  );
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const res = await fetch(endpoint, {
      method: "POST",
      body: form,
    });
    const bodyText = await res.text();
    let body = null;
    try {
      body = JSON.parse(bodyText);
    } catch {
      body = null;
    }

    if (res.ok) {
      return {
        id: body?.id || null,
        streamUid: body?.streamUid || null,
        playbackUrl: body?.playbackUrl || null,
        hlsUrl: body?.hlsUrl || null,
        thumbnailUrl: body?.thumbnailUrl || null,
        previewUrl: body?.previewUrl || null,
      };
    }

    const err = body?.error || body?.message || `HTTP ${res.status}`;
    const retryable = isRetryableVideoPushError(err) && attempt < maxAttempts;
    if (retryable) {
      const backoffMs = attempt * 1500;
      log.warn(
        `cloudflare_video_push_retry shortcode=${safeShortcode} attempt=${attempt}/${maxAttempts} status=${res.status} err=${err} backoff_ms=${backoffMs}`,
      );
      await sleep(backoffMs);
      continue;
    }

    throw new Error(err);
  }

  throw new Error("Unexpected video push failure.");
}
