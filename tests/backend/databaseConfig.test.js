// File: Tests PostgreSQL defaults, hosted TLS settings, and certificate loading without connecting to a database.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

// Evaluates database configuration with fake modules/environment and captures PostgreSQL pool options.
function config(env, readFileSync = () => {
  // Simulates a rejected dependency call so the test can verify error handling.
   throw new Error('Unexpected certificate read'); }) {
  let options;
  const source = fs.readFileSync(path.join(__dirname, '../../backend/src/config/db.js'), 'utf8');
  vm.runInNewContext(source, {
    process: { env }, module: { exports: {} }, console,
    require(name) {
      // Provides fake filesystem/PostgreSQL modules while evaluating database configuration.

      if (name === 'node:fs') return { readFileSync };
      if (name === 'pg') return { Pool: class {
        constructor(value) {
          // Captures pool construction options for database configuration assertions.
           options = value; }
        on() {
          // Accepts pool event registration without creating real database listeners in this test.
          }
      } };
      throw new Error(`Unexpected import: ${name}`);
    },
  }, { filename: path.join(__dirname, '../../backend/src/config/db.js') });
  return options;
}

test('local database keeps non-TLS defaults', () => {
  // Verifies: local database keeps non-TLS defaults.

  const options = config({});
  assert.equal(options.host, 'localhost');
  assert.equal(options.ssl, false);
});

test('hosted database uses supplied settings and verifies TLS certificates', () => {
  // Verifies: hosted database uses supplied settings and verifies TLS certificates.

  const options = config({ DB_HOST: 'example.pooler.supabase.com', DB_PORT: '5432',
    DB_NAME: 'postgres', DB_USER: 'postgres.example', DB_PASSWORD: 'test-only', DB_SSL: 'true' });
  assert.equal(options.host, 'example.pooler.supabase.com');
  assert.equal(options.database, 'postgres');
  assert.equal(options.user, 'postgres.example');
  assert.equal(options.password, 'test-only');
  assert.equal(options.ssl.rejectUnauthorized, true);
  assert.equal(options.ssl.ca, undefined);
});

test('provider certificate is loaded when configured without disabling verification', () => {
  // Verifies: provider certificate is loaded when configured without disabling verification.

  const options = config({ DB_SSL: 'true', DB_SSL_CA_PATH: '/example/root.cer' }, (file, encoding) => {
    // Checks the expected state or returned value within this regression case.

    assert.equal(file, '/example/root.cer');
    assert.equal(encoding, 'utf8');
    return 'test-certificate';
  });
  assert.equal(options.ssl.ca, 'test-certificate');
  assert.equal(options.ssl.rejectUnauthorized, true);
});
