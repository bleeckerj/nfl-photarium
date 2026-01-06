import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const DROP_OFF_DIR = process.env.DROP_OFF_DIR || path.join(process.cwd(), 'drop-off');
const BASE_URL = process.env.DROP_OFF_BASE_URL || 'http://localhost:3000';
const DROP_OFF_FOLDER = process.env.DROP_OFF_FOLDER || 'drop-off';
const DROP_OFF_TAGS = process.env.DROP_OFF_TAGS || 'found';
const STATE_FILE =
  process.env.DROP_OFF_STATE_FILE || path.join(DROP_OFF_DIR, '.watcher-state.json');
const PROCESS_EXISTING = process.env.DROP_OFF_PROCESS_EXISTING !== 'false';

const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg']);
const MIME_BY_EXTENSION = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml'
};

const state = {
  version: 1,
  processed: {}
};

let saveTimer = null;

const log = (message, meta) => {
  const payload = meta ? ` ${JSON.stringify(meta)}` : '';
  console.log(`[drop-off] ${message}${payload}`);
};

const loadState = async () => {
  try {
    const raw = await fs.promises.readFile(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && parsed.processed) {
      state.processed = parsed.processed;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      log('Failed to read state file', { error: error.message });
    }
  }
};

const scheduleStateSave = () => {
  if (saveTimer) {
    clearTimeout(saveTimer);
  }
  saveTimer = setTimeout(async () => {
    try {
      await fs.promises.mkdir(DROP_OFF_DIR, { recursive: true });
      await fs.promises.writeFile(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
    } catch (error) {
      log('Failed to write state file', { error: error.message });
    }
  }, 300);
};

const isImageFile = (filePath) => {
  const ext = path.extname(filePath).toLowerCase();
  return ALLOWED_EXTENSIONS.has(ext);
};

const getMimeType = (filePath) => {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_BY_EXTENSION[ext] || 'application/octet-stream';
};

const waitForStableFile = async (filePath, attempts = 6, waitMs = 400) => {
  let previous = null;
  for (let i = 0; i < attempts; i += 1) {
    let stat;
    try {
      stat = await fs.promises.stat(filePath);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
    if (!stat.isFile()) {
      return null;
    }
    const snapshot = { size: stat.size, mtimeMs: stat.mtimeMs };
    if (
      previous &&
      previous.size === snapshot.size &&
      previous.mtimeMs === snapshot.mtimeMs
    ) {
      return snapshot;
    }
    previous = snapshot;
    await delay(waitMs);
  }
  return previous;
};

const uploadImage = async (filePath) => {
  const buffer = await fs.promises.readFile(filePath);
  const mimeType = getMimeType(filePath);
  const filename = path.basename(filePath);
  const formData = new FormData();
  formData.append('file', new Blob([buffer], { type: mimeType }), filename);
  formData.append('folder', DROP_OFF_FOLDER);
  formData.append('tags', DROP_OFF_TAGS);
  const response = await fetch(`${BASE_URL}/api/upload`, {
    method: 'POST',
    body: formData
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { ok: false, error: payload?.error || 'Upload failed', status: response.status };
  }
  return { ok: true, data: payload };
};

const generateAltTag = async (imageId) => {
  const response = await fetch(`${BASE_URL}/api/images/${imageId}/alt`, { method: 'POST' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { ok: false, error: payload?.error || 'ALT generation failed', status: response.status };
  }
  return { ok: true, data: payload };
};

const activeUploads = new Set();
const scheduled = new Map();

const processFile = async (filePath) => {
  if (activeUploads.has(filePath)) {
    return;
  }
  activeUploads.add(filePath);
  try {
    if (!isImageFile(filePath)) {
      return;
    }
    const snapshot = await waitForStableFile(filePath);
    if (!snapshot) {
      return;
    }
    const previous = state.processed[filePath];
    if (
      previous &&
      previous.size === snapshot.size &&
      previous.mtimeMs === snapshot.mtimeMs
    ) {
      return;
    }
    log('Uploading image', { file: path.basename(filePath) });
    const uploadResult = await uploadImage(filePath);
    if (!uploadResult.ok) {
      log('Upload failed', { file: path.basename(filePath), error: uploadResult.error });
      state.processed[filePath] = {
        size: snapshot.size,
        mtimeMs: snapshot.mtimeMs,
        status: 'failed',
        error: uploadResult.error
      };
      scheduleStateSave();
      return;
    }
    const imageId = uploadResult.data?.id;
    let altStatus = 'skipped';
    if (imageId) {
      const altResult = await generateAltTag(imageId);
      if (altResult.ok) {
        altStatus = 'done';
        log('ALT generated', { file: path.basename(filePath) });
      } else {
        altStatus = 'failed';
        log('ALT generation failed', {
          file: path.basename(filePath),
          error: altResult.error
        });
      }
    } else {
      log('Upload response missing image id', { file: path.basename(filePath) });
    }
    state.processed[filePath] = {
      size: snapshot.size,
      mtimeMs: snapshot.mtimeMs,
      status: 'uploaded',
      imageId: imageId || null,
      altStatus
    };
    scheduleStateSave();
  } catch (error) {
    log('Processing error', { file: path.basename(filePath), error: error.message });
  } finally {
    activeUploads.delete(filePath);
  }
};

const scheduleProcess = (filePath) => {
  if (!isImageFile(filePath)) {
    return;
  }
  if (scheduled.has(filePath)) {
    clearTimeout(scheduled.get(filePath));
  }
  const timer = setTimeout(() => {
    scheduled.delete(filePath);
    processFile(filePath);
  }, 500);
  scheduled.set(filePath, timer);
};

const scanExistingFiles = async () => {
  const entries = await fs.promises.readdir(DROP_OFF_DIR, { withFileTypes: true });
  entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(DROP_OFF_DIR, entry.name))
    .forEach(scheduleProcess);
};

const startWatcher = async () => {
  await fs.promises.mkdir(DROP_OFF_DIR, { recursive: true });
  await loadState();
  log('Watching drop-off folder', { path: DROP_OFF_DIR, baseUrl: BASE_URL });
  if (PROCESS_EXISTING) {
    await scanExistingFiles();
  }
  const watcher = fs.watch(DROP_OFF_DIR, (eventType, filename) => {
    if (!filename) return;
    const filePath = path.join(DROP_OFF_DIR, filename.toString());
    scheduleProcess(filePath);
  });
  watcher.on('error', (error) => {
    log('Watcher error', { error: error.message });
  });
};

startWatcher().catch((error) => {
  log('Watcher failed to start', { error: error.message });
  process.exit(1);
});
