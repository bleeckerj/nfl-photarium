'use client';

import type { Dispatch, KeyboardEvent, MouseEvent, RefObject, ReactNode, SetStateAction } from 'react';
import Image from 'next/image';
import { Search, X, Loader2, Sparkles, History, Palette, ImageUp } from 'lucide-react';
import { getCloudflareImageUrl } from '@/utils/imageUtils';
import ColorWheel from './ColorWheel';
import ReferenceImageDropzone from './ReferenceImageDropzone';
import { formatWarningMessage, type ReferenceSearchResponse } from './referenceImageSearch';
import type { HoverPreview, SearchResult } from './TextSearch';

export interface TextSearchViewProps {
  className: string;
  headerAction?: ReactNode;
  onImageClick?: (result: SearchResult) => void;
  namespace: string;
  effectiveNamespaceFilter: string | null;
  searchAllNamespaces: boolean;
  setSearchAllNamespaces: (value: boolean) => void;
  searchType: 'text' | 'color' | 'image';
  switchSearchType: (next: 'text' | 'color' | 'image') => void;
  inputRef: RefObject<HTMLInputElement | null>;
  query: string;
  setQuery: Dispatch<SetStateAction<string>>;
  handleKeyDown: (event: KeyboardEvent) => void;
  showPresets: boolean;
  setShowPresets: Dispatch<SetStateAction<boolean>>;
  clearSearch: () => void;
  error: string | null;
  referenceFile: File | null;
  handleReferenceSelected: (file: File) => void;
  clearReferenceSearchState: () => void;
  setError: Dispatch<SetStateAction<string | null>>;
  setResults: Dispatch<SetStateAction<SearchResult[]>>;
  loading: boolean;
  searchByImage: (file: File, trigger?: string) => void;
  search: (searchQuery?: string, trigger?: string) => void;
  searchHistory: string[];
  exactMatches: SearchResult[];
  handleMouseEnter: (event: MouseEvent, result: SearchResult) => void;
  handleMouseLeave: () => void;
  searchWarnings: string[];
  results: SearchResult[];
  visibleCount: number;
  setVisibleCount: Dispatch<SetStateAction<number>>;
  getResultScore: (result: SearchResult) => number | null;
  getScoreLabel: (score: number) => string;
  getScoreColor: (score: number) => string;
  coverage: ReferenceSearchResponse['coverage'] | null;
  hoverPreview: HoverPreview | null;
  pageSize: number;
}

const SEARCH_PRESETS = [
  { label: 'Blue tones', query: 'blue sky ocean water' },
  { label: 'Warm colors', query: 'warm sunset orange red golden' },
  { label: 'People', query: 'person face portrait human' },
  { label: 'Nature', query: 'nature landscape trees forest mountains' },
  { label: 'Urban', query: 'city buildings architecture urban street' },
  { label: 'Animals', query: 'animal pet wildlife creature' },
  { label: 'Food', query: 'food meal dish cuisine delicious' },
  { label: 'Dark/Moody', query: 'dark moody shadow night mysterious' },
  { label: 'Bright/Cheerful', query: 'bright cheerful happy colorful vibrant' },
  { label: 'Minimalist', query: 'minimal simple clean white space' },
];

