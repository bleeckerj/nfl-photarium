interface ImportUrlPanelProps {
  importUrl: string;
  setImportUrl: (value: string) => void;
  importLoading: boolean;
  importError: string | null;
  onImportFromUrl: () => void;
}

export default function ImportUrlPanel({
  importUrl,
  setImportUrl,
  importLoading,
  importError,
  onImportFromUrl,
}: ImportUrlPanelProps) {
  return (
    <div className="mt-4 p-4 border border-dashed rounded-lg bg-white/60">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-mono font-medium text-gray-900">Import media from URL</p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          type="url"
          value={importUrl}
          onChange={(event) => setImportUrl(event.target.value)}
          placeholder="https://example.com/asset.jpg or .mp4"
          className="flex-1 border border-gray-300 rounded-md px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          type="button"
          onClick={onImportFromUrl}
          disabled={importLoading || !importUrl.trim()}
          className="px-4 py-2 text-xs bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
        >
          {importLoading ? 'Fetching...' : 'Fetch media'}
        </button>
      </div>
      {importError && <p className="text-xs text-red-600 mt-1">{importError}</p>}
      <p className="text-[11px] text-gray-500 mt-1">
        Images are downloaded into the queue. Short videos are queued by URL and uploaded through the video pipeline when you click Upload.
      </p>
    </div>
  );
}
