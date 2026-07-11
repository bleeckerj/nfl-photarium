import { NextRequest, NextResponse } from 'next/server';
import {
  METADATA_SEARCH_FIELDS,
  searchImageMetadata,
  type MetadataMatchMode,
  type MetadataSearchField,
} from '@/server/metadataSearch';

const MATCH_MODES = new Set<MetadataMatchMode>(['contains', 'exact', 'prefix', 'regex']);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const query = typeof body.query === 'string' ? body.query.trim() : '';
    if (!query) return NextResponse.json({ error: 'query is required' }, { status: 400 });
    const match = body.match === undefined ? undefined : String(body.match) as MetadataMatchMode;
    if (match && !MATCH_MODES.has(match)) {
      return NextResponse.json({ error: 'match must be contains, exact, prefix, or regex' }, { status: 400 });
    }
    const requestedFields = Array.isArray(body.fields) ? body.fields.map(String) : undefined;
    if (requestedFields?.some((field) => !METADATA_SEARCH_FIELDS.includes(field as MetadataSearchField))) {
      return NextResponse.json({ error: 'fields contains an unsupported metadata field' }, { status: 400 });
    }
    const limit = body.limit === undefined ? undefined : Number(body.limit);
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 0 || limit > 500)) {
      return NextResponse.json({ error: 'limit must be an integer between 0 and 500' }, { status: 400 });
    }
    const result = await searchImageMetadata({
      query,
      fields: requestedFields as MetadataSearchField[] | undefined,
      match,
      caseSensitive: body.caseSensitive === true,
      folder: typeof body.folder === 'string' ? body.folder : undefined,
      namespace: typeof body.namespace === 'string' ? body.namespace : undefined,
      limit,
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.startsWith('Invalid regular expression') ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
