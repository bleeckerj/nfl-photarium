#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  extractInstagramMediaUrl,
  runInstagramIngest,
  TELEGRAM_INGEST_NAMESPACE,
} from './telegram-listener/instagram-ingest.mjs';

const DEFAULT_BASE_URL = 'http://localhost:3000';
const DEFAULT_STATE_FILE = path.join(os.tmpdir(), 'photarium-telegram-listener-state.json');
const DEFAULT_CONFIG_FILE = path.resolve(process.cwd(), '.env.telegram-listener');
const DEFAULT_TIMEOUT_SECONDS = 30;
const POLL_INTERVAL_MS = 1500;

function env(name, fallback = undefined) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  const trimmed = value.trim();
  return trimmed === '' ? fallback : trimmed;
}

function envBool(name, fallback = false) {
  const value = env(name);
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function envInt(name, fallback) {
  const value = env(name);
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function splitCsv(value) {
  if (!value) return [];
  return value.split(',').map((v) => v.trim()).filter(Boolean);
}

function uniqueStrings(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getCliArgValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return undefined;
  const next = process.argv[index + 1];
  if (!next || next.startsWith('-')) return undefined;
  return next;
}

function stripWrappingQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;

  const body = trimmed.startsWith('export ') ? trimmed.slice('export '.length).trim() : trimmed;
  const eqIndex = body.indexOf('=');
  if (eqIndex <= 0) return null;

  const key = body.slice(0, eqIndex).trim();
  let value = body.slice(eqIndex + 1).trim();
  const quote = value[0];

  if (quote !== '"' && quote !== "'") {
    const commentIndex = value.indexOf(' #');
    if (commentIndex >= 0) value = value.slice(0, commentIndex).trim();
  }

  return [key, stripWrappingQuotes(value)];
}

async function loadEnvFile(filePath) {
  try {
    const raw = await readFile(filePath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const parsed = parseEnvLine(line);
      if (!parsed) continue;
      const [key, value] = parsed;
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
    return true;
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

function getConfig() {
  const telegramBotToken = env('TELEGRAM_BOT_TOKEN');
  if (!telegramBotToken) throw new Error('Missing TELEGRAM_BOT_TOKEN');

  const photariumBaseUrl = env('PHOTARIUM_BASE_URL', DEFAULT_BASE_URL).replace(/\/+$/, '');
  const config = {
    telegramBotToken,
    telegramApiBaseUrl: `https://api.telegram.org/bot${telegramBotToken}`,
    telegramFileBaseUrl: `https://api.telegram.org/file/bot${telegramBotToken}`,
    allowedChatIds: new Set(splitCsv(env('TELEGRAM_ALLOWED_CHAT_IDS')).map(String)),
    pollTimeoutSeconds: envInt('TELEGRAM_POLL_TIMEOUT_SECONDS', DEFAULT_TIMEOUT_SECONDS),
    stateFile: env('TELEGRAM_STATE_FILE', DEFAULT_STATE_FILE),
    includeCaptionHashtags: envBool('TELEGRAM_INCLUDE_CAPTION_HASHTAGS', true),
    generateDisplayName: envBool('TELEGRAM_GENERATE_DISPLAY_NAME', true),
    once: process.argv.includes('--once'),
    photariumBaseUrl,
    externalUploadUrl: env('PHOTARIUM_EXTERNAL_UPLOAD_URL', `${photariumBaseUrl}/api/upload`),
    displayNameSuggestUrl: env('PHOTARIUM_DISPLAY_NAME_SUGGEST_URL', `${photariumBaseUrl}/api/display-name/suggest`),
    namespace: TELEGRAM_INGEST_NAMESPACE,
    folder: env('PHOTARIUM_FOLDER'),
    baseTags: uniqueStrings(['telegram', ...splitCsv(env('PHOTARIUM_TAGS'))]),
  };

  return config;
}

async function telegramApi(config, method, payload) {
  const response = await fetch(`${config.telegramApiBaseUrl}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(`Telegram ${method} returned non-JSON (${response.status})`);
  }

  if (!response.ok || !data?.ok) {
    throw new Error(`Telegram ${method} failed (${response.status}): ${data?.description || 'unknown error'}`);
  }

  return data.result;
}

async function loadState(config) {
  try {
    const raw = await readFile(config.stateFile, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      lastUpdateId: Number.isInteger(parsed?.lastUpdateId) ? parsed.lastUpdateId : 0,
      processedKeys: Array.isArray(parsed?.processedKeys)
        ? parsed.processedKeys.filter((v) => typeof v === 'string').slice(-1000)
        : [],
    };
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      return { lastUpdateId: 0, processedKeys: [] };
    }
    throw error;
  }
}

async function saveState(config, state) {
  await mkdir(path.dirname(config.stateFile), { recursive: true });
  await writeFile(
    config.stateFile,
    JSON.stringify(
      {
        lastUpdateId: state.lastUpdateId,
        processedKeys: state.processedKeys.slice(-1000),
        updatedAt: new Date().toISOString(),
      },
      null,
      2
    )
  );
}

function extractHashtags(text) {
  if (!text) return [];
  const matches = text.match(/#[\p{L}\p{N}_-]+/gu) || [];
  return matches.map((tag) => tag.slice(1).toLowerCase()).filter(Boolean);
}

function deriveTelegramMessageUrl(chat, messageId) {
  const username = chat?.username;
  if (username) return `https://t.me/${username}/${messageId}`;

  const rawId = String(chat?.id || '');
  if (rawId.startsWith('-100') && rawId.length > 4) {
    return `https://t.me/c/${rawId.slice(4)}/${messageId}`;
  }
  return undefined;
}

function chooseMedia(message) {
  const doc = message?.document;
  if (doc?.file_id && typeof doc?.mime_type === 'string' && doc.mime_type.startsWith('image/')) {
    return {
      kind: 'document',
      fileId: doc.file_id,
      fileUniqueId: doc.file_unique_id,
      filename: doc.file_name || undefined,
      mimeType: doc.mime_type,
    };
  }

  const photos = Array.isArray(message?.photo) ? message.photo : [];
  const best = photos.at(-1);
  if (best?.file_id) {
    return {
      kind: 'photo',
      fileId: best.file_id,
      fileUniqueId: best.file_unique_id,
      filename: undefined,
      mimeType: 'image/jpeg',
    };
  }

  return null;
}

async function downloadTelegramFile(config, media, fallbackFilename) {
  const fileInfo = await telegramApi(config, 'getFile', { file_id: media.fileId });
  if (!fileInfo?.file_path) {
    throw new Error('Telegram getFile returned no file_path');
  }

  const fileUrl = `${config.telegramFileBaseUrl}/${fileInfo.file_path}`;
  const response = await fetch(fileUrl);
  if (!response.ok) {
    throw new Error(`Failed to download Telegram file (${response.status})`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const filename = media.filename || inferFilename(fileInfo.file_path, fallbackFilename, media.mimeType);
  return { buffer, filename, mimeType: media.mimeType, fileUrl };
}

function inferFilename(filePath, fallbackFilename, mimeType) {
  const candidate = filePath ? path.basename(filePath) : '';
  if (candidate && candidate.includes('.')) return candidate;
  if (fallbackFilename && fallbackFilename.includes('.')) return fallbackFilename;
  const ext = mimeType === 'image/png' ? '.png' : mimeType === 'image/webp' ? '.webp' : '.jpg';
  return `${fallbackFilename || 'telegram-image'}${ext}`;
}

async function maybeGenerateDisplayName(config, image, context) {
  if (!config.generateDisplayName) return undefined;

  const form = new FormData();
  form.append('file', new Blob([image.buffer], { type: image.mimeType }), image.filename);
  form.append('filename', image.filename);
  if (context.folder) form.append('folder', context.folder);
  if (context.tags.length) form.append('tags', context.tags.join(','));

  const response = await fetch(config.displayNameSuggestUrl, { method: 'POST', body: form });
  const payload = await safeJson(response);
  if (!response.ok) {
    console.warn('[telegram-listener] display-name suggestion failed', {
      status: response.status,
      error: payload?.error || 'unknown',
    });
    return undefined;
  }
  return typeof payload?.displayName === 'string' && payload.displayName.trim()
    ? payload.displayName.trim()
    : undefined;
}

async function uploadToPhotarium(config, image, metadata) {
  const form = new FormData();
  form.append('file', new Blob([image.buffer], { type: image.mimeType }), image.filename);
  form.append('namespace', config.namespace);
  if (metadata.folder) form.append('folder', metadata.folder);
  if (metadata.tags.length) form.append('tags', metadata.tags.join(','));
  if (metadata.description) form.append('description', metadata.description);
  if (metadata.displayName) form.append('displayName', metadata.displayName);
  if (metadata.sourceUrl) form.append('sourceUrl', metadata.sourceUrl);
  if (metadata.originalUrl) form.append('originalUrl', metadata.originalUrl);
  if (metadata.duplicateAction) form.append('duplicateAction', metadata.duplicateAction);

  const response = await fetch(config.externalUploadUrl, { method: 'POST', body: form });
  const payload = await safeJson(response);
  if (!response.ok) {
    throw new Error(`Photarium upload failed (${response.status}): ${payload?.error || 'unknown error'}`);
  }
  return payload;
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function shouldProcessChat(config, chatId) {
  if (config.allowedChatIds.size === 0) return true;
  return config.allowedChatIds.has(String(chatId));
}

function buildProcessedKey(message, media) {
  const chatId = message?.chat?.id ?? 'unknown';
  const messageId = message?.message_id ?? 'unknown';
  const unique = media?.fileUniqueId || media?.fileId || 'nofile';
  return `${chatId}:${messageId}:${unique}`;
}

function buildInstagramProcessedKey(message, instagramUrl) {
  const chatId = message?.chat?.id ?? 'unknown';
  const messageId = message?.message_id ?? 'unknown';
  return `${chatId}:${messageId}:instagram:${instagramUrl}`;
}

async function processChannelPost(config, state, message) {
  const chat = message?.chat;
  const messageId = message?.message_id;

  if (!chat || !messageId) return { skipped: 'missing-chat-or-message-id' };
  if (!shouldProcessChat(config, chat.id)) return { skipped: 'chat-not-allowed' };

  const instagramUrl = extractInstagramMediaUrl(message);
  if (instagramUrl) {
    const processedKey = buildInstagramProcessedKey(message, instagramUrl);
    if (state.processedKeys.includes(processedKey)) return { skipped: 'already-processed' };

    console.log('[telegram-listener] ingesting Instagram URL', {
      chatId: chat.id,
      messageId,
      instagramUrl,
    });
    await runInstagramIngest({
      instagramUrl,
      apiBase: config.photariumBaseUrl,
    });
    state.processedKeys.push(processedKey);
    state.processedKeys = state.processedKeys.slice(-1000);

    return {
      uploaded: true,
      uploadKind: 'instagram-url',
      chatId: chat.id,
      messageId,
      instagramUrl,
    };
  }

  const media = chooseMedia(message);
  if (!media) return { skipped: 'no-image-media' };

  const processedKey = buildProcessedKey(message, media);
  if (state.processedKeys.includes(processedKey)) return { skipped: 'already-processed' };

  const fallbackFilename = `telegram_${chat.id}_${messageId}`;
  const image = await downloadTelegramFile(config, media, fallbackFilename);

  const caption = typeof message.caption === 'string' ? message.caption.trim() : '';
  const captionTags = config.includeCaptionHashtags ? extractHashtags(caption) : [];
  const tags = uniqueStrings([...config.baseTags, ...captionTags]);
  const sourceUrl = deriveTelegramMessageUrl(chat, messageId);
  const displayName = await maybeGenerateDisplayName(config, image, {
    folder: config.folder,
    tags,
  });

  const uploadPayload = await uploadToPhotarium(config, image, {
    folder: config.folder,
    tags,
    description: caption || undefined,
    displayName,
    sourceUrl,
    originalUrl: sourceUrl,
  });

  state.processedKeys.push(processedKey);
  state.processedKeys = state.processedKeys.slice(-1000);

  return {
    uploaded: true,
    chatId: chat.id,
    messageId,
    fileKind: media.kind,
    filename: image.filename,
    displayName,
    tags,
    photariumId: uploadPayload?.id || uploadPayload?.result?.id,
    sourceUrl,
  };
}

async function pollOnce(config, state) {
  const updates = await telegramApi(config, 'getUpdates', {
    timeout: config.pollTimeoutSeconds,
    offset: state.lastUpdateId > 0 ? state.lastUpdateId + 1 : undefined,
    allowed_updates: ['channel_post'],
  });

  if (!Array.isArray(updates) || updates.length === 0) return { processedCount: 0 };

  for (const update of updates) {
    if (Number.isInteger(update?.update_id)) {
      state.lastUpdateId = update.update_id;
    }

    const message = update?.channel_post;
    if (!message) continue;

    try {
      const result = await processChannelPost(config, state, message);
      if (result?.uploaded) {
        console.log('[telegram-listener] uploaded', result);
      } else if (result?.skipped) {
        console.log('[telegram-listener] skipped', {
          reason: result.skipped,
          chatId: message?.chat?.id,
          messageId: message?.message_id,
        });
      }
    } catch (error) {
      console.error('[telegram-listener] failed to process channel post', {
        chatId: message?.chat?.id,
        messageId: message?.message_id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { processedCount: updates.length };
}

function printStartup(config) {
  console.log('[telegram-listener] starting', {
    configFile: config.configFile || null,
    loadedConfigFile: Boolean(config.loadedConfig),
    photariumBaseUrl: config.photariumBaseUrl,
    externalUploadUrl: config.externalUploadUrl,
    displayNameSuggestUrl: config.displayNameSuggestUrl,
    namespace: config.namespace,
    folder: config.folder || null,
    baseTags: config.baseTags,
    allowedChatIds: Array.from(config.allowedChatIds),
    stateFile: config.stateFile,
    once: config.once,
    generateDisplayName: config.generateDisplayName,
  });
}

async function main() {
  const configFile = getCliArgValue('--config') || DEFAULT_CONFIG_FILE;
  const loadedConfig = await loadEnvFile(configFile);
  const config = getConfig();
  printStartup({ ...config, configFile, loadedConfig });
  const state = await loadState(config);

  while (true) {
    try {
      await pollOnce(config, state);
      await saveState(config, state);
    } catch (error) {
      console.error('[telegram-listener] poll error', {
        error: error instanceof Error ? error.message : String(error),
      });
      await saveState(config, state);
      if (config.once) {
        process.exitCode = 1;
        return;
      }
      await sleep(POLL_INTERVAL_MS);
    }

    if (config.once) return;
  }
}

main().catch((error) => {
  console.error('[telegram-listener] fatal', error);
  process.exit(1);
});
