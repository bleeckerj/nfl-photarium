import React from 'react';

export function ExifSection(props: {
  exifEntries: Array<[string, string | number]>;
}) {
  const { exifEntries } = props;

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
      </div>
      <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
        {exifEntries.map(([key, value]) => (
          <div
            key={key}
            className="flex items-start justify-between gap-3 border rounded px-2 py-1 text-[11px]"
          >
            <span className="text-gray-600 font-mono">{key}</span>
            <span className="text-gray-900 font-mono break-all text-right">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
