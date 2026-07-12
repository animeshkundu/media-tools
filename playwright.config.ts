import { defineConfig } from '@playwright/test';

export default defineConfig({
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  outputDir: 'test-results',
  projects: [
    {
      name: 'firefox-built-extension',
    },
  ],
  reporter: 'line',
  testDir: './tests/e2e',
  timeout: 120_000,
  workers: 1,
});
