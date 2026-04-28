interface RootProjectLink {
  projectId: string;
  title: string;
  publicSlug: string;
  accessKey: string;
  sharePath: string;
  publishedAt: string;
  expiresAt?: string | null;
}

type RootStatePayload =
  | { mode: 'local-dev' }
  | { mode: 'redirect'; sharePath: string }
  | { mode: 'index'; siteName: string; projects: RootProjectLink[] }
  | { mode: 'empty'; siteName: string };

const parseJson = async <T>(response: Response): Promise<T> => {
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }
  return response.json() as Promise<T>;
};

export class RootClientApi {
  async fetchState(): Promise<RootStatePayload> {
    const response = await fetch('/api/root');
    return parseJson<RootStatePayload>(response);
  }
}

export type { RootProjectLink, RootStatePayload };
