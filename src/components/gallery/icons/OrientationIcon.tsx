/**
 * OrientationIcon Component
 * 
 * Displays an icon indicating image orientation (square, landscape, portrait).
 */

import React from 'react';

interface OrientationIconProps {
  aspectRatioString: string;
}

export const OrientationIcon: React.FC<OrientationIconProps> = ({ aspectRatioString }) => {
  // Parse the aspect ratio to determine orientation
  const parts = aspectRatioString.split(':');
  if (parts.length === 2) {
    const width = parseFloat(parts[0]);
    const height = parseFloat(parts[1]);
    const ratio = width / height;

    if (Math.abs(ratio - 1) < 0.1) {
      // Square (1:1 or close)
      return (
        <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor" className="inline-block">
          <rect x="1" y="1" width="6" height="6" fill="none" stroke="currentColor" strokeWidth="0.8" />
        </svg>
      );
    } else if (ratio > 1) {
      // Landscape (wider than tall)
      return (
        <svg width="10" height="6" viewBox="0 0 10 6" fill="currentColor" className="inline-block">
          <rect x="1" y="1" width="8" height="4" fill="none" stroke="currentColor" strokeWidth="0.8" />
        </svg>
      );
    } else {
      // Portrait (taller than wide)
      return (
        <svg width="6" height="10" viewBox="0 0 6 10" fill="currentColor" className="inline-block">
          <rect x="1" y="1" width="4" height="8" fill="none" stroke="currentColor" strokeWidth="0.8" />
        </svg>
      );
    }
  }

  // Default to square if we can't parse
  return (
    <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor" className="inline-block">
      <rect x="1" y="1" width="6" height="6" fill="none" stroke="currentColor" strokeWidth="0.8" />
    </svg>
  );
};
