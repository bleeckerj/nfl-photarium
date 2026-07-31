import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { ConnectionConfig, PhotariumClient, PhotariumUploadResult } from './types.js';
import { assertToolSucceeded, extractImageId, extractJsonFromToolResult } from './photarium-client.js';

export interface McpSession {
  connect(transport: Transport): Promise<void>;
  listTools(): Promise<{ tools?: Array<{ name?: string }> }>;
  callTool(params: { name: string; arguments: Record<string, unknown> }): Promise<unknown>;
  close(): Promise<void>;
}

export type SessionFactory = (config: Extract<ConnectionConfig, { mode: 'mcp' }>) => {
  session: McpSession;
  transport: Transport;
};

function environmentWithOverrides(overrides?: Record<string, string>): Record<string, string> {
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
  return { ...inherited, ...overrides };
}

const defaultSessionFactory: SessionFactory = (config) => {
  const session = new Client({ name: 'photarium-folder-uploader', version: '0.1.0' });
  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args,
    cwd: config.cwd,
    env: environmentWithOverrides(config.env),
    stderr: 'inherit',
  });
  return { session, transport };
};

export class McpPhotariumClient implements PhotariumClient {
  private readonly config: Extract<ConnectionConfig, { mode: 'mcp' }>;
  private readonly sessionFactory: SessionFactory;
  private session?: McpSession;

  constructor(config: Extract<ConnectionConfig, { mode: 'mcp' }>, sessionFactory: SessionFactory = defaultSessionFactory) {
    this.config = config;
    this.sessionFactory = sessionFactory;
  }

  async connect(): Promise<void> {
    if (this.session) return;
    const created = this.sessionFactory(this.config);
    await created.session.connect(created.transport);
    const tools = await created.session.listTools();
    const available = new Set((tools.tools ?? []).map((tool) => tool.name).filter((name): name is string => Boolean(name)));
    const required = ['photarium_upload_from_path', 'photarium_generate_description', 'photarium_generate_tags'];
    const missing = required.filter((name) => !available.has(name));
    if (missing.length > 0) {
      await created.session.close().catch(() => undefined);
      throw new Error(`Photarium MCP server is missing required tools: ${missing.join(', ')}`);
    }
    this.session = created.session;
  }

  private get connectedSession(): McpSession {
    if (!this.session) throw new Error('Photarium MCP client is not connected.');
    return this.session;
  }

  async uploadFromPath(filePath: string, namespace: string): Promise<PhotariumUploadResult> {
    const result = await this.connectedSession.callTool({
      name: 'photarium_upload_from_path',
      arguments: { filePath, namespace },
    });
    assertToolSucceeded(result);
    return { imageId: extractImageId(result) };
  }

  async generateDescription(imageId: string): Promise<void> {
    const result = await this.connectedSession.callTool({
      name: 'photarium_generate_description',
      arguments: { imageId },
    });
    assertToolSucceeded(result);
    extractJsonFromToolResult(result);
  }

  async generateTags(imageId: string, count: number): Promise<void> {
    const result = await this.connectedSession.callTool({
      name: 'photarium_generate_tags',
      arguments: { imageId, count },
    });
    assertToolSucceeded(result);
    extractJsonFromToolResult(result);
  }

  async close(): Promise<void> {
    await this.session?.close();
    this.session = undefined;
  }
}
