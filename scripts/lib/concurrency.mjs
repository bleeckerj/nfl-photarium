export async function runWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }

  const workers = Array.from({ length: Math.max(1, concurrency) }, () => runWorker());
  await Promise.all(workers);
  return results;
}

export function createMinIntervalLimiter(minIntervalMs) {
  const interval = Math.max(0, Number(minIntervalMs) || 0);
  if (interval <= 0) {
    return async () => {};
  }

  let chain = Promise.resolve();
  let lastAt = 0;

  return async function waitTurn() {
    const next = chain.then(async () => {
      const now = Date.now();
      const waitMs = Math.max(0, lastAt + interval - now);
      if (waitMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
      lastAt = Date.now();
    });
    chain = next.catch(() => {});
    await next;
  };
}
