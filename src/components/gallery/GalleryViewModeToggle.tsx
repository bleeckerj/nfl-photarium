'use client';

import { Images, LayoutGrid, List } from 'lucide-react';
import type { ViewMode } from './types';

interface GalleryViewModeToggleProps {
  value: ViewMode;
  onChange: (mode: ViewMode) => void;
}

const VIEW_OPTIONS = [
  { value: 'grid', label: 'Grid', icon: LayoutGrid },
  { value: 'images', label: 'Images only', icon: Images },
  { value: 'list', label: 'List', icon: List },
] as const;

export function GalleryViewModeToggle({ value, onChange }: GalleryViewModeToggleProps) {
  return (
    <div role="group" aria-label="Gallery view" className="inline-flex shrink-0 overflow-hidden rounded-md border border-gray-200">
      {VIEW_OPTIONS.map(({ value: mode, label, icon: Icon }) => (
        <button
          key={mode}
          type="button"
          aria-label={`${label} view`}
          aria-pressed={value === mode}
          title={`${label} view`}
          onClick={() => onChange(mode)}
          className={`inline-flex h-8 items-center gap-1.5 px-2 font-mono text-[0.65rem] transition ${
            value === mode ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 hover:bg-gray-100'
          }`}
        >
          <Icon className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}
