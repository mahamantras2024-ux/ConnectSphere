// Explicit workflow command never silently skips the PostgreSQL/browser suite; propagate its actual exit status.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const result = spawnSync(process.execPath, [require.resolve('@playwright/test/cli'), 'test',
  '--config=playwright.workflows.config.cjs', ...process.argv.slice(2)], {
  cwd: root, stdio: 'inherit', env: { ...process.env, RUN_DB_TESTS: '1', NODE_ENV: 'test' },
});
if (result.error) console.error(result.error.message);
process.exitCode = result.error ? 1 : result.status ?? 1;
