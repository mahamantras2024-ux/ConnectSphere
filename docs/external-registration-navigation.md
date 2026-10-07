# External registration navigation — Test Verification Record

Requested UI AC1: external users can select Back to sign in from the Create Account screen before submitting the form. The existing return link now uses that exact text and the shared text-link styling, retaining /external/login as its destination. Successful registration retains its existing Sign in action.

Test: tests/frontend/ExternalRegister.test.jsx — External registration UI AC1 - Back to sign in opens external login without creating an account.

Inspected Arrange/Act/Assert: render real App, router and AuthProvider at /external/register, enter an unfinished name, click the actual link, assert its literal external login destination, the real sign-in heading, removal of registration heading and absence of an API POST. Wrong destination, missing link, form submission or failed navigation would fail. Only the HTTP boundary is observed. Existing tests retain successful registration, validation/error preservation and duplicate-submission coverage. No new thresholds or business rules.

Root verification: npm test --prefix frontend passed 269 tests; npm test --prefix frontend -- --coverage passed 269 tests with 100% statements, branches, functions and lines. npm run build --prefix frontend and git diff --check passed. No uncovered changed JavaScript. No commits or pushes.
