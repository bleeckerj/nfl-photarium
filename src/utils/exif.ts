import sharp from 'sharp';
import exifReader from 'exif-reader';

export type ExifSummary = Record<string, string | number>;

const formatExifValue = (value: unknown): string | number | undefined => {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value === 'string' || typeof value === 'number') {
    return value;
  }
  if (Array.isArray(value)) {
    const cleaned = value.map((entry) => formatExifValue(entry)).filter(Boolean);
    return cleaned.length ? cleaned.join(', ') : undefined;
  }
  if (typeof value === 'object') {
    const maybeRational = value as { numerator?: number; denominator?: number };
    if (
      typeof maybeRational.numerator === 'number' &&
      typeof maybeRational.denominator === 'number' &&
      maybeRational.denominator !== 0
    ) {
      return `${maybeRational.numerator}/${maybeRational.denominator}`;
    }
    const asString = (value as { toString?: () => string }).toString?.();
    return asString && asString !== '[object Object]' ? asString : undefined;
  }
  return undefined;
};

const addValue = (
  summary: ExifSummary,
  key: string,
  value: unknown
) => {
  const formatted = formatExifValue(value);
  if (formatted !== undefined && formatted !== '') {
    summary[key] = formatted;
  }
};

export const extractExifSummary = async (buffer: Buffer): Promise<ExifSummary | undefined> => {
  try {
    const metadata = await sharp(buffer).metadata();
    if (!metadata.exif) {
      return undefined;
    }
    const parsed = exifReader(metadata.exif);
    const summary: ExifSummary = {};
    addValue(summary, 'make', parsed?.Image?.Make);
    addValue(summary, 'model', parsed?.Image?.Model);
    addValue(summary, 'lens', parsed?.Photo?.LensModel || parsed?.Photo?.LensSpecification);
    addValue(summary, 'dateTimeOriginal', parsed?.Photo?.DateTimeOriginal);
    addValue(summary, 'exposureTime', parsed?.Photo?.ExposureTime);
    addValue(summary, 'fNumber', parsed?.Photo?.FNumber);
    addValue(summary, 'iso', parsed?.Photo?.ISOSpeedRatings || parsed?.Photo?.PhotographicSensitivity);
    addValue(summary, 'focalLength', parsed?.Photo?.FocalLength);
    return Object.keys(summary).length ? summary : undefined;
  } catch (error) {
    console.warn('Failed to extract EXIF data:', error);
    return undefined;
  }
};
