const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

const LEVEL = {
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
  trace: 5,
};

function colorize(color, text, noColor) {
  if (noColor) return text;
  return `${color}${text}${C.reset}`;
}

function stamp() {
  return new Date().toISOString();
}

export function createLogger({ verbosity = LEVEL.info, noColor = false } = {}) {
  const emit = (threshold, emoji, tag, color, message) => {
    if (verbosity < threshold) return;
    const prefix = `${colorize(C.gray, stamp(), noColor)} ${emoji} ${colorize(color, tag, noColor)}`;
    console.log(`${prefix} ${message}`);
  };

  return {
    error: (message) => emit(LEVEL.error, '💥', '[ERROR]', C.red, message),
    warn: (message) => emit(LEVEL.warn, '⚠️', '[WARN ]', C.yellow, message),
    info: (message) => emit(LEVEL.info, '📷', '[INFO ]', C.cyan, message),
    success: (message) => emit(LEVEL.info, '✅', '[ OK  ]', C.green, message),
    debug: (message) => emit(LEVEL.debug, '🧭', '[DEBUG]', C.magenta, message),
    trace: (message) => emit(LEVEL.trace, '🪵', '[TRACE]', C.blue, message),
    banner: (message) => {
      if (verbosity < LEVEL.info) return;
      console.log(colorize(`${C.bold}${C.green}`, `\n✨ ${message}`, noColor));
    },
  };
}

export function verbosityFromArgs(count) {
  return Math.max(1, Math.min(LEVEL.trace, LEVEL.info + Math.max(0, count)));
}

