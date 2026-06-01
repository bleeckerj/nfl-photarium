import { NextResponse } from 'next/server';

import { getImageToolRun } from '@/server/image-tools/runStore';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ runId: string }> }
) {
  const { runId } = await params;
  const run = getImageToolRun(runId);
  if (!run) {
    return NextResponse.json({ error: 'Image tool run not found' }, { status: 404 });
  }
  return NextResponse.json({ run });
}
