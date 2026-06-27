export type AspectRatioClass = 'horizontal' | 'vertical' | 'square';

const SQUARE_TOLERANCE = 0.05;

export type AspectRatioClassInput = {
  dimensions?: { width?: number; height?: number };
  aspectRatio?: string;
  aspectRatioClass?: string;
};

export const normalizeAspectRatioClass = (value?: string): AspectRatioClass | null => {
  if (value === 'horizontal' || value === 'vertical' || value === 'square') {
    return value;
  }
  return null;
};

const parseAspectRatioDecimal = (value?: string): number | null => {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  const separator = trimmed.includes(':') ? ':' : trimmed.includes('/') ? '/' : null;
  if (!separator) {
    const decimal = Number(trimmed);
    return Number.isFinite(decimal) && decimal > 0 ? decimal : null;
  }

  const [widthRaw, heightRaw] = trimmed.split(separator);
  const width = Number(widthRaw);
  const height = Number(heightRaw);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  return width / height;
};

export const classifyAspectRatio = (width: number, height: number): AspectRatioClass => {
  const ratio = width / height;
  if (Math.abs(ratio - 1) <= SQUARE_TOLERANCE) return 'square';
  return ratio > 1 ? 'horizontal' : 'vertical';
};

export const resolveAspectRatioClass = ({
  dimensions,
  aspectRatio,
  aspectRatioClass,
}: AspectRatioClassInput): AspectRatioClass | null => {
  const width = dimensions?.width;
  const height = dimensions?.height;
  if (
    typeof width === 'number' &&
    typeof height === 'number' &&
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width > 0 &&
    height > 0
  ) {
    return classifyAspectRatio(width, height);
  }

  const fromAspectRatio = parseAspectRatioDecimal(aspectRatio);
  if (fromAspectRatio !== null) {
    if (Math.abs(fromAspectRatio - 1) <= SQUARE_TOLERANCE) return 'square';
    return fromAspectRatio > 1 ? 'horizontal' : 'vertical';
  }

  return normalizeAspectRatioClass(aspectRatioClass);
};

export const matchesAspectRatioClass = (
  asset: AspectRatioClassInput,
  classes: AspectRatioClass[]
): boolean => {
  if (classes.length === 0) return true;
  const resolved = resolveAspectRatioClass(asset);
  return resolved !== null && classes.includes(resolved);
};
