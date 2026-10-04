// File: Preserves pulled authentication regressions against the active secure user and role contracts.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const ROOT = path.resolve(__dirname, '../..');
const authControllerPath = path.join(ROOT, 'backend/src/controllers/authController.js');
const roleMiddlewarePath = path.join(ROOT, 'backend/src/middleware/role.js');

function deleteRequireCache(targetPath) {
  delete require.cache[require.resolve(targetPath)];
}

async function withMockedRequires(stubs, fn) {
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) {
      return stubs[request];
    }
    return originalLoad.apply(this, arguments);
  };

  try {
    await fn();
  } finally {
    Module._load = originalLoad;
  }
}

test('Internal AC2-5 - login requires email and password', async () => {
  await withMockedRequires(
    {
      '../config/db': { query: async () => ({ rows: [] }) },
      '../models/userModel': { getUserByEmail: async () => null },
      bcryptjs: { compare: async () => false },
      jsonwebtoken: { sign: () => 'mock-token' },
    },
    async () => {
      deleteRequireCache(authControllerPath);
      const { login } = require(authControllerPath);
      const res = {
        status(code) {
          this.code = code;
          return this;
        },
        json(payload) {
          this.body = payload;
          return this;
        },
      };

      await login({ body: {} }, res);

      assert.equal(res.code, 400);
      assert.deepEqual(res.body, { message: 'Email and password are required.' });
    }
  );
});

test('Internal AC2-5 - login rejects invalid password for internal staff', async () => {
  await withMockedRequires(
    {
      '../config/db': { query: async () => ({ rows: [] }) },
      '../models/userModel': {
        getUserByEmail: async () => ({
          id: 7,
          email: 'tech@example.com',
          password_hash: 'stored-hash',
          full_name: 'Tom Tech',
          role: 'technical_support',
        }),
      },
      bcryptjs: { compare: async () => false },
      jsonwebtoken: { sign: () => 'mock-token' },
    },
    async () => {
      deleteRequireCache(authControllerPath);
      const { login } = require(authControllerPath);
      const res = {
        status(code) {
          this.code = code;
          return this;
        },
        json(payload) {
          this.body = payload;
          return this;
        },
      };

      await login({ body: { email: 'tech@example.com', password: 'wrong-password' } }, res);

      assert.equal(res.code, 401);
      assert.deepEqual(res.body, { message: 'Invalid email or password.' });
    }
  );
});

test('Internal AC2-5 - login success returns internal role and token', async () => {
  await withMockedRequires(
    {
      '../config/db': { query: async () => ({ rows: [] }) },
      '../models/userModel': {
        getUserByEmail: async () => ({
          id: 9,
          email: 'venue@example.com',
          password_hash: 'stored-hash',
          full_name: 'Venue Staff',
          role: 'venue_staff',
        }),
      },
      bcryptjs: {
        compare: async (password, hash) => password === 'P@ssword123' && hash === 'stored-hash',
      },
      jsonwebtoken: { sign: () => 'staff-token-123' },
    },
    async () => {
      deleteRequireCache(authControllerPath);
      const { login } = require(authControllerPath);
      const res = {
        status(code) {
          this.code = code;
          return this;
        },
        json(payload) {
          this.body = payload;
          return this;
        },
      };

      await login({ body: { email: 'venue@example.com', password: 'P@ssword123' } }, res);

      assert.equal(res.code, 200);
      assert.equal(res.body.user.role, 'venue_staff');
      assert.equal(res.body.token, 'staff-token-123');
    }
  );
});

test('Internal AC2-5 - login rejects unknown user', async () => {
  await withMockedRequires(
    {
      '../config/db': { query: async () => ({ rows: [] }) },
      '../models/userModel': { getUserByEmail: async () => null },
      bcryptjs: { compare: async () => true },
      jsonwebtoken: { sign: () => 'mock-token' },
    },
    async () => {
      deleteRequireCache(authControllerPath);
      const { login } = require(authControllerPath);
      const res = {
        status(code) { this.code = code; return this; },
        json(payload) { this.body = payload; return this; },
      };

      await login({ body: { email: 'missing@example.com', password: 'secret' } }, res);

      assert.equal(res.code, 401);
      assert.deepEqual(res.body, { message: 'Invalid email or password.' });
    }
  );
});

test('Internal AC2-5 - login returns 500 on unexpected backend errors', async () => {
  await withMockedRequires(
    {
      '../config/db': { query: async () => ({ rows: [] }) },
      '../models/userModel': { getUserByEmail: async () => { throw new Error('db exploded'); } },
      bcryptjs: { compare: async () => true },
      jsonwebtoken: { sign: () => 'mock-token' },
    },
    async () => {
      deleteRequireCache(authControllerPath);
      const { login } = require(authControllerPath);
      const res = {
        status(code) { this.code = code; return this; },
        json(payload) { this.body = payload; return this; },
      };

      await login({ body: { email: 'good@example.com', password: 'secret' } }, res);

      assert.equal(res.code, 500);
      assert.deepEqual(res.body, { message: 'Unable to log in at this time.' });
    }
  );
});

