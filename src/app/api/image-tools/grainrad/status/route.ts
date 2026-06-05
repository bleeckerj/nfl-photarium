import { NextResponse } from 'next/server';

import { getGrainradManagedStatus } from '@/server/image-tools/grainradManagedRuntime';

export const GET = async () => {
  try {
    return NextResponse.json({
      status: await getGrainradManagedStatus(),
    });
  } catch (error) {
    console.error('[image-tools] Failed to read Grainrad status', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to read Grainrad status' },
      { status: 500 }
    );
  }
};
