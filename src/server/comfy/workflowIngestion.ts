import { generateClipTextEmbedding } from '@/server/embeddingService';
import { persistComfyWorkflowExtras, type PersistComfyWorkflowExtrasInput } from '@/server/comfy/workflowExtras';
import {
  ensureWorkflowIntentIndex,
  storeWorkflowIntentEmbedding,
} from '@/server/comfy/workflowIntentSearch';
import type { ComfyWorkflowExtraction } from '@/utils/comfyMetadata';

export type IngestComfyWorkflowParams = {
  imageId: string;
  comfyExtraction: ComfyWorkflowExtraction;
  imageDescription?: PersistComfyWorkflowExtrasInput['imageDescription'];
  embeddingModel?: string;
  embeddingVersion?: string;
  maxIntentTextLength?: number;
};

export type IngestComfyWorkflowResult = {
  persisted: boolean;
  indexed: boolean;
  reason:
    | 'not-comfy'
    | 'missing-workflow-json'
    | 'missing-workflow-signal'
    | 'persistence-failed'
    | 'embedding-skipped-test'
    | 'embedding-unavailable'
    | 'index-failed'
    | 'ok';
  error?: string;
};

export async function ingestComfyWorkflowForImage(
  params: IngestComfyWorkflowParams
): Promise<IngestComfyWorkflowResult> {
  if (!params.comfyExtraction.detected) {
    return { persisted: false, indexed: false, reason: 'not-comfy' };
  }

  if (!params.comfyExtraction.workflowJson) {
    return { persisted: false, indexed: false, reason: 'missing-workflow-json' };
  }

  let persisted;
  try {
    persisted = await persistComfyWorkflowExtras({
      imageId: params.imageId,
      workflowJson: params.comfyExtraction.workflowJson,
      imageDescription: params.imageDescription,
      embeddingModel: params.embeddingModel,
      embeddingVersion: params.embeddingVersion,
      maxIntentTextLength: params.maxIntentTextLength,
    });
  } catch (error) {
    console.warn('[ComfyWorkflow] Failed to persist workflow extras', {
      imageId: params.imageId,
      error,
    });
    return {
      persisted: false,
      indexed: false,
      reason: 'persistence-failed',
      error: error instanceof Error ? error.message : String(error),
    };
  }

  if (!persisted) {
    return { persisted: false, indexed: false, reason: 'missing-workflow-signal' };
  }

  if (process.env.NODE_ENV === 'test') {
    return { persisted: true, indexed: false, reason: 'embedding-skipped-test' };
  }

  const embedding = await generateClipTextEmbedding(persisted.workflowIntentText);
  if (!embedding) {
    return { persisted: true, indexed: false, reason: 'embedding-unavailable' };
  }

  try {
    await ensureWorkflowIntentIndex();
    await storeWorkflowIntentEmbedding({
      imageId: params.imageId,
      workflowIntentEmbedding: embedding,
      workflowIntentText: persisted.workflowIntentText,
      promptCandidates: persisted.promptCandidates,
      nodeTypeSignatures: persisted.nodeTypeSignatures,
      nodeSettingSignatures: persisted.nodeSettingSignatures,
      embeddingModel: params.embeddingModel ?? 'clip-ViT-B-32',
      embeddingVersion: params.embeddingVersion ?? 'v1',
      updatedAt: persisted.updatedAt,
    });
    return { persisted: true, indexed: true, reason: 'ok' };
  } catch (error) {
    console.warn('[ComfyWorkflow] Failed to store workflow intent embedding', {
      imageId: params.imageId,
      error,
    });
    return {
      persisted: true,
      indexed: false,
      reason: 'index-failed',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
