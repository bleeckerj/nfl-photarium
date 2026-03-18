/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {
    root: import.meta.dirname,
  },
  webpack: (config, { dev }) => {
    if (dev) {
      const existingIgnored = config.watchOptions?.ignored;
      const ignoredList = Array.isArray(existingIgnored)
        ? existingIgnored
        : existingIgnored
          ? [existingIgnored]
          : [];
      config.watchOptions = {
        ...config.watchOptions,
        // Ignore runtime data/state files that can change frequently during local workflows.
        ignored: [
          ...ignoredList,
          '**/data/**',
          '**/drop-off/**',
          '**/.codex/**',
          '**/*.checkpoint.json',
        ],
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
  // Allow cross-origin requests from local network IPs
  allowedDevOrigins: [
    '192.168.86.150',
    '192.168.1.148',
  ],
};

export default nextConfig;
