import { Loader2, Upload } from 'lucide-react';
import clsx from 'clsx';
import type { HTMLAttributes, InputHTMLAttributes } from 'react';

interface UploaderDropzoneProps {
  rootProps: HTMLAttributes<HTMLDivElement>;
  inputProps: InputHTMLAttributes<HTMLInputElement>;
  isDragActive: boolean;
  isUploading: boolean;
}

export default function UploaderDropzone({
  rootProps,
  inputProps,
  isDragActive,
  isUploading,
}: UploaderDropzoneProps) {
  return (
    <div
      {...rootProps}
      className={clsx(
        'mt-4 border-2 border-dashed rounded-lg p-2 text-center transition-all cursor-pointer relative overflow-hidden',
        isDragActive ? 'border-blue-400 bg-blue-50' :
        isUploading ? 'border-blue-300 bg-gradient-to-r from-blue-50 via-white to-blue-50' :
        'border-gray-300 hover:border-gray-400'
      )}
    >
      {isUploading && (
        <div className="absolute inset-0 rounded-lg pointer-events-none">
          <div className="absolute inset-0 rounded-lg border-2 border-blue-400 animate-pulse" />
        </div>
      )}
      <input {...inputProps} />
      {isUploading ? (
        <Loader2 className="mx-auto h-8 w-8 text-blue-500 mb-4 animate-spin" />
      ) : (
        <Upload className="mx-auto h-8 w-8 text-gray-400 mb-4" />
      )}
      <p className="text-xs font-mono font-medium text-gray-900 mb-2">
        {isUploading ? 'Uploading...' : isDragActive ? 'Drop images or a .zip/.key here' : 'Drag & drop images or a .zip/.key here'}
      </p>
      <p className="text-xs font-mono text-gray-500">
        {isUploading ? 'Please wait while your images are being uploaded' : 'or click to select files (.zip/.key supported)'}
      </p>
    </div>
  );
}
