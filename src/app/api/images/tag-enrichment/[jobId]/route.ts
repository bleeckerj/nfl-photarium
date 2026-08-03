import { NextResponse } from 'next/server';

import { getSemanticTagJob } from '@/server/semanticTagQueue';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params;
  const job = getSemanticTagJob(jobId);
  if (!job) {
    return NextResponse.json({ error: 'Semantic tag job not found' }, { status: 404 });
  }
  return NextResponse.json(job);
}
