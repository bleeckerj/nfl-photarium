/**
 * exif-reader represents a timezone-free EXIF camera timestamp as a Date in UTC.
 * Reading its local fields would shift the camera clock into the server timezone.
 */
export function formatExifCameraClock(date: Date): string {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}
