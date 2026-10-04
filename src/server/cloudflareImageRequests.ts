type RequestState = {
  nextStartAt: number;
  cooldownUntil: number;
  turn: Promise<void>;
};

const REQUEST_INTERVAL_MS = 300;
const MAX_ATTEMPTS = 3;
const FALLBACK_RETRY_MS = 30_000;
const sleep = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds));

export class CloudflareImageRateLimitError extends Error {
  constructor(public readonly retryAfterSeconds: number) {
    super(`Cloudflare is throttling image updates. Retry in ${retryAfterSeconds} second${retryAfterSeconds === 1 ? '' : 's'}.`);
    this.name = 'CloudflareImageRateLimitError';
  }
}

const retryDelay = (headers: Headers, attempt: number) => {
  const fallback = FALLBACK_RETRY_MS * 2 ** attempt;
  const retryAfter = headers.get('retry-after');
  if (retryAfter?.trim()) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return seconds >= 0 ? Math.ceil(seconds * 1000) : fallback;
    const deadline = Date.parse(retryAfter);
    if (Number.isFinite(deadline)) return Math.max(0, deadline - Date.now());
  }
  return fallback;
};

export const createCloudflareImageRequester = (state: RequestState = {
  nextStartAt: 0,
  cooldownUntil: 0,
  turn: Promise.resolve(),
}) => {
  const waitForTurn = () => {
    const turn = state.turn.then(async () => {
      // Recheck after sleeping: another in-flight request can extend the shared cooldown.
      for (;;) {
        const delay = Math.max(state.nextStartAt, state.cooldownUntil) - Date.now();
        if (delay <= 0) break;
        await sleep(delay);
      }
      state.nextStartAt = Date.now() + REQUEST_INTERVAL_MS;
    });
    state.turn = turn.catch(() => undefined);
    return turn;
  };

  return async (url: string, init?: RequestInit): Promise<Response> => {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      await waitForTurn();
      const response = await fetch(url, init);
      if (response.status !== 429) return response;

      const delay = retryDelay(response.headers, attempt);
      state.cooldownUntil = Math.max(state.cooldownUntil, Date.now() + delay);
      await response.body?.cancel().catch(() => undefined);
      console.warn('[CloudflareMetadata] Rate limited; pausing image metadata requests', {
        attempt: attempt + 1,
        maxAttempts: MAX_ATTEMPTS,
        retryAfterSeconds: Math.ceil(delay / 1000),
      });
      if (attempt === MAX_ATTEMPTS - 1) {
        throw new CloudflareImageRateLimitError(Math.max(1, Math.ceil((state.cooldownUntil - Date.now()) / 1000)));
      }
    }
    throw new Error('Cloudflare image request did not complete');
  };
};

// Survive Next.js module reloads so concurrent routes share pacing and cooldowns.
const STATE_KEY = Symbol.for('photarium.cloudflareImageRequests');
const globalObject = globalThis as typeof globalThis & { [STATE_KEY]?: RequestState };
const state = globalObject[STATE_KEY] ??= {
  nextStartAt: 0,
  cooldownUntil: 0,
  turn: Promise.resolve(),
};

export const requestCloudflareImage = createCloudflareImageRequester(state);
