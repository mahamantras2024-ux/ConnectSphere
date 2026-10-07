# Internal password recovery

Staff login now offers Forgot password. Enter the real work email stored on the provisioned account, open the emailed link and choose a matching new password. The UI reuses the existing recovery design and returns to staff sign-in.

No new migration or email provider is required. Existing password_reset_hash, password_reset_expires_at and auth_version columns are prerequisites. The existing Gmail sender requires GMAIL_USER, GMAIL_APP_PASSWORD and PUBLIC_APP_URL. The recipient may use any email provider. Placeholder accounts such as lead@example.com cannot deliver to a real work inbox. PUBLIC_APP_URL must point to a reachable frontend; production requires HTTPS.

Public routes: /forgot-password and /reset-password. API routes: POST /api/auth/internal/forgot-password and POST /api/auth/internal/reset-password. External routes remain unchanged. Staff roles are selected from the server-owned role list; primary or secondary provisioned roles qualify. Account-level passwords are shared across an account's roles.

Links last 15 minutes, are single-use, and contain the token in the URL fragment. Only a SHA-256 token hash is stored. Password reset uses an atomic expiry-guarded UPDATE, clears the token and increments auth_version to revoke old sessions. A newer reset request replaces the previous token. Failed email delivery clears only its own token. Unknown and wrong-audience accounts now return “Account not found. Try again.” so the form stays open for correction, as explicitly requested. Staff recovery allows 10 attempts per IP per 15 minutes across its two endpoints, independently of the external recovery counter.

## Test Verification Record

User story: internal ConnectSphere users recover account access through their recorded work email, matching external recovery behavior.
- AC1: staff sign-in offers recovery and uses staff routes, with consistent UI.
- AC2: eligible staff receive a link at their stored work email; unknown/external-only accounts receive account-not-found feedback; SMTP constructs the staff link and respects URL transport rules.
- AC3: matching passwords consume an eligible unexpired one-time token, hash the password, revoke sessions and return to staff login; missing/unavailable tokens are rejected.

Tests in tests/frontend/PasswordReset.test.jsx:
- Internal recovery AC1 AC2 - requests work-email link and returns to staff login
- Internal recovery AC3 - updates staff password through internal route
- Internal recovery AC3 - missing token offers internal recovery
- Internal recovery AC1 - staff login opens the recovery route

Tests in tests/backend/externalPasswordReset.test.js:
- Internal recovery AC1 AC2 - [each of five staff roles] receives recovery at stored work email
- Internal recovery AC2 - unknown and external-only accounts receive identical account-not-found responses without mail
- Internal recovery AC3 - staff reset hashes password and consumes token with session revocation
- Internal recovery AC2 - staff link targets internal reset page
- Internal recovery AC2 - secondary staff role receives reset link
- Internal recovery AC3 - unavailable staff reset token cannot change password
- Internal recovery AC2 - SMTP message delivers internal link to recorded work email and closes transport
- Internal recovery AC2 - [test/production] link transport [URL]: FTP rejected, production HTTP rejected, production HTTPS and development HTTP allowed.

Every new/modified test was inspected for Arrange/Act/Assert, literal expectations and external-only mocks. Wrong routing or staff-login destination fails UI assertions; wrong recipient/hash/role allowlist fails backend assertions; ignoring the internal flag fails actual SMTP message construction; omitted expiry/token-clearing/session-version guards fail SQL-contract checks; plaintext password persistence fails bcrypt verification. Shared external regressions retain validation, failed delivery, token/session and password-limit evidence. No new duration or password threshold was introduced.

Database query mocks prove query contracts and handler behavior, not live PostgreSQL expiry or concurrency. SMTP is mocked; no real reset emails were sent. An end-to-end mailbox delivery check remains necessary in the configured environment. No shared account passwords or records were changed by the tests.

Initial full backend run exposed shared recovery-rate-limit counters and direct-handler test requests without req.path; these were corrected. An initial instrumented frontend run hit an existing venue-dashboard asynchronous query timeout under concurrent load; the sequential rerun passed without changing that assertion. Those failures were not counted as passes.


UI clarification: only the staff login's Forgot password link is centred directly below Login. The staff-login-footer class sets justify-content:center; external login keeps its existing two-link footer and recovery UI. Recovery-page centring changes from the earlier misunderstanding were removed.

UI test: tests/frontend/login.test.jsx — Staff login UI AC1 - centres recovery link only when external=%s is false (false and true). Inspected real login rendering and literal destination expectations; assert staff-only class, footer order after Login, and unchanged external recovery URL. Missing or externally applied class, reversed placement or wrong destination fails. CSS inspected directly; jsdom does not measure rendered alignment.

Final verification:
- npm test --prefix frontend: 268 passed.
- npm test --prefix frontend -- --coverage: 268 passed; 100% statements, branches, functions and lines.
- npm run build --prefix frontend: passed.
- npm run test:coverage --prefix backend: 199 passed, 0 failed, 4 opt-in database skips; aggregate 97.40% statements/lines, 92.71% branches, 100% functions.
- Auth recovery controller and user model: 100% all four metrics. Email service: 100% statements/lines/functions, 95% branches; remaining branch is the pre-existing PUBLIC_APP_URL fallback at line 23. HTTP recovery rejects missing URL configuration before sending, so this fallback is not used by the configured staff flow. Both new staff/external URL branches are covered.
- node --test tests/runner.test.cjs: 8 passed.
- git diff --check: passed.

No commits or pushes. Existing assignment/clarification race identified in the earlier review remains outside this change.
