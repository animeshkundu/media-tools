import { defineConfig } from '@playwright/test';

export default defineConfig({
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  outputDir: '/tmp/media-tools-playwright-results',
  projects: [
    {
      name: 'firefox-built-extension',
      use: {
        browserName: 'firefox',
        headless: true,
      },
    },
  ],
  reporter: 'line',
  testDir: './tests/e2e',
  timeout: 90_000,
  workers: 1,
});
