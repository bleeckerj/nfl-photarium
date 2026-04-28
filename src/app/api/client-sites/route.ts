import { NextRequest, NextResponse } from 'next/server';
import { createClientSiteService } from '@/features/client-sites/server';
import { parseCreateClientSiteInput } from '@/features/client-sites/api/parsers';
import { toClientSiteListResponse, toClientSiteResponse } from '@/features/client-sites/api/responses';
import { jsonBadRequest, jsonServerError } from '@/features/client-pages/api/http';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const clientSiteService = createClientSiteService();
    const clientSites = await clientSiteService.listClientSites();
    return NextResponse.json(toClientSiteListResponse(clientSites));
  } catch (error) {
    return jsonServerError(error, 'client-sites/list');
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload = parseCreateClientSiteInput(await request.json());
    const clientSiteService = createClientSiteService();
    const clientSite = await clientSiteService.createClientSite(payload);
    return NextResponse.json(toClientSiteResponse(clientSite), { status: 201 });
  } catch (error) {
    console.error('[client-sites] create failed', error);
    return jsonBadRequest(error instanceof Error ? error.message : 'Failed to create client site.');
  }
}
