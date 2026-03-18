import { NextRequest, NextResponse } from 'next/server';
import { assignAssetParent, ParentAssignmentError } from '@/server/assetParentService';

type ParentAssignmentRequestBody = {
  parentId?: string;
};

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: 'Asset ID is required' }, { status: 400 });
    }

    let body: ParentAssignmentRequestBody = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    const result = await assignAssetParent(id, body.parentId);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof ParentAssignmentError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('[asset-parent] Failed to update parent', error);
    return NextResponse.json(
      { error: 'Failed to update parent relationship' },
      { status: 500 }
    );
  }
}
