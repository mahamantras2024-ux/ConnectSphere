const { test, expect } = require('@playwright/test');

const dashboards = {
  event_organiser: ['/organizer/dashboard', 'Event Organiser Dashboard'],
  event_coordinator: ['/coordinator/dashboard', 'Event Coordinator Dashboard'],
  event_coordinator_lead: ['/coordinator-lead/dashboard', 'Coordinator Lead Dashboard'],
  attendee: ['/attendee/dashboard', 'Attendee Dashboard'],
  venue_staff: ['/venue/dashboard', 'Venue Staff Dashboard'],
  technical_support: ['/tech-support/dashboard', 'Technical Support Dashboard'],
  safety_officer: ['/safety/dashboard', 'Safety Officer Dashboard'],
};

/** Keep authentication, routing, layout and interactions real; replace only the HTTP service boundary. */
async function openDashboard(page, role, notifications = []) {
  await page.addInitScript(() => localStorage.setItem('cs_token', 'sticky-header-session'));
  await page.route(url => url.pathname.startsWith('/api/'), async route => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');
    let data = { events: [], requests: [], reservations: [], registrations: [], inventory: [],
      changeRequests: [], staff: [], coordinators: [], issues: [] };
    if (path === '/auth/me') data = { user: { id: 8, full_name: 'Casey Staff', role,
      roles: role === 'event_coordinator' ? ['event_coordinator', 'venue_staff'] : [role] } };
    if (path === '/notifications') data = { notifications, unreadCount: notifications.length };
    if (path === '/venues') data = [];
    if (path === '/notifications/coordinator-preferences') data = { preference: { enabled: false, frequencyDays: 1 } };
    if (['/venues/notification-preferences', '/tech-support/reminder-preference'].includes(path)) {
      data = { preference: { dailyPendingReminders: false, reminderFrequencyDays: 1 } };
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
  });
  await page.goto(dashboards[role][0]);
  await expect(page.getByRole('heading', { name: dashboards[role][1], level: 1 })).toBeVisible();
  // Empty queues still need a meaningful scroll test; stretch main content without changing header layout.
  await page.addStyleTag({ content: 'main.content { min-height: 2600px; }' });
}

for (const role of Object.keys(dashboards)) {
  for (const [viewport, width, height] of [['desktop', 1440, 900], ['mobile', 390, 700], ['compact', 607, 509]]) {
    test(`Sticky header AC1 AC2 AC3 - ${role} ${viewport} keeps navigation and scroll targets usable`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await openDashboard(page, role);
      const header = page.getByRole('navigation', { name: 'Main navigation' });
      const heading = page.getByRole('heading', { name: dashboards[role][1], level: 1 });
      const initialHeader = await header.boundingBox();
      expect((await heading.boundingBox()).y).toBeGreaterThanOrEqual(initialHeader.y + initialHeader.height);

      await page.evaluate(() => window.scrollTo(0, 700));
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(500);
      await expect.poll(async () => (await header.boundingBox()).y).toBeCloseTo(0, 0);
      await expect(header.getByRole('link', { name: /ConnectSphere/ })).toBeInViewport();
      await expect(header.getByRole('button', { name: 'Log out' })).toBeInViewport();
      await expect(header.getByRole('button', { name: /^Notifications/ })).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

      // Native scrollIntoView (also used by notifications and skip links) must stop below the wrapped header.
      await page.evaluate(() => {
        const target = document.createElement('button');
        target.id = 'sticky-scroll-target';
        target.textContent = 'Scroll target';
        target.style.marginTop = '1000px';
        document.querySelector('main').append(target);
        target.scrollIntoView({ block: 'start' });
      });
      const target = page.getByRole('button', { name: 'Scroll target', exact: true });
      await expect.poll(async () => {
        const bar = await header.boundingBox();
        return (await target.boundingBox()).y - bar.y - bar.height;
      }).toBeGreaterThanOrEqual(0);

      // Reflow after a viewport change must also update the scroll clearance, not just the initial header height.
      await page.setViewportSize({ width: width === 390 ? 607 : 390, height });
      await expect.poll(async () => {
        const bar = await header.boundingBox();
        const clearance = await page.evaluate(() => Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--app-header-height')));
        return Math.abs(clearance - bar.height);
      }).toBeLessThan(1);
      await target.evaluate(element => element.scrollIntoView({ block: 'start' }));
      const resizedHeader = await header.boundingBox();
      expect((await target.boundingBox()).y).toBeGreaterThanOrEqual(resizedHeader.y + resizedHeader.height);

      // The dropdown must fit the remaining viewport and modal settings must stay above the header's stacking layer.
      await header.getByRole('button', { name: /^Notifications/ }).click();
      const dropdown = page.getByRole('region', { name: 'Recent notifications' });
      const menu = await dropdown.boundingBox();
      expect(menu.y).toBeGreaterThanOrEqual(0);
      expect(menu.y + menu.height).toBeLessThanOrEqual(height);
      await dropdown.getByRole('button', { name: 'Notification settings' }).click();
      const dialog = page.getByRole('dialog', { name: 'Notification settings' });
      await expect(dialog).toBeVisible();
      const box = await dialog.boundingBox();
      expect(await page.evaluate(({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest('[role="dialog"]')),
        { x: box.x + 20, y: box.y + 20 })).toBe(true);
      await page.keyboard.press('Escape');
      await expect(dialog).not.toBeVisible();
      await expect(header.getByRole('button', { name: /^Notifications/ })).toBeFocused();

      // Logging out clears sticky behavior and scroll offsets from public sign-in pages.
      await header.getByRole('button', { name: 'Log out' }).click();
      await expect(page.getByRole('heading', { name: ['event_organiser', 'attendee'].includes(role) ? 'Sign in' : 'ConnectSphere Login', exact: true })).toBeVisible();
      await expect.poll(() => header.evaluate(element => getComputedStyle(element).position)).toBe('static');
      expect(await page.evaluate(() => document.documentElement.style.getPropertyValue('--app-header-height'))).toBe('');
    });
  }
}

test('Sticky header AC2 - coordinator navigation starts the new page below the resized header', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await openDashboard(page, 'event_coordinator');
  await page.evaluate(() => window.scrollTo(0, 700));
  const header = page.getByRole('navigation', { name: 'Main navigation' });
  await header.getByRole('link', { name: 'Find venues', exact: true }).click();
  await expect(page).toHaveURL(/\/coordinator\/venues$/);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  const heading = page.getByRole('heading', { level: 1 });
  const bar = await header.boundingBox();
  expect((await heading.boundingBox()).y).toBeGreaterThanOrEqual(bar.y + bar.height);
});

// AC3: enough real notification rows to overflow proves that a short mobile viewport still exposes the entire inbox.
test('Sticky header AC3 - a long mobile notification menu scrolls within the space below the header', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 509 });
  const notifications = Array.from({ length: 30 }, (_, index) => ({ id: index + 1, event_id: null,
    type: 'event_details_changed', title: `Update ${index + 1}`, message: 'Pending review update',
    created_at: '2030-01-02T03:55:00Z', read_at: null }));
  await openDashboard(page, 'event_coordinator', notifications);
  await page.evaluate(() => window.scrollTo(0, 700));
  await page.getByRole('button', { name: 'Notifications, 30 unread' }).click();
  const dropdown = page.getByRole('region', { name: 'Recent notifications' });
  const bounds = await dropdown.boundingBox();
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(509);
  expect(await dropdown.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
  await dropdown.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(dropdown.getByRole('button', { name: 'Update 30 (new)', exact: true })).toBeInViewport();
});
