import { createHash } from 'node:crypto';
import { downloadOriginalImageById } from '../discovery/client.js';
import { apiRequest } from '../shared/api-client.js';
import type { DemarkSettings, DemarkVerification } from './types.js';

export async function verifyHostedOriginal(childId: string, output: Buffer): Promise<string> {
  try {
    const downloaded = await downloadOriginalImageById(childId);
    if (downloaded.fallbackUsed || downloaded.variantUsed !== 'original') {
      throw new Error('Original download returned a delivery variant');
    }
    const digest = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');
    const sha256 = digest(Buffer.from(downloaded.base64, 'base64'));
    if (sha256 !== digest(output)) throw new Error('Uploaded original bytes changed');
    return sha256;
  } catch (error) {
    throw Object.assign(new Error(`Hosted original verification failed for ${childId}: ${error instanceof Error ? error.message : String(error)}`), { childId, stage: 'verify' });
  }
}

export async function recordDemarkProvenance(params: {
  childId: string; sourceImageId: string; settings: DemarkSettings;
  verification: DemarkVerification; sha256: string; format: string; frames: number;
}): Promise<void> {
  const result = await apiRequest<{ record?: { imageToolRun?: { sourceImageId?: string; params?: Record<string, unknown> } } }>(`/api/images/${params.childId}/extras`, {
    method: 'PATCH',
    body: JSON.stringify({ imageToolRun: {
      toolId: 'no-ai-demarker', adapterKind: 'noai-watermark',
      sourceImageId: params.sourceImageId, effectId: params.settings.mode,
      params: { ...params.settings, verification: params.verification,
        hostedOriginalSha256: params.sha256, hostedOriginalMatches: true },
      output: { mode: params.frames > 1 ? 'animated' : 'still', format: params.format },
      createdAt: new Date().toISOString(),
    } }),
  });
  const saved = result.record?.imageToolRun;
  if (saved?.sourceImageId !== params.sourceImageId || saved.params?.hostedOriginalSha256 !== params.sha256) {
    throw new Error(`Demark provenance readback failed for ${params.childId}`);
  }
}
