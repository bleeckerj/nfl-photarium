import { runInstagramAuth, runInstagramProfileIngest, runInstagramSingleUrlIngest, runInstagramVideoRecovery, runInstagramVideoReplay, } from './commands.js';
function commandResultResponse(result, metadata) {
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
                type: 'text',
                text: JSON.stringify(response, null, 2),
            },
        ],
        ...(result.ok ? {} : { isError: true }),
    };
}
export const instagramHandlers = {
    'photarium_instagram_auth': async (args) => {
        const { username, profileDir, headful, verbose, noColor } = args;
        const result = await runInstagramAuth({ username, profileDir, headful, verbose, noColor });
        return commandResultResponse(result, {
            interactive: true,
            purpose: 'Runs the existing Instagram auth flow and validates the persistent browser profile session.',
        });
    },
    'photarium_instagram_ingest_profile': async (args) => {
        const { username, namespace, apiBase, profileDir, count, maxPages, delayMs, requestDelayMs, output, checkpoint, downloadDir, pushCloudflare, aiDisplayName, skipVideoPush, noResume, headful, verbose, noColor, } = args;
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
    'photarium_instagram_ingest_single_url': async (args) => {
        const { url, username, namespace, apiBase, profileDir, output, requestDelayMs, pushCloudflare, noPushCloudflare, headful, verbose, noColor, } = args;
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
    'photarium_instagram_replay_videos': async (args) => {
        const { input, namespace, username, apiBase, requestDelayMs, verbose, noColor } = args;
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
    'photarium_instagram_recover_videos': async (args) => {
        const { input, namespace, username, apiBase, requestDelayMs, profileDir, limit, headful, skipResolve, skipReplay, dryRun, verbose, } = args;
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
