interface BulkEditHeaderProps {
  selectedCount: number;
  onClose: () => void;
  downloading: boolean;
  onDownload: () => void;
}

export function BulkEditHeader({ selectedCount, onClose, downloading, onDownload }: BulkEditHeaderProps) {
  return (
    <>
      <div className="flex items-center justify-between">
        <p className="text-gray-900 font-semibold">Bulk edit ({selectedCount} images)</p>
        <button onClick={onClose} className="text-gray-500 hover:text-gray-700">×</button>
      </div>
      <button onClick={onDownload} disabled={downloading} className="px-3 py-2 border rounded-md hover:bg-gray-100 disabled:opacity-40">
      {downloading ? 'Preparing download…' : 'Download original images (.zip)'}
      </button>
    </>
  );
}