test('Internal AC2-5 - me rejects missing user account', async () => {
  await withMockedRequires(
    {
      '../config/db': { query: async () => ({ rows: [] }) },
      '../models/userModel': { getUserByEmail: async () => null },
      bcryptjs: { compare: async () => true },
      jsonwebtoken: { sign: () => 'mock-token' },
    },
    async () => {
      deleteRequireCache(authControllerPath);
      const { me } = require(authControllerPath);
      const req = { user: { email: 'ghost@example.com' } };
      const res = {
        status(code) { this.code = code; return this; },
        json(payload) { this.body = payload; return this; },
      };

      await me(req, res);

      assert.equal(res.code, 401);
      assert.deepEqual(res.body, { message: 'User no longer exists.' });
    }
  );
});

test('Internal AC2-5 - me returns a 500 on unexpected fetch-user errors', async () => {
  await withMockedRequires(
    {
      '../config/db': { query: async () => ({ rows: [] }) },
      '../models/userModel': { getUserByEmail: async () => { throw new Error('lookup failed'); } },
      bcryptjs: { compare: async () => true },
      jsonwebtoken: { sign: () => 'mock-token' },
    },
    async () => {
      deleteRequireCache(authControllerPath);
      const { me } = require(authControllerPath);
      const req = { user: { email: 'tech@example.com', role: 'technical_support' } };
      const res = {
        status(code) { this.code = code; return this; },
        json(payload) { this.body = payload; return this; },
      };

      await me(req, res);

      assert.equal(res.code, 500);
      assert.deepEqual(res.body, { message: 'Unable to fetch current user.' });
    }
  );
});

test('Internal AC2-5 - me returns the authenticated user payload', async () => {
  await withMockedRequires(
    {
      '../config/db': { query: async () => ({ rows: [] }) },
      '../models/userModel': {
        getUserByEmail: async () => ({
          id: 8,
          email: 'tech@example.com',
          full_name: 'Tom Tech',
          role: 'technical_support',
        }),
      },
      bcryptjs: { compare: async () => true },
      jsonwebtoken: { sign: () => 'mock-token' },
    },
    async () => {
      deleteRequireCache(authControllerPath);
      const { me } = require(authControllerPath);
      const req = { user: { email: 'tech@example.com', role: 'technical_support' } };
      const res = {
        status(code) { this.code = code; return this; },
        json(payload) { this.body = payload; return this; },
      };

      await me(req, res);

      assert.equal(res.code, 200);
      assert.equal(res.body.user.role, 'technical_support');
    }
  );
});

test('Internal AC2-5 - requireRole rejects unauthenticated users', () => {
  const { requireRole } = require(roleMiddlewarePath);
  const req = { user: null };
  const res = {
    status(code) { this.code = code; return this; },
    json(payload) { this.body = payload; return this; },
  };

  requireRole('technical_support')(req, res, () => {});

  assert.equal(res.code, 401);
  assert.deepEqual(res.body, { error: 'Not authenticated.' });
});

test('Internal AC2-5 - requireRole blocks forbidden roles with the expected error', () => {
  const { requireRole } = require(roleMiddlewarePath);
  const req = { user: { role: 'attendee' } };
  const res = {
    status(code) { this.code = code; return this; },
    json(payload) { this.body = payload; return this; },
  };

  requireRole('technical_support', 'venue_staff')(req, res, () => {});

  assert.equal(res.code, 403);
  assert.deepEqual(res.body, { error: 'Forbidden for this role.' });
});

test('Internal AC2-5 - requireRole allows matching internal role', () => {
  const { requireRole } = require(roleMiddlewarePath);
  let called = false;
  const req = { user: { role: 'technical_support' } };
  const res = {
    status(code) {
      this.code = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };

  requireRole('technical_support', 'venue_staff')(req, res, () => {
    called = true;
  });

  assert.equal(called, true);
  assert.equal(res.code || 200, 200);
});

test('Internal AC2-5 - requireRole blocks other internal roles', () => {
  const { requireRole } = require(roleMiddlewarePath);
  const req = { user: { role: 'event_organiser' } };
  const res = {
    status(code) {
      this.code = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };

  requireRole('technical_support', 'venue_staff')(req, res, () => {});

  assert.equal(res.code, 403);
  assert.deepEqual(res.body, { error: 'Forbidden for this role.' });
});

