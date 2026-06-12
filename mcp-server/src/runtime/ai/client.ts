import { apiRequest } from '../shared/api-client.js';
import type { ConceptScore } from '../types.js';

export async function generateAlt(imageId: string): Promise<{ altTag: string }> {
  const data = await apiRequest<{ altTag: string }>(`/api/images/${imageId}/alt`, {
    method: 'POST',
  });
  return data;
}

export async function generateDescription(
  imageId: string,
  options: { existingDescription?: string } = {}
): Promise<{ description: string }> {
  const data = await apiRequest<{ description: string }>(`/api/images/${imageId}/description`, {
    method: 'POST',
    body: options.existingDescription ? JSON.stringify({ existingDescription: options.existingDescription }) : undefined,
  });
  return data;
}

export async function generatePrompt(
  imageId: string,
  options: { force?: boolean; existingPrompt?: string } = {}
): Promise<{ prompt?: string; record?: unknown; generated?: boolean; saved?: boolean }> {
  const params = new URLSearchParams();
  if (options.force) params.set('force', '1');
  const query = params.toString();
  const data = await apiRequest<{ prompt?: string; record?: unknown; generated?: boolean; saved?: boolean }>(`/api/images/${imageId}/prompt${query ? `?${query}` : ''}`, {
    method: 'POST',
    body: JSON.stringify({
      force: options.force,
      existingPrompt: options.existingPrompt,
    }),
  });
  return data;
}

export async function getConcepts(imageId: string): Promise<{ concepts: ConceptScore[] }> {
  const data = await apiRequest<{ concepts: ConceptScore[] }>(`/api/images/${imageId}/concepts`, {
    method: 'POST',
  });
  return data;
}

export async function getPromptsBulk(imageIds: string[]): Promise<Record<string, string | null>> {
  const params = new URLSearchParams();
  params.set('ids', imageIds.join(','));
  const data = await apiRequest<{ prompts: Record<string, string | null> }>(`/api/images/prompts?${params}`);
  return data.prompts;
}

export async function getPromptRecord(imageId: string): Promise<{ imageId: string; record: unknown | null }> {
  return apiRequest(`/api/images/${imageId}/prompt`);
}

export async function getHaiku(imageId: string): Promise<{ imageId: string; haiku: string; lines: string[] }> {
  return apiRequest(`/api/images/${imageId}/haiku`, { method: 'POST' });
}
