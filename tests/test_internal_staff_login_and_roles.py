import json
import subprocess
import textwrap
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def run_node(script: str):
    result = subprocess.run(
        ["node", "-e", script],
        cwd=str(ROOT),
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise AssertionError(
            f"Node script failed with exit code {result.returncode}\n"
            f"STDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}"
        )

    output = result.stdout.strip()
    if not output:
        return None
    try:
        return json.loads(output)
    except json.JSONDecodeError:
        return output


class InternalStaffLoginAndRoleAccessTests(unittest.TestCase):
    def test_login_requires_email_and_password(self):
        script = textwrap.dedent(
            """
            const Module = require('module');
            const originalLoad = Module._load;
            Module._load = function(request, parent, isMain) {
              if (request === '../config/db') {
                return { query: async () => ({ rows: [] }) };
              }
              if (request === '../models/userModel') {
                return { getUserByEmail: async () => null };
              }
              if (request === 'bcryptjs') {
                return { compare: async () => false };
              }
              if (request === 'jsonwebtoken') {
                return { sign: () => 'mock-token' };
              }
              return originalLoad.apply(this, arguments);
            };

            const { login } = require('./backend/src/controllers/authController.js');
            const res = {
              status(code) { this.code = code; return this; },
              json(payload) { this.body = payload; return this; }
            };

            login({ body: {} }, res).then(() => {
              console.log(JSON.stringify({ status: res.code, body: res.body }));
            }).catch((error) => {
              console.error(error);
              process.exit(1);
            });
            """
        )

        result = run_node(script)
        self.assertEqual(result["status"], 400)
        self.assertEqual(result["body"]["message"], "Email and password are required.")

    def test_login_rejects_invalid_password_for_internal_staff(self):
        script = textwrap.dedent(
            """
            const Module = require('module');
            const originalLoad = Module._load;
            Module._load = function(request, parent, isMain) {
              if (request === '../config/db') {
                return { query: async () => ({ rows: [] }) };
              }
              if (request === '../models/userModel') {
                return {
                  getUserByEmail: async () => ({
                    id: 7,
                    email: 'tech@example.com',
                    password_hash: 'stored-hash',
                    full_name: 'Tom Tech',
                    role: 'technical_support'
                  })
                };
              }
              if (request === 'bcryptjs') {
                return { compare: async () => false };
              }
              if (request === 'jsonwebtoken') {
                return { sign: () => 'mock-token' };
              }
              return originalLoad.apply(this, arguments);
            };

            const { login } = require('./backend/src/controllers/authController.js');
            const res = {
              status(code) { this.code = code; return this; },
              json(payload) { this.body = payload; return this; }
            };

            login({ body: { email: 'tech@example.com', password: 'wrong-password' } }, res).then(() => {
              console.log(JSON.stringify({ status: res.code, body: res.body }));
            }).catch((error) => {
              console.error(error);
              process.exit(1);
            });
            """
        )

        result = run_node(script)
        self.assertEqual(result["status"], 401)
        self.assertEqual(result["body"]["message"], "Invalid email or password.")

    def test_login_success_returns_internal_role_and_token(self):
        script = textwrap.dedent(
            """
            const Module = require('module');
            const originalLoad = Module._load;
            Module._load = function(request, parent, isMain) {
              if (request === '../config/db') {
                return { query: async () => ({ rows: [] }) };
              }
              if (request === '../models/userModel') {
                return {
                  getUserByEmail: async () => ({
                    id: 9,
                    email: 'venue@example.com',
                    password_hash: 'stored-hash',
                    full_name: 'Venue Staff',
                    role: 'venue_staff'
                  })
                };
              }
              if (request === 'bcryptjs') {
                return { compare: async (password, hash) => password === 'P@ssword123' && hash === 'stored-hash' };
              }
              if (request === 'jsonwebtoken') {
                return { sign: () => 'staff-token-123' };
              }
              return originalLoad.apply(this, arguments);
            };

            const { login } = require('./backend/src/controllers/authController.js');
            const res = {
              status(code) { this.code = code; return this; },
              json(payload) { this.body = payload; return this; }
            };

            login({ body: { email: 'venue@example.com', password: 'P@ssword123' } }, res).then(() => {
              console.log(JSON.stringify({ status: res.code, body: res.body }));
            }).catch((error) => {
              console.error(error);
              process.exit(1);
            });
            """
        )

        result = run_node(script)
        self.assertEqual(result["status"], 200)
        self.assertEqual(result["body"]["user"]["role"], "venue_staff")
        self.assertEqual(result["body"]["token"], "staff-token-123")

    def test_require_role_allows_matching_internal_role(self):
        script = textwrap.dedent(
            """
            const { requireRole } = require('./backend/src/middleware/role.js');
            let called = false;
            const req = { user: { role: 'technical_support' } };
            const res = {
              status(code) { this.code = code; return this; },
              json(payload) { this.body = payload; return this; }
            };
            requireRole('technical_support', 'venue_staff')(req, res, () => { called = true; });
            console.log(JSON.stringify({ nextCalled: called, code: res.code || 200, body: res.body || null }));
            """
        )

        result = run_node(script)
        self.assertTrue(result["nextCalled"])
        self.assertEqual(result["code"], 200)

    def test_require_role_blocks_other_internal_roles(self):
        script = textwrap.dedent(
            """
            const { requireRole } = require('./backend/src/middleware/role.js');
            const req = { user: { role: 'event_organiser' } };
            const res = {
              status(code) { this.code = code; return this; },
              json(payload) { this.body = payload; return this; }
            };
            requireRole('technical_support', 'venue_staff')(req, res, () => {});
            console.log(JSON.stringify({ code: res.code, body: res.body }));
            """
        )

        result = run_node(script)
        self.assertEqual(result["code"], 403)
        self.assertEqual(result["body"]["error"], "Forbidden for this role.")

    def test_frontend_route_guard_enforces_role_restrictions(self):
        protected_route = (ROOT / 'frontend/src/components/ProtectedRoute.jsx').read_text()
        self.assertIn("if (roles.length > 0 && !roles.includes(user.role))", protected_route)
        self.assertIn('return <Navigate to="/dashboard" replace />;', protected_route)

    def test_frontend_routes_map_each_internal_role_to_its_dashboard(self):
        app_file = (ROOT / 'frontend/src/App.jsx').read_text()
        self.assertIn("path=\"/tech-support/dashboard\"", app_file)
        self.assertIn("roles={['technical_support']}", app_file)
        self.assertIn("path=\"/venue/dashboard\"", app_file)
        self.assertIn("roles={['venue_staff']}", app_file)
        self.assertIn("path=\"/coordinator/dashboard\"", app_file)
        self.assertIn("roles={['event_coordinator']}", app_file)

    def test_internal_accounts_are_preprovisioned_not_self_registered(self):
        register_file = (ROOT / 'frontend/src/pages/Register.jsx').read_text()
        self.assertIn('Internal accounts are pre-provisioned by ConnectSphere.', register_file)
        self.assertIn('staff roles likely shouldn\'t be self-service sign-up', register_file)


if __name__ == "__main__":
    unittest.main()
