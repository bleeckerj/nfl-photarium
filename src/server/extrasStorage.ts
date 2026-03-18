/**
 * Extras Storage
 *
 * Stores "extra" per-image metadata that does not belong in Cloudflare Images metadata.
 *
 * This is intentionally separate from `cacheStorage` so that:
 * - cache schema/version bumps don't invalidate durable extras
 * - extras can evolve independently of cached Cloudflare list payloads
 *
 * Configuration:
 *   EXTRAS_STORAGE_TYPE=auto|redis|file (default: auto)
 *   EXTRAS_STORAGE_DIR=/path/to/extras (for file storage; default: .extras)
 *   REDIS_URL=redis://localhost:6379 (for Redis storage)
 */

import { promises as fs } from 'fs';
import os from 'node:os';
import path from 'path';

export interface IExtrasStorage {
  get<T>(key: string): Promise<T | null>;
  getMany<T>(keys: string[]): Promise<Record<string, T | null>>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  listKeysByPrefix(prefix: string): Promise<string[]>;
  exists(key: string): Promise<boolean>;
}

class FileExtrasStorage implements IExtrasStorage {
  private baseDir: string;
  private writeQueue: Map<string, Promise<void>> = new Map();

  constructor(baseDir?: string) {
    const defaultDir = process.env.NODE_ENV === 'development'
      ? path.join(os.tmpdir(), 'photarium-extras')
      : path.join(process.cwd(), '.extras');
    this.baseDir = baseDir ?? defaultDir;
  }

  private sanitizeKey(key: string): string {
    return key.replace(/[^a-zA-Z0-9_-]/g, '_');
  }

  private getFilePath(key: string): string {
    const safeKey = this.sanitizeKey(key);
    return path.join(this.baseDir, `${safeKey}.json`);
  }

  private async ensureDir(): Promise<void> {
    await fs.mkdir(this.baseDir, { recursive: true });
  }

