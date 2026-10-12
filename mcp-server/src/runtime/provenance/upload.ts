import { readFile, stat } from 'node:fs/promises';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export type ReceiptUploadOptions = {
  provenanceReceipt?: string;
  provenanceReceiptPath?: string;
  generated?: boolean;
};

export async function resolveReceiptUpload(args: Record<string, unknown> | ReceiptUploadOptions): Promise<ReceiptUploadOptions> {
  if (args.provenanceReceipt && args.provenanceReceiptPath) throw new Error('Use receipt JSON or a receipt path, not both');
  let receipt = typeof args.provenanceReceipt === 'string' ? args.provenanceReceipt : undefined;
  if (typeof args.provenanceReceiptPath === 'string') {
    if ((await stat(args.provenanceReceiptPath)).size > 1_000_000) throw new Error('Receipt exceeds 1 MB');
    receipt = await readFile(args.provenanceReceiptPath, 'utf8');
  }
  if (args.generated === true && !receipt) throw new Error('Generated image uploads require a provenance receipt');
  return { provenanceReceipt: receipt, generated: args.generated === true };
}

export function appendReceiptFields(form: FormData, options: ReceiptUploadOptions): void {
  if (options.provenanceReceipt) form.append('provenanceReceipt', options.provenanceReceipt);
  if (options.generated) form.append('generated', 'true');
}

export function augmentUploadTools(tools: Tool[]): Tool[] {
  const names = new Set(['photarium_upload_from_path', 'photarium_upload_file', 'photarium_upload_image', 'photarium_upload_external_file', 'photarium_upload_url']);
  return tools.map((tool) => names.has(tool.name) ? {
    ...tool,
    inputSchema: {
      ...tool.inputSchema,
      properties: {
        ...tool.inputSchema.properties,
        provenanceReceiptPath: { type: 'string', description: 'Absolute path to the generation provenance JSON receipt. Required for generated images unless receipt JSON is supplied.' },
        provenanceReceipt: { type: 'string', description: 'Generation provenance receipt JSON, as an alternative to a local receipt path.' },
        generated: { type: 'boolean', description: 'Set true for generated or edited images; requires receipt storage and verification.' },
      },
    },
  } : tool);
}
