/**
 * Cache Storage Abstraction Layer
 * 
 * Provides a unified interface for persistent cache storage.
 * Currently implements file-based storage, but can be swapped for Redis.
 * 
 * To switch to Redis later, implement ICacheStorage and set CACHE_STORAGE_TYPE=redis
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
const CACHE_VERSION = 1;

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
 * Redis cache storage implementation (placeholder)
 * Implement this class when switching to Redis
 * 
 * Example with ioredis:
 * ```
 * import Redis from 'ioredis';
 * 
 * class RedisCacheStorage implements ICacheStorage {
 *   private client: Redis;
 *   
 *   constructor() {
 *     this.client = new Redis(process.env.REDIS_URL);
 *   }
 *   
 *   async get<T>(key: string): Promise<CacheData<T> | null> {
 *     const data = await this.client.get(`cache:${key}`);
 *     return data ? JSON.parse(data) : null;
 *   }
 *   
 *   async set<T>(key: string, data: T, timestamp?: number): Promise<void> {
 *     const cacheData: CacheData<T> = { data, timestamp: timestamp ?? Date.now(), version: CACHE_VERSION };
 *     await this.client.set(`cache:${key}`, JSON.stringify(cacheData));
 *   }
 *   
 *   async delete(key: string): Promise<void> {
 *     await this.client.del(`cache:${key}`);
 *   }
 *   
 *   async exists(key: string): Promise<boolean> {
 *     return (await this.client.exists(`cache:${key}`)) === 1;
 *   }
 * }
 * ```
 */

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
      // TODO: Implement Redis storage
      throw new Error('Redis storage not yet implemented. Set CACHE_STORAGE_TYPE=file or implement RedisCacheStorage.');
    
    case 'file':
    default:
      storageInstance = new FileCacheStorage(cacheDir);
      return storageInstance;
  }
}

// Export for testing or direct use
export { FileCacheStorage, CACHE_VERSION };
