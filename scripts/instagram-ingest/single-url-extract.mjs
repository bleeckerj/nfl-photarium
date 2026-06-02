import { APP_ID } from "./cli.mjs";
import { extractShortcodeFromInstagramUrl } from "./cloudflare-upload.mjs";
import { mapItemToRecord } from "./records.mjs";

async function igGet(page, apiPath) {
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
    const toList = (items) => [...new Set(items.filter((item) => typeof item === "string" && item.length > 0))];
    const inferUsernameFromMetaText = (...candidates) => {
      for (const value of candidates) {
        if (typeof value !== "string") continue;
        const text = value.trim();
        if (!text) continue;
        const match = text.match(/([a-zA-Z0-9._]{1,30})\s+on\s+Instagram/i);
        if (match?.[1]) return match[1];
      }
      return null;
    };
    const imageUrls = [];
    const videoUrls = [];
    const notes = [];
    let sawVideoMetaTag = false;
    let sawVideoElement = false;
    let sawVideoScriptField = false;

    const pushImage = (url) => {
      if (typeof url === "string" && url.startsWith("http")) imageUrls.push(url);
    };
    const pushVideo = (url) => {
      if (typeof url === "string" && url.startsWith("http")) videoUrls.push(url);
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
    const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute("content") || "";
    const ogDescription = document.querySelector('meta[property="og:description"]')?.getAttribute("content") || "";
    const twitterTitle = document.querySelector('meta[name="twitter:title"]')?.getAttribute("content") || "";
    const inferredMetaUsername = inferUsernameFromMetaText(ogTitle, ogDescription, twitterTitle);
    const usernameFromOwner = mediaNode?.owner?.username || null;
    const usernameFromJsonLd = jsonLdUsername || null;
    const usernameFromFallback =
      typeof fallbackUsername === "string" && fallbackUsername ? fallbackUsername : null;
    const username = usernameFromOwner || usernameFromJsonLd || usernameFromFallback;
    const usernameSource = usernameFromOwner
      ? "owner"
      : usernameFromJsonLd
        ? "jsonld"
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
      caption,
      imageUrls: toList(imageUrls),
      videoUrls: toList(videoUrls),
      notes,
      inferredMetaUsername,
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
      likeCount: null,
      commentCount: null,
      caption: extracted.caption || "",
      imageUrls: Array.isArray(extracted.imageUrls) ? extracted.imageUrls : [],
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
