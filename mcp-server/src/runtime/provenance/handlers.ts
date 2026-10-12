import { apiRequest, apiRequestRaw } from '../shared/api-client.js';
import type { RuntimeToolHandler } from '../types.js';
import { resolveReceiptUpload } from './upload.js';

const imagePath = (id: unknown) => {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,150}$/.test(id)) throw new Error('Invalid image ID');
  return `/api/images/${encodeURIComponent(id)}/provenance`;
};
const result = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] });
export const provenanceHandlers: Record<string, RuntimeToolHandler> = {
  photarium_provenance_attach: async (args) => {
    const receipt = await resolveReceiptUpload(args);
    if (!receipt.provenanceReceipt) throw new Error('A provenance receipt is required');
    return result(await apiRequest(imagePath(args.imageId), {
      method: 'POST', body: JSON.stringify({ receipt: receipt.provenanceReceipt, sourceImageIds: args.sourceImageIds }),
    }));
  },
  photarium_provenance_list: async (args) => result(await apiRequest(imagePath(args.imageId))),
  photarium_provenance_get: async (args) => {
    if (typeof args.receiptId !== 'string') throw new Error('receiptId is required');
    const response = await apiRequestRaw(`${imagePath(args.imageId)}?receiptId=${encodeURIComponent(args.receiptId)}`);
    return { content: [{ type: 'text', text: await response.text() }] };
  },
};
