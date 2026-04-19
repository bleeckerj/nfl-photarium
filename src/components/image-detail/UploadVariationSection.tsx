import React from 'react';
import { MAX_FILENAME_LENGTH, needsSanitization, sanitizeFilename } from '@/utils/filename';

type UploadVariationQueueItem = {
  id: string;
  file: File;
  filename: string;
};

const isArchiveFile = (file: File) => {
  const lower = file.name.toLowerCase();
  return lower.endsWith('.zip') || lower.endsWith('.key');
};

export interface UploadVariationSectionProps {
  getVariantDropzoneProps: () => Record<string, unknown>;
  getVariantInputProps: () => Record<string, unknown>;
  isVariantDragActive: boolean;

  childUploadFolder: string;
  childUploadTags: string;
  fallbackFolder: string;
  fallbackTags: string[];

  childUploadItems: UploadVariationQueueItem[];
  onUpdateSelectedFilename: (id: string, value: string) => void;
  onClearSelectedFiles: () => void;

  onUpload: () => void | Promise<void>;
  childUploadLoading: boolean;

  childUploadUrl: string;
  childUploadUrlFilename: string;
  onChildUploadUrlChange: (value: string) => void;
  onChildUploadUrlFilenameChange: (value: string) => void;
  onUploadUrl: () => void | Promise<void>;
  childUploadUrlLoading: boolean;

