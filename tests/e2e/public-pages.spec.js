const { test, expect } = require('@playwright/test');

test('AC-E2E-1 - public login page renders in a real browser', async ({ page }) => {
  // Arrange: start from the public internal login route with no authenticated session.
  await page.goto('/login');

  // Act: allow the page and its accessible controls to finish rendering.
  await expect(page).toHaveTitle(/ConnectSphere/i);

  // Assert: the user can identify the authentication form without backend state.
  await expect(page.getByRole('heading', { name: /login/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /login/i })).toBeVisible();
});
