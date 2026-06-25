import type { RuntimeToolHandler } from '../types.js';
import {
  runInstagramAuth,
  runInstagramProfileIngest,
  runInstagramSingleUrlIngest,
  runInstagramVideoRecovery,
  runInstagramVideoReplay,
  type InstagramCommandResult,
} from './commands.js';

function commandResultResponse(result: InstagramCommandResult, metadata?: Record<string, unknown>) {
  const response = {
    ok: result.ok,
    exitCode: result.exitCode,
    command: result.command,
    stdout: result.stdout,
    stderr: result.stderr,
    ...(metadata ? { metadata } : {}),
  };

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(response, null, 2),
      },
    ],
    ...(result.ok ? {} : { isError: true }),
  };
}

export const instagramHandlers: Record<string, RuntimeToolHandler> = {
  'photarium_instagram_auth': async (args: Record<string, unknown>) => {
    const { username, profileDir, headful, verbose, noColor } = args as {
      username: string;
      profileDir?: string;
      headful?: boolean;
      verbose?: boolean;
      noColor?: boolean;
    };

    const result = await runInstagramAuth({ username, profileDir, headful, verbose, noColor });
    return commandResultResponse(result, {
      interactive: true,
      purpose: 'Runs the existing Instagram auth flow and validates the persistent browser profile session.',
    });
  },

  'photarium_instagram_ingest_profile': async (args: Record<string, unknown>) => {
    const {
      username,
      namespace,
      apiBase,
      profileDir,
      count,
      maxPages,
      delayMs,
      requestDelayMs,
      output,
      checkpoint,
      downloadDir,
      pushCloudflare,
      aiDisplayName,
      skipVideoPush,
      noResume,
      headful,
      verbose,
      noColor,
    } = args as {
      username: string;
      namespace: string;
      apiBase?: string;
      profileDir?: string;
      count?: number;
      maxPages?: number;
      delayMs?: number;
      requestDelayMs?: number;
      output?: string;
      checkpoint?: string;
      downloadDir?: string;
      pushCloudflare?: boolean;
      aiDisplayName?: boolean;
      skipVideoPush?: boolean;
      noResume?: boolean;
      headful?: boolean;
      verbose?: boolean;
      noColor?: boolean;
    };

    const result = await runInstagramProfileIngest({
      username,
      namespace,
      apiBase,
      profileDir,
      count,
      maxPages,
      delayMs,
      requestDelayMs,
      output,
      checkpoint,
      downloadDir,
      pushCloudflare,
      aiDisplayName,
      skipVideoPush,
      noResume,
      headful,
      verbose,
      noColor,
    });
    return commandResultResponse(result);
  },

  'photarium_instagram_ingest_single_url': async (args: Record<string, unknown>) => {
    const {
      url,
      username,
      namespace,
      apiBase,
      profileDir,
      output,
      requestDelayMs,
      pushCloudflare,
      noPushCloudflare,
      headful,
      verbose,
      noColor,
    } = args as {
      url: string;
      username?: string;
      namespace?: string;
      apiBase?: string;
      profileDir?: string;
      output?: string;
      requestDelayMs?: number;
      pushCloudflare?: boolean;
      noPushCloudflare?: boolean;
      headful?: boolean;
      verbose?: boolean;
      noColor?: boolean;
    };

    const result = await runInstagramSingleUrlIngest({
      url,
      username,
      namespace,
      apiBase,
      profileDir,
      output,
      requestDelayMs,
      pushCloudflare,
      noPushCloudflare,
      headful,
      verbose,
      noColor,
    });
    return commandResultResponse(result);
  },

  'photarium_instagram_replay_videos': async (args: Record<string, unknown>) => {
    const { input, namespace, username, apiBase, requestDelayMs, verbose, noColor } = args as {
      input: string;
      namespace: string;
      username?: string;
      apiBase?: string;
      requestDelayMs?: number;
      verbose?: boolean;
      noColor?: boolean;
    };

    const result = await runInstagramVideoReplay({
      input,
      namespace,
      username,
      apiBase,
      requestDelayMs,
      verbose,
      noColor,
    });
    return commandResultResponse(result);
  },

  'photarium_instagram_recover_videos': async (args: Record<string, unknown>) => {
    const {
      input,
      namespace,
      username,
      apiBase,
      requestDelayMs,
      profileDir,
      limit,
      headful,
      skipResolve,
      skipReplay,
      dryRun,
      verbose,
    } = args as {
      input: string;
      namespace: string;
      username?: string;
      apiBase?: string;
      requestDelayMs?: number;
      profileDir?: string;
      limit?: number;
      headful?: boolean;
      skipResolve?: boolean;
      skipReplay?: boolean;
      dryRun?: boolean;
      verbose?: boolean;
    };

    const result = await runInstagramVideoRecovery({
      input,
      namespace,
      username,
      apiBase,
      requestDelayMs,
      profileDir,
      limit,
      headful,
      skipResolve,
      skipReplay,
      dryRun,
      verbose,
    });
    return commandResultResponse(result);
  },
};
