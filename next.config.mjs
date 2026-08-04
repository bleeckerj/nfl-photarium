import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(projectRoot, '..');

/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {
    root: workspaceRoot,
  },
  // Keep the in-process grainrad effects engine (and sharp) as runtime externals
  // rather than bundling them. grainrad is pure ESM and reads a sibling
  // docs/feature-map.json relative to its own module path, so it must run from
  // its on-disk location.
  serverExternalPackages: ['nfl-grainrad-clone', 'sharp', 'jsdom'],
  webpack: (config, { dev, isServer }) => {
    if (isServer) {
      config.externalsPresets = {
        ...config.externalsPresets,
        node: true,
      };
      // Instrumentation is compiled separately from ordinary route handlers in
      // Next dev. Keep Sharp's native loader and its Node-only libc detector
      // external there too, so Webpack never evaluates them as browser code.
      const existingExternals = Array.isArray(config.externals) ? config.externals : [];
      config.externals = [
        ...existingExternals,
        {
          sharp: 'commonjs sharp',
          'detect-libc': 'commonjs detect-libc',
          jsdom: 'commonjs jsdom',
        },
      ];
    }
    if (dev) {
      const existingIgnored = config.watchOptions?.ignored;
      const ignoredList = (Array.isArray(existingIgnored)
        ? existingIgnored
        : existingIgnored != null
          ? [existingIgnored]
          : []
      ).filter((entry) => typeof entry === 'string' && entry.trim().length > 0);
      config.watchOptions = {
        ...config.watchOptions,
        // Ignore runtime data/state files that can change frequently during local workflows.
        ignored: Array.from(new Set([
          ...ignoredList,
          '**/data/**',
          '**/drop-off/**',
          '**/adjacent/**',
          '**/.codex/**',
          '**/*.checkpoint.json',
        ])),
      };
    }
    return config;
  },
  images: {
    unoptimized: true,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'imagedelivery.net',
        port: '',
        pathname: '/**',
      },
    ],
  },
  experimental: {
    // /api/upload accepts archives up to 500 MB and optimizes oversized source images server-side.
    proxyClientMaxBodySize: '500mb',
  },
  // Allow cross-origin requests from local network IPs
  allowedDevOrigins: [
    '192.168.86.150',
    '192.168.1.148',
  ],
};

export default nextConfig;
