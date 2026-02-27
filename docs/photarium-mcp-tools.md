# Photarium MCP Tools

## Discovery & Search
- `photarium_search`
- `photarium_search_text`
- `photarium_search_color`
- `photarium_similar`
- `photarium_antipode`
- `photarium_list`
- `photarium_get`

## Organization
- `photarium_list_folders`
- `photarium_create_folder`
- `photarium_list_namespaces`
- `photarium_update_metadata`
- `photarium_delete`

## Upload
- `photarium_upload_url`
- `photarium_upload_image`
- `photarium_fs_ingest` (recursive local image/video ingest by directory tree)
  - supports `throttleMs` to pace upload requests globally
  - automatically caches successful uploads locally and skips unchanged files on reruns

## AI Features
- `photarium_generate_alt`
- `photarium_generate_description`
- `photarium_generate_prompt`
- `photarium_concepts`

## System
- `photarium_vector_status`
- `photarium_generate_embeddings`
- `photarium_backup`
- `photarium_list_backups`

## Download
- `photarium_download_image`

## HTTP Help
- `GET /help` - list MCP HTTP proxy endpoints and discoverability hints
- `GET /help/<tool-name>` - show schema + HTTP call pattern for a specific tool (example: `/help/photarium_fs_ingest`)
