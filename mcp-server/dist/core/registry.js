import { ToolContractError, ToolNotFoundError } from '../contracts/types.js';
export class ToolRegistry {
    contractMap = new Map();
    constructor(contracts) {
        for (const contract of contracts) {
            if (this.contractMap.has(contract.name)) {
                throw new ToolContractError(`Duplicate tool name: ${contract.name}`);
            }
            if (typeof contract.handler !== 'function') {
                throw new ToolContractError(`Missing handler for tool: ${contract.name}`);
            }
            const schema = contract.inputSchema;
            const requiredKeys = schema?.required ?? [];
            for (const key of requiredKeys) {
                if (!contract.acceptedKeys.includes(key)) {
                    throw new ToolContractError(`Tool ${contract.name} requires schema field "${key}" that is not declared in acceptedKeys`);
                }
            }
            this.contractMap.set(contract.name, contract);
        }
    }
    list() {
        return [...this.contractMap.values()];
    }
    listTools() {
        return this.list().map(({ name, description, inputSchema }) => ({
            name,
            description,
            inputSchema,
        }));
    }
    get(name) {
        const contract = this.contractMap.get(name);
        if (!contract) {
            throw new ToolNotFoundError(name);
        }
        return contract;
    }
}
