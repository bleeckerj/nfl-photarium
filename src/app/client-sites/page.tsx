import { createClientSiteService } from '@/features/client-sites/server';

export default async function ClientSitesPage() {
  const clientSiteService = createClientSiteService();
  const clientSites = await clientSiteService.listClientSites();

  return (
    <main className="min-h-screen bg-stone-50 px-4 py-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <section className="rounded-md border border-stone-200 bg-white p-6">
          <p className="text-[11px] font-mono uppercase tracking-[0.24em] text-stone-500">Client sites</p>
          <h1 className="mt-2 text-3xl font-semibold text-stone-900">Dedicated Cloudflare delivery workers</h1>
          <p className="mt-2 max-w-3xl text-sm text-stone-600">
            Create and deploy client sites through the CLI, then link client-page projects to those workers from the app.
          </p>
          <div className="mt-4 rounded-md border border-stone-200 bg-stone-50 p-3 text-xs font-mono text-stone-600">
            <div><code>npm run client-sites:create -- --name "Client Name"</code></div>
            <div><code>npm run client-sites:list</code></div>
            <div><code>npm run client-sites:deploy -- --site &lt;client-site-id&gt;</code></div>
          </div>
        </section>

        <section className="overflow-hidden rounded-md border border-stone-200 bg-white">
          <div className="border-b border-stone-200 px-6 py-4 text-sm text-stone-600">
            {clientSites.length} managed client sites
          </div>
          {clientSites.length === 0 ? (
            <div className="px-6 py-10 text-sm text-stone-500">
              No client sites yet. Use the CLI to create and deploy the first dedicated worker.
            </div>
          ) : (
            <ul className="divide-y divide-stone-200">
              {clientSites.map((clientSite) => (
                <li key={clientSite.id} className="px-6 py-5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-3">
                        <h2 className="text-lg font-semibold text-stone-900">{clientSite.name}</h2>
                        <span className="rounded-full border border-stone-300 px-2 py-1 text-[11px] font-mono uppercase tracking-[0.18em] text-stone-600">
                          {clientSite.status}
                        </span>
                      </div>
                      <div className="text-sm text-stone-600">
                        <div>Worker: {clientSite.deployment.workerName}</div>
                        <div>Public URL: {clientSite.deployment.publicBaseUrl}</div>
                        <div>Custom domain: {clientSite.deployment.customDomain || 'Not configured'}</div>
                        <div>Domain status: {clientSite.deployment.domainStatus || 'n/a'}</div>
                        <div>D1: {clientSite.deployment.d1DatabaseName || 'Pending'}</div>
                        <div>Linked projects: {clientSite.linkedProjectCount}</div>
                      </div>
                    </div>
                    <div className="text-right text-xs font-mono text-stone-500">
                      <div>{clientSite.id}</div>
                      <div>{clientSite.deployment.lastDeployStatus || 'idle'}</div>
                      <div>{clientSite.deployment.lastDeployAt || 'Not deployed yet'}</div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
