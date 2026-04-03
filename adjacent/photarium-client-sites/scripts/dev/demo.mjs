import { createLocalDemo } from './api.mjs';
import { ensureManagedWorker } from './start-managed-worker.mjs';
import { getHealthyRuntimeState, runForegroundCommand } from './runtime.mjs';

const main = async () => {
  let runtimeState = await getHealthyRuntimeState();

  if (!runtimeState) {
    await runForegroundCommand('npm', ['run', 'build:client']);
    ({ state: runtimeState } = await ensureManagedWorker());
  }

  const demo = await createLocalDemo(runtimeState.origin);
  console.log(JSON.stringify(demo, null, 2));
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

