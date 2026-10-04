// File: Preserves pulled controller checks, updated to Sprint 1 assignment-scoped access.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const ROOT = path.resolve(__dirname, '../..');
const eventControllerPath = path.join(ROOT, 'backend/src/controllers/eventController.js');
const eventReadPath = path.join(ROOT, 'backend/src/controllers/eventReadController.js');

function withMockedLoads(stubs, fn) {
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) {
      return stubs[request];
    }
    return originalLoad.apply(this, arguments);
  };

  return Promise.resolve()
    .then(fn)
    .finally(() => {
      Module._load = originalLoad;
    });
}

function makeRes() {
  return {
    status(code) {
      this.code = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function tick() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

test('Coordinator AC2 - getEvent returns full event details for the event coordinator', async () => {
  await withMockedLoads(
    {
      '../models/eventModel': {
        findAccessibleById: async () => ({
          id: 18,
          name: 'Leadership Summit',
          purpose: 'Annual strategy workshop',
          description: 'A full-day planning session for leadership teams.',
          event_type: 'conference',
          proposed_date: '2026-10-14',
          proposed_start_time: '09:00',
          proposed_end_time: '17:00',
          expected_attendance: 220,
          programme_details: 'Keynote, breakouts, networking',
          room_layout_preference: 'theatre',
          accessibility_requirements: ['wheelchair access', 'hearing loop'],
          equipment_requests: ['Projector', 'Stage lighting'],
          registration_required: true,
          registration_capacity: 250,
          organiser_name: 'Open Labs',
          coordinator_name: 'Chris Coordinator',
        }),
      },
    },
    async () => {
      delete require.cache[require.resolve(eventControllerPath)];
      delete require.cache[require.resolve(eventReadPath)];
      const { getEvent } = require(eventControllerPath);
      const res = makeRes();

      getEvent({ params: { id: 18 }, user: { id: 9, role: 'event_coordinator' } }, res, () => {});
      await tick();

      assert.equal(res.code, 200);
      assert.equal(res.body.event.name, 'Leadership Summit');
      assert.equal(res.body.event.purpose, 'Annual strategy workshop');
      assert.equal(res.body.event.expected_attendance, 220);
      assert.equal(res.body.event.room_layout_preference, 'theatre');
      assert.ok(res.body.event.accessibility_requirements.includes('wheelchair access'));
    }
  );
});

test('Coordinator AC3 - getEvent returns 404 when the event does not exist', async () => {
  await withMockedLoads(
    {
      '../models/eventModel': {
        findAccessibleById: async () => null,
      },
    },
    async () => {
      delete require.cache[require.resolve(eventControllerPath)];
      delete require.cache[require.resolve(eventReadPath)];
      const { getEvent } = require(eventControllerPath);
      const res = makeRes();

      getEvent({ params: { id: 999 }, user: { id: 9, role: 'event_coordinator' } }, res, () => {});
      await tick();

      assert.equal(res.code, 404);
      assert.deepEqual(res.body, { message: 'Event not found.' });
    }
  );
});

test('Coordinator AC3 - runtime role guard denies unassigned roles', () => {
  const { requireRole } = require(path.join(ROOT, 'backend/src/middleware/role.js'));
  const res = makeRes(); let continued = false;
  requireRole('event_coordinator')({ user: { role: 'technical_support' } }, res, () => { continued = true; });
  assert.equal(res.code, 403); assert.equal(continued, false);
});

test('Event requests - createEvent returns 201 for a valid event and rejects missing names', async () => {
  const mockEventModel = {
    create: async () => ({ id: 42, name: 'Launch' }),
  };

  await withMockedLoads(
    { '../models/eventModel': mockEventModel },
    async () => {
      delete require.cache[require.resolve(eventControllerPath)];
      delete require.cache[require.resolve(eventReadPath)];
      const { createEvent } = require(eventControllerPath);

      const validRes = makeRes();
      createEvent(
        {
          user: { id: 10 },
          body: {
            name: 'Launch',
            purpose: 'Test',
            description: 'desc',
            eventType: 'conference',
            proposedDate: '2026-10-14',
            proposedStartTime: '09:00',
            proposedEndTime: '17:00',
            expectedAttendance: 50,
            roomLayoutPreference: 'theatre',
            accessibilityRequirements: ['wheelchair access'],
            registrationRequired: true,
            registrationCapacity: 80,
            isDraft: true,
          },
        },
        validRes,
        () => {}
      );
      await tick();
      assert.equal(validRes.code, 201);
      assert.equal(validRes.body.event.name, 'Launch');

      const invalidRes = makeRes();
      createEvent({ user: { id: 10 }, body: {} }, invalidRes, () => {});
      await tick();
      assert.equal(invalidRes.code, 400);
      assert.deepEqual(invalidRes.body, { message: 'Event name is required.' });
    }
  );
});

test('Organiser AC1 / Coordinator AC1-3 - lists respect ownership and deny unsupported roles', async () => {
  const eventModel = {
    listForOrganiser: async () => [{ id: 1 }],
    listForCoordinator: async () => [{ id: 2 }],
  };

  await withMockedLoads({ '../models/eventModel': eventModel }, async () => {
    delete require.cache[require.resolve(eventControllerPath)];
      delete require.cache[require.resolve(eventReadPath)];
    const { listEvents } = require(eventControllerPath);

    const organiserRes = makeRes();
    listEvents({ user: { role: 'event_organiser', id: 7 } }, organiserRes, () => {});
    await tick();
    assert.equal(organiserRes.code, 200);
    assert.equal(organiserRes.body.events[0].id, 1);

    const coordinatorRes = makeRes();
    listEvents({ user: { role: 'event_coordinator', id: 9 } }, coordinatorRes, () => {});
    await tick();
    assert.equal(coordinatorRes.code, 200);
    assert.equal(coordinatorRes.body.events[0].id, 2);

    const otherRes = makeRes();
    listEvents({ user: { role: 'technical_support', id: 5 } }, otherRes, () => {});
    await tick();
    assert.equal(otherRes.code, 403);
    assert.deepEqual(otherRes.body, { message: 'Forbidden for this role.' });
  });
});

