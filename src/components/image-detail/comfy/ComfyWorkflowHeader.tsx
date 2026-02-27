import React from 'react';

export function ComfyWorkflowHeader(props: {
  sourceLabel: string | null;
  updatedAtLabel: string | null;
  analysisMetaLabel: string | null;
}) {
  const { sourceLabel, updatedAtLabel, analysisMetaLabel } = props;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="text-xs font-mono font-medum text-gray-700">Comfy Workflow</p>
        <p className="text-[10px] text-gray-500">
          Extracted workflow metadata (separate from Prompt This generated/manual prompt).
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[10px] text-gray-500">
        <span className="inline-flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-emerald-700">
          ComfyUI
        </span>
        {sourceLabel && <span>Source: {sourceLabel}</span>}
        {updatedAtLabel && <span>Updated: {updatedAtLabel}</span>}
        {analysisMetaLabel && <span>{analysisMetaLabel}</span>}
      </div>
    </div>
  );
}
