/**
 * Cache Storage Abstraction Layer
 * 
 * Provides a unified interface for persistent cache storage.
 * Supports file-based storage (default) and Redis.
 * 
 * Configuration:
 *   CACHE_STORAGE_TYPE=file|redis (default: file)
 *   CACHE_STORAGE_DIR=/path/to/.cache (for file storage)
 *   REDIS_URL=redis://localhost:6379 (for Redis storage)
 */

import { promises as fs } from 'fs';
import path from 'path';

export interface CacheData<T> {
  data: T;
  timestamp: number;
  version: number;
}

export interface ICacheStorage {
  get<T>(key: string): Promise<CacheData<T> | null>;
  set<T>(key: string, data: T, timestamp?: number): Promise<void>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

// Current cache format version - increment when CachedCloudflareImage shape changes
// v2: Added vector search fields (hasClipEmbedding, hasColorEmbedding, dominantColors, averageColor)
const CACHE_VERSION = 2;

/**
 * File-based cache storage implementation
 * Stores cache as JSON files in the .cache directory
 */
class FileCacheStorage implements ICacheStorage {
  private cacheDir: string;
  private writeQueue: Map<string, Promise<void>> = new Map();

  constructor(cacheDir?: string) {
    this.cacheDir = cacheDir ?? path.join(process.cwd(), '.cache');
  }

  private getFilePath(key: string): string {
    // Sanitize key to be filesystem-safe
    const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this.cacheDir, `${safeKey}.json`);
  }

