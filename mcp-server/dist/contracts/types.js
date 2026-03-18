export class ToolValidationError extends Error {
    issues;
    constructor(message, issues) {
        super(message);
        this.issues = issues;
        this.name = 'ToolValidationError';
    }
}
export class ToolContractError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ToolContractError';
    }
}
export class ToolNotFoundError extends Error {
    toolName;
    constructor(toolName) {
        super(`Unknown tool: ${toolName}`);
        this.toolName = toolName;
        this.name = 'ToolNotFoundError';
    }
}
