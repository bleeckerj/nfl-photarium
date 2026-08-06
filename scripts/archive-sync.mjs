const baseUrl = process.env.ARCHIVE_CATALOG_BASE_URL || 'http://localhost:8790';
const response = await fetch(`${baseUrl}/sync`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ hashFiles: process.argv.includes('--hash'), allowLockedCatalog: process.argv.includes('--allow-locked') }),
});

const body = await response.text();
if (!response.ok) {
  throw new Error(`Archive sync failed (${response.status}): ${body}`);
}
console.log(body);
