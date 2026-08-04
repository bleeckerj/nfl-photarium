import path from 'node:path';
import { BASE_URL, REPO_ROOT } from '../shared/config.js';
import { runCommandCapture } from '../shared/command-runner.js';
function scriptPath(scriptName) {
    return path.join(REPO_ROOT, 'scripts', scriptName);
}
function appendBooleanFlag(args, enabled, flag) {
    if (enabled)
        args.push(flag);
}
function appendNumberArg(args, value, flag) {
    if (typeof value === 'number')
        args.push(flag, String(value));
}
function appendStringArg(args, value, flag) {
    if (value)
        args.push(flag, value);
}
async function runNodeScript(args) {
    const result = await runCommandCapture(process.execPath, args, { cwd: REPO_ROOT });
    return {
        ok: result.exitCode === 0,
        exitCode: result.exitCode,
        command: [process.execPath, ...args],
        stdout: result.stdout,
        stderr: result.stderr,
    };
}
export async function runInstagramAuth(options) {
    const args = [scriptPath('instagram-ingest.mjs'), 'auth', '--username', options.username];
    appendStringArg(args, options.profileDir, '--profile-dir');
    appendBooleanFlag(args, options.headful, '--headful');
    appendBooleanFlag(args, options.verbose, '--verbose');
    appendBooleanFlag(args, options.noColor, '--no-color');
    return runNodeScript(args);
}
export async function runInstagramProfileIngest(options) {
    const args = [
        scriptPath('instagram-ingest.mjs'),
        'ingest',
        '--username',
        options.username,
        '--namespace',
        options.namespace,
        '--api-base',
        options.apiBase || BASE_URL,
    ];
    appendStringArg(args, options.profileDir, '--profile-dir');
    appendNumberArg(args, options.count, '--count');
    appendNumberArg(args, options.maxPages, '--max-pages');
    appendNumberArg(args, options.delayMs, '--delay-ms');
    appendNumberArg(args, options.requestDelayMs, '--request-delay-ms');
    appendStringArg(args, options.output, '--output');
    appendStringArg(args, options.checkpoint, '--checkpoint');
    appendStringArg(args, options.downloadDir, '--download-dir');
    if (options.pushCloudflare === false) {
        args.push('--no-push-cloudflare');
    }
    else if (options.pushCloudflare === true) {
        args.push('--push-cloudflare');
    }
    appendBooleanFlag(args, options.aiDisplayName, '--ai-display-name');
    appendBooleanFlag(args, options.skipVideoPush, '--skip-video-push');
    appendBooleanFlag(args, options.noResume, '--no-resume');
    appendBooleanFlag(args, options.headful, '--headful');
    appendBooleanFlag(args, options.verbose, '--verbose');
    appendBooleanFlag(args, options.noColor, '--no-color');
    return runNodeScript(args);
}
export async function runInstagramSingleUrlIngest(options) {
    const args = [scriptPath('instagram-ingest.mjs'), 'single-url', '--url', options.url];
    appendStringArg(args, options.username, '--username');
    args.push('--namespace', options.namespace || 'cf-instagram');
    args.push('--api-base', options.apiBase || BASE_URL);
    if (options.noPushCloudflare) {
        args.push('--no-push-cloudflare');
    }
    else if (options.pushCloudflare !== false) {
        args.push('--push-cloudflare');
    }
    appendStringArg(args, options.profileDir, '--profile-dir');
    appendStringArg(args, options.output, '--output');
    appendNumberArg(args, options.requestDelayMs, '--request-delay-ms');
    appendBooleanFlag(args, options.headful, '--headful');
    appendBooleanFlag(args, options.verbose, '--verbose');
    appendBooleanFlag(args, options.noColor, '--no-color');
    return runNodeScript(args);
}
export async function runInstagramVideoReplay(options) {
    const args = [
        scriptPath('instagram-ingest.mjs'),
        'videos-from-ndjson',
        '--input',
        options.input,
        '--namespace',
        options.namespace,
        '--api-base',
        options.apiBase || BASE_URL,
    ];
    appendStringArg(args, options.username, '--username');
    appendNumberArg(args, options.requestDelayMs, '--request-delay-ms');
    appendBooleanFlag(args, options.verbose, '--verbose');
    appendBooleanFlag(args, options.noColor, '--no-color');
    return runNodeScript(args);
}
export async function runInstagramVideoRecovery(options) {
    const args = [
        scriptPath('instagram-video-recover.mjs'),
        '--input',
        options.input,
        '--namespace',
        options.namespace,
        '--api-base',
        options.apiBase || BASE_URL,
    ];
    appendStringArg(args, options.username, '--username');
    appendStringArg(args, options.profileDir, '--profile-dir');
    appendNumberArg(args, options.requestDelayMs, '--request-delay-ms');
    appendNumberArg(args, options.limit, '--limit');
    appendBooleanFlag(args, options.headful, '--headful');
    appendBooleanFlag(args, options.skipResolve, '--skip-resolve');
    appendBooleanFlag(args, options.skipReplay, '--skip-replay');
    appendBooleanFlag(args, options.dryRun, '--dry-run');
    appendBooleanFlag(args, options.verbose, '--verbose');
    return runNodeScript(args);
}
