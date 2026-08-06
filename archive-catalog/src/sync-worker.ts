import { parentPort, workerData } from 'node:worker_threads';
import { openCatalogDatabase } from './db.js';
import { syncArchive, type SyncResult } from './sync.js';

interface SyncWorkerData {
  databasePath: string;
  sourceRoot: string;
  hashFiles: boolean;
  allowLockedCatalog: boolean;
  checkAvailability: boolean;
  stageCatalogs: boolean;
  catalogPaths?: string[];
}

interface WorkerMessage {
  status: 'complete' | 'failed';
  result?: SyncResult;
  error?: string;
}

if (!parentPort) throw new Error('Archive sync worker requires a parent port.');

const input = workerData as SyncWorkerData;
const database = openCatalogDatabase(input.databasePath);

try {
  const result = await syncArchive({
    sourceRoot: input.sourceRoot,
    database,
    hashFiles: input.hashFiles,
    allowLockedCatalog: input.allowLockedCatalog,
    checkAvailability: input.checkAvailability,
    stageCatalogs: input.stageCatalogs,
    catalogPaths: input.catalogPaths,
  });
  parentPort.postMessage({ status: 'complete', result } satisfies WorkerMessage);
} catch (error: unknown) {
  parentPort.postMessage({
    status: 'failed',
    error: error instanceof Error ? error.message : String(error),
  } satisfies WorkerMessage);
} finally {
  database.close();
}
