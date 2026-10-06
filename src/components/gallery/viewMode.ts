import type { ViewMode } from './types';

export const normalizeViewMode = (value: unknown): ViewMode =>
  value === 'list' || value === 'images' ? value : 'grid';
