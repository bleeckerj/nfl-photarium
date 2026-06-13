import { getImageToolPreview, getImageToolRun, listImageTools, startImageToolPreview, startImageToolRun, } from './client.js';
function renderJson(result) {
    return {
        content: [
            {
                type: 'text',
                text: JSON.stringify(result, null, 2),
            },
        ],
    };
}
export const imageToolHandlers = {
    'photarium_image_tools_list': async () => {
        const result = await listImageTools();
        return renderJson(result);
    },
    'photarium_image_tool_run': async (args) => {
        const { toolId, imageId, request } = args;
        const result = await startImageToolRun({ toolId, imageId, request });
        return renderJson(result);
    },
    'photarium_image_tool_preview': async (args) => {
        const { toolId, imageId, request } = args;
        const result = await startImageToolPreview({ toolId, imageId, request });
        return renderJson(result);
    },
    'photarium_image_tool_run_get': async (args) => {
        const { runId } = args;
        const result = await getImageToolRun(runId);
        return renderJson(result);
    },
    'photarium_image_tool_preview_get': async (args) => {
        const { previewId } = args;
        const result = await getImageToolPreview(previewId);
        return renderJson(result);
    },
};
