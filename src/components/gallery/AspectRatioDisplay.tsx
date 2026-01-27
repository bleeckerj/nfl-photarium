/**
 * AspectRatioDisplay Component
 * 
 * Displays the aspect ratio of an image with loading state.
 */

'use client';

import React from 'react';
import { useImageAspectRatio } from '@/hooks/useImageAspectRatio';
import { OrientationIcon } from './icons';

interface AspectRatioDisplayProps {
  imageId: string;
}

export const AspectRatioDisplay: React.FC<AspectRatioDisplayProps> = ({ imageId }) => {
  const { aspectRatio, loading, error } = useImageAspectRatio(imageId);

  if (loading) {
    return (
      <p className="text-sm font-mono text-gray-400">
        📐 <span className="inline-block w-8 h-2 bg-gray-200 rounded animate-pulse"></span>
      </p>
    );
  }

  if (error || !aspectRatio) {
    return <p className="text-sm font-mono text-gray-400">📐 --</p>;
  }

  return (
    <p className="text-[0.6rem] font-mono text-gray-500 flex items-center gap-1">
      📐 {aspectRatio} <OrientationIcon aspectRatioString={aspectRatio} />
    </p>
  );
};
