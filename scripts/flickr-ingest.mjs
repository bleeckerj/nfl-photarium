#!/usr/bin/env node

import process from 'node:process';
import { parseCliArgs, printUsage } from './flickr-ingest/config.mjs';
import { createLogger } from './flickr-ingest/logger.mjs';
import { runAuthCommand, runIngestCommand } from './flickr-ingest/run.mjs';

async function main() {
  const options = parseCliArgs(process.argv.slice(2));
  const logger = createLogger({
    verbosity: options.verbosity,
    noColor: options.noColor,
  });

  if (options.help) {
    printUsage();
    return;
  }

  if (options.errors.length > 0) {
    options.errors.forEach((error) => logger.error(error));
    printUsage();
    process.exitCode = 1;
    return;
  }

  if (options.command === 'auth') {
    await runAuthCommand(options, logger);
    return;
  }

  if (options.command === 'ingest') {
    await runIngestCommand(options, logger);
    return;
  }

  printUsage();
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
