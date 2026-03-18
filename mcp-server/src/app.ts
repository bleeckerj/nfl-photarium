import { allToolContracts } from './contracts/index.js';
import { buildStartupDiagnostics } from './diagnostics.js';
import { ToolExecutor } from './core/executor.js';
import { ToolRegistry } from './core/registry.js';
import { createLogger } from './logging.js';

export function createPhotariumMcpApp(startedAt = new Date().toISOString()) {
  const logger = createLogger();
  const registry = new ToolRegistry(allToolContracts);
  const executor = new ToolExecutor(registry, logger);
  const startup = buildStartupDiagnostics(registry, logger, startedAt);

  return {
    logger,
    registry,
    executor,
    startup,
    startedAt,
  };
}
