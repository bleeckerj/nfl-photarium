/**
 * Minimal structured logging with stable event names.
 */

export interface LogContext {
  [key: string]: unknown;
}

export const logInfo = (event: string, context: LogContext = {}): void => {
  console.log(JSON.stringify({ level: 'info', event, ...context }));
};

export const logError = (event: string, context: LogContext = {}): void => {
  console.error(JSON.stringify({ level: 'error', event, ...context }));
};

