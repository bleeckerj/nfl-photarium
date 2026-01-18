/**
 * TextSearch Component
 * 
 * Search for images using natural language descriptions.
 * Uses CLIP embeddings to find semantically matching images.
 * 
 * Examples:
 *   - "blue sky with clouds"
 *   - "person showing teeth"
 *   - "vintage car"
 *   - "dark moody forest"
 */

'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import Image from 'next/image';
import { Search, X, Loader2, Sparkles, History, Palette } from 'lucide-react';
import { getCloudflareImageUrl } from '@/utils/imageUtils';
import ColorWheel from './ColorWheel';

interface SearchResult {
  imageId: string;
  score: number;
  filename?: string;
  folder?: string;
}

interface TextSearchProps {
  className?: string;
  onImageClick?: (imageId: string) => void;
  initialQuery?: string;
}

// Hover preview state
interface HoverPreview {
  imageId: string;
  filename?: string;
  x: number;
  y: number;
}

// Preset search suggestions
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

// Configurable limits from environment
const SEARCH_LIMIT = parseInt(process.env.NEXT_PUBLIC_SEARCH_LIMIT || '48', 10);
const PAGE_SIZE = parseInt(process.env.NEXT_PUBLIC_SEARCH_PAGE_SIZE || '12', 10);

export function TextSearch({ className = '', onImageClick, initialQuery = '' }: TextSearchProps) {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const [showPresets, setShowPresets] = useState(false);
  const [hoverPreview, setHoverPreview] = useState<HoverPreview | null>(null);
  const [searchType, setSearchType] = useState<'text' | 'color'>('text');
  const inputRef = useRef<HTMLInputElement>(null);

  // Load search history from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem('textSearchHistory');
      if (saved) {
        setSearchHistory(JSON.parse(saved).slice(0, 10));
      }
    } catch {
      // Ignore localStorage errors
    }
  }, []);

  // Save search to history
  const addToHistory = useCallback((searchQuery: string) => {
    setSearchHistory(prev => {
      const filtered = prev.filter(q => q !== searchQuery);
      const updated = [searchQuery, ...filtered].slice(0, 10);
      try {
        localStorage.setItem('textSearchHistory', JSON.stringify(updated));
      } catch {
        // Ignore localStorage errors
      }
      return updated;
    });
  }, []);

  const handleMouseEnter = useCallback((e: React.MouseEvent, result: SearchResult) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setHoverPreview({
      imageId: result.imageId,
      filename: result.filename,
      x: rect.left + rect.width / 2,
      y: rect.top,
    });
  }, []);

  const handleMouseLeave = useCallback(() => {
    setHoverPreview(null);
  }, []);

  const search = useCallback(async (searchQuery?: string) => {
    const q = searchQuery ?? query;
    if (!q.trim()) return;

    setLoading(true);
    setError(null);
    setResults([]);
    setVisibleCount(PAGE_SIZE); // Reset pagination on new search

    try {
      const response = await fetch('/api/images/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: searchType,
          query: q.trim(),
          limit: SEARCH_LIMIT,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Search failed');
      }

      setResults(data.results || []);
      addToHistory(q.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setLoading(false);
    }
  }, [query, searchType, addToHistory]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      search();
    }
  }, [search]);

  const clearSearch = useCallback(() => {
    setQuery('');
    setResults([]);
    setVisibleCount(PAGE_SIZE);
    setError(null);
    inputRef.current?.focus();
  }, []);

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

  return (
    <div className={`bg-gray-500 rounded-md border border-gray-700 p-4 ${className}`}>
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <Sparkles className="w-5 h-5 text-purple-400" />
        <h3 className="text-sm font-medium text-gray-200">Semantic Search</h3>
      </div>

      {/* Search type toggle */}
      <div className="flex gap-2 mb-3">
        <button
          onClick={() => setSearchType('text')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-medium transition-colors ${
            searchType === 'text'
              ? 'bg-purple-600 text-white'
              : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
          }`}
        >
          <Search className="w-3 h-3" />
          Text
        </button>
        <button
          onClick={() => setSearchType('color')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-medium transition-colors ${
            searchType === 'color'
              ? 'bg-purple-600 text-white'
              : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
          }`}
        >
          <Palette className="w-3 h-3" />
          Color
        </button>
      </div>

      {/* Search input - Text mode */}
      {searchType === 'text' && (
        <div className="relative mb-3">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
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

      {/* Color Wheel - Color mode */}
      {searchType === 'color' && (
        <div className="mb-3">
          <ColorWheel
            value={query}
            onChange={(color) => setQuery(color)}
            size={160}
          />
        </div>
      )}

      {/* Search button */}
      <button
        onClick={() => search()}
        disabled={loading || !query.trim()}
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

      {/* Presets (for text search) */}
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
                  search(preset.query);
                }}
                className="px-2 py-1 bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-gray-200 rounded text-[10px] transition-colors"
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Search history */}
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
                  search(historyQuery);
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

      {/* Error */}
      {error && (
        <div className="mt-3 p-2 bg-red-900/30 border border-red-800 rounded-lg">
          <p className="text-red-400 text-xs">{error}</p>
        </div>
      )}

      {/* Results */}
      {results.length > 0 && (
        <div className="mt-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-gray-400">
              Showing <span className="text-purple-400 font-medium">{Math.min(visibleCount, results.length)}</span> of <span className="text-purple-400 font-medium">{results.length}</span> images
            </p>
            <button
              onClick={clearSearch}
              className="text-[10px] text-gray-500 hover:text-gray-300"
            >
              Clear
            </button>
          </div>

          <div className="grid grid-cols-4 gap-2">
            {results.slice(0, visibleCount).map((result, index) => (
              <div
                key={result.imageId}
                className="relative aspect-square rounded-lg overflow-hidden bg-gray-800 border-2 border-gray-700 cursor-pointer hover:border-purple-500 hover:scale-105 transition-all duration-150"
                style={{ minWidth: '70px', minHeight: '70px' }}
                onClick={() => onImageClick?.(result.imageId)}
                onMouseEnter={(e) => handleMouseEnter(e, result)}
                onMouseLeave={handleMouseLeave}
                title={`${result.filename || result.imageId}\nScore: ${result.score.toFixed(3)} (${getScoreLabel(result.score)})`}
              >
                <Image
                  src={getCloudflareImageUrl(result.imageId, 'medium')}
                  alt={result.filename || 'Search result'}
                  fill
                  className="object-cover"
                  sizes="100px"
                />
                
                {/* Score bar */}
                <div className="absolute bottom-0 left-0 right-0 h-1">
                  <div 
                    className={`h-full ${getScoreColor(result.score)}`}
                    style={{ width: `${Math.max(10, (1 - result.score) * 100)}%` }}
                  />
                </div>

                {/* Rank badge */}
                <div className="absolute top-1 left-1 w-4 h-4 rounded-full bg-purple-900/80 flex items-center justify-center">
                  <span className="text-[9px] text-gray-300">{index + 1}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Load More button */}
          {visibleCount < results.length && (
            <button
              onClick={() => setVisibleCount(prev => Math.min(prev + PAGE_SIZE, results.length))}
              className="w-full mt-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white rounded-lg text-[11px] font-medium transition-colors flex items-center justify-center gap-2"
            >
              Load More ({Math.min(PAGE_SIZE, results.length - visibleCount)} more · {results.length - visibleCount} remaining)
            </button>
          )}

          <p className="text-[12px] text-white mt-3 text-center font-3270">
            Scores: lower = better match · {getScoreLabel(0.2)} · {getScoreLabel(0.3)} · {getScoreLabel(0.4)}
          </p>
        </div>
      )}

      {/* Hover preview tooltip */}
      {hoverPreview && (
        <div
          className="fixed z-50 pointer-events-none"
          style={{
            left: hoverPreview.x,
            top: hoverPreview.y - 10,
            transform: 'translate(-50%, -100%)',
          }}
        >
          <div className="bg-gray-900 rounded-lg shadow-2xl border border-purple-700 overflow-hidden">
            <div className="relative w-48 h-48">
              <Image
                src={getCloudflareImageUrl(hoverPreview.imageId, 'medium')}
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

export default TextSearch;
