import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

import runtimeErrorOverlay from '@replit/vite-plugin-runtime-error-modal';
import { readFile } from 'node:fs/promises';
import { publicContentMiddleware } from './server/middleware.mjs';

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
  // The disposable browser-test server uses different plugins from the preview.
  // Sharing optimized dependencies lets one invalidate the other's module URLs.
  cacheDir: path.resolve(import.meta.dirname, `node_modules/.vite-${port}`),
  plugins: [
    {
      name: 'transtop-public-content',
      configureServer(server) {
        // The route-aware host uses the same renderer and adds canonical,
        // sitemap and status handling. Do not short-circuit it in middleware mode.
        if (server.config.server.middlewareMode) return;
        server.middlewares.use(publicContentMiddleware({
          base: basePath.replace(/\/$/, ''),
          template: async (url) => server.transformIndexHtml(url,
            await readFile(path.resolve(import.meta.dirname, 'index.html'), 'utf8')),
        }));
      },
      configurePreviewServer(server) {
        server.middlewares.use(publicContentMiddleware({
          base: basePath.replace(/\/$/, ''),
          template: async () => readFile(path.resolve(import.meta.dirname, 'dist/public/index.html'), 'utf8'),
        }));
      },
    },
    react(),
    tailwindcss(),
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
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
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