  async get<T>(key: string): Promise<T | null> {
    const filePath = this.getFilePath(key);
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(content) as T;
      return parsed ?? null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      console.warn(`[Extras:File] Failed to read ${filePath}:`, error);
      return null;
    }
  }

  async getMany<T>(keys: string[]): Promise<Record<string, T | null>> {
    const result: Record<string, T | null> = {};
    await Promise.all(
      keys.map(async (key) => {
        result[key] = await this.get<T>(key);
      })
    );
    return result;
  }

  async set<T>(key: string, value: T): Promise<void> {
    const existingWrite = this.writeQueue.get(key);
    if (existingWrite) {
      await existingWrite;
    }

    const writePromise = this.doWrite(key, value);
    this.writeQueue.set(key, writePromise);

    try {
      await writePromise;
    } finally {
      this.writeQueue.delete(key);
    }
  }

  private async doWrite<T>(key: string, value: T): Promise<void> {
    await this.ensureDir();
    const filePath = this.getFilePath(key);
    const tmpPath = `${filePath}.tmp`;
    await fs.writeFile(tmpPath, JSON.stringify(value), 'utf-8');
    await fs.rename(tmpPath, filePath);
  }

  async delete(key: string): Promise<void> {
    const filePath = this.getFilePath(key);
    try {
      await fs.unlink(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  async listKeysByPrefix(prefix: string): Promise<string[]> {
    const sanitizedPrefix = this.sanitizeKey(prefix);
    try {
      const entries = await fs.readdir(this.baseDir, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
        .map((entry) => entry.name.slice(0, -5))
        .filter((sanitizedKey) => sanitizedKey.startsWith(sanitizedPrefix))
        .map((sanitizedKey) => `${prefix}${sanitizedKey.slice(sanitizedPrefix.length)}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(this.getFilePath(key));
      return true;
    } catch {
      return false;
    }
  }
}

interface RedisClient {
  get(key: string): Promise<string | null>;
  mget(...keys: string[]): Promise<Array<string | null>>;
  set(key: string, value: string): Promise<unknown>;
  del(key: string): Promise<number>;
  scan(cursor: string, ...args: string[]): Promise<[string, string[]]>;
  exists(key: string): Promise<number>;
  quit(): Promise<unknown>;
  connect(): Promise<void>;
  on(event: string, callback: (arg?: unknown) => void): void;
}

class RedisExtrasStorage implements IExtrasStorage {
  private client: RedisClient | null = null;
  private connectionPromise: Promise<void> | null = null;
  private readonly keyPrefix = 'photarium:extras:';

  private async getClient(): Promise<RedisClient> {
    if (this.client) return this.client;
    if (this.connectionPromise) {
      await this.connectionPromise;
      return this.client!;
    }

    this.connectionPromise = this.connect();
    await this.connectionPromise;
    return this.client!;
  }

  private async connect(): Promise<void> {
    try {
      const Redis = (await import(/* webpackIgnore: true */ 'ioredis' as string)).default;
      const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';

      const client = new Redis(redisUrl, {
        maxRetriesPerRequest: 3,
        retryDelayOnFailover: 100,
        lazyConnect: true
      });

      client.on('error', (err: Error) => {
        console.error('[Extras:Redis] Connection error:', err.message);
      });

      client.on('connect', () => {
        console.log('[Extras:Redis] Connected successfully');
      });

      await client.connect();
      this.client = client as unknown as RedisClient;
    } catch (error) {
      this.client = null;
      this.connectionPromise = null;
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to connect to Redis (extras): ${message}`);
    }
  }

  private fullKey(key: string): string {
    return `${this.keyPrefix}${key}`;
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const client = await this.getClient();
      const raw = await client.get(this.fullKey(key));
      if (!raw) return null;
      return JSON.parse(raw) as T;
    } catch (error) {
      console.warn(`[Extras:Redis] Failed to get key ${key}:`, error);
      return null;
    }
  }

  async getMany<T>(keys: string[]): Promise<Record<string, T | null>> {
    const result: Record<string, T | null> = {};
    if (keys.length === 0) return result;

    try {
      const client = await this.getClient();
      const fullKeys = keys.map((key) => this.fullKey(key));
      const values = await client.mget(...fullKeys);

      keys.forEach((key, idx) => {
        const raw = values[idx];
        if (!raw) {
          result[key] = null;
          return;
        }
        try {
          result[key] = JSON.parse(raw) as T;
        } catch {
          result[key] = null;
        }
      });

      return result;
    } catch (error) {
      console.warn('[Extras:Redis] Failed to mget keys:', error);
      keys.forEach((key) => {
        result[key] = null;
      });
      return result;
    }
  }

  async set<T>(key: string, value: T): Promise<void> {
    const client = await this.getClient();
    await client.set(this.fullKey(key), JSON.stringify(value));
  }

  async delete(key: string): Promise<void> {
    const client = await this.getClient();
    await client.del(this.fullKey(key));
  }

  async listKeysByPrefix(prefix: string): Promise<string[]> {
    const client = await this.getClient();
    const fullPrefix = this.fullKey(prefix);
    const keys: string[] = [];
    let cursor = '0';

    do {
      const [nextCursor, batch] = await client.scan(cursor, 'MATCH', `${fullPrefix}*`, 'COUNT', '200');
      cursor = nextCursor;
      for (const fullKey of batch) {
        if (fullKey.startsWith(this.keyPrefix)) {
          keys.push(fullKey.slice(this.keyPrefix.length));
        }
      }
    } while (cursor !== '0');

    return keys;
  }

  async exists(key: string): Promise<boolean> {
    try {
      const client = await this.getClient();
      return (await client.exists(this.fullKey(key))) === 1;
    } catch {
      return false;
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.client = null;
      this.connectionPromise = null;
    }
  }
}

let extrasInstance: IExtrasStorage | null = null;

export function getExtrasStorage(): IExtrasStorage {
  if (extrasInstance) return extrasInstance;

  const storageType = (process.env.EXTRAS_STORAGE_TYPE ?? 'auto').toLowerCase();
  const extrasDir = process.env.EXTRAS_STORAGE_DIR;

  const shouldUseRedis =
    storageType === 'redis' ||
    (storageType === 'auto' && ((process.env.CACHE_STORAGE_TYPE ?? '').toLowerCase() === 'redis' || Boolean(process.env.REDIS_URL)));

  if (shouldUseRedis) {
    console.log('[Extras] Using Redis storage');
    extrasInstance = new RedisExtrasStorage();
    return extrasInstance;
  }

  console.log('[Extras] Using file-based storage');
  extrasInstance = new FileExtrasStorage(extrasDir);
  return extrasInstance;
}

export { FileExtrasStorage, RedisExtrasStorage };
