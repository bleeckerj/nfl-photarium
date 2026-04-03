import path from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/client',
  publicDir: '../../public',
  resolve: {
    alias: {
      '@client': path.resolve(__dirname, 'src/client'),
    },
  },
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
  },
});
