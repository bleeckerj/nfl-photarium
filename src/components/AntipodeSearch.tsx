/**
 * AntipodeSearch Component
 * 
 * Find the semantic or color opposite of an image using various methods.
 * 
 * CLIP Methods:
 *   - Negate the Vector: Mathematical opposite (flip all dimensions)
 *   - Very Stranger: Most distant in collection
 *   - Otherwise: Conceptual inversion via text
 *   - Quantoidal Reflectroid: Centroid reflection
 * 
 * Color Methods:
 *   - Complementary: 180° hue rotation
 *   - Histogram Inversion: Emphasize absent colors
 *   - Lightness Inversion: Flip light/dark, saturated/desaturated
 *   - Negative Space: Negated color histogram
 */

'use client';

import { useState, useCallback } from 'react';
import Image from 'next/image';
import { getCloudflareImageUrl } from '@/utils/imageUtils';

interface SearchResult {
  imageId: string;
  score: number;
  filename?: string;
}

interface AntipodeSearchProps {
  imageId: string;
  className?: string;
  onImageClick?: (imageId: string) => void;
}

const CLIP_METHODS = [
  { id: 'negate', label: 'Negate the Vector', desc: 'Mathematical opposite' },
  { id: 'stranger', label: 'Very Stranger', desc: 'Most distant in collection' },
  { id: 'otherwise', label: 'Otherwise', desc: 'Conceptual inversion' },
  { id: 'reflectroid', label: 'Quantoidal Reflectroid', desc: 'Centroid reflection' },
] as const;

const COLOR_METHODS = [
  { id: 'complementary', label: 'Complementary', desc: '180° hue rotation' },
  { id: 'histogram', label: 'Histogram Inversion', desc: 'Absent colors emphasized' },
  { id: 'lightness', label: 'Lightness Inversion', desc: 'Flip light/dark, sat/desat' },
  { id: 'negative', label: 'Negative Space', desc: 'Mathematical color opposite' },
] as const;

// Map distance to semantic vocabulary (reused from SemanticNeighbors)
const getProximityTerm = (distance: number): string => {
  if (distance < 0.20) return 'twin';
  if (distance < 0.24) return 'echo';
  if (distance < 0.28) return 'kin';
  if (distance < 0.32) return 'avuncular';
  if (distance < 0.36) return 'acquaintance';
  if (distance < 0.42) return 'familiar stranger';
  if (distance < 0.50) return 'stranger';
  return 'antipode';
};

// Hover preview state
interface HoverPreview {
  imageId: string;
  filename?: string;
  x: number;
  y: number;
}

export function AntipodeSearch({ imageId, className = '', onImageClick }: AntipodeSearchProps) {
  const [domain, setDomain] = useState<'clip' | 'color'>('clip');
  const [method, setMethod] = useState<string>('stranger');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSearch, setLastSearch] = useState<{ label: string; desc: string } | null>(null);
  const [hoverPreview, setHoverPreview] = useState<HoverPreview | null>(null);

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

  const search = useCallback(async () => {
    setLoading(true);
    setError(null);
    setResults([]);

    try {
      const response = await fetch(
        `/api/images/${imageId}/antipode?domain=${domain}&method=${method}&limit=8`
      );
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Search failed');
      }

      setResults(data.results || []);
      setLastSearch({ label: data.methodLabel, desc: data.description });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [imageId, domain, method]);

  const methods = domain === 'clip' ? CLIP_METHODS : COLOR_METHODS;

  return (
    <div className={className}>
      <h4 className="text-sm font-medium text-gray-300 mb-3">Antipode Search</h4>
      
      {/* Domain Toggle */}
      <div className="flex gap-2 mb-3">
        <button
          onClick={() => { setDomain('clip'); setMethod('stranger'); setResults([]); setLastSearch(null); }}
          className={`px-3 py-1 text-xs font-3270 uppercase rounded transition-colors ${
            domain === 'clip' 
              ? 'bg-blue-600 text-white' 
              : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
          }`}
        >
          Semantic
        </button>
        <button
          onClick={() => { setDomain('color'); setMethod('complementary'); setResults([]); setLastSearch(null); }}
          className={`px-3 py-1 text-xs font-3270 uppercase rounded transition-colors ${
            domain === 'color' 
              ? 'bg-purple-600 text-white' 
              : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
          }`}
        >
          Color
        </button>
      </div>

      {/* Method Selection */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        {methods.map((m) => (
          <button
            key={m.id}
            onClick={() => setMethod(m.id)}
            className={`p-2 text-left rounded border transition-colors ${
              method === m.id
                ? 'border-amber-500 bg-amber-500/10'
                : 'border-gray-700 bg-gray-800/50 hover:border-gray-600'
            }`}
          >
            <div className="text-xs font-3270 text-gray-200">{m.label}</div>
            <div className="text-[10px] text-gray-500">{m.desc}</div>
          </button>
        ))}
      </div>

      {/* Search Button */}
      <button
        onClick={search}
        disabled={loading}
        className="w-full py-2 px-4 bg-amber-600 hover:bg-amber-500 disabled:bg-gray-700 
                   text-white text-xs font-3270 uppercase rounded transition-colors"
      >
        {loading ? 'Searching...' : 'Find Antipode'}
      </button>

      {/* Error */}
      {error && (
        <p className="text-red-400 text-xs mt-2">{error}</p>
      )}

      {/* Results */}
      {lastSearch && results.length > 0 && (
        <div className="mt-4">
          <div className="mb-2">
            <span className="text-xs font-3270 text-amber-400">{lastSearch.label}</span>
            <span className="text-[10px] text-gray-500 ml-2">{lastSearch.desc}</span>
          </div>
          
          <div className="grid grid-cols-4 gap-2">
            {results.map((result, index) => {
              const proximityTerm = getProximityTerm(result.score);
              return (
                <div
                  key={result.imageId}
                  className="relative aspect-square rounded-lg overflow-hidden bg-gray-800 
                             border-2 border-amber-900/50 cursor-pointer 
                             hover:border-amber-500 hover:scale-105 transition-all duration-150"
                  style={{ minWidth: '80px', minHeight: '80px' }}
                  onClick={() => onImageClick?.(result.imageId)}
                  onMouseEnter={(e) => handleMouseEnter(e, result)}
                  onMouseLeave={handleMouseLeave}
                  title={`${result.filename || result.imageId}\nDistance: ${result.score.toFixed(3)} (${proximityTerm})`}
                >
                  <Image
                    src={getCloudflareImageUrl(result.imageId, 'medium')}
                    alt={result.filename || 'Antipode result'}
                    fill
                    className="object-cover"
                    sizes="100px"
                  />
                  <div className="absolute bottom-0 left-0 right-0 bg-amber-900/70 text-[9px] text-center py-0.5 font-3270">
                    {result.score.toFixed(2)} · {proximityTerm}
                  </div>
                  <div className="absolute top-1 left-1 w-4 h-4 rounded-full bg-amber-900/80 flex items-center justify-center">
                    <span className="text-[9px] text-gray-300">{index + 1}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {lastSearch && results.length === 0 && !loading && !error && (
        <p className="text-gray-500 text-xs mt-3 text-center">No antipodes found</p>
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
          <div className="bg-gray-900 rounded-lg shadow-2xl border border-amber-700 overflow-hidden">
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
          {/* Arrow pointing down */}
          <div className="absolute left-1/2 -translate-x-1/2 -bottom-1.5 w-3 h-3 bg-gray-900 border-r border-b border-amber-700 transform rotate-45" />
        </div>
      )}
    </div>
  );
}

export default AntipodeSearch;
