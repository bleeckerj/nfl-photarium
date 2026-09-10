export const DNG_MIME_TYPE = 'image/x-adobe-dng';
export const DNG_MIME_TYPES = [DNG_MIME_TYPE, 'image/dng', 'image/x-dng'];

export function isDngFile(fileName: string, fileType = ''): boolean {
  return /\.dng$/i.test(fileName) || DNG_MIME_TYPES.includes(fileType.split(';')[0].trim().toLowerCase());
}

export const DNG_UPLOAD_ACCEPT = {
  'image/x-adobe-dng': ['.dng'],
  'image/dng': ['.dng'],
  'image/x-dng': ['.dng'],
};
