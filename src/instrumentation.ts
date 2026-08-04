type PhotariumRuntimeState = typeof globalThis & {
  __photariumSemanticTagWorker?: Promise<void>;
};

const runtimeState = globalThis as PhotariumRuntimeState;

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') {
    return;
  }

  const { installLocalTimestampConsole } = await import('@/server/localTimestampConsole.node');
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

  const { runSemanticTagWorker } = await import('@/server/semanticTagQueue');
  runtimeState.__photariumSemanticTagWorker = runSemanticTagWorker().catch((error: unknown) => {
    console.error('[semanticTagQueue] In-process worker stopped unexpectedly', error);
  });
}
