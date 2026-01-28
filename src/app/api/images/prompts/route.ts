import { NextRequest, NextResponse } from 'next/server';

import { getPromptThisRecord } from '@/server/promptThis';

const MAX_IDS = 250;

function parseIdsParam(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const ids = parseIdsParam(searchParams.get('ids')).slice(0, MAX_IDS);

    if (ids.length === 0) {
      return NextResponse.json({ prompts: {} });
    }

    const prompts: Record<string, string | null> = {};

    // Do small parallel batches to avoid hammering file storage.
    const BATCH_SIZE = 25;
    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const batch = ids.slice(i, i + BATCH_SIZE);
      const records = await Promise.all(batch.map((id) => getPromptThisRecord(id)));
      records.forEach((record, idx) => {
        const imageId = batch[idx];
        const prompt = record?.prompt;
        prompts[imageId] = typeof prompt === 'string' && prompt.trim() ? prompt : null;
      });
    }

    return NextResponse.json({ prompts });
  } catch (error) {
    console.error('[API] Error in prompts lookup:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
