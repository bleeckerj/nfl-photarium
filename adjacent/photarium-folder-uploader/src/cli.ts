import { parseArgs, loadConfig, usage } from './config.js';
import { HttpPhotariumClient } from './http-client.js';
import { McpPhotariumClient } from './mcp-client.js';
import { FolderWatcher } from './watcher.js';
import type { PhotariumClient } from './types.js';

function createClient(config: Awaited<ReturnType<typeof loadConfig>>): PhotariumClient {
  return config.connection.mode === 'http'
    ? new HttpPhotariumClient(config.connection.baseUrl)
    : new McpPhotariumClient(config.connection);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  const config = await loadConfig(options);
  const client = createClient(config);
  const watcher = new FolderWatcher(config, client, { dryRun: options.dryRun });
  const shutdown = async () => {
    await watcher.stop();
  };
  process.once('SIGINT', () => void shutdown().finally(() => process.exit(0)));
  process.once('SIGTERM', () => void shutdown().finally(() => process.exit(0)));
  await watcher.start();
  if (options.once || options.dryRun) {
    await watcher.stop();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
