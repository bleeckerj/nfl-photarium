import { randomUUID } from 'node:crypto';
import { getExtrasStorage } from '@/server/extrasStorage';
import type { ProvenanceBinding, ProvenanceSummary } from '@/types/generationProvenance';
import { ProvenanceError } from './validation';
import { receiptContentIdentity } from './identity';

const receiptKey = (id: string) => `generation-receipt:${id}`;
const bindingPrefix = (id: string) => `generation-binding:${id}:`;
const summaryKey = (id: string) => `generation-summary:${id}`;
const REVISION_KEY = 'generation-provenance-meta:revision';
const validId = (id: string) => /^[a-zA-Z0-9_-]{1,150}$/.test(id);

export function validateImageId(id: string): void {
  if (!validId(id)) throw new ProvenanceError('Invalid image ID');
}

export async function saveReceiptBinding(json: string, binding: ProvenanceBinding): Promise<ProvenanceBinding> {
  const storage = getExtrasStorage();
  validateImageId(binding.imageId);
  // Immutable receipt and per-image binding keys prevent lost history under concurrent attachment.
  await storage.setIfAbsent(receiptKey(binding.receiptId), { json });
  await storage.setIfAbsent(`${bindingPrefix(binding.imageId)}${binding.receiptId}`, binding);
  await storage.setIfAbsent(summaryKey(binding.imageId), binding);
  await storage.set(REVISION_KEY, randomUUID());
  const stored = await storage.get<{ json: string }>(receiptKey(binding.receiptId));
  const associated = await storage.get<ProvenanceBinding>(`${bindingPrefix(binding.imageId)}${binding.receiptId}`);
  if (stored?.json !== json || !associated) throw new Error('Provenance durable readback failed');
  return associated;
}

export async function markProvenanceImageDeleted(imageId: string): Promise<void> {
  validateImageId(imageId);
  const storage = getExtrasStorage();
  if (await storage.exists(summaryKey(imageId))) {
    await storage.setIfAbsent(`generation-tombstone:${imageId}`, { imageId, deletedAt: new Date().toISOString() });
  }
}

export async function listReceiptBindings(imageId: string): Promise<ProvenanceBinding[]> {
  validateImageId(imageId);
  const storage = getExtrasStorage();
  const keys = await storage.listKeysByPrefix(bindingPrefix(imageId));
  const records = await storage.getMany<ProvenanceBinding>(keys);
  const bindings = keys.map((key) => records[key]).filter((record): record is ProvenanceBinding => Boolean(record));
  const receipts = await storage.getMany<{ json: string }>(bindings.map((binding) => receiptKey(binding.receiptId)));
  const unique = new Map<string, ProvenanceBinding>();
  for (const binding of bindings) {
    const receipt = receipts[receiptKey(binding.receiptId)];
    const identity = JSON.stringify([
      receipt ? receiptContentIdentity(receipt.json) : binding.receiptId,
      binding.outputIndex, binding.persistedSha256, [...binding.sourceImageIds].sort(),
    ]);
    const existing = unique.get(identity);
    // Prefer verification against stored original bytes while retaining every exact record.
    if (!existing || (existing.verification !== 'original-matched' && binding.verification === 'original-matched')) {
      unique.set(identity, binding);
    }
  }
  return [...unique.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getReceiptJson(imageId: string, receiptId: string): Promise<string> {
  validateImageId(imageId);
  if (!/^[a-f0-9]{64}$/.test(receiptId)) throw new ProvenanceError('Invalid receipt ID');
  const storage = getExtrasStorage();
  const binding = await storage.get<ProvenanceBinding>(`${bindingPrefix(imageId)}${receiptId}`);
  if (!binding) throw new ProvenanceError('Receipt not attached to this image', 404);
  const receipt = await storage.get<{ json: string }>(receiptKey(receiptId));
  if (!receipt) throw new ProvenanceError('Receipt record unavailable', 503);
  return receipt.json;
}

export async function getProvenanceSummaries(imageIds: string[]): Promise<Record<string, ProvenanceSummary | null>> {
  const ids = imageIds.filter(validId);
  const values = await getExtrasStorage().getMany<ProvenanceBinding>(ids.map(summaryKey));
  return Object.fromEntries(ids.map((id) => [id, values[summaryKey(id)] ?? null]));
}

export async function getProvenanceRevision(): Promise<string> {
  return await getExtrasStorage().get<string>(REVISION_KEY) ?? '0';
}
