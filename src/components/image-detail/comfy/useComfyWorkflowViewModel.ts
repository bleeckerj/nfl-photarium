import { useMemo } from 'react';
import { formatRelativeDateTimeish } from '@/components/image-detail/comfy/formatters';
import { safePrettyJson, selectComfyParams, selectPromptTexts } from '@/components/image-detail/comfy/selectors';
import type { ComfyDetectionSignals, ComfyWorkflowRecord, ComfyWorkflowViewModel } from '@/components/image-detail/comfy/types';

export function useComfyWorkflowViewModel(params: {
  comfyWorkflow: ComfyWorkflowRecord | null;
  detection?: ComfyDetectionSignals;
}): ComfyWorkflowViewModel {
  const { comfyWorkflow, detection } = params;

  return useMemo(() => {
    const detected = Boolean(
      comfyWorkflow ||
      detection?.comfyMetadataDetected ||
      detection?.generatedBy === 'comfyui'
    );

    const promptTexts = selectPromptTexts(comfyWorkflow);
    const nodeTypes = Array.isArray(comfyWorkflow?.nodeTypeSignatures)
      ? comfyWorkflow.nodeTypeSignatures.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
      : [];
    const nodeSettings = Array.isArray(comfyWorkflow?.nodeSettingSignatures)
      ? comfyWorkflow.nodeSettingSignatures.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
      : [];

    const workflowIntentText =
      typeof comfyWorkflow?.workflowIntentText === 'string' && comfyWorkflow.workflowIntentText.trim()
        ? comfyWorkflow.workflowIntentText.trim()
        : null;

    const analysisMetaParts = [
      comfyWorkflow?.intentTextVersion ? `intent ${comfyWorkflow.intentTextVersion}` : '',
      comfyWorkflow?.embeddingModel ? comfyWorkflow.embeddingModel : '',
      comfyWorkflow?.embeddingVersion ? `emb ${comfyWorkflow.embeddingVersion}` : '',
    ].filter(Boolean);

    const sourceLabel =
      typeof detection?.comfyMetadataSource === 'string' && detection.comfyMetadataSource.trim()
        ? detection.comfyMetadataSource.trim()
        : null;

    return {
      visible: detected,
      detected,
      sourceLabel,
      promptTexts,
      workflowIntentText,
      nodeTypes,
      nodeSettings,
      params: selectComfyParams(comfyWorkflow),
      updatedAtLabel: formatRelativeDateTimeish(comfyWorkflow?.updatedAt),
      analysisMetaLabel: analysisMetaParts.length ? analysisMetaParts.join(' • ') : null,
      rawJsonPretty: safePrettyJson(comfyWorkflow?.workflowJson),
    };
  }, [comfyWorkflow, detection?.comfyMetadataDetected, detection?.comfyMetadataSource, detection?.generatedBy]);
}
