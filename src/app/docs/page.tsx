import Link from 'next/link';
import ApiExplorer from './ApiExplorer';
import { listApiEndpoints } from '@/server/apiExplorer';

export const runtime = 'nodejs';

export default async function DocsPage() {
  const endpoints = await listApiEndpoints();

  return (
    <main className="min-h-screen bg-gray-50 overscroll-none">
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-6xl mx-auto space-y-6">
          <header className="space-y-2">
            <div className="flex items-baseline justify-between gap-4 flex-wrap">
              <h1 className="text-xl text-stone-900 font-mono">Docs</h1>
              <Link
                href="/"
                className="text-xs font-mono text-stone-600 hover:text-stone-900 transition-colors"
              >
                Back to Gallery
              </Link>
            </div>
            <p className="text-sm text-stone-700 font-mono">
              Auto-generated API surface from <span className="text-stone-900">src/app/api</span>. Expand an endpoint to see its
              route docblock (when present).
            </p>
          </header>

          <section className="rounded-lg border border-stone-200 bg-white p-4">
            <h2 className="text-sm font-mono text-stone-900 mb-2">API Explorer</h2>
            <ApiExplorer endpoints={endpoints} />
          </section>
        </div>
      </div>
    </main>
  );
}
