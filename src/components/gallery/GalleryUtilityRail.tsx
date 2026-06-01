import { Info } from 'lucide-react';

type VideoMetaState = {
  enabled: boolean;
  limit: number;
  returned: number;
  totalScoped: number;
  truncated: boolean;
} | null;

interface GalleryUtilityRailProps {
  expanded: boolean;
  filtersCollapsed: boolean;
  showCli: boolean;
  videoResultsNotice: string | null;
  videoMeta: VideoMetaState;
  selectedCount: number;
  onExpandChange: (expanded: boolean) => void;
  onToggleFilters: () => void;
  onToggleCli: () => void;
  onLoadMoreVideos: () => void;
  onSelectPage: () => void;
  onOpenBulkEdit: () => void;
  onClearSelection: () => void;
  onScrollTop: () => void;
  onScrollToUploader: () => void;
}

const utilityButtonClasses =
  'text-[0.65rem] font-mono px-3 py-1 rounded-full bg-white/10 hover:bg-white/20 transition';

export default function GalleryUtilityRail({
  expanded,
  filtersCollapsed,
  showCli,
  videoResultsNotice,
  videoMeta,
  selectedCount,
  onExpandChange,
  onToggleFilters,
  onToggleCli,
  onLoadMoreVideos,
  onSelectPage,
  onOpenBulkEdit,
  onClearSelection,
  onScrollTop,
  onScrollToUploader,
}: GalleryUtilityRailProps) {
  return (
    <div
      className="hidden sm:block fixed right-4 top-1/2 -translate-y-1/2 z-[3000]"
      onMouseEnter={() => onExpandChange(true)}
      onMouseLeave={() => onExpandChange(false)}
      onFocusCapture={() => onExpandChange(true)}
      onBlurCapture={() => onExpandChange(false)}
    >
      {expanded ? (
        <div className="pointer-events-auto flex flex-col gap-3 bg-gray-900 text-white border border-gray-700 rounded-2xl shadow-xl px-4 py-3 min-w-[220px]">
          <div className="flex items-center justify-between text-[0.6rem] uppercase tracking-wide text-gray-300">
            <span>Utility</span>
            <button
              onClick={() => onExpandChange(false)}
              className="text-gray-400 hover:text-white"
              aria-label="Collapse utility bar"
            >
              ✕
            </button>
          </div>
          <button
            onClick={onToggleFilters}
            className={`${utilityButtonClasses} text-left bg-white/10 hover:bg-white/20`}
            aria-pressed={!filtersCollapsed}
          >
            {filtersCollapsed ? 'Show filters' : 'Hide filters'}
          </button>
          <button
            onClick={onToggleCli}
            className={`${utilityButtonClasses} text-left bg-white/10 hover:bg-white/20`}
            aria-pressed={showCli}
          >
            {showCli ? 'Hide CLI' : 'Show CLI'}
          </button>
          {videoResultsNotice && (
            <div className="flex flex-col gap-1 rounded-xl border border-sky-300/40 bg-sky-500/10 p-3 text-[0.6rem] text-sky-100">
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-sky-400/20 px-2 py-0.5 uppercase tracking-wide text-sky-100">
                  Videos
                </span>
                <span>
                  {videoMeta ? `${videoMeta.returned}/${videoMeta.totalScoped || videoMeta.returned} shown` : 'Video results limited'}
                </span>
                {videoMeta?.limit ? <span className="text-sky-200/80">limit {videoMeta.limit}</span> : null}
                <button
                  type="button"
                  className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-sky-300/50 bg-white/10 text-sky-100 hover:bg-white/20"
                  title={videoResultsNotice}
                  aria-label={videoResultsNotice}
                >
                  <Info className="h-3 w-3" />
                </button>
              </div>
              <button
                type="button"
                onClick={onLoadMoreVideos}
                className={`${utilityButtonClasses} self-start border border-sky-300/50 bg-white/10 hover:bg-white/20`}
              >
                Load more videos
              </button>
            </div>
          )}
          {selectedCount > 0 && (
            <div className="flex flex-col gap-1 text-[0.6rem] text-white">
              <span>{selectedCount} selected</span>
              <div className="flex flex-wrap gap-2">
                <button onClick={onSelectPage} className={`${utilityButtonClasses} border border-white/20`}>
                  Select page
                </button>
                <button onClick={onOpenBulkEdit} className={`${utilityButtonClasses} bg-blue-600 hover:bg-blue-500`}>
                  Bulk edit
                </button>
                <button onClick={onClearSelection} className={`${utilityButtonClasses} border border-white/20`}>
                  Clear
                </button>
              </div>
            </div>
          )}
          <div className="flex flex-col gap-2 text-[0.6rem] text-gray-200">
            <button onClick={onScrollTop} className={`${utilityButtonClasses} text-left`}>
              Scroll top
            </button>
            <button onClick={onScrollToUploader} className={`${utilityButtonClasses} text-left`}>
              Go to uploader
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => onExpandChange(true)}
          className="pointer-events-auto flex items-center gap-2 bg-gray-900/90 text-white border border-gray-700 rounded-full shadow-lg px-3 py-2 text-[0.65rem] font-mono uppercase tracking-wide hover:bg-gray-800"
          aria-label="Expand utility bar"
        >
          Utility
        </button>
      )}
    </div>
  );
}
