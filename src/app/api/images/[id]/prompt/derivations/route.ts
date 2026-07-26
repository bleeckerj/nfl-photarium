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
      actualDimensions = parseDimensions(body.actualDimensions);
      actualAspectRatio = normalizeAspectRatio(body.actualAspectRatio);
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid result metadata' }, { status: 400 });
    }

    const updated = await updatePromptDerivation(id, body.derivationId.trim(), {
      provider,
      generatedImageId: typeof body.generatedImageId === 'string' ? body.generatedImageId.trim() || undefined : undefined,
      externalJobId: typeof body.externalJobId === 'string' ? body.externalJobId.trim() || undefined : undefined,
      actualDimensions,
      actualAspectRatio,
    });
    return NextResponse.json({ imageId: id, derivation: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to record derivation result';
    return NextResponse.json({ error: message }, { status: message.includes('not found') ? 404 : 400 });
  }
}
