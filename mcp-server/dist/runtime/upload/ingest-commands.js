import path from 'node:path';
import { BASE_URL, REPO_ROOT } from '../shared/config.js';
import { runCommandCapture } from '../shared/command-runner.js';
export async function runFilesystemIngest(options) {
    const scriptPath = path.join(REPO_ROOT, 'scripts', 'fs-ingest.mjs');
    const args = [scriptPath, '--root', options.rootPath, '--namespace', options.namespace];
    if (options.apiBase)
        args.push('--api-base', options.apiBase);
    if (options.folder)
        args.push('--folder', options.folder);
    if (options.tags && options.tags.length > 0)
        args.push('--tags', options.tags.join(','));
    if (options.descriptionPrefix)
        args.push('--description-prefix', options.descriptionPrefix);
    if (options.includeFilename)
        args.push('--include-filename');
    if (options.includePathTags)
        args.push('--include-path-tags');
    if (options.aiMetadata)
        args.push('--ai-metadata');
    if (options.aiDisplayName)
        args.push('--ai-display-name');
    if (options.aiTags)
        args.push('--ai-tags');
    if (typeof options.tagCount === 'number')
        args.push('--tag-count', String(options.tagCount));
    if (typeof options.concurrency === 'number')
        args.push('--concurrency', String(options.concurrency));
    if (typeof options.throttleMs === 'number')
        args.push('--throttle-ms', String(options.throttleMs));
    if (typeof options.limit === 'number')
        args.push('--limit', String(options.limit));
    if (options.dryRun)
        args.push('--dry-run');
    if (options.verbose)
        args.push('--verbose');
    const result = await runCommandCapture(process.execPath, args, { cwd: REPO_ROOT });
    return {
        ok: result.exitCode === 0,
        exitCode: result.exitCode,
        command: [process.execPath, ...args],
        stdout: result.stdout,
        stderr: result.stderr,
    };
}
export async function runInstagramSingleUrlIngest(options) {
    const scriptPath = path.join(REPO_ROOT, 'scripts', 'instagram-ingest.mjs');
    const args = [scriptPath, 'single-url', '--url', options.url, '--push-cloudflare'];
    args.push('--username', options.username || 'darthjulian');
    args.push('--namespace', options.namespace || 'ig-videos');
    args.push('--api-base', options.apiBase || BASE_URL);
    if (options.profileDir)
        args.push('--profile-dir', options.profileDir);
    if (options.output)
        args.push('--output', options.output);
    if (typeof options.requestDelayMs === 'number') {
        args.push('--request-delay-ms', String(options.requestDelayMs));
    }
    if (options.headful)
        args.push('--headful');
    if (options.verbose)
        args.push('--verbose');
    const result = await runCommandCapture(process.execPath, args, { cwd: REPO_ROOT });
    return {
        ok: result.exitCode === 0,
        exitCode: result.exitCode,
        command: [process.execPath, ...args],
        stdout: result.stdout,
        stderr: result.stderr,
    };
}
export async function runDiscordRefreshAndIngest(options) {
    const scriptPath = path.join(REPO_ROOT, 'scripts', 'discord-refresh-and-fs-ingest.sh');
    const args = ['bash', scriptPath];
    if (options.discordRepo)
        args.push('--discord-repo', options.discordRepo);
    if (options.imagesRoot)
        args.push('--images-root', options.imagesRoot);
    if (options.namespace)
        args.push('--namespace', options.namespace);
    if (options.visuallyNamespace)
        args.push('--visually-namespace', options.visuallyNamespace);
    if (options.autotraderNamespace)
        args.push('--autotrader-namespace', options.autotraderNamespace);
    if (options.apiBase)
        args.push('--api-base', options.apiBase);
    if (options.checkpointFile)
        args.push('--checkpoint-file', options.checkpointFile);
    if (options.tags && options.tags.length > 0)
        args.push('--tags', options.tags.join(','));
    if (options.appendImageTag)
        args.push('--append-image-tag', options.appendImageTag);
    if (options.descriptionPrefix)
        args.push('--description-prefix', options.descriptionPrefix);
    if (typeof options.tagCount === 'number')
        args.push('--tag-count', String(options.tagCount));
    if (typeof options.concurrency === 'number')
        args.push('--concurrency', String(options.concurrency));
    if (typeof options.throttleMs === 'number')
        args.push('--throttle-ms', String(options.throttleMs));
    if (options.noAiMetadata)
        args.push('--no-ai-metadata');
    if (options.includePathTags)
        args.push('--include-path-tags');
    if (options.includeFilename)
        args.push('--include-filename');
    if (options.hashCacheBackfillOnly)
        args.push('--hash-cache-backfill-only');
    if (options.reportCache)
        args.push('--report-cache');
    if (options.assumeUploaded)
        args.push('--assume-uploaded');
    if (options.skipDiscordRefresh)
        args.push('--skip-discord-refresh');
    if (options.skipIngest)
        args.push('--skip-ingest');
    if (options.dryRun)
        args.push('--dry-run');
    if (options.verbose)
        args.push('--verbose');
    const result = await runCommandCapture(args[0], args.slice(1), { cwd: REPO_ROOT });
    return {
        ok: result.exitCode === 0,
        exitCode: result.exitCode,
        command: args,
        stdout: result.stdout,
        stderr: result.stderr,
    };
}
// Tool implementations
