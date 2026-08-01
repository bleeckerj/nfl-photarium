'use client';

import type { ComponentProps, RefObject } from 'react';
import dynamic from 'next/dynamic';
import HoverPreview from '@/components/HoverPreview';
import { GalleryCompactHeader } from './GalleryCompactHeader';
import GalleryControlsPanel from './GalleryControlsPanel';
import GalleryNoticeStack from './GalleryNoticeStack';
import { GalleryPagerStrip } from './GalleryPagerStrip';
import GalleryUtilityRail from './GalleryUtilityRail';
import type { GalleryModals as GalleryModalsComponent } from './GalleryModals';
import GalleryResultsRegion from './GalleryResultsRegion';

// The modal stack (copy/edit/bulk-edit/namespace/delete) is interaction-only;
// splitting it keeps it out of the initial gallery bundle.
const GalleryModals = dynamic(
  () => import('./GalleryModals').then((mod) => ({ default: mod.GalleryModals })),
  { ssr: false }
);

type GalleryShellProps = {
  galleryTopRef: RefObject<HTMLDivElement | null>;
  compactHeaderProps: ComponentProps<typeof GalleryCompactHeader>;
  pagerStripProps: ComponentProps<typeof GalleryPagerStrip>;
  noticeStackProps: ComponentProps<typeof GalleryNoticeStack>;
  controlsPanelProps: ComponentProps<typeof GalleryControlsPanel>;
  utilityRailProps: ComponentProps<typeof GalleryUtilityRail>;
  resultsRegionProps: ComponentProps<typeof GalleryResultsRegion>;
  modalsProps: ComponentProps<typeof GalleryModalsComponent>;
  hoverPreviewProps: ComponentProps<typeof HoverPreview> | null;
};

export function GalleryShell({
  galleryTopRef,
  compactHeaderProps,
  pagerStripProps,
  noticeStackProps,
  controlsPanelProps,
  utilityRailProps,
  resultsRegionProps,
  modalsProps,
  hoverPreviewProps,
}: GalleryShellProps) {
  return (
    <div id="image-gallery-card" ref={galleryTopRef} className="overscroll-none bg-white rounded-lg shadow-lg p-6">
      <div
        id="gallery-top-bar"
        className="sticky top-0 z-[3000] -m-6 mb-6 overflow-visible rounded-t-lg border-b border-gray-100 bg-white/95 backdrop-blur"
      >
        <GalleryCompactHeader {...compactHeaderProps} />
        <GalleryPagerStrip {...pagerStripProps} />
      </div>

      <GalleryNoticeStack {...noticeStackProps} />
      <GalleryControlsPanel {...controlsPanelProps} />
      <GalleryUtilityRail {...utilityRailProps} />
      <GalleryResultsRegion {...resultsRegionProps} />
      <GalleryModals {...modalsProps} />

      {hoverPreviewProps ? <HoverPreview {...hoverPreviewProps} /> : null}
    </div>
  );
}
