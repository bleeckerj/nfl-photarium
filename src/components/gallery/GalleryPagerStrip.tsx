interface GalleryPagerStripProps {
  pageIndex: number;
  totalPages: number;
  prevPageRangeLabel: string | null;
  nextPageRangeLabel: string | null;
  onFirstPage: () => void;
  onJumpBackTen: () => void;
  onPrevPage: () => void;
  onNextPage: () => void;
  onJumpForwardTen: () => void;
  onLastPage: () => void;
}

const pagerButtonClasses =
  'rounded-md border border-gray-200 bg-white px-2.5 py-1 text-[0.65rem] font-mono text-gray-700 hover:bg-gray-100 disabled:opacity-40';

export function GalleryPagerStrip({
  pageIndex,
  totalPages,
  prevPageRangeLabel,
  nextPageRangeLabel,
  onFirstPage,
  onJumpBackTen,
  onPrevPage,
  onNextPage,
  onJumpForwardTen,
  onLastPage,
}: GalleryPagerStripProps) {
  const safeTotalPages = Math.max(totalPages, 1);
  const onFirstPageDisabled = pageIndex <= 1;
  const onLastPageDisabled = pageIndex >= safeTotalPages;

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 px-4 py-2"
      data-testid="gallery-pager-strip"
    >
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onFirstPage}
          disabled={onFirstPageDisabled}
          className={pagerButtonClasses}
        >
          First
        </button>
        <button
          type="button"
          onClick={onJumpBackTen}
          disabled={onFirstPageDisabled}
          className={pagerButtonClasses}
        >
          -10
        </button>
        <button
          type="button"
          onClick={onPrevPage}
          disabled={onFirstPageDisabled}
          className={pagerButtonClasses}
          title={prevPageRangeLabel ? `Previous (${prevPageRangeLabel})` : 'Previous page'}
        >
          Prev
        </button>
      </div>
      <span className="text-[0.65rem] font-mono text-gray-600">
        {pageIndex} / {safeTotalPages}
      </span>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onNextPage}
          disabled={onLastPageDisabled}
          className={pagerButtonClasses}
          title={nextPageRangeLabel ? `Next (${nextPageRangeLabel})` : 'Next page'}
        >
          Next
        </button>
        <button
          type="button"
          onClick={onJumpForwardTen}
          disabled={onLastPageDisabled}
          className={pagerButtonClasses}
        >
          +10
        </button>
        <button
          type="button"
          onClick={onLastPage}
          disabled={onLastPageDisabled}
          className={pagerButtonClasses}
        >
          Last
        </button>
      </div>
    </div>
  );
}
