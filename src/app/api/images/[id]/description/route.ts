import { NextRequest, NextResponse } from 'next/server';
import { cleanString, parseCloudflareMetadata } from '@/utils/cloudflareMetadata';
import { getImageExtrasRecord, patchImageExtrasRecord } from '@/server/imageExtras';
import { getOpenAiDescriptionModel, OPENAI_CHAT_COMPLETIONS_URL } from '@/server/openAiGeneratorModels';

const appendGeneratedDescription = (current: string | undefined, generated: string) => {
  const base = typeof current === 'string' ? current.trim() : '';
  return base ? `${base}\n\n${generated}` : generated;
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
      return NextResponse.json(
        { error: 'Cloudflare credentials not configured' },
        { status: 500 }
      );
    }

    if (!openAiKey) {
      return NextResponse.json(
        { error: 'OpenAI API key not configured' },
        { status: 500 }
      );
    }

    const { id: imageId } = await params;
    if (!imageId) {
      return NextResponse.json({ error: 'Image ID is required' }, { status: 400 });
    }

    let existingDescriptionFromClient: string | undefined;
    if (request.headers.get('content-type')?.includes('application/json')) {
      try {
        const body = await request.json();
        if (typeof body?.existingDescription === 'string') {
          existingDescriptionFromClient = body.existingDescription;
        }
      } catch {
        // Ignore malformed JSON bodies. We'll just omit client context.
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
      console.error('Cloudflare API error (fetch image):', imageResult);
      return NextResponse.json(
        { error: imageResult.errors?.[0]?.message || 'Failed to fetch image from Cloudflare' },
        { status: imageResponse.status }
      );
    }

    const image = imageResult.result;
    const imageUrl: string | undefined =
      image.variants?.find((variant: string) => variant.includes('public')) ||
      image.variants?.[0];

    if (!imageUrl) {
      return NextResponse.json(
        { error: 'No accessible image variant found' },
        { status: 422 }
      );
    }

    const parsedMeta = parseCloudflareMetadata(image.meta);
    const extrasRecord = await getImageExtrasRecord(imageId);
    const contextSegments: string[] = [];
    const filename = cleanString(image.filename || (parsedMeta.filename as string));
    if (filename) {
      contextSegments.push(`Filename: ${filename}`);
    }
    const folder = cleanString(parsedMeta.folder as string);
    if (folder) {
      contextSegments.push(`Folder: ${folder}`);
    }
    const tags = Array.isArray(parsedMeta.tags)
      ? parsedMeta.tags.filter(Boolean).join(', ')
      : undefined;
    if (tags) {
      contextSegments.push(`Tags: ${tags}`);
    }
    const hasClientWorkingCopy = existingDescriptionFromClient !== undefined;
    const storedDescription =
      cleanString(extrasRecord?.description) ?? cleanString(parsedMeta.description as string);
    if (!hasClientWorkingCopy && storedDescription) {
      contextSegments.push(`Stored description: ${storedDescription}`);
    }
    const clientDraft = cleanString(existingDescriptionFromClient);
    if (clientDraft) {
      contextSegments.push(`Current working copy: ${clientDraft}`);
    }

    const userText = [
      'Write a very concise description (1 short paragraphs, fewer than 700 characters) for this image used in a design portfolio CMS. Include relevant details that would help with a search for the image and a description of its content and setting.',
      'If the image presents a familiar object, scene, setting, or person (type of product, interior, landscape, etc.), describe it or them succintly and clearly but avoid generic phrases.',
      'Highlight the subject, objects, brands, text, setting, visual style. Avoid lists, hashtags, or referencing accessibility requirements.',
      'Return only the description text without markdown or labels. Return no more than 700 characters',
      contextSegments.length ? `Context:\n${contextSegments.join('\n')}` : null
    ]
      .filter(Boolean)
      .join('\n\n');

    const descriptionModel = getOpenAiDescriptionModel();

    const openAiResponse = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openAiKey}`
      },
      body: JSON.stringify({
        model: descriptionModel,
        temperature: 0.5,
        max_tokens: 400,
        messages: [
          {
            role: 'system',
            content:
              'You craft expressive yet concise descriptions for creative project galleries. Stay specific, vivid, and professional.'
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: userText },
              { type: 'image_url', image_url: { url: imageUrl } }
            ]
          }
        ]
      })
    });

    const openAiPayload = await openAiResponse.json();
    if (!openAiResponse.ok) {
      console.error('OpenAI API error (description):', openAiPayload);
      return NextResponse.json(
        { error: openAiPayload.error?.message || 'Failed to generate description' },
        { status: openAiResponse.status }
      );
    }

    const messageContent = openAiPayload?.choices?.[0]?.message?.content;
    let descriptionRaw: string | undefined;
    if (typeof messageContent === 'string') {
      descriptionRaw = messageContent;
    } else if (Array.isArray(messageContent)) {
      descriptionRaw = messageContent
        .map((chunk: { text?: string }) => chunk?.text || '')
        .join(' ')
        .trim();
    }

    const description = cleanString(descriptionRaw);
    if (!description) {
      return NextResponse.json(
        { error: 'OpenAI response did not contain description text' },
        { status: 422 }
      );
    }

    const persistedDescription = appendGeneratedDescription(
      hasClientWorkingCopy ? existingDescriptionFromClient : storedDescription,
      description
    );
    await patchImageExtrasRecord(imageId, { description: persistedDescription });

    return NextResponse.json({ description, persistedDescription, saved: true });
  } catch (error) {
    console.error('Description generation error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
