import { readRuntimeState, stopManagedWorkerProcess } from './runtime.mjs';

const main = async () => {
  const state = await readRuntimeState();
  if (!state) {
    console.log('No managed local worker is recorded.');
    return;
  }

  const result = await stopManagedWorkerProcess(state);
  if (result.stale) {
    console.log('Removed stale local worker metadata.');
    return;
  }

  if (result.blocked) {
    console.log(
      `Unable to stop the local worker from this environment (${result.errorCode ?? 'unknown'}).`
    );
    console.log(`Recorded origin: ${state.origin}`);
    console.log(`Recorded PID: ${state.pid}`);
    return;
  }

  console.log(result.forced ? 'Stopped local worker (forced).' : 'Stopped local worker.');
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
