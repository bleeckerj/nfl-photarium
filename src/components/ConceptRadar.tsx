/**
 * ConceptRadar Component
 * 
 * Displays a radar/spider chart showing semantic concept scores for an image.
 * Each axis represents a concept dimension (e.g., organic↔artificial),
 * and the chart shows how the machine interprets the image's "vibe".
 * 
 * Click anywhere in the radar to search for images matching those semantic coordinates!
 */

'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { Search, X, Clipboard, Check } from 'lucide-react';
import Image from 'next/image';
import { getCloudflareImageUrl } from '@/utils/imageUtils';

interface ConceptScore {
  dimension: string;
  negative: string;
  positive: string;
  score: number;
  negativeRaw: number;
  positiveRaw: number;
}

interface SearchResult {
  imageId: string;
  score: number;
  filename?: string;
}

interface ConceptRadarProps {
  imageId: string;
  className?: string;
  size?: number;
  onImageClick?: (imageId: string) => void;
  copyVariant?: string;
  onCopySuccess?: (message: string) => void;
}

// Concept pairs must match the API
const CONCEPT_PAIRS: [string, string][] = [
  ['artificial', 'organic'],
  ['chaotic', 'ordered'],
  ['intimate', 'vast'],
  ['nostalgic', 'futuristic'],
  ['soft', 'hard'],
  ['dark', 'bright'],
  ['static', 'dynamic'],
  ['serious', 'playful'],
  ['minimal', 'complex'],
  ['cold', 'warm'],
];

