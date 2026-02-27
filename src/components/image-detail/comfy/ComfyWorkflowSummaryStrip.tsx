import React from 'react';
import { compactListPreview, formatNumber, formatSize, truncateMiddle } from '@/components/image-detail/comfy/formatters';
import type { ComfyParamMap } from '@/components/image-detail/comfy/types';

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded border border-gray-200 bg-gray-50 px-2 py-0.5 text-[10px] text-gray-700">
      {children}
    </span>
  );
}

export function ComfyWorkflowSummaryStrip(props: {
  promptCount: number;
  nodeTypes: string[];
  params: ComfyParamMap;
}) {
  const { promptCount, nodeTypes, params } = props;
  const previewNodeTypes = compactListPreview(nodeTypes, 4);
  const hiddenNodeTypes = Math.max(0, nodeTypes.length - previewNodeTypes.length);
  const sizeLabel = formatSize(params.width, params.height);

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <Chip>Prompt text: {promptCount}</Chip>
      {params.modeFlags.map((flag) => <Chip key={flag}>{flag}</Chip>)}
      {params.checkpoint && <Chip>Model: {truncateMiddle(params.checkpoint, 36)}</Chip>}
      {params.sampler && <Chip>Sampler: {truncateMiddle(params.sampler, 24)}</Chip>}
      {params.steps !== undefined && <Chip>Steps: {formatNumber(params.steps)}</Chip>}
      {params.cfg !== undefined && <Chip>CFG: {formatNumber(params.cfg)}</Chip>}
      {params.seed !== undefined && <Chip>Seed: {formatNumber(params.seed)}</Chip>}
      {sizeLabel && <Chip>Size: {sizeLabel}</Chip>}
      {previewNodeTypes.map((node) => <Chip key={node}>{truncateMiddle(node, 24)}</Chip>)}
      {hiddenNodeTypes > 0 && <Chip>+{hiddenNodeTypes} node types</Chip>}
    </div>
  );
}
