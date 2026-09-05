import type { GenerationProvider, SourceRelationship } from '@/server/creativeBrief';

type CreativeBriefMcpInput = {
  imageId: string;
  prompt: string;
  sourceRelationship?: string;
  aspectRatio?: string;
  provider: GenerationProvider;
  outputFormat?: string;
};

type CreativeBriefMcpPayload = {
  result?: {
    content?: Array<{ type?: string; text?: string }>;
  };
  error?: string;
};

export const DEFAULT_PHOTARIUM_MCP_URL = 'http://127.0.0.1:8787';
const CREATIVE_BRIEF_TOOL = 'photarium_generate_from_creative_brief';

export function resolvePhotariumMcpBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (env.PHOTARIUM_MCP_URL || DEFAULT_PHOTARIUM_MCP_URL).replace(/\/+$/, '');
}

const BRIDGE_START_HINTS = [
  'Start it with `npm run dev` (which launches the bridge alongside Photarium) or `./run_photarium_mcp_server.sh start` from the repo root.',
  'Check it with `./run_photarium_mcp_server.sh status`.',
  'If the bridge runs on another host or port, set PHOTARIUM_MCP_URL to match (defaults to 127.0.0.1:8787, which follows PHOTARIUM_HTTP_PORT in the run script).',
];

function describeNetworkCause(error: unknown): { code?: string; detail: string } {
  const cause = error instanceof Error && error.cause && typeof error.cause === 'object' ? (error.cause as { code?: unknown; message?: unknown }) : undefined;
  const code = typeof cause?.code === 'string' ? cause.code : undefined;
  const causeMessage = typeof cause?.message === 'string' ? cause.message : undefined;
  const topMessage = error instanceof Error ? error.message : String(error);
  const detail = causeMessage && causeMessage !== topMessage ? `${topMessage}: ${causeMessage}` : topMessage;
  return { code, detail };
}

/**
 * Turn Node's opaque "fetch failed" into a message that says which service is missing and how to bring it back.
 */
export function describeMcpConnectionFailure(error: unknown, baseUrl: string): string {
  const { code, detail } = describeNetworkCause(error);
  const where = `Photarium MCP bridge at ${baseUrl}`;
  let headline: string;
  switch (code) {
    case 'ECONNREFUSED':
      headline = `${where} is not running (connection refused).`;
      break;
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      headline = `${where} could not be resolved (${code}); the hostname in PHOTARIUM_MCP_URL looks wrong.`;
      break;
    case 'ETIMEDOUT':
    case 'UND_ERR_CONNECT_TIMEOUT':
    case 'UND_ERR_HEADERS_TIMEOUT':
      headline = `${where} did not answer in time (${code}); it may be hung or blocked by a firewall.`;
      break;
    case 'ECONNRESET':
    case 'UND_ERR_SOCKET':
      headline = `${where} dropped the connection (${code}); it may have crashed mid-request. Check its terminal output.`;
      break;
    default:
      headline = `${where} is unreachable (${detail}).`;
  }
  return [headline, ...BRIDGE_START_HINTS].join(' ');
}

function describeHttpFailure(status: number, payload: CreativeBriefMcpPayload, baseUrl: string): string {
  if (typeof payload.error === 'string' && payload.error.trim()) {
    return `Photarium MCP bridge rejected the creative-brief run (${status}): ${payload.error}`;
  }
  if (status === 404 || status === 405) {
    return [
      `Photarium MCP bridge at ${baseUrl} answered ${status} for /tools/${CREATIVE_BRIEF_TOOL}, so something else is on that port or the bridge build is stale.`,
      'Confirm the listener with `./run_photarium_mcp_server.sh status`, rebuild with `npm run build` inside mcp-server/, then restart it.',
    ].join(' ');
  }
  if (status >= 500) {
    return `Photarium MCP bridge at ${baseUrl} failed while generating (${status}). Check the bridge terminal for the underlying provider error (OPENAI_API_KEY, quota, or Photarium upload failures are the usual causes).`;
  }
  return `Photarium MCP generation failed (${status})`;
}

function readMcpResult(payload: CreativeBriefMcpPayload): Record<string, unknown> {
  const text = payload.result?.content?.find((content) => content.type === 'text' && typeof content.text === 'string')?.text;
  if (!text) throw new Error(payload.error || 'Photarium MCP returned no generation result');
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Photarium MCP returned an invalid generation result');
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new Error(`Photarium MCP generation result was not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function generateCreativeBriefThroughMcp(
  input: CreativeBriefMcpInput,
  fetchImpl: typeof fetch = fetch,
): Promise<Record<string, unknown>> {
  const baseUrl = resolvePhotariumMcpBaseUrl();
  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl}/tools/${CREATIVE_BRIEF_TOOL}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageId: input.imageId,
        prompt: input.prompt,
        sourceRelationship: input.sourceRelationship as SourceRelationship | undefined,
        aspectRatio: input.aspectRatio,
        provider: input.provider,
        outputFormat: input.outputFormat,
      }),
    });
  } catch (error) {
    throw new Error(describeMcpConnectionFailure(error, baseUrl), { cause: error });
  }
  const payload = await response.json().catch(() => ({})) as CreativeBriefMcpPayload;
  if (!response.ok) throw new Error(describeHttpFailure(response.status, payload, baseUrl));
  return readMcpResult(payload);
}
