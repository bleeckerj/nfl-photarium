import { handleRuntimeToolCall, RUNTIME_TOOLS } from '../runtime/index.js';
const RUNTIME_TOOL_MAP = new Map(RUNTIME_TOOLS.map((tool) => [tool.name, tool]));
function getAcceptedKeys(tool) {
    const schema = tool.inputSchema;
    return Object.keys(schema?.properties ?? {});
}
function normalizeSchema(schema) {
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
        return schema;
    }
    const record = schema;
    const normalized = { ...record };
    if (record.type === 'object') {
        normalized.additionalProperties = record.additionalProperties === true;
        if (record.properties && typeof record.properties === 'object' && !Array.isArray(record.properties)) {
            normalized.properties = Object.fromEntries(Object.entries(record.properties).map(([key, value]) => [key, normalizeSchema(value)]));
        }
    }
    if (record.type === 'array' && record.items) {
        normalized.items = normalizeSchema(record.items);
    }
    return normalized;
}
export function createRuntimeToolContract(name) {
    const tool = RUNTIME_TOOL_MAP.get(name);
    if (!tool) {
        throw new Error(`Runtime tool definition not found: ${name}`);
    }
    return {
        name: tool.name,
        description: tool.description ?? '',
        inputSchema: normalizeSchema(tool.inputSchema),
        acceptedKeys: getAcceptedKeys(tool),
        handler: async (args) => {
            const result = await handleRuntimeToolCall(name, args);
            return {
                content: result.content.map((entry) => ({
                    type: 'text',
                    text: entry.text,
                })),
                ...(result.isError ? { isError: true } : {}),
            };
        },
    };
}
