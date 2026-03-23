import path from 'node:path';
import {
  DEFAULT_API_BASE,
  DEFAULT_API_THROTTLE_MS,
  DEFAULT_AUTH_FILE,
  DEFAULT_CONCURRENCY,
  DEFAULT_NAMESPACE,
  DEFAULT_RETRY_BASE_MS,
  DEFAULT_RETRY_MAX,
  DEFAULT_SELECTOR,
  DEFAULT_STATE_DIR,
  DEFAULT_TAG_MODE,
  DEFAULT_UPLOAD_THROTTLE_MS,
  selectorFingerprint,
} from './constants.mjs';
import { expandHome, parseInteger } from './util.mjs';
import { verbosityFromArgs } from './logger.mjs';

export function printUsage() {
  console.log(`Flickr Ingest CLI

Usage:
  node scripts/flickr-ingest.mjs auth [options]
  node scripts/flickr-ingest.mjs ingest [options]

Auth options:
  --api-key <key>              Flickr API key (or env FLICKR_API_KEY)
  --api-secret <secret>        Flickr API secret (or env FLICKR_API_SECRET)
  --auth-file <path>           Auth token file (default: data/flickr-ingest/auth.json)

Ingest options:
  --api-base <url>             Photarium base URL (default: http://localhost:3000)
  --namespace <name>           Photarium namespace (default: cf-flickr)
  --selector <all|album|tag>   Selector mode (default: all)
  --album <title>              Album title selector, repeatable
  --album-id <id>              Explicit Flickr album/photoset id, repeatable
  --tag <tag>                  Flickr tag selector, repeatable
  --tag-mode <any|all>         Tag search mode (default: any)
  --checkpoint-file <path>     Override checkpoint file path
  --run-log-file <path>        Override NDJSON run log file path
  --auth-file <path>           Auth token file (default: data/flickr-ingest/auth.json)
  --concurrency <n>            Parallel photo workers (default: 2)
  --api-throttle-ms <n>        Min interval between Flickr API calls (default: 250)
  --throttle-ms <n>            Min interval between Photarium uploads (default: 400)
  --retry-max <n>              Retry attempts for network failures (default: 4)
  --retry-base-ms <n>          Base backoff delay in ms (default: 1200)
  --limit <n>                  Stop after N selected photos
  --dry-run                    Resolve and log work without uploading
  --no-resume                  Ignore prior checkpoint success states
  --no-color                   Disable ANSI colors
  -v, -vv, -vvv, -vvvv, -vvvvv Increase verbosity
  --help                       Show this help
`);
}

function buildSelectorSpec(options) {
  return {
    selector: options.selector,
    albums: options.albums,
    albumIds: options.albumIds,
    tags: options.tags,
    tagMode: options.tagMode,
    namespace: options.namespace,
  };
}

function defaultCheckpointPath(stateDir, selectorSpec) {
  return path.resolve(stateDir, 'checkpoints', `${selectorFingerprint(selectorSpec)}.json`);
}

function defaultRunLogPath(stateDir, selectorSpec) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.resolve(stateDir, 'runs', `${stamp}-${selectorFingerprint(selectorSpec)}.ndjson`);
}

