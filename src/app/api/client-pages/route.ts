import { NextRequest, NextResponse } from 'next/server';
import { createClientPageProjectService, createClientPagePublishService } from '@/features/client-pages/server';
import { parseCreateClientPageProjectInput } from '@/features/client-pages/api/parsers';
import { jsonBadRequest, jsonServerError } from '@/features/client-pages/api/http';
import { toClientPageListResponse, toClientPageProjectResponse } from '@/features/client-pages/api/responses';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const projectService = createClientPageProjectService();
    const publishService = createClientPagePublishService();
    const projects = await projectService.listProjects();
    const hydratedProjects = await Promise.all(
      projects.map(async (project) => ({
        ...project,
        shareUrl: (await publishService.getShareUrl(project).catch(() => null)) ?? undefined,
      }))
    );
    return NextResponse.json(toClientPageListResponse(hydratedProjects));
  } catch (error) {
    return jsonServerError(error, 'client-pages/list');
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload = parseCreateClientPageProjectInput(await request.json());
    const projectService = createClientPageProjectService();
    const publishService = createClientPagePublishService();
    const project = await projectService.createProject(payload);
    return NextResponse.json(await toClientPageProjectResponse(project, publishService), { status: 201 });
  } catch (error) {
    console.error('[client-pages] create failed', error);
    return jsonBadRequest(
      error instanceof Error ? error.message : 'Failed to create client page.'
    );
  }
}
