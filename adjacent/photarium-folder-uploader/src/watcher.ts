import fs from 'node:fs/promises';
import { watch, type FSWatcher } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { checkpointKey, hashFile, loadCheckpoint, markStage, saveCheckpoint } from './checkpoint.js';
import type { Checkpoint, CheckpointEntry, PhotariumClient, UploaderConfig } from './types.js';

interface FileSnapshot {
  size: number;
  mtimeMs: number;
}

export interface WatcherOptions {
  dryRun?: boolean;
  logger?: (message: string) => void;
}

function timestamp(): string {
  return new Date().toISOString();
}

function isImage(filePath: string, extensions: string[]): boolean {
  return extensions.includes(path.extname(filePath).toLowerCase());
}

async function stableSnapshot(filePath: string, pollMs: number, checks: number): Promise<FileSnapshot | null> {
  let previous: FileSnapshot | undefined;
  for (let index = 0; index < checks; index += 1) {
    try {
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) return null;
      const current = { size: stat.size, mtimeMs: stat.mtimeMs };
      if (previous && previous.size === current.size && previous.mtimeMs === current.mtimeMs) return current;
      previous = current;
      await delay(pollMs);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }
  return previous ?? null;
}

async function listTopLevelImages(root: string, extensions: string[]): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(root, entry.name))
    .filter((filePath) => isImage(filePath, extensions));
}

export class FolderWatcher {
  private readonly config: UploaderConfig;
  private readonly client: PhotariumClient;
  private readonly dryRun: boolean;
  private readonly log: (message: string) => void;
  private checkpoint: Checkpoint = { version: 1, entries: {} };
  private readonly active = new Set<string>();
  private readonly queued = new Set<string>();
  private readonly retryTimers = new Set<NodeJS.Timeout>();
  private watcher?: FSWatcher;
  private stopped = false;

  constructor(config: UploaderConfig, client: PhotariumClient, options: WatcherOptions = {}) {
    this.config = config;
    this.client = client;
    this.dryRun = options.dryRun ?? false;
    this.log = options.logger ?? console.log;
  }

  async start(): Promise<void> {
    await fs.mkdir(this.config.watchPath, { recursive: true });
    this.checkpoint = await loadCheckpoint(this.config.stateFile);
    if (!this.dryRun) await this.client.connect();
    await this.scan();
    if (!this.dryRun) {
      this.watcher = watch(this.config.watchPath, (eventType, filename) => {
        if (!filename) return;
        const filePath = path.join(this.config.watchPath, filename.toString());
        if (eventType === 'rename' || eventType === 'change') this.enqueue(filePath);
      });
      this.watcher.on('error', (error) => this.log(`[${timestamp()}] watcher error: ${error.message}`));
      this.log(`[${timestamp()}] watching ${this.config.watchPath}`);
    }
  }

  async scan(): Promise<void> {
    const files = await listTopLevelImages(this.config.watchPath, this.config.extensions);
    this.log(`[${timestamp()}] found ${files.length} eligible image${files.length === 1 ? '' : 's'}`);
    await Promise.all(files.map((filePath) => this.enqueue(filePath)));
    await this.waitForQueue();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.queued.clear();
    this.watcher?.close();
    for (const timer of this.retryTimers) clearTimeout(timer);
    this.retryTimers.clear();
    await this.waitForQueue();
    await this.client.close();
  }

  private enqueue(filePath: string): Promise<void> {
    if (this.stopped || !isImage(filePath, this.config.extensions) || this.queued.has(filePath) || this.active.has(filePath)) {
      return Promise.resolve();
    }
    this.queued.add(filePath);
    return this.drain();
  }

  private async drain(): Promise<void> {
    while (!this.stopped && this.active.size < this.config.concurrency && this.queued.size > 0) {
      const next = this.queued.values().next().value as string | undefined;
      if (!next) return;
      this.queued.delete(next);
      this.active.add(next);
      void this.process(next).finally(() => {
        this.active.delete(next);
        void this.drain();
      });
    }
  }

