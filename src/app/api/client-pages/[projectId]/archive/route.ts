import { NextRequest, NextResponse } from 'next/server';
import { createClientPageProjectService, createClientPagePublishService } from '@/features/client-pages/server';
import { jsonBadRequest, jsonServerError } from '@/features/client-pages/api/http';
import { toClientPageProjectResponse } from '@/features/client-pages/api/responses';

export const runtime = 'nodejs';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;
    if (!projectId) {
      return jsonBadRequest('Project ID is required.');
    }

    const projectService = createClientPageProjectService();
    const project = await projectService.getProject(projectId);
    if (!project) {
      return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
    }

    const publishService = createClientPagePublishService();
    const updatedProject = await publishService.archive(project);
    return NextResponse.json(await toClientPageProjectResponse(updatedProject, publishService));
  } catch (error) {
    return jsonServerError(error, 'client-pages/archive');
  }
}
