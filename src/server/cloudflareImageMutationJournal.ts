import { getCacheStorage } from './cacheStorage';
import type { CachedCloudflareImage } from './cloudflareImageCacheMapper';

export type CloudflareImageMutation =
  | {
      kind: 'upsert';
      imageId: string;
      image: CachedCloudflareImage;
      recordedAt: number;
    }
  | {
      kind: 'delete';
      imageId: string;
      recordedAt: number;
    };

type MutationJournalState = {
  entries: Map<string, CloudflareImageMutation>;
  loaded: boolean;
  loadPromise: Promise<void> | null;
  writePromise: Promise<void>;
};

const MUTATION_JOURNAL_KEY = 'cloudflare-image-mutation-journal';
const GLOBAL_JOURNAL_KEY = Symbol.for('photarium.cloudflareImageMutationJournal');
const globalObject = globalThis as typeof globalThis & {
  [GLOBAL_JOURNAL_KEY]?: MutationJournalState;
};

const journalState: MutationJournalState = globalObject[GLOBAL_JOURNAL_KEY] ?? {
  entries: new Map(),
  loaded: false,
  loadPromise: null,
  writePromise: Promise.resolve(),
};

if (!globalObject[GLOBAL_JOURNAL_KEY]) {
  globalObject[GLOBAL_JOURNAL_KEY] = journalState;
}

const mergeMutation = (mutation: CloudflareImageMutation) => {
  const existing = journalState.entries.get(mutation.imageId);
  if (!existing || existing.recordedAt <= mutation.recordedAt) {
    journalState.entries.set(mutation.imageId, mutation);
  }
};

const ensureJournalLoaded = async () => {
  if (journalState.loaded) return;
  if (journalState.loadPromise) return journalState.loadPromise;

  journalState.loadPromise = (async () => {
    const pending = Array.from(journalState.entries.values());
    const cached = await getCacheStorage().get<CloudflareImageMutation[]>(MUTATION_JOURNAL_KEY);
    journalState.entries = new Map();
    for (const mutation of cached?.data ?? []) {
      if (
        mutation &&
        typeof mutation.imageId === 'string' &&
        typeof mutation.recordedAt === 'number' &&
        (mutation.kind === 'upsert' || mutation.kind === 'delete')
      ) {
        mergeMutation(mutation);
      }
    }
    pending.forEach(mergeMutation);
    journalState.loaded = true;
  })().finally(() => {
    journalState.loadPromise = null;
  });

  return journalState.loadPromise;
};

const persistJournal = async () => {
  await ensureJournalLoaded();
  await getCacheStorage().set(
    MUTATION_JOURNAL_KEY,
    Array.from(journalState.entries.values())
  );
};

export const recordCloudflareImageMutation = (
  mutation: CloudflareImageMutation
): Promise<void> => {
  mergeMutation(mutation);
  const write = journalState.writePromise
    .catch(() => undefined)
    .then(persistJournal);
  journalState.writePromise = write;
  return write;
};

export const getCloudflareImageMutations = async (): Promise<CloudflareImageMutation[]> => {
  await ensureJournalLoaded();
  await journalState.writePromise.catch(() => undefined);
  return Array.from(journalState.entries.values());
};

export const applyCloudflareImageMutations = (
  images: CachedCloudflareImage[],
  mutations: CloudflareImageMutation[]
): CachedCloudflareImage[] => {
  if (mutations.length === 0) return images;
  const map = new Map(images.map((image) => [image.id, image]));
  for (const mutation of mutations.sort((a, b) => a.recordedAt - b.recordedAt)) {
    if (mutation.kind === 'delete') {
      map.delete(mutation.imageId);
    } else {
      map.set(mutation.imageId, mutation.image);
    }
  }
  return Array.from(map.values());
};

export const compactCloudflareImageMutationJournal = async (
  persistedThrough: number
): Promise<void> => {
  const write = journalState.writePromise
    .catch(() => undefined)
    .then(async () => {
      await ensureJournalLoaded();
      for (const [imageId, mutation] of journalState.entries) {
        if (mutation.recordedAt <= persistedThrough) {
          journalState.entries.delete(imageId);
        }
      }
      await persistJournal();
    });
  journalState.writePromise = write;
  await write;
};

export const acknowledgeCloudflareImageMutations = async (
  reflectedMutations: CloudflareImageMutation[]
): Promise<void> => {
  if (reflectedMutations.length === 0) return;
  const write = journalState.writePromise
    .catch(() => undefined)
    .then(async () => {
      await ensureJournalLoaded();
      for (const reflected of reflectedMutations) {
        const current = journalState.entries.get(reflected.imageId);
        if (current && current.recordedAt <= reflected.recordedAt) {
          journalState.entries.delete(reflected.imageId);
        }
      }
      await persistJournal();
    });
  journalState.writePromise = write;
  await write;
};

export const clearCloudflareImageMutationJournal = async (): Promise<void> => {
  await journalState.writePromise.catch(() => undefined);
  journalState.entries.clear();
  journalState.loaded = true;
  journalState.loadPromise = null;
  journalState.writePromise = Promise.resolve();
  await getCacheStorage().delete(MUTATION_JOURNAL_KEY);
};
