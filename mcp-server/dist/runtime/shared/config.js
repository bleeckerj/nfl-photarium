import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const BASE_URL = process.env.PHOTARIUM_BASE_URL || 'http://localhost:3000';
const THIS_FILE_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(THIS_FILE_DIR, '..', '..', '..');
export const JSON_REQUEST_HEADERS = {
    'Content-Type': 'application/json',
    'x-photarium-source': 'mcp',
    'x-photarium-component': 'photarium-mcp-server',
    'x-photarium-trigger': 'mcp',
};
export const RAW_REQUEST_HEADERS = {
    'x-photarium-source': 'mcp',
    'x-photarium-component': 'photarium-mcp-server',
    'x-photarium-trigger': 'mcp',
};
