import clsx from 'clsx';

import MonoSelect from '@/components/MonoSelect';

interface SelectOption {
  value: string;
  label: string;
}

interface UploadNamespaceControlsProps {
  uploadNamespace: string | null;
  uploadNamespaceSelectValue: string;
  uploadNamespaceDraft: string;
  uploadNamespaceOptions: SelectOption[];
  isUploading: boolean;
  onSelectChange: (value: string) => void;
  onDraftChange: (value: string) => void;
  onApply: () => void;
}

export default function UploadNamespaceControls({
  uploadNamespace,
  uploadNamespaceSelectValue,
  uploadNamespaceDraft,
  uploadNamespaceOptions,
  isUploading,
  onSelectChange,
  onDraftChange,
  onApply,
}: UploadNamespaceControlsProps) {
  return (
    <div className="mt-4 rounded-lg border border-dashed bg-white/70 p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex-1">
          <p className="text-xs font-mono font-medium text-gray-900">Upload namespace</p>
          <p className="mt-1 text-[11px] text-gray-500">
            This mirrors the gallery namespace so you can change the upload target without scrolling back to the toolbar.
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-[minmax(240px,320px)_minmax(180px,220px)_auto] sm:items-end">
          <label className="block text-[11px] text-gray-700">
            Namespace
            <MonoSelect
              id="upload-namespace-select"
              value={uploadNamespaceSelectValue}
              onChange={onSelectChange}
              options={uploadNamespaceOptions}
              searchable
              searchPlaceholder="Filter namespaces..."
              className="mt-1"
              disabled={isUploading}
            />
          </label>
          <label className="block text-[11px] text-gray-700">
            Custom namespace
            <input
              type="text"
              value={uploadNamespaceDraft}
              onChange={(event) => onDraftChange(event.target.value)}
              placeholder="Enter namespace"
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={isUploading}
            />
          </label>
          <button
            type="button"
            onClick={onApply}
            disabled={isUploading || uploadNamespaceDraft.trim().length === 0}
            className="px-3 py-2 text-xs text-blue-700 border border-blue-300 bg-blue-50 rounded-md hover:bg-blue-100 disabled:opacity-50"
          >
            Apply
          </button>
        </div>
      </div>
      <p className={clsx('mt-3 text-[11px]', uploadNamespace ? 'text-emerald-700' : 'text-amber-700')}>
        {uploadNamespace
          ? `Uploads will go to "${uploadNamespace}".`
          : 'Select a specific namespace before uploading. "All namespaces" remains browse-only here.'}
      </p>
    </div>
  );
}
