import { APP_ID } from "./cli.mjs";
import { extractShortcodeFromInstagramUrl } from "./cloudflare-upload.mjs";
import { mapItemToRecord } from "./records.mjs";

function decodePossiblyEscapedUrl(rawUrl) {
  if (typeof rawUrl !== "string") return "";
  return rawUrl
    .replace(/\\\//g, "/")
    .replace(/\\u0026/gi, "&")
    .replace(/&amp;/gi, "&")
    .trim();
}

function isLikelyImageUrl(url) {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.toLowerCase();
    return /\.(jpg|jpeg|png|webp|gif|avif)(?:$|[?#])/.test(pathname) || /cdninstagram/i.test(parsed.hostname);
  } catch {
    return false;
  }
}

function scoreInstagramImageUrl(url) {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname.toLowerCase();
    const stp = (parsed.searchParams.get("stp") || "").toLowerCase();
    const efg = decodePossiblyEscapedUrl(parsed.searchParams.get("efg") || "").toLowerCase();
    let score = 0;

    if (hostname.includes("cdninstagram") || hostname.startsWith("scontent-")) score += 30;
    if (/\.(jpg|jpeg|png|webp|avif)$/.test(pathname)) score += 15;
    if (stp) score += 5;
    if (stp.includes("dst-jpg") && !/c\d+\./i.test(stp)) score += 40;
    if (/regular_photo|xpids|photo/.test(efg)) score += 15;
    if (/best_image_urlgen/.test(efg)) score -= 15;
    if (/c\d+\.\d+\.\d+[a-z]?/i.test(stp)) score -= 70;
    if (/(^|_)s\d+x\d+($|_)/i.test(stp)) score -= 35;
    if (/(^|_)e35_s\d+x\d+/i.test(stp)) score -= 35;
    if (parsed.searchParams.has("ig_cache_key")) score += 8;

    return score;
  } catch {
    return -100;
  }
}

export function rankInstagramImageUrls(imageUrls) {
  const firstIndexByUrl = new Map();
  const unique = [];
  for (const imageUrl of Array.isArray(imageUrls) ? imageUrls : []) {
    const normalized = decodePossiblyEscapedUrl(imageUrl);
    if (!normalized || !normalized.startsWith("http") || !isLikelyImageUrl(normalized)) continue;
    if (!firstIndexByUrl.has(normalized)) {
      firstIndexByUrl.set(normalized, unique.length);
      unique.push(normalized);
    }
  }

  return unique.sort((a, b) => {
    const scoreDelta = scoreInstagramImageUrl(b) - scoreInstagramImageUrl(a);
    if (scoreDelta !== 0) return scoreDelta;
    return (firstIndexByUrl.get(a) ?? 0) - (firstIndexByUrl.get(b) ?? 0);
  });
}

export function selectInstagramImageUrls(imageUrls, mediaInfo = {}) {
  const rankedImageUrls = rankInstagramImageUrls(imageUrls);
  const isCarousel = mediaInfo.mediaType === 8 || mediaInfo.productType === "carousel_container";
  return isCarousel ? rankedImageUrls : rankedImageUrls.slice(0, 1);
}

function cleanInstagramUsername(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return null;
  const withoutAt = raw.replace(/^@+/, "").trim();
  return /^[a-zA-Z0-9._]{1,30}$/.test(withoutAt) ? withoutAt : null;
}

export function inferInstagramOwnerUsername(candidates = {}) {
  const values = {
    profileUrl: typeof candidates.profileUrl === "string" ? candidates.profileUrl : "",
    twitterTitle: typeof candidates.twitterTitle === "string" ? candidates.twitterTitle : "",
    description: typeof candidates.description === "string" ? candidates.description : "",
    ogDescription: typeof candidates.ogDescription === "string" ? candidates.ogDescription : "",
    canonicalUrl: typeof candidates.canonicalUrl === "string" ? candidates.canonicalUrl : "",
  };

  for (const urlValue of [values.profileUrl, values.canonicalUrl]) {
    try {
      const parsed = new URL(urlValue, "https://www.instagram.com");
      const parts = parsed.pathname.split("/").filter(Boolean);
      const postIndex = parts.findIndex((part) => ["p", "reel", "reels", "tv"].includes(part.toLowerCase()));
      const username = postIndex > 0 ? cleanInstagramUsername(parts[postIndex - 1]) : null;
      if (username) return { username, source: "profile_url" };
    } catch {
      // Non-URL strings are handled by the textual patterns below.
    }
  }

  for (const text of [values.twitterTitle, values.description, values.ogDescription]) {
    const atHandle = text.match(/@([a-zA-Z0-9._]{1,30})\b/);
    const username = cleanInstagramUsername(atHandle?.[1]);
    if (username) return { username, source: "meta_handle" };
  }

  for (const text of [values.description, values.ogDescription]) {
    const byline = text.match(/^\s*(?:[\d,.]+\s+likes?,\s+[\d,.]+\s+comments?\s+-\s+)?([a-zA-Z0-9._]{1,30})\s+on\s+/i);
    const username = cleanInstagramUsername(byline?.[1]);
    if (username) return { username, source: "meta_byline" };
  }

  return { username: null, source: "unresolved" };
}

export async function igGet(page, apiPath) {
  const result = await page.evaluate(
    async ({ apiPath, appId }) => {
      const res = await fetch(apiPath, {
        method: "GET",
        credentials: "include",
        headers: {
          "x-ig-app-id": appId,
          "x-requested-with": "XMLHttpRequest",
        },
      });
      const text = await res.text();
      return { status: res.status, text };
    },
    { apiPath, appId: APP_ID },
  );

  let json = null;
  try {
    json = JSON.parse(result.text);
  } catch {
    json = null;
  }
  return { status: result.status, json, text: result.text };
}

export async function extractSingleUrlRecord(page, instagramUrl, fallbackUsername, log) {
  const networkVideoUrls = new Set();
  const responseHandler = (response) => {
    try {
      const url = response.url();
      if (typeof url !== "string" || !url.startsWith("http")) return;
      const headers = response.headers();
      const contentType = String(headers["content-type"] || "").toLowerCase();
      const isVideoResponse =
        contentType.startsWith("video/") ||
        /\.(mp4|m4v|webm|mov|ogv|ogg)(\?|$)/i.test(url);
      if (isVideoResponse) networkVideoUrls.add(url);
    } catch {
      // Ignore response inspection failures; DOM/script extraction still runs.
    }
  };
  page.on("response", responseHandler);
  log.debug(`single_url_opening url=${instagramUrl}`);
  try {
    await page.goto(instagramUrl, { waitUntil: "domcontentloaded" });
    await page.waitForNetworkIdle({ idleTime: 750, timeout: 3000 }).catch(() => {});

    const extracted = await page.evaluate(({ fallbackUsername }) => {
    const decodePossiblyEscapedUrl = (rawUrl) =>
      typeof rawUrl === "string"
        ? rawUrl.replace(/\\\//g, "/").replace(/\\u0026/gi, "&").replace(/&amp;/gi, "&").trim()
        : "";
    const isLikelyImageUrl = (url) => {
      try {
        const parsed = new URL(url);
        const pathname = parsed.pathname.toLowerCase();
        return /\.(jpg|jpeg|png|webp|gif|avif)(?:$|[?#])/.test(pathname) || /cdninstagram/i.test(parsed.hostname);
      } catch {
        return false;
      }
    };
    const extractImageUrlsFromText = (text) => {
      if (typeof text !== "string" || !text.includes("http")) return [];
      const urls = [];
      const pattern = /https:(?:\\\/\\\/|\/\/)[^"' <>)]+/gi;
      let match = null;
      while ((match = pattern.exec(text)) !== null) {
        const url = decodePossiblyEscapedUrl(match[0]).replace(/[),.;]+$/g, "");
        if (isLikelyImageUrl(url)) urls.push(url);
      }
      return urls;
    };
    const toList = (items) => [...new Set(items.filter((item) => typeof item === "string" && item.length > 0))];
    const cleanInstagramUsername = (value) => {
      const raw = typeof value === "string" ? value.trim() : "";
      if (!raw) return null;
      const withoutAt = raw.replace(/^@+/, "").trim();
      return /^[a-zA-Z0-9._]{1,30}$/.test(withoutAt) ? withoutAt : null;
    };
    const inferInstagramOwnerUsername = (candidates = {}) => {
      const profileUrl = typeof candidates.profileUrl === "string" ? candidates.profileUrl : "";
      const canonicalUrl = typeof candidates.canonicalUrl === "string" ? candidates.canonicalUrl : "";
      const twitterTitle = typeof candidates.twitterTitle === "string" ? candidates.twitterTitle : "";
      const description = typeof candidates.description === "string" ? candidates.description : "";
      const ogDescription = typeof candidates.ogDescription === "string" ? candidates.ogDescription : "";

      for (const urlValue of [profileUrl, canonicalUrl]) {
        try {
          const parsed = new URL(urlValue, "https://www.instagram.com");
          const parts = parsed.pathname.split("/").filter(Boolean);
          const postIndex = parts.findIndex((part) => ["p", "reel", "reels", "tv"].includes(part.toLowerCase()));
          const username = postIndex > 0 ? cleanInstagramUsername(parts[postIndex - 1]) : null;
          if (username) return { username, source: "profile_url" };
        } catch {
          // Textual meta fields are handled below.
        }
      }

      for (const text of [twitterTitle, description, ogDescription]) {
        const atHandle = text.match(/@([a-zA-Z0-9._]{1,30})\b/);
        const username = cleanInstagramUsername(atHandle?.[1]);
        if (username) return { username, source: "meta_handle" };
      }

      for (const text of [description, ogDescription]) {
        const byline = text.match(/^\s*(?:[\d,.]+\s+likes?,\s+[\d,.]+\s+comments?\s+-\s+)?([a-zA-Z0-9._]{1,30})\s+on\s+/i);
        const username = cleanInstagramUsername(byline?.[1]);
        if (username) return { username, source: "meta_byline" };
      }

      return { username: null, source: "unresolved" };
    };
    const imageUrls = [];
    const videoUrls = [];
    const notes = [];
    let sawVideoMetaTag = false;
    let sawVideoElement = false;
    let sawVideoScriptField = false;

    const pushImage = (url) => {
      const normalized = decodePossiblyEscapedUrl(url);
      if (normalized.startsWith("http") && isLikelyImageUrl(normalized)) imageUrls.push(normalized);
    };
    const pushVideo = (url) => {
      const normalized = decodePossiblyEscapedUrl(url);
      if (normalized.startsWith("http")) videoUrls.push(normalized);
    };

    const metaImageSelectors = [
      'meta[property="og:image"]',
      'meta[name="og:image"]',
      'meta[property="twitter:image"]',
      'meta[name="twitter:image"]',
    ];
    const metaVideoSelectors = [
      'meta[property="og:video"]',
      'meta[property="og:video:url"]',
      'meta[name="og:video"]',
      'meta[property="twitter:player:stream"]',
      'meta[name="twitter:player:stream"]',
    ];

    for (const selector of metaImageSelectors) {
      for (const el of document.querySelectorAll(selector)) {
        pushImage(el.getAttribute("content") || "");
      }
    }
    for (const selector of metaVideoSelectors) {
      for (const el of document.querySelectorAll(selector)) {
        sawVideoMetaTag = true;
        pushVideo(el.getAttribute("content") || "");
      }
    }

    for (const videoEl of document.querySelectorAll("video")) {
      sawVideoElement = true;
      pushVideo(videoEl.currentSrc || "");
      pushVideo(videoEl.src || "");
      pushVideo(videoEl.getAttribute("src") || "");
      const nestedSources = videoEl.querySelectorAll("source");
      for (const sourceEl of nestedSources) {
        pushVideo(sourceEl.getAttribute("src") || "");
      }
    }

    for (const imageEl of document.querySelectorAll("img")) {
      pushImage(imageEl.currentSrc || "");
      pushImage(imageEl.src || "");
      pushImage(imageEl.getAttribute("src") || "");
      const srcset = imageEl.getAttribute("srcset") || "";
      for (const entry of srcset.split(",")) {
        const candidate = entry.trim().split(/\s+/)[0] || "";
        pushImage(candidate);
      }
    }

    for (const linkEl of document.querySelectorAll("link[rel]")) {
      const rel = (linkEl.getAttribute("rel") || "").toLowerCase();
      if (rel.includes("image") || rel.includes("preload") || rel.includes("preconnect")) {
        pushImage(linkEl.getAttribute("href") || "");
      }
    }

    for (const sourceEl of document.querySelectorAll("source")) {
      const type = (sourceEl.getAttribute("type") || "").toLowerCase();
      const src = sourceEl.getAttribute("src") || "";
      if (type.startsWith("video/") || /\.(mp4|webm|mov|m4v|ogv|ogg)(\?|$)/i.test(src)) {
        pushVideo(src);
      }
    }

    const weakSeen = new WeakSet();
    const scanNode = (value, depth = 0) => {
      if (!value || depth > 10) return;
      if (typeof value === "string") {
        if (isLikelyImageUrl(value)) pushImage(value);
        return;
      }
      if (Array.isArray(value)) {
        for (const item of value) scanNode(item, depth + 1);
        return;
      }
      if (typeof value !== "object") return;
      if (weakSeen.has(value)) return;
      weakSeen.add(value);

      if (typeof value.display_url === "string") pushImage(value.display_url);
      if (typeof value.thumbnail_src === "string") pushImage(value.thumbnail_src);
      if (typeof value.video_url === "string") pushVideo(value.video_url);
      if (Array.isArray(value.video_versions)) {
        for (const v of value.video_versions) {
          if (typeof v?.url === "string") pushVideo(v.url);
        }
      }
      if (Array.isArray(value.image_versions2?.candidates)) {
        for (const c of value.image_versions2.candidates) {
          if (typeof c?.url === "string") pushImage(c.url);
        }
      }

      for (const nested of Object.values(value)) {
        if (nested && typeof nested === "object") scanNode(nested, depth + 1);
      }
    };

    let mediaNode = null;
    let jsonLdUsername = null;
    const scriptNodes = document.querySelectorAll("script:not([src])");
    for (const script of scriptNodes) {
      const text = script.textContent || "";
      if (!text.trim()) continue;
      for (const imageUrl of extractImageUrlsFromText(text)) {
        pushImage(imageUrl);
      }
      try {
        const parsed = JSON.parse(text);
        scanNode(parsed);
        if (!jsonLdUsername && parsed?.author && typeof parsed.author === "object") {
          const candidate =
            parsed.author.alternateName ||
            parsed.author.identifier ||
            parsed.author.name ||
            null;
          if (typeof candidate === "string") {
            jsonLdUsername = candidate.startsWith("@") ? candidate.slice(1) : candidate;
          }
        }
        const candidate =
          parsed?.graphql?.shortcode_media ||
          parsed?.data?.xdt_shortcode_media ||
          parsed?.xdt_shortcode_media ||
          null;
        if (!mediaNode && candidate && typeof candidate === "object") {
          mediaNode = candidate;
        }
      } catch {
        const videoFieldPatterns = [
          new RegExp(String.raw`"video_url"\s*:\s*"(https:\\/\\/[^"\\]+)"`, "gi"),
          new RegExp(String.raw`"video_versions"\s*:\s*\[[\s\S]*?"url"\s*:\s*"(https:\\/\\/[^"\\]+)"`, "gi"),
        ];
        for (const pattern of videoFieldPatterns) {
          pattern.lastIndex = 0;
          let match = null;
          while ((match = pattern.exec(text)) !== null) {
            const raw = match?.[1];
            if (typeof raw === "string" && raw.length > 0) {
              sawVideoScriptField = true;
              pushVideo(raw.replace(/\\\//g, "/"));
            }
          }
        }
        if (!text.includes("shortcode_media") && !text.includes("xdt_shortcode_media")) continue;
        const marker = text.includes("xdt_shortcode_media") ? "xdt_shortcode_media" : "shortcode_media";
        const start = text.indexOf(marker);
        if (start >= 0) notes.push(`found_marker:${marker}`);
      }
    }

    if (mediaNode) {
      scanNode(mediaNode);
    }

    const pathname = window.location.pathname || "";
    const searchParams = new URLSearchParams(window.location.search || "");
    const rawImgIndex = searchParams.get("img_index");
    const requestedImgIndex =
      rawImgIndex && /^\d+$/.test(rawImgIndex) && Number.parseInt(rawImgIndex, 10) > 0
        ? Number.parseInt(rawImgIndex, 10)
        : null;
    const parts = pathname.split("/").filter(Boolean);
    let shortcode = null;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const kind = (parts[i] || "").toLowerCase();
      if (kind === "p" || kind === "reel" || kind === "reels" || kind === "tv") {
        shortcode = parts[i + 1] || null;
        break;
      }
    }
    const permalink = window.location.href;
    const ogDescription = document.querySelector('meta[property="og:description"]')?.getAttribute("content") || "";
    const description = document.querySelector('meta[name="description"]')?.getAttribute("content") || "";
    const twitterTitle = document.querySelector('meta[name="twitter:title"]')?.getAttribute("content") || "";
    const ogUrl = document.querySelector('meta[property="og:url"]')?.getAttribute("content") || "";
    const canonicalUrl = document.querySelector('link[rel="canonical"]')?.getAttribute("href") || "";
    const inferredOwner = inferInstagramOwnerUsername({
      profileUrl: ogUrl,
      canonicalUrl,
      twitterTitle,
      description,
      ogDescription,
    });
    const usernameFromOwner = mediaNode?.owner?.username || null;
    const usernameFromJsonLd = jsonLdUsername || null;
    const usernameFromFallback =
      typeof fallbackUsername === "string" && fallbackUsername ? fallbackUsername : null;
    const usernameFromMeta = inferredOwner.username || null;
    const username = usernameFromOwner || usernameFromJsonLd || usernameFromMeta || usernameFromFallback;
    const usernameSource = usernameFromOwner
      ? "owner"
      : usernameFromJsonLd
        ? "jsonld"
        : usernameFromMeta
          ? inferredOwner.source
          : usernameFromFallback
            ? "fallback_arg"
            : "unresolved";
    const userId = mediaNode?.owner?.id || null;
    const mediaId = mediaNode?.id || null;
    const pk = mediaNode?.pk || null;
    const caption =
      mediaNode?.edge_media_to_caption?.edges?.[0]?.node?.text ||
      mediaNode?.caption?.text ||
      "";
    const countValue = (...values) => {
      for (const value of values) {
        const count = Number(value);
        if (Number.isFinite(count) && count >= 0) return Math.trunc(count);
      }
      return null;
    };
    const likeCount = countValue(
      mediaNode?.like_count,
      mediaNode?.edge_media_preview_like?.count,
      mediaNode?.edge_media_to_parent_like?.count,
    );
    const commentCount = countValue(
      mediaNode?.comment_count,
      mediaNode?.edge_media_to_comment?.count,
      mediaNode?.edge_media_to_parent_comment?.count,
    );
    const viewCount = countValue(
      mediaNode?.view_count,
      mediaNode?.video_view_count,
      mediaNode?.play_count,
      mediaNode?.ig_play_count,
    );
    const takenAtUnix =
      Number.isFinite(mediaNode?.taken_at_timestamp)
        ? Number(mediaNode.taken_at_timestamp)
        : Number.isFinite(mediaNode?.taken_at)
          ? Number(mediaNode.taken_at)
          : null;

    const typename = mediaNode?.__typename || "";
    let mediaType = mediaNode?.media_type ?? null;
    if (mediaType == null) {
      if (typename === "GraphVideo") mediaType = 2;
      else if (typename === "GraphSidecar") mediaType = 8;
      else if (typename === "GraphImage") mediaType = 1;
    }

    const sidecarChildren = Array.isArray(mediaNode?.edge_sidecar_to_children?.edges)
      ? mediaNode.edge_sidecar_to_children.edges
          .map((edge) => edge?.node)
          .filter((node) => node && typeof node === "object")
      : [];
    const selectedChild =
      requestedImgIndex != null && requestedImgIndex > 0 && sidecarChildren.length >= requestedImgIndex
        ? sidecarChildren[requestedImgIndex - 1]
        : null;
    if (selectedChild) {
      // When an Instagram carousel URL includes img_index, prefer the targeted child asset.
      imageUrls.length = 0;
      videoUrls.length = 0;
      scanNode(selectedChild);
    }

    const childTypename = selectedChild?.__typename || "";
    const childMediaType =
      selectedChild?.media_type ??
      (childTypename === "GraphVideo" ? 2 : childTypename === "GraphImage" ? 1 : null);
    const productType = selectedChild?.product_type || mediaNode?.product_type || null;
    const likelyVideo =
      childMediaType === 2 ||
      mediaType === 2 ||
      productType === "clips" ||
      sawVideoMetaTag ||
      sawVideoElement ||
      sawVideoScriptField;
    return {
      username,
      userId,
      mediaId,
      pk,
      shortcode,
      permalink,
      mediaType: childMediaType ?? mediaType,
      productType,
      takenAtUnix,
      likeCount,
      commentCount,
      viewCount,
      caption,
      imageUrls: toList(imageUrls),
      videoUrls: toList(videoUrls),
      notes,
      inferredMetaUsername: usernameFromMeta || null,
      likelyVideo,
      usernameSource,
      videoSignals: {
        metaTag: sawVideoMetaTag,
        videoElement: sawVideoElement,
        scriptField: sawVideoScriptField,
      },
    };
    }, { fallbackUsername });

    const username = extracted.username || fallbackUsername;
    const takenAtIso = extracted.takenAtUnix ? new Date(extracted.takenAtUnix * 1000).toISOString() : null;
    const mergedVideoUrls = [
      ...(Array.isArray(extracted.videoUrls) ? extracted.videoUrls : []),
      ...networkVideoUrls,
    ];

    const imageUrls = selectInstagramImageUrls(extracted.imageUrls, {
      mediaType: extracted.mediaType,
      productType: extracted.productType,
    });

    const record = {
      source: "instagram",
      fetchedAt: new Date().toISOString(),
      username,
      userId: extracted.userId || null,
      mediaId: extracted.mediaId || null,
      pk: extracted.pk || null,
      shortcode: extracted.shortcode || extractShortcodeFromInstagramUrl(instagramUrl),
      permalink: extracted.permalink || instagramUrl,
      mediaType: extracted.mediaType ?? null,
      productType: extracted.productType ?? null,
      takenAtUnix: extracted.takenAtUnix ?? null,
      takenAtIso,
      likeCount: extracted.likeCount ?? null,
      commentCount: extracted.commentCount ?? null,
      viewCount: extracted.viewCount ?? null,
      caption: extracted.caption || "",
      imageUrls,
      videoUrls: [...new Set(mergedVideoUrls.filter(Boolean))],
      likelyVideo: extracted.likelyVideo === true,
      username_source: extracted.usernameSource || "unresolved",
      video_source:
        (Array.isArray(extracted.videoUrls) && extracted.videoUrls.length > 0)
          ? "page_extract"
          : networkVideoUrls.size > 0
            ? "network_capture"
            : "none",
    };

    if (record.imageUrls.length === 0 && record.videoUrls.length === 0) {
      throw new Error("Could not extract media URLs from Instagram page. Re-run auth and retry with --headful.");
    }

    if (Array.isArray(extracted.notes) && extracted.notes.length > 0) {
      log.trace(`single_url_extract_notes notes=${extracted.notes.join(",")}`);
    }
    if (networkVideoUrls.size > 0) {
      log.trace(`single_url_network_video_capture count=${networkVideoUrls.size}`);
    }
    if (extracted.likelyVideo) {
      const signals = extracted.videoSignals || {};
      log.trace(
        `single_url_video_signals likely_video=true meta=${Boolean(signals.metaTag)} video_el=${Boolean(signals.videoElement)} script=${Boolean(signals.scriptField)}`,
      );
    }
    if (extracted.inferredMetaUsername && extracted.inferredMetaUsername !== record.username) {
      log.trace(
        `single_url_meta_username_ignored meta_username=${extracted.inferredMetaUsername} reason=display_name_can_masquerade_as_username`,
      );
    }

    return record;
  } finally {
    page.off("response", responseHandler);
  }
}

export async function fetchSingleUrlRecordFromApiByShortcode(page, shortcode, fallbackUsername, fallbackUserId, log) {
  if (!shortcode) return null;
  const apiPath = `/api/v1/media/${encodeURIComponent(shortcode)}/info/`;
  log.debug(`single_url_api_fallback_fetch shortcode=${shortcode} api_path=${apiPath}`);
  const resp = await igGet(page, apiPath);
  if (resp.status !== 200) {
    log.warn(`single_url_api_fallback_failed shortcode=${shortcode} status=${resp.status}`);
    return null;
  }

  const item = Array.isArray(resp.json?.items) ? resp.json.items[0] : null;
  if (!item || typeof item !== "object") {
    log.warn(`single_url_api_fallback_empty shortcode=${shortcode}`);
    return null;
  }

  const username = item?.user?.username || fallbackUsername;
  const userId = item?.user?.pk || item?.user?.id || fallbackUserId || null;
  const mapped = mapItemToRecord(item, username, userId);
  mapped.shortcode = mapped.shortcode || shortcode;
  mapped.permalink = mapped.permalink || `https://www.instagram.com/reel/${shortcode}/`;
  return mapped;
}

export async function fetchSingleUrlRecordFromUserFeedByShortcode(page, username, shortcode, log) {
  if (!username || !shortcode) return null;

  const profileResp = await igGet(
    page,
    `/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`,
  );
  if (profileResp.status !== 200 || !profileResp.json?.data?.user?.id) {
    log.warn(
      `single_url_feed_fallback_profile_failed username=${username} status=${profileResp.status}`,
    );
    return null;
  }

  const userId = profileResp.json.data.user.id;
  let maxId = "";
  const maxPages = 8;
  const perPage = 12;

  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const apiPath =
      `/api/v1/feed/user/${encodeURIComponent(userId)}/?count=${encodeURIComponent(perPage)}` +
      (maxId ? `&max_id=${encodeURIComponent(maxId)}` : "");
    const feedResp = await igGet(page, apiPath);
    if (feedResp.status !== 200 || !feedResp.json) {
      log.warn(
        `single_url_feed_fallback_page_failed username=${username} status=${feedResp.status} page=${pageIndex + 1}`,
      );
      return null;
    }

    const items = Array.isArray(feedResp.json.items) ? feedResp.json.items : [];
    const found = items.find((item) => item?.code === shortcode);
    if (found) {
      const mapped = mapItemToRecord(found, username, userId);
      mapped.shortcode = mapped.shortcode || shortcode;
      return mapped;
    }

    const nextMaxId = feedResp.json.next_max_id ?? "";
    if (!nextMaxId) break;
    maxId = nextMaxId;
  }

  log.warn(`single_url_feed_fallback_not_found username=${username} shortcode=${shortcode}`);
  return null;
}
