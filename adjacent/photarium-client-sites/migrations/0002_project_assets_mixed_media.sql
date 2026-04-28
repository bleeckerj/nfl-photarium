ALTER TABLE project_assets ADD COLUMN asset_type TEXT NOT NULL DEFAULT 'image';
ALTER TABLE project_assets ADD COLUMN source_asset_id TEXT;
ALTER TABLE project_assets ADD COLUMN video_playback_url TEXT;
ALTER TABLE project_assets ADD COLUMN video_hls_url TEXT;
ALTER TABLE project_assets ADD COLUMN video_thumbnail_url TEXT;
ALTER TABLE project_assets ADD COLUMN video_preview_url TEXT;
ALTER TABLE project_assets ADD COLUMN video_download_url TEXT;
ALTER TABLE project_assets ADD COLUMN video_duration_seconds REAL;
ALTER TABLE project_assets ADD COLUMN file_size_bytes INTEGER;

UPDATE project_assets
SET source_asset_id = source_image_id
WHERE source_asset_id IS NULL;
