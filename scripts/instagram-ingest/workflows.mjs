import fsp from 'node:fs/promises';
import path from 'node:path';
import { stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline/promises';
import puppeteer from 'puppeteer';
import { DEFAULT_DATA_DIR } from './cli.mjs';
import { extractShortcodeFromInstagramUrl, igGet, pushVideoToCloudflare } from './single-url-extract.mjs';
import { reduceVideoUrlsForUpload } from './cloudflare-upload.mjs';

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function ensureParentDir(filePath) { await fsp.mkdir(path.dirname(filePath), { recursive: true }); }
export async function ensureDir(dirPath) { await fsp.mkdir(dirPath, { recursive: true }); }
export async function readJsonIfExists(filePath) {
  try { return JSON.parse(await fsp.readFile(filePath, 'utf8')); } catch { return null; }
}
export async function downloadFile(url, destPath) {
  const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`Download failed (${res.status}) for ${url}`);
  await ensureParentDir(destPath);
  await fsp.writeFile(destPath, Buffer.from(await res.arrayBuffer()));
}
export async function launchBrowser(profileDir, headless) {
  await ensureDir(profileDir);
  return puppeteer.launch({ headless, userDataDir: profileDir, defaultViewport: null, args: ['--no-first-run', '--no-default-browser-check'] });
}

export function logIngestStart(opts, log) {
  log.headline('Instagram Ingest');
  log.info(`username=@${opts.username}`);
  log.info(`profile_dir=${opts.profileDir}`);
  log.info(`output=${opts.outputPath || '(auto; will route after owner resolution)'}`);
  log.info(`checkpoint=${opts.checkpointPath}`);
  log.info(`resume=${opts.resume} count=${opts.count} delay_ms=${opts.delayMs} request_delay_ms=${opts.requestDelayMs} max_pages=${opts.maxPages || 'unbounded'}`);
  if (opts.stopAtShortcode) log.info(`stop_at_shortcode=${opts.stopAtShortcode} (starting at newest; checkpoint ignored)`);
  if (opts.downloadDir) log.info(`download_dir=${opts.downloadDir}`);
  if (opts.pushCloudflare) {
    if (opts.namespace === '__all__' || opts.namespace === '__none__') throw new Error('Invalid --namespace. Use a specific namespace, not "__all__" or "__none__".');
    log.info(`push_cloudflare=true api_base=${opts.apiBase}`);
    log.info(`push_namespace=${opts.namespace}`);
    log.info(`push_tags=instagram,${opts.username} push_folder=instagram`);
    log.info(`push_ai_display_name=${opts.aiDisplayName}`);
    if (opts.skipVideoPush) log.warn('skip_video_push=true (videos will be deferred; only images pushed during ingest)');
  } else log.warn('push_cloudflare=false (explicit opt-out; omit --no-push-cloudflare to catalog assets in Cloudflare).');
}

export async function openInstagramProfile(opts, log) {
  log.debug(`Launching browser in ${opts.headful ? 'headful' : 'headless'} mode.`);
  const browser = await launchBrowser(opts.profileDir, opts.headful ? false : true);
  const page = await browser.newPage();
  log.debug('Opening profile page and fetching profile metadata.');
  await page.goto(`https://www.instagram.com/${opts.username}/`, { waitUntil: 'domcontentloaded' });
  const profileResp = await igGet(page, `/api/v1/users/web_profile_info/?username=${encodeURIComponent(opts.username)}`);
  return { browser, page, profileResp };
}

export async function validateInstagramProfile(profileResp, browser) {
  if (profileResp.status === 401 || profileResp.json?.require_login) {
    await browser.close();
    throw new Error('Login required. Run `node scripts/instagram-ingest.mjs auth --username <name>` first.');
  }
  if (profileResp.status !== 200 || !profileResp.json?.data?.user?.id) {
    await browser.close();
    throw new Error(`Failed to read profile data (status ${profileResp.status}).`);
  }
  return profileResp.json.data.user;
}

export async function runAuth(opts, log) {
  log.headline('Instagram Auth');
  log.info(`profile_dir=${opts.profileDir}`);
  log.info(`username=@${opts.username}`);
  log.debug('Launching Chromium with persistent profile for login reuse.');
  const browser = await launchBrowser(opts.profileDir, false);
  const page = await browser.newPage();
  await page.goto('https://www.instagram.com/accounts/login/', { waitUntil: 'domcontentloaded' });
  log.info('Complete Instagram login in the opened browser window.');
  log.info(`When done, press Enter here to validate session for @${opts.username}.`);
  const rl = createInterface({ input, output });
  await rl.question('');
  rl.close();
  log.debug('Validating login state using web_profile_info endpoint.');
  await page.goto(`https://www.instagram.com/${opts.username}/`, { waitUntil: 'domcontentloaded' });
  const profile = await igGet(page, `/api/v1/users/web_profile_info/?username=${encodeURIComponent(opts.username)}`);
  if (profile.status !== 200 || !profile.json?.data?.user?.id) {
    await browser.close();
    throw new Error(`Login validation failed (status ${profile.status}). Open the profile in browser and retry auth.`);
  }
  const authPath = path.join(DEFAULT_DATA_DIR, `${opts.username}.auth.json`);
  await ensureParentDir(authPath);
  await fsp.writeFile(authPath, JSON.stringify({ username: opts.username, userId: profile.json.data.user.id, validatedAt: new Date().toISOString(), profileDir: opts.profileDir }, null, 2), 'utf8');
  await browser.close();
  log.success(`Session saved. Validation passed for @${opts.username}.`);
  log.info(`auth_metadata=${authPath}`);
}

