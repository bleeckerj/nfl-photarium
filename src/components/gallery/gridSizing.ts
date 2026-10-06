import { DEFAULT_GRID_SIZE } from './constants';
import type { GridSize } from './types';

const GRID_CLASS_BY_SIZE: Record<GridSize, string> = {
  small: 'grid grid-cols-1 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-6',
  medium: 'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-5',
  large: 'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4',
  xlarge: 'grid grid-cols-1 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3',
};

export const isGridSize = (value: unknown): value is GridSize =>
  value === 'small' || value === 'medium' || value === 'large' || value === 'xlarge';

export const normalizeGridSize = (
  value: unknown,
  fallback: GridSize = DEFAULT_GRID_SIZE
): GridSize => (isGridSize(value) ? value : fallback);

export const getGridClassName = (gridSize: GridSize, compact = false): string =>
  `${GRID_CLASS_BY_SIZE[gridSize] ?? GRID_CLASS_BY_SIZE[DEFAULT_GRID_SIZE]} ${compact ? 'gap-1' : 'gap-4'}`;
