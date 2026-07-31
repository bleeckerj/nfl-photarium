import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ConnectionConfig, UploaderConfig } from './types.js';

export interface CliOptions {
  configPath: string;
  watchPath?: string;
  namespace?: string;
  stateFile?: string;
  mode?: 'http' | 'mcp';
  baseUrl?: string;
  mcpCommand?: string;
  mcpArgs?: string[];
  mcpCwd?: string;
  tagCount?: number;
  concurrency?: number;
  once: boolean;
  dryRun: boolean;
  help: boolean;
}

const DEFAULT_CONFIG_PATH = './photarium-folder-uploader.json';

function expandHome(input: string): string {
  if (input === '~') return os.homedir();
  if (input.startsWith('~/')) return path.join(os.homedir(), input.slice(2));
  return input;
}

function positiveNumber(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeExtensions(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    return ['.avif', '.gif', '.heic', '.jpeg', '.jpg', '.png', '.tif', '.tiff', '.webp'];
  }
  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => (item.startsWith('.') ? item : `.${item}`).toLowerCase())
        .filter(Boolean),
    ),
  );
}

function resolveConfiguredPath(value: string, configPath: string): string {
  const expanded = expandHome(value);
  return path.isAbsolute(expanded) ? expanded : path.resolve(path.dirname(configPath), expanded);
}

function parseConnection(raw: unknown): ConnectionConfig {
  if (!raw || typeof raw !== 'object') {
    return { mode: 'http', baseUrl: 'http://localhost:3000' };
  }
  const record = raw as Record<string, unknown>;
  if (record.mode === 'mcp') {
    const command = typeof record.command === 'string' && record.command.trim()
      ? record.command.trim()
      : 'node';
    const args = Array.isArray(record.args)
      ? record.args.filter((item): item is string => typeof item === 'string')
      : [];
    const env = record.env && typeof record.env === 'object'
      ? Object.fromEntries(
          Object.entries(record.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
        )
      : undefined;
    return {
      mode: 'mcp',
      command,
      ...(args.length > 0 ? { args } : {}),
      ...(typeof record.cwd === 'string' ? { cwd: expandHome(record.cwd) } : {}),
      ...(env ? { env } : {}),
    };
  }
  const baseUrl = typeof record.baseUrl === 'string' && record.baseUrl.trim()
    ? record.baseUrl.trim().replace(/\/+$/, '')
    : 'http://localhost:3000';
  return { mode: 'http', baseUrl };
}

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    configPath: DEFAULT_CONFIG_PATH,
    once: false,
    dryRun: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    const requireValue = () => {
      if (!next || next.startsWith('--')) throw new Error(`Missing value for ${arg}`);
      index += 1;
      return next;
    };
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--config') options.configPath = path.resolve(expandHome(requireValue()));
    else if (arg === '--watch') options.watchPath = requireValue();
    else if (arg === '--namespace') options.namespace = requireValue();
    else if (arg === '--state-file') options.stateFile = requireValue();
    else if (arg === '--mode') {
      const value = requireValue();
      if (value !== 'http' && value !== 'mcp') throw new Error(`Invalid --mode: ${value}`);
      options.mode = value;
    } else if (arg === '--base-url') options.baseUrl = requireValue();
    else if (arg === '--mcp-command') options.mcpCommand = requireValue();
    else if (arg === '--mcp-arg') (options.mcpArgs ??= []).push(requireValue());
    else if (arg === '--mcp-cwd') options.mcpCwd = requireValue();
    else if (arg === '--tag-count') options.tagCount = positiveNumber(requireValue(), 8);
    else if (arg === '--concurrency') options.concurrency = positiveNumber(requireValue(), 1);
    else if (arg === '--once') options.once = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

export async function loadConfig(options: CliOptions): Promise<UploaderConfig> {
  const configPath = path.resolve(expandHome(options.configPath));
  let raw: Record<string, unknown> = {};
  try {
    raw = JSON.parse(await fs.readFile(configPath, 'utf8')) as Record<string, unknown>;
  } catch (error) {
    if (!options.watchPath || !options.namespace) {
      throw new Error(`Could not read config ${configPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const connection = parseConnection(raw.connection);
  const overriddenConnection: ConnectionConfig = options.mode === 'mcp' || (options.mcpCommand && connection.mode === 'mcp')
    ? {
        mode: 'mcp',
        command: options.mcpCommand ?? (connection.mode === 'mcp' ? connection.command : 'node'),
        args: options.mcpArgs ?? (connection.mode === 'mcp' ? connection.args : undefined),
        cwd: options.mcpCwd ?? (connection.mode === 'mcp' ? connection.cwd : undefined),
        env: connection.mode === 'mcp' ? connection.env : undefined,
      }
    : {
        mode: 'http',
        baseUrl: options.baseUrl ?? (connection.mode === 'http' ? connection.baseUrl : 'http://localhost:3000'),
      };

  const watchPath = options.watchPath ?? (typeof raw.watchPath === 'string' ? raw.watchPath : '');
  const namespace = options.namespace ?? (typeof raw.namespace === 'string' ? raw.namespace : '');
  if (!watchPath.trim()) throw new Error('A watchPath is required.');
  if (!namespace.trim()) throw new Error('A namespace is required.');

  const stateValue = options.stateFile ?? (typeof raw.stateFile === 'string'
    ? raw.stateFile
    : path.join(os.homedir(), '.photarium-folder-uploader', 'state.json'));
  const stability = raw.stability && typeof raw.stability === 'object' ? raw.stability as Record<string, unknown> : {};
  const retry = raw.retry && typeof raw.retry === 'object' ? raw.retry as Record<string, unknown> : {};

  return {
    watchPath: resolveConfiguredPath(watchPath, configPath),
    namespace: namespace.trim(),
    stateFile: resolveConfiguredPath(stateValue, configPath),
    connection: overriddenConnection,
    extensions: normalizeExtensions(raw.extensions),
    tagCount: options.tagCount ?? positiveNumber(raw.tagCount, 8),
    stability: {
      pollMs: positiveNumber(stability.pollMs, 500),
      checks: Math.max(2, Math.floor(positiveNumber(stability.checks, 2))),
    },
    retry: {
      maxAttempts: Math.max(1, Math.floor(positiveNumber(retry.maxAttempts, 3))),
      delayMs: positiveNumber(retry.delayMs, 5000),
    },
    concurrency: Math.max(1, Math.floor(options.concurrency ?? positiveNumber(raw.concurrency, 1))),
  };
}

export function usage(): string {
  return `Photarium Folder Uploader

Usage:
  photarium-folder-uploader --config ./photarium-folder-uploader.json

Options:
  --config <path>       JSON config file
  --watch <path>        Override the watched folder
  --namespace <name>    Override the Photarium namespace
  --state-file <path>  Override the checkpoint file
  --mode <http|mcp>    Select the Photarium adapter
  --base-url <url>     Override the HTTP Photarium base URL
  --mcp-command <cmd>  Override the MCP server command
  --mcp-arg <value>    Add an MCP server argument; repeatable
  --mcp-cwd <path>     Override the MCP server working directory
  --tag-count <n>      Number of generated semantic tags
  --concurrency <n>   Maximum simultaneous image workflows
  --once               Process current files and exit
  --dry-run            Report eligible files without uploading
  --help               Show this help
`;
}
