import { NextRequest, NextResponse } from 'next/server';
import { cleanString, parseCloudflareMetadata } from '@/utils/cloudflareMetadata';
import { getPromptThisRecord, setPromptThisRecord, type PromptThisRecord } from '@/server/promptThis';

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

function parseForce(request: NextRequest): boolean {
  const fromQuery = request.nextUrl.searchParams.get('force');
  return fromQuery === '1' || fromQuery === 'true';
}

function pickPublicVariant(variants: unknown): string | undefined {
  if (!Array.isArray(variants)) return undefined;
  return variants.find((variant) => typeof variant === 'string' && variant.includes('public')) || variants.find((variant) => typeof variant === 'string');
}

async function fetchCloudflareImage(imageId: string) {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !apiToken) {
    return { ok: false as const, status: 500, payload: { error: 'Cloudflare credentials not configured' } };
  }

  const imageResponse = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v1/${imageId}`,
    {
      headers: {
        Authorization: `Bearer ${apiToken}`
      }
    }
  );

  const imagePayload = await imageResponse.json();
  if (!imageResponse.ok) {
    const message = imagePayload?.errors?.[0]?.message || 'Failed to fetch image from Cloudflare';
    return { ok: false as const, status: imageResponse.status, payload: { error: message, details: imagePayload } };
  }

  return { ok: true as const, status: 200, payload: imagePayload?.result };
}

function buildPromptThisUserText(options: {
  filename?: string;
  folder?: string;
  tags?: string;
  storedDescription?: string;
  storedAlt?: string;
  namespace?: string;
  existingPrompt?: string;
}) {
  const contextSegments: string[] = [];
  if (options.filename) contextSegments.push(`Filename: ${options.filename}`);
  if (options.folder) contextSegments.push(`Folder: ${options.folder}`);
  if (options.namespace) contextSegments.push(`Namespace: ${options.namespace}`);
  if (options.tags) contextSegments.push(`Tags: ${options.tags}`);
  if (options.storedDescription) contextSegments.push(`Stored description: ${options.storedDescription}`);
  if (options.storedAlt) contextSegments.push(`Stored ALT text: ${options.storedAlt}`);
  if (options.existingPrompt) contextSegments.push(`Existing prompt draft: ${options.existingPrompt}`);

  return [
    'You are a prompt engineer for text-to-image models (Stable Diffusion / ComfyUI / Midjourney-like).',
    'Create ONE high-quality, production-ready prompt that recreates the uploaded image as closely as possible.',
    'Be specific about subject, setting, composition, camera/framing, lighting, visual style (e.g. line illustration? oil painting? watercolor, vintage photograph?), visual texture, materials, color palette, and mood. Specify the visual style clearly — whether it is a line illustration, oil painting, watercolor, vintage photograph, etc. The medium greatly influences the final image, so be precise.',
    'Avoid mentioning file formats, "alt text", or "this image". Do not use markdown.',
    'Return ONLY the prompt text (no labels, no lists). Keep it under 1500 characters.',
    contextSegments.length ? `Context:\n${contextSegments.join('\n')}` : null
  ]
    .filter(Boolean)
    .join('\n\n');
}

async function generatePromptFromOpenAI(imageUrl: string, userText: string) {
  const openAiKey = process.env.OPENAI_API_KEY;
  if (!openAiKey) {
    return { ok: false as const, status: 500, payload: { error: 'OpenAI API key not configured' } };
  }

  const openAiResponse = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${openAiKey}`
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      temperature: 0.4,
      max_tokens: 1600,
      messages: [
        {
          role: 'system',
          content:
            'You write concise, high-signal prompts for generative image models. You are concrete, visual, and avoid fluff.'
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
    return {
      ok: false as const,
      status: openAiResponse.status,
      payload: { error: openAiPayload?.error?.message || 'Failed to generate prompt', details: openAiPayload }
    };
  }

  const messageContent = openAiPayload?.choices?.[0]?.message?.content;
  let promptRaw: string | undefined;
  if (typeof messageContent === 'string') {
    promptRaw = messageContent;
  } else if (Array.isArray(messageContent)) {
    promptRaw = messageContent
      .map((chunk: { text?: string }) => chunk?.text || '')
      .join(' ')
      .trim();
  }

  const prompt = cleanString(promptRaw);
  if (!prompt) {
    return { ok: false as const, status: 422, payload: { error: 'OpenAI response did not contain prompt text' } };
  }

  return { ok: true as const, status: 200, payload: { prompt } };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: imageId } = await params;
    if (!imageId) {
      return NextResponse.json({ error: 'Image ID is required' }, { status: 400 });
    }

    const record = await getPromptThisRecord(imageId);
    return NextResponse.json({ imageId, record });
  } catch (error) {
    console.error('[PromptThis] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: imageId } = await params;
    if (!imageId) {
      return NextResponse.json({ error: 'Image ID is required' }, { status: 400 });
    }

    const forceFromQuery = parseForce(request);

    let body: any = null;
    if (request.headers.get('content-type')?.includes('application/json')) {
      try {
        body = await request.json();
      } catch {
        body = null;
      }
    }

    const force = Boolean(body?.force) || forceFromQuery;
    const existingPromptFromClient = typeof body?.existingPrompt === 'string' ? body.existingPrompt : undefined;

    const existing = await getPromptThisRecord(imageId);
    if (existing && !force) {
      return NextResponse.json({ imageId, record: existing, generated: false, saved: true });
    }

    const cfImage = await fetchCloudflareImage(imageId);
    if (!cfImage.ok) {
      return NextResponse.json(cfImage.payload, { status: cfImage.status });
    }

    const image = cfImage.payload;
    const imageUrl = pickPublicVariant(image?.variants);
    if (!imageUrl) {
      return NextResponse.json({ error: 'No accessible image variant found' }, { status: 422 });
    }

    const parsedMeta = parseCloudflareMetadata(image?.meta);
    const filename = cleanString(image?.filename || (parsedMeta.filename as string));
    const folder = cleanString(parsedMeta.folder as string);
    const namespace = cleanString(parsedMeta.namespace as string);
    const tags = Array.isArray(parsedMeta.tags) ? parsedMeta.tags.filter(Boolean).join(', ') : undefined;
    const storedDescription = cleanString(parsedMeta.description as string);
    const storedAlt = cleanString(parsedMeta.altTag as string);

    const userText = buildPromptThisUserText({
      filename,
      folder,
      namespace,
      tags,
      storedDescription,
      storedAlt,
      existingPrompt: cleanString(existingPromptFromClient)
    });

    const ai = await generatePromptFromOpenAI(imageUrl, userText);
    if (!ai.ok) {
      console.error('[PromptThis] OpenAI error:', ai.payload);
      return NextResponse.json(ai.payload, { status: ai.status });
    }

    const now = new Date().toISOString();
    const record: PromptThisRecord = {
      imageId,
      prompt: ai.payload.prompt,
      model: 'gpt-4o',
      provider: 'openai',
      createdAt: existing?.createdAt || now,
      updatedAt: now
    };

    let saved = true;
    try {
      await setPromptThisRecord(record);
    } catch (storageError) {
      console.warn('[PromptThis] Failed to persist prompt:', storageError);
      saved = false;
    }

    return NextResponse.json({ imageId, record, generated: true, saved });
  } catch (error) {
    console.error('[PromptThis] POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
