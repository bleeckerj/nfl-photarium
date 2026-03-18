import { formatWithOptions } from 'node:util';

const PATCH_FLAG = Symbol.for('photarium.localTimestampConsolePatched');

const timestampFormatter = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
  timeZoneName: 'short',
});

function getTimestampPrefix(): string {
  const parts = timestampFormatter.formatToParts(new Date());
  const values = new Map(parts.map((part) => [part.type, part.value]));
  const year = values.get('year') ?? '0000';
  const month = values.get('month') ?? '00';
  const day = values.get('day') ?? '00';
  const hour = values.get('hour') ?? '00';
  const minute = values.get('minute') ?? '00';
  const second = values.get('second') ?? '00';
  const timeZoneName = values.get('timeZoneName') ?? 'local';

  return `[${year}-${month}-${day} ${hour}:${minute}:${second} ${timeZoneName}]`;
}

function writePrefixedLines(
  write: (chunk: string) => boolean,
  args: unknown[],
  options?: { stderr?: boolean }
): void {
  const message = formatWithOptions({ colors: options?.stderr ? true : undefined }, ...args);
  const lines = message.split(/\r?\n/);

  for (const line of lines) {
    write(`${getTimestampPrefix()} ${line}\n`);
  }
}

export function installLocalTimestampConsole(): void {
  const globalState = globalThis as typeof globalThis & { [PATCH_FLAG]?: boolean };
  if (globalState[PATCH_FLAG]) {
    return;
  }

  const stdoutWrite = process.stdout.write.bind(process.stdout) as (chunk: string) => boolean;
  const stderrWrite = process.stderr.write.bind(process.stderr) as (chunk: string) => boolean;

  console.log = (...args: unknown[]) => writePrefixedLines(stdoutWrite, args);
  console.info = (...args: unknown[]) => writePrefixedLines(stdoutWrite, args);
  console.debug = (...args: unknown[]) => writePrefixedLines(stdoutWrite, args);
  console.warn = (...args: unknown[]) => writePrefixedLines(stderrWrite, args, { stderr: true });
  console.error = (...args: unknown[]) => writePrefixedLines(stderrWrite, args, { stderr: true });

  globalState[PATCH_FLAG] = true;
}
