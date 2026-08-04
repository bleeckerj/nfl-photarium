import { NextResponse } from 'next/server';
import { cleanString, parseCloudflareMetadata } from '@/utils/cloudflareMetadata';
import {
  fallbackDisplayNameFromFilename,
  sanitizeSuggestedDisplayName,
} from '@/utils/displayName';
import { getOpenAiDisplayNameModel, OPENAI_CHAT_COMPLETIONS_URL } from '@/server/openAiGeneratorModels';
import { resolveVisionImageUrl } from '@/server/visionImageSource';

function extractMessageText(content: unknown): string | undefined {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return undefined;
  const merged = content
    .map((chunk) => (chunk && typeof chunk === 'object' ? (chunk as { text?: string }).text || '' : ''))
    .join(' ')
    .trim();
  return merged || undefined;
}

export async function POST(
  _request: Request,
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

    const imageResponse = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v1/${imageId}`,
      { headers: { Authorization: `Bearer ${apiToken}` } }
    );
    const imageResult = await imageResponse.json();

    if (!imageResponse.ok) {
      return NextResponse.json(
        { error: imageResult.errors?.[0]?.message || 'Failed to fetch image from Cloudflare' },
        { status: imageResponse.status }
      );
    }

    const image = imageResult.result;
    // SVG assets resolve to their rasterized companion; vision cannot decode SVG.
    const imageUrl: string | undefined = await resolveVisionImageUrl(image);
    if (!imageUrl) {
      return NextResponse.json({ error: 'No accessible image variant found' }, { status: 422 });
    }

    const parsedMeta = parseCloudflareMetadata(image.meta);
    const filename = cleanString(image.filename || (parsedMeta.filename as string));
    const folder = cleanString(parsedMeta.folder as string);
    const tags = Array.isArray(parsedMeta.tags)
      ? parsedMeta.tags.filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0).slice(0, 8)
      : [];

    const prompt = [
      'Provide a short semantic display name for this image.',
      'Return 2-5 concise words separated by single spaces.',
      'Do not return CamelCase, punctuation, markdown, or explanation.',
      'Words only. Max 64 characters total before conversion.',
      'Example outputs: red sunset lake, woman yellow raincoat, minimal wood desk setup.',
      filename ? `Filename context: ${filename}` : null,
      folder ? `Folder context: ${folder}` : null,
      tags.length ? `Tags context: ${tags.join(', ')}` : null,
    ]
      .filter(Boolean)
      .join('\n');

    const model = getOpenAiDisplayNameModel();
    const openAiResponse = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
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
          {
            role: 'system',
            content: 'You create precise short word phrases for image names.',
          },
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

    const openAiPayload = await openAiResponse.json();
    if (!openAiResponse.ok) {
      return NextResponse.json(
        { error: openAiPayload.error?.message || 'Failed to generate display name' },
        { status: openAiResponse.status }
      );
    }

    const rawSuggestion = extractMessageText(openAiPayload?.choices?.[0]?.message?.content);
    const fallback = fallbackDisplayNameFromFilename(filename);
    const displayName = rawSuggestion
      ? sanitizeSuggestedDisplayName(rawSuggestion)
      : fallback;

    return NextResponse.json({ displayName, model });
  } catch (error) {
    console.error('Display name generation error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
