import { defineConfig } from '@playwright/test';

export default defineConfig({
  expect: {
    timeout: 10_000,
  },
  forbidOnly: !!process.env.CI,
  fullyParallel: false,
  outputDir: 'test-results',
  projects: [
    {
      name: 'firefox-built-extension',
      use: {
        browserName: 'firefox',
        headless: true,
      },
    },
  ],
  reporter: [
    ['line'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
    ['json', { outputFile: 'test-results/playwright-results.json' }],
  ],
  testDir: './tests/e2e',
  timeout: 90_000,
  workers: 1,
});
