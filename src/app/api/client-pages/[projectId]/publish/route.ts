import { NextRequest, NextResponse } from 'next/server';
import { createClientPageProjectService, createClientPagePublishService } from '@/features/client-pages/server';
import { jsonBadRequest, jsonServerError } from '@/features/client-pages/api/http';

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
    const result = await publishService.publish(project);
    return NextResponse.json(result);
  } catch (error) {
    return jsonServerError(error, 'client-pages/publish');
  }
}
