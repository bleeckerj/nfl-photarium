import {
  findAvailablePort,
  getHealthyRuntimeState,
  spawnManagedWorker,
} from './runtime.mjs';
import { preferredPort } from './paths.mjs';

export const ensureManagedWorker = async () => {
  const healthyState = await getHealthyRuntimeState();
  if (healthyState) {
    return { state: healthyState, reused: true };
  }

  const selectedPort = await findAvailablePort(preferredPort);
  const state = await spawnManagedWorker(selectedPort);
  return { state, reused: false };
};

