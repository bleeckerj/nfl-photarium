import { openCatalogDatabase } from './db.js';
import { syncArchive } from './sync.js';

const command = process.argv[2] ?? 'sync';
if (command !== 'sync') throw new Error(`Unknown archive command: ${command}`);

const databasePath = process.env.ARCHIVE_DATABASE_PATH ?? '/data/catalog.sqlite';
const sourceRoot = process.env.ARCHIVE_SOURCE_ROOT ?? '/sources/photography-1';
const database = openCatalogDatabase(databasePath);
const result = await syncArchive({ database, sourceRoot, hashFiles: process.argv.includes('--hash'), allowLockedCatalog: process.argv.includes('--allow-locked') });
console.log(JSON.stringify(result, null, 2));
database.close();