  private async waitForQueue(): Promise<void> {
    while (this.queued.size > 0 || this.active.size > 0) await delay(25);
  }

  private async persist(): Promise<void> {
    await saveCheckpoint(this.config.stateFile, this.checkpoint);
  }

  private async process(filePath: string): Promise<void> {
    const relativePath = path.relative(this.config.watchPath, filePath) || path.basename(filePath);
    try {
      const snapshot = await stableSnapshot(filePath, this.config.stability.pollMs, this.config.stability.checks);
      if (!snapshot) return;
      const contentHash = await hashFile(filePath);
      const key = checkpointKey(this.config.namespace, contentHash);
      const existing = this.checkpoint.entries[key];
      if (existing?.completed.includes('tags')) {
        this.log(`[${timestamp()}] skip ${relativePath} (already complete as ${existing.imageId ?? 'unknown'})`);
        return;
      }
      if (this.dryRun) {
        this.log(`[${timestamp()}] dry-run ${relativePath} -> namespace ${this.config.namespace}`);
        return;
      }

      let entry: CheckpointEntry = existing ?? {
        namespace: this.config.namespace,
        contentHash,
        lastPath: relativePath,
        completed: [],
        attempts: 0,
        updatedAt: new Date().toISOString(),
      };
      entry = { ...entry, lastPath: relativePath, attempts: entry.attempts + 1, updatedAt: new Date().toISOString() };
      this.checkpoint.entries[key] = entry;
      await this.persist();
      this.log(`[${timestamp()}] processing ${relativePath}`);

      if (!entry.completed.includes('uploaded')) {
        const uploaded = await this.client.uploadFromPath(filePath, this.config.namespace);
        entry = { ...entry, imageId: uploaded.imageId };
        entry = markStage(entry, 'uploaded');
        this.checkpoint.entries[key] = entry;
        await this.persist();
        this.log(`[${timestamp()}] uploaded ${relativePath} -> ${uploaded.imageId}`);
      }
      const imageId = entry.imageId;
      if (!imageId) throw new Error('Checkpoint has upload completion without an image ID.');
      if (!entry.completed.includes('description')) {
        await this.client.generateDescription(imageId);
        entry = markStage(entry, 'description');
        this.checkpoint.entries[key] = entry;
        await this.persist();
        this.log(`[${timestamp()}] description generated for ${imageId}`);
      }
      if (!entry.completed.includes('tags')) {
        await this.client.generateTags(imageId, this.config.tagCount);
        entry = markStage(entry, 'tags');
        this.checkpoint.entries[key] = entry;
        await this.persist();
        this.log(`[${timestamp()}] semantic tags generated for ${imageId}`);
      }
      this.log(`[${timestamp()}] complete ${relativePath} -> ${imageId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const contentHash = await hashFile(filePath).catch(() => undefined);
      if (contentHash) {
        const key = checkpointKey(this.config.namespace, contentHash);
        const existing = this.checkpoint.entries[key];
        this.checkpoint.entries[key] = {
          ...(existing ?? {
            namespace: this.config.namespace,
            contentHash,
            lastPath: relativePath,
            completed: [],
            attempts: 1,
            updatedAt: new Date().toISOString(),
          }),
          lastPath: relativePath,
          lastError: message,
          updatedAt: new Date().toISOString(),
        };
        await this.persist().catch(() => undefined);
      }
      this.log(`[${timestamp()}] failed ${relativePath}: ${message}`);
      const entry = contentHash ? this.checkpoint.entries[checkpointKey(this.config.namespace, contentHash)] : undefined;
      if (entry && entry.attempts < this.config.retry.maxAttempts && !this.stopped) {
        const timer = setTimeout(() => {
          this.retryTimers.delete(timer);
          this.enqueue(filePath);
        }, this.config.retry.delayMs);
        this.retryTimers.add(timer);
      }
    }
  }
}
