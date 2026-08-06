import fs from 'node:fs/promises';
import path from 'node:path';
import { upsertNamespaceRegistryFile } from '../lib/missingNamespaceAssignment.mjs';

export const registerTargetNamespace = async (namespace) => {
  const result = await upsertNamespaceRegistryFile({ namespace, description: namespace === 'cf-orphan' ? 'Utility namespace for assets repaired from missing namespace metadata.' : '' });
  console.log(`[assign-namespace] ${result.didChange ? 'Registered' : 'Registry already includes'} namespace=${namespace} registry=${result.path}`);
};

export const registerTargetNamespaces = async (namespaces) => {
  for (const namespace of Array.from(new Set(namespaces)).sort()) if (namespace) await registerTargetNamespace(namespace);
};

export const formatMissingNamespaceReportText = (report) => {
  const lines = ['[assign-namespace] Missing namespace audit (read-only)', `  images scanned: ${report.imageCount}`, `  videos inspected: ${report.videoCount}`, `  missing images: ${report.missingImages.length}`, `  missing videos: ${report.missingVideos.length}`];
  if (report.inspectedIds.length > 0) { lines.push(`  requested IDs: ${report.inspectedIds.join(', ')}`, `  requested IDs with namespace: ${report.presentAssets.length}`, `  requested IDs not found: ${report.notFoundIds.length}`); }
  const appendAsset = (asset, status) => { lines.push('', `[assign-namespace] ${status}`, `  ${asset.assetType}: ${asset.id} ${asset.filename ? `(${asset.filename})` : ''}`, `  uploaded: ${asset.uploaded || '[unknown]'}`, `  namespace: ${asset.namespace || '[missing]'}`, `  parent: ${asset.parentId || '[none]'}`); };
  for (const asset of report.missingImages) appendAsset(asset, 'MISSING NAMESPACE');
  for (const asset of report.missingVideos) appendAsset(asset, 'MISSING NAMESPACE');
  if (report.inspectedIds.length > 0) { for (const asset of report.presentAssets) appendAsset(asset, 'HAS NAMESPACE'); for (const id of report.notFoundIds) lines.push('', '[assign-namespace] NOT FOUND', `  id: ${id}`); }
  return `${lines.join('\n')}\n`;
};

export const writeOrPrint = async ({ content, output }) => {
  if (!output) { process.stdout.write(content); return; }
  await fs.mkdir(path.dirname(path.resolve(output)), { recursive: true });
  await fs.writeFile(output, content, 'utf8');
  console.log(`[assign-namespace] Wrote ${output}`);
};
