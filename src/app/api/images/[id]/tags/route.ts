import { NextRequest, NextResponse } from 'next/server';
import { cleanString, parseCloudflareMetadata } from '@/utils/cloudflareMetadata';
import { sanitizeSingleWordSuggestedTags } from '@/server/aiTagParsing';
import { getOpenAiTagsModel, OPENAI_CHAT_COMPLETIONS_URL } from '@/server/openAiGeneratorModels';
const DEFAULT_TAG_COUNT = 6;
const MIN_TAG_COUNT = 1;
const MAX_TAG_COUNT = 12;

const clampTagCount = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.min(MAX_TAG_COUNT, Math.max(MIN_TAG_COUNT, Math.round(value)));
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return Math.min(MAX_TAG_COUNT, Math.max(MIN_TAG_COUNT, parsed));
    }
  }
  return DEFAULT_TAG_COUNT;
};

const extractMessageText = (content: unknown): string | undefined => {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return undefined;
  const merged = content
    .map((chunk) => (chunk && typeof chunk === 'object' ? (chunk as { text?: string }).text || '' : ''))
    .join(' ')
    .trim();
  return merged || undefined;
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const apiToken = process.env.CLOUDFLARE_API_TOKEN;
    const openAiKey = process.env.OPENAI_API_KEY;

    if (!accountId || !apiToken) {
      return NextResponse.json({ error: 'Cloudflare credentials not configured' }, { status: 500 });
    }
    if (!openAiKey) {
      return NextResponse.json({ error: 'OpenAI API key not configured' }, { status: 500 });
    }

    const { id: imageId } = await params;
    if (!imageId) {
      return NextResponse.json({ error: 'Image ID is required' }, { status: 400 });
    }

    let requestedCount = DEFAULT_TAG_COUNT;
    if (request.headers.get('content-type')?.includes('application/json')) {
      try {
        const body = await request.json();
        requestedCount = clampTagCount(body?.count);
      } catch {
        requestedCount = DEFAULT_TAG_COUNT;
      }
    }

    const imageResponse = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v1/${imageId}`,
      {
        headers: {
          Authorization: `Bearer ${apiToken}`
        }
      }
    );
    const imageResult = await imageResponse.json();

    if (!imageResponse.ok) {
      return NextResponse.json(
        { error: imageResult.errors?.[0]?.message || 'Failed to fetch image from Cloudflare' },
        { status: imageResponse.status }
      );
    }

    const image = imageResult.result;
    const imageUrl: string | undefined =
      image.variants?.find((variant: string) => variant.includes('public')) || image.variants?.[0];

    if (!imageUrl) {
      return NextResponse.json({ error: 'No accessible image variant found' }, { status: 422 });
    }

    const parsedMeta = parseCloudflareMetadata(image.meta);
    const filename = cleanString(image.filename || (parsedMeta.filename as string));
    const folder = cleanString(parsedMeta.folder as string);
    const existingTags = Array.isArray(parsedMeta.tags)
      ? parsedMeta.tags.filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0).slice(0, 12)
      : [];

    const prompt = [
      'Analyze this image and return only a comma-separated list of semantic tags.',
      `Return exactly ${requestedCount} tags.`,
      'Separate every tag with a comma.',
      'Each tag must be a single word.',
      'Use lowercase ASCII words only.',
      'Prefer concrete scene, subject, object, mood, material, or setting terms.',
      'No phrases, no punctuation, no numbering, no explanation, no markdown.',
      'Do not collapse multiple tags into one hyphenated slug.',
      filename ? `Filename hint: ${filename}` : null,
      folder ? `Folder hint: ${folder}` : null,
      existingTags.length ? `Existing tags for context: ${existingTags.join(', ')}` : null,
    ]
      .filter(Boolean)
      .join('\n');

    const model = getOpenAiTagsModel();
    const openAiResponse = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openAiKey}`
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 120,
        messages: [
          {
            role: 'system',
            content: 'You create compact single-word semantic tags for images.'
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: imageUrl } }
            ]
          }
        ]
      })
    });

    const openAiPayload = await openAiResponse.json();
    if (!openAiResponse.ok) {
      return NextResponse.json(
        { error: openAiPayload?.error?.message || 'Failed to generate tags' },
        { status: openAiResponse.status }
      );
    }

    const raw = extractMessageText(openAiPayload?.choices?.[0]?.message?.content);
    const tags = sanitizeSingleWordSuggestedTags(raw, requestedCount);
    if (tags.length === 0) {
      return NextResponse.json({ error: 'OpenAI response did not contain usable tags' }, { status: 422 });
    }

    return NextResponse.json({ tags, model });
  } catch (error) {
    console.error('Semantic tag generation error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
