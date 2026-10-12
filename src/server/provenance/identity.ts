import { sha256 } from './validation';

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

// Exact receipt IDs remain byte hashes; this identity only groups formatting copies.
export function receiptContentIdentity(json: string): string {
  return sha256(canonicalJson(JSON.parse(json)));
}
