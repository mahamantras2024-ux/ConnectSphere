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
- Ensure every test passes the **Five Review Criteria**:
  1. **Requirement Tracing:** Clearly trace back to a specific Acceptance Criterion (AC).
  2. **Review Oracle:** A plausible faulty implementation must cause it to fail (no decorative tests.
  3. **Clarity:** Clearly structure the setup (Arrange), action (Act), and expected result (Assert).
  4. **Independent Justification:** Expected values must be derived from user stories/ACs, never inferred merely to match current code logic.
  5. **Deterministic & Non-Vacuous:** Tests must produce reproducible, meaningful assertions (avoid empty snapshots, vacuously passing checks, or overly mocking away the logic under test).
- For every threshold or boundary, test **just below**, **exactly at**, and **just above** it.
- Mock only true external boundaries when necessary. Keep routing, component interaction, and business logic real whenever practical.
- A regression fix must include a test that fails because of the reported defect before the fix is applied.

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
  npm run build --prefix frontend
  ```

- All checks must pass. In the completion report, state which commands were run and their results; if a check could not run or failed, report that clearly and do not claim completion.
