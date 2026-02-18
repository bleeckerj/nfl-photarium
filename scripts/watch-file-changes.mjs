import fs from 'node:fs';
import path from 'node:path';

const root = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
const excludes = new Set(['node_modules', '.next', '.git']);

const shouldIgnore = (filePath) => {
  const rel = path.relative(root, filePath);
  if (!rel || rel.startsWith('..')) return false;
  const parts = rel.split(path.sep);
  return parts.some((part) => excludes.has(part));
};

const formatTimestamp = () => new Date().toLocaleString('en-US', { hour12: false });

console.log(`[${formatTimestamp()}] Watching for file changes in ${root}`);
console.log(`[${formatTimestamp()}] Excluding: ${Array.from(excludes).join(', ')}`);

fs.watch(root, { recursive: true }, (eventType, filename) => {
  if (!filename) return;
  const fullPath = path.join(root, filename);
  if (shouldIgnore(fullPath)) return;
  console.log(`[${formatTimestamp()}] ${eventType.toUpperCase()} ${fullPath}`);
});
