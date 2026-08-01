'use client';

import { useCallback, useEffect, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { ImageUp, X } from 'lucide-react';
import {
  ACCEPTED_REFERENCE_MIME,
  extractImageFileFromClipboard,
  validateReferenceFile,
} from './referenceImageSearch';

interface ReferenceImageDropzoneProps {
  file: File | null;
  onFileSelected: (file: File) => void;
  onClear: () => void;
  onInvalidFile: (reason: string) => void;
  disabled?: boolean;
}

export default function ReferenceImageDropzone({
  file,
  onFileSelected,
  onClear,
  onInvalidFile,
  disabled = false,
}: ReferenceImageDropzoneProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const acceptFile = useCallback(
    (candidate: File) => {
      const validation = validateReferenceFile(candidate);
      if (!validation.ok) {
        onInvalidFile(validation.reason);
        return;
      }
      onFileSelected(candidate);
    },
    [onFileSelected, onInvalidFile]
  );

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      if (acceptedFiles[0]) acceptFile(acceptedFiles[0]);
    },
    [acceptFile]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    multiple: false,
    disabled,
    accept: Object.fromEntries(ACCEPTED_REFERENCE_MIME.map((mime) => [mime, []])),
  });

  useEffect(() => {
    if (disabled) return;
    const handlePaste = (event: ClipboardEvent) => {
      const pasted = extractImageFileFromClipboard(event.clipboardData?.items);
      if (pasted) {
        event.preventDefault();
        acceptFile(pasted);
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [acceptFile, disabled]);

  if (file && previewUrl) {
    return (
      <div className="relative rounded-lg border border-gray-600 bg-gray-800 p-2 flex items-center gap-3">
        {/* Plain <img>: next/image can't optimize a local object URL */}
        <img
          src={previewUrl}
          alt="Reference"
          className="h-16 w-16 rounded object-cover bg-gray-900"
        />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] text-gray-200 truncate">{file.name}</p>
          <p className="text-[10px] text-gray-500">
            {(file.size / 1024).toFixed(0)} KB · not added to catalog
          </p>
        </div>
        <button
          onClick={onClear}
          className="text-gray-500 hover:text-gray-300"
          title="Clear reference image"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <div
      {...getRootProps()}
      className={`rounded-lg border-2 border-dashed px-3 py-6 text-center cursor-pointer transition-colors ${
        isDragActive
          ? 'border-purple-500 bg-purple-900/20'
          : 'border-gray-600 bg-gray-800 hover:border-gray-500'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      <input {...getInputProps()} />
      <ImageUp className="mx-auto mb-2 w-5 h-5 text-gray-400" />
      <p className="text-[11px] text-gray-300">
        {isDragActive ? 'Drop the reference image…' : 'Drop, paste, or click to pick a reference image'}
      </p>
      <p className="mt-1 text-[10px] text-gray-500">
        Finds catalog images that look like it — the reference is never uploaded
      </p>
    </div>
  );
}
