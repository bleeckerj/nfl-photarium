import { removeCachedImage } from '@/server/cloudflareImageCache';
import { deleteImageExtrasRecord } from '@/server/imageExtras';
import { deleteImageVectors, isVectorSearchAvailable } from '@/server/vectorSearch';
import {
  deleteWorkflowIntentEmbedding,
  isWorkflowIntentSearchAvailable,
} from '@/server/comfy/workflowIntentSearch';

export type CleanupStepName =
  | 'cloudflareCache'
  | 'imageVectors'
  | 'imageExtras'
  | 'workflowIntentEmbedding';

export type CleanupStepStatus = 'success' | 'skipped' | 'failed';

export type CleanupStepResult = {
  step: CleanupStepName;
  status: CleanupStepStatus;
  error?: string;
  reason?: string;
};

export type CleanupImageArtifactsResult = {
  imageId: string;
  success: boolean;
  steps: CleanupStepResult[];
};

type CleanupImageArtifactsOptions = {
  includeCache?: boolean;
  includeVectors?: boolean;
  includeExtras?: boolean;
  includeWorkflowIntentEmbedding?: boolean;
};

async function runStep(
  step: CleanupStepName,
  action: () => Promise<void>
): Promise<CleanupStepResult> {
  try {
    await action();
    return { step, status: 'success' };
  } catch (error) {
    return {
      step,
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function runOptionalStep(
  step: CleanupStepName,
  isAvailable: () => Promise<boolean>,
  action: () => Promise<void>,
  unavailableReason: string
): Promise<CleanupStepResult> {
  try {
    const available = await isAvailable();
    if (!available) {
      return { step, status: 'skipped', reason: unavailableReason };
    }
  } catch {
    return { step, status: 'skipped', reason: unavailableReason };
  }

  return runStep(step, action);
}

export async function cleanupImageArtifacts(
  imageId: string,
  options: CleanupImageArtifactsOptions = {}
): Promise<CleanupImageArtifactsResult> {
  const {
    includeCache = true,
    includeVectors = true,
    includeExtras = true,
    includeWorkflowIntentEmbedding = true,
  } = options;

  const steps: CleanupStepResult[] = [];

  if (includeCache) {
    steps.push(
      await runStep('cloudflareCache', async () => {
        await removeCachedImage(imageId);
      })
    );
  }

  if (includeVectors) {
    steps.push(
      await runOptionalStep(
        'imageVectors',
        isVectorSearchAvailable,
        async () => {
          await deleteImageVectors(imageId);
        },
        'vector-search-unavailable'
      )
    );
  }

  if (includeExtras) {
    steps.push(
      await runStep('imageExtras', async () => {
        await deleteImageExtrasRecord(imageId);
      })
    );
  }

  if (includeWorkflowIntentEmbedding) {
    steps.push(
      await runOptionalStep(
        'workflowIntentEmbedding',
        isWorkflowIntentSearchAvailable,
        async () => {
          await deleteWorkflowIntentEmbedding(imageId);
        },
        'workflow-intent-search-unavailable'
      )
    );
  }

  return {
    imageId,
    success: steps.every((step) => step.status !== 'failed'),
    steps,
  };
}
