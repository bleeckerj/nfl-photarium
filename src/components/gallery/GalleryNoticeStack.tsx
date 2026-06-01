interface GalleryNoticeStackProps {
  duplicateGroupCount: number;
  duplicateImageCount: number;
  showDuplicatesOnly: boolean;
  colorSearchHex: string | null;
  colorSearchLoading: boolean;
  colorSearchError: string | null;
  galleryResultCount: number;
  focusNotice: string | null;
  onToggleDuplicatesOnly: () => void;
  onSelectDuplicateImages: () => void;
  onSelectDuplicatesKeepSingle: (strategy: 'newest' | 'oldest') => void;
  onClearColorSearch: () => void;
  onDismissFocusNotice: () => void;
}

export default function GalleryNoticeStack({
  duplicateGroupCount,
  duplicateImageCount,
  showDuplicatesOnly,
  colorSearchHex,
  colorSearchLoading,
  colorSearchError,
  galleryResultCount,
  focusNotice,
  onToggleDuplicatesOnly,
  onSelectDuplicateImages,
  onSelectDuplicatesKeepSingle,
  onClearColorSearch,
  onDismissFocusNotice,
}: GalleryNoticeStackProps) {
  return (
    <>
      {duplicateGroupCount > 0 && (
        <div className="mb-4 flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-[0.65rem] font-mono text-amber-900">
          <div>
            Found {duplicateGroupCount} duplicate group{duplicateGroupCount === 1 ? '' : 's'} affecting {duplicateImageCount} image{duplicateImageCount === 1 ? '' : 's'} (must match both original URL and content hash).
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={onToggleDuplicatesOnly}
              className="px-3 py-1 rounded-md border border-amber-300 bg-white text-amber-900 hover:bg-amber-100 transition"
            >
              {showDuplicatesOnly ? 'Show all images' : 'Show duplicates only'}
            </button>
            <button
              onClick={onSelectDuplicateImages}
              className="px-3 py-1 rounded-md border border-amber-300 bg-amber-100 text-amber-900 hover:bg-amber-200 transition"
            >
              Select all duplicates
            </button>
            <button
              onClick={() => onSelectDuplicatesKeepSingle('newest')}
              className="px-3 py-1 rounded-md border border-amber-300 bg-amber-100 text-amber-900 hover:bg-amber-200 transition"
            >
              Select duplicates (keep newest)
            </button>
            <button
              onClick={() => onSelectDuplicatesKeepSingle('oldest')}
              className="px-3 py-1 rounded-md border border-amber-300 bg-amber-100 text-amber-900 hover:bg-amber-200 transition"
            >
              Select duplicates (keep oldest)
            </button>
          </div>
        </div>
      )}

      {colorSearchHex && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-[0.65rem] font-mono text-violet-900">
          <span className="rounded-full border border-violet-300 bg-white px-2 py-0.5">
            Color: {colorSearchHex}
          </span>
          {colorSearchLoading && <span className="text-violet-700">Searching nearby colors…</span>}
          {!colorSearchLoading && colorSearchError && (
            <span className="text-red-700">Search failed: {colorSearchError}</span>
          )}
          {!colorSearchLoading && !colorSearchError && (
            <span>{galleryResultCount.toLocaleString()} result{galleryResultCount === 1 ? '' : 's'}</span>
          )}
          <button
            type="button"
            onClick={onClearColorSearch}
            className="rounded border border-violet-300 bg-white px-2.5 py-1 text-[0.6rem] hover:bg-violet-100"
          >
            Clear color search
          </button>
        </div>
      )}

      {focusNotice && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[0.65rem] font-mono text-amber-900">
          <span>{focusNotice}</span>
          <button
            type="button"
            onClick={onDismissFocusNotice}
            className="rounded border border-amber-300 bg-white px-2.5 py-1 text-[0.6rem] hover:bg-amber-100"
          >
            Dismiss
          </button>
        </div>
      )}
    </>
  );
}
