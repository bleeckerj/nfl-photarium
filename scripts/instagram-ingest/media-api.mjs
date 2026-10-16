import { APP_ID } from "./cli.mjs";
import { mapItemToRecord } from "./records.mjs";

export function instagramMediaIdFromShortcode(shortcode) {
  if (typeof shortcode !== "string" || !/^[A-Za-z0-9_-]{1,16}$/.test(shortcode)) return null;
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  // Media IDs exceed Number's exact integer range.
  let mediaId = 0n;
  for (const character of shortcode) mediaId = mediaId * 64n + BigInt(alphabet.indexOf(character));
  return mediaId.toString();
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

export async function fetchSingleUrlRecordFromApiByShortcode(page, shortcode, fallbackUsername, fallbackUserId, log, imgIndex = null) {
  const mediaId = instagramMediaIdFromShortcode(shortcode);
  if (!mediaId) return null;
  const apiPath = `/api/v1/media/${mediaId}/info/`;
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
  const mapped = mapItemToRecord(item, username, userId, imgIndex);
  mapped.shortcode = mapped.shortcode || shortcode;
  mapped.permalink = mapped.permalink || `https://www.instagram.com/reel/${shortcode}/`;
  return mapped;
}

export async function fetchSingleUrlRecordFromUserFeedByShortcode(page, username, shortcode, log, imgIndex = null) {
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
      const mapped = mapItemToRecord(found, username, userId, imgIndex);
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
