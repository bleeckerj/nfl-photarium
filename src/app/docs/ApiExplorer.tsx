'use client';

import { useMemo, useState } from 'react';
import type { ApiEndpointDoc } from '@/server/apiExplorer';

function MethodBadge({ method }: { method: string }) {
  const color =
    method === 'GET'
      ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
      : method === 'POST'
        ? 'bg-sky-50 text-sky-800 border-sky-200'
        : method === 'PATCH'
          ? 'bg-amber-50 text-amber-900 border-amber-200'
          : method === 'PUT'
            ? 'bg-indigo-50 text-indigo-900 border-indigo-200'
            : method === 'DELETE'
              ? 'bg-rose-50 text-rose-900 border-rose-200'
              : 'bg-stone-50 text-stone-800 border-stone-200';

  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-[11px] border rounded font-mono ${color}`}>
      {method}
    </span>
  );
}

export default function ApiExplorer({ endpoints }: { endpoints: ApiEndpointDoc[] }) {
  const [query, setQuery] = useState('');
  const [showOnlyWithDocs, setShowOnlyWithDocs] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return endpoints.filter(e => {
      if (showOnlyWithDocs && !e.docblock) return false;
      if (!q) return true;
      return (
        e.apiPath.toLowerCase().includes(q) ||
        e.filePath.toLowerCase().includes(q) ||
        e.methods.join(' ').toLowerCase().includes(q) ||
        (e.docblock ?? '').toLowerCase().includes(q)
      );
    });
  }, [endpoints, query, showOnlyWithDocs]);

  const grouped = useMemo(() => {
    const map = new Map<string, ApiEndpointDoc[]>();
    for (const e of filtered) {
      const afterApi = e.apiPath.replace(/^\/api\/?/, '');
      const first = afterApi.split('/').filter(Boolean)[0] ?? '(root)';
      if (!map.has(first)) map.set(first, []);
      map.get(first)!.push(e);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex-1">
          <label className="block text-xs text-stone-600 font-mono mb-1">Search</label>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="/api/images, embeddings, POST, src/app/api…"
            className="w-full rounded border border-stone-200 bg-white px-3 py-2 text-sm font-mono text-stone-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-stone-300"
          />
        </div>
        <label className="flex items-center gap-2 text-xs font-mono text-stone-700 select-none">
          <input
            type="checkbox"
            checked={showOnlyWithDocs}
            onChange={e => setShowOnlyWithDocs(e.target.checked)}
            className="rounded border-stone-300"
          />
          Only endpoints with docblocks
        </label>
      </div>

      <div className="text-xs font-mono text-stone-600">
        Showing <span className="text-stone-900">{filtered.length}</span> of{' '}
        <span className="text-stone-900">{endpoints.length}</span> endpoints
      </div>

      <div className="space-y-6">
        {grouped.map(([group, groupEndpoints]) => (
          <section key={group} className="rounded-lg border border-stone-200 bg-white">
            <div className="px-4 py-3 border-b border-stone-100 flex items-center justify-between">
              <h2 className="text-sm font-mono text-stone-900">/api/{group === '(root)' ? '' : group}</h2>
              <span className="text-xs font-mono text-stone-500">{groupEndpoints.length}</span>
            </div>

            <div className="divide-y divide-stone-100">
              {groupEndpoints.map(e => (
                <details key={e.apiPath} className="group">
                  <summary className="cursor-pointer list-none px-4 py-3 hover:bg-stone-50 flex flex-col gap-1">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        {e.methods.length ? (
                          e.methods.map(m => <MethodBadge key={m} method={m} />)
                        ) : (
                          <span className="text-[11px] font-mono text-stone-500">(no exported methods found)</span>
                        )}
                        <span className="text-sm font-mono text-stone-900">{e.apiPath}</span>
                      </div>
                      <span className="text-gray-400 group-open:rotate-90 transition-transform font-mono">▶</span>
                    </div>
                    <div className="text-[11px] font-mono text-stone-500">{e.filePath}</div>
                  </summary>

                  <div className="px-4 pb-4">
                    {e.docblock ? (
                      <pre className="mt-2 rounded border border-stone-200 bg-stone-50 p-3 text-xs font-mono text-stone-800 overflow-auto whitespace-pre-wrap">
                        {e.docblock}
                      </pre>
                    ) : (
                      <div className="mt-2 text-xs font-mono text-stone-500">
                        No docblock found at top of file.
                      </div>
                    )}
                  </div>
                </details>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