  childImportUrl: string;
  childImportLoading: boolean;
  childImportError: string | null;
  onChildImportUrlChange: (value: string) => void;
  onImportFromUrl: () => void | Promise<void>;
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
    childUploadItems,
    onUpdateSelectedFilename,
    onClearSelectedFiles,
    onUpload,
    childUploadLoading,
    childUploadUrl,
    childUploadUrlFilename,
    onChildUploadUrlChange,
    onChildUploadUrlFilenameChange,
    onUploadUrl,
    childUploadUrlLoading,
    childImportUrl,
    childImportLoading,
    childImportError,
    onChildImportUrlChange,
    onImportFromUrl
  } = props;

  const effectiveFolder = childUploadFolder || fallbackFolder || '';
  const tagsLabel = childUploadTags || (fallbackTags.length > 0 ? fallbackTags.join(', ') : '');

  return (
    <div id="upload-variation-section" className="space-y-3 border border-dashed rounded-lg p-3 bg-blue-50">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h3 className="text-xs font-mono font-medum text-gray-800">Upload a new variation</h3>
          <p className="text-xs text-gray-600">Files inherit the current folder and tags. Namespace is inherited automatically from the canonical parent.</p>
          <p className="text-[11px] text-gray-500">Images, videos, and .zip/.key uploads are supported.</p>
        </div>
      </div>

      <div
        {...getVariantDropzoneProps()}
        className={`border-2 border-dashed rounded-lg p-4 text-center transition-colors cursor-pointer ${isVariantDragActive ? 'border-blue-500 bg-blue-100' : 'border-gray-300 bg-white hover:border-gray-400'}`}
      >
        <input {...getVariantInputProps()} />
        <p className="text-xs font-mono text-gray-900 mb-1">Drag & drop images, videos, or a .zip/.key archive here</p>
        <p className="text-[11px] text-gray-500">or click to browse files (images, videos, .zip/.key supported)</p>
      </div>

      <div className="text-[11px] text-gray-600 bg-white/70 border border-gray-200 rounded-md p-2">
        <p>
          Folder: <span className="font-mono">{effectiveFolder || '[none]'}</span>
        </p>
        <p>
          Tags: <span className="font-mono">{tagsLabel || '[none]'}</span>
        </p>
      </div>

      <div className="space-y-2">
        <label className="text-[11px] font-mono text-gray-700" htmlFor="child-import-url">
          Import image from URL
        </label>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            id="child-import-url"
            type="url"
            inputMode="url"
            placeholder="https://example.com/asset.jpg"
            value={childImportUrl}
            onChange={(event) => onChildImportUrlChange(event.target.value)}
            className="flex-1 px-2 py-2 text-xs border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <button
            type="button"
            onClick={() => void onImportFromUrl()}
            disabled={childImportLoading || !childImportUrl.trim()}
            className="px-4 py-2 text-xs bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {childImportLoading ? 'Fetching…' : 'Fetch image'}
          </button>
        </div>
        {childImportError && <p className="text-[11px] text-red-600">{childImportError}</p>}
        <p className="text-[11px] text-gray-500">Fetched images are added to the queue below.</p>
      </div>

      {childUploadItems.length > 0 && (
        <div className="space-y-2 text-xs text-gray-700">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-mono text-gray-700">
              Queued upload{childUploadItems.length === 1 ? '' : 's'}: {childUploadItems.length}
            </p>
            <button
              type="button"
              onClick={onClearSelectedFiles}
              className="px-2 py-1 text-[11px] text-red-600 border border-red-200 rounded-md hover:bg-red-50"
            >
              Clear selected files
            </button>
          </div>
          {childUploadItems.map((item) => {
            const editableFilename = !isArchiveFile(item.file);
            return (
              <div key={item.id} className="rounded-md border border-gray-200 bg-white/70 p-2">
                {editableFilename ? (
                  <>
                    <label className="mb-1 block text-[11px] font-mono text-gray-700" htmlFor={`variation-file-${item.id}`}>
                      Original filename
                    </label>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <input
                        id={`variation-file-${item.id}`}
                        type="text"
                        value={item.filename}
                        onChange={(event) => onUpdateSelectedFilename(item.id, event.target.value)}
                        className="min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-2 py-2 font-mono text-xs text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        disabled={childUploadLoading}
                      />
                      {item.filename.trim() && needsSanitization(item.filename) && (
                        <button
                          type="button"
                          onClick={() => onUpdateSelectedFilename(item.id, sanitizeFilename(item.filename))}
                          className="rounded-md border border-amber-300 bg-amber-100 px-2 py-2 text-[11px] text-amber-800 hover:bg-amber-200"
                          disabled={childUploadLoading}
                        >
                          Sanitize
                        </button>
                      )}
                    </div>
                    {item.filename.length > MAX_FILENAME_LENGTH && (
                      <p className="mt-1 text-[11px] text-amber-700">
                        Long filename ({item.filename.length} chars)
                      </p>
                    )}
                  </>
                ) : (
                  <>
                    <p className="truncate font-mono text-xs text-gray-900">{item.file.name}</p>
                    <p className="mt-1 text-[11px] text-gray-500">Archive uploads keep the filenames stored inside the archive.</p>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="space-y-2">
        <label className="text-[11px] font-mono text-gray-700" htmlFor="child-variation-url">
          Upload asset by URL
        </label>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            id="child-variation-filename"
            type="text"
            placeholder="Optional filename override"
            value={childUploadUrlFilename}
            onChange={(event) => onChildUploadUrlFilenameChange(event.target.value)}
            className="flex-1 px-2 py-2 text-xs font-mono border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          {childUploadUrlFilename.trim() && needsSanitization(childUploadUrlFilename) && (
            <button
              type="button"
              onClick={() => onChildUploadUrlFilenameChange(sanitizeFilename(childUploadUrlFilename))}
              className="px-3 py-2 text-[11px] border border-amber-300 bg-amber-100 text-amber-800 rounded-md hover:bg-amber-200"
            >
              Sanitize
            </button>
          )}
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            id="child-variation-url"
            type="url"
            inputMode="url"
            placeholder="https://example.com/asset.jpg"
            value={childUploadUrl}
            onChange={(event) => onChildUploadUrlChange(event.target.value)}
            className="flex-1 px-2 py-2 text-xs border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <button
            type="button"
            onClick={() => void onUploadUrl()}
            disabled={childUploadUrlLoading || !childUploadUrl.trim()}
            className="px-4 py-2 text-xs bg-slate-800 text-white rounded-md hover:bg-slate-900 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {childUploadUrlLoading ? 'Uploading…' : 'Upload URL'}
          </button>
        </div>
        <p className="text-[11px] text-gray-500">Leave the filename blank to use the name derived from the URL.</p>
        <p className="text-[11px] text-gray-500">URL uploads use the same folder and tags as file uploads. Video URLs are supported when the URL points to a video file.</p>
      </div>

      <button
        onClick={() => void onUpload()}
        disabled={childUploadLoading || childUploadItems.length === 0}
        className="px-4 py-2 text-xs bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {childUploadLoading ? 'Uploading…' : 'Upload variation(s)'}
      </button>
    </div>
  );
}
