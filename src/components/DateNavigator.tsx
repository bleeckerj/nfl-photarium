'use client';

import { useMemo } from 'react';
import { Calendar } from 'lucide-react';
import MonoSelect from './MonoSelect';

/**
 * DateNavigator - Month filter for gallery images
 * 
 * This component provides:
 * 1. Month dropdown - filter to show only images from a specific month
 * 2. "All uploads" option to clear the filter
 * 
 * Architecture:
 * - Emits a date filter (year/month) via onFilterChange callback
 * - Parent component is responsible for actually filtering the images
 * - null filter means "show all"
 * 
 * HTML Structure IDs:
 * - #date-navigator-container - outer wrapper
 * - #date-navigator-month-section - month dropdown area
 */

export interface DateFilter {
  year: number;
  month: number; // 0-11
}

interface DateNavigatorProps {
  /** Array of ALL images (unfiltered) with 'uploaded' date strings */
  allImages: Array<{ uploaded: string }>;
  /** Current date filter (null means no filter / show all) */
  currentFilter: DateFilter | null;
  /** Callback when user changes the date filter */
  onFilterChange: (filter: DateFilter | null) => void;
}

interface MonthGroup {
  /** Display label, e.g. "January 2026" */
  label: string;
  /** Sort key for ordering, e.g. "2026-01" */
  key: string;
  /** Number of images in this month */
  count: number;
  /** The month's year */
  year: number;
  /** The month (0-11) */
  month: number;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

/**
 * Groups images by month and counts them.
 */
const computeMonthGroups = (
  images: Array<{ uploaded: string }>
): MonthGroup[] => {
  if (!images.length) return [];

  const monthMap = new Map<string, { 
    count: number; 
    year: number; 
    month: number 
  }>();

  images.forEach((image) => {
    const date = new Date(image.uploaded);
    const year = date.getFullYear();
    const month = date.getMonth();
    const key = `${year}-${String(month + 1).padStart(2, '0')}`;

    const existing = monthMap.get(key);
    if (existing) {
      existing.count++;
    } else {
      monthMap.set(key, { count: 1, year, month });
    }
  });

  const groups: MonthGroup[] = [];

  monthMap.forEach((data, key) => {
    groups.push({
      key,
      label: `${MONTH_NAMES[data.month]} ${data.year}`,
      count: data.count,
      year: data.year,
      month: data.month
    });
  });

  // Sort by date descending (newest first)
  groups.sort((a, b) => b.key.localeCompare(a.key));

  return groups;
};

/**
 * Converts a DateFilter to a key string for the dropdown
 */
const filterToKey = (filter: DateFilter | null): string => {
  if (!filter) return '__all__';
  return `${filter.year}-${String(filter.month + 1).padStart(2, '0')}`;
};

export default function DateNavigator({
  allImages,
  currentFilter,
  onFilterChange
}: DateNavigatorProps) {
  // Month groups from all images (not filtered)
  const monthGroups = useMemo(
    () => computeMonthGroups(allImages),
    [allImages]
  );

  // Build options for MonoSelect - include "All uploads" at top
  const monthOptions = useMemo(
    () => [
      { value: '__all__', label: `All uploads (${allImages.length})` },
      ...monthGroups.map((group) => ({
        value: group.key,
        label: `${group.label} (${group.count})`
      }))
    ],
    [monthGroups, allImages.length]
  );

  if (monthGroups.length === 0) {
    return null;
  }

  const handleMonthChange = (selectedKey: string) => {
    if (selectedKey === '__all__') {
      onFilterChange(null);
      return;
    }
    const selectedGroup = monthGroups.find((g) => g.key === selectedKey);
    if (selectedGroup) {
      onFilterChange({ year: selectedGroup.year, month: selectedGroup.month });
    }
  };

  return (
    <div id="date-navigator-container" className="flex items-center gap-3 flex-wrap">
      <div id="date-navigator-month-section" className="flex items-center gap-2">
        <Calendar className="h-4 w-4 text-gray-400" aria-hidden="true" />
        <span className="text-[0.65em] font-mono text-gray-500 uppercase tracking-wide">Uploaded</span>
        <MonoSelect
          id="date-navigator-month-select"
          value={filterToKey(currentFilter)}
          options={monthOptions}
          onChange={handleMonthChange}
          placeholder="Select month…"
          size="sm"
          className="min-w-[160px]"
        />
      </div>
    </div>
  );
}
