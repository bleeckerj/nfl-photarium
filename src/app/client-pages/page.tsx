import { createClientPageProjectService, createClientPagePublishService } from '@/features/client-pages/server';
import { ClientPagesIndex } from '@/features/client-pages/ui/ClientPagesIndex';

export default async function ClientPagesPage() {
  const projectService = createClientPageProjectService();
  const publishService = createClientPagePublishService();
  const projects = await projectService.listProjects();
  const hydratedProjects = await Promise.all(
    projects.map(async (project) => ({
      ...project,
      shareUrl: (await publishService.getShareUrl(project).catch(() => null)) ?? undefined,
    }))
  );

  return (
    <main className="min-h-screen bg-stone-50 px-4 py-8">
      <div className="mx-auto max-w-[1600px]">
        <ClientPagesIndex initialProjects={hydratedProjects} />
      </div>
    </main>
  );
}
