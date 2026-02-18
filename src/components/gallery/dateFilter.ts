import type { DateFilter } from './types';

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const pad2 = (value: number) => String(value).padStart(2, '0');

export const toDateKey = (date: Date): string =>
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

export const parseDateKey = (value: string): Date | null => {
  if (!DATE_KEY_PATTERN.test(value)) return null;
  const [yearRaw, monthRaw, dayRaw] = value.split('-');
  const year = Number(yearRaw);
  const monthIndex = Number(monthRaw) - 1;
  const day = Number(dayRaw);
  if (!Number.isFinite(year) || !Number.isFinite(monthIndex) || !Number.isFinite(day)) {
    return null;
  }
  const date = new Date(year, monthIndex, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== monthIndex ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
};

export const normalizeDateRange = (filter: DateFilter): DateFilter | null => {
  const start = parseDateKey(filter.startDate);
  const end = parseDateKey(filter.endDate);
  if (!start || !end) return null;
  const startKey = toDateKey(start);
  const endKey = toDateKey(end);
  return startKey <= endKey
    ? { startDate: startKey, endDate: endKey }
    : { startDate: endKey, endDate: startKey };
};

const fromLegacyMonthFilter = (value: { year?: unknown; month?: unknown }): DateFilter | null => {
  const year = typeof value.year === 'number' ? value.year : NaN;
  const month = typeof value.month === 'number' ? value.month : NaN;
  if (!Number.isFinite(year) || !Number.isFinite(month)) return null;
  if (month < 0 || month > 11) return null;

  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 0);
  return {
    startDate: toDateKey(start),
    endDate: toDateKey(end),
  };
};

export const normalizeDateFilterValue = (value: unknown): DateFilter | null => {
  if (!value || typeof value !== 'object') return null;
  const raw = value as { startDate?: unknown; endDate?: unknown; year?: unknown; month?: unknown };

  if (typeof raw.startDate === 'string' && typeof raw.endDate === 'string') {
    return normalizeDateRange({ startDate: raw.startDate, endDate: raw.endDate });
  }

  return fromLegacyMonthFilter(raw);
};

export const getDateKeyRangeMs = (filter: DateFilter): { startMs: number; endMs: number } | null => {
  const normalized = normalizeDateRange(filter);
  if (!normalized) return null;
  const startDate = parseDateKey(normalized.startDate);
  const endDate = parseDateKey(normalized.endDate);
  if (!startDate || !endDate) return null;

  const startMs = new Date(
    startDate.getFullYear(),
    startDate.getMonth(),
    startDate.getDate(),
    0,
    0,
    0,
    0
  ).getTime();
  const endMs = new Date(
    endDate.getFullYear(),
    endDate.getMonth(),
    endDate.getDate(),
    23,
    59,
    59,
    999
  ).getTime();
  return { startMs, endMs };
};

export const formatDateFilterLabel = (filter: DateFilter | null): string => {
  if (!filter) return 'All uploads';
  const normalized = normalizeDateRange(filter);
  if (!normalized) return 'All uploads';
  const startDate = parseDateKey(normalized.startDate);
  const endDate = parseDateKey(normalized.endDate);
  if (!startDate || !endDate) return 'All uploads';

  if (normalized.startDate === normalized.endDate) {
    return startDate.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }
  return `${startDate.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })} - ${endDate.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })}`;
};
