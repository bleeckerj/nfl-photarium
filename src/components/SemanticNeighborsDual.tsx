'use client';

import { SemanticNeighbors } from '@/components/SemanticNeighbors';
import type { SemanticNeighborsProps } from '@/components/SemanticNeighbors';

export function SemanticNeighborsDual({
  imageId,
  limit = 4,
  className = '',
  onImageClick,
}: Omit<SemanticNeighborsProps, 'type'>) {
  return (
    <div className={`space-y-4 ${className}`}>
      <SemanticNeighbors imageId={imageId} type="clip" limit={limit} onImageClick={onImageClick} />
      <SemanticNeighbors imageId={imageId} type="color" limit={limit} onImageClick={onImageClick} />
    </div>
  );
}

