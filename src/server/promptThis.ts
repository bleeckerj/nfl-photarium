import { getExtrasStorage } from '@/server/extrasStorage';
import {
  getImageExtrasRecord,
  getImageExtrasRecords,
  patchImageExtrasRecord,
  type PromptThisEntry,
  type PromptThisProvider
} from '@/server/imageExtras';

export type PromptThisRecord = {
  imageId: string;
  prompt: string;
  model: string;
  provider: PromptThisProvider;
  creativeBrief?: string;
  sourceRelationship?: string;
  aspectRatio?: string;
  derivationId?: string;
  createdAt: string;
  updatedAt: string;
};

export function getPromptThisKey(imageId: string): string {
  return `prompt-this:${imageId}`;
}

function fromEntry(imageId: string, entry: PromptThisEntry): PromptThisRecord {
  return {
    imageId,
    prompt: entry.prompt,
    model: entry.model,
    provider: entry.provider,
    creativeBrief: entry.creativeBrief,
    sourceRelationship: entry.sourceRelationship,
    aspectRatio: entry.aspectRatio,
    derivationId: entry.derivationId,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt
  };
}

export async function getPromptThisRecord(imageId: string): Promise<PromptThisRecord | null> {
  // Preferred location: unified image extras record
  const extras = await getImageExtrasRecord(imageId);
  if (extras?.promptThis && typeof extras.promptThis.prompt === 'string' && extras.promptThis.prompt.trim()) {
    return fromEntry(imageId, extras.promptThis);
  }

  // Backward-compatibility: old key-based record (prompt-this:<id>)
  // If present, migrate it into the extras record.
  const storage = getExtrasStorage();
  const legacy = await storage.get<PromptThisRecord>(getPromptThisKey(imageId));
  if (legacy && typeof legacy.prompt === 'string' && legacy.prompt.trim()) {
    try {
      await patchImageExtrasRecord(imageId, {
        promptThis: {
          prompt: legacy.prompt,
          model: legacy.model,
          provider: legacy.provider,
          creativeBrief: legacy.creativeBrief,
          sourceRelationship: legacy.sourceRelationship,
          aspectRatio: legacy.aspectRatio,
          derivationId: legacy.derivationId,
          createdAt: legacy.createdAt,
          updatedAt: legacy.updatedAt
        }
      });
      // Leave the legacy key in place for now (safe migration).
    } catch {
      // ignore migration errors
    }
    return legacy;
  }

  return null;
}

export async function setPromptThisRecord(record: PromptThisRecord): Promise<void> {
  await patchImageExtrasRecord(record.imageId, {
    promptThis: {
      prompt: record.prompt,
      model: record.model,
      provider: record.provider,
      creativeBrief: record.creativeBrief,
      sourceRelationship: record.sourceRelationship,
      aspectRatio: record.aspectRatio,
      derivationId: record.derivationId,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt
    }
  });
}

export async function getPromptThisRecords(imageIds: string[]): Promise<Record<string, PromptThisRecord | null>> {
  // Preferred: bulk-read the unified extras records.
  const extrasById = await getImageExtrasRecords(imageIds);
  const result: Record<string, PromptThisRecord | null> = {};

  // Fallback: for any missing prompts, check legacy keys in one go.
  const missingIds: string[] = [];
  imageIds.forEach((imageId) => {
    const entry = extrasById[imageId]?.promptThis;
    if (entry && typeof entry.prompt === 'string' && entry.prompt.trim()) {
      result[imageId] = fromEntry(imageId, entry);
    } else {
      result[imageId] = null;
      missingIds.push(imageId);
    }
  });

  if (missingIds.length > 0) {
    const storage = getExtrasStorage();
    const legacyKeys = missingIds.map((id) => getPromptThisKey(id));
    const legacyByKey = await storage.getMany<PromptThisRecord>(legacyKeys);

    // Best-effort migrate legacy prompts into unified extras.
    await Promise.all(
      missingIds.map(async (imageId, idx) => {
        const legacyKey = legacyKeys[idx];
        const legacy = legacyByKey[legacyKey];
        if (!legacy || typeof legacy.prompt !== 'string' || !legacy.prompt.trim()) return;
        result[imageId] = legacy;
        try {
          await patchImageExtrasRecord(imageId, {
            promptThis: {
            prompt: legacy.prompt,
            model: legacy.model,
            provider: legacy.provider,
            creativeBrief: legacy.creativeBrief,
            sourceRelationship: legacy.sourceRelationship,
            aspectRatio: legacy.aspectRatio,
            derivationId: legacy.derivationId,
            createdAt: legacy.createdAt,
              updatedAt: legacy.updatedAt
            }
          });
        } catch {
          // ignore
        }
      })
    );
  }

  return result;
}
