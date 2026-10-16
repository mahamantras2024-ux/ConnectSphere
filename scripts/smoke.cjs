// File: Extracts the packaged application and verifies its HTTP health endpoint.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const AdmZip = require('adm-zip');

const root = path.resolve(__dirname, '..');
const archivePath = path.join(root, 'artifacts', 'quackloan.zip');
const extractionDirectory = path.join(root, '.smoke-extracted');
const port = Number(process.env.SMOKE_PORT || 4100);

async function waitForHealth(url, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok && (await response.json()).status === 'ok') return;
    } catch {
      // The server may not have completed startup yet.
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Health endpoint did not become ready: ${url}`);
}

async function run() {
  if (!fs.existsSync(archivePath)) throw new Error(`Package is missing: ${archivePath}`);
  if (fs.existsSync(extractionDirectory)) fs.rmSync(extractionDirectory, { recursive: true });
  fs.mkdirSync(extractionDirectory, { recursive: true });
  new AdmZip(archivePath).extractAllTo(extractionDirectory, true);
  const install = require('node:child_process').spawnSync('npm', ['ci', '--omit=dev'], {
    cwd: path.join(extractionDirectory, 'backend'),
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (install.status !== 0) throw new Error('Smoke check dependency installation failed');

  const server = spawn(process.execPath, ['src/index.js'], {
    cwd: path.join(extractionDirectory, 'backend'),
    env: { ...process.env, PORT: String(port), NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let diagnostics = '';
  server.stderr.on('data', chunk => { diagnostics += chunk; });
  try {
    await waitForHealth(`http://127.0.0.1:${port}/health`);
    console.log('Smoke check passed: /health returned status ok');
  } finally {
    server.kill();
    if (diagnostics) process.stderr.write(diagnostics);
    fs.rmSync(extractionDirectory, { recursive: true, force: true });
  }
}

run().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
