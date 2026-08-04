import { createRuntimeToolContract } from './runtime-support.js';
const AI_TOOL_NAMES = [
    'photarium_generate_alt',
    'photarium_generate_description',
    'photarium_generate_tags',
    'photarium_generate_prompt',
    'photarium_prompt_history',
    'photarium_prepare_creative_brief_generation',
    'photarium_record_creative_brief_result',
    'photarium_generate_image',
    'photarium_generate_from_references',
    'photarium_generate_from_creative_brief',
    'photarium_aspect_ratio_variant',
    'photarium_semantic_merge',
    'photarium_prompt_get',
    'photarium_prompts_bulk',
    'photarium_concepts',
    'photarium_haiku',
];
export const aiContracts = AI_TOOL_NAMES.map(createRuntimeToolContract);
