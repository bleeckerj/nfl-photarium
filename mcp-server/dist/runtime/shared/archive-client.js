const ARCHIVE_BASE_URL = process.env.ARCHIVE_CATALOG_BASE_URL || 'http://localhost:8790';
async function archiveRequest(endpoint, options = {}) {
    const response = await fetch(`${ARCHIVE_BASE_URL}${endpoint}`, {
        ...options,
        headers: { 'content-type': 'application/json', ...options.headers },
    });
    if (!response.ok)
        throw new Error(`Archive catalog error (${response.status}): ${await response.text()}`);
    return await response.json();
}
export function archiveJson(endpoint, options = {}) {
    return archiveRequest(endpoint, options);
}
export async function archivePreview(assetId) {
    const response = await fetch(`${ARCHIVE_BASE_URL}/assets/${encodeURIComponent(assetId)}/preview`);
    if (!response.ok)
        throw new Error(`Archive preview error (${response.status}): ${await response.text()}`);
    return { data: Buffer.from(await response.arrayBuffer()).toString('base64'), mimeType: response.headers.get('content-type') || 'image/jpeg' };
}
