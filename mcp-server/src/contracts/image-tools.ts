import { createRuntimeToolContract } from './runtime-support.js';

const IMAGE_TOOL_NAMES = [
  'photarium_image_tools_list',
  'photarium_image_tool_run',
  'photarium_image_tool_preview',
  'photarium_image_tool_run_get',
  'photarium_image_tool_preview_get',
] as const;

export const imageToolContracts = IMAGE_TOOL_NAMES.map(createRuntimeToolContract);
