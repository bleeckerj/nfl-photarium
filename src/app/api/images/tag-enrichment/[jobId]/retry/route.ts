import { NextResponse } from 'next/server';

import { retrySemanticTagJob } from '@/server/semanticTagQueue';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  try {
    const job = await retrySemanticTagJob(jobId);
    if (!job) return NextResponse.json({ error: 'Semantic tag job not found' }, { status: 404 });
    return NextResponse.json(job);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 503 },
    );
  }
}
