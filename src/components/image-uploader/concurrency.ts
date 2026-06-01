export const runWithConcurrency = async <T,>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
): Promise<void> => {
  const safeConcurrency = Math.max(1, Math.floor(concurrency));
  let index = 0;

  const runners = Array.from({ length: Math.min(safeConcurrency, items.length) }, async () => {
    while (true) {
      const current = index;
      index += 1;
      if (current >= items.length) return;
      await worker(items[current]);
    }
  });

  await Promise.all(runners);
};
