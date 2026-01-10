import { NextResponse } from 'next/server';
import { listRegistryNamespaces } from '@/server/namespaceRegistry';

export async function GET() {
  try {
    const namespaces = await listRegistryNamespaces();
    return NextResponse.json({ namespaces });
  } catch (error) {
    console.error('Fetch namespaces error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
