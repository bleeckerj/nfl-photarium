import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const provenanceTools: Tool[] = [
  {
    name: 'photarium_provenance_attach',
    description: 'Attach and verify a generation provenance receipt against the original bytes of an existing image; idempotent and non-destructive.',
    inputSchema: {
      type: 'object', properties: {
        imageId: { type: 'string' },
        provenanceReceiptPath: { type: 'string', description: 'Absolute path to receipt JSON on the MCP host.' },
        provenanceReceipt: { type: 'string', description: 'Receipt JSON instead of a path.' },
        sourceImageIds: { type: 'array', items: { type: 'string' } },
      }, required: ['imageId'],
    },
  },
  {
    name: 'photarium_provenance_list',
    description: 'List retained generation provenance summaries for a Photarium image.',
    inputSchema: { type: 'object', properties: { imageId: { type: 'string' } }, required: ['imageId'] },
  },
  {
    name: 'photarium_provenance_get',
    description: 'Retrieve the exact retained generation provenance receipt JSON for an image and receipt ID.',
    inputSchema: { type: 'object', properties: { imageId: { type: 'string' }, receiptId: { type: 'string' } }, required: ['imageId', 'receiptId'] },
  },
];
