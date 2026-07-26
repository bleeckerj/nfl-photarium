import { comfyAspectRatioExpansionAdapter } from '@/server/aspectRatioExpansion/comfyAdapter';
import { openAiAspectRatioExpansionAdapter } from '@/server/aspectRatioExpansion/openAiAdapter';
import type {
  AspectRatioExpansionAdapter,
  AspectRatioExpansionProvider,
  AspectRatioExpansionProviderStatus,
  ResolvedAspectRatioExpansionProvider,
} from '@/server/aspectRatioExpansion/types';

const adapters: AspectRatioExpansionAdapter[] = [
  openAiAspectRatioExpansionAdapter,
  comfyAspectRatioExpansionAdapter,
];

const adapterMap = new Map(adapters.map((adapter) => [adapter.id, adapter]));

export class AspectRatioExpansionProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AspectRatioExpansionProviderError';
  }
}

export function getAspectRatioExpansionProviderStatuses(): AspectRatioExpansionProviderStatus[] {
  return adapters.map((adapter) => adapter.getStatus());
}

function normalizeProvider(value: unknown): AspectRatioExpansionProvider {
  if (value === 'openai' || value === 'comfyui' || value === 'auto') return value;
  return 'auto';
}

export function resolveAspectRatioExpansionProvider(
  requestedProvider?: AspectRatioExpansionProvider
): AspectRatioExpansionAdapter {
  const requested = normalizeProvider(requestedProvider);
  const configured = normalizeProvider(process.env.PHOTARIUM_ASPECT_RATIO_PROVIDER);
  const preferred = requested === 'auto' ? configured : requested;
  const statuses = getAspectRatioExpansionProviderStatuses();

  const choose = (provider: ResolvedAspectRatioExpansionProvider) => {
    const adapter = adapterMap.get(provider);
    const status = statuses.find((entry) => entry.id === provider);
    if (!adapter || !status?.available) {
      throw new AspectRatioExpansionProviderError(
        status?.reason || `${provider} is not configured for aspect-ratio expansion`
      );
    }
    return adapter;
  };

  if (preferred === 'openai' || preferred === 'comfyui') {
    return choose(preferred);
  }

  const automatic = statuses.find((status) => status.available);
  if (!automatic) {
    throw new AspectRatioExpansionProviderError(
      'No aspect-ratio expansion provider is configured. Set OPENAI_API_KEY or configure ComfyUI.'
    );
  }
  return choose(automatic.id);
}
