const exportId = process.argv[2];
if (!exportId) throw new Error('Usage: npm run archive:restore -- <export-id>');
const baseUrl = process.env.ARCHIVE_CATALOG_BASE_URL || 'http://localhost:8790';
const response = await fetch(`${baseUrl}/restore`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ exportId }),
  signal: AbortSignal.timeout(60 * 60 * 1000),
});
if (!response.ok) throw new Error(`Archive restore failed (${response.status}): ${await response.text()}`);
console.log(JSON.stringify(await response.json(), null, 2));
