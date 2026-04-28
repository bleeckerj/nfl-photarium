import { getVideoExtrasRecord, patchVideoExtrasRecord } from '@/server/videoExtras';
import {
  WORKFLOW_INTENT_TEXT_VERSION,
  analyzeWorkflowIntent,
  type WorkflowImageDescription,
} from '@/server/comfy/workflowAnalysis';
import type { ComfyWorkflowEntry, WorkflowImageDescriptionEntry } from '@/server/imageExtras';

export type PersistComfyVideoWorkflowExtrasInput = {
  videoId: string;
  workflowJson: unknown;
  imageDescription?: WorkflowImageDescription;
  embeddingModel?: string;
  embeddingVersion?: string;
  maxIntentTextLength?: number;
};

function hasWorkflowSignal(entry: ComfyWorkflowEntry): boolean {
  return Boolean(
    entry.workflowIntentText ||
      entry.promptCandidates.length > 0 ||
      entry.nodeTypeSignatures.length > 0 ||
      entry.nodeSettingSignatures.length > 0
  );
}

function mapImageDescription(
  imageDescription?: WorkflowImageDescription
): WorkflowImageDescriptionEntry | undefined {
  if (!imageDescription) return undefined;

  const mapped: WorkflowImageDescriptionEntry = {};
  if (typeof imageDescription.altText === 'string' && imageDescription.altText.trim()) {
    mapped.altText = imageDescription.altText.trim();
  }
  if (typeof imageDescription.description === 'string' && imageDescription.description.trim()) {
    mapped.description = imageDescription.description.trim();
  }
  if (typeof imageDescription.aiCaption === 'string' && imageDescription.aiCaption.trim()) {
    mapped.aiCaption = imageDescription.aiCaption.trim();
  }

  return Object.keys(mapped).length > 0 ? mapped : undefined;
}

export function buildComfyVideoWorkflowEntry(params: {
  workflowJson: unknown;
  imageDescription?: WorkflowImageDescription;
  embeddingModel?: string;
  embeddingVersion?: string;
  maxIntentTextLength?: number;
  updatedAt?: string;
}): ComfyWorkflowEntry | null {
  const analysis = analyzeWorkflowIntent({
    workflowJson: params.workflowJson,
    imageDescription: params.imageDescription,
    maxLength: params.maxIntentTextLength,
  });

  const comfyWorkflowEntry: ComfyWorkflowEntry = {
    workflowJson: params.workflowJson,
    promptCandidates: analysis.promptCandidates,
    imageDescription: mapImageDescription(params.imageDescription),
    workflowIntentText: analysis.workflowIntentText,
    nodeTypeSignatures: analysis.nodeTypeSignatures,
    nodeSettingSignatures: analysis.nodeSettingSignatures,
    intentTextVersion: WORKFLOW_INTENT_TEXT_VERSION,
    embeddingModel: params.embeddingModel,
    embeddingVersion: params.embeddingVersion,
    updatedAt: params.updatedAt ?? new Date().toISOString(),
  };

  if (!hasWorkflowSignal(comfyWorkflowEntry)) {
    return null;
  }

  return comfyWorkflowEntry;
}

export async function persistComfyVideoWorkflowExtras(
  params: PersistComfyVideoWorkflowExtrasInput
): Promise<ComfyWorkflowEntry | null> {
  const entry = buildComfyVideoWorkflowEntry({
    workflowJson: params.workflowJson,
    imageDescription: params.imageDescription,
    embeddingModel: params.embeddingModel,
    embeddingVersion: params.embeddingVersion,
    maxIntentTextLength: params.maxIntentTextLength,
  });

  if (!entry) return null;

  await patchVideoExtrasRecord(params.videoId, {
    comfyWorkflow: entry,
  });

  return entry;
}

export async function getComfyVideoWorkflowExtras(videoId: string): Promise<ComfyWorkflowEntry | null> {
  const extras = await getVideoExtrasRecord(videoId);
  return extras?.comfyWorkflow ?? null;
}
