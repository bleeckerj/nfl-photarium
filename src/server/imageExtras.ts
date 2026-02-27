import { getExtrasStorage } from '@/server/extrasStorage';

export type PromptThisProvider = 'openai' | 'manual';

export type PromptThisEntry = {
  prompt: string;
  model: string;
  provider: PromptThisProvider;
  createdAt: string;
  updatedAt: string;
};

export type WorkflowImageDescriptionEntry = {
  altText?: string;
  description?: string;
  aiCaption?: string;
};

export type ComfyWorkflowEntry = {
  workflowJson: unknown;
  promptCandidates: string[];
  imageDescription?: WorkflowImageDescriptionEntry;
  workflowIntentText: string;
  nodeTypeSignatures: string[];
  nodeSettingSignatures: string[];
  intentTextVersion: string;
  embeddingModel?: string;
  embeddingVersion?: string;
  updatedAt: string;
};

export type ImageExtrasRecordV1 = {
  schemaVersion: 1;
  imageId: string;

  /**
   * Freeform descriptive fields that can be larger than Cloudflare metadata limits.
   *
   * NOTE: Keep namespace/folder/tags in Cloudflare metadata for filtering.
   */
  description?: string;
  altText?: string;

  /** Prompt This (generated prompt for recreating the image). */
  promptThis?: PromptThisEntry;

  /** Comfy workflow intelligence for semantic retrieval and diagnostics. */
  comfyWorkflow?: ComfyWorkflowEntry;

  /**
   * Optional future slots (kept here to document intent; not used yet).
   * - caption?: string
   * - ocrText?: string
   * - notes?: string
   */

  createdAt: string;
  updatedAt: string;
};

export type ImageExtrasRecord = ImageExtrasRecordV1;

export function getImageExtrasKey(imageId: string): string {
  return `image-extras:${imageId}`;
}

export async function getImageExtrasRecord(imageId: string): Promise<ImageExtrasRecord | null> {
  const storage = getExtrasStorage();
  return storage.get<ImageExtrasRecord>(getImageExtrasKey(imageId));
}

export async function getImageExtrasRecords(imageIds: string[]): Promise<Record<string, ImageExtrasRecord | null>> {
  const storage = getExtrasStorage();
  const keys = imageIds.map((id) => getImageExtrasKey(id));
  const keyed = await storage.getMany<ImageExtrasRecord>(keys);
  const result: Record<string, ImageExtrasRecord | null> = {};

  imageIds.forEach((id, idx) => {
    const key = keys[idx];
    result[id] = keyed[key] ?? null;
  });

  return result;
}

export async function setImageExtrasRecord(record: ImageExtrasRecord): Promise<void> {
  const storage = getExtrasStorage();
  await storage.set(getImageExtrasKey(record.imageId), record);
}

export async function deleteImageExtrasRecord(imageId: string): Promise<void> {
  const storage = getExtrasStorage();
  await storage.delete(getImageExtrasKey(imageId));
}

export async function listImageExtrasImageIds(): Promise<string[]> {
  const storage = getExtrasStorage();
  const keys = await storage.listKeysByPrefix('image-extras:');
  return keys
    .filter((key) => key.startsWith('image-extras:'))
    .map((key) => key.slice('image-extras:'.length))
    .filter(Boolean);
}

export async function patchImageExtrasRecord(
  imageId: string,
  patch: Partial<Omit<ImageExtrasRecordV1, 'schemaVersion' | 'imageId' | 'createdAt' | 'updatedAt'>>
): Promise<ImageExtrasRecord> {
  const existing = await getImageExtrasRecord(imageId);
  const now = new Date().toISOString();

  const base: ImageExtrasRecordV1 = existing && existing.schemaVersion === 1
    ? (existing as ImageExtrasRecordV1)
    : {
        schemaVersion: 1,
        imageId,
        createdAt: now,
        updatedAt: now
      };

  const next: ImageExtrasRecordV1 = {
    ...base,
    ...patch,
    schemaVersion: 1,
    imageId,
    createdAt: base.createdAt,
    updatedAt: now
  };

  await setImageExtrasRecord(next);
  return next;
}
