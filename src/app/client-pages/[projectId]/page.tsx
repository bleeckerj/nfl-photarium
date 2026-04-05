import { notFound } from 'next/navigation';
import { createClientPageProjectService } from '@/features/client-pages/server';
import { ClientPageEditor } from '@/features/client-pages/ui/ClientPageEditor';
import { toClientPageProjectResponse } from '@/features/client-pages/api/responses';

interface ClientPageEditorPageProps {
  params: Promise<{ projectId: string }>;
}

export default async function ClientPageEditorPage({ params }: ClientPageEditorPageProps) {
  const { projectId } = await params;
  const projectService = createClientPageProjectService();
  const project = await projectService.getProject(projectId);

  if (!project) {
    notFound();
  }

  const response = toClientPageProjectResponse(project);

  return (
    <main className="min-h-screen bg-stone-50 px-4 py-8">
      <div className="mx-auto max-w-[1600px]">
        <ClientPageEditor initialProject={response.project} initialShareUrl={response.shareUrl} />
      </div>
    </main>
  );
}
