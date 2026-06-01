import type { ComponentProps, Ref } from 'react';

import GalleryCommandBar from '@/components/GalleryCommandBar';
import { GalleryFilters } from '@/components/gallery/GalleryFilters';
import GallerySemanticSearch, { type GallerySemanticSearchRef } from '@/components/gallery/GallerySemanticSearch';
import LegacyTopBar from '@/components/gallery/LegacyTopBar';
import { AUDIT_LOG_LIMIT } from '@/components/gallery/constants';

type LegacyTopBarProps = Omit<ComponentProps<typeof LegacyTopBar>, 'backupControls'>;
type GalleryFiltersProps = ComponentProps<typeof GalleryFilters>;
type GalleryCommandBarProps = ComponentProps<typeof GalleryCommandBar>;

interface GalleryControlsPanelProps {
  visible: boolean;
  filtersCollapsed: boolean;
  semanticSearchRef: Ref<GallerySemanticSearchRef>;
  namespace?: string;
  onSemanticAvailabilityChange: (available: boolean) => void;
  legacyTopBarProps: LegacyTopBarProps;
  backupTimeLabel: string;
  backupSizeLabel: string;
  backupAgeLabel: string;
  backupError: string | null;
  backupLoading: boolean;
  onCreateBackup: () => void;
  galleryFiltersProps: GalleryFiltersProps;
  auditLoading: boolean;
  auditEntries: Array<{
    id: string;
    filename?: string;
    status?: number;
    reason?: string;
    url?: string;
  }>;
  auditProgress: { checked: number; total: number };
  showCli: boolean;
  commandBarProps: GalleryCommandBarProps;
}

export default function GalleryControlsPanel({
  visible,
  filtersCollapsed,
  semanticSearchRef,
  namespace,
  onSemanticAvailabilityChange,
  legacyTopBarProps,
  backupTimeLabel,
  backupSizeLabel,
  backupAgeLabel,
  backupError,
  backupLoading,
  onCreateBackup,
  galleryFiltersProps,
  auditLoading,
  auditEntries,
  auditProgress,
  showCli,
  commandBarProps,
}: GalleryControlsPanelProps) {
  return (
    <div
      className={`relative z-[2000] transition-[max-height,opacity,transform] duration-300 ease-in-out ${
        visible
          ? 'mb-4 max-h-[2000px] overflow-visible opacity-100 translate-y-0'
          : 'mb-0 max-h-0 overflow-hidden pointer-events-none opacity-0 -translate-y-2'
      }`}
      aria-hidden={!visible}
    >
      <div className="mb-4 rounded-lg border border-gray-100 bg-white p-4 shadow-sm">
        <GallerySemanticSearch
          ref={semanticSearchRef}
          namespace={namespace}
          onAvailabilityChange={onSemanticAvailabilityChange}
        />
        <LegacyTopBar
          {...legacyTopBarProps}
          backupControls={(
            <div className="ml-1 flex items-end gap-2 text-[0.6rem] font-mono text-gray-500">
              <div className="text-right leading-tight">
                <div>Last backup: {backupTimeLabel}</div>
                <div className="text-gray-400">{backupSizeLabel} • {backupAgeLabel}</div>
                {backupError && <div className="text-red-500">{backupError}</div>}
              </div>
              <button
                type="button"
                onClick={onCreateBackup}
                disabled={backupLoading}
                className="inline-flex h-7 w-7 items-center justify-center rounded border border-gray-200 bg-white/80 text-gray-600 hover:bg-white disabled:opacity-50"
                title="Create backup"
                aria-label="Create backup"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="4" y="3" width="16" height="18" rx="2" />
                  <circle cx="12" cy="12" r="3" />
                  <path d="M12 9v6" />
                  <path d="M9 12h6" />
                  <path d="M7 7h2" />
                  <path d="M15 7h2" />
                </svg>
              </button>
            </div>
          )}
        />
      </div>
      <div
        className={`transition-[max-height] duration-300 ease-in-out ${filtersCollapsed ? 'max-h-0 overflow-hidden' : 'max-h-[1200px] overflow-visible'}`}
        aria-hidden={filtersCollapsed}
      >
        <div
          id="gallery-filter-controls"
          className={`relative z-10 space-y-4 rounded-lg bg-gray-50 p-4 transition-opacity duration-300 ${filtersCollapsed ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
        >
          <div className="grid grid-cols-1 gap-4 items-start">
            <div>
              <GalleryFilters {...galleryFiltersProps} />
            </div>
            <div className="sr-only" aria-hidden="true" />
          </div>

          {(auditLoading || auditEntries.length > 0) && (
            <div className="rounded-md border border-gray-200 bg-white p-3 text-[0.65rem] font-mono text-gray-700">
              <div className="flex items-center justify-between">
                <span>Audit log {auditEntries.length >= AUDIT_LOG_LIMIT ? `(last ${AUDIT_LOG_LIMIT})` : ''}</span>
                {auditLoading && <span className="text-gray-500">Running…</span>}
              </div>
              <div className="mt-2 h-1 w-full rounded-full bg-gray-100">
                <div
                  className="h-1 rounded-full bg-blue-500 transition-[width]"
                  style={{
                    width: auditProgress.total
                      ? `${Math.min(100, (auditProgress.checked / auditProgress.total) * 100)}%`
                      : '0%',
                  }}
                />
              </div>
              <div className="mt-2 max-h-40 overflow-y-auto space-y-1">
                {auditEntries.map((entry) => (
                  <div key={`${entry.id}-${entry.url ?? ''}-${entry.status ?? ''}`} className="flex items-start justify-between gap-2">
                    <div className="text-gray-600">
                      <div>{entry.id}</div>
                      <div className="text-gray-400">{entry.filename ?? '[no filename]'}</div>
                    </div>
                    <span className="text-gray-500">
                      {entry.status ?? '—'} {entry.reason ?? ''}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {showCli && <GalleryCommandBar {...commandBarProps} />}
        </div>
      </div>
    </div>
  );
}
