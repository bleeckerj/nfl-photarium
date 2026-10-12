import { getCachedImage } from '@/server/cloudflareImageCache';
import { saveUploadReceipt } from './service';
import { ProvenanceError, selectReceiptOutput, validateReceipt } from './validation';

export function parseUploadReceipt(form: FormData) {
  const field = form.get('provenanceReceipt');
  const generated = form.get('generated') === 'true';
  if (!field && generated) throw new ProvenanceError('Generated image uploads require a provenance receipt');
  if (!field) return undefined;
  if (typeof field !== 'string') throw new ProvenanceError('provenanceReceipt must be JSON text');
  return validateReceipt(field);
}

export async function persistUploadedReceipt(imageId: string, receiptJson: string, uploadSource: Buffer, sourceImageIds?: string[]) {
  // A cache outage must not hide an already uploaded image; verify stored bytes directly instead.
  const image = await getCachedImage(imageId).catch(() => undefined);
  return saveUploadReceipt({ imageId, receipt: receiptJson, uploadSource, persistedHash: image?.contentHash, sourceImageIds });
}

export function verifyUploadReceipt(form: FormData, bytes: Buffer) {
  const receipt = parseUploadReceipt(form);
  if (receipt) selectReceiptOutput(receipt, bytes);
  return receipt;
}
