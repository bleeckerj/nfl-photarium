import { createRuntimeToolContract } from './runtime-support.js';

const ORGANIZATION_TOOL_NAMES = [
  'photarium_list_folders',
  'photarium_create_folder',
  'photarium_list_namespaces',
  'photarium_update_metadata',
  'photarium_extras_get',
  'photarium_extras_update',
  'photarium_swap_parent',
  'photarium_delete_family',
  'photarium_delete_family_job',
  'photarium_share_url',
  'photarium_rotate',
  'photarium_delete',
] as const;

export const organizationContracts = ORGANIZATION_TOOL_NAMES.map(createRuntimeToolContract);
