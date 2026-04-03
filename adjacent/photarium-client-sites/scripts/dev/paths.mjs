import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));

export const projectRoot = path.resolve(scriptDirectory, '..', '..');
export const preferredPort = 8788;
export const runtimeDirectory = path.join(projectRoot, '.wrangler');
export const runtimeStatePath = path.join(runtimeDirectory, 'local-dev-runtime.json');
export const runtimeLogPath = path.join(runtimeDirectory, 'local-dev.log');

