import { describe, expect, it } from 'vitest';
import { formatExifDisplayValue } from '@/components/image-detail/exifPresentation';
import { formatExifCameraClock } from '@/utils/exifDate';

describe('formatExifDisplayValue', () => {
  it('turns a stored decimal exposure into a familiar shutter speed', () => {
    expect(formatExifDisplayValue('exposureTime', '0.002')).toBe('1/500 s');
    expect(formatExifDisplayValue('exposureTime', '1/60')).toBe('1/60 s');
  });

  it('adds photographic units only to plain stored numbers', () => {
    expect(formatExifDisplayValue('fNumber', '2')).toBe('ƒ/2');
    expect(formatExifDisplayValue('focalLength', 24)).toBe('24 mm');
    expect(formatExifDisplayValue('focalLength', '24 mm')).toBe('24 mm');
  });

  it('shows camera time without applying the server timezone', () => {
    expect(formatExifCameraClock(new Date('2010-11-23T08:19:30Z'))).toBe('2010-11-23 08:19:30');
    expect(formatExifDisplayValue('dateTimeOriginal', 'Tue Nov 23 2010 00:19:30 GMT-0800 (Pacific Standard Time)'))
      .toBe('2010-11-23 08:19:30 (camera time)');
    expect(formatExifDisplayValue('dateTimeOriginal', '2024:06:14 09:42:18'))
      .toBe('2024-06-14 09:42:18 (camera time)');
  });
});
