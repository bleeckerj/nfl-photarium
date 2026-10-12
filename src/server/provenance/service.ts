import sharp from 'sharp';
import type { ProvenanceBinding, ProvenanceSave } from '@/types/generationProvenance';
import { downloadSourceImage } from '@/server/image-tools/sourceDownloader';
import { saveReceiptBinding, validateImageId } from './storage';
import { ProvenanceError, receiptText, selectReceiptOutput, sha256, validateReceipt } from './validation';

export async function attachReceipt(options: {
  imageId: string;
  receipt: unknown;
  sourceImageIds?: string[];
  uploadSource?: Buffer;
  persistedHash?: string;
}): Promise<ProvenanceBinding> {
  validateImageId(options.imageId);
  const receipt = validateReceipt(options.receipt);
  const sourceImageIds = [...new Set([...(options.sourceImageIds ?? []), ...receipt.sourceImageIds])];
  if (sourceImageIds.length > 16) throw new ProvenanceError('Too many source image IDs');
  sourceImageIds.forEach(validateImageId);
  const original = options.uploadSource ?? (await downloadSourceImage(options.imageId, { requireOriginal: true })).buffer;
  const persistedHash = options.persistedHash ?? (options.uploadSource
    ? sha256((await downloadSourceImage(options.imageId, { requireOriginal: true })).buffer)
    : sha256(original));
  if (!/^[a-f0-9]{64}$/.test(persistedHash)) throw new ProvenanceError('Invalid persisted image hash');
  const outputIndex = selectReceiptOutput(receipt, original);
  const metadata = await sharp(original).metadata();
  const output = receipt.outputs[outputIndex];
  if (metadata.width !== output.dimensions[0] || metadata.height !== output.dimensions[1]) {
    throw new ProvenanceError('Receipt dimensions conflict with original image', 409);
  }
  const binding: ProvenanceBinding = {
    imageId: options.imageId, receiptId: receipt.receiptId, provider: receipt.provider,
    model: receipt.model, createdAt: receipt.createdAt, requestId: receipt.requestId,
    requestedQuality: receiptText(receipt.request.quality), requestedSize: receiptText(receipt.request.size),
    returnedQuality: receiptText(receipt.response.quality), returnedSize: receiptText(receipt.response.size),
    outputIndex, generatedSha256: output.sha256, persistedSha256: persistedHash,
    verification: options.uploadSource ? 'upload-source-matched' : 'original-matched',
    sourceImageIds, attachedAt: new Date().toISOString(),
  };
  return saveReceiptBinding(receipt.json, binding);
}

export async function saveUploadReceipt(options: Parameters<typeof attachReceipt>[0]): Promise<ProvenanceSave> {
  try {
    const binding = await attachReceipt(options);
    return { requested: true, saved: true, verified: true, imageId: options.imageId, receiptId: binding.receiptId };
  } catch {
    // Keep the successful upload available for idempotent attachment recovery.
    return { requested: true, saved: false, imageId: options.imageId, error: 'Receipt persistence failed; retry provenance attachment' };
  }
}
