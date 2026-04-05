import { NextRequest, NextResponse } from 'next/server';
import { createClientPageProjectService } from '@/features/client-pages/server';
import { parseReplaceClientPageSelectionInput } from '@/features/client-pages/api/parsers';
import { jsonBadRequest } from '@/features/client-pages/api/http';
import { toClientPageProjectResponse } from '@/features/client-pages/api/responses';

export const runtime = 'nodejs';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;
    if (!projectId) {
      return jsonBadRequest('Project ID is required.');
    }

    const payload = parseReplaceClientPageSelectionInput(await request.json());
    const projectService = createClientPageProjectService();
    const project = await projectService.replaceSelection(projectId, payload);
    return NextResponse.json(toClientPageProjectResponse(project));
  } catch (error) {
    console.error('[client-pages] selection update failed', error);
    return jsonBadRequest(
      error instanceof Error ? error.message : 'Failed to update client page selection.'
    );
  }
}
