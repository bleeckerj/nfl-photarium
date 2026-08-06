import { createRuntimeToolContract } from './runtime-support.js';
const ARCHIVE_TOOL_NAMES = [
    'archive_catalog_status',
    'archive_list_catalogs',
    'archive_search',
    'archive_get_asset',
    'archive_get_preview',
    'archive_list_keywords',
    'archive_list_collections',
    'archive_save_annotation',
];
export const archiveContracts = ARCHIVE_TOOL_NAMES.map(createRuntimeToolContract);
