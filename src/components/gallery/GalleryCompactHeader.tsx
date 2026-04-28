interface GalleryCompactHeaderProps {
  filteredCount: number;
  totalCount: number;
  pageIndex: number;
  totalPages: number;
  namespaceLabel: string;
  controlsVisible: boolean;
  showSearchButton: boolean;
  onToggleControls: () => void;
  onOpenSearch: () => void;
}

export function GalleryCompactHeader({
  filteredCount,
  totalCount,
  pageIndex,
  totalPages,
  namespaceLabel,
  controlsVisible,
  showSearchButton,
  onToggleControls,
  onOpenSearch,
}: GalleryCompactHeaderProps) {
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
      data-testid="gallery-compact-header"
    >
      <div className="min-w-0">
        <p className="text-[0.7rem] font-mono text-gray-900">
          Image Gallery ({filteredCount}/{totalCount})
        </p>
        <p className="text-[0.65rem] font-mono text-gray-500">
          Namespace: {namespaceLabel} · Page {pageIndex} / {Math.max(totalPages, 1)}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {showSearchButton ? (
          <button
            type="button"
            onClick={onOpenSearch}
            className="inline-flex items-center rounded-md border border-gray-200 bg-white px-3 py-1 text-[0.7rem] font-mono text-gray-700 hover:bg-gray-100"
          >
            Search
          </button>
        ) : null}
        <button
          type="button"
          onClick={onToggleControls}
          className="inline-flex items-center rounded-md border border-gray-200 bg-white px-3 py-1 text-[0.7rem] font-mono text-gray-700 hover:bg-gray-100"
          aria-pressed={controlsVisible}
        >
          {controlsVisible ? 'Hide controls' : 'Show controls'}
        </button>
      </div>
    </div>
  );
}
