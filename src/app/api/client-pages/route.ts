import { NextRequest, NextResponse } from 'next/server';
import { createClientPageProjectService } from '@/features/client-pages/server';
import { parseCreateClientPageProjectInput } from '@/features/client-pages/api/parsers';
import { jsonBadRequest, jsonServerError } from '@/features/client-pages/api/http';
import { toClientPageListResponse, toClientPageProjectResponse } from '@/features/client-pages/api/responses';

export const runtime = 'nodejs';

const resolvePublicBaseUrl = () =>
  process.env.CLIENT_SITES_PUBLIC_BASE_URL?.trim() ||
  process.env.CLIENT_SITES_TARGET_BASE_URL?.trim() ||
  undefined;

export async function GET() {
  try {
    const projectService = createClientPageProjectService();
    const projects = await projectService.listProjects(resolvePublicBaseUrl());
    return NextResponse.json(toClientPageListResponse(projects));
  } catch (error) {
    return jsonServerError(error, 'client-pages/list');
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload = parseCreateClientPageProjectInput(await request.json());
    const projectService = createClientPageProjectService();
    const project = await projectService.createProject(payload);
    return NextResponse.json(toClientPageProjectResponse(project), { status: 201 });
  } catch (error) {
    console.error('[client-pages] create failed', error);
    return jsonBadRequest(
      error instanceof Error ? error.message : 'Failed to create client page.'
    );
  }
}
