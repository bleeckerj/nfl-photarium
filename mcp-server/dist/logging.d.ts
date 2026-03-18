export type LogLevel = 'error' | 'info' | 'debug' | 'trace';
export interface Logger {
    level: LogLevel;
    error(message: string, data?: Record<string, unknown>): void;
    info(message: string, data?: Record<string, unknown>): void;
    debug(message: string, data?: Record<string, unknown>): void;
    trace(message: string, data?: Record<string, unknown>): void;
}
export declare function createLogger(levelOverride?: string): Logger;
