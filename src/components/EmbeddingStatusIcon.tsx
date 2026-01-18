/**
 * EmbeddingStatusIcon Component
 * 
 * Displays a visual indicator showing whether an image has
 * CLIP and/or color embeddings generated.
 * 
 * - Both embeddings: Solid icon (green)
 * - Partial (CLIP only): Half-filled icon (blue)  
 * - Partial (Color only): Half-filled icon (purple)
 * - No embeddings: Empty/outline icon (gray)
 */

'use client';

import { useState } from 'react';

interface EmbeddingStatusIconProps {
  hasClipEmbedding?: boolean;
  hasColorEmbedding?: boolean;
  dominantColors?: string[];
  averageColor?: string;
  pendingStatus?: 'queued' | 'embedding' | 'error';
  pendingLabel?: string;
  size?: number;
  showTooltip?: boolean;
  className?: string;
}

export function EmbeddingStatusIcon({
  hasClipEmbedding = false,
  hasColorEmbedding = false,
  dominantColors,
  averageColor,
  pendingStatus,
  pendingLabel,
  size = 16,
  showTooltip = true,
  className = '',
}: EmbeddingStatusIconProps) {
  const [isHovered, setIsHovered] = useState(false);
  const providerLabel = (() => {
    const raw = (process.env.NEXT_PUBLIC_EMBEDDING_PROVIDER || 'hf').toLowerCase();
    return raw.startsWith('l') ? 'L' : 'HF';
  })();

  const hasBoth = hasClipEmbedding && hasColorEmbedding;
  const hasAny = hasClipEmbedding || hasColorEmbedding;
  const isPending = pendingStatus === 'queued' || pendingStatus === 'embedding';
  const isError = pendingStatus === 'error';

  // Determine status and colors
  let statusColor = '#6b7280'; // gray-500 - no embeddings
  let fillOpacity = 0;
  let statusText = 'No embeddings';

  if (isPending) {
    statusColor = '#f59e0b'; // amber-500
    fillOpacity = 0.6;
    statusText = pendingStatus === 'queued' ? 'Embedding queued' : 'Embedding in progress';
  } else if (isError) {
    statusColor = '#ef4444'; // red-500
    fillOpacity = 0.6;
    statusText = pendingLabel || 'Embedding failed';
  } else if (hasBoth) {
    statusColor = '#22c55e'; // green-500
    fillOpacity = 1;
    statusText = 'CLIP + Color embeddings';
  } else if (hasClipEmbedding) {
    statusColor = '#3b82f6'; // blue-500
    fillOpacity = 0.6;
    statusText = 'CLIP embedding only';
  } else if (hasColorEmbedding) {
    statusColor = '#a855f7'; // purple-500
    fillOpacity = 0.6;
    statusText = 'Color embedding only';
  }

  return (
    <div
      className={`relative inline-flex items-center ${className}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* SVG Icon - Neural network / brain chip style */}
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="transition-all duration-200"
        style={{ opacity: hasAny ? 1 : 0.5 }}
      >
        {/* Outer circle/chip */}
        <rect
          x="3"
          y="3"
          width="18"
          height="18"
          rx="3"
          stroke={statusColor}
          strokeWidth="1.5"
          fill={statusColor}
          fillOpacity={fillOpacity * 0.15}
        />
        
        {/* Connection pins */}
        <line x1="7" y1="1" x2="7" y2="3" stroke={statusColor} strokeWidth="1.5" strokeLinecap="round" />
        <line x1="12" y1="1" x2="12" y2="3" stroke={statusColor} strokeWidth="1.5" strokeLinecap="round" />
        <line x1="17" y1="1" x2="17" y2="3" stroke={statusColor} strokeWidth="1.5" strokeLinecap="round" />
        <line x1="7" y1="21" x2="7" y2="23" stroke={statusColor} strokeWidth="1.5" strokeLinecap="round" />
        <line x1="12" y1="21" x2="12" y2="23" stroke={statusColor} strokeWidth="1.5" strokeLinecap="round" />
        <line x1="17" y1="21" x2="17" y2="23" stroke={statusColor} strokeWidth="1.5" strokeLinecap="round" />
        <line x1="1" y1="7" x2="3" y2="7" stroke={statusColor} strokeWidth="1.5" strokeLinecap="round" />
        <line x1="1" y1="12" x2="3" y2="12" stroke={statusColor} strokeWidth="1.5" strokeLinecap="round" />
        <line x1="1" y1="17" x2="3" y2="17" stroke={statusColor} strokeWidth="1.5" strokeLinecap="round" />
        <line x1="21" y1="7" x2="23" y2="7" stroke={statusColor} strokeWidth="1.5" strokeLinecap="round" />
        <line x1="21" y1="12" x2="23" y2="12" stroke={statusColor} strokeWidth="1.5" strokeLinecap="round" />
        <line x1="21" y1="17" x2="23" y2="17" stroke={statusColor} strokeWidth="1.5" strokeLinecap="round" />

        {/* Inner neural network pattern */}
        {hasClipEmbedding && (
          <>
            {/* CLIP indicator - top half connections */}
            <circle cx="8" cy="8" r="1.5" fill={statusColor} fillOpacity={fillOpacity} />
            <circle cx="16" cy="8" r="1.5" fill={statusColor} fillOpacity={fillOpacity} />
            <circle cx="12" cy="12" r="2" fill={statusColor} fillOpacity={fillOpacity} />
            <line x1="8" y1="8" x2="12" y2="12" stroke={statusColor} strokeWidth="1" strokeOpacity={fillOpacity} />
            <line x1="16" y1="8" x2="12" y2="12" stroke={statusColor} strokeWidth="1" strokeOpacity={fillOpacity} />
          </>
        )}
        
        {hasColorEmbedding && (
          <>
            {/* Color indicator - bottom half / color dots */}
            <circle cx="8" cy="16" r="1.5" fill={dominantColors?.[0] ?? statusColor} fillOpacity={fillOpacity} />
            <circle cx="12" cy="16" r="1.5" fill={dominantColors?.[1] ?? statusColor} fillOpacity={fillOpacity} />
            <circle cx="16" cy="16" r="1.5" fill={dominantColors?.[2] ?? statusColor} fillOpacity={fillOpacity} />
            {hasClipEmbedding && (
              <>
                <line x1="12" y1="12" x2="8" y2="16" stroke={statusColor} strokeWidth="1" strokeOpacity={fillOpacity} />
                <line x1="12" y1="12" x2="12" y2="16" stroke={statusColor} strokeWidth="1" strokeOpacity={fillOpacity} />
                <line x1="12" y1="12" x2="16" y2="16" stroke={statusColor} strokeWidth="1" strokeOpacity={fillOpacity} />
              </>
            )}
          </>
        )}

        {/* Empty state - just outline dots */}
        {!hasAny && (
          <>
            <circle cx="8" cy="8" r="1" stroke={statusColor} strokeWidth="0.5" fill="none" strokeOpacity="0.5" />
            <circle cx="16" cy="8" r="1" stroke={statusColor} strokeWidth="0.5" fill="none" strokeOpacity="0.5" />
            <circle cx="12" cy="12" r="1.5" stroke={statusColor} strokeWidth="0.5" fill="none" strokeOpacity="0.5" />
            <circle cx="8" cy="16" r="1" stroke={statusColor} strokeWidth="0.5" fill="none" strokeOpacity="0.5" />
            <circle cx="12" cy="16" r="1" stroke={statusColor} strokeWidth="0.5" fill="none" strokeOpacity="0.5" />
            <circle cx="16" cy="16" r="1" stroke={statusColor} strokeWidth="0.5" fill="none" strokeOpacity="0.5" />
          </>
        )}
      </svg>

      {isPending && (
        <span className="absolute -inset-1 rounded-md border border-amber-400/60 animate-ping" />
      )}

      <span className="ml-1 text-[9px] font-3270 text-gray-500 leading-none">
        {providerLabel}
      </span>

      {/* Tooltip */}
      {showTooltip && isHovered && (
        <div
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 text-xs 
                     bg-gray-900 text-white rounded shadow-lg whitespace-nowrap z-50"
        >
          <div className="font-medium">{statusText}</div>
          {dominantColors && dominantColors.length > 0 && (
            <div className="flex gap-1 mt-1">
              {dominantColors.slice(0, 5).map((color, i) => (
                <div
                  key={i}
                  className="w-3 h-3 rounded-sm border border-white/20"
                  style={{ backgroundColor: color }}
                  title={color}
                />
              ))}
            </div>
          )}
          {/* Tooltip arrow */}
          <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900" />
        </div>
      )}
    </div>
  );
}

/**
 * Compact version for tight spaces (e.g., grid view)
 */
export function EmbeddingStatusDot({
  hasClipEmbedding = false,
  hasColorEmbedding = false,
  size = 8,
  className = '',
  pendingStatus,
}: Pick<EmbeddingStatusIconProps, 'hasClipEmbedding' | 'hasColorEmbedding' | 'size' | 'className' | 'pendingStatus'>) {
  const providerLabel = (() => {
    const raw = (process.env.NEXT_PUBLIC_EMBEDDING_PROVIDER || 'hf').toLowerCase();
    return raw.startsWith('l') ? 'L' : 'HF';
  })();
  const hasBoth = hasClipEmbedding && hasColorEmbedding;
  const hasClipOnly = hasClipEmbedding && !hasColorEmbedding;
  const hasColorOnly = !hasClipEmbedding && hasColorEmbedding;
  const isPending = pendingStatus === 'queued' || pendingStatus === 'embedding';
  const isError = pendingStatus === 'error';

  let bgColor = 'bg-gray-400/50'; // no embeddings
  let title = 'No embeddings';

  if (isPending) {
    bgColor = 'bg-amber-500';
    title = pendingStatus === 'queued' ? 'Embedding queued' : 'Embedding in progress';
  } else if (isError) {
    bgColor = 'bg-red-500';
    title = 'Embedding failed';
  } else if (hasBoth) {
    bgColor = 'bg-green-500';
    title = 'CLIP + Color embeddings';
  } else if (hasClipOnly) {
    bgColor = 'bg-blue-500';
    title = 'CLIP embedding only';
  } else if (hasColorOnly) {
    bgColor = 'bg-purple-500';
    title = 'Color embedding only';
  }

  return (
    <div className={`inline-flex items-center ${className}`} title={title}>
      <div className="relative">
        <div
          className={`rounded-full ${bgColor}`}
          style={{ width: size, height: size }}
        />
        {isPending && (
          <span
            className="absolute inset-0 rounded-full animate-ping bg-amber-400/60"
            style={{ width: size, height: size }}
          />
        )}
      </div>
      <span className="ml-1 text-[9px] font-3270 text-gray-500 leading-none">
        {providerLabel}
      </span>
    </div>
  );
}

export default EmbeddingStatusIcon;
