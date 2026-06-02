import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { getPhotariumRuntimeDataDir } from '@/server/runtimeDataDir';
import type { ClientSiteRecord } from './types';
import type { ClientSiteService } from './service';
import { resolveWorkersDevUrl } from './workersDevUrl';
import {
  buildClientSiteBaseUrl,
  getManagedClientSiteDomainConfig,
  resolveClientSiteCustomDomain,
} from './domain';

const execFileAsync = promisify(execFile);
const CLOUDFLARE_API_BASE = 'https://api.cloudflare.com/client/v4';

const adjacentWorkerRoot = path.join(process.cwd(), 'adjacent', 'photarium-client-sites');
const adjacentWranglerConfigRoot = path.join(adjacentWorkerRoot, '.wrangler', 'client-sites');
const npmExecutable = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const defaultCompatibilityDate = '2026-04-26';
const clientSiteCloudflareTokenEnvName = 'CLIENT_SITES_CLOUDFLARE_API_TOKEN';

interface DeployOptions {
  onStep?: (message: string) => void;
}

interface DoctorResult {
  ok: boolean;
  clientSiteId: string;
  workerName: string;
  publicBaseUrl: string;
  healthStatus?: number;
  healthPayload?: unknown;
  d1DatabaseName?: string;
  d1DatabaseId?: string;
  notes: string[];
}

interface CloudflareDomainRecord {
  id?: string;
  hostname?: string;
  service?: string;
}

