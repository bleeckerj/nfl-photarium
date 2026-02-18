import MonoSelect from '@/components/MonoSelect';
import { GRID_SIZE_OPTIONS } from './constants';
import { normalizeGridSize } from './gridSizing';
import type { GridSize } from './types';

interface GridSizeToggleProps {
  value: GridSize;
  onChange: (value: GridSize) => void;
}

export function GridSizeToggle({ value, onChange }: GridSizeToggleProps) {
  return (
    <div className="flex items-center gap-1 bg-gray-100/50 rounded-md px-2 py-0.5">
      <label htmlFor="grid-size-toolbar" className="text-[0.65rem] font-mono text-gray-500 whitespace-nowrap">
        Grid Zoom:
      </label>
      <MonoSelect
        id="grid-size-toolbar"
        value={value}
        onChange={(nextValue) => onChange(normalizeGridSize(nextValue))}
        options={GRID_SIZE_OPTIONS}
        className="w-24"
        size="sm"
      />
    </div>
  );
}
