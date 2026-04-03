/**
 * Small response helpers for Worker route handlers.
 */

export const json = (payload: unknown, init?: ResponseInit): Response =>
  Response.json(payload, init);

export const jsonError = (
  status: number,
  message: string,
  details?: Record<string, unknown>
): Response =>
  json(
    {
      error: message,
      ...(details ? { details } : {}),
    },
    { status }
  );

