import { NextRequest, NextResponse } from 'next/server';
import { createClientPageAssetRepairService, createClientPageProjectService, createClientPagePublishService } from '@/features/client-pages/server';
import { jsonBadRequest, jsonServerError } from '@/features/client-pages/api/http';
import { toClientPageProjectResponse } from '@/features/client-pages/api/responses';

export const runtime = 'nodejs';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;
    if (!projectId) return jsonBadRequest('Project ID is required.');
    const projectService = createClientPageProjectService();
    const project = await projectService.getProject(projectId);
    if (!project) return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
    const issues = await createClientPageAssetRepairService().inspect(project);
    return NextResponse.json({ issues });
  } catch (error) {
    return jsonServerError(error, 'client-pages/repair/inspect');
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;
    if (!projectId) return jsonBadRequest('Project ID is required.');
    const body = (await request.json().catch(() => null)) as { confirm?: boolean } | null;
    if (body?.confirm !== true) {
      return jsonBadRequest('Repair requires explicit confirmation.');
    }
    const projectService = createClientPageProjectService();
    const project = await projectService.getProject(projectId);
    if (!project) return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
    const repairService = createClientPageAssetRepairService();
    const issues = await repairService.inspect(project);
    const result = await repairService.removeIssues(project, issues);
    const publishService = createClientPagePublishService();
    return NextResponse.json({
      ...(await toClientPageProjectResponse(result.project, publishService)),
      removedAssets: result.removedAssets,
    });
  } catch (error) {
    return jsonServerError(error, 'client-pages/repair');
  }
}
