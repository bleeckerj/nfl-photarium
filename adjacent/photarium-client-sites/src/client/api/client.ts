import type { ClientAsset, ClientProject } from '@client/domain/types';
import { createBootstrapErrorFromResponse } from '@client/bootstrap/errors';

const parseJson = async <T>(response: Response): Promise<T> => {
  if (!response.ok) {
    throw createBootstrapErrorFromResponse(response);
  }

  return response.json() as Promise<T>;
};

export class ClientSiteApi {
  constructor(private readonly projectSlug: string) {}

  async ensureSession(accessKey: string): Promise<void> {
    const response = await fetch(`/api/p/${this.projectSlug}/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessKey }),
    });

    await parseJson(response);
  }

  async fetchProject(): Promise<ClientProject> {
    const response = await fetch(`/api/p/${this.projectSlug}`);
    const data = await parseJson<{ project: ClientProject }>(response);
    return data.project;
  }

  async fetchAssets(): Promise<ClientAsset[]> {
    const response = await fetch(`/api/p/${this.projectSlug}/assets`);
    const data = await parseJson<{ assets: ClientAsset[] }>(response);
    return data.assets;
  }

  async submitShortlist(input: {
    clientName?: string;
    clientEmail?: string;
    note?: string;
    selectedAssetIds: string[];
  }): Promise<void> {
    const response = await fetch(`/api/p/${this.projectSlug}/shortlists`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        schemaVersion: '2026-04-01',
        clientSessionId: crypto.randomUUID(),
        ...input,
      }),
    });

    await parseJson(response);
  }
}
