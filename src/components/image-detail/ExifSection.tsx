import React from 'react';

export function ExifSection(props: {
  exifEntries: Array<[string, string | number]>;
  clearExif: boolean;
  setClearExif: (value: boolean) => void;
}) {
  const { exifEntries, clearExif, setClearExif } = props;

  if (exifEntries.length === 0) {
    return null;
  }

  return (
    <div id="exif-section">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <p className="text-xs font-mono font-medum text-gray-700">EXIF</p>
          <p className="text-[10px] text-gray-500">{exifEntries.length} fields</p>
        </div>
        <button
          onClick={() => setClearExif(!clearExif)}
          className={`px-2 py-0.5 text-[10px] rounded border transition-colors ${
            clearExif
              ? 'border-red-400 bg-red-50 text-red-700 hover:bg-red-100'
              : 'border-gray-300 text-gray-600 hover:bg-gray-50'
          }`}
        >
          {clearExif ? '✓ Will clear EXIF on save' : 'Clear EXIF'}
        </button>
      </div>
      {clearExif && (
        <p className="text-[10px] text-amber-600 mt-1">
          EXIF data will be removed when you save. Press &quot;Discard&quot; to cancel.
        </p>
      )}
      <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
        {exifEntries.map(([key, value]) => (
          <div
            key={key}
            className={`flex items-start justify-between gap-3 border rounded px-2 py-1 text-[11px] ${
              clearExif ? 'opacity-50 line-through' : ''
            }`}
          >
            <span className="text-gray-600 font-mono">{key}</span>
            <span className="text-gray-900 font-mono break-all text-right">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
