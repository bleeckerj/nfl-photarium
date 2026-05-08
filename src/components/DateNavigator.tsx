'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Calendar, ChevronLeft, ChevronRight, X } from 'lucide-react';
import type { DateFilter } from '@/components/gallery/types';
import { formatDateFilterLabel, normalizeDateRange, parseDateKey, toDateKey } from '@/components/gallery/dateFilter';

interface DateNavigatorProps {
  allImages: Array<{ uploaded: string }>;
  currentFilter: DateFilter | null;
  onFilterChange: (filter: DateFilter | null) => void;
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const WEEKDAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

const isDateKeyInRange = (key: string, start: string, end: string): boolean => {
  const left = start <= end ? start : end;
  const right = start <= end ? end : start;
  return key >= left && key <= right;
};

const buildCalendarGrid = (year: number, month: number): Date[] => {
  const firstOfMonth = new Date(year, month, 1);
  const firstWeekday = firstOfMonth.getDay();
  const firstCellDate = new Date(year, month, 1 - firstWeekday);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(firstCellDate);
    date.setDate(firstCellDate.getDate() + index);
    return date;
  });
};

const collectYearOptions = (
  allImages: Array<{ uploaded: string }>,
  fallbackYear: number
): number[] => {
  const years = new Set<number>();
  allImages.forEach((image) => {
    const date = new Date(image.uploaded);
    if (!Number.isNaN(date.getTime())) {
      years.add(date.getFullYear());
    }
  });
  years.add(fallbackYear);
  years.add(fallbackYear - 1);
  years.add(fallbackYear + 1);
  return Array.from(years).sort((a, b) => a - b);
};

export const resolveDraftDateFilter = (
  startDate: string | null,
  endDate: string | null
): DateFilter | null => {
  if (!startDate) return null;
  return normalizeDateRange({ startDate, endDate: endDate || startDate });
};

