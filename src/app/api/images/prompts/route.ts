import { NextRequest, NextResponse } from 'next/server';

import { getPromptThisRecords } from '@/server/promptThis';

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

    const recordsById = await getPromptThisRecords(ids);
    const prompts: Record<string, string | null> = {};
    ids.forEach((imageId) => {
      const prompt = recordsById[imageId]?.prompt;
      prompts[imageId] = typeof prompt === 'string' && prompt.trim() ? prompt : null;
    });

    return NextResponse.json({ prompts });
  } catch (error) {
    console.error('[API] Error in prompts lookup:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
