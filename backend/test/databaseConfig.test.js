const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function config(env, readFileSync = () => { throw new Error('Unexpected certificate read'); }) {
  let options;
  const source = fs.readFileSync(path.join(__dirname, '../src/config/db.js'), 'utf8');
  vm.runInNewContext(source, {
    process: { env }, module: { exports: {} }, console,
    require(name) {
      if (name === 'node:fs') return { readFileSync };
      if (name === 'pg') return { Pool: class {
        constructor(value) { options = value; }
        on() {}
      } };
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  return options;
}

test('local database keeps non-TLS defaults', () => {
  const options = config({});
  assert.equal(options.host, 'localhost');
  assert.equal(options.ssl, false);
});

test('hosted database uses supplied settings and verifies TLS certificates', () => {
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
  const options = config({ DB_SSL: 'true', DB_SSL_CA_PATH: '/example/root.cer' }, (file, encoding) => {
    assert.equal(file, '/example/root.cer');
    assert.equal(encoding, 'utf8');
    return 'test-certificate';
  });
  assert.equal(options.ssl.ca, 'test-certificate');
  assert.equal(options.ssl.rejectUnauthorized, true);
});
