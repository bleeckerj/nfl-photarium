import fs from 'node:fs/promises';
import { watch, type FSWatcher } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { checkpointKey, hashFile, isCheckpointComplete, loadCheckpoint, markStage, saveCheckpoint } from './checkpoint.js';
import { mediaTypeForPath, type MediaType } from './media.js';
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

async function listTopLevelMedia(root: string, extensions: string[]): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(root, entry.name))
    .filter((filePath) => mediaTypeForPath(filePath, extensions) !== null);
}

function isMediaComplete(entry: CheckpointEntry): boolean {
  return isCheckpointComplete(entry);
}

type IndexedCheckpointEntry = {
  key: string;
  entry: CheckpointEntry;
};

export class FolderWatcher {
  private readonly config: UploaderConfig;
  private readonly client: PhotariumClient;
  private readonly dryRun: boolean;
  private readonly log: (message: string) => void;
  private checkpoint: Checkpoint = { version: 1, entries: {} };
  private readonly active = new Set<string>();
  private readonly queued = new Set<string>();
  private readonly retryTimers = new Set<NodeJS.Timeout>();
  private readonly pathIndex = new Map<string, IndexedCheckpointEntry>();
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
    this.rebuildPathIndex();
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
    const files = await listTopLevelMedia(this.config.watchPath, this.config.extensions);
    this.log(`[${timestamp()}] found ${files.length} eligible media file${files.length === 1 ? '' : 's'}`);
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
    if (this.stopped || mediaTypeForPath(filePath, this.config.extensions) === null || this.queued.has(filePath) || this.active.has(filePath)) {
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

  private rebuildPathIndex(): void {
    this.pathIndex.clear();
    for (const [key, entry] of Object.entries(this.checkpoint.entries)) {
      if (!entry.lastPath) continue;
      const indexKey = `${entry.namespace}\n${entry.lastPath}`;
      const current = this.pathIndex.get(indexKey);
      if (!current || current.entry.updatedAt < entry.updatedAt) {
        this.pathIndex.set(indexKey, { key, entry });
      }
    }
  }

  private updatePathIndex(key: string, entry: CheckpointEntry): void {
    this.pathIndex.set(`${entry.namespace}\n${entry.lastPath}`, { key, entry });
  }

  private async readSnapshot(filePath: string): Promise<FileSnapshot | null> {
    try {
      const stat = await fs.stat(filePath);
      return stat.isFile() ? { size: stat.size, mtimeMs: stat.mtimeMs } : null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  private async skipKnownPath(filePath: string, snapshot: FileSnapshot): Promise<boolean> {
    const relativePath = path.relative(this.config.watchPath, filePath) || path.basename(filePath);
    const indexed = this.pathIndex.get(`${this.config.namespace}\n${relativePath}`);
    if (!indexed || !isMediaComplete(indexed.entry)) return false;
    if (indexed.entry.size !== snapshot.size || indexed.entry.mtimeMs !== snapshot.mtimeMs) return false;
    this.log(`[${timestamp()}] skip ${relativePath} (already complete as ${indexed.entry.videoId ?? indexed.entry.imageId ?? 'unknown'})`);
    return true;
  }

  private async process(filePath: string): Promise<void> {
    const relativePath = path.relative(this.config.watchPath, filePath) || path.basename(filePath);
    let snapshot: FileSnapshot | null = null;
    try {
      const initialSnapshot = await this.readSnapshot(filePath);
      if (!initialSnapshot || await this.skipKnownPath(filePath, initialSnapshot)) return;
      snapshot = await stableSnapshot(filePath, this.config.stability.pollMs, this.config.stability.checks);
      if (!snapshot) return;
      const contentHash = await hashFile(filePath);
      const key = checkpointKey(this.config.namespace, contentHash);
      const existing = this.checkpoint.entries[key];
      if (existing && isMediaComplete(existing)) {
        const updated = {
          ...existing,
          lastPath: relativePath,
          size: snapshot.size,
          mtimeMs: snapshot.mtimeMs,
          updatedAt: new Date().toISOString(),
        };
        this.checkpoint.entries[key] = updated;
        this.updatePathIndex(key, updated);
        await this.persist();
        this.log(`[${timestamp()}] skip ${relativePath} (already complete as ${existing.videoId ?? existing.imageId ?? 'unknown'})`);
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
      entry = {
        ...entry,
        lastPath: relativePath,
        size: snapshot.size,
        mtimeMs: snapshot.mtimeMs,
        attempts: entry.attempts + 1,
        updatedAt: new Date().toISOString(),
      };
      this.checkpoint.entries[key] = entry;
      this.updatePathIndex(key, entry);
      await this.persist();
      this.log(`[${timestamp()}] processing ${relativePath}`);

      if (!entry.completed.includes('uploaded')) {
        const mediaType = mediaTypeForPath(filePath, this.config.extensions) as MediaType;
        const uploaded = mediaType === 'video'
          ? await this.uploadVideo(filePath)
          : await this.client.uploadFromPath(filePath, this.config.namespace, this.config.tags, this.config.tagCount);
        entry = {
          ...entry,
          assetType: uploaded.assetType ?? mediaType,
          imageId: uploaded.imageId,
          ...(uploaded.videoId ? { videoId: uploaded.videoId } : {}),
          ...(uploaded.semanticTagging?.jobId ? { semanticTagJobId: uploaded.semanticTagging.jobId } : {}),
        };
        entry = markStage(entry, 'uploaded');
        if (mediaType === 'video') {
          entry = markStage(entry, 'description');
          entry = markStage(entry, 'tags');
        }
        this.checkpoint.entries[key] = entry;
        this.updatePathIndex(key, entry);
        await this.persist();
        this.log(`[${timestamp()}] uploaded ${relativePath} -> ${uploaded.videoId ?? uploaded.imageId}`);
      }
      if (entry.assetType === 'video') {
        this.log(`[${timestamp()}] complete ${relativePath} -> ${entry.videoId ?? entry.imageId}`);
        return;
      }
      const imageId = entry.imageId;
      if (!imageId) throw new Error('Checkpoint has upload completion without an image ID.');
      if (!entry.completed.includes('description')) {
        await this.client.generateDescription(imageId);
        entry = markStage(entry, 'description');
        this.checkpoint.entries[key] = entry;
        this.updatePathIndex(key, entry);
        await this.persist();
        this.log(`[${timestamp()}] description generated for ${imageId}`);
      }
      if (!entry.completed.includes('tags')) {
        const jobId = entry.semanticTagJobId;
        if (!jobId) throw new Error('Upload did not return a semantic tag job ID.');
        await this.waitForSemanticTags(jobId, imageId);
        entry = markStage(entry, 'tags');
        this.checkpoint.entries[key] = entry;
        this.updatePathIndex(key, entry);
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
          size: snapshot?.size,
          mtimeMs: snapshot?.mtimeMs,
          lastError: message,
          updatedAt: new Date().toISOString(),
        };
        this.updatePathIndex(key, this.checkpoint.entries[key]);
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

  private async uploadVideo(filePath: string) {
    if (!this.client.uploadVideoFromPath) {
      throw new Error('The configured Photarium connection does not support local video uploads. Use HTTP mode for video files.');
    }
    return this.client.uploadVideoFromPath(filePath, this.config.namespace, this.config.tags);
  }

  private async waitForSemanticTags(jobId: string, imageId: string): Promise<void> {
    for (let attempt = 0; attempt < 180; attempt += 1) {
      const status = await this.client.getSemanticTagStatus(jobId);
      if (status.state === 'succeeded') {
        this.log(`[${timestamp()}] semantic tags verified for ${imageId}`);
        return;
      }
      if (status.state === 'failed' || status.state === 'disabled') {
        throw new Error(status.error || `Semantic tag job ${jobId} ended in ${status.state} state.`);
      }
      await delay(1000);
    }
    throw new Error(`Timed out waiting for semantic tag job ${jobId}.`);
  }
}
