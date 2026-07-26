import { NextResponse } from 'next/server';

import { getAspectRatioExpansionProviderStatuses } from '@/server/aspectRatioExpansion/registry';

export async function GET() {
  return NextResponse.json({ providers: getAspectRatioExpansionProviderStatuses() });
}