export function parseCliArgs(argv) {
  const command = !argv[0] || argv[0].startsWith('-') ? 'help' : argv[0];
  const startIndex = command === 'help' && argv[0]?.startsWith('-') ? 0 : 1;
  let verboseCount = 0;

  const options = {
    command,
    help: command === 'help',
    errors: [],
    apiKey: process.env.FLICKR_API_KEY || '',
    apiSecret: process.env.FLICKR_API_SECRET || '',
    apiBase: DEFAULT_API_BASE,
    authFile: path.resolve(expandHome(DEFAULT_AUTH_FILE)),
    stateDir: path.resolve(expandHome(DEFAULT_STATE_DIR)),
    namespace: DEFAULT_NAMESPACE,
    selector: DEFAULT_SELECTOR,
    albums: [],
    albumIds: [],
    tags: [],
    tagMode: DEFAULT_TAG_MODE,
    checkpointFile: '',
    runLogFile: '',
    concurrency: DEFAULT_CONCURRENCY,
    apiThrottleMs: DEFAULT_API_THROTTLE_MS,
    throttleMs: DEFAULT_UPLOAD_THROTTLE_MS,
    retryMax: DEFAULT_RETRY_MAX,
    retryBaseMs: DEFAULT_RETRY_BASE_MS,
    limit: 0,
    dryRun: false,
    resume: true,
    noColor: false,
    verbosity: 3,
  };

  for (let i = startIndex; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    const requireValue = () => {
      if (!next || next.startsWith('-')) {
        options.errors.push(`Missing value for ${arg}`);
        return false;
      }
      return true;
    };

    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--api-key') {
      if (!requireValue()) continue;
      options.apiKey = next.trim();
      i += 1;
    } else if (arg === '--api-secret') {
      if (!requireValue()) continue;
      options.apiSecret = next.trim();
      i += 1;
    } else if (arg === '--api-base') {
      if (!requireValue()) continue;
      options.apiBase = next.trim().replace(/\/+$/, '');
      i += 1;
    } else if (arg === '--auth-file') {
      if (!requireValue()) continue;
      options.authFile = path.resolve(expandHome(next));
      i += 1;
    } else if (arg === '--namespace') {
      if (!requireValue()) continue;
      options.namespace = next.trim();
      i += 1;
    } else if (arg === '--selector') {
      if (!requireValue()) continue;
      options.selector = next.trim().toLowerCase();
      i += 1;
    } else if (arg === '--album') {
      if (!requireValue()) continue;
      options.albums.push(next.trim());
      i += 1;
    } else if (arg === '--album-id') {
      if (!requireValue()) continue;
      options.albumIds.push(next.trim());
      i += 1;
    } else if (arg === '--tag') {
      if (!requireValue()) continue;
      options.tags.push(next.trim());
      i += 1;
    } else if (arg === '--tag-mode') {
      if (!requireValue()) continue;
      options.tagMode = next.trim().toLowerCase();
      i += 1;
    } else if (arg === '--checkpoint-file') {
      if (!requireValue()) continue;
      options.checkpointFile = path.resolve(expandHome(next));
      i += 1;
    } else if (arg === '--run-log-file') {
      if (!requireValue()) continue;
      options.runLogFile = path.resolve(expandHome(next));
      i += 1;
    } else if (arg === '--concurrency') {
      if (!requireValue()) continue;
      options.concurrency = parseInteger(next, DEFAULT_CONCURRENCY);
      i += 1;
    } else if (arg === '--api-throttle-ms') {
      if (!requireValue()) continue;
      options.apiThrottleMs = parseInteger(next, DEFAULT_API_THROTTLE_MS);
      i += 1;
    } else if (arg === '--throttle-ms') {
      if (!requireValue()) continue;
      options.throttleMs = parseInteger(next, DEFAULT_UPLOAD_THROTTLE_MS);
      i += 1;
    } else if (arg === '--retry-max') {
      if (!requireValue()) continue;
      options.retryMax = parseInteger(next, DEFAULT_RETRY_MAX);
      i += 1;
    } else if (arg === '--retry-base-ms') {
      if (!requireValue()) continue;
      options.retryBaseMs = parseInteger(next, DEFAULT_RETRY_BASE_MS);
      i += 1;
    } else if (arg === '--limit') {
      if (!requireValue()) continue;
      options.limit = parseInteger(next, 0);
      i += 1;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--resume') {
      options.resume = true;
    } else if (arg === '--no-resume') {
      options.resume = false;
    } else if (arg === '--no-color') {
      options.noColor = true;
    } else if (arg === '-v' || arg === '--verbose') {
      verboseCount += 1;
    } else if (/^-v{2,5}$/.test(arg)) {
      verboseCount += arg.length - 1;
    } else if (arg.startsWith('-')) {
      options.errors.push(`Unknown option: ${arg}`);
    } else {
      options.errors.push(`Unexpected positional argument: ${arg}`);
    }
  }

  options.verbosity = verbosityFromArgs(verboseCount);
  options.albums = Array.from(new Set(options.albums.filter(Boolean)));
  options.albumIds = Array.from(new Set(options.albumIds.filter(Boolean)));
  options.tags = Array.from(new Set(options.tags.filter(Boolean)));

  if (!['auth', 'ingest', 'help'].includes(options.command)) {
    options.errors.push(`Unknown command: ${options.command}`);
  }

  if (options.command === 'auth') {
    if (!options.apiKey) options.errors.push('Missing Flickr API key. Use --api-key or FLICKR_API_KEY.');
    if (!options.apiSecret) options.errors.push('Missing Flickr API secret. Use --api-secret or FLICKR_API_SECRET.');
  }

  if (options.command === 'ingest') {
    if (!['all', 'album', 'tag'].includes(options.selector)) {
      options.errors.push(`Invalid selector: ${options.selector}`);
    }
    if (!['any', 'all'].includes(options.tagMode)) {
      options.errors.push(`Invalid tag mode: ${options.tagMode}`);
    }
    if (!options.namespace || ['__all__', '__none__', 'undefined'].includes(options.namespace)) {
      options.errors.push('Provide a specific --namespace.');
    }
    if (options.selector === 'album' && options.albums.length === 0 && options.albumIds.length === 0) {
      options.errors.push('Album selector requires --album and/or --album-id.');
    }
    if (options.selector === 'tag' && options.tags.length === 0) {
      options.errors.push('Tag selector requires at least one --tag.');
    }
  }

  const selectorSpec = buildSelectorSpec(options);
  options.checkpointFile = options.checkpointFile || defaultCheckpointPath(options.stateDir, selectorSpec);
  options.runLogFile = options.runLogFile || defaultRunLogPath(options.stateDir, selectorSpec);

  return options;
}
