/**
 * TextSearch Component
 *
 * Search for images using natural language descriptions.
 * Uses CLIP embeddings to find semantically matching images.
 */

'use client';

import { useState, useCallback, useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import type { ReactNode } from 'react';
import {
  buildReferenceSearchFormData,
  type ReferenceSearchResponse,
} from './referenceImageSearch';
import TextSearchView from './TextSearchView';

export interface SearchResult {
  imageId: string;
  score?: number;
  filename?: string;
  folder?: string;
  matchType?: string;
  assetType?: 'image' | 'video';
  videoThumbnailUrl?: string;
  videoPlaybackUrl?: string;
}

interface TextSearchProps {
  className?: string;
  headerAction?: ReactNode;
  onImageClick?: (result: SearchResult) => void;
  initialQuery?: string;
  namespace?: string;
}

export interface TextSearchRef {
  focusInput: () => void;
  revealSearch: () => void;
}

export interface HoverPreview {
  imageId: string;
  filename?: string;
  x: number;
  y: number;
}

const SEARCH_LIMIT = parseInt(process.env.NEXT_PUBLIC_SEARCH_LIMIT || '48', 10);
const PAGE_SIZE = parseInt(process.env.NEXT_PUBLIC_SEARCH_PAGE_SIZE || '12', 10);

const TextSearch = forwardRef<TextSearchRef, TextSearchProps>(function TextSearch(
  { className = '', headerAction, onImageClick, initialQuery = '', namespace = '' }: TextSearchProps,
  ref
) {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const [showPresets, setShowPresets] = useState(false);
  const [hoverPreview, setHoverPreview] = useState<HoverPreview | null>(null);
  const [searchType, setSearchType] = useState<'text' | 'color' | 'image'>('text');
  const [searchAllNamespaces, setSearchAllNamespaces] = useState(false);
  const [referenceFile, setReferenceFile] = useState<File | null>(null);
  const [exactMatches, setExactMatches] = useState<SearchResult[]>([]);
  const [coverage, setCoverage] = useState<ReferenceSearchResponse['coverage'] | null>(null);
  const [searchWarnings, setSearchWarnings] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const clearReferenceSearchState = useCallback(() => {
    setReferenceFile(null);
    setExactMatches([]);
    setCoverage(null);
    setSearchWarnings([]);
  }, []);

  const switchSearchType = useCallback((next: 'text' | 'color' | 'image') => {
    setSearchType(next);
    if (next !== 'image') clearReferenceSearchState();
  }, [clearReferenceSearchState]);

  const focusTextInput = useCallback(() => {
    switchSearchType('text');
    setShowPresets(true);
    inputRef.current?.focus();
  }, [switchSearchType]);

  useImperativeHandle(ref, () => ({
    focusInput: () => focusTextInput(),
    revealSearch: () => focusTextInput(),
  }), [focusTextInput]);

  const effectiveNamespaceFilter = (() => {
    if (namespace === '__all__') return null;
    if (searchAllNamespaces) return null;
    return namespace || 'cf-default';
  })();

  useEffect(() => {
    try {
      const saved = localStorage.getItem('textSearchHistory');
      if (saved) setSearchHistory(JSON.parse(saved).slice(0, 10));
    } catch {
      // Ignore localStorage errors.
    }
  }, []);

  const addToHistory = useCallback((searchQuery: string) => {
    setSearchHistory((previous) => {
      const filtered = previous.filter((entry) => entry !== searchQuery);
      const updated = [searchQuery, ...filtered].slice(0, 10);
      try {
        localStorage.setItem('textSearchHistory', JSON.stringify(updated));
      } catch {
        // Ignore localStorage errors.
      }
      return updated;
    });
  }, []);

  const handleMouseEnter = useCallback((event: React.MouseEvent, result: SearchResult) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setHoverPreview({
      imageId: result.imageId,
      filename: result.filename,
      x: rect.left + rect.width / 2,
      y: rect.top,
    });
  }, []);

  const handleMouseLeave = useCallback(() => setHoverPreview(null), []);

  const search = useCallback(async (searchQuery?: string, trigger: string = 'manual') => {
    const q = searchQuery ?? query;
    if (!q.trim()) return;

    setLoading(true);
    setError(null);
    setResults([]);
    setVisibleCount(PAGE_SIZE);

    try {
      const response = await fetch('/api/images/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-photarium-component': 'TextSearch',
          'x-photarium-trigger': trigger,
          'x-photarium-source': 'ui',
        },
        body: JSON.stringify({
          type: searchType,
          query: q.trim(),
          limit: SEARCH_LIMIT,
          namespace: effectiveNamespaceFilter,
          diagnostics: { component: 'TextSearch', trigger },
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Search failed');
      setResults(data.results || []);
      addToHistory(q.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setLoading(false);
    }
  }, [query, searchType, addToHistory, effectiveNamespaceFilter]);

  const searchByImage = useCallback(async (file: File, trigger: string = 'reference-selected') => {
    setLoading(true);
    setError(null);
    setResults([]);
    setExactMatches([]);
    setCoverage(null);
    setSearchWarnings([]);
    setVisibleCount(PAGE_SIZE);

    try {
      const response = await fetch('/api/images/search/upload', {
        method: 'POST',
        headers: {
          'x-photarium-component': 'TextSearch',
          'x-photarium-trigger': trigger,
          'x-photarium-source': 'ui',
        },
        body: buildReferenceSearchFormData(file, SEARCH_LIMIT, effectiveNamespaceFilter),
      });
      const data = await response.json() as ReferenceSearchResponse & { error?: string };
      if (!response.ok) throw new Error(data.error || 'Search failed');
      setResults(data.results || []);
      setExactMatches(data.exactMatches || []);
      setCoverage(data.coverage ?? null);
      setSearchWarnings(data.warnings || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setLoading(false);
    }
  }, [effectiveNamespaceFilter]);

  const handleReferenceSelected = useCallback((file: File) => {
    setReferenceFile(file);
    setError(null);
    searchByImage(file);
  }, [searchByImage]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      search(undefined, 'enter');
    }
  }, [search]);

  const clearSearch = useCallback(() => {
    setQuery('');
    setResults([]);
    setVisibleCount(PAGE_SIZE);
    setError(null);
    clearReferenceSearchState();
    inputRef.current?.focus();
  }, [clearReferenceSearchState]);

  const getScoreLabel = (score: number): string => {
    if (score < 0.20) return 'Perfect match';
    if (score < 0.25) return 'Excellent';
    if (score < 0.30) return 'Very good';
    if (score < 0.35) return 'Good';
    if (score < 0.40) return 'Fair';
    return 'Weak';
  };

  const getScoreColor = (score: number): string => {
    if (score < 0.25) return 'bg-emerald-500';
    if (score < 0.30) return 'bg-green-500';
    if (score < 0.35) return 'bg-lime-500';
    if (score < 0.40) return 'bg-yellow-500';
    return 'bg-orange-500';
  };

  const getResultScore = (result: SearchResult): number | null => (
    typeof result.score === 'number' && Number.isFinite(result.score) ? result.score : null
  );

  return (
    <TextSearchView
      className={className}
      headerAction={headerAction}
      onImageClick={onImageClick}
      namespace={namespace}
      effectiveNamespaceFilter={effectiveNamespaceFilter}
      searchAllNamespaces={searchAllNamespaces}
      setSearchAllNamespaces={setSearchAllNamespaces}
      searchType={searchType}
      switchSearchType={switchSearchType}
      inputRef={inputRef}
      query={query}
      setQuery={setQuery}
      handleKeyDown={handleKeyDown}
      showPresets={showPresets}
      setShowPresets={setShowPresets}
      clearSearch={clearSearch}
      error={error}
      referenceFile={referenceFile}
      handleReferenceSelected={handleReferenceSelected}
      clearReferenceSearchState={clearReferenceSearchState}
      setError={setError}
      setResults={setResults}
      loading={loading}
      searchByImage={searchByImage}
      search={search}
      searchHistory={searchHistory}
      exactMatches={exactMatches}
      handleMouseEnter={handleMouseEnter}
      handleMouseLeave={handleMouseLeave}
      searchWarnings={searchWarnings}
      results={results}
      visibleCount={visibleCount}
      setVisibleCount={setVisibleCount}
      getResultScore={getResultScore}
      getScoreLabel={getScoreLabel}
      getScoreColor={getScoreColor}
      coverage={coverage}
      hoverPreview={hoverPreview}
      pageSize={PAGE_SIZE}
    />
  );
});

export default TextSearch;
