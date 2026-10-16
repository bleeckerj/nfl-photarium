import { mapItemToRecord } from "./records.mjs";

export function findInstagramMediaRecord(payload, shortcode, fallbackUsername, imgIndex = null) {
  const queue = [payload];
  const seen = new WeakSet();
  for (let index = 0; index < queue.length; index += 1) {
    const value = queue[index];
    if (!value || typeof value !== "object" || seen.has(value)) continue;
    seen.add(value);
    if ((value.code ?? value.shortcode) === shortcode) {
      const record = mapItemToRecord(value, fallbackUsername, null, imgIndex);
      if (record.imageUrls.length > 0 || record.videoUrls.length > 0) return record;
    }
    queue.push(...Object.values(value).filter((nested) => nested && typeof nested === "object"));
  }
  return null;
}

function fullerRecord(current, candidate) {
  if (!candidate) return current;
  if (!current) return candidate;
  return candidate.imageUrls.length + candidate.videoUrls.length > current.imageUrls.length + current.videoUrls.length
    ? candidate : current;
}

export async function readInstagramPageMedia(page, shortcode, fallbackUsername, imgIndex = null) {
  const scripts = await page.evaluate(() =>
    [...document.querySelectorAll("script:not([src])")].map((script) => script.textContent || ""),
  );
  let record = null;
  for (const text of scripts) {
    try {
      record = fullerRecord(record, findInstagramMediaRecord(JSON.parse(text), shortcode, fallbackUsername, imgIndex));
    } catch {
      // Executable scripts are not JSON payloads.
    }
  }
  return record;
}

export function captureInstagramMediaResponses(page, shortcode, fallbackUsername, imgIndex = null) {
  const pending = [];
  let record = null;
  const responseHandler = (response) => {
    try {
      const url = new URL(response.url());
      if (!/(^|\.)instagram\.com$/.test(url.hostname) || !/\/(?:api\/|graphql\/)/.test(url.pathname)) return;
      if (!String(response.headers()["content-type"] || "").includes("json")) return;
      pending.push(response.json().then((payload) => {
        record = fullerRecord(record, findInstagramMediaRecord(payload, shortcode, fallbackUsername, imgIndex));
      }).catch(() => {}));
    } catch {
      // Some responses have no readable body; embedded JSON remains available.
    }
  };
  page.on("response", responseHandler);
  return {
    async read(pageRecord) {
      await Promise.all(pending);
      return fullerRecord(pageRecord, record);
    },
    dispose() { page.off("response", responseHandler); },
  };
}