export function TextSearchView({
  className,
  headerAction,
  onImageClick,
  namespace,
  effectiveNamespaceFilter,
  searchAllNamespaces,
  setSearchAllNamespaces,
  searchType,
  switchSearchType,
  inputRef,
  query,
  setQuery,
  handleKeyDown,
  showPresets,
  setShowPresets,
  clearSearch,
  error,
  referenceFile,
  handleReferenceSelected,
  clearReferenceSearchState,
  setError,
  setResults,
  loading,
  searchByImage,
  search,
  searchHistory,
  exactMatches,
  handleMouseEnter,
  handleMouseLeave,
  searchWarnings,
  results,
  visibleCount,
  setVisibleCount,
  getResultScore,
  getScoreLabel,
  getScoreColor,
  coverage,
  hoverPreview,
  pageSize,
}: TextSearchViewProps) {
  return (
    <div className={`bg-gray-500 rounded-md border border-gray-700 p-4 ${className}`}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-purple-400" />
          <h3 className="text-sm font-medium text-gray-200">Semantic Search</h3>
        </div>
        {headerAction}
      </div>

      {namespace !== '__all__' && (
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="text-[10px] text-gray-300">
            Scope: {effectiveNamespaceFilter === null ? 'All namespaces' : effectiveNamespaceFilter}
          </div>
          <label className="flex items-center gap-2 text-[10px] text-gray-200 select-none">
            <input
              type="checkbox"
              checked={searchAllNamespaces}
              onChange={(event) => setSearchAllNamespaces(event.target.checked)}
              className="h-3.5 w-3.5"
            />
            All namespaces
          </label>
        </div>
      )}

      <div className="flex gap-2 mb-3">
        <button
          onClick={() => switchSearchType('text')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-medium transition-colors ${
            searchType === 'text' ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
          }`}
        >
          <Search className="w-3 h-3" />
          Text
        </button>
        <button
          onClick={() => switchSearchType('color')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-medium transition-colors ${
            searchType === 'color' ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
          }`}
        >
          <Palette className="w-3 h-3" />
          Color
        </button>
        <button
          onClick={() => switchSearchType('image')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-medium transition-colors ${
            searchType === 'image' ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
          }`}
        >
          <ImageUp className="w-3 h-3" />
          Image
        </button>
      </div>

      {searchType === 'text' && (
        <div className="relative mb-3">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => setShowPresets(true)}
            placeholder="Describe what you're looking for..."
            className="w-full bg-gray-800 border border-gray-600 rounded-lg pl-10 pr-10 py-2.5 text-[12px] text-gray-100 placeholder-gray-500 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500"
          />
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          {query && (
            <button
              onClick={clearSearch}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      )}

      {searchType === 'color' && (
        <div className="mb-3">
          <ColorWheel value={query} onChange={(color) => setQuery(color)} size={160} />
        </div>
      )}

      {searchType === 'image' && (
        <div className="mb-3">
          <ReferenceImageDropzone
            file={referenceFile}
            onFileSelected={handleReferenceSelected}
            onClear={() => {
              clearReferenceSearchState();
              setResults([]);
              setError(null);
            }}
            onInvalidFile={(reason) => setError(reason)}
            disabled={loading}
          />
        </div>
      )}

      <button
        onClick={() => {
          if (searchType === 'image') {
            if (referenceFile) searchByImage(referenceFile, 'button');
          } else {
            search(undefined, 'button');
          }
        }}
        disabled={loading || (searchType === 'image' ? !referenceFile : !query.trim())}
        className="w-full bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white rounded-lg py-2 text-[12px] font-medium transition-colors flex items-center justify-center gap-2"
      >
        {loading ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Searching...
          </>
        ) : (
          <>
            <Search className="w-4 h-4" />
            Search
          </>
        )}
      </button>

      {searchType === 'text' && showPresets && !results.length && !loading && (
        <div className="mt-3 space-y-2">
          <p className="text-[10px] text-gray-500 uppercase tracking-wider">Try these:</p>
          <div className="flex flex-wrap gap-1.5">
            {SEARCH_PRESETS.map((preset) => (
              <button
                key={preset.label}
                onClick={() => {
                  setQuery(preset.query);
                  setShowPresets(false);
                  search(preset.query, 'preset');
                }}
                className="px-2 py-1 bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-gray-200 rounded text-[10px] transition-colors"
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {searchType === 'text' && searchHistory.length > 0 && !results.length && !loading && (
        <div className="mt-3 space-y-2">
          <div className="flex items-center gap-1 text-[10px] text-gray-500 uppercase tracking-wider">
            <History className="w-3 h-3" />
            Recent
          </div>
          <div className="flex flex-wrap gap-1.5">
            {searchHistory.slice(0, 5).map((historyQuery) => (
              <button
                key={historyQuery}
                onClick={() => {
                  setQuery(historyQuery);
                  search(historyQuery, 'history');
                }}
                className="px-2 py-1 bg-gray-800/50 hover:bg-gray-700 text-gray-500 hover:text-gray-300 rounded text-[10px] transition-colors truncate max-w-[120px]"
                title={historyQuery}
              >
                {historyQuery}
              </button>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div className="mt-3 p-2 bg-red-900/30 border border-red-800 rounded-lg">
          <p className="text-red-400 text-xs">{error}</p>
        </div>
      )}

      {searchType === 'image' && searchWarnings.length > 0 && (
        <div className="mt-3 p-2 bg-amber-900/30 border border-amber-800 rounded-lg space-y-1">
          {searchWarnings.map((warning) => {
            const message = formatWarningMessage(warning);
            return message ? <p key={warning} className="text-amber-300 text-[11px]">{message}</p> : null;
          })}
        </div>
      )}

      {searchType === 'image' && exactMatches.length > 0 && (
        <div className="mt-4">
          <p className="text-xs text-emerald-400 font-medium mb-2">
            Found in your catalog — {exactMatches.length === 1 ? 'exact match' : `${exactMatches.length} exact matches`}
          </p>
          <div className="grid grid-cols-4 gap-2">
            {exactMatches.map((result) => (
              <div
                key={result.imageId}
                className="relative aspect-square rounded-lg overflow-hidden bg-gray-800 border-2 border-emerald-500 cursor-pointer hover:scale-105 transition-all duration-150"
                style={{ minWidth: '70px', minHeight: '70px' }}
                onClick={() => onImageClick?.(result)}
                onMouseEnter={(event) => handleMouseEnter(event, result)}
                onMouseLeave={handleMouseLeave}
                title={`${result.filename || result.imageId}\nExact match`}
              >
                <Image
                  src={result.assetType === 'video' && result.videoThumbnailUrl ? result.videoThumbnailUrl : getCloudflareImageUrl(result.imageId, 'medium')}
                  alt={result.filename || 'Exact match'}
                  fill
                  className="object-cover"
                  sizes="100px"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {searchType === 'image' && referenceFile && !loading && !error && results.length === 0 && exactMatches.length === 0 && (
        <p className="mt-3 text-[11px] text-gray-400 text-center">No matches found for this reference image.</p>
      )}

      {results.length > 0 && (
        <div className="mt-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-gray-400">
              Showing <span className="text-purple-400 font-medium">{Math.min(visibleCount, results.length)}</span> of <span className="text-purple-400 font-medium">{results.length}</span> images
            </p>
            <button onClick={clearSearch} className="text-[10px] text-gray-500 hover:text-gray-300">Clear</button>
          </div>

          <div className="grid grid-cols-4 gap-2">
            {results.slice(0, visibleCount).map((result, index) => {
              const score = getResultScore(result);
              const scoreText = score === null ? 'Score unavailable' : `Score: ${score.toFixed(3)} (${getScoreLabel(score)})`;

              return (
                <div
                  key={result.imageId}
                  className="relative aspect-square rounded-lg overflow-hidden bg-gray-800 border-2 border-gray-700 cursor-pointer hover:border-purple-500 hover:scale-105 transition-all duration-150"
                  style={{ minWidth: '70px', minHeight: '70px' }}
                  onClick={() => onImageClick?.(result)}
                  onMouseEnter={(event) => handleMouseEnter(event, result)}
                  onMouseLeave={handleMouseLeave}
                  title={`${result.filename || result.imageId}\n${scoreText}`}
                >
                  <Image
                    src={result.assetType === 'video' && result.videoThumbnailUrl ? result.videoThumbnailUrl : getCloudflareImageUrl(result.imageId, 'medium')}
                    alt={result.filename || 'Search result'}
                    fill
                    className="object-cover"
                    sizes="100px"
                  />
                  {score !== null && (
                    <div className="absolute bottom-0 left-0 right-0 h-1">
                      <div className={`h-full ${getScoreColor(score)}`} style={{ width: `${Math.max(10, (1 - score) * 100)}%` }} />
                    </div>
                  )}
                  <div className="absolute top-1 left-1 w-4 h-4 rounded-full bg-purple-900/80 flex items-center justify-center">
                    <span className="text-[9px] text-gray-300">{index + 1}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {visibleCount < results.length && (
            <button
              onClick={() => setVisibleCount((previous) => Math.min(previous + pageSize, results.length))}
              className="w-full mt-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white rounded-lg text-[11px] font-medium transition-colors flex items-center justify-center gap-2"
            >
              Load More ({Math.min(pageSize, results.length - visibleCount)} more · {results.length - visibleCount} remaining)
            </button>
          )}

          <p className="text-[12px] text-white mt-3 text-center font-3270">
            Scores: lower = better match · {getScoreLabel(0.2)} · {getScoreLabel(0.3)} · {getScoreLabel(0.4)}
          </p>
        </div>
      )}

      {searchType === 'image' && coverage && coverage.notIndexed > 0 && (
        <p className="mt-2 text-[10px] text-gray-500 text-center">
          {coverage.notIndexed} of {coverage.totalImages} images not yet indexed for visual search
        </p>
      )}

      {hoverPreview && (
        <div
          className="fixed z-50 pointer-events-none"
          style={{ left: hoverPreview.x, top: hoverPreview.y - 10, transform: 'translate(-50%, -100%)' }}
        >
          <div className="bg-gray-900 rounded-lg shadow-2xl border border-purple-700 overflow-hidden">
            <div className="relative w-48 h-48">
              <Image
                src={(() => {
                  const result = [...exactMatches, ...results].find((entry) => entry.imageId === hoverPreview.imageId);
                  if (result?.assetType === 'video' && result.videoThumbnailUrl) return result.videoThumbnailUrl;
                  return getCloudflareImageUrl(hoverPreview.imageId, 'medium');
                })()}
                alt={hoverPreview.filename || 'Preview'}
                fill
                className="object-cover"
                sizes="192px"
              />
            </div>
            {hoverPreview.filename && (
              <div className="px-2 py-1 bg-black/80 text-[10px] text-gray-300 truncate text-center">
                {hoverPreview.filename}
              </div>
            )}
          </div>
          <div className="absolute left-1/2 -translate-x-1/2 -bottom-1.5 w-3 h-3 bg-gray-900 border-r border-b border-purple-700 transform rotate-45" />
        </div>
      )}
    </div>
  );
}

export default TextSearchView;
