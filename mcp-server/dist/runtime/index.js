import { aiHandlers } from './ai/handlers.js';
import { aiTools } from './ai/tools.js';
import { discoveryHandlers } from './discovery/handlers.js';
import { discoveryTools } from './discovery/tools.js';
import { organizationHandlers } from './organization/handlers.js';
import { organizationTools } from './organization/tools.js';
import { systemHandlers } from './system/handlers.js';
import { systemTools } from './system/tools.js';
import { uploadHandlers } from './upload/handlers.js';
import { uploadTools } from './upload/tools.js';
const LIST_TOOLS_TOOL = {
    name: 'list_tools',
    description: 'Return tool definitions for this MCP server.',
    inputSchema: {
        type: 'object',
        properties: {},
    },
};
const runtimeModules = [
    { tools: discoveryTools, handlers: discoveryHandlers },
    { tools: organizationTools, handlers: organizationHandlers },
    { tools: uploadTools, handlers: uploadHandlers },
    { tools: aiTools, handlers: aiHandlers },
    { tools: systemTools, handlers: systemHandlers },
];
export const RUNTIME_TOOLS = [
    LIST_TOOLS_TOOL,
    ...runtimeModules.flatMap((runtimeModule) => runtimeModule.tools),
];
function buildHandlerMap(modules) {
    const handlers = new Map();
    handlers.set('list_tools', async () => ({
        content: [
            {
                type: 'text',
                text: JSON.stringify({ tools: RUNTIME_TOOLS }, null, 2),
            },
        ],
    }));
    const toolNames = new Set();
    for (const tool of RUNTIME_TOOLS) {
        if (toolNames.has(tool.name)) {
            throw new Error(`Duplicate runtime tool definition: ${tool.name}`);
        }
        toolNames.add(tool.name);
    }
    for (const runtimeModule of modules) {
        for (const [name, handler] of Object.entries(runtimeModule.handlers)) {
            if (handlers.has(name)) {
                throw new Error(`Duplicate runtime tool handler: ${name}`);
            }
            handlers.set(name, handler);
        }
    }
    for (const tool of RUNTIME_TOOLS) {
        if (!handlers.has(tool.name)) {
            throw new Error(`Missing runtime tool handler: ${tool.name}`);
        }
    }
    for (const name of handlers.keys()) {
        if (!toolNames.has(name)) {
            throw new Error(`Runtime handler has no tool definition: ${name}`);
        }
    }
    return handlers;
}
export const RUNTIME_TOOL_HANDLERS = buildHandlerMap(runtimeModules);
export async function handleRuntimeToolCall(name, args = {}) {
    try {
        const handler = RUNTIME_TOOL_HANDLERS.get(name);
        if (!handler) {
            return {
                content: [{ type: 'text', text: `Unknown tool: ${name}` }],
                isError: true,
            };
        }
        return await handler(args);
    }
    catch (error) {
        return {
            content: [
                {
                    type: 'text',
                    text: `Error: ${error instanceof Error ? error.message : String(error)}`,
                },
            ],
            isError: true,
        };
    }
}
