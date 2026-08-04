const sharedInstagramProperties = {
    username: {
        type: 'string',
        description: 'Instagram source username, without requiring an @ prefix. For single-url ingest, omit this unless it is the post owner.',
    },
    profileDir: {
        type: 'string',
        description: 'Persistent Chromium profile directory to reuse for the Instagram session. Defaults to the CLI default when omitted.',
    },
    apiBase: {
        type: 'string',
        description: 'Photarium base URL override. Defaults to PHOTARIUM_BASE_URL / runtime BASE_URL.',
    },
    namespace: {
        type: 'string',
        description: 'Specific Photarium namespace for uploaded media.',
    },
    headful: {
        type: 'boolean',
        description: 'Run with a visible browser window instead of headless mode.',
    },
    verbose: {
        type: 'boolean',
        description: 'Increase CLI logging verbosity.',
    },
    noColor: {
        type: 'boolean',
        description: 'Disable ANSI colors in captured CLI output.',
    },
};
export const instagramTools = [
    {
        name: 'photarium_instagram_auth',
        description: 'Open the existing Instagram auth flow using a persistent Chromium profile and validate the session for a username. This is interactive and should usually be run headful.',
        inputSchema: {
            type: 'object',
            properties: {
                username: sharedInstagramProperties.username,
                profileDir: sharedInstagramProperties.profileDir,
                headful: sharedInstagramProperties.headful,
                verbose: sharedInstagramProperties.verbose,
                noColor: sharedInstagramProperties.noColor,
            },
            required: ['username'],
        },
    },
    {
        name: 'photarium_instagram_ingest_profile',
        description: 'Ingest Instagram profile feed posts through the existing authenticated CLI/browser profile flow, optionally downloading source images and pushing discovered media into Photarium. Cloudflare/Photarium push defaults to enabled; set pushCloudflare to false to opt out.',
        inputSchema: {
            type: 'object',
            properties: {
                username: sharedInstagramProperties.username,
                namespace: sharedInstagramProperties.namespace,
                apiBase: sharedInstagramProperties.apiBase,
                profileDir: sharedInstagramProperties.profileDir,
                count: { type: 'number', description: 'Items per Instagram API page.' },
                maxPages: { type: 'number', description: 'Stop after N feed pages. The CLI default is unbounded.' },
                delayMs: { type: 'number', description: 'Delay between feed page fetches in milliseconds.' },
                requestDelayMs: { type: 'number', description: 'Delay between per-asset Photarium push requests in milliseconds.' },
                output: { type: 'string', description: 'Optional NDJSON output path override.' },
                checkpoint: { type: 'string', description: 'Optional checkpoint path override.' },
                downloadDir: { type: 'string', description: 'Optional local directory to download discovered image assets.' },
                pushCloudflare: { type: 'boolean', description: 'Push discovered media to Photarium/Cloudflare. Defaults to true.' },
                aiDisplayName: { type: 'boolean', description: 'Generate display names for image uploads during ingest.' },
                skipVideoPush: { type: 'boolean', description: 'Skip pushing videos during profile ingest.' },
                noResume: { type: 'boolean', description: 'Ignore existing checkpoint and start from the newest page.' },
                headful: sharedInstagramProperties.headful,
                verbose: sharedInstagramProperties.verbose,
                noColor: sharedInstagramProperties.noColor,
            },
            required: ['username', 'namespace'],
        },
    },
    {
        name: 'photarium_instagram_ingest_single_url',
        description: 'Ingest a single Instagram post or reel URL through the existing Instagram CLI/browser profile flow. Defaults to namespace "cf-instagram" and Cloudflare push enabled.',
        inputSchema: {
            type: 'object',
            properties: {
                url: {
                    type: 'string',
                    description: 'Instagram post or reel URL to ingest.',
                },
                username: {
                    type: 'string',
                    description: 'Known owner username for the Instagram post. Omit unless the source account is known.',
                },
                namespace: {
                    type: 'string',
                    description: 'Target namespace for uploaded media. Defaults to "cf-instagram".',
                },
                apiBase: sharedInstagramProperties.apiBase,
                profileDir: sharedInstagramProperties.profileDir,
                output: {
                    type: 'string',
                    description: 'Optional NDJSON output path override.',
                },
                requestDelayMs: {
                    type: 'number',
                    description: 'Delay between per-asset push requests in milliseconds.',
                },
                pushCloudflare: {
                    type: 'boolean',
                    description: 'Push media into Photarium. Defaults to true unless noPushCloudflare is set.',
                },
                noPushCloudflare: {
                    type: 'boolean',
                    description: 'Disable Photarium/Cloudflare pushes and only write the NDJSON record.',
                },
                headful: sharedInstagramProperties.headful,
                verbose: sharedInstagramProperties.verbose,
                noColor: sharedInstagramProperties.noColor,
            },
            required: ['url'],
        },
    },
    {
        name: 'photarium_instagram_replay_videos',
        description: 'Replay video uploads from an Instagram NDJSON file through the existing videos-from-ndjson script.',
        inputSchema: {
            type: 'object',
            properties: {
                input: { type: 'string', description: 'Input Instagram NDJSON path.' },
                namespace: sharedInstagramProperties.namespace,
                username: sharedInstagramProperties.username,
                apiBase: sharedInstagramProperties.apiBase,
                requestDelayMs: { type: 'number', description: 'Delay between per-video push requests in milliseconds.' },
                verbose: sharedInstagramProperties.verbose,
                noColor: sharedInstagramProperties.noColor,
            },
            required: ['input', 'namespace'],
        },
    },
    {
        name: 'photarium_instagram_recover_videos',
        description: 'Resolve missing Instagram video URLs in an NDJSON file, then replay video uploads through the existing recovery helper.',
        inputSchema: {
            type: 'object',
            properties: {
                input: { type: 'string', description: 'Input Instagram NDJSON path to repair and replay.' },
                namespace: sharedInstagramProperties.namespace,
                username: sharedInstagramProperties.username,
                apiBase: sharedInstagramProperties.apiBase,
                requestDelayMs: { type: 'number', description: 'Delay between replay pushes in milliseconds.' },
                profileDir: sharedInstagramProperties.profileDir,
                limit: { type: 'number', description: 'Resolve at most N missing shortcodes.' },
                headful: sharedInstagramProperties.headful,
                skipResolve: { type: 'boolean', description: 'Skip URL resolution and run replay only.' },
                skipReplay: { type: 'boolean', description: 'Skip replay and run URL resolution only.' },
                dryRun: { type: 'boolean', description: 'Print planned commands without executing them.' },
                verbose: sharedInstagramProperties.verbose,
            },
            required: ['input', 'namespace'],
        },
    },
];
