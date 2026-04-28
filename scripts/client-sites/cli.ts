#!/usr/bin/env node

import { parseArgs } from 'node:util';
import { createClientSiteService } from '@/features/client-sites/server';
import { ClientSiteDeployService } from '@/features/client-sites/deployService';
import { createClientPageProjectService, createClientPagePublishService } from '@/features/client-pages/server';
import { loadClientSiteConfigFiles } from '@/features/client-sites/config';
import type { ClientSiteListItem, ClientSiteRecord } from '@/features/client-sites/types';

const usage = () => {
  console.log(`Client sites CLI

Usage:
  npm run client-sites:create -- --name "Acme"
  npm run client-sites:publish -- --project <project-id>
  npm run client-sites:republish -- --project <project-id>
  npm run client-sites:republish -- --all-published
  npm run client-sites:deploy -- --site <client-site-id>
  npm run client-sites:refresh -- --site <client-site-id>
  npm run client-sites:list
  npm run client-sites:delete -- --site <client-site-id>
  npm run client-sites:doctor -- --site <client-site-id>
`);
};

const getStringFlag = (values: Record<string, unknown>, key: string): string | undefined => {
  const value = values[key];
  return typeof value === 'string' ? value : undefined;
};

const createLogger = () => (message: string) => {
  const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
  console.log(`[${timestamp}] ${message}`);
};

const sanitizeClientSite = (clientSite: ClientSiteRecord | ClientSiteListItem) => {
  const { publishSecret: _publishSecret, runtimeSecrets: _runtimeSecrets, ...safeClientSite } = clientSite;
  return safeClientSite;
};

const isPresent = <T,>(value: T | null | undefined): value is T => value !== null && value !== undefined;

const resolveCommand = (positionals: string[]): string => {
  const [command] = positionals;
  if (!command) {
    usage();
    process.exit(1);
  }
  return command;
};

const main = async () => {
  const loadedConfigPaths = await loadClientSiteConfigFiles();
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      name: { type: 'string' },
      slug: { type: 'string' },
      site: { type: 'string' },
      project: { type: 'string' },
      'custom-domain': { type: 'string' },
      'all-published': { type: 'boolean' },
    },
  });

  const command = resolveCommand(positionals);
  const log = createLogger();
  if (loadedConfigPaths.length > 0) {
    log(`Loaded config from ${loadedConfigPaths.join(', ')}`);
  }
  const clientSiteService = createClientSiteService();
  const deployService = new ClientSiteDeployService(clientSiteService);

  if (command === 'create') {
    const name = getStringFlag(values, 'name');
    if (!name) throw new Error('--name is required.');
    const clientSite = await clientSiteService.createClientSite({
      name,
      slug: getStringFlag(values, 'slug'),
      customDomain: getStringFlag(values, 'custom-domain'),
    });
    const deployed = await deployService.createAndDeploy(clientSite, { onStep: log });
    console.log(JSON.stringify({ clientSite: sanitizeClientSite(deployed) }, null, 2));
    return;
  }

  if (command === 'list') {
    const clientSites = await clientSiteService.listClientSites();
    console.log(JSON.stringify({ clientSites: clientSites.map(sanitizeClientSite) }, null, 2));
    return;
  }

  if (command === 'deploy' || command === 'refresh' || command === 'delete' || command === 'doctor') {
    const siteId = getStringFlag(values, 'site');
    if (!siteId) throw new Error('--site is required.');
    const clientSite = await clientSiteService.getClientSite(siteId);
    if (!clientSite) throw new Error('Client site not found.');

    if (command === 'deploy' || command === 'refresh') {
      const refreshed = await deployService.refresh(clientSite, { onStep: log });
      console.log(JSON.stringify({ clientSite: sanitizeClientSite(refreshed) }, null, 2));
      return;
    }
    if (command === 'delete') {
      const deleted = await deployService.delete(clientSite, { onStep: log });
      console.log(JSON.stringify({ clientSite: sanitizeClientSite(deleted) }, null, 2));
      return;
    }

    const report = await deployService.doctor(clientSite, { onStep: log });
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  if (command === 'publish') {
    const projectId = getStringFlag(values, 'project');
    if (!projectId) throw new Error('--project is required.');
    const projectService = createClientPageProjectService();
    const publishService = createClientPagePublishService();
    const project = await projectService.getProject(projectId);
    if (!project) throw new Error('Project not found.');
    const result = await publishService.publish(project);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === 'republish') {
    const projectId = getStringFlag(values, 'project');
    const republishAll = values['all-published'] === true;
    if (!projectId && !republishAll) {
      throw new Error('Provide --project or --all-published.');
    }

    const projectService = createClientPageProjectService();
    const publishService = createClientPagePublishService();
    const targets = projectId
      ? [await projectService.getProject(projectId)]
      : (await projectService.listProjects()).filter(
          (project) => project.remoteProjectId && project.clientSiteId && project.selectedImageIds.length > 0
        );
    const projects = targets.filter(isPresent);
    if (projects.length === 0) {
      throw new Error('No matching projects found.');
    }

    const results = [];
    for (const project of projects) {
      log(`Republishing ${project.id} (${project.title})`);
      results.push(await publishService.publish(project));
    }
    console.log(JSON.stringify({ republished: results }, null, 2));
    return;
  }

  usage();
  process.exit(1);
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
