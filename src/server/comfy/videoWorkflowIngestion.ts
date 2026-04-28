import { generateClipTextEmbedding } from '@/server/embeddingService';
import { persistComfyVideoWorkflowExtras, type PersistComfyVideoWorkflowExtrasInput } from '@/server/comfy/videoWorkflowExtras';
import {
  ensureWorkflowIntentIndex,
  storeWorkflowIntentEmbedding,
} from '@/server/comfy/workflowIntentSearch';
import type { ComfyWorkflowExtraction } from '@/utils/comfyMetadata';

export type IngestComfyWorkflowForVideoParams = {
  videoId: string;
  comfyExtraction: ComfyWorkflowExtraction;
  imageDescription?: PersistComfyVideoWorkflowExtrasInput['imageDescription'];
  embeddingModel?: string;
  embeddingVersion?: string;
  maxIntentTextLength?: number;
};

export type IngestComfyWorkflowForVideoResult = {
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

export async function ingestComfyWorkflowForVideo(
  params: IngestComfyWorkflowForVideoParams
): Promise<IngestComfyWorkflowForVideoResult> {
  if (!params.comfyExtraction.detected) {
    return { persisted: false, indexed: false, reason: 'not-comfy' };
  }

  if (!params.comfyExtraction.workflowJson) {
    return { persisted: false, indexed: false, reason: 'missing-workflow-json' };
  }

  let persisted;
  try {
    persisted = await persistComfyVideoWorkflowExtras({
      videoId: params.videoId,
      workflowJson: params.comfyExtraction.workflowJson,
      imageDescription: params.imageDescription,
      embeddingModel: params.embeddingModel,
      embeddingVersion: params.embeddingVersion,
      maxIntentTextLength: params.maxIntentTextLength,
    });
  } catch (error) {
    console.warn('[ComfyVideoWorkflow] Failed to persist workflow extras', {
      videoId: params.videoId,
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

  const embedding = await generateClipTextEmbedding(persisted.workflowIntentText, {
    source: 'server',
    component: 'videoWorkflowIngestion',
    trigger: 'ingest',
    route: 'server/comfy/videoWorkflowIngestion',
    query: persisted.workflowIntentText,
  });
  if (!embedding) {
    return { persisted: true, indexed: false, reason: 'embedding-unavailable' };
  }

  try {
    await ensureWorkflowIntentIndex();
    await storeWorkflowIntentEmbedding({
      imageId: params.videoId,
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
    console.warn('[ComfyVideoWorkflow] Failed to store workflow intent embedding', {
      videoId: params.videoId,
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
