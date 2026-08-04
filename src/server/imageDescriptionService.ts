import { fetchCloudflareImage, getCloudflareCredentials } from '@/server/cloudflareClient';
import { resolveVisionImageUrl } from '@/server/visionImageSource';
import { getImageExtrasRecord, patchImageExtrasRecord } from '@/server/imageExtras';
import { getOpenAiDescriptionModel, OPENAI_CHAT_COMPLETIONS_URL } from '@/server/openAiGeneratorModels';
import { cleanString, parseCloudflareMetadata } from '@/utils/cloudflareMetadata';

export class ImageDescriptionError extends Error {
  status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = 'ImageDescriptionError';
    this.status = status;
  }
}

const appendGeneratedDescription = (current: string | undefined, generated: string) => {
  const base = typeof current === 'string' ? current.trim() : '';
  return base ? `${base}\n\n${generated}` : generated;
};

export async function generateAndPersistImageDescription(params: {
  imageId: string;
  existingDescription?: string;
  overrideStoredDescription?: boolean;
}): Promise<{ description: string; persistedDescription: string }> {
  const credentials = getCloudflareCredentials();
  const image = await fetchCloudflareImage(params.imageId, credentials);
  // SVG assets resolve to their rasterized companion; vision cannot decode SVG.
  const imageUrl = await resolveVisionImageUrl(image, credentials);
  if (!imageUrl) {
    throw new ImageDescriptionError('No accessible image variant found', 422);
  }

  const parsedMeta = parseCloudflareMetadata(image.meta);
  const extrasRecord = await getImageExtrasRecord(params.imageId);
  const contextSegments: string[] = [];
  const filename = cleanString(image.filename || (parsedMeta.filename as string));
  if (filename) contextSegments.push(`Filename: ${filename}`);
  const folder = cleanString(parsedMeta.folder as string);
  if (folder) contextSegments.push(`Folder: ${folder}`);
  const tags = Array.isArray(parsedMeta.tags) ? parsedMeta.tags.filter(Boolean).join(', ') : undefined;
  if (tags) contextSegments.push(`Tags: ${tags}`);

  const hasDescriptionOverride = params.overrideStoredDescription === true;
  const storedDescription = cleanString(extrasRecord?.description) ?? cleanString(parsedMeta.description as string);
  if (!hasDescriptionOverride && storedDescription) {
    contextSegments.push(`Stored description: ${storedDescription}`);
  }
  const workingDescription = cleanString(params.existingDescription);
  if (workingDescription) contextSegments.push(`Current working copy: ${workingDescription}`);

  const prompt = [
    'Write a very concise description (one short paragraph, fewer than 700 characters) for this image used in a design portfolio CMS. Include relevant details that would help search for the image and describe its content and setting.',
    'If the image presents a familiar object, scene, setting, or person, describe it succinctly and clearly without generic phrases.',
    'Highlight the subject, objects, brands, text, setting, and visual style. Avoid lists, hashtags, process commentary, or accessibility language.',
    'Return only the description text without markdown or labels. Return no more than 700 characters.',
    contextSegments.length ? `Context:\n${contextSegments.join('\n')}` : null,
  ].filter(Boolean).join('\n\n');

  const openAiKey = process.env.OPENAI_API_KEY?.trim();
  if (!openAiKey) {
    throw new ImageDescriptionError('OpenAI API key not configured');
  }

  const response = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${openAiKey}`,
    },
    body: JSON.stringify({
      model: getOpenAiDescriptionModel(),
      temperature: 0.5,
      max_tokens: 400,
      messages: [
        {
          role: 'system',
          content: 'You craft expressive yet concise descriptions for creative project galleries. Stay specific, vivid, and professional.',
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
  const payload = await response.json();
  if (!response.ok) {
    throw new ImageDescriptionError(payload?.error?.message || 'Failed to generate description', response.status);
  }

  const messageContent = payload?.choices?.[0]?.message?.content;
  const descriptionRaw = typeof messageContent === 'string'
    ? messageContent
    : Array.isArray(messageContent)
      ? messageContent.map((chunk: { text?: string }) => chunk?.text || '').join(' ').trim()
      : undefined;
  const description = cleanString(descriptionRaw);
  if (!description) {
    throw new ImageDescriptionError('OpenAI response did not contain description text', 422);
  }

  const currentDescription = hasDescriptionOverride ? params.existingDescription : storedDescription;
  const persistedDescription = appendGeneratedDescription(currentDescription, description);
  await patchImageExtrasRecord(params.imageId, { description: persistedDescription });
  return { description, persistedDescription };
}
