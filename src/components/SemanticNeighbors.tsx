/**
 * SemanticNeighbors Component
 * 
 * Displays images that are semantically similar AND dissimilar to a given image,
 * based on CLIP embedding proximity. These aren't just "visually similar"
 * but conceptually adjacent - a lonely chair might neighbor a portrait
 * of solitude.
 * 
 * Shows 4 "neighbors" (closest) and 4 "strangers" (most distant) for contrast.
 */

'use client';

import { useEffect, useState, useCallback } from 'react';
import Image from 'next/image';
import { getCloudflareImageUrl } from '@/utils/imageUtils';

interface SimilarResult {
  imageId: string;
  score: number;
  filename?: string;
  folder?: string;
}

interface SemanticNeighborsProps {
  imageId: string;
  type?: 'clip' | 'color';
  limit?: number;
  showStrangers?: boolean;
  className?: string;
  onImageClick?: (imageId: string) => void;
}

// Hover preview state
interface HoverPreview {
  imageId: string;
  filename?: string;
  x: number;
  y: number;
}

export function SemanticNeighbors({
  imageId,
  type = 'clip',
  limit = 8,
  showStrangers = true,
  className = '',
  onImageClick,
}: SemanticNeighborsProps) {
  const [neighbors, setNeighbors] = useState<SimilarResult[]>([]);
  const [strangers, setStrangers] = useState<SimilarResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hoverPreview, setHoverPreview] = useState<HoverPreview | null>(null);

  const handleMouseEnter = useCallback((e: React.MouseEvent, result: SimilarResult) => {
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

  const fetchSimilar = useCallback(async () => {
    if (!imageId) return;
    
    setLoading(true);
    setError(null);
    
    try {
      // For semantic neighbors, split limit between neighbors and strangers
      const neighborsLimit = showStrangers ? Math.ceil(limit / 2) : limit;
      const strangersLimit = showStrangers ? Math.floor(limit / 2) : 0;
      const includeStrangers = showStrangers && type === 'clip';
      
      const response = await fetch(
        `/api/images/${imageId}/similar?type=${type}&limit=${neighborsLimit}&strangersLimit=${strangersLimit}&includeStrangers=${includeStrangers}`
      );
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch similar images');
      }
      
      setNeighbors(data.results || []);
      setStrangers(data.strangers || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [imageId, type, limit, showStrangers]);

  useEffect(() => {
    fetchSimilar();
  }, [fetchSimilar]);

  if (loading) {
    return (
      <div className={`${className}`}>
        <div className="flex items-center gap-2 text-gray-400 text-sm">
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500" />
          Finding {type === 'clip' ? 'semantic' : 'color'} neighbors...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`${className}`}>
        <p className="text-red-400 text-sm">{error}</p>
        <button
          onClick={fetchSimilar}
          className="text-xs text-blue-400 hover:text-blue-300 underline mt-1"
        >
          Retry
        </button>
      </div>
    );
  }

  if (neighbors.length === 0 && strangers.length === 0) {
    return (
      <div className={`text-gray-500 text-sm ${className}`}>
        No {type === 'clip' ? 'semantic' : 'color'} neighbors found
      </div>
    );
  }

  // Map distance to semantic vocabulary
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

  const renderImageGrid = (
    results: SimilarResult[],
    label: string,
    isStranger: boolean = false
  ) => (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <h5 className="text-xs font-3270 uppercase tracking-wider text-gray-500">
          {label}
        </h5>
        <span className="text-[10px] text-gray-600">
          ({results.length})
        </span>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {results.map((result, index) => {
          const proximityTerm = getProximityTerm(result.score);
          return (
            <div
              key={result.imageId}
              className={`
                relative aspect-square rounded-lg overflow-hidden
                bg-gray-800 border-2
                ${isStranger ? 'border-red-900/50' : 'border-gray-700'}
                ${onImageClick ? 'cursor-pointer hover:border-blue-500 hover:scale-105 transition-all duration-150' : ''}
              `}
              style={{ minWidth: '80px', minHeight: '80px' }}
              onClick={() => onImageClick?.(result.imageId)}
              onMouseEnter={(e) => handleMouseEnter(e, result)}
              onMouseLeave={handleMouseLeave}
              title={`${result.filename || result.imageId}\nDistance: ${result.score.toFixed(3)} (${proximityTerm})`}
            >
              <Image
                src={getCloudflareImageUrl(result.imageId, 'thumbnail')}
                alt={result.filename || 'Similar image'}
                fill
                className="object-cover"
                sizes="100px"
              />
              
              {/* Distance badge with semantic term */}
              <div className={`absolute bottom-0 left-0 right-0 text-[9px] text-center py-0.5 ${
                isStranger ? 'bg-red-900/70' : 'bg-black/60'
              }`}>
                <span className="text-gray-300 font-3270">
                  {result.score.toFixed(2)} · {proximityTerm}
                </span>
              </div>
              
              {/* Rank indicator */}
              <div className={`absolute top-1 left-1 w-4 h-4 rounded-full flex items-center justify-center ${
                isStranger ? 'bg-red-900/80' : 'bg-black/70'
              }`}>
                <span className="text-[9px] text-gray-300">{index + 1}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className={className}>
      <div className="flex items-center gap-2 mb-3">
        <h4 className="text-sm font-medium text-gray-300">
          {type === 'clip' ? 'Semantic Cluster' : 'Color Neighbors'}
        </h4>
      </div>
      
      <div className="space-y-3">
        {neighbors.length > 0 && renderImageGrid(
          neighbors,
          'Neighbors',
          false
        )}
        
        {strangers.length > 0 && renderImageGrid(
          strangers,
          'Strangers',
          true
        )}
      </div>
      
      <p className="text-[10px] text-gray-500 mt-2 font-3270">
        {type === 'clip' 
          ? 'twin · echo · kin · avuncular · acquaintance · familiar stranger · stranger · antipode'
          : 'Images with similar color composition'}
      </p>
      
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
          <div className="bg-gray-900 rounded-lg shadow-2xl border border-gray-700 overflow-hidden">
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
          <div className="absolute left-1/2 -translate-x-1/2 -bottom-1.5 w-3 h-3 bg-gray-900 border-r border-b border-gray-700 transform rotate-45" />
        </div>
      )}
    </div>
  );
}

/**
 * Combined view showing both CLIP and Color neighbors
 */
export function SemanticNeighborsDual({
  imageId,
  limit = 4,
  className = '',
  onImageClick,
}: Omit<SemanticNeighborsProps, 'type'>) {
  return (
    <div className={`space-y-4 ${className}`}>
      <SemanticNeighbors
        imageId={imageId}
        type="clip"
        limit={limit}
        onImageClick={onImageClick}
      />
      <SemanticNeighbors
        imageId={imageId}
        type="color"
        limit={limit}
        onImageClick={onImageClick}
      />
    </div>
  );
}

export default SemanticNeighbors;
