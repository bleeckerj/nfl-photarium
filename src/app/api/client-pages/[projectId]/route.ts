import { NextRequest, NextResponse } from 'next/server';
import { createClientPageProjectService } from '@/features/client-pages/server';
import { parseUpdateClientPageProjectInput } from '@/features/client-pages/api/parsers';
import { jsonBadRequest, jsonServerError } from '@/features/client-pages/api/http';
import { toClientPageProjectResponse } from '@/features/client-pages/api/responses';

export const runtime = 'nodejs';

const getProjectId = async (params: Promise<{ projectId: string }>) => {
  const { projectId } = await params;
  if (!projectId) {
    throw new Error('Project ID is required.');
  }
  return projectId;
};

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const projectId = await getProjectId(params);
    const projectService = createClientPageProjectService();
    const project = await projectService.getProject(projectId);
    if (!project) {
      return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
    }
    return NextResponse.json(toClientPageProjectResponse(project));
  } catch (error) {
    return jsonServerError(error, 'client-pages/get');
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const projectId = await getProjectId(params);
    const payload = parseUpdateClientPageProjectInput(await request.json());
    const projectService = createClientPageProjectService();
    const project = await projectService.updateProject(projectId, payload);
    return NextResponse.json(toClientPageProjectResponse(project));
  } catch (error) {
    console.error('[client-pages] update failed', error);
    return jsonBadRequest(
      error instanceof Error ? error.message : 'Failed to update client page.'
    );
  }
}
