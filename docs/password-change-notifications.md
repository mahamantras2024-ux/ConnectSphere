# Password change notifications and recovery email validation

After a successful staff or external password reset, ConnectSphere sends a confirmation to the email returned by the actual database password update. The email says the password changed and advises contacting the administrator/support if the user did not make the change. It contains no password or reset link/token.

The password update atomically consumes the token, enforces expiry and increments auth_version before sending mail. A failed notification is logged with a safe error code and does not undo the completed reset. Delivery uses the existing Gmail configuration; there is no retry queue. SMTP tests do not send real mail, and live mailbox delivery has not been verified.

Email validation was already enforced in the existing recovery handler: validate syntax, normalize input, query the users table and check the account's staff/external roles before generating a token. New tests explicitly prove these gates for both audiences. At the user's request, an unknown or wrong-audience account now returns 404 with “Account not found. Try again.” rather than the earlier generic response. The UI shows the error, preserves the input and permits correction. Malformed email still returns “Enter a valid email address.” No shared records or real account passwords were changed.

## Test Verification Record

ACs: password-change AC1 notify stored email after successful staff/external reset; AC2 reject failed resets without notification and preserve successful password change on notification failure; AC3 avoid secrets and close SMTP. Email validation AC1 require valid syntax and eligible database identity; AC2 display account-not-found and permit retry.

Tests/backend/passwordChangeNotification.test.js:
- Password-change AC1 AC2 - [staff/external] [success/delivery failure/invalid token]: six cases; literal recorded recipient, actual model query contract, persistence-before-notification order, no mail on rejected token, successful response despite SMTP failure.
- Password-change AC3 - SMTP notification contains no reset secret and closes on failure=[false/true]: real message/service with only SMTP mocked; subject, content, recipient and cleanup verified.
- Password-change AC2 - classified SMTP failure retains successful reset: safe classified error code rather than private error message.
- Email validation AC1 - [staff/external] unknown email performs lookup without storing or mailing a token: exact normalized bound email, SELECT-only database call, zero mail calls, 404 and requested literal message.
- Email validation AC1 - [staff/external] malformed email cannot reach persistence: 400, zero database and mail calls.

Tests/frontend/PasswordReset.test.jsx:
- Email validation AC1 - invalid email blocks reset-link submission when internal=%s: both audiences, real HTML validation, zero API requests.
- Email validation AC2 - account-not-found permits retry when internal=%s: both audiences, exact alert, input retained, no success state, corrected email submitted to the proper endpoint.

Existing externalPasswordReset tests retain real HTTP staff/external role restrictions, hashing, expiry-query/token-clearing/session guards; success mocks now include the recorded email returned by SQL and mock notification explicitly. Tests/backend/databaseAcceptance.test.js adds recorded-email and exactly-one notification assertions to its existing real PostgreSQL simultaneous reset test, with only mail delivery mocked.

Every authored/modified test was inspected for arrangement, action, literal expectations and external boundary mocks. Incorrect email source, notification before update, notification on invalid token, missing token consumption, private error logging, wrong API route or loss of retry controls each violates an explicit assertion. Unit SQL assertions are query-contract evidence; PostgreSQL acceptance supplements actual persistence/concurrency. No new numerical thresholds were introduced.

Live PostgreSQL acceptance: 17 passed, no skips, using generated disposable schemas; simultaneous reset returned one success and one invalid-token response with one notification. The initial command initialized the pool before dotenv and attempted unavailable localhost PostgreSQL; rerunning with --env-file=.env loaded the configured connection before module initialization. The failed attempt was not counted as a pass.

Additional inspected test: Password-change AC2 - failed password persistence sends no notification. Database rejection is propagated and the mail boundary has zero calls, protecting against notifications for uncommitted passwords.

Final verification from repository root:
- npm test --prefix frontend: 273 passed.
- npm test --prefix frontend -- --coverage: 273 passed; 100% statements, branches, functions and lines.
- npm run build --prefix frontend: passed.
- npm run test:coverage --prefix backend: 213 passed, no failures, 4 opt-in DB skips. Aggregate 97.44% statements/lines, 92.84% branches, 100% functions; controller and user model 100% all metrics. New notification function fully covered. Email service's existing missing-PUBLIC_APP_URL fallback on line 23 remains the uncovered branch (service 95.45% branches); configured recovery checks URL configuration before delivery. No new notification branch is uncovered.
- Separate configured PostgreSQL acceptance run: 17 passed, no skips.
- git diff --check: passed.

No commits or pushes; changes remain on feature/password-recovery-ui.

Recovery UI AC1: requested removal of the conditional prefix from the successful link-request message. The displayed text now reads “A password reset link will be sent.” Test: tests/frontend/PasswordReset.test.jsx — Recovery UI AC1 - requests a reset link and shows the shortened confirmation. Inspected the existing real recovery component test: controlled successful API response, submit email, assert literal new message and exact API payload. Keeping the old prefix or omitting the confirmation fails. No recovery eligibility or delivery behavior changed.
Recovery UI AC1 verification: npm test --prefix frontend and npm test --prefix frontend -- --coverage passed all 273 tests; coverage remains 100% statements, branches, functions and lines. npm run build --prefix frontend and git diff --check passed. No commits or pushes.