export default function DateNavigator({
  allImages,
  currentFilter,
  onFilterChange,
}: DateNavigatorProps) {
  const normalizedCurrent = useMemo(
    () => (currentFilter ? normalizeDateRange(currentFilter) : null),
    [currentFilter]
  );

  const latestUploadDate = useMemo(() => {
    let latest: Date | null = null;
    allImages.forEach((image) => {
      const candidate = new Date(image.uploaded);
      if (Number.isNaN(candidate.getTime())) return;
      if (!latest || candidate.getTime() > latest.getTime()) {
        latest = candidate;
      }
    });
    return latest ?? new Date();
  }, [allImages]);

  const [isOpen, setIsOpen] = useState(false);
  const [viewYear, setViewYear] = useState(latestUploadDate.getFullYear());
  const [viewMonth, setViewMonth] = useState(latestUploadDate.getMonth());
  const [draftStartDate, setDraftStartDate] = useState<string | null>(null);
  const [draftEndDate, setDraftEndDate] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const imageCountByDate = useMemo(() => {
    const map = new Map<string, number>();
    allImages.forEach((image) => {
      const uploaded = new Date(image.uploaded);
      if (Number.isNaN(uploaded.getTime())) return;
      const key = toDateKey(uploaded);
      map.set(key, (map.get(key) || 0) + 1);
    });
    return map;
  }, [allImages]);

  const yearOptions = useMemo(
    () => collectYearOptions(allImages, viewYear),
    [allImages, viewYear]
  );

  useEffect(() => {
    if (!isOpen) return;

    const nextStart = normalizedCurrent?.startDate ?? null;
    const nextEnd = normalizedCurrent?.endDate ?? null;
    setDraftStartDate(nextStart);
    setDraftEndDate(nextEnd);

    const anchor = nextStart ? parseDateKey(nextStart) : latestUploadDate;
    if (anchor) {
      setViewYear(anchor.getFullYear());
      setViewMonth(anchor.getMonth());
    }
  }, [isOpen, latestUploadDate, normalizedCurrent]);

  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current && !rootRef.current.contains(target)) {
        setIsOpen(false);
      }
    };
    window.addEventListener('mousedown', handlePointerDown);
    return () => window.removeEventListener('mousedown', handlePointerDown);
  }, [isOpen]);

  const dayCells = useMemo(() => buildCalendarGrid(viewYear, viewMonth), [viewYear, viewMonth]);

  const monthLabel = `${MONTH_NAMES[viewMonth]} ${viewYear}`;

  const selectedRange = useMemo(
    () => resolveDraftDateFilter(draftStartDate, draftEndDate),
    [draftEndDate, draftStartDate]
  );

  const applyDraftRange = () => {
    if (!selectedRange) {
      onFilterChange(null);
      setIsOpen(false);
      return;
    }
    onFilterChange(selectedRange);
    setIsOpen(false);
  };

  const clearRange = () => {
    setDraftStartDate(null);
    setDraftEndDate(null);
    onFilterChange(null);
    setIsOpen(false);
  };

  const handleDaySelect = (dateKey: string) => {
    if (!draftStartDate || (draftStartDate && draftEndDate)) {
      setDraftStartDate(dateKey);
      setDraftEndDate(null);
      return;
    }
    if (draftStartDate && !draftEndDate) {
      setDraftEndDate(dateKey);
    }
  };

  const handleStartInputChange = (value: string) => {
    const nextStart = value || null;
    setDraftStartDate(nextStart);
    if (nextStart) {
      const parsed = parseDateKey(nextStart);
      if (parsed) {
        setViewYear(parsed.getFullYear());
        setViewMonth(parsed.getMonth());
      }
    }
  };

  const handleEndInputChange = (value: string) => {
    setDraftEndDate(value || null);
  };

  const moveMonth = (delta: number) => {
    const next = new Date(viewYear, viewMonth + delta, 1);
    setViewYear(next.getFullYear());
    setViewMonth(next.getMonth());
  };

  return (
    <div id="date-navigator-container" className="relative" ref={rootRef}>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setIsOpen((prev) => !prev)}
          className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-2 py-1 text-[0.65rem] font-mono text-gray-700 hover:bg-gray-50"
          title="Filter by upload date or date range"
        >
          <Calendar className="h-3.5 w-3.5 text-gray-500" />
          <span className="max-w-[180px] truncate">
            {normalizedCurrent ? 'Edit date filter' : 'Filter by date'}
          </span>
        </button>
        {normalizedCurrent && (
          <span className="inline-flex max-w-[260px] items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2 py-1 text-[0.62rem] font-mono text-blue-800">
            <span className="truncate">Date: {formatDateFilterLabel(normalizedCurrent)}</span>
            <button
              type="button"
              onClick={clearRange}
              className="rounded-full p-0.5 text-blue-700 hover:bg-blue-100"
              aria-label="Clear date filter"
              title="Clear date filter"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        )}
      </div>

      {isOpen && (
        <div className="absolute right-0 top-full z-[4000] mt-2 w-[316px] rounded-lg border border-gray-200 bg-white p-3 shadow-xl">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => moveMonth(-1)}
              className="rounded border border-gray-200 p-1 text-gray-600 hover:bg-gray-50"
              aria-label="Previous month"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <div className="text-[0.68rem] font-mono font-medium text-gray-800">{monthLabel}</div>
            <button
              type="button"
              onClick={() => moveMonth(1)}
              className="rounded border border-gray-200 p-1 text-gray-600 hover:bg-gray-50"
              aria-label="Next month"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="mt-2 flex items-center gap-2">
            <select
              value={String(viewMonth)}
              onChange={(event) => setViewMonth(Number(event.target.value))}
              className="w-1/2 rounded border border-gray-300 bg-white px-2 py-1 text-[0.65rem] font-mono"
            >
              {MONTH_NAMES.map((monthName, index) => (
                <option key={monthName} value={index}>
                  {monthName}
                </option>
              ))}
            </select>
            <select
              value={String(viewYear)}
              onChange={(event) => setViewYear(Number(event.target.value))}
              className="w-1/2 rounded border border-gray-300 bg-white px-2 py-1 text-[0.65rem] font-mono"
            >
              {yearOptions.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-[0.6rem] font-mono text-gray-500">
              Start date
              <input
                type="date"
                value={draftStartDate ?? ''}
                onChange={(event) => handleStartInputChange(event.target.value)}
                className="rounded border border-gray-300 bg-white px-2 py-1 text-[0.65rem] font-mono text-gray-700"
              />
            </label>
            <label className="flex flex-col gap-1 text-[0.6rem] font-mono text-gray-500">
              End date
              <input
                type="date"
                value={draftEndDate ?? ''}
                onChange={(event) => handleEndInputChange(event.target.value)}
                className="rounded border border-gray-300 bg-white px-2 py-1 text-[0.65rem] font-mono text-gray-700"
              />
            </label>
          </div>

          <div className="mt-2 grid grid-cols-7 gap-1 text-center text-[0.6rem] font-mono text-gray-500">
            {WEEKDAY_LABELS.map((label) => (
              <div key={label}>{label}</div>
            ))}
          </div>

          <div className="mt-1 grid grid-cols-7 gap-1">
            {dayCells.map((day) => {
              const dayKey = toDateKey(day);
              const inCurrentMonth = day.getMonth() === viewMonth;
              const isSelectedStart = Boolean(draftStartDate && dayKey === draftStartDate);
              const isSelectedEnd = Boolean((draftEndDate || draftStartDate) && dayKey === (draftEndDate || draftStartDate));
              const inRange = Boolean(
                draftStartDate &&
                  (draftEndDate || draftStartDate) &&
                  isDateKeyInRange(dayKey, draftStartDate, draftEndDate || draftStartDate)
              );
              const uploadCount = imageCountByDate.get(dayKey) || 0;

              return (
                <button
                  key={dayKey}
                  type="button"
                  onClick={() => handleDaySelect(dayKey)}
                  className={[
                    'relative h-8 rounded text-[0.62rem] font-mono transition',
                    inCurrentMonth ? 'text-gray-800' : 'text-gray-400',
                    inRange ? 'bg-blue-100' : 'hover:bg-gray-100',
                    isSelectedStart || isSelectedEnd ? 'bg-blue-600 text-white hover:bg-blue-600' : '',
                  ].join(' ')}
                  title={uploadCount > 0 ? `${uploadCount} upload${uploadCount === 1 ? '' : 's'}` : dayKey}
                >
                  {day.getDate()}
                  {uploadCount > 0 && (
                    <span
                      className={[
                        'absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full',
                        isSelectedStart || isSelectedEnd ? 'bg-white' : 'bg-blue-500',
                      ].join(' ')}
                    />
                  )}
                </button>
              );
            })}
          </div>

          <div className="mt-2 rounded border border-gray-200 bg-gray-50 px-2 py-1 text-[0.62rem] font-mono text-gray-600">
            {!draftStartDate
              ? 'Select a date. Select another date to make a range.'
              : draftEndDate
                ? `Range: ${formatDateFilterLabel({ startDate: draftStartDate, endDate: draftEndDate })}`
                : `Single day: ${formatDateFilterLabel({ startDate: draftStartDate, endDate: draftStartDate })}`}
          </div>

          <div className="mt-2 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={clearRange}
              className="px-2 py-1 text-[0.62rem] font-mono text-red-700 hover:text-red-800"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={applyDraftRange}
              disabled={!draftStartDate}
              className="rounded border border-blue-600 bg-blue-600 px-2 py-1 text-[0.62rem] font-mono text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Apply date filter
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