export function ConceptRadar({ imageId, className = '', size = 360, onImageClick, copyVariant = 'full', onCopySuccess }: ConceptRadarProps) {
  const [concepts, setConcepts] = useState<ConceptScore[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clickTarget, setClickTarget] = useState<{ x: number; y: number; scores: number[] } | null>(null);
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [copied, setCopied] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);

  // Copy search results to clipboard in YAML format
  const handleCopyResults = useCallback(async () => {
    if (!searchResults || searchResults.length === 0) return;

    const accountHash = process.env.NEXT_PUBLIC_CLOUDFLARE_ACCOUNT_HASH || 'gaLGizR3kCgx5yRLtiRIOw';
    const variant = copyVariant || 'full';

    const yaml = 'imagesFromGridDirectory:\n' + searchResults.map(result => {
      const url = `https://imagedelivery.net/${accountHash}/${result.imageId}/${variant}?format=webp`;
      const altText = result.filename || result.imageId;
      return `  - url: ${url}\n    altText: "${altText}"`;
    }).join('\n');

    try {
      await navigator.clipboard.writeText(yaml);
      setCopied(true);
      onCopySuccess?.(`Copied ${searchResults.length} images to clipboard`);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, [searchResults, copyVariant, onCopySuccess]);

  const fetchConcepts = useCallback(async () => {
    if (!imageId) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`/api/images/${imageId}/concepts`, {
        method: 'POST',
      });
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch concepts');
      }
      
      setConcepts(data.concepts);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [imageId]);

  useEffect(() => {
    fetchConcepts();
  }, [fetchConcepts]);

  if (loading) {
    return (
      <div className={`flex items-center justify-center ${className}`} style={{ width: size, height: size }}>
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className={`flex flex-col items-center justify-center text-center ${className}`} style={{ width: size, height: size }}>
        <p className="text-red-400 text-sm mb-2">{error}</p>
        <button
          onClick={fetchConcepts}
          className="text-xs text-blue-400 hover:text-blue-300 underline"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!concepts || concepts.length === 0) {
    return (
      <div className={`flex items-center justify-center text-gray-500 text-sm ${className}`} style={{ width: size, height: size }}>
        No concept data
      </div>
    );
  }

  // SVG radar chart
  const cx = size / 2;
  const cy = size / 2;
  const radius = (size / 2) - 50; // Leave room for labels
  const n = concepts.length;

  // Amplification factor - CLIP scores cluster in a narrow band (~±0.15)
  // We amplify differences to make the visualization more readable
  // A score of ±0.15 will now extend to ±0.6 on the chart
  const amplify = (score: number): number => {
    // Apply sigmoid-like amplification centered at 0
    const factor = 4; // Amplification strength
    const amplified = Math.tanh(score * factor);
    return amplified;
  };

  // Reverse amplification to get raw score from visual position
  const deamplify = (amplified: number): number => {
    // Inverse of tanh: atanh(x) = 0.5 * ln((1+x)/(1-x))
    const clamped = Math.max(-0.99, Math.min(0.99, amplified));
    return Math.atanh(clamped) / 4;
  };

  // Handle click on the radar
  const handleRadarClick = async (event: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current) return;

    const rect = svgRef.current.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    // Convert click position to polar coordinates relative to center
    const dx = x - cx;
    const dy = y - cy;
    const clickRadius = Math.sqrt(dx * dx + dy * dy);
    const clickAngle = Math.atan2(dy, dx);

    // Calculate score for each concept axis based on click position
    const scores: number[] = [];
    for (let i = 0; i < n; i++) {
      const axisAngle = (Math.PI * 2 * i / n) - Math.PI / 2;
      
      // Project click onto this axis
      const angleDiff = clickAngle - axisAngle;
      const projection = clickRadius * Math.cos(angleDiff);
      
      // Normalize to [-1, 1] range (amplified space)
      const normalizedProjection = Math.max(0, projection) / radius;
      const amplifiedScore = (normalizedProjection * 2) - 1;
      
      // Convert back to raw score
      const rawScore = deamplify(amplifiedScore);
      scores.push(rawScore);
    }

    setClickTarget({ x, y, scores });
    setSearching(true);
    setSearchResults(null);

    // Build text query from the dominant concepts at click point
    // Sort by absolute intensity and pick only the strongest 2-3
    const rankedConcepts = scores
      .map((score, i) => ({
        score,
        intensity: Math.abs(score),
        negative: CONCEPT_PAIRS[i][0],
        positive: CONCEPT_PAIRS[i][1],
      }))
      .filter(c => c.intensity > 0.04) // Higher threshold - only meaningful signals
      .sort((a, b) => b.intensity - a.intensity)
      .slice(0, 3); // Top 3 only

    const queryParts: string[] = rankedConcepts.map(c => {
      const word = c.score >= 0 ? c.positive : c.negative;
      // More granular intensity modifiers
      if (c.intensity > 0.15) {
        return `extremely ${word}`;
      } else if (c.intensity > 0.10) {
        return `very ${word}`;
      } else if (c.intensity > 0.06) {
        return `${word}`;
      } else {
        return `slightly ${word}`;
      }
    });

    // Vary query structure based on concept count for more distinctive embeddings
    let textQuery: string;
    if (queryParts.length === 0) {
      textQuery = 'a photograph';
    } else if (queryParts.length === 1) {
      textQuery = `${queryParts[0]} imagery`;
    } else if (queryParts.length === 2) {
      textQuery = `${queryParts[0]} and ${queryParts[1]}`;
    } else {
      textQuery = `${queryParts[0]}, ${queryParts[1]}, ${queryParts[2]}`;
    }

    try {
      const response = await fetch('/api/images/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          query: textQuery,
          type: 'text',
          limit: 8,
        }),
      });
      
      const data = await response.json();
      if (response.ok && data.results) {
        setSearchResults(data.results);
      }
    } catch (err) {
      console.error('Search failed:', err);
    } finally {
      setSearching(false);
    }
  };

  const clearSearch = () => {
    setClickTarget(null);
    setSearchResults(null);
  };

  // Calculate points for the polygon
  const points = concepts.map((concept, i) => {
    const angle = (Math.PI * 2 * i / n) - Math.PI / 2; // Start from top
    // Amplify the score to make differences visible, then map to [0, 1] for radius
    const amplifiedScore = amplify(concept.score);
    const normalizedScore = (amplifiedScore + 1) / 2;
    const r = radius * normalizedScore;
    return {
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle),
      angle,
      concept,
      amplifiedScore,
    };
  });

  // Generate polygon path
  const polygonPath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ') + ' Z';

  // Generate concentric circles for the grid
  const gridCircles = [0.25, 0.5, 0.75, 1].map(scale => radius * scale);

  // Generate axis lines
  const axisLines = concepts.map((_, i) => {
    const angle = (Math.PI * 2 * i / n) - Math.PI / 2;
    return {
      x1: cx,
      y1: cy,
      x2: cx + radius * Math.cos(angle),
      y2: cy + radius * Math.sin(angle),
    };
  });

  return (
    <div className={className}>
      <svg 
        ref={svgRef}
        width={size} 
        height={size} 
        className="overflow-visible cursor-crosshair"
        onClick={handleRadarClick}
      >
        {/* Clickable background */}
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          fill="rgba(0,0,0,0.02)"
          className="hover:fill-blue-500/5 transition-colors"
        />

        {/* Grid circles */}
        {gridCircles.map((r, i) => (
          <circle
            key={i}
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke="#374151"
            strokeWidth="1"
            opacity={0.5}
            pointerEvents="none"
          />
        ))}

        {/* Axis lines */}
        {axisLines.map((line, i) => (
          <line
            key={i}
            {...line}
            stroke="#374151"
            strokeWidth="1"
            opacity={0.5}
            pointerEvents="none"
          />
        ))}

        {/* Center line (neutral) */}
        <circle
          cx={cx}
          cy={cy}
          r={radius * 0.5}
          fill="none"
          stroke="#6b7280"
          strokeWidth="1"
          strokeDasharray="4 4"
          opacity={0.7}
          pointerEvents="none"
        />

        {/* Data polygon */}
        <path
          d={polygonPath}
          fill="rgba(59, 130, 246, 0.3)"
          stroke="#3b82f6"
          strokeWidth="2"
          pointerEvents="none"
        />

        {/* Data points */}
        {points.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={5}
            fill="#3b82f6"
            stroke="white"
            strokeWidth="1.5"
            pointerEvents="none"
          />
        ))}

        {/* Click target marker */}
        {clickTarget && (
          <>
            <circle
              cx={clickTarget.x}
              cy={clickTarget.y}
              r={8}
              fill="rgba(251, 191, 36, 0.8)"
              stroke="#f59e0b"
              strokeWidth="2"
              pointerEvents="none"
            />
            <circle
              cx={clickTarget.x}
              cy={clickTarget.y}
              r={3}
              fill="#f59e0b"
              pointerEvents="none"
            />
          </>
        )}

        {/* Labels */}
        {concepts.map((concept, i) => {
          const angle = (Math.PI * 2 * i / n) - Math.PI / 2;
          const labelRadius = radius + 28;
          const x = cx + labelRadius * Math.cos(angle);
          const y = cy + labelRadius * Math.sin(angle);
          
          // Determine which label to show based on amplified score
          const amplifiedScore = points[i].amplifiedScore;
          const label = amplifiedScore >= 0 ? concept.positive : concept.negative;
          const intensity = Math.abs(amplifiedScore);
          const opacity = 0.4 + intensity * 0.6;
          
          // Adjust text anchor based on position
          let textAnchor: 'start' | 'middle' | 'end' = 'middle';
          if (Math.cos(angle) > 0.1) textAnchor = 'start';
          if (Math.cos(angle) < -0.1) textAnchor = 'end';

          return (
            <text
              key={i}
              x={x}
              y={y}
              textAnchor={textAnchor}
              dominantBaseline="middle"
              className="font-3270 pointer-events-none select-none"
              style={{ 
                fill: amplifiedScore >= 0 ? '#34d399' : '#f87171',
                opacity,
                fontSize: '10px',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              {label}
            </text>
          );
        })}
      </svg>
      
      {/* Legend showing strongest traits */}
      <div className="mt-3 space-y-1">
        <p className="text-[10px] font-3270 uppercase tracking-wider text-gray-500 text-center">
          Dominant Perceptions
        </p>
        <div className="flex flex-wrap justify-center gap-1.5">
          {[...concepts]
            .sort((a, b) => Math.abs(b.score) - Math.abs(a.score))
            .slice(0, 3)
            .map((concept, i) => {
              const trait = concept.score >= 0 ? concept.positive : concept.negative;
              const isPositive = concept.score >= 0;
              return (
                <span
                  key={i}
                  className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-3270 uppercase tracking-wide"
                  style={{
                    backgroundColor: isPositive ? 'rgba(52, 211, 153, 0.15)' : 'rgba(248, 113, 113, 0.15)',
                    color: isPositive ? '#34d399' : '#f87171',
                  }}
                  title={`Raw score: ${(concept.score * 100).toFixed(1)}%`}
                >
                  {trait}
                </span>
              );
            })}
        </div>
        <p className="text-[9px] text-gray-500 text-center mt-2 flex items-center justify-center gap-1">
          <Search className="h-3 w-3" />
          Click anywhere to find matching images
        </p>
      </div>

      {/* Search Results Modal */}
      {(searchResults || searching) && (
        <div className="mt-4 p-3 bg-gray-900/95 rounded-lg border border-gray-700">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-3270 uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
              <Search className="h-3 w-3" />
              Semantic Search Results
            </h4>
            <div className="flex items-center gap-1">
              {searchResults && searchResults.length > 0 && (
                <button
                  onClick={handleCopyResults}
                  className="text-gray-500 hover:text-amber-400 p-1 transition-colors"
                  title="Copy images as YAML"
                >
                  {copied ? <Check className="h-4 w-4 text-green-500" /> : <Clipboard className="h-4 w-4" />}
                </button>
              )}
              <button
                onClick={clearSearch}
                className="text-gray-500 hover:text-gray-300 p-1"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
          
          {searching ? (
            <div className="flex items-center justify-center py-4">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-amber-500" />
              <span className="ml-2 text-xs text-gray-400 font-3270">Searching semantic space...</span>
            </div>
          ) : searchResults && searchResults.length > 0 ? (
            <div className="grid grid-cols-4 gap-2">
              {searchResults.map((result, i) => (
                <div
                  key={result.imageId}
                  className="relative aspect-square rounded overflow-hidden bg-gray-800 cursor-pointer hover:ring-2 hover:ring-amber-500 transition-all"
                  onClick={() => onImageClick?.(result.imageId)}
                  title={result.filename || result.imageId}
                >
                  <Image
                    src={getCloudflareImageUrl(result.imageId, 'thumbnail')}
                    alt={result.filename || 'Search result'}
                    fill
                    className="object-cover"
                    sizes="80px"
                  />
                  <div className="absolute bottom-0 left-0 right-0 bg-black/70 text-[8px] text-center py-0.5 font-3270">
                    {((1 - result.score) * 100).toFixed(0)}%
                  </div>
                  <div className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-amber-500/90 flex items-center justify-center">
                    <span className="text-[8px] text-black font-bold">{i + 1}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-gray-500 text-center py-2">No matching images found</p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Compact inline version for hover/tooltip
 */
export function ConceptRadarMini({ imageId, size = 120 }: { imageId: string; size?: number }) {
  return <ConceptRadar imageId={imageId} size={size} />;
}

export default ConceptRadar;
