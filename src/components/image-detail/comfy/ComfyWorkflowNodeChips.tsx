import React, { useState } from 'react';
import { truncateMiddle } from '@/components/image-detail/comfy/formatters';

function Chip({ value }: { value: string }) {
  return (
    <span
      title={value}
      className="inline-flex items-center rounded border border-gray-200 bg-gray-50 px-2 py-0.5 text-[10px] text-gray-700"
    >
      {truncateMiddle(value, 44)}
    </span>
  );
}

export function ComfyWorkflowNodeChips(props: {
  nodeTypes: string[];
  nodeSettings: string[];
}) {
  const { nodeTypes, nodeSettings } = props;
  const [showAllTypes, setShowAllTypes] = useState(false);
  const [showAllSettings, setShowAllSettings] = useState(false);

  if (nodeTypes.length === 0 && nodeSettings.length === 0) return null;

  const visibleTypes = showAllTypes ? nodeTypes : nodeTypes.slice(0, 8);
  const visibleSettings = showAllSettings ? nodeSettings : nodeSettings.slice(0, 8);

  return (
    <div className="mt-3 space-y-2">
      {nodeTypes.length > 0 && (
        <div>
          <div className="flex items-center justify-between gap-2 mb-1">
            <p className="text-[10px] font-mono text-gray-500">Node Types ({nodeTypes.length})</p>
            {nodeTypes.length > 8 && (
              <button
                type="button"
                onClick={() => setShowAllTypes((v) => !v)}
                className="text-[10px] px-2 py-0.5 rounded border border-gray-200 text-gray-600 hover:border-gray-300"
              >
                {showAllTypes ? 'Less' : `All +${nodeTypes.length - 8}`}
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {visibleTypes.map((nodeType) => <Chip key={`type:${nodeType}`} value={nodeType} />)}
          </div>
        </div>
      )}

      {nodeSettings.length > 0 && (
        <div>
          <div className="flex items-center justify-between gap-2 mb-1">
            <p className="text-[10px] font-mono text-gray-500">Node Settings ({nodeSettings.length})</p>
            {nodeSettings.length > 8 && (
              <button
                type="button"
                onClick={() => setShowAllSettings((v) => !v)}
                className="text-[10px] px-2 py-0.5 rounded border border-gray-200 text-gray-600 hover:border-gray-300"
              >
                {showAllSettings ? 'Less' : `All +${nodeSettings.length - 8}`}
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {visibleSettings.map((setting, idx) => <Chip key={`setting:${idx}:${setting.slice(0, 20)}`} value={setting} />)}
          </div>
        </div>
      )}
    </div>
  );
}
