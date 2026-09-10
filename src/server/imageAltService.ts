import { patchImageExtrasRecord } from '@/server/imageExtras';
import { getOpenAiAltModel, OPENAI_CHAT_COMPLETIONS_URL } from '@/server/openAiGeneratorModels';
import { resolveVisionImageUrl } from '@/server/visionImageSource';
import { cleanString } from '@/utils/cloudflareMetadata';

type CloudflareImageResponse = {
  result?: {
    id: string;
    filename?: string;
    variants?: string[];
    meta?: unknown;
  };
  errors?: { message?: string }[];
};

type AltCompletionResponse = {
  choices?: { message?: { content?: unknown } }[];
  error?: { message?: string };
};

export class ImageAltError extends Error {
  constructor(message: string, public readonly status = 500) {
    super(message);
    this.name = 'ImageAltError';
  }
}

export async function generateAndPersistImageAlt(imageId: string): Promise<{ altTag: string }> {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !apiToken) {
    throw new ImageAltError('Cloudflare credentials not configured');
  }
  const openAiKey = process.env.OPENAI_API_KEY;
  if (!openAiKey) {
    throw new ImageAltError('OpenAI API key not configured');
  }

  const imageResponse = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v1/${imageId}`,
    {
      headers: {
        Authorization: `Bearer ${apiToken}`,
      },
    }
  );

  const imageResult: CloudflareImageResponse = await imageResponse.json();
  if (!imageResponse.ok) {
    throw new ImageAltError(
      imageResult.errors?.[0]?.message || 'Failed to fetch image from Cloudflare',
      imageResponse.status
    );
  }

  const image = imageResult.result;
  if (!image) {
    throw new ImageAltError('Cloudflare response did not contain an image', 502);
  }
  // SVG assets resolve to their rasterized companion; vision cannot decode SVG.
  const imageUrl: string | undefined = await resolveVisionImageUrl(image, { accountId, apiToken });

  if (!imageUrl) {
    throw new ImageAltError('No accessible image variant found', 422);
  }

  const prompt = 'You are an accessibility assistant. Provide a concise, objective alt text (max 120 characters) that describes the main subject and context of the image.';

  const altModel = getOpenAiAltModel();

  const openAiResponse = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${openAiKey}`,
    },
    body: JSON.stringify({
      model: altModel,
      temperature: 0.2,
      max_tokens: 150,
      messages: [
        { role: 'system', content: prompt },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Describe this image for use as an HTML alt attribute.' },
            { type: 'image_url', image_url: { url: imageUrl } }
          ]
        }
      ]
    })
  });

  const openAiPayload: AltCompletionResponse = await openAiResponse.json();
  if (!openAiResponse.ok) {
    throw new ImageAltError(
      openAiPayload.error?.message || 'Failed to generate ALT text',
      openAiResponse.status
    );
  }

  const messageContent = openAiPayload?.choices?.[0]?.message?.content;
  let altTextRaw: string | undefined;

  if (typeof messageContent === 'string') {
    altTextRaw = messageContent;
  } else if (Array.isArray(messageContent)) {
    altTextRaw = messageContent
      .map((chunk: unknown) =>
        chunk && typeof chunk === 'object' && 'text' in chunk && typeof chunk.text === 'string'
          ? chunk.text
          : ''
      )
      .join(' ')
      .trim();
  }

  const altText = cleanString(altTextRaw);

  if (!altText) {
    throw new ImageAltError('OpenAI response did not contain ALT text', 422);
  }

  // Extras writes preserve the image record and invalidate its gallery/search projections.
  await patchImageExtrasRecord(imageId, { altText });
  return { altTag: altText };
}
