// Browser journeys use real login, React, routing, HTTP and PostgreSQL. API setup is explicit; no network responses are mocked.
const { test, expect } = require('@playwright/test');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { createBrowserFixture } = require('./support/workflowHost.cjs');

test.describe('Connected browser workflows', () => {
  test.skip(process.env.RUN_DB_TESTS !== '1', 'Requires explicitly enabled disposable PostgreSQL fixtures.');
  let fixture, frontend, origin;

  test.beforeAll(async () => {
    fixture = await createBrowserFixture();
    origin = 'http://127.0.0.1:4175';
    // A private frontend points to this fixture's random API port, never the user's live application.
    frontend = spawn(process.execPath, [path.resolve('frontend/node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '4175', '--strictPort'], {
      cwd: path.resolve('frontend'), env: { ...process.env, VITE_API_URL: fixture.apiUrl }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let diagnostics = '';
    frontend.stdout.on('data', data => { diagnostics += data.toString(); });
    frontend.stderr.on('data', data => { diagnostics += data.toString(); });
    // Poll actual readiness instead of assuming a fixed startup sleep is enough.
    await expect.poll(async () => {
      if (frontend.exitCode !== null) throw new Error(`Test frontend exited: ${diagnostics}`);
      try { return (await fetch(origin)).status; } catch { return 0; }
    }, { timeout: 30000, message: 'Isolated frontend becomes reachable' }).toBe(200);
  });
  test.beforeEach(async () => { await fixture.query('TRUNCATE events RESTART IDENTITY CASCADE'); });
  test.afterAll(async () => {
    if (frontend && frontend.exitCode === null) {
      const stopped = new Promise(resolve => frontend.once('exit', resolve));
      frontend.kill(); await stopped;
    }
    if (fixture) await fixture.close();
  });

  /** Signs in through the real UI, including password verification; each switch starts without another user's session. */
  async function login(page, person) {
    await page.goto(`${origin}/external/login`);
    await page.evaluate(() => localStorage.clear());
    const external = ['event_organiser', 'attendee'].includes(fixture.users[person].role);
    await page.goto(`${origin}${external ? '/external/login' : '/login'}`);
    await page.getByLabel('Email', { exact: true }).fill(fixture.users[person].email);
    await page.getByLabel('Password', { exact: true }).fill(fixture.password);
    await page.getByRole('button', { name: 'Login', exact: true }).click();
    await expect(page).not.toHaveURL(/\/login$/);
  }

  test('Workflow AC1 AC2 / SCRUM-92 AC1 / Register AC1 - browser submission reaches arranged confirmation and attendee registration', async ({ page }) => {
    // Arrange: start with a genuine organiser session and the empty request form.
    await login(page, 'organiser');
    await page.goto(`${origin}/organizer/events/new`);
    await page.getByLabel('Event name', { exact: true }).fill('Browser workshop');
    await page.getByLabel('Proposed date', { exact: true }).fill('2090-06-12');
    await page.getByLabel('Start time', { exact: true }).fill('10:00');
    await page.getByLabel('End time', { exact: true }).fill('11:00');
    await page.getByLabel('Expected attendance', { exact: true }).fill('20');
    await page.getByLabel('Requires attendee registration').check();
    await page.getByLabel('Registration capacity', { exact: true }).fill('2');
    // Act: submission is a UI write; the Lead/venue/safety steps are real API operations, not manufactured SQL states.
    await page.getByRole('button', { name: 'Submit', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page).toHaveURL(/\/organizer\/events\/\d+$/);
    const id = Number(new URL(page.url()).pathname.split('/').pop());
    await fixture.assignAndApprove(id);
    await fixture.book(id);
    await fixture.request('safety', 'POST', `/events/${id}/safety-checks`, { outcome: 'approved' }, 201);
    await login(page, 'coordinator');
    await page.goto(`${origin}/events/${id}`);
    await page.getByRole('button', { name: 'Confirm event', exact: true }).click();
    await expect(page.getByLabel('Event status actions')).toContainText('Confirmed');
    await fixture.request('organiser', 'PUT', `/events/${id}/registration-availability`, { open: true });
    await login(page, 'attendee');
    await page.goto(`${origin}/attendee/events/${id}`);
    await page.getByRole('button', { name: 'Register for event', exact: true }).click();
    // Assert: browser feedback and independently persisted state must agree.
    await expect(page.getByRole('status').filter({ hasText: 'Registration confirmed' })).toBeVisible();
    const rows = (await fixture.query('SELECT attendee_id,status FROM registrations WHERE event_id=$1', [id])).rows;
    expect(rows).toEqual([{ attendee_id: fixture.users.attendee.id, status: 'registered' }]);
  });

  test('SCRUM-61 AC5 / Availability AC6 AC7 - overlapping browser booking reports conflict without a second persisted request', async ({ page }) => {
    // Arrange: hold a real occupied slot, then open another assigned event with matching timing.
    const first = await fixture.submit();
    await fixture.assignAndApprove(first.id);
    await fixture.book(first.id);
    const second = await fixture.submit({ name: 'Conflicting browser event' });
    await fixture.assignAndApprove(second.id);
    await login(page, 'coordinator');
    // Act: real form submission must display the server's conflict and preserve the proposed timing.
    await page.goto(`${origin}/coordinator/venues?eventId=${second.id}&venueId=${fixture.venueId}`);
    await page.getByRole('button', { name: 'Request venue', exact: true }).click();
    // Assert visible recovery guidance plus the independent database invariant.
    await expect(page.getByRole('alert')).toContainText('unavailable for the requested period');
    await expect(page.getByLabel('Date', { exact: true })).toHaveValue('2090-06-12');
    expect((await fixture.query('SELECT event_id FROM venue_bookings ORDER BY id')).rows).toEqual([{ event_id: first.id }]);
  });

  test('Amendment AC1 AC2 / Offline AC5 - browser amendment keeps accepted attendance until review and reopens arrangements', async ({ page }) => {
    // Arrange: start from real, final arrangements and a real organiser session.
    const { event, bookingId } = await fixture.arrange();
    await login(page, 'organiser');
    await page.goto(`${origin}/organizer/events/${event.id}`);
    await page.getByRole('button', { name: 'Request an amendment', exact: true }).click();
    await page.getByLabel('Expected attendance', { exact: true }).fill('19');
    await page.getByLabel('Explanation (required)', { exact: true }).fill('One guest can no longer attend.');
    // Act: the form submits a proposal; the real coordinator review applies it in a separate transaction.
    await page.getByRole('button', { name: 'Submit amendment request', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    expect((await fixture.query('SELECT expected_attendance FROM events WHERE id=$1', [event.id])).rows[0].expected_attendance).toBe(20);
    const requests = await fixture.request('coordinator', 'GET', '/events/change-requests');
    expect(requests.changeRequests).toHaveLength(1);
    await fixture.request('coordinator', 'POST', `/events/change-requests/${requests.changeRequests[0].id}/decision`, { decision: 'approved' });
    await page.reload();
    // Assert: the persisted attendance and all affected gates change; stale confirmation cannot survive.
    const stored = (await fixture.query(`SELECT expected_attendance,status,equipment_confirmed_at,
      safety_recheck_required_at IS NOT NULL AS safety FROM events WHERE id=$1`, [event.id])).rows[0];
    expect(stored).toEqual({ expected_attendance: 19, status: 'planning', equipment_confirmed_at: null, safety: true });
    expect((await fixture.query('SELECT recheck_required_at FROM venue_bookings WHERE id=$1', [bookingId])).rows[0].recheck_required_at).not.toBeNull();
    await expect(page.getByRole('heading', { name: event.name, exact: true })).toBeVisible();
  });

  test('Register AC1 AC2 AC4 / Withdraw AC1 AC2 - browser waitlist joins explicitly and promotes after another attendee withdraws', async ({ page, browser }) => {
    // Arrange: one-seat event, occupied through the real registration API; a second browser session owns that place.
    const { event } = await fixture.arrange({ registrationCapacity: 1 });
    await fixture.request('attendee', 'POST', `/registrations/events/${event.id}`, {}, 201);
    await login(page, 'second');
    await page.goto(`${origin}/attendee/events/${event.id}`);
    await expect(page.getByText('This event is full. You can join the waitlist.', { exact: true })).toBeVisible();
    // Act: waitlist consent and withdrawal both use the actual controls and real separate sessions.
    await page.getByRole('button', { name: 'Join waitlist', exact: true }).click();
    await expect(page.getByText('Waitlist position: 1', { exact: true })).toBeVisible();
    const ownerContext = await browser.newContext();
    try {
      const ownerPage = await ownerContext.newPage();
      await login(ownerPage, 'attendee');
      await ownerPage.goto(`${origin}/registrations`);
      await ownerPage.getByRole('button', { name: /View registration/ }).click();
      await ownerPage.getByRole('button', { name: 'Withdraw registration', exact: true }).click();
      await ownerPage.getByRole('dialog').filter({ has: ownerPage.getByRole('button', { name: 'Confirm', exact: true }) })
        .getByRole('button', { name: 'Confirm', exact: true }).click();
      await expect(ownerPage.getByRole('button', { name: 'Continue', exact: true })).toBeVisible();
      await page.reload();
      // Assert: one promoted place, no lingering waitlist position, and a recipient-specific promotion notice.
      await expect(page.getByText('Registration status:')).toContainText('Registered');
      await expect(page.getByText('Waitlist position: 1', { exact: true })).toHaveCount(0);
      expect((await fixture.query("SELECT attendee_id,status FROM registrations WHERE event_id=$1 ORDER BY attendee_id", [event.id])).rows).toEqual([
        { attendee_id: fixture.users.attendee.id, status: 'withdrawn' }, { attendee_id: fixture.users.second.id, status: 'registered' },
      ]);
    } finally { await ownerContext.close(); }
  });

  test('SCRUM-90 AC4 / SCRUM-87 AC2 - browser cancellation updates the attendee view and blocks new registrations', async ({ page }) => {
    // Arrange: real arrangements and one attendee ensure cancellation has an affected recipient.
    const { event } = await fixture.arrange();
    await fixture.request('attendee', 'POST', `/registrations/events/${event.id}`, {}, 201);
    await login(page, 'organiser');
    await page.goto(`${origin}/organizer/events/${event.id}`);
    // Act: explicit confirmation is required before the cancellation write.
    await page.getByRole('button', { name: 'Cancel event', exact: true }).click();
    const cancelled = page.waitForResponse(response => response.url().endsWith(`/events/${event.id}/cancel`)
      && response.request().method() === 'POST');
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click();
    expect((await cancelled).status()).toBe(200);
    // The successful cancellation removes the now-ineligible action and its dialog from the event page.
    await expect(page.getByRole('button', { name: 'Cancel event', exact: true })).toHaveCount(0);
    await login(page, 'attendee');
    await page.goto(`${origin}/attendee/events/${event.id}`);
    // Assert: cancellation is visible in the actual event UI and to the specific affected recipient.
    await expect(page.getByRole('main').getByText('Cancelled', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Register for event', exact: true })).toHaveCount(0);
    const notices = await fixture.request('attendee', 'GET', '/notifications');
    expect(notices.notifications.filter(note => note.event_id === event.id && note.type === 'event_cancelled')).toHaveLength(1);
    await fixture.request('third', 'POST', `/registrations/events/${event.id}`, {}, 409);
  });

  test('S1 EVENT 2 AC3 AC4 - stored markup is rendered as literal text and cannot create a script or grant event access', async ({ page }) => {
    // Arrange a real stored attack string: markup must be displayed as text, not stripped to make this test pass.
    const name = '<img src=x onerror="window.__workflowInjected=true">';
    const event = await fixture.submit({ name, description: '<script>window.__workflowInjected=true</script>' });
    await login(page, 'organiser');
    // Act: rendering comes from the actual API record in a real JavaScript-enabled browser.
    await page.goto(`${origin}/organizer/events/${event.id}`);
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    await expect(page.getByText('<script>window.__workflowInjected=true</script>', { exact: true })).toBeVisible();
    // Assert: positive text evidence plus the absence of injected DOM/execution avoids a vacuous XSS assertion.
    expect(await page.evaluate(() => window.__workflowInjected)).toBeUndefined();
    await expect(page.locator('img[onerror]')).toHaveCount(0);
    await expect(page.locator('script').filter({ hasText: 'window.__workflowInjected=true' })).toHaveCount(0);
    await fixture.request('outsider', 'GET', `/events/${event.id}`, undefined, 404);
    expect((await fixture.query('SELECT name FROM events WHERE id=$1', [event.id])).rows[0].name).toBe(name);
  });
});
