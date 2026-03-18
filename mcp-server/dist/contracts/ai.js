import { createLegacyToolContract } from './legacy-support.js';
const AI_TOOL_NAMES = [
    'photarium_generate_alt',
    'photarium_generate_description',
    'photarium_generate_prompt',
    'photarium_prompt_get',
    'photarium_prompts_bulk',
    'photarium_concepts',
    'photarium_haiku',
];
export const aiContracts = AI_TOOL_NAMES.map(createLegacyToolContract);
