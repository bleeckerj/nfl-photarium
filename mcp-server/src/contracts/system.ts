import { createRuntimeToolContract } from './runtime-support.js';

const SYSTEM_TOOL_NAMES = [
  'photarium_vector_status',
  'photarium_vector_index',
  'photarium_generate_embeddings',
  'photarium_embedding_status',
  'photarium_embeddings_batch',
  'photarium_colors_bulk',
  'photarium_audit',
  'photarium_backup',
  'photarium_list_backups',
  'photarium_debug_raw',
] as const;

export const systemContracts = SYSTEM_TOOL_NAMES.map(createRuntimeToolContract);
