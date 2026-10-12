import { NextResponse } from 'next/server';
import { requireProvenanceAccess } from './access';
import { attachReceipt } from './service';
import { getReceiptJson, listReceiptBindings } from './storage';
import { isRecord, MAX_RECEIPT_BYTES, ProvenanceError } from './validation';

const fail = (error: unknown) => NextResponse.json({
  error: error instanceof ProvenanceError ? error.message : 'Provenance operation failed',
}, { status: error instanceof ProvenanceError ? error.status : 500, headers: privateHeaders });
const privateHeaders = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };

export async function readProvenance(request: Request, imageId: string) {
  try {
    requireProvenanceAccess(request);
    const receiptId = new URL(request.url).searchParams.get('receiptId');
    if (receiptId) {
      const json = await getReceiptJson(imageId, receiptId);
      return new NextResponse(json, { headers: {
        ...privateHeaders, 'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${receiptId}.provenance.json"`,
      } });
    }
    return NextResponse.json({ imageId, receipts: await listReceiptBindings(imageId) }, { headers: privateHeaders });
  } catch (error) { return fail(error); }
}

export async function writeProvenance(request: Request, imageId: string) {
  try {
    requireProvenanceAccess(request);
    const bodyText = await request.text();
    if (Buffer.byteLength(bodyText) > MAX_RECEIPT_BYTES + 20_000) throw new ProvenanceError('Provenance request exceeds the limit', 413);
    let body: unknown;
    try { body = JSON.parse(bodyText); } catch { throw new ProvenanceError('Invalid JSON'); }
    if (!isRecord(body) || !('receipt' in body)) throw new ProvenanceError('receipt is required');
    const sources = body.sourceImageIds;
    if (sources !== undefined && (!Array.isArray(sources) || !sources.every((id) => typeof id === 'string'))) {
      throw new ProvenanceError('sourceImageIds must be an array of image IDs');
    }
    const binding = await attachReceipt({ imageId, receipt: body.receipt, sourceImageIds: sources as string[] | undefined });
    return NextResponse.json({ imageId, receipt: binding, saved: true, verified: true }, { headers: privateHeaders });
  } catch (error) { return fail(error); }
}
