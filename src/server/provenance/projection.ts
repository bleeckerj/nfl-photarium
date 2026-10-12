import { getProvenanceSummaries } from './storage';

export async function projectProvenance<T extends { id: string }>(images: readonly T[]): Promise<T[]> {
  const summaries = await getProvenanceSummaries(images.map((image) => image.id));
  return images.map((image) => ({
    ...image,
    provenanceAvailable: Boolean(summaries[image.id]),
    // Full receipts and private source paths are fetched only by the operator detail endpoint.
    provenanceSummary: summaries[image.id] ?? undefined,
  }));
}
