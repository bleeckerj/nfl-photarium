import { ensureManagedWorker } from './start-managed-worker.mjs';
import { runForegroundCommand } from './runtime.mjs';

const main = async () => {
  await runForegroundCommand('npm', ['run', 'build:client']);
  const { state, reused } = await ensureManagedWorker();

  console.log(reused ? 'Local dev worker already running.' : 'Local dev worker started.');
  console.log(`Root URL: ${state.origin}/`);
  console.log(`PID: ${state.pid}`);
  console.log('Stop command: npm run stop');
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

