import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

import runtimeErrorOverlay from '@replit/vite-plugin-runtime-error-modal';
import { schoolContentPlugin } from './school-content-plugin';

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    'PORT environment variable is required but was not provided.',
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH;

if (!basePath) {
  throw new Error(
    'BASE_PATH environment variable is required but was not provided.',
  );
}

export default defineConfig({
  base: basePath,
  plugins: [
    schoolContentPlugin(import.meta.dirname),
    react(),
    tailwindcss({ optimize: false }),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== 'production' &&
    process.env.REPL_ID !== undefined
      ? [
          await import('@replit/vite-plugin-cartographer').then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, '..'),
            }),
          ),
          await import('@replit/vite-plugin-dev-banner').then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@assets': path.resolve(
        import.meta.dirname,
        '..',
        '..',
        'attached_assets',
      ),
    },
    dedupe: ['react', 'react-dom'],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    manifest: true,
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // Large libraries get their own long-cached files, so a deploy only changes
        // the app's own code for returning visitors. Charts load only with the staff portal.
        manualChunks(id) {
          // Vite module ids always use forward slashes, on Windows too.
          if (!id.includes('node_modules')) return undefined;
          // clsx is used across the site; named here so it is not folded into the charts file.
          if (/\/node_modules\/(react|react-dom|scheduler|clsx)\//.test(id)) return 'vendor-core';
          if (/\/node_modules\/(framer-motion|motion-dom|motion-utils)\//.test(id)) return 'vendor-motion';
          if (/\/node_modules\/@clerk\//.test(id)) return 'vendor-clerk';
          if (/\/node_modules\/(recharts|recharts-scale|react-smooth|victory-vendor|d3-[^/]+|decimal\.js-light|lodash|fast-equals|eventemitter3)\//.test(id)) return 'vendor-charts';
          return undefined;
        },
      },
    },
  },
  server: {
    port,
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: true,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
