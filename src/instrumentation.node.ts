import { installLocalTimestampConsole } from '@/server/localTimestampConsole.node';
import { runSemanticTagWorker } from '@/server/semanticTagQueue';

type PhotariumRuntimeState = typeof globalThis & {
  __photariumSemanticTagWorker?: Promise<void>;
};

const runtimeState = globalThis as PhotariumRuntimeState;

/**
 * Start Node-only application services after Next has selected the Node
 * runtime. Keeping this module behind the runtime dispatcher prevents Sharp
 * and other native dependencies from entering instrumentation's edge bundle.
 */
export async function registerNodeInstrumentation(): Promise<void> {
  installLocalTimestampConsole();

  // The web app owns the worker lifecycle. Redis remains the durable queue so
  // jobs survive an API restart, while normal Node deployments need no second
  // manually managed process for enrichment.
  if (
    process.env.NODE_ENV === 'test'
    || process.env.NEXT_PHASE === 'phase-production-build'
    || ['0', 'false', 'no', 'off'].includes(process.env.SEMANTIC_TAG_WORKER_ENABLED?.trim().toLowerCase() ?? '')
    || runtimeState.__photariumSemanticTagWorker
  ) {
    return;
  }

  runtimeState.__photariumSemanticTagWorker = runSemanticTagWorker().catch((error: unknown) => {
    console.error('[semanticTagQueue] In-process worker stopped unexpectedly', error);
  });
}
