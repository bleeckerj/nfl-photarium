import { runSemanticTagWorker } from '@/server/semanticTagQueue';

const controller = new AbortController();
const stop = () => controller.abort();
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

console.log('[semantic-tags-worker] started; waiting for durable jobs');

runSemanticTagWorker({ signal: controller.signal })
  .then(() => console.log('[semantic-tags-worker] stopped'))
  .catch((error: unknown) => {
    console.error('[semantic-tags-worker] failed', error);
    process.exitCode = 1;
  });
