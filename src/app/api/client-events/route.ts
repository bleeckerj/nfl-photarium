import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    console.warn('[client-event]', body);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[client-event] failed to parse request', error);
    return NextResponse.json({ ok: false }, { status: 400 });
  }
}

