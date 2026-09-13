import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

describe('MCP build output contract', () => {
  it('keeps compiled output local and cleans it before compilation', () => {
    const gitignore = readFileSync(join(repoRoot, '.gitignore'), 'utf8');
    const packageJson = JSON.parse(
      readFileSync(join(repoRoot, 'mcp-server/package.json'), 'utf8'),
    ) as { scripts: Record<string, string> };
    const cleanScript = readFileSync(
      join(repoRoot, 'mcp-server/scripts/clean-dist.mjs'),
      'utf8',
    );

    expect(gitignore).toContain('/mcp-server/dist/');
    expect(packageJson.scripts.clean).toBe('node scripts/clean-dist.mjs');
    expect(packageJson.scripts.build).toBe('npm run clean && tsc');
    expect(packageJson.scripts.prestart).toBe('npm run build');
    expect(cleanScript).toContain("new URL('../dist/', import.meta.url)");
  });

  it('builds before replacing or launching the MCP listener', () => {
    const launcher = readFileSync(
      join(repoRoot, 'run_photarium_mcp_server.sh'),
      'utf8',
    );

    expect(launcher).toMatch(/restart\)\s+build_runtime\s+if \[\[/);
    expect(launcher).toMatch(/start\)[\s\S]*?build_runtime\s+prepare_runtime_env/);
  });
});
