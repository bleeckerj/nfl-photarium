import { getCacheStorage } from '@/server/cacheStorage';

export type PromptThisRecord = {
  imageId: string;
  prompt: string;
  model: string;
  provider: 'openai';
  createdAt: string;
  updatedAt: string;
};

export function getPromptThisKey(imageId: string): string {
  return `prompt-this:${imageId}`;
}

export async function getPromptThisRecord(imageId: string): Promise<PromptThisRecord | null> {
  const storage = getCacheStorage();
  const cached = await storage.get<PromptThisRecord>(getPromptThisKey(imageId));
  return cached?.data ?? null;
}

export async function setPromptThisRecord(record: PromptThisRecord): Promise<void> {
  const storage = getCacheStorage();
  await storage.set(getPromptThisKey(record.imageId), record);
}
