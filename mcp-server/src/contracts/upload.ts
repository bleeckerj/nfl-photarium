import { createLegacyToolContract } from './legacy-support.js';

const UPLOAD_TOOL_NAMES = [
  'photarium_upload_url',
  'photarium_import_url',
  'photarium_upload_file',
  'photarium_upload_image',
  'photarium_upload_external_file',
  'photarium_upload_from_path',
  'photarium_animate',
  'photarium_uploads_list',
  'photarium_upload_download',
  'photarium_fs_ingest',
  'photarium_discord_refresh_and_ingest',
  'photarium_instagram_ingest_single_url',
] as const;

export const uploadContracts = UPLOAD_TOOL_NAMES.map(createLegacyToolContract);
