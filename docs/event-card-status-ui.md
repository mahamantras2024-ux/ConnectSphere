# Event card status UI — Test Verification Record

Agreed scope from the requested UI changes:
- UI AC1: outstanding clarification is red on organiser and coordinator cards.
- UI AC2: organiser cards show In progress when an active event has a coordinator; draft, cancelled and completed retain their lifecycle labels. Coordinator lifecycle labels remain unchanged.

Implementation derives the organiser label from coordinator_id without updating the database. The dedicated clarification class uses the existing red palette (#942B20 text on #F9DDD5 background).

Tests in tests/frontend/organiserEvents.test.jsx:
- UI AC1 - %s shows a red outstanding clarification badge (both roles).
- UI AC2 - organiser displays %s with coordinator %s as %s (submitted, under_review, approved, planning, confirmed assigned; submitted unassigned; draft, cancelled, completed).
- UI AC2 - coordinator retains submitted status on an assigned card.

Each new test was inspected for arrangement, action, literal expectations and API mocks. Real routing, authentication and card rendering are retained. Removing the clarification class fails AC1; omitting assignment-derived progress fails assigned AC2 cases; applying it to terminal states or coordinator cards fails the preservation cases. These are categorical rules with no numeric thresholds. jsdom checks the style class; the stylesheet was inspected directly for its red colours.

Before implementation, the targeted suite failed seven new cases as expected. The first full run exposed a return-newline rendering mistake introduced during implementation; this was corrected before final verification.

Final verification from the repository root:
- npm test --prefix frontend: 261 tests passed.
- npm test --prefix frontend -- --coverage: 261 tests passed; 100% statements, branches, functions and lines, including EventList. No uncovered changed JavaScript.
- npm run build --prefix frontend: passed.
- git diff --check: passed.

The CSS palette was inspected; automated DOM tests verify its dedicated class, not browser-computed colour. No live browser visual check was performed. No commits or pushes were made.

## Registration editor — UI AC3

Requested behavior: display “Registration required?” before the checkbox, keep the checkbox compact, and prevent the question from being squeezed or split. A scoped flex layout and 16px checkbox override the global full-width input rule without affecting text fields.

Test: tests/frontend/organiserEvents.test.jsx — “UI AC3 - registration question precedes a compact checkbox and saves the answer”. Inspected Arrange/Act/Assert: authenticates through the real provider, opens the real editor, checks literal question text and DOM ordering, checks the dedicated compact-control class, toggles the persisted true value and asserts the exact false API payload. Reversed ordering, missing question, missing style hook or an incorrect saved boolean each fails an assertion. The test failed before implementation because the question was absent. CSS inspected for fixed width, zero padding, non-growing flex sizing and unbroken question text; jsdom does not validate pixel layout.

UI AC3 final root checks: npm test --prefix frontend and npm test --prefix frontend -- --coverage both passed all 262 tests; coverage remains 100% statements, branches, functions and lines. npm run build --prefix frontend and git diff --check passed. No uncovered changed JavaScript. No commits or pushes.
