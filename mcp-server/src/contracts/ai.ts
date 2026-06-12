import { createRuntimeToolContract } from './runtime-support.js';

const AI_TOOL_NAMES = [
  'photarium_generate_alt',
  'photarium_generate_description',
  'photarium_generate_prompt',
  'photarium_generate_image',
  'photarium_generate_from_references',
  'photarium_semantic_merge',
  'photarium_prompt_get',
  'photarium_prompts_bulk',
  'photarium_concepts',
  'photarium_haiku',
] as const;

export const aiContracts = AI_TOOL_NAMES.map(createRuntimeToolContract);
