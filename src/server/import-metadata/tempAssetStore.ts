import { createHash, randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import type { TempAssetRecord, TempAssetSession } from '@/server/import-metadata/types';

const ROOT_DIR = path.join(os.tmpdir(), 'photarium-import-sessions');
const SESSION_TTL_MS = 60 * 60 * 1000;

const getSessionDir = (sessionId: string) => path.join(ROOT_DIR, sessionId);
const getAssetsDir = (sessionId: string) => path.join(getSessionDir(sessionId), 'assets');
const getManifestPath = (sessionId: string) => path.join(getSessionDir(sessionId), 'session.json');
const createAssetKey = (url: string) => createHash('sha1').update(url).digest('hex');

async function readSession(sessionId: string): Promise<TempAssetSession | null> {
  try {
    const raw = await fs.readFile(getManifestPath(sessionId), 'utf-8');
    return JSON.parse(raw) as TempAssetSession;
  } catch {
    return null;
  }
}

async function writeSession(session: TempAssetSession) {
  await fs.mkdir(getAssetsDir(session.sessionId), { recursive: true });
  await fs.writeFile(getManifestPath(session.sessionId), JSON.stringify(session, null, 2), 'utf-8');
}

export async function cleanupExpiredImportSessions() {
  await fs.mkdir(ROOT_DIR, { recursive: true });
  const entries = await fs.readdir(ROOT_DIR, { withFileTypes: true }).catch(() => []);
  const now = Date.now();

  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const session = await readSession(entry.name);
        const updatedAt = session?.updatedAt ? Date.parse(session.updatedAt) : 0;
        if (!updatedAt || now - updatedAt > SESSION_TTL_MS) {
          await fs.rm(getSessionDir(entry.name), { recursive: true, force: true }).catch(() => {});
        }
      })
  );
}

export async function createImportSession(existingSessionId?: string) {
  const sessionId = existingSessionId?.trim() || randomUUID();
  const existing = await readSession(sessionId);
  const now = new Date().toISOString();
  const session: TempAssetSession = existing ?? {
    sessionId,
    createdAt: now,
    updatedAt: now,
    assets: {},
  };
  session.updatedAt = now;
  await writeSession(session);
  return session;
}

export async function getImportSession(sessionId: string) {
  return await readSession(sessionId);
}

export async function clearImportSession(sessionId: string) {
  await fs.rm(getSessionDir(sessionId), { recursive: true, force: true }).catch(() => {});
}

export async function storeTempAsset(params: {
  sessionId: string;
  url: string;
  buffer: Buffer;
  filename?: string;
  contentType?: string;
  dimensions?: TempAssetRecord['dimensions'];
}) {
  const session = await createImportSession(params.sessionId);
  const assetKey = createAssetKey(params.url);
  const extension = params.filename?.includes('.')
    ? params.filename.slice(params.filename.lastIndexOf('.'))
    : '';
  const filePath = path.join(getAssetsDir(params.sessionId), `${assetKey}${extension}`);
  await fs.mkdir(getAssetsDir(params.sessionId), { recursive: true });
  await fs.writeFile(filePath, params.buffer);

  const now = new Date().toISOString();
  const record: TempAssetRecord = {
    assetKey,
    url: params.url,
    filePath,
    filename: params.filename,
    fileSizeBytes: params.buffer.byteLength,
    contentType: params.contentType,
    dimensions: params.dimensions,
    createdAt: session.assets[assetKey]?.createdAt ?? now,
    updatedAt: now,
  };
  session.assets[assetKey] = record;
  session.updatedAt = now;
  await writeSession(session);
  return record;
}

export async function getTempAssetByKey(sessionId: string, assetKey: string) {
  const session = await readSession(sessionId);
  const asset = session?.assets[assetKey];
  if (!session || !asset) return null;
  session.updatedAt = new Date().toISOString();
  asset.updatedAt = session.updatedAt;
  await writeSession(session);
  return asset;
}

export async function getTempAssetByUrl(sessionId: string, url: string) {
  const assetKey = createAssetKey(url);
  return await getTempAssetByKey(sessionId, assetKey);
}

export async function readTempAssetBuffer(sessionId: string, assetKey: string) {
  const asset = await getTempAssetByKey(sessionId, assetKey);
  if (!asset) return null;
  const buffer = await fs.readFile(asset.filePath).catch(() => null);
  if (!buffer) return null;
  return { asset, buffer };
}

export async function releaseTempAsset(params: {
  sessionId: string;
  assetKey?: string;
  url?: string;
}) {
  const session = await readSession(params.sessionId);
  if (!session) return;
  const assetKey = params.assetKey || (params.url ? createAssetKey(params.url) : '');
  if (!assetKey || !session.assets[assetKey]) return;
  const asset = session.assets[assetKey];
  delete session.assets[assetKey];
  session.updatedAt = new Date().toISOString();
  await fs.rm(asset.filePath, { force: true }).catch(() => {});
  if (Object.keys(session.assets).length === 0) {
    await clearImportSession(params.sessionId);
    return;
  }
  await writeSession(session);
}
