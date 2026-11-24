import { defineConfig } from '@playwright/test';
import { API_PORT, WEB_PORT, testDatabaseUrl } from './test-env';

// Tests start their own backend (4100) and frontend (3100) against a SEPARATE database
// (<your database>_test). Your normal database and the app on 4000/3000 are never touched.
const apiOnly = process.argv.some((a) => a === '--project=api');

export default defineConfig({
  testDir: './tests',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1, // one shared database
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  globalSetup: './global-setup.ts',
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'api', testMatch: /.*\.api\.spec\.ts/ },
    // Uses the Chrome already installed on this machine (no browser download).
    { name: 'ui', testMatch: /.*\.ui\.spec\.ts/, use: { channel: 'chrome', viewport: { width: 1440, height: 900 } } },
    { name: 'ui-phone', testMatch: /.*\.phone\.spec\.ts/, use: { channel: 'chrome', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  webServer: [
    {
      command: 'npx ts-node src/server.ts',
      cwd: '../backend',
      url: `http://localhost:${API_PORT}/health`,
      env: { PORT: String(API_PORT), DATABASE_URL: testDatabaseUrl() },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    ...(apiOnly
      ? []
      : [{
          command: `npx next dev -p ${WEB_PORT}`,
          cwd: '../frontend',
          url: `http://localhost:${WEB_PORT}/login`,
          env: { NEXT_PUBLIC_API_URL: `http://localhost:${API_PORT}/api`, NEXT_DIST_DIR: '.next-e2e' },
          reuseExistingServer: false,
          timeout: 180_000,
        }]),
  ],
});
