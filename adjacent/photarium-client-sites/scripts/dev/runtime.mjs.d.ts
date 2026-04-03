export function buildOrigin(port: number): string;
export function ensureRuntimeDirectory(): Promise<void>;
export function readRuntimeState(): Promise<{
  pid: number;
  port: number;
  origin: string;
  healthUrl: string;
  startedAt: string;
  logPath: string;
} | null>;
export function writeRuntimeState(state: unknown): Promise<void>;
export function clearRuntimeState(): Promise<void>;
export function isProcessAlive(pid: number | undefined | null): boolean;
export function wait(milliseconds: number): Promise<void>;
export function checkHealth(origin: string): Promise<boolean>;
export function waitForHealthyOrigin(
  origin: string,
  options?: { timeoutMs?: number; intervalMs?: number }
): Promise<void>;
export function findAvailablePort(startingPort: number, host?: string): Promise<number>;
export function getWranglerExecutable(): string;
export function runForegroundCommand(
  command: string,
  args: string[],
  options?: Record<string, unknown>
): Promise<void>;
export function getHealthyRuntimeState(): Promise<{
  pid: number;
  port: number;
  origin: string;
  healthUrl: string;
  startedAt: string;
  logPath: string;
} | null>;
export function spawnManagedWorker(port: number): Promise<{
  pid: number;
  port: number;
  origin: string;
  healthUrl: string;
  startedAt: string;
  logPath: string;
}>;
export function stopManagedWorkerProcess(state: {
  pid?: number;
} | null): Promise<{
  stopped: boolean;
  stale: boolean;
  forced?: boolean;
}>;
