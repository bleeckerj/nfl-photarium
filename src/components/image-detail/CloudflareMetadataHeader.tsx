import React from 'react';

export type LargestField = { key: string; bytes: number };

export function CloudflareMetadataHeader(props: {
  metadataByteSize: number;
  metadataPrunedByteSize: number;
  metadataLargestFields: LargestField[];
  metadataPrunedDroppedFields: string[];
  extrasBackedFields?: string[];
  isMetadataDirty: boolean;
  pendingAutoSave: boolean;
  saving: boolean;
  onDiscard: () => void;
  onSave: () => void;
}) {
  const {
    metadataByteSize,
    metadataPrunedByteSize,
    metadataLargestFields,
    metadataPrunedDroppedFields,
    extrasBackedFields = [],
    isMetadataDirty,
    pendingAutoSave,
    saving,
    onDiscard,
    onSave
  } = props;

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-[11px] font-mono text-gray-700 bg-gray-100 border border-gray-200 rounded-full px-3 py-1">
        Cloudflare meta (pending): {metadataByteSize} bytes
        {metadataPrunedByteSize > 0 && metadataPrunedByteSize !== metadataByteSize && (
          <> • pruned: {metadataPrunedByteSize}/1024</>
        )}
      </span>

      {metadataLargestFields.length > 0 && (
        <span className="text-[10px] text-gray-500">
          Largest: {metadataLargestFields.map((field) => `${field.key} (${field.bytes}b)`).join(', ')}
        </span>
      )}

      {metadataPrunedDroppedFields.length > 0 && (
        <span className="text-[10px] text-amber-700">
          Would drop to fit: {metadataPrunedDroppedFields.slice(0, 5).join(', ')}
          {metadataPrunedDroppedFields.length > 5 ? '…' : ''}
        </span>
      )}

      {extrasBackedFields.length > 0 && (
        <span className="text-[10px] text-blue-700">
          Extras-backed (not counted here): {extrasBackedFields.join(', ')}
        </span>
      )}

      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <span
          className={`px-2 py-1 rounded-full border ${
            isMetadataDirty
              ? 'border-amber-300 bg-amber-50 text-amber-800'
              : pendingAutoSave
                ? 'border-blue-200 bg-blue-50 text-blue-800'
                : 'border-emerald-200 bg-emerald-50 text-emerald-800'
          }`}
        >
          {isMetadataDirty ? 'Unsaved changes' : pendingAutoSave ? 'Saving…' : 'All changes saved'}
        </span>

        <button
          onClick={onDiscard}
          disabled={!isMetadataDirty || saving}
          className="px-2 py-1 text-[11px] border border-gray-300 rounded-md text-gray-600 hover:bg-gray-50 disabled:opacity-50"
        >
          Discard
        </button>

        <button
          onClick={onSave}
          disabled={!isMetadataDirty || saving}
          className="px-2 py-1 text-[11px] border border-gray-300 rounded-md text-blue-600 hover:bg-blue-50 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  );
}
