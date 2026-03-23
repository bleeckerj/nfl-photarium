import path from 'node:path';
import { createHash } from 'node:crypto';

export const DEFAULT_API_BASE = 'http://localhost:3000';
export const DEFAULT_NAMESPACE = 'cf-flickr';
export const DEFAULT_SELECTOR = 'all';
export const DEFAULT_AUTH_FILE = path.resolve('data', 'flickr-ingest', 'auth.json');
export const DEFAULT_STATE_DIR = path.resolve('data', 'flickr-ingest');
export const DEFAULT_API_THROTTLE_MS = 250;
export const DEFAULT_UPLOAD_THROTTLE_MS = 400;
export const DEFAULT_CONCURRENCY = 2;
export const DEFAULT_RETRY_MAX = 4;
export const DEFAULT_RETRY_BASE_MS = 1200;
export const DEFAULT_TAG_MODE = 'any';
export const FLICKR_REST_URL = 'https://www.flickr.com/services/rest';
export const FLICKR_REQUEST_TOKEN_URL = 'https://www.flickr.com/services/oauth/request_token';
export const FLICKR_AUTHORIZE_URL = 'https://www.flickr.com/services/oauth/authorize';
export const FLICKR_ACCESS_TOKEN_URL = 'https://www.flickr.com/services/oauth/access_token';
export const FLICKR_EXTRAS = [
  'date_upload',
  'date_taken',
  'last_update',
  'media',
  'tags',
  'original_format',
  'path_alias',
  'url_o',
  'url_k',
  'url_h',
  'url_l',
  'url_c',
  'url_z',
  'url_m',
  'url_n',
  'url_q',
  'url_s',
  'url_t',
  'url_sq',
].join(',');
export const PHOTO_URL_KEYS = ['url_o', 'url_k', 'url_h', 'url_l', 'url_c', 'url_z', 'url_m', 'url_n', 'url_q', 'url_s', 'url_t', 'url_sq'];
export const SUCCESS_STATUSES = new Set(['uploaded', 'duplicate', 'metadata-synced', 'skipped-unchanged']);

export function selectorFingerprint(selectorSpec) {
  return createHash('sha1').update(JSON.stringify(selectorSpec)).digest('hex').slice(0, 16);
}

