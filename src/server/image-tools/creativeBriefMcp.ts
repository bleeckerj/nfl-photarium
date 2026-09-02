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

export async function generateCreativeBriefThroughMcp(input: CreativeBriefMcpInput): Promise<Record<string, unknown>> {
  const baseUrl = process.env.PHOTARIUM_MCP_URL || 'http://127.0.0.1:8787';
  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/tools/photarium_generate_from_creative_brief`, {
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
  const payload = await response.json().catch(() => ({})) as CreativeBriefMcpPayload;
  if (!response.ok) throw new Error(payload.error || `Photarium MCP generation failed (${response.status})`);
  return readMcpResult(payload);
}
