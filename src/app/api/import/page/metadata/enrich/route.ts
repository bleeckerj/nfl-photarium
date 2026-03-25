import { NextRequest, NextResponse } from 'next/server';
import { enrichImportCandidateMetadata } from '@/server/import-metadata/service';
import type {
  EnrichmentPatch,
  EnrichmentRequestCandidate,
} from '@/server/import-metadata/types';

const runWithConcurrency = async <T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
) => {
  const results: R[] = [];
  let index = 0;
  const runners = Array.from(
    { length: Math.min(Math.max(1, concurrency), items.length) },
    async () => {
      while (index < items.length) {
        const currentIndex = index++;
        results[currentIndex] = await worker(items[currentIndex]);
      }
    }
  );
  await Promise.all(runners);
  return results;
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const sessionId =
      typeof body?.sessionId === 'string' && body.sessionId.trim()
        ? body.sessionId.trim()
        : '';
    const candidates = Array.isArray(body?.candidates)
      ? (body.candidates as EnrichmentRequestCandidate[])
      : [];
    const allowInsecure = Boolean(body?.allowInsecure);
    const cookieHeader =
      typeof body?.cookieHeader === 'string' && body.cookieHeader.trim()
        ? body.cookieHeader.trim()
        : null;

    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
    }
    if (candidates.length === 0) {
      return NextResponse.json({ patches: [] satisfies EnrichmentPatch[] });
    }

    const patches = await runWithConcurrency(candidates, 2, async (candidate) => {
      const patch = await enrichImportCandidateMetadata({
        sessionId,
        url: candidate.url,
        filename: candidate.filename,
        existingMetadata: candidate.metadata,
        allowInsecure,
        cookieHeader,
      });
      return {
        ...patch,
        id: candidate.id,
      };
    });

    return NextResponse.json({ patches });
  } catch (error) {
    console.error('Failed to enrich import candidate metadata', error);
    return NextResponse.json({ error: 'Failed to enrich import candidate metadata' }, { status: 500 });
  }
}
