import { getCachedImages } from '@/server/cloudflareImageCache';
import { generateClipTextEmbedding } from '@/server/embeddingService';
import { getComfyWorkflowExtras } from '@/server/comfy/workflowExtras';
import { ensureWorkflowIntentIndex, storeWorkflowIntentEmbedding } from '@/server/comfy/workflowIntentSearch';

export type WorkflowIndexStatus =
  | 'indexed'
  | 'not-comfy'
  | 'missing-extras'
  | 'missing-intent-text'
  | 'embedding-failed'
  | 'index-failed';

export type WorkflowIndexEntry = {
  imageId: string;
  status: WorkflowIndexStatus;
  error?: string;
};

export async function indexComfyWorkflowIntentForImage(imageId: string): Promise<WorkflowIndexEntry> {
  const images = await getCachedImages();
  const image = images.find((candidate) => candidate.id === imageId);

  if (!image || !(image.generatedBy === 'comfyui' || image.comfyMetadataDetected === true)) {
    return { imageId, status: 'not-comfy' };
  }

  const extras = await getComfyWorkflowExtras(imageId);
  if (!extras) {
    return { imageId, status: 'missing-extras' };
  }

  if (!extras.workflowIntentText.trim()) {
    return { imageId, status: 'missing-intent-text' };
  }

  const embedding = await generateClipTextEmbedding(extras.workflowIntentText);
  if (!embedding) {
    return { imageId, status: 'embedding-failed' };
  }

  try {
    await ensureWorkflowIntentIndex();
    await storeWorkflowIntentEmbedding({
      imageId,
      workflowIntentEmbedding: embedding,
      workflowIntentText: extras.workflowIntentText,
      promptCandidates: extras.promptCandidates,
      nodeTypeSignatures: extras.nodeTypeSignatures,
      nodeSettingSignatures: extras.nodeSettingSignatures,
      embeddingModel: extras.embeddingModel ?? 'clip-ViT-B-32',
      embeddingVersion: extras.embeddingVersion ?? 'v1',
      updatedAt: extras.updatedAt,
    });
    return { imageId, status: 'indexed' };
  } catch (error) {
    return {
      imageId,
      status: 'index-failed',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function indexComfyWorkflowIntents(params: {
  imageIds?: string[];
  limit?: number;
} = {}): Promise<{
  results: WorkflowIndexEntry[];
  summary: {
    indexed: number;
    skipped: number;
    failed: number;
  };
}> {
  const limit = Math.min(500, Math.max(1, params.limit ?? 100));

  let targetImageIds: string[];
  if (params.imageIds && params.imageIds.length > 0) {
    targetImageIds = params.imageIds.slice(0, limit);
  } else {
    const images = await getCachedImages();
    targetImageIds = images
      .filter((image) => image.generatedBy === 'comfyui' || image.comfyMetadataDetected === true)
      .map((image) => image.id)
      .slice(0, limit);
  }

  const results: WorkflowIndexEntry[] = [];
  for (const imageId of targetImageIds) {
    const result = await indexComfyWorkflowIntentForImage(imageId);
    results.push(result);
  }

  const indexed = results.filter((entry) => entry.status === 'indexed').length;
  const failed = results.filter(
    (entry) => entry.status === 'embedding-failed' || entry.status === 'index-failed'
  ).length;

  return {
    results,
    summary: {
      indexed,
      failed,
      skipped: results.length - indexed - failed,
    },
  };
}
