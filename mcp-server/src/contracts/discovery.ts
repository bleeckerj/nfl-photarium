import { createRuntimeToolContract } from './runtime-support.js';

const DISCOVERY_TOOL_NAMES = [
  'list_tools',
  'photarium_search',
  'photarium_search_text',
  'photarium_search_metadata',
  'photarium_search_color',
  'photarium_search_image',
  'photarium_similar',
  'photarium_antipode',
  'photarium_list',
  'photarium_get',
  'photarium_image_metadata',
  'photarium_download_image',
  'photarium_download_original',
  'photarium_extract_workflow',
] as const;

export const discoveryContracts = DISCOVERY_TOOL_NAMES.map(createRuntimeToolContract);
