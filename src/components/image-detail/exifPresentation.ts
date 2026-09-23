import { formatExifCameraClock } from '@/utils/exifDate';

const plainNumber = /^\d+(?:\.\d+)?$/;
const fraction = /^\d+\/\d+$/;
const cameraClock = /^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}:\d{2}:\d{2})$/;

export function formatExifDisplayValue(key: string, value: string | number): string {
  const raw = String(value).trim();
  if (key === 'dateTimeOriginal') {
    // Earlier uploads stored Date.toString(), which shifted the camera clock
    // into the server timezone. The UTC fields recover the original EXIF time.
    if (raw.includes('GMT')) {
      const legacyDate = new Date(raw);
      if (Number.isFinite(legacyDate.getTime())) {
        return `${formatExifCameraClock(legacyDate)} (camera time)`;
      }
    }
    const match = raw.match(cameraClock);
    if (match) {
      return `${match[1]}-${match[2]}-${match[3]} ${match[4]} (camera time)`;
    }
  }
  if (key === 'exposureTime') {
    if (fraction.test(raw)) return `${raw} s`;
    if (plainNumber.test(raw)) {
      const seconds = Number(raw);
      if (seconds > 0 && seconds < 1) {
        const denominator = Math.round(1 / seconds);
        if (Math.abs(1 / seconds - denominator) < 0.01) {
          return `1/${denominator} s`;
        }
      }
      return `${raw} s`;
    }
  }
  if (key === 'fNumber' && plainNumber.test(raw)) return `ƒ/${raw}`;
  if (key === 'focalLength' && plainNumber.test(raw)) return `${raw} mm`;
  return raw;
}
