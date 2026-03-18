export const VARIATION_UPLOAD_ACCEPT = {
  'image/*': ['.jpeg', '.jpg', '.png', '.gif', '.webp', '.svg'],
  'video/*': ['.mp4', '.webm', '.mov', '.ogv', '.ogg'],
  'application/zip': ['.zip', '.key'],
  'application/x-zip-compressed': ['.zip', '.key'],
  'application/vnd.apple.keynote': ['.key'],
  'application/x-iwork-keynote-sffkey': ['.key']
} as const;
