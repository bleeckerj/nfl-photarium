import type { RuntimeToolHandler } from '../types.js';
import {
  getImageToolPreview,
  getImageToolRun,
  listImageTools,
  startImageToolPreview,
  startImageToolRun,
  type ImageToolRunParams,
} from './client.js';

function renderJson(result: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(result, null, 2),
      },
    ],
  };
}

export const imageToolHandlers: Record<string, RuntimeToolHandler> = {
  'photarium_image_tools_list': async () => {
    const result = await listImageTools();
    return renderJson(result);
  },

  'photarium_image_tool_run': async (args: Record<string, unknown>) => {
    const { toolId, imageId, request } = args as ImageToolRunParams;
    const result = await startImageToolRun({ toolId, imageId, request });
    return renderJson(result);
  },

  'photarium_image_tool_preview': async (args: Record<string, unknown>) => {
    const { toolId, imageId, request } = args as ImageToolRunParams;
    const result = await startImageToolPreview({ toolId, imageId, request });
    return renderJson(result);
  },

  'photarium_image_tool_run_get': async (args: Record<string, unknown>) => {
    const { runId } = args as { runId: string };
    const result = await getImageToolRun(runId);
    return renderJson(result);
  },

  'photarium_image_tool_preview_get': async (args: Record<string, unknown>) => {
    const { previewId } = args as { previewId: string };
    const result = await getImageToolPreview(previewId);
    return renderJson(result);
  },
};