export async function runVideosFromNdjson(opts, log) {
  log.headline('Instagram Video Replay');
  log.info(`input=${opts.inputPath}`);
  log.info(`api_base=${opts.apiBase}`);
  if (opts.namespace === '__all__' || opts.namespace === '__none__') throw new Error('Invalid --namespace. Use a specific namespace, not "__all__" or "__none__".');
  log.info(`push_namespace=${opts.namespace}`);
  log.info(`request_delay_ms=${opts.requestDelayMs}`);
  log.info(`push_tags=instagram,${opts.username || '(from rows)'} push_folder=instagram`);
  const lines = (await fsp.readFile(opts.inputPath, 'utf8')).split(/\r?\n/).filter((line) => line.trim().length > 0);
  log.info(`ndjson_lines=${lines.length}`);
  const queue = [];
  const seen = new Set();
  let rowsWithLikelyVideoNoUrl = 0;
  let rowsWithAnyVideoCandidates = 0;
  for (const line of lines) {
    let row = null;
    try { row = JSON.parse(line); } catch { log.warn('ndjson_parse_failed; skipping line'); continue; }
    const username = row?.username || opts.username || 'instagram';
    const rowPermalink = typeof row?.permalink === 'string' && row.permalink.trim() ? row.permalink.trim() : null;
    const shortcode = row?.shortcode || (rowPermalink ? extractShortcodeFromInstagramUrl(rowPermalink) : null) || null;
    const permalink = rowPermalink || (shortcode ? `https://www.instagram.com/p/${shortcode}/` : `https://www.instagram.com/${username}/`);
    const candidateVideoUrls = [];
    if (Array.isArray(row?.videoUrls)) candidateVideoUrls.push(...row.videoUrls);
    if (Array.isArray(row?.video_urls)) candidateVideoUrls.push(...row.video_urls);
    if (typeof row?.videoUrl === 'string') candidateVideoUrls.push(row.videoUrl);
    if (Array.isArray(row?.cloudflare)) for (const asset of row.cloudflare) if (asset?.assetType === 'video' && typeof asset?.videoUrl === 'string') candidateVideoUrls.push(asset.videoUrl);
    const reducedVideoUrls = reduceVideoUrlsForUpload(candidateVideoUrls);
    if (reducedVideoUrls.length > 0) rowsWithAnyVideoCandidates += 1;
    if (row?.likelyVideo === true && reducedVideoUrls.length === 0) rowsWithLikelyVideoNoUrl += 1;
    for (const videoUrl of reducedVideoUrls) {
      const key = `${shortcode || 'no_shortcode'}|${videoUrl}`;
      if (seen.has(key)) continue;
      seen.add(key);
      queue.push({ username, shortcode, permalink, sourcePageUrl: permalink, caption: row?.caption || '', videoUrl });
    }
  }
  log.info(`rows_with_video_candidates=${rowsWithAnyVideoCandidates}`);
  if (rowsWithLikelyVideoNoUrl > 0) log.warn(`rows_likely_video_but_no_video_url=${rowsWithLikelyVideoNoUrl}`);
  log.info(`video_queue_size=${queue.length}`);
  let uploaded = 0;
  let failed = 0;
  for (let i = 0; i < queue.length; i += 1) {
    const item = queue[i];
    log.trace(`video_replay_item index=${i + 1}/${queue.length} shortcode=${item.shortcode ?? 'n/a'} url=${item.videoUrl}`);
    try {
      const pushed = await pushVideoToCloudflare({ apiBase: opts.apiBase, videoUrl: item.videoUrl, username: item.username, shortcode: item.shortcode, permalink: item.permalink, sourcePageUrl: item.sourcePageUrl, description: item.caption, namespace: opts.namespace, log });
      uploaded += 1;
      log.trace(`video_replay_ok shortcode=${item.shortcode ?? 'n/a'} id=${pushed.id ?? 'n/a'} stream_uid=${pushed.streamUid ?? 'n/a'}`);
    } catch (err) { failed += 1; log.warn(`video_replay_failed shortcode=${item.shortcode ?? 'n/a'} err=${err.message}`); }
    if (opts.requestDelayMs > 0) { log.trace(`request_sleep_ms=${opts.requestDelayMs} after=video_replay_push`); await sleep(opts.requestDelayMs); }
  }
  log.success(`video_replay_complete uploaded=${uploaded} failed=${failed} queued=${queue.length}`);
}
