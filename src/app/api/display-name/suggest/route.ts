import { NextRequest, NextResponse } from 'next/server';
import { fallbackDisplayNameFromFilename, sanitizeSuggestedDisplayName } from '@/utils/displayName';
import { sanitizePhraseSuggestedTags } from '@/server/aiTagParsing';

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

const isHttpUrl = (value: string) => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

const getMessageText = (content: unknown): string | undefined => {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return undefined;
  const merged = content
    .map((chunk) => (chunk && typeof chunk === 'object' ? (chunk as { text?: string }).text || '' : ''))
    .join(' ')
    .trim();
  return merged || undefined;
};

const parseBoolField = (value: FormDataEntryValue | null) =>
  typeof value === 'string' && ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());

const parseIntField = (value: FormDataEntryValue | null, fallback: number) => {
  if (typeof value !== 'string') return fallback;
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const buildTagShapeExample = (requestedTagCount: number) => {
  const tags = Array.from({ length: requestedTagCount }, (_, index) => `tag${index + 1}`);
  return JSON.stringify({ tags });
};

const buildDisplayNameAndTagShapeExample = (requestedTagCount: number) => {
  const tags = Array.from({ length: requestedTagCount }, (_, index) => `tag${index + 1}`);
  return JSON.stringify({ displayName: 'short name', tags });
};

const tryParseJsonObject = (raw?: string): Record<string, unknown> | null => {
  if (!raw) return null;
  const trimmed = raw.trim();
  const candidates = [trimmed];
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    candidates.push(trimmed.slice(start, end + 1));
  }
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      continue;
    }
  }
  return null;
};

export async function POST(request: NextRequest) {
  try {
    const openAiKey = process.env.OPENAI_API_KEY;
    if (!openAiKey) {
      return NextResponse.json({ error: 'OpenAI API key not configured' }, { status: 500 });
    }

    const form = await request.formData();
    const inputFile = form.get('file');
    const remoteUrlRaw = typeof form.get('remoteUrl') === 'string' ? String(form.get('remoteUrl')).trim() : '';
    const filename = typeof form.get('filename') === 'string' ? String(form.get('filename')).trim() : '';
    const folder = typeof form.get('folder') === 'string' ? String(form.get('folder')).trim() : '';
    const tags = typeof form.get('tags') === 'string' ? String(form.get('tags')).trim() : '';
    const includeTags = parseBoolField(form.get('includeTags'));
    const skipDisplayName = parseBoolField(form.get('skipDisplayName'));
    const requestedTagCount = Math.min(8, Math.max(1, parseIntField(form.get('tagCount'), 4)));

    let imageUrl: string | undefined;
    if (inputFile instanceof File && inputFile.size > 0) {
      const mime = inputFile.type || 'image/jpeg';
      const bytes = Buffer.from(await inputFile.arrayBuffer());
      imageUrl = `data:${mime};base64,${bytes.toString('base64')}`;
    } else if (remoteUrlRaw && isHttpUrl(remoteUrlRaw)) {
      imageUrl = remoteUrlRaw;
    }

    if (!imageUrl) {
      return NextResponse.json(
        { error: 'Provide a file or a valid remoteUrl for AI naming' },
        { status: 400 }
      );
    }

    if (skipDisplayName && !includeTags) {
      return NextResponse.json(
        { error: 'Nothing requested. Set includeTags=true and/or omit skipDisplayName.' },
        { status: 400 }
      );
    }

    const prompt = includeTags
      ? [
          'Analyze this image and return JSON only.',
          skipDisplayName
            ? `Return exactly this shape: ${buildTagShapeExample(requestedTagCount)}`
            : `Return exactly this shape: ${buildDisplayNameAndTagShapeExample(requestedTagCount)}`,
          skipDisplayName
            ? `Provide exactly ${requestedTagCount} concise semantic tags.`
            : `Provide a short semantic displayName (2-5 words) and exactly ${requestedTagCount} concise semantic tags.`,
          'Tags should be short lowercase phrases, no punctuation, no hashtags, no explanation.',
          'Each tag must be its own JSON array item, never a single hyphen-joined string.',
          'Do not include markdown fences.',
          filename ? `Filename hint: ${filename}` : null,
          folder ? `Folder hint: ${folder}` : null,
          tags ? `Tags hint: ${tags}` : null,
        ]
          .filter(Boolean)
          .join('\n')
      : [
          'Generate a short semantic name for this image.',
          'Return 2-5 concise words separated by single spaces.',
          'Do not return CamelCase, punctuation, markdown, or explanation.',
          'Words only. Max 64 characters total before conversion.',
          filename ? `Filename hint: ${filename}` : null,
          folder ? `Folder hint: ${folder}` : null,
          tags ? `Tags hint: ${tags}` : null,
        ]
          .filter(Boolean)
          .join('\n');

    const model = process.env.OPENAI_DISPLAY_NAME_MODEL || 'gpt-4.1-nano';
    const openAiResponse = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openAiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 80,
        messages: [
          { role: 'system', content: 'You create compact semantic short word phrases for image names.' },
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: imageUrl } },
            ],
          },
        ],
      }),
    });

    const payload = await openAiResponse.json();
    if (!openAiResponse.ok) {
      return NextResponse.json(
        { error: payload?.error?.message || 'Failed to generate name' },
        { status: openAiResponse.status }
      );
    }

    const raw = getMessageText(payload?.choices?.[0]?.message?.content);
    const parsedObject = includeTags ? tryParseJsonObject(raw) : null;
    const parsedDisplayName =
      typeof parsedObject?.displayName === 'string' ? parsedObject.displayName : raw;
    const displayName =
      skipDisplayName
        ? undefined
        : parsedDisplayName
          ? sanitizeSuggestedDisplayName(parsedDisplayName)
          : fallbackDisplayNameFromFilename(filename);
    const suggestedTags = includeTags
      ? sanitizePhraseSuggestedTags(parsedObject?.tags ?? raw, requestedTagCount)
      : undefined;

    return NextResponse.json({
      ...(displayName ? { displayName } : {}),
      ...(includeTags ? { tags: suggestedTags ?? [] } : {}),
      model,
    });
  } catch (error) {
    console.error('Pre-upload display-name generation error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
