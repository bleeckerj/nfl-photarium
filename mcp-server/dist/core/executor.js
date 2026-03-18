import { ToolValidationError } from '../contracts/types.js';
import { validateToolArgs } from './validator.js';
export class ToolExecutor {
    registry;
    logger;
    constructor(registry, logger) {
        this.registry = registry;
        this.logger = logger;
    }
    listTools() {
        return this.registry.listTools();
    }
    getTool(name) {
        return this.registry.get(name);
    }
    async invoke(name, rawArgs, context) {
        const contract = this.registry.get(name);
        this.logger.debug('tool.invoke', {
            tool: name,
            transport: context.transport,
        });
        const validatedArgs = validateToolArgs({
            name: contract.name,
            description: contract.description,
            inputSchema: contract.inputSchema,
        }, rawArgs);
        try {
            const result = await contract.handler(validatedArgs);
            this.logger.trace('tool.result', {
                tool: name,
                transport: context.transport,
                isError: result.isError === true,
            });
            return result;
        }
        catch (error) {
            if (error instanceof ToolValidationError) {
                throw error;
            }
            throw error;
        }
    }
}
