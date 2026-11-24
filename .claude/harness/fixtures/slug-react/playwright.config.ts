import { defineConfig } from '@playwright/test';

// The journey runs against the built app (`vite build`, run first by journeys.command) served by server.mjs.
// PLAYWRIGHT_CHROMIUM_EXECUTABLE optionally points at a pre-installed browser; CI installs its own.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;

export default defineConfig({
  testDir: 'journeys',
  use: { baseURL: 'http://127.0.0.1:4173', launchOptions: { executablePath } },
  webServer: { command: 'node server.mjs', url: 'http://127.0.0.1:4173', reuseExistingServer: false, timeout: 30_000 },
});
