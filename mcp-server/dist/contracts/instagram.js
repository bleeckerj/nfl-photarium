import { createRuntimeToolContract } from './runtime-support.js';
const INSTAGRAM_TOOL_NAMES = [
    'photarium_instagram_auth',
    'photarium_instagram_ingest_profile',
    'photarium_instagram_ingest_single_url',
    'photarium_instagram_replay_videos',
    'photarium_instagram_recover_videos',
];
export const instagramContracts = INSTAGRAM_TOOL_NAMES.map(createRuntimeToolContract);
