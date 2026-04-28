'use client';

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type RefObject } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, Database, Sparkles } from 'lucide-react';
import TextSearch, { type TextSearchRef } from '@/components/TextSearch';
import { RedisInfoModal } from '@/components/RedisInfoModal';

interface GallerySemanticSearchProps {
  namespace?: string;
  onAvailabilityChange?: (available: boolean) => void;
}

export interface GallerySemanticSearchRef {
  reveal: () => void;
  collapse: () => void;
}

type VectorStatus = 'checking' | 'available' | 'unavailable';
export type GallerySemanticSearchMode = 'collapsed' | 'expanded' | 'unavailable';

interface GallerySemanticSearchContentProps {
  mode: GallerySemanticSearchMode;
  namespace?: string;
  searchRef?: RefObject<TextSearchRef | null>;
  onCollapse?: () => void;
  onExpand?: () => void;
  onImageClick?: (result: { imageId: string; assetType?: 'image' | 'video' }) => void;
  onShowRedisInfo?: () => void;
}

export function GallerySemanticSearchContent({
  mode,
  namespace = '',
  searchRef,
  onCollapse,
  onExpand,
  onImageClick,
  onShowRedisInfo,
}: GallerySemanticSearchContentProps) {
  if (mode === 'unavailable') {
    return (
      <button
        type="button"
        onClick={onShowRedisInfo}
        className="flex w-full items-center gap-2 rounded-lg border border-dashed border-gray-200 bg-gray-50 px-3 py-2 text-left text-xs font-mono text-gray-400 transition-colors hover:text-gray-600"
        title="Click for more info"
      >
        <Database className="h-4 w-4 text-gray-300" />
        <span className="line-through decoration-gray-300">Semantic Search</span>
        <span className="rounded bg-white px-2 py-0.5 text-[10px] text-gray-500">Disabled</span>
      </button>
    );
  }

  if (mode === 'collapsed') {
    return (
      <button
        type="button"
        onClick={onExpand}
        className="flex w-full items-center justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-left font-mono text-gray-700 transition-colors hover:bg-gray-100"
      >
        <span className="flex items-center gap-2 text-[0.75rem]">
          <Sparkles className="h-4 w-4 text-violet-500" />
          <span>Semantic Search</span>
        </span>
        <span className="rounded-full border border-gray-300 bg-white px-2.5 py-1 text-[0.6rem] uppercase tracking-wide text-gray-500">
          Show
        </span>
      </button>
    );
  }

  return (
    <TextSearch
      ref={searchRef}
      namespace={namespace}
      headerAction={(
        <button
          type="button"
          onClick={onCollapse}
          className="inline-flex items-center gap-1 rounded-full border border-gray-300 bg-white/10 px-2.5 py-1 text-[10px] font-mono uppercase tracking-wide text-gray-200 hover:bg-white/20"
        >
          <ChevronDown className="h-3 w-3" />
          Hide
        </button>
      )}
      onImageClick={onImageClick}
    />
  );
}

const GallerySemanticSearch = forwardRef<GallerySemanticSearchRef, GallerySemanticSearchProps>(function GallerySemanticSearch(
  { namespace = '', onAvailabilityChange }: GallerySemanticSearchProps,
  ref
) {
  const router = useRouter();
  const searchRef = useRef<TextSearchRef | null>(null);
  const sectionRef = useRef<HTMLElement | null>(null);
  const [vectorStatus, setVectorStatus] = useState<VectorStatus>('checking');
  const [expanded, setExpanded] = useState(false);
  const [showRedisInfo, setShowRedisInfo] = useState(false);
  const statusCheckDisabled =
    process.env.NEXT_PUBLIC_REDIS_STATUS_CHECK_DISABLED === 'true' ||
    process.env.NEXT_PUBLIC_REDIS_STATUS_CHECK_DISABLED === '1';

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (statusCheckDisabled) {
      setVectorStatus('unavailable');
      setExpanded(false);
      return;
    }

    let cancelled = false;

    fetch('/api/images/vectors/status')
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        setVectorStatus(data.available ? 'available' : 'unavailable');
        if (!data.available) {
          setExpanded(false);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setVectorStatus('unavailable');
        setExpanded(false);
      });

    return () => {
      cancelled = true;
    };
  }, [statusCheckDisabled]);

  useEffect(() => {
    onAvailabilityChange?.(vectorStatus === 'available');
  }, [onAvailabilityChange, vectorStatus]);

  const reveal = useCallback(() => {
    setExpanded(true);

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        searchRef.current?.focusInput();
      });
    });
  }, []);

  const collapse = useCallback(() => {
    setExpanded(false);
  }, []);

  useImperativeHandle(ref, () => ({
    reveal,
    collapse,
  }), [collapse, reveal]);

  if (vectorStatus === 'checking') {
    return null;
  }

  const mode: GallerySemanticSearchMode =
    vectorStatus === 'unavailable'
      ? 'unavailable'
      : expanded
        ? 'expanded'
        : 'collapsed';

  return (
    <section
      ref={sectionRef}
      className="mb-4"
      aria-label="Semantic search"
      data-testid="gallery-semantic-search"
    >
      <GallerySemanticSearchContent
        mode={mode}
        namespace={namespace}
        searchRef={searchRef}
        onCollapse={collapse}
        onExpand={reveal}
        onImageClick={(result) => {
          router.push(result.assetType === 'video' ? `/videos/${result.imageId}` : `/images/${result.imageId}`);
        }}
        onShowRedisInfo={() => setShowRedisInfo(true)}
      />
      <RedisInfoModal isOpen={showRedisInfo} onClose={() => setShowRedisInfo(false)} />
    </section>
  );
});

export default GallerySemanticSearch;
