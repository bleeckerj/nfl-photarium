import React from 'react';

export interface UploadVariationSectionProps {
  getVariantDropzoneProps: () => Record<string, unknown>;
  getVariantInputProps: () => Record<string, unknown>;
  isVariantDragActive: boolean;

  childUploadFolder: string;
  childUploadTags: string;
  fallbackFolder: string;
  fallbackTags: string[];

  childUploadFiles: File[];
  onClearSelectedFiles: () => void;

  onUpload: () => void | Promise<void>;
  childUploadLoading: boolean;
}

export function UploadVariationSection(props: UploadVariationSectionProps) {
  const {
    getVariantDropzoneProps,
    getVariantInputProps,
    isVariantDragActive,
    childUploadFolder,
    childUploadTags,
    fallbackFolder,
    fallbackTags,
    childUploadFiles,
    onClearSelectedFiles,
    onUpload,
    childUploadLoading
  } = props;

  const effectiveFolder = childUploadFolder || fallbackFolder || '';
  const tagsLabel = childUploadTags || (fallbackTags.length > 0 ? fallbackTags.join(', ') : '');

  return (
    <div id="upload-variation-section" className="space-y-3 border border-dashed rounded-lg p-3 bg-blue-50">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h3 className="text-xs font-mono font-medum text-gray-800">Upload a new variation</h3>
          <p className="text-xs text-gray-600">Files automatically inherit this image's folder and tags.</p>
          <p className="text-[11px] text-gray-500">.zip uploads are supported.</p>
        </div>
      </div>

      <div
        {...getVariantDropzoneProps()}
        className={`border-2 border-dashed rounded-lg p-4 text-center transition-colors cursor-pointer ${isVariantDragActive ? 'border-blue-500 bg-blue-100' : 'border-gray-300 bg-white hover:border-gray-400'}`}
      >
        <input {...getVariantInputProps()} />
        <p className="text-xs font-mono text-gray-900 mb-1">Drag & drop images or a .zip here</p>
        <p className="text-[11px] text-gray-500">or click to browse files (.zip supported)</p>
      </div>

      <div className="text-[11px] text-gray-600 bg-white/70 border border-gray-200 rounded-md p-2">
        <p>
          Folder: <span className="font-mono">{effectiveFolder || '[none]'}</span>
        </p>
        <p>
          Tags: <span className="font-mono">{tagsLabel || '[none]'}</span>
        </p>
      </div>

      {childUploadFiles.length > 0 && (
        <div className="text-xs text-gray-700 space-y-1">
          {childUploadFiles.map((file, idx) => (
            <p key={`${file.name}-${idx}`} className="truncate">
              • {file.name}
            </p>
          ))}
          <button
            type="button"
            onClick={onClearSelectedFiles}
            className="mt-2 px-2 py-1 text-[11px] text-red-600 border border-red-200 rounded-md hover:bg-red-50"
          >
            Clear selected files
          </button>
        </div>
      )}

      <button
        onClick={() => void onUpload()}
        disabled={childUploadLoading || childUploadFiles.length === 0}
        className="px-4 py-2 text-xs bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {childUploadLoading ? 'Uploading…' : 'Upload variation(s)'}
      </button>
    </div>
  );
}
