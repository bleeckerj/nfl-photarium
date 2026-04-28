import { NextRequest, NextResponse } from 'next/server';
import { createClientSiteService } from '@/features/client-sites/server';
import { parseUpdateClientSiteInput } from '@/features/client-sites/api/parsers';
import { toClientSiteResponse } from '@/features/client-sites/api/responses';
import { jsonBadRequest, jsonServerError } from '@/features/client-pages/api/http';

export const runtime = 'nodejs';

const getClientSiteId = async (params: Promise<{ id: string }>) => {
  const { id } = await params;
  if (!id) {
    throw new Error('Client site ID is required.');
  }
  return id;
};

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const clientSiteId = await getClientSiteId(params);
    const clientSiteService = createClientSiteService();
    const clientSite = await clientSiteService.getClientSite(clientSiteId);
    if (!clientSite) {
      return NextResponse.json({ error: 'Client site not found.' }, { status: 404 });
    }
    return NextResponse.json(toClientSiteResponse(clientSite));
  } catch (error) {
    return jsonServerError(error, 'client-sites/get');
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const clientSiteId = await getClientSiteId(params);
    const payload = parseUpdateClientSiteInput(await request.json());
    const clientSiteService = createClientSiteService();
    const clientSite = await clientSiteService.updateClientSite(clientSiteId, payload);
    return NextResponse.json(toClientSiteResponse(clientSite));
  } catch (error) {
    console.error('[client-sites] update failed', error);
    return jsonBadRequest(error instanceof Error ? error.message : 'Failed to update client site.');
  }
}
