const baseUrl = process.env.ARCHIVE_CATALOG_BASE_URL || 'http://localhost:8790';
const response = await fetch(`${baseUrl}/verify`, { method: 'POST', signal: AbortSignal.timeout(60 * 60 * 1000) });
if (!response.ok) throw new Error(`Archive verification failed (${response.status}): ${await response.text()}`);
const result = await response.json();
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
