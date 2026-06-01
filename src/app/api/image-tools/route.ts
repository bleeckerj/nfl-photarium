import { NextResponse } from 'next/server';

import { getImageToolRegistry } from '@/server/image-tools/registry';

export async function GET() {
  try {
    return NextResponse.json({
      tools: getImageToolRegistry().listManifests(),
    });
  } catch (error) {
    console.error('[image-tools] Failed to list tools', error);
    return NextResponse.json({ error: 'Failed to list image tools' }, { status: 500 });
  }
}
