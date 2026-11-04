import { NextResponse } from 'next/server';
import { loadImageDeletePlan } from '@/server/imageDeleteFamilyPlan';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { plan } = await loadImageDeletePlan(id);
    return NextResponse.json(plan);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to inspect variants' }, { status: 502 });
  }
}
