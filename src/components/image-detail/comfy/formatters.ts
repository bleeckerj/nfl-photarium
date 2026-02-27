export function compactListPreview(items: string[], visibleCount = 4): string[] {
  return items.slice(0, visibleCount);
}

export function formatRelativeDateTimeish(value?: string): string | null {
  if (!value) return null;
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toLocaleString();
}

export function truncateMiddle(value: string, max = 72): string {
  if (value.length <= max) return value;
  const head = Math.max(8, Math.floor((max - 1) / 2));
  const tail = Math.max(8, max - head - 1);
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export function formatNumber(value?: number): string | null {
  if (value === undefined || value === null || Number.isNaN(value)) return null;
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
}

export function formatSize(width?: number, height?: number): string | null {
  if (!width || !height) return null;
  return `${width}x${height}`;
}
