export const MAX_VERBOSITY = 4;

const LOG_LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
  trace: 4,
};

const ANSI = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  magenta: '\x1b[35m',
};

let logVerbose = MAX_VERBOSITY;
let logColor = Boolean(process.stdout.isTTY);

function toLocalTimestamp() {
  const now = new Date();
  const date = now.toLocaleDateString('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const time = now.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  return `${date} ${time}.${String(now.getMilliseconds()).padStart(3, '0')}`;
}

function stringifyLogArg(value) {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.stack || value.message;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function linePrefix(level) {
  if (level === 'error') return { emoji: '💥', color: ANSI.red };
  if (level === 'warn') return { emoji: '⚠️', color: ANSI.yellow };
  if (level === 'info') return { emoji: '🚀', color: ANSI.cyan };
  if (level === 'debug') return { emoji: '🧭', color: ANSI.green };
  return { emoji: '🧪', color: ANSI.magenta };
}

function shouldLog(level) {
  return LOG_LEVELS[level] <= logVerbose;
}

function emitLog(level, args) {
  if (!shouldLog(level)) return;
  const rendered = args.map(stringifyLogArg).join(' ');
  const lines = rendered.split('\n');
  const { emoji, color } = linePrefix(level);
  const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  const stamp = `[${toLocalTimestamp()}]`;
  for (const line of lines) {
    if (logColor) {
      stream.write(`${ANSI.dim}${stamp}${ANSI.reset} ${emoji} ${color}${line}${ANSI.reset}\n`);
    } else {
      stream.write(`${stamp} ${emoji} ${line}\n`);
    }
  }
}

export function setupLogger({ verbosity, color }) {
  logVerbose = Math.max(0, Math.min(MAX_VERBOSITY, Number(verbosity) || 0));
  logColor = Boolean(color);
  console.log = (...args) => emitLog('info', args);
  console.info = (...args) => emitLog('info', args);
  console.warn = (...args) => emitLog('warn', args);
  console.error = (...args) => emitLog('error', args);
  console.debug = (...args) => emitLog('debug', args);
}

export function trace(...args) {
  emitLog('trace', args);
}
