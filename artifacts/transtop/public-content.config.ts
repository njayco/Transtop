import { defineConfig } from '@playwright/test';

// The regular browser suite deliberately isolates its client API fixtures.
// Public SSR instead needs a running frontend and the existing transit API.
export default defineConfig({
  testDir: './tests/browser',
  testMatch: 'public-content.spec.ts',
  workers: 1,
  outputDir: '../../generated-artifacts/public-content-browser',
  use: {
    // Use the path router so browser /api requests reach the API artifact.
    baseURL: 'http://127.0.0.1:80',
    serviceWorkers: 'block',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {},
  },
});
