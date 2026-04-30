import { NextRequest, NextResponse } from 'next/server';
import { cleanString, parseCloudflareMetadata } from '@/utils/cloudflareMetadata';
import { getPromptThisRecord, setPromptThisRecord, type PromptThisRecord } from '@/server/promptThis';

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

function parseForce(request: NextRequest): boolean {
  const fromQuery = request.nextUrl.searchParams.get('force');
  return fromQuery === '1' || fromQuery === 'true';
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function parseJsonObjectBody(request: NextRequest): Promise<Record<string, unknown> | null> {
  if (!request.headers.get('content-type')?.includes('application/json')) {
    return null;
  }

  try {
    const body = await request.json();
    return isJsonObject(body) ? body : null;
  } catch {
    return null;
  }
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
    'Create ONE highly detailed, production-ready prompt that recreates the uploaded image as closely as possible. This is not a caption; it should be a dense generative prompt with enough specificity for another model to rebuild the image.',
    'Describe concrete visual evidence from the image in rich detail: subject identity and count, poses, expressions, wardrobe, props, setting, foreground/background, composition, crop, perspective, camera angle, lens/framing cues, lighting direction, shadows, color palette, textures, materials, surface wear, typography/logos/text if visible, mood, era, style, medium, rendering/photographic qualities, and any distinctive imperfections or artifacts.',
    'Preserve specific observable details over generic adjectives. Name the visual medium clearly, such as line illustration, oil painting, watercolor, 3D render, product photo, vintage photograph, phone snapshot, editorial portrait, screenshot, UI mockup, or other visible style. Do not invent hidden context that is not visible, but include reasonable visual descriptors needed to reproduce what can be seen.',
    'Write as one flowing prompt paragraph, using semicolons or comma-separated clauses where useful. Avoid markdown, labels, bullet points, file formats, "alt text", and phrases like "this image".',
    'Return ONLY the prompt text. Aim for 1200-3000 characters when the image has enough detail; shorter is acceptable only for very simple images.',
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

  const promptModel = process.env.OPENAI_PROMPT_MODEL || 'gpt-5.5';

  const openAiResponse = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${openAiKey}`
    },
    body: JSON.stringify({
      model: promptModel,
      max_tokens: 2600,
      messages: [
        {
          role: 'system',
          content:
            'You write richly detailed, high-signal prompts for generative image models. You are concrete, visual, exhaustive about observable details, and avoid filler.'
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

  return { ok: true as const, status: 200, payload: { prompt, model: promptModel } };
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

    const body = await parseJsonObjectBody(request);

    const force = Boolean(body?.force) || forceFromQuery;
    const existingPromptFromClient = typeof body?.existingPrompt === 'string' ? body.existingPrompt : undefined;

    const existing = await getPromptThisRecord(imageId);
    const hasClientPrompt = typeof existingPromptFromClient === 'string';
    // If we already have a prompt, reuse it unless the caller explicitly forces
    // regeneration _and_ didn't provide a client prompt (cleared/edited text
    // counts as an intentional request to regenerate).
    if (existing && !force && !hasClientPrompt) {
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
      model: ai.payload.model,
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

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: imageId } = await params;
    if (!imageId) {
      return NextResponse.json({ error: 'Image ID is required' }, { status: 400 });
    }

    const body = await parseJsonObjectBody(request);

    if (!Object.prototype.hasOwnProperty.call(body ?? {}, 'prompt')) {
      return NextResponse.json({ error: 'Missing prompt' }, { status: 400 });
    }

    const prompt = cleanString(body?.prompt);
    if (!prompt) {
      return NextResponse.json({ error: 'Prompt is empty' }, { status: 422 });
    }

    const existing = await getPromptThisRecord(imageId);
    const now = new Date().toISOString();

    const record: PromptThisRecord = {
      imageId,
      prompt,
      model: 'manual',
      provider: 'manual',
      createdAt: existing?.createdAt || now,
      updatedAt: now
    };

    let saved = true;
    try {
      await setPromptThisRecord(record);
    } catch (storageError) {
      console.warn('[PromptThis] Failed to persist manual prompt edit:', storageError);
      saved = false;
    }

    return NextResponse.json({ imageId, record, saved });
  } catch (error) {
    console.error('[PromptThis] PATCH error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