  private async ensureCacheDir(): Promise<void> {
    try {
      await fs.mkdir(this.cacheDir, { recursive: true });
    } catch (error) {
      // Directory might already exist
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }
    }
  }

  async get<T>(key: string): Promise<CacheData<T> | null> {
    const filePath = this.getFilePath(key);
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(content) as CacheData<T>;
      
      // Validate cache version
      if (parsed.version !== CACHE_VERSION) {
        console.log(`Cache version mismatch for ${key}: expected ${CACHE_VERSION}, got ${parsed.version}`);
        return null;
      }
      
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      console.warn(`Failed to read cache file ${filePath}:`, error);
      return null;
    }
  }

  async set<T>(key: string, data: T, timestamp?: number): Promise<void> {
    // Queue writes to prevent concurrent writes to the same file
    const existingWrite = this.writeQueue.get(key);
    if (existingWrite) {
      await existingWrite;
    }

    const writePromise = this.doWrite(key, data, timestamp);
    this.writeQueue.set(key, writePromise);
    
    try {
      await writePromise;
    } finally {
      this.writeQueue.delete(key);
    }
  }

  private async doWrite<T>(key: string, data: T, timestamp?: number): Promise<void> {
    await this.ensureCacheDir();
    const filePath = this.getFilePath(key);
    const tempPath = `${filePath}.tmp`;

    const cacheData: CacheData<T> = {
      data,
      timestamp: timestamp ?? Date.now(),
      version: CACHE_VERSION
    };

    try {
      // Write to temp file first, then rename (atomic operation)
      await fs.writeFile(tempPath, JSON.stringify(cacheData), 'utf-8');
      await fs.rename(tempPath, filePath);
    } catch (error) {
      // Clean up temp file if it exists
      try {
        await fs.unlink(tempPath);
      } catch {
        // Ignore cleanup errors
      }
      throw error;
    }
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

  async exists(key: string): Promise<boolean> {
    const filePath = this.getFilePath(key);
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Redis cache storage implementation
 * 
 * To use Redis:
 * 1. Install ioredis: npm install ioredis
 * 2. Set environment variables:
 *    - CACHE_STORAGE_TYPE=redis
 *    - REDIS_URL=redis://localhost:6379 (or your Redis URL)
 * 
 * Running Redis locally:
 *   - macOS: brew install redis && redis-server
 *   - Docker: docker run -d -p 6379:6379 redis:alpine
 *   - Docker Compose: see docs/FUTURE_SEARCH_FEATURES.md
 */

// Redis client type (loosely typed to avoid requiring ioredis as a dependency)
interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
  del(key: string): Promise<number>;
  exists(key: string): Promise<number>;
  quit(): Promise<unknown>;
  connect(): Promise<void>;
  on(event: string, callback: (arg?: unknown) => void): void;
}

class RedisCacheStorage implements ICacheStorage {
  private client: RedisClient | null = null;
  private connectionPromise: Promise<void> | null = null;
  private readonly keyPrefix = 'photarium:cache:';

  private async getClient(): Promise<RedisClient> {
    if (this.client) {
      return this.client;
    }

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
      // Dynamic import to avoid requiring ioredis when using file storage
       
      const Redis = (await import(/* webpackIgnore: true */ 'ioredis' as string)).default;
      const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
      
      const client = new Redis(redisUrl, {
        maxRetriesPerRequest: 3,
        retryDelayOnFailover: 100,
        lazyConnect: true
      });

      client.on('error', (err: Error) => {
        console.error('[Redis] Connection error:', err.message);
      });

      client.on('connect', () => {
        console.log('[Redis] Connected successfully');
      });

      await client.connect();
      this.client = client as unknown as RedisClient;
    } catch (error) {
      this.client = null;
      this.connectionPromise = null;
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to connect to Redis: ${message}. Did you install ioredis? Run: npm install ioredis`);
    }
  }

  async get<T>(key: string): Promise<CacheData<T> | null> {
    try {
      const client = await this.getClient();
      const data = await client.get(`${this.keyPrefix}${key}`);
      
      if (!data) {
        return null;
      }

      const parsed = JSON.parse(data) as CacheData<T>;
      
      // Validate cache version
      if (parsed.version !== CACHE_VERSION) {
        console.log(`[Redis] Cache version mismatch for ${key}: expected ${CACHE_VERSION}, got ${parsed.version}`);
        return null;
      }
      
      return parsed;
    } catch (error) {
      console.warn(`[Redis] Failed to get key ${key}:`, error);
      return null;
    }
  }

  async set<T>(key: string, data: T, timestamp?: number): Promise<void> {
    try {
      const client = await this.getClient();
      const cacheData: CacheData<T> = {
        data,
        timestamp: timestamp ?? Date.now(),
        version: CACHE_VERSION
      };
      
      await client.set(`${this.keyPrefix}${key}`, JSON.stringify(cacheData));
    } catch (error) {
      console.warn(`[Redis] Failed to set key ${key}:`, error);
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      const client = await this.getClient();
      await client.del(`${this.keyPrefix}${key}`);
    } catch (error) {
      console.warn(`[Redis] Failed to delete key ${key}:`, error);
      throw error;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      const client = await this.getClient();
      return (await client.exists(`${this.keyPrefix}${key}`)) === 1;
    } catch (error) {
      console.warn(`[Redis] Failed to check existence of key ${key}:`, error);
      return false;
    }
  }

  /**
   * Gracefully close the Redis connection
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.client = null;
      this.connectionPromise = null;
    }
  }
}

// Factory function to get the appropriate storage implementation
let storageInstance: ICacheStorage | null = null;

export function getCacheStorage(): ICacheStorage {
  if (storageInstance) {
    return storageInstance;
  }

  const storageType = process.env.CACHE_STORAGE_TYPE ?? 'file';
  const cacheDir = process.env.CACHE_STORAGE_DIR;

  switch (storageType) {
    case 'redis':
      console.log('[Cache] Using Redis storage');
      storageInstance = new RedisCacheStorage();
      return storageInstance;
    
    case 'file':
    default:
      console.log('[Cache] Using file-based storage');
      storageInstance = new FileCacheStorage(cacheDir);
      return storageInstance;
  }
}

// Export for testing or direct use
export { FileCacheStorage, RedisCacheStorage, CACHE_VERSION };
