const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const ROOT = path.resolve(__dirname, '..');
const authControllerPath = path.join(ROOT, 'backend/src/controllers/authController.js');
const roleMiddlewarePath = path.join(ROOT, 'backend/src/middleware/role.js');
const protectedRoutePath = path.join(ROOT, 'frontend/src/components/ProtectedRoute.jsx');
const appPath = path.join(ROOT, 'frontend/src/App.jsx');
const registerPath = path.join(ROOT, 'frontend/src/pages/Register.jsx');

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

test('login requires email and password', async () => {
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

test('login rejects invalid password for internal staff', async () => {
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

test('login success returns internal role and token', async () => {
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

test('login rejects unknown user', async () => {
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

test('login returns 500 on unexpected backend errors', async () => {
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

test('getMe denies requests without user id', async () => {
  await withMockedRequires(
    {
      '../config/db': { query: async () => ({ rows: [] }) },
      '../models/userModel': { getUserByEmail: async () => null },
      bcryptjs: { compare: async () => true },
      jsonwebtoken: { sign: () => 'mock-token' },
    },
    async () => {
      deleteRequireCache(authControllerPath);
      const { getMe } = require(authControllerPath);
      const req = { user: null };
      const res = {
        status(code) { this.code = code; return this; },
        json(payload) { this.body = payload; return this; },
      };

      await getMe(req, res, () => {});

      assert.equal(res.code, 401);
      assert.deepEqual(res.body, { error: 'Unauthorized: No user ID found in token' });
    }
  );
});

test('getMe returns 404 when user record is missing', async () => {
  await withMockedRequires(
    {
      '../config/db': { query: async () => ({ rows: [] }) },
      '../models/userModel': { getUserByEmail: async () => null },
      bcryptjs: { compare: async () => true },
      jsonwebtoken: { sign: () => 'mock-token' },
    },
    async () => {
      deleteRequireCache(authControllerPath);
      const { getMe } = require(authControllerPath);
      const req = { user: { id: 99 } };
      const res = {
        status(code) { this.code = code; return this; },
        json(payload) { this.body = payload; return this; },
      };

      await getMe(req, res, () => {});

      assert.equal(res.code, 404);
      assert.deepEqual(res.body, { error: 'User not found' });
    }
  );
});

test('getMe returns the current user when token is valid', async () => {
  await withMockedRequires(
    {
      '../config/db': { query: async () => ({ rows: [{ id: 12, email: 'coordinator@example.com', role: 'event_coordinator' }] }) },
      '../models/userModel': { getUserByEmail: async () => null },
      bcryptjs: { compare: async () => true },
      jsonwebtoken: { sign: () => 'mock-token' },
    },
    async () => {
      deleteRequireCache(authControllerPath);
      const { getMe } = require(authControllerPath);
      const req = { user: { id: 12 } };
      const res = {
        status(code) { this.code = code; return this; },
        json(payload) { this.body = payload; return this; },
      };

      await getMe(req, res, () => {});

      assert.equal(res.code, 200);
      assert.equal(res.body.user.email, 'coordinator@example.com');
    }
  );
});

test('getMe forwards unexpected database errors to next()', async () => {
  await withMockedRequires(
    {
      '../config/db': { query: async () => { throw new Error('db failed'); } },
      '../models/userModel': { getUserByEmail: async () => null },
      bcryptjs: { compare: async () => true },
      jsonwebtoken: { sign: () => 'mock-token' },
    },
    async () => {
      deleteRequireCache(authControllerPath);
      const { getMe } = require(authControllerPath);
      const req = { user: { id: 12 } };
      const next = (err) => {
        assert.ok(err instanceof Error);
        assert.equal(err.message, 'db failed');
      };

      await getMe(req, {}, next);
    }
  );
});

test('me rejects missing user account', async () => {
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

test('me returns a 500 on unexpected fetch-user errors', async () => {
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
      const req = { user: { email: 'tech@example.com' } };
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

test('me returns the authenticated user payload', async () => {
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
      const req = { user: { email: 'tech@example.com' } };
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

test('requireRole rejects unauthenticated users', () => {
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

test('requireRole blocks forbidden roles with the expected error', () => {
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

test('requireRole allows matching internal role', () => {
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

test('requireRole blocks other internal roles', () => {
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

test('frontend route guard enforces role restrictions', () => {
  const source = fs.readFileSync(protectedRoutePath, 'utf8');
  assert.match(source, /if \(roles\.length > 0 && !roles\.includes\(user\.role\)\)/);
  assert.match(source, /return <Navigate to="\/dashboard" replace \/>;/);
});

test('frontend routes map each internal role to its dashboard', () => {
  const source = fs.readFileSync(appPath, 'utf8');
  assert.match(source, /path="\/tech-support\/dashboard"/);
  assert.match(source, /roles=\{\['technical_support'\]\}/);
  assert.match(source, /path="\/venue\/dashboard"/);
  assert.match(source, /roles=\{\['venue_staff'\]\}/);
  assert.match(source, /path="\/coordinator\/dashboard"/);
  assert.match(source, /roles=\{\['event_coordinator'\]\}/);
});

test('internal accounts are preprovisioned not self registered', () => {
  const source = fs.readFileSync(registerPath, 'utf8');
  assert.match(source, /Internal accounts are pre-provisioned by ConnectSphere\./);
  assert.match(source, /staff roles likely shouldn't be self-service sign-up/);
});
