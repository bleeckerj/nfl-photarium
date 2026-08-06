import { archiveJson, archivePreview } from '../shared/archive-client.js';
function text(value) {
    return typeof value === 'string' && value.trim() ? value : undefined;
}
function number(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
function searchBody(args) {
    return {
        query: text(args.query), from: text(args.from), to: text(args.to), minRating: number(args.minRating), pick: number(args.pick),
        catalogId: text(args.catalogId), path: text(args.path), keyword: text(args.keyword), collection: text(args.collection),
        limit: number(args.limit), offset: number(args.offset), expandQuery: typeof args.expandQuery === 'boolean' ? args.expandQuery : undefined,
    };
}
export const archiveHandlers = {
    archive_catalog_status: async () => ({ content: [{ type: 'text', text: JSON.stringify(await archiveJson('/status'), null, 2) }] }),
    archive_list_catalogs: async () => ({ content: [{ type: 'text', text: JSON.stringify(await archiveJson('/catalogs'), null, 2) }] }),
    archive_search: async (args) => {
        const result = await archiveJson('/search', { method: 'POST', body: JSON.stringify(searchBody(args)) });
        const includePreviews = args.includePreviews === true;
        const content = [{ type: 'text', text: JSON.stringify(result, null, 2) }];
        if (includePreviews) {
            for (const item of result.results.slice(0, 12)) {
                try {
                    const preview = await archivePreview(item.id);
                    content.push({ type: 'image', data: preview.data, mimeType: preview.mimeType });
                }
                catch {
                    // Search remains useful when a source is offline and an individual preview is absent.
                }
            }
        }
        return { content };
    },
    archive_get_asset: async (args) => ({ content: [{ type: 'text', text: JSON.stringify(await archiveJson(`/assets/${encodeURIComponent(String(args.assetId))}`), null, 2) }] }),
    archive_get_preview: async (args) => {
        const assetId = String(args.assetId);
        const [asset, preview] = await Promise.all([archiveJson(`/assets/${encodeURIComponent(assetId)}`), archivePreview(assetId)]);
        return {
            content: [
                { type: 'text', text: JSON.stringify(asset, null, 2) },
                { type: 'image', data: preview.data, mimeType: preview.mimeType },
            ],
        };
    },
    archive_list_keywords: async (args) => ({ content: [{ type: 'text', text: JSON.stringify(await archiveJson(`/keywords${text(args.query) ? `?query=${encodeURIComponent(String(args.query))}` : ''}`), null, 2) }] }),
    archive_list_collections: async (args) => ({ content: [{ type: 'text', text: JSON.stringify(await archiveJson(`/collections${text(args.query) ? `?query=${encodeURIComponent(String(args.query))}` : ''}`), null, 2) }] }),
    archive_save_annotation: async (args) => ({
        content: [{ type: 'text', text: JSON.stringify(await archiveJson(`/assets/${encodeURIComponent(String(args.assetId))}/annotation`, { method: 'POST', body: JSON.stringify({ note: args.note ?? null, tags: Array.isArray(args.tags) ? args.tags : [], shortlist: args.shortlist === true }) }), null, 2) }],
    }),
};
