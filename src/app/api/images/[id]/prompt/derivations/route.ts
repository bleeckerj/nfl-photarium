import { NextRequest, NextResponse } from 'next/server';

import {
  getPromptDerivations,
  normalizeAspectRatio,
  normalizeGenerationProvider,
  updatePromptDerivation,
  type GenerationProvider,
} from '@/server/creativeBrief';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseDimensions(value: unknown): { width: number; height: number } | undefined {
  if (!isRecord(value)) return undefined;
  const width = Number(value.width);
  const height = Number(value.height);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error('actualDimensions must contain positive integer width and height');
  }
  return { width, height };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    if (!id) return NextResponse.json({ error: 'Image ID is required' }, { status: 400 });
    return NextResponse.json({ imageId: id, derivations: await getPromptDerivations(id) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to read derivations' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    if (!id) return NextResponse.json({ error: 'Image ID is required' }, { status: 400 });
    const body = await request.json().catch(() => ({}));
    if (!isRecord(body) || typeof body.derivationId !== 'string' || !body.derivationId.trim()) {
      return NextResponse.json({ error: 'derivationId is required' }, { status: 400 });
    }

    let provider: GenerationProvider | undefined;
    let actualDimensions: { width: number; height: number } | undefined;
    let actualAspectRatio: string | undefined;
    try {
      provider = normalizeGenerationProvider(body.provider);
      if (!provider) throw new Error('provider is required when recording a creative-brief result');
      actualDimensions = parseDimensions(body.actualDimensions);
      actualAspectRatio = normalizeAspectRatio(body.actualAspectRatio);
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid result metadata' }, { status: 400 });
    }

    const generatedImageId = typeof body.generatedImageId === 'string' ? body.generatedImageId.trim() : '';
    if (!generatedImageId) {
      return NextResponse.json({ error: 'generatedImageId is required when recording a completed external result' }, { status: 400 });
    }

    let metadataEnrichment: {
      status: 'completed' | 'partial' | 'failed';
      descriptionSaved: boolean;
      altTextSaved: boolean;
    } | undefined;
    if (isRecord(body.metadataEnrichment)) {
      const status = body.metadataEnrichment.status;
      if (status !== 'completed' && status !== 'partial' && status !== 'failed') {
        return NextResponse.json({ error: 'metadataEnrichment.status must be completed, partial, or failed' }, { status: 400 });
      }
      metadataEnrichment = {
        status,
        descriptionSaved: body.metadataEnrichment.descriptionSaved === true,
        altTextSaved: body.metadataEnrichment.altTextSaved === true,
      };
    }

    const updated = await updatePromptDerivation(id, body.derivationId.trim(), {
      provider,
      generatedImageId,
      externalJobId: typeof body.externalJobId === 'string' ? body.externalJobId.trim() || undefined : undefined,
      actualDimensions,
      actualAspectRatio,
      metadataEnrichment,
    });
    return NextResponse.json({ imageId: id, derivation: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to record derivation result';
    return NextResponse.json({ error: message }, { status: message.includes('not found') ? 404 : 400 });
  }
}
