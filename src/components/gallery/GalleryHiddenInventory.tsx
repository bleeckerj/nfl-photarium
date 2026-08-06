'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

export type GalleryHiddenInventoryVariant = 'cli' | 'utility-row' | 'utility-badge';

interface GalleryHiddenInventoryProps {
  hiddenFolders: string[];
  hiddenTags: string[];
  hiddenNamespaces: string[];
  onClearHiddenFolders: () => boolean;
  onClearHiddenTags: () => boolean;
  onClearHiddenNamespaces: () => boolean;
  variant: GalleryHiddenInventoryVariant;
}

type HiddenCategory = {
  key: 'folders' | 'tags' | 'namespaces';
  label: string;
  names: string[];
  onClear: () => boolean;
};

const PREVIEW_LIMIT = 3;

export const getHiddenVisibilityCount = ({
  hiddenFolders,
  hiddenTags,
  hiddenNamespaces,
}: Pick<GalleryHiddenInventoryProps, 'hiddenFolders' | 'hiddenTags' | 'hiddenNamespaces'>): number =>
  hiddenFolders.length + hiddenTags.length + hiddenNamespaces.length;

const formatCategoryPreview = (names: string[]): string => {
  if (names.length <= PREVIEW_LIMIT) return names.join(', ');
  return `${names.slice(0, PREVIEW_LIMIT).join(', ')}, …`;
};

const formatCategoryCount = (label: string, count: number): string => {
  const singularLabel = label.toLowerCase().replace(/s$/, '');
  return `${count} ${singularLabel}${count === 1 ? '' : 's'}`;
};

const getSummary = (categories: HiddenCategory[], total: number): string => {
  if (total === 0) return 'HIDDEN · none';
  return [
    'HIDDEN',
    ...categories.map(({ names, label }) => formatCategoryCount(label, names.length)),
  ].join(' · ');
};

export default function GalleryHiddenInventory({
  hiddenFolders,
  hiddenTags,
  hiddenNamespaces,
  onClearHiddenFolders,
  onClearHiddenTags,
  onClearHiddenNamespaces,
  variant,
}: GalleryHiddenInventoryProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const categories = useMemo<HiddenCategory[]>(() => [
    { key: 'folders', label: 'Folders', names: hiddenFolders, onClear: onClearHiddenFolders },
    { key: 'tags', label: 'Tags', names: hiddenTags, onClear: onClearHiddenTags },
    { key: 'namespaces', label: 'Namespaces', names: hiddenNamespaces, onClear: onClearHiddenNamespaces },
  ], [
    hiddenFolders,
    hiddenTags,
    hiddenNamespaces,
    onClearHiddenFolders,
    onClearHiddenTags,
    onClearHiddenNamespaces,
  ]);
  const total = getHiddenVisibilityCount({ hiddenFolders, hiddenTags, hiddenNamespaces });
  const summary = getSummary(categories, total);
  const isBadge = variant === 'utility-badge';

  useEffect(() => {
    if (!open) return undefined;

    const handlePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !rootRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  if (isBadge && total === 0) return null;

  const triggerLabel = total > 0
    ? `${total} hidden rules. Inspect hidden visibility.`
    : 'No hidden rules. Inspect hidden visibility.';
  const popoverId = `gallery-hidden-inventory-${variant}`;
  const populatedCategories = categories.filter(({ names }) => names.length > 0);
  const displaySummary = variant === 'utility-row' && total === 0 ? 'No hidden items' : summary;

  return (
    <div
      ref={rootRef}
      className={variant === 'cli'
        ? 'relative mt-2'
        : variant === 'utility-badge'
          ? 'absolute bottom-full right-0 z-10 mb-2'
          : 'relative'}
      data-testid={`gallery-hidden-inventory-${variant}`}
    >
      <div
        className={variant === 'cli'
            ? 'flex min-h-7 items-center gap-2 border-t border-slate-800 bg-slate-900/80 px-2 text-[0.6rem] font-mono text-slate-300'
            : variant === 'utility-row'
              ? 'flex items-center gap-2 rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-[0.6rem] font-mono text-gray-200'
            : 'whitespace-nowrap'}
      >
        {isBadge ? (
          <button
            type="button"
            onClick={() => setOpen((previous) => !previous)}
            className="pointer-events-auto flex items-center gap-2 rounded-full border border-gray-700 bg-gray-900/95 px-3 py-2 text-[0.65rem] font-mono uppercase tracking-wide text-white shadow-lg hover:bg-gray-800"
            aria-label={triggerLabel}
            aria-controls={popoverId}
            aria-expanded={open}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-amber-300" aria-hidden="true" />
            {total} hidden
          </button>
        ) : (
          <>
            <span className={variant === 'cli' ? 'text-amber-200' : 'text-amber-100'}>{displaySummary}</span>
            <button
              type="button"
              onClick={() => setOpen((previous) => !previous)}
              className={variant === 'cli'
                ? 'ml-auto rounded border border-slate-600 px-2 py-1 text-[0.55rem] uppercase tracking-wide text-slate-200 hover:border-slate-400'
                : 'ml-auto rounded border border-white/20 px-2 py-1 text-[0.55rem] uppercase tracking-wide text-gray-100 hover:bg-white/10'}
              aria-label={triggerLabel}
              aria-controls={popoverId}
              aria-expanded={open}
            >
              Inspect
            </button>
          </>
        )}
      </div>

      <div
        id={popoverId}
        role="dialog"
        aria-label="Hidden gallery visibility"
        hidden={!open}
        className={variant === 'cli'
          ? 'absolute left-0 top-full z-20 mt-2 w-full min-w-[18rem] rounded-lg border border-slate-600 bg-slate-900 p-3 text-[0.6rem] font-mono text-slate-200 shadow-xl'
          : 'absolute bottom-full right-0 z-20 mb-2 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-gray-600 bg-gray-900 p-3 text-[0.6rem] font-mono text-gray-100 shadow-xl'}
      >
        <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-2">
          <strong className="font-medium uppercase tracking-wide text-gray-200">Hidden from gallery</strong>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-gray-400 hover:text-white"
            aria-label="Close hidden visibility"
          >
            ×
          </button>
        </div>

        {populatedCategories.length > 0 ? (
          <div className="divide-y divide-white/10">
            {populatedCategories.map(({ key, label, names, onClear }) => (
              <div key={key} className="flex items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="text-gray-100">{label} · {names.length}</div>
                  <div className="truncate text-gray-400" title={names.join(', ')}>{formatCategoryPreview(names)}</div>
                </div>
                <button
                  type="button"
                  onClick={onClear}
                  className="shrink-0 rounded border border-white/20 px-2 py-1 text-[0.55rem] uppercase tracking-wide text-gray-200 hover:bg-white/10"
                >
                  Show all {label.toLowerCase()}
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="py-3 text-gray-400">No hidden folders, tags, or namespaces.</p>
        )}
      </div>
    </div>
  );
}
