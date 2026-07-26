import { outpaintImageToWebp } from '@/server/cropVariantService';
import type {
  AspectRatioExpansionAdapter,
  AspectRatioExpansionProviderStatus,
} from '@/server/aspectRatioExpansion/types';

const status = (): AspectRatioExpansionProviderStatus => {
  const available = Boolean(process.env.OPENAI_API_KEY?.trim());
  return {
    id: 'openai',
    label: 'OpenAI image edit',
    available,
    reason: available ? undefined : 'OPENAI_API_KEY is not configured',
  };
};

export const openAiAspectRatioExpansionAdapter: AspectRatioExpansionAdapter = {
  id: 'openai',
  label: 'OpenAI image edit',
  getStatus: status,
  async generate({ source, request, onProgress }) {
    onProgress?.('Preparing OpenAI expansion', 0.15);
    const result = await outpaintImageToWebp({
      buffer: source.buffer,
      aspectRatio: request.aspectRatio,
      placement: request.placement,
      prompt: request.instructions,
    });
    onProgress?.('OpenAI expansion ready', 0.95);
    return {
      buffer: result.buffer,
      contentType: 'image/webp',
      filename: source.filename,
      provider: 'openai',
      model: result.model,
      dimensions: {
        width: result.canvas.targetWidth,
        height: result.canvas.targetHeight,
      },
      diagnostics: {
        aspectRatio: result.canvas.aspectRatio,
        placement: result.canvas.placement,
        revisedPrompt: result.revisedPrompt || null,
      },
    };
  },
};
