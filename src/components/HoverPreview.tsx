'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import Image from 'next/image';
import { getCloudflareImageUrl } from '@/utils/imageUtils';

interface HoverPreviewProps {
  imageId: string;
  filename: string;
  isVisible: boolean;
  mousePosition: { x: number; y: number };
  onClose: () => void;
  dimensions?: { width: number; height: number };
}

const VIEWPORT_PADDING = 20;

const HoverPreview: React.FC<HoverPreviewProps> = ({
  imageId,
  filename,
  isVisible,
  mousePosition,
  onClose,
  dimensions
}) => {
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isLoaded, setIsLoaded] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);

  // Calculate optimal preview size based on original dimensions
  const getPreviewSize = () => {
    const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1200;
    const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 800;
    const maxAllowedWidth = Math.max(200, viewportWidth - VIEWPORT_PADDING * 2);
    const maxAllowedHeight = Math.max(160, viewportHeight - VIEWPORT_PADDING * 2);

    if (!dimensions) {
      const fallbackWidth = Math.min(400, maxAllowedWidth);
      const fallbackHeight = Math.min(300, maxAllowedHeight);
      return { width: fallbackWidth, height: fallbackHeight };
    }

    const maxWidth = Math.min(600, maxAllowedWidth);
    const maxHeight = Math.min(450, maxAllowedHeight);
    const aspectRatio = dimensions.width / dimensions.height;

    let previewWidth = maxWidth;
    let previewHeight = maxWidth / aspectRatio;

    if (previewHeight > maxHeight) {
      previewHeight = maxHeight;
      previewWidth = maxHeight * aspectRatio;
    }

    // Ensure preview fits viewport
    if (previewWidth > maxAllowedWidth) {
      previewWidth = maxAllowedWidth;
      previewHeight = previewWidth / aspectRatio;
    }
    if (previewHeight > maxAllowedHeight) {
      previewHeight = maxAllowedHeight;
      previewWidth = previewHeight * aspectRatio;
    }

    return { 
      width: Math.round(previewWidth), 
      height: Math.round(previewHeight) 
    };
  };

  const previewSize = useMemo(() => getPreviewSize(), [
    dimensions?.width,
    dimensions?.height
  ]);

  // Calculate position to keep preview within viewport
  useEffect(() => {
    if (!isVisible || !previewRef.current) return;

    const padding = VIEWPORT_PADDING; // Distance from cursor and viewport edges
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const previewWidth = previewSize.width;
    const previewHeight = previewSize.height;

    let x = mousePosition.x + padding;
    let y = mousePosition.y + padding;

    // Adjust horizontal position if preview would overflow
    if (x + previewWidth > viewportWidth - padding) {
      x = mousePosition.x - previewWidth - padding;
    }

    // Adjust vertical position if preview would overflow
    if (y + previewHeight > viewportHeight - padding) {
      y = mousePosition.y - previewHeight - padding;
    }

    // Ensure preview stays within viewport bounds
    x = Math.max(padding, Math.min(x, viewportWidth - previewWidth - padding));
    y = Math.max(padding, Math.min(y, viewportHeight - previewHeight - padding));

    setPosition((prev) => (prev.x === x && prev.y === y ? prev : { x, y }));
  }, [
    mousePosition.x,
    mousePosition.y,
    isVisible,
    previewSize.width,
    previewSize.height
  ]);

  // Reset loaded state when visibility changes
  useEffect(() => {
    if (!isVisible) {
      setIsLoaded(false);
    }
  }, [isVisible]);

  if (!isVisible) {
    return null;
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[9998] pointer-events-none"
        onClick={onClose}
      />
      
      {/* Preview Container */}
      <div
        ref={previewRef}
        className="fixed z-[9999] pointer-events-none transition-opacity duration-200 ease-out"
        style={{
          left: `${position.x}px`,
          top: `${position.y}px`,
          width: `${previewSize.width}px`,
          height: `${previewSize.height + 40}px`, // Extra height for filename
          opacity: isLoaded ? 1 : 0,
        }}
      >
        {/* Shadow/Border Container */}
        <div className="bg-white rounded-lg shadow-2xl border border-gray-200 overflow-hidden">
          {/* Image Container */}
          <div 
            className="relative bg-gray-100"
            style={{ 
              width: `${previewSize.width}px`, 
              height: `${previewSize.height}px` 
            }}
          >
            <Image
              src={getCloudflareImageUrl(imageId, 'w=800')} // Use high-quality variant
              alt={filename}
              fill
              className="object-contain"
              sizes={`${previewSize.width}px`}
              onLoad={() => setIsLoaded(true)}
              onError={() => setIsLoaded(true)} // Show even if image fails to load
              priority={false} // Don't prioritize hover previews
            />
            
            {/* Loading indicator */}
            {!isLoaded && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-2 border-gray-300 border-t-blue-600"></div>
              </div>
            )}
          </div>
          
          {/* Filename footer */}
          <div className="px-3 py-2 bg-gray-50 border-t">
            <p className="text-xs font-medium text-gray-900 truncate" title={filename}>
              {filename}
            </p>
            {dimensions && (
              <p className="text-xs text-gray-500">
                {dimensions.width} × {dimensions.height}
              </p>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

export default HoverPreview;
