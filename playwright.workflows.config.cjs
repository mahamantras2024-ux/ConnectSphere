// Separate opt-in suite: browser + real API + disposable PostgreSQL, without touching a running development server.
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  testMatch: 'connected-workflows.spec.js',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120000,
  expect: { timeout: 15000 },
  outputDir: 'test-results/workflows',
  reporter: [['list'], ['json', { outputFile: 'test-results/workflows/results.json' }]],
  use: { ...devices['Desktop Chrome'], trace: 'retain-on-failure', screenshot: 'only-on-failure' },
});
