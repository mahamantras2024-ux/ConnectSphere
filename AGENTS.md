# AGENTS.md

## Working Agreement

- Use trunk-based development: work only on a short-lived branch, keep changes small, and open a focused, reviewable pull request. Never commit feature work directly to the trunk branch.
- Before coding, read the relevant specification and acceptance criteria (ACs). If ACs are missing or ambiguous, clarify them before choosing behavior.
- For every feature or bug fix, propose and agree on an AC-derived test matrix, then write the failing tests before or alongside the implementation. Do not produce functional code without accompanying automated unit tests.
- Human accountability: You propose solutions, branches, and PRs; a human teammate reviews and merges the PR. Always provide a clear diff summary and rationale.
- If ACs are written in Given-When-Then or EARS syntax, map Given -> Arrange, When -> Act, and Then -> Assert directly.

## Testing Standard

- Use Vitest, React Testing Library, `@testing-library/jest-dom`, and jsdom for React tests.
- Structure tests with Arrange-Act-Assert and keep each test focused on one observable behavior.
- Test behavior through the user-facing interface; prefer accessible queries and realistic interaction over implementation-detail assertions.
- Test traceability: Every test method/block name must reference its corresponding AC (e.g., `it("AC1.2 - rejects registration when capacity is exactly at limit", ...)`), maintaining the user story → AC → test case chain.
- Every user story requires a complete, minimal set of unit tests. Aim for 100% line, branch, function, and statement coverage for the changed behavior; if 100% is not achievable, document the exact uncovered code, why it cannot be covered, and why the remaining risk is acceptable.
- Cover as many distinct error, boundary, and business-rule cases as are relevant, but do not add duplicate tests that exercise the same behavior without new evidence. Each test must justify the unique scenario or rule it covers.
- Ensure every test passes the **Five Review Criteria**:
  1. **Requirement Tracing:** Clearly trace back to a specific Acceptance Criterion (AC).
  2. **Review Oracle:** A plausible faulty implementation must cause it to fail (no decorative tests).
  3. **Clarity:** Clearly structure the setup (Arrange), action (Act), and expected result (Assert).
  4. **Independent Justification:** Expected values must be derived from user stories/ACs, never inferred merely to match current code logic.
  5. **Deterministic & Non-Vacuous:** Tests must produce reproducible, meaningful assertions (avoid empty snapshots, vacuously passing checks, or overly mocking away the logic under test).
- For every threshold or boundary, test **just below**, **exactly at**, and **just above** it.
- Mock only true external boundaries when necessary. Keep routing, component interaction, and business logic real whenever practical.
- A regression fix must include a test that fails because of the reported defect before the fix is applied.
- Do not trust a passing result alone. Before completion, read every AI-authored or modified test and verify its setup, action, assertions, expected values, and mocks against the relevant user story and AC. Confirm that a plausible incorrect implementation would fail the test.

## Explanations and Test Evidence

- Write clean, highly readable code with clear variable and function names. Every AI-authored or materially changed function, hook, component, and non-trivial test must include clear inline comments explaining the 'why' and 'how'.
- For production code, add a concise JSDoc or preceding comment explaining the purpose, key inputs and outputs, and any important business rule, side effect, or non-obvious decision. Do not add comments that merely restate self-explanatory syntax.
- For non-obvious conditionals, calculations, validation rules, or transformations, add an inline comment explaining **why** the rule exists and what outcome it protects.
- For tests, use an AC-linked descriptive name and make the Arrange, Act, and Assert phases obvious through comments or clear spacing. Add a brief explanation when the scenario, boundary value, expected result, or mock is not immediately self-evident.
- In every pull request or completion report, include a **Test Verification Record** containing: the user story and ACs covered; the test file and test names; the distinct happy, error, and boundary cases covered; confirmation that each test was inspected rather than merely run; why each assertion would fail for a plausible defect; coverage results; and any uncovered code with its reason.

## Architecture and Style

- Write clean, modular JavaScript and React code with clear ownership and single-purpose components, hooks, and utilities.
- Use descriptive names that express intent. React components use `PascalCase`; functions, variables, and hooks use `camelCase`; hooks start with `use`.
- Keep files cohesive and small. Extract reusable logic instead of growing monolithic components or utilities.
- Avoid unnecessary abstractions, boilerplate, dependencies, and speculative functionality.
- Keep route behavior explicit and consistent with `react-router-dom` conventions already used by the repository.

## Git and Integration

- Confirm the current branch before editing. If it is the trunk branch, create a short-lived branch such as `codex/<concise-topic>`.
- Use Conventional Commits, for example: `feat(events): add capacity validation`, `fix(routes): preserve event filters`, or `test(events): cover capacity boundaries`.
- Keep commits focused and the branch current with trunk. Do not mix unrelated refactors into feature or bug-fix work.
- Before marking work complete, run the exact local checks from the repository root:

  ```sh
  npm test --prefix frontend
  npm test --prefix frontend -- --coverage
  npm run build --prefix frontend
  ```

- All checks must pass. In the completion report, state which commands were run and their results, include the Test Verification Record, and report the coverage figures or justified coverage exceptions. If a check could not run or failed, report that clearly and do not claim completion.
