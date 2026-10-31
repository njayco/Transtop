import { defineConfig } from '@playwright/test';

// A separate, disposable frontend: no API server, database or provider keys needed.
const port = 4179;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 2,
  reporter: 'list',
  outputDir: '../../generated-artifacts/transtop-browser',
  use: {
    baseURL,
    browserName: 'chromium',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {},
  },
  webServer: {
    command: 'pnpm exec vite --host 127.0.0.1',
    url: baseURL,
    env: { PORT: String(port), BASE_PATH: '/', NODE_ENV: 'production' },
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
