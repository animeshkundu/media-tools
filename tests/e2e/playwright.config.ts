import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, '../..');

export default defineConfig({
  testDir: TEST_DIR,
  testMatch: '**/*.e2e.ts',
  timeout: 120_000,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  globalSetup: path.join(TEST_DIR, 'global-setup.ts'),
  reporter: [
    ['list'],
    ['json', { outputFile: path.join(REPO_ROOT, 'e2e-results.json') }],
    ['html', { open: 'never', outputFolder: path.join(REPO_ROOT, 'playwright-report') }],
  ],
});
