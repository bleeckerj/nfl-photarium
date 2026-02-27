import React from 'react';
import { formatNumber, formatSize, truncateMiddle } from '@/components/image-detail/comfy/formatters';
import type { ComfyParamMap } from '@/components/image-detail/comfy/types';

type Row = { label: string; value: string };

export function ComfyWorkflowParamsGrid({ params }: { params: ComfyParamMap }) {
  const rows: Row[] = [
    params.checkpoint ? { label: 'Checkpoint', value: truncateMiddle(params.checkpoint, 80) } : null,
    params.sampler ? { label: 'Sampler', value: params.sampler } : null,
    params.scheduler ? { label: 'Scheduler', value: params.scheduler } : null,
    params.steps !== undefined ? { label: 'Steps', value: formatNumber(params.steps) || '' } : null,
    params.cfg !== undefined ? { label: 'CFG', value: formatNumber(params.cfg) || '' } : null,
    params.seed !== undefined ? { label: 'Seed', value: formatNumber(params.seed) || '' } : null,
    params.denoise !== undefined ? { label: 'Denoise', value: formatNumber(params.denoise) || '' } : null,
    formatSize(params.width, params.height) ? { label: 'Size', value: formatSize(params.width, params.height) || '' } : null,
  ].filter((row): row is Row => Boolean(row && row.value));

  if (rows.length === 0) return null;

  return (
    <div className="mt-3">
      <p className="text-[10px] font-mono text-gray-500 mb-1">Generation Params</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {rows.map((row) => (
          <div key={row.label} className="rounded border border-gray-200 bg-gray-50 px-2 py-1">
            <div className="text-[10px] text-gray-500">{row.label}</div>
            <div className="text-[11px] font-mono text-gray-800 break-all">{row.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
