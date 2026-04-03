interface LocalDevStatusPayload {
  ok: true;
  mode: 'local-dev';
  environmentLabel: string;
  origin: string;
  rootUrl: string;
  serviceName: string;
}

interface LocalDevDemoPayload {
  ok: true;
  projectId: string;
  publicSlug: string;
  accessKey: string;
  projectUrl: string;
  assetCount: number;
  revisionId: string;
}

const parseJson = async <T>(response: Response): Promise<T> => {
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }

  return response.json() as Promise<T>;
};

export class LocalDevApi {
  async fetchStatus(): Promise<LocalDevStatusPayload> {
    const response = await fetch('/api/dev/status');
    return parseJson<LocalDevStatusPayload>(response);
  }

  async createDemo(): Promise<LocalDevDemoPayload> {
    const response = await fetch('/api/dev/demo', {
      method: 'POST',
    });

    return parseJson<LocalDevDemoPayload>(response);
  }
}

export type { LocalDevStatusPayload, LocalDevDemoPayload };

