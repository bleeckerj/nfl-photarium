import React from 'react';
import { ComfyWorkflowHeader } from '@/components/image-detail/comfy/ComfyWorkflowHeader';
import { ComfyWorkflowJsonDrawer } from '@/components/image-detail/comfy/ComfyWorkflowJsonDrawer';
import { ComfyWorkflowNodeChips } from '@/components/image-detail/comfy/ComfyWorkflowNodeChips';
import { ComfyWorkflowParamsGrid } from '@/components/image-detail/comfy/ComfyWorkflowParamsGrid';
import { ComfyWorkflowPrompts } from '@/components/image-detail/comfy/ComfyWorkflowPrompts';
import { ComfyWorkflowSummaryStrip } from '@/components/image-detail/comfy/ComfyWorkflowSummaryStrip';
import { useComfyWorkflowViewModel } from '@/components/image-detail/comfy/useComfyWorkflowViewModel';
import type { ComfyWorkflowPanelProps } from '@/components/image-detail/comfy/types';

export function ComfyWorkflowPanel(props: ComfyWorkflowPanelProps) {
  const vm = useComfyWorkflowViewModel({
    comfyWorkflow: props.comfyWorkflow,
    detection: props.detection,
  });
  const promptTexts = vm.promptTexts ?? {
    primary: null,
    negative: null,
    others: [],
    totalPromptLikeCount: 0,
    rawExtractedCount: 0,
    source: 'none' as const,
  };
  const legacyPromptCount = Array.isArray((vm as unknown as { promptCandidates?: unknown[] }).promptCandidates)
    ? ((vm as unknown as { promptCandidates?: unknown[] }).promptCandidates?.length ?? 0)
    : 0;
  const promptCount = promptTexts.totalPromptLikeCount || legacyPromptCount;

  if (!vm.visible) {
    return null;
  }

  return (
    <div id={`comfy-workflow-section-${props.imageId}`} className="mt-1">
      <ComfyWorkflowHeader
        sourceLabel={vm.sourceLabel}
        updatedAtLabel={vm.updatedAtLabel}
        analysisMetaLabel={vm.analysisMetaLabel}
      />

      {!props.comfyWorkflow && vm.detected ? (
        <div className="mt-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
          ComfyUI output detected, but no indexed workflow extras are available yet.
        </div>
      ) : (
        <>
          <ComfyWorkflowSummaryStrip
            promptCount={promptCount}
            nodeTypes={vm.nodeTypes}
            params={vm.params}
          />
          <ComfyWorkflowParamsGrid params={vm.params} />
          <ComfyWorkflowPrompts
            promptTexts={promptTexts}
            workflowIntentText={vm.workflowIntentText}
            onCopyText={props.onCopyText}
          />
          <ComfyWorkflowNodeChips nodeTypes={vm.nodeTypes} nodeSettings={vm.nodeSettings} />
          <ComfyWorkflowJsonDrawer rawJsonPretty={vm.rawJsonPretty} onCopyText={props.onCopyText} />
        </>
      )}
    </div>
  );
}
