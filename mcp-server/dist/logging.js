const LEVELS = {
    error: 0,
    info: 1,
    debug: 2,
    trace: 3,
};
function normalizeLevel(value) {
    const lowered = value?.toLowerCase();
    if (lowered === 'debug' || lowered === 'trace' || lowered === 'error') {
        return lowered;
    }
    return 'info';
}
function write(level, message, data) {
    const payload = data && Object.keys(data).length > 0 ? ` ${JSON.stringify(data)}` : '';
    process.stderr.write(`[${level}] ${message}${payload}\n`);
}
export function createLogger(levelOverride) {
    const level = normalizeLevel(levelOverride ?? process.env.PHOTARIUM_MCP_LOG_LEVEL);
    function shouldLog(target) {
        return LEVELS[target] <= LEVELS[level];
    }
    return {
        level,
        error(message, data) {
            if (shouldLog('error'))
                write('error', message, data);
        },
        info(message, data) {
            if (shouldLog('info'))
                write('info', message, data);
        },
        debug(message, data) {
            if (shouldLog('debug'))
                write('debug', message, data);
        },
        trace(message, data) {
            if (shouldLog('trace'))
                write('trace', message, data);
        },
    };
}
