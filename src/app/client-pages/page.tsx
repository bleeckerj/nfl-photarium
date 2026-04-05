import { createClientPageProjectService } from '@/features/client-pages/server';
import { ClientPagesIndex } from '@/features/client-pages/ui/ClientPagesIndex';

const resolvePublicBaseUrl = () =>
  process.env.CLIENT_SITES_PUBLIC_BASE_URL?.trim() ||
  process.env.CLIENT_SITES_TARGET_BASE_URL?.trim() ||
  undefined;

export default async function ClientPagesPage() {
  const projectService = createClientPageProjectService();
  const projects = await projectService.listProjects(resolvePublicBaseUrl());

  return (
    <main className="min-h-screen bg-stone-50 px-4 py-8">
      <div className="mx-auto max-w-[1600px]">
        <ClientPagesIndex initialProjects={projects} />
      </div>
    </main>
  );
}