const getRequiredEnv = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for client-site deployment.`);
  }
  return value;
};

const resolveCloudflareApiToken = (): string =>
  process.env[clientSiteCloudflareTokenEnvName]?.trim() ||
  getRequiredEnv('CLOUDFLARE_API_TOKEN');

const resolveCloudflareAccountId = (): string => getRequiredEnv('CLOUDFLARE_ACCOUNT_ID');

const buildWranglerEnv = (): NodeJS.ProcessEnv => ({
  ...process.env,
  CLOUDFLARE_API_TOKEN: resolveCloudflareApiToken(),
});

const resolveImagesAccountHash = (): string =>
  process.env.IMAGES_ACCOUNT_HASH?.trim() ||
  process.env.NEXT_PUBLIC_CLOUDFLARE_ACCOUNT_HASH?.trim() ||
  (() => {
    throw new Error(
      'Cloudflare Images account hash is required for client-site deployment. Set NEXT_PUBLIC_CLOUDFLARE_ACCOUNT_HASH in .env.local or IMAGES_ACCOUNT_HASH in adjacent/photarium-client-sites/.dev.vars. This is the account hash used in Cloudflare Images delivery URLs: https://imagedelivery.net/<ACCOUNT_HASH>/<IMAGE_ID>/public'
    );
  })();

const resolveOptionalImagesSigningKey = (): string | undefined =>
  process.env.IMAGES_SIGNING_KEY?.trim() || undefined;

const ensureDirectory = async (directoryPath: string) => {
  await fs.mkdir(directoryPath, { recursive: true });
};

const createGeneratedConfigPath = (slug: string) =>
  path.join(adjacentWranglerConfigRoot, `${slug}.wrangler.jsonc`);

const createRuntimeOutputPath = (slug: string, suffix: string) =>
  path.join(getPhotariumRuntimeDataDir(), 'client-sites', `${slug}.${suffix}`);

const parseJsonBlockFromText = (text: string): Record<string, unknown> | null => {
  const matches = text.match(/\{[\s\S]*\}/g);
  if (!matches) return null;

  for (let index = matches.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(matches[index]) as Record<string, unknown>;
    } catch {
      continue;
    }
  }
  return null;
};

const readResponseSnippet = async (response: Response): Promise<string> => {
  const text = (await response.text().catch(() => '')).trim();
  if (!text) return '';
  return text.length > 300 ? `${text.slice(0, 300)}...` : text;
};

const sanitizeWorkerLabel = (value: string): string =>
  value.replace(/[^a-zA-Z0-9-_]/g, '-');

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const writeWranglerConfig = async (clientSite: ClientSiteRecord): Promise<string> => {
  await ensureDirectory(adjacentWranglerConfigRoot);
  const configPath = createGeneratedConfigPath(clientSite.slug);
  const config = {
    $schema: '../../node_modules/wrangler/config-schema.json',
    name: clientSite.deployment.workerName,
    main: '../../src/worker/index.ts',
    compatibility_date: defaultCompatibilityDate,
    compatibility_flags: ['nodejs_compat'],
    assets: {
      directory: '../../dist/client',
      binding: 'ASSETS',
      not_found_handling: 'single-page-application',
      run_worker_first: true,
    },
    d1_databases: [
      {
        binding: 'DB',
        database_name: clientSite.deployment.d1DatabaseName,
        database_id: clientSite.deployment.d1DatabaseId,
      },
    ],
    vars: {
      PUBLIC_SITE_NAME: clientSite.name,
      IMAGES_ACCOUNT_HASH: resolveImagesAccountHash(),
      CLIENT_ROOT_DEFAULT_PATH: clientSite.rootPresentation?.defaultSharePath ?? '',
      CLIENT_ROOT_PROJECTS_JSON: JSON.stringify(clientSite.rootPresentation?.projects ?? []),
      CLIENT_BRAND_FAVICON_URL: clientSite.branding?.faviconUrl ?? '',
      CLIENT_BRAND_LOGO_URL: clientSite.branding?.logoUrl ?? '',
      CLIENT_BRAND_LOGO_ALT: clientSite.branding?.logoAlt ?? clientSite.name,
    },
  };

  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return configPath;
};

const runWrangler = async (
  args: string[],
  {
    input,
    onStep,
  }: {
    input?: string;
    onStep?: (message: string) => void;
  } = {}
) => {
  onStep?.(`wrangler ${args.join(' ')}`);
  if (!input) {
    const result = await execFileAsync(
      npmExecutable,
      ['exec', '--prefix', adjacentWorkerRoot, 'wrangler', '--', ...args],
      {
        cwd: process.cwd(),
        env: buildWranglerEnv(),
        maxBuffer: 1024 * 1024 * 8,
      }
    );
    return {
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
    };
  }

  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(
      npmExecutable,
      ['exec', '--prefix', adjacentWorkerRoot, 'wrangler', '--', ...args],
      {
        cwd: process.cwd(),
        env: buildWranglerEnv(),
        stdio: 'pipe',
      }
    );

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(`wrangler ${args.join(' ')} failed with exit code ${code}\n${stderr || stdout}`));
    });

    child.stdin.write(input);
    child.stdin.end();
  });
};

const runAdjacentBuild = async (onStep?: (message: string) => void) => {
  onStep?.('Building adjacent photarium-client-sites client bundle...');
  await execFileAsync(npmExecutable, ['run', 'build:client'], {
    cwd: adjacentWorkerRoot,
    env: buildWranglerEnv(),
    maxBuffer: 1024 * 1024 * 8,
  });
};

const writeDoctorReport = async (clientSite: ClientSiteRecord, report: DoctorResult) => {
  const outputPath = createRuntimeOutputPath(clientSite.slug, 'doctor.json');
  await ensureDirectory(path.dirname(outputPath));
  await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return outputPath;
};

const isMissingRemoteWorkerError = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  const message = error.message;
  return (
    message.includes('This Worker does not exist on your account') ||
    message.includes('[code: 10007]')
  );
};

const parseCloudflareDomainRecords = (payload: unknown): CloudflareDomainRecord[] => {
  if (!payload || typeof payload !== 'object') return [];
  const result = (payload as { result?: unknown }).result;
  if (!Array.isArray(result)) return [];
  return result
    .filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null)
    .map((entry) => ({
      id: typeof entry.id === 'string' ? entry.id : undefined,
      hostname: typeof entry.hostname === 'string' ? entry.hostname : undefined,
      service: typeof entry.service === 'string' ? entry.service : undefined,
    }));
};

export class ClientSiteDeployService {
  constructor(
    private readonly clientSiteService: ClientSiteService
  ) {}

  async createAndDeploy(clientSite: ClientSiteRecord, options: DeployOptions = {}): Promise<ClientSiteRecord> {
    const prepared = await this.ensureProvisionedDatabase(clientSite, options);
    return this.deploy(prepared, options);
  }

  async refresh(clientSite: ClientSiteRecord, options: DeployOptions = {}): Promise<ClientSiteRecord> {
    return this.deploy(clientSite, options);
  }

  async delete(clientSite: ClientSiteRecord, options: DeployOptions = {}): Promise<ClientSiteRecord> {
    const configPath = await writeWranglerConfig(clientSite);
    try {
      await this.detachCustomDomain(clientSite, options);
      options.onStep?.(`Deleting worker ${clientSite.deployment.workerName}...`);
      await runWrangler(
        ['delete', '--name', clientSite.deployment.workerName, '--config', configPath],
        options
      );
    } catch (error) {
      if (isMissingRemoteWorkerError(error)) {
        options.onStep?.(`Worker ${clientSite.deployment.workerName} does not exist remotely; marking local record deleted.`);
        return this.clientSiteService.updateStoredClientSite({
          ...clientSite,
          status: 'deleted',
          deletedAt: new Date().toISOString(),
          deployment: {
            ...clientSite.deployment,
            domainStatus: clientSite.deployment.customDomain ? 'detached' : clientSite.deployment.domainStatus,
            domainLastCheckedAt: new Date().toISOString(),
            lastDeployStatus: 'success',
            lastDeployAt: new Date().toISOString(),
            lastDeployMessage: 'Worker was already absent remotely; local record deleted.',
          },
        });
      }

      await this.clientSiteService.updateStoredClientSite({
        ...clientSite,
        status: 'inactive',
        deployment: {
          ...clientSite.deployment,
          lastDeployStatus: 'failed',
          lastDeployAt: new Date().toISOString(),
          lastDeployMessage: error instanceof Error ? error.message : 'Worker delete failed.',
        },
      });
      throw error instanceof Error
        ? new Error(`Worker delete failed after local status update: ${error.message}`)
        : new Error('Worker delete failed.');
    }

    return this.clientSiteService.updateStoredClientSite({
      ...clientSite,
      status: 'deleted',
      deletedAt: new Date().toISOString(),
      deployment: {
        ...clientSite.deployment,
        domainStatus: clientSite.deployment.customDomain ? 'detached' : clientSite.deployment.domainStatus,
        domainLastCheckedAt: new Date().toISOString(),
        lastDeployStatus: 'success',
        lastDeployAt: new Date().toISOString(),
        lastDeployMessage: 'Worker deleted via Wrangler.',
      },
    });
  }

  async doctor(clientSite: ClientSiteRecord, options: DeployOptions = {}): Promise<DoctorResult> {
    const notes: string[] = [];
    const publicBaseUrl = clientSite.deployment.publicBaseUrl.replace(/\/$/, '');

    let healthStatus: number | undefined;
    let healthPayload: unknown;
    try {
      options.onStep?.(`Checking ${publicBaseUrl}/health ...`);
      const response = await fetch(`${publicBaseUrl}/health`);
      healthStatus = response.status;
      healthPayload = await response.json().catch(() => null);
      if (!response.ok) {
        notes.push(`Health endpoint returned ${response.status}.`);
      }
    } catch (error) {
      notes.push(error instanceof Error ? error.message : 'Health check failed.');
    }

    const report: DoctorResult = {
      ok: healthStatus === 200,
      clientSiteId: clientSite.id,
      workerName: clientSite.deployment.workerName,
      publicBaseUrl,
      healthStatus,
      healthPayload,
      d1DatabaseName: clientSite.deployment.d1DatabaseName,
      d1DatabaseId: clientSite.deployment.d1DatabaseId,
      notes,
    };

    const reportPath = await writeDoctorReport(clientSite, report);
    options.onStep?.(`Wrote doctor report to ${reportPath}.`);
    return report;
  }

  private async ensureProvisionedDatabase(
    clientSite: ClientSiteRecord,
    options: DeployOptions
  ): Promise<ClientSiteRecord> {
    if (clientSite.deployment.d1DatabaseId) {
      return clientSite;
    }

    await runWrangler(['--version'], options);
    options.onStep?.(`Provisioning D1 database ${clientSite.deployment.d1DatabaseName}...`);
    const { stdout, stderr } = await runWrangler(
      ['d1', 'create', clientSite.deployment.d1DatabaseName ?? clientSite.slug],
      options
    );
    const payload = parseJsonBlockFromText(`${stdout}\n${stderr}`);
    const databaseId =
      typeof payload?.database_id === 'string'
        ? payload.database_id
        : Array.isArray(payload?.d1_databases) &&
            payload.d1_databases[0] &&
            typeof payload.d1_databases[0] === 'object' &&
            payload.d1_databases[0] !== null &&
            typeof (payload.d1_databases[0] as { database_id?: unknown }).database_id === 'string'
          ? ((payload.d1_databases[0] as { database_id: string }).database_id)
          : null;

    if (!databaseId) {
      throw new Error(`Could not parse D1 database id from Wrangler output.\n${stdout}\n${stderr}`);
    }

    return this.clientSiteService.updateStoredClientSite({
      ...clientSite,
      deployment: {
        ...clientSite.deployment,
        d1DatabaseId: databaseId,
      },
    });
  }

  private async deploy(clientSite: ClientSiteRecord, options: DeployOptions): Promise<ClientSiteRecord> {
    if (!clientSite.deployment.d1DatabaseId) {
      throw new Error('Client site is missing a D1 database id. Provision it before deploy.');
    }

    const resolvedClientSite = await this.clientSiteService.syncRootPresentation(clientSite.id);
    await runAdjacentBuild(options.onStep);
    const configPath = await writeWranglerConfig(resolvedClientSite);
    options.onStep?.(`Generated Wrangler config at ${configPath}.`);

    try {
      await runWrangler(['deploy', '--config', configPath, '--name', resolvedClientSite.deployment.workerName], options);
      await this.putSecret(resolvedClientSite, configPath, 'CLIENT_SITES_PUBLISH_SECRET', resolvedClientSite.publishSecret, options);
      await this.putSecret(
        resolvedClientSite,
        configPath,
        'ACCESS_LINK_HASH_SECRET',
        resolvedClientSite.runtimeSecrets.accessLinkHashSecret,
        options
      );
      await this.putSecret(
        resolvedClientSite,
        configPath,
        'SESSION_SIGNING_SECRET',
        resolvedClientSite.runtimeSecrets.sessionSigningSecret,
        options
      );
      const imagesSigningKey = resolveOptionalImagesSigningKey();
      if (imagesSigningKey) {
        await this.putSecret(resolvedClientSite, configPath, 'IMAGES_SIGNING_KEY', imagesSigningKey, options);
      }
    } catch (error) {
      return this.clientSiteService.updateStoredClientSite({
        ...resolvedClientSite,
        status: 'draft',
        deployment: {
          ...resolvedClientSite.deployment,
          lastDeployStatus: 'failed',
          lastDeployAt: new Date().toISOString(),
          lastDeployMessage: error instanceof Error ? error.message : 'Worker deploy failed.',
        },
      });
    }

    const workersDevUrl = await resolveWorkersDevUrl(resolvedClientSite.deployment.workerName).catch(
      () => `https://${sanitizeWorkerLabel(resolvedClientSite.deployment.workerName)}.workers.dev`
    );
    const domainDeployment = await this.attachAndVerifyCustomDomain(
      {
        ...resolvedClientSite,
        deployment: {
          ...resolvedClientSite.deployment,
          workersDevUrl,
        },
      },
      workersDevUrl,
      options
    );

    return this.clientSiteService.updateStoredClientSite({
      ...resolvedClientSite,
      status: 'deployed',
      deployment: {
        ...resolvedClientSite.deployment,
        workersDevUrl,
        publicBaseUrl: domainDeployment.publicBaseUrl,
        customDomain: domainDeployment.customDomain,
        domainStatus: domainDeployment.domainStatus,
        domainLastCheckedAt: domainDeployment.domainLastCheckedAt,
        lastDeployStatus: 'success',
        lastDeployAt: new Date().toISOString(),
        lastDeployMessage: domainDeployment.deployMessage,
      },
    });
  }

  private async putSecret(
    clientSite: ClientSiteRecord,
    configPath: string,
    key: string,
    value: string,
    options: DeployOptions
  ) {
    options.onStep?.(`Uploading secret ${key} for ${clientSite.deployment.workerName}...`);
    await runWrangler(
      ['secret', 'put', key, '--name', clientSite.deployment.workerName, '--config', configPath],
      {
        ...options,
        input: `${value}\n`,
      }
    );
  }

  private async attachAndVerifyCustomDomain(
    clientSite: ClientSiteRecord,
    workersDevUrl: string,
    options: DeployOptions
  ): Promise<{
    publicBaseUrl: string;
    customDomain?: string;
    domainStatus?: ClientSiteRecord['deployment']['domainStatus'];
    domainLastCheckedAt: string;
    deployMessage: string;
  }> {
    const customDomain = resolveClientSiteCustomDomain(clientSite.slug, clientSite.deployment.customDomain);
    if (!customDomain) {
      return {
        publicBaseUrl: workersDevUrl,
        customDomain: undefined,
        domainStatus: clientSite.deployment.domainStatus,
        domainLastCheckedAt: new Date().toISOString(),
        deployMessage: `Deployed ${clientSite.deployment.workerName}.`,
      };
    }

    const managedConfig = getManagedClientSiteDomainConfig();
    if (!managedConfig) {
      return {
        publicBaseUrl: workersDevUrl,
        customDomain,
        domainStatus: 'error',
        domainLastCheckedAt: new Date().toISOString(),
        deployMessage: `Deployed ${clientSite.deployment.workerName}, but custom domain management is unavailable.`,
      };
    }

    await this.attachCustomDomain(clientSite.deployment.workerName, customDomain, managedConfig.zoneId, options);
    const customBaseUrl = buildClientSiteBaseUrl(customDomain);
    await this.verifyPublicBaseUrl(customBaseUrl, options);

    return {
      publicBaseUrl: customBaseUrl,
      customDomain,
      domainStatus: 'attached',
      domainLastCheckedAt: new Date().toISOString(),
      deployMessage: `Deployed ${clientSite.deployment.workerName} at ${customBaseUrl}.`,
    };
  }

  private async attachCustomDomain(
    workerName: string,
    hostname: string,
    zoneId: string,
    options: DeployOptions
  ): Promise<void> {
    options.onStep?.(`Attaching custom domain ${hostname} to ${workerName}...`);
    const response = await fetch(
      `${CLOUDFLARE_API_BASE}/accounts/${resolveCloudflareAccountId()}/workers/domains`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${resolveCloudflareApiToken()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          hostname,
          service: workerName,
          zone_id: zoneId,
        }),
      }
    );

    if (!response.ok) {
      const responseSnippet = await readResponseSnippet(response);
      throw new Error(
        `Failed to attach custom domain ${hostname} (${response.status})${responseSnippet ? `: ${responseSnippet}` : ''}`
      );
    }
  }

  private async detachCustomDomain(clientSite: ClientSiteRecord, options: DeployOptions): Promise<void> {
    const hostname = clientSite.deployment.customDomain;
    if (!hostname) return;

    options.onStep?.(`Checking custom domain attachment for ${hostname}...`);
    const response = await fetch(
      `${CLOUDFLARE_API_BASE}/accounts/${resolveCloudflareAccountId()}/workers/domains?hostname=${encodeURIComponent(hostname)}`,
      {
        headers: {
          Authorization: `Bearer ${resolveCloudflareApiToken()}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!response.ok) {
      const responseSnippet = await readResponseSnippet(response);
      throw new Error(
        `Failed to inspect custom domain ${hostname} (${response.status})${responseSnippet ? `: ${responseSnippet}` : ''}`
      );
    }

    const payload = await response.json().catch(() => null);
    const matchingDomain = parseCloudflareDomainRecords(payload).find(
      (entry) =>
        entry.hostname === hostname &&
        (!entry.service || entry.service === clientSite.deployment.workerName) &&
        entry.id
    );

    if (!matchingDomain?.id) {
      options.onStep?.(`No Cloudflare domain attachment found for ${hostname}.`);
      return;
    }

    options.onStep?.(`Detaching custom domain ${hostname}...`);
    const detachResponse = await fetch(
      `${CLOUDFLARE_API_BASE}/accounts/${resolveCloudflareAccountId()}/workers/domains/${matchingDomain.id}`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${resolveCloudflareApiToken()}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!detachResponse.ok && detachResponse.status !== 404) {
      const responseSnippet = await readResponseSnippet(detachResponse);
      throw new Error(
        `Failed to detach custom domain ${hostname} (${detachResponse.status})${responseSnippet ? `: ${responseSnippet}` : ''}`
      );
    }
  }

  private async verifyPublicBaseUrl(publicBaseUrl: string, options: DeployOptions): Promise<void> {
    const healthUrl = `${publicBaseUrl.replace(/\/$/, '')}/health`;

    for (let attempt = 1; attempt <= 12; attempt += 1) {
      options.onStep?.(`Verifying ${healthUrl} (attempt ${attempt}/12)...`);
      try {
        const response = await fetch(healthUrl, { redirect: 'follow' });
        if (response.ok) return;
      } catch {
        // Retry until the custom domain and certificate are ready.
      }

      if (attempt < 12) {
        options.onStep?.(`Custom domain not live yet; waiting 5 seconds before retrying ${healthUrl}.`);
        await sleep(5000);
      }
    }

    throw new Error(`Custom domain health check never became ready at ${healthUrl}.`);
  }
}

export const createClientSiteFingerprint = (clientSite: ClientSiteRecord): string =>
  createHash('sha256')
    .update(JSON.stringify({
      id: clientSite.id,
      workerName: clientSite.deployment.workerName,
      d1DatabaseId: clientSite.deployment.d1DatabaseId,
      customDomain: clientSite.deployment.customDomain,
    }))
    .digest('hex');
