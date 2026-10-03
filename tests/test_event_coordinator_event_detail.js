const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const ROOT = path.resolve(__dirname, '..');
const eventControllerPath = path.join(ROOT, 'backend/src/controllers/eventController.js');
const eventDetailPath = path.join(ROOT, 'frontend/src/pages/events/EventDetail.jsx');

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

test('getEvent returns full event details for the event coordinator', async () => {
  await withMockedLoads(
    {
      '../models/eventModel': {
        findById: async () => ({
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
      const { getEvent } = require(eventControllerPath);
      const res = makeRes();

      getEvent({ params: { id: 18 } }, res, () => {});
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

test('getEvent returns 404 when the event does not exist', async () => {
  await withMockedLoads(
    {
      '../models/eventModel': {
        findById: async () => null,
      },
    },
    async () => {
      delete require.cache[require.resolve(eventControllerPath)];
      const { getEvent } = require(eventControllerPath);
      const res = makeRes();

      getEvent({ params: { id: 999 } }, res, () => {});
      await tick();

      assert.equal(res.code, 404);
      assert.deepEqual(res.body, { message: 'Event not found.' });
    }
  );
});

test('route guard source enforces coordinator access rules', () => {
  const roleSource = fs.readFileSync(path.join(ROOT, 'backend/src/middleware/role.js'), 'utf8');

  assert.ok(roleSource.includes('function requireRole'));
  assert.ok(roleSource.includes('allowedRoles.includes(req.user.role)'));
  assert.ok(roleSource.includes("return res.status(403).json({ error: 'Forbidden for this role.' });"));
});

test('EventDetail source includes the expected event information fields', () => {
  const source = fs.readFileSync(eventDetailPath, 'utf8');
  const expectedFields = [
    'Purpose',
    'Description',
    'Event Type',
    'Date',
    'Expected Attendance',
    'Programme',
    'Layout Requirements',
    'Accessibility Needs',
    'Equipment Requests',
    'Registration Required',
  ];

  for (const field of expectedFields) {
    assert.ok(source.includes(field), `Missing field: ${field}`);
  }
});

test('EventDetail fetches the event by ID from the route parameter', () => {
  const source = fs.readFileSync(eventDetailPath, 'utf8');
  assert.ok(source.includes('const { id } = useParams();'));
  assert.ok(source.includes("api.get(`/events/${id}`, token);"));
});

test('createEvent returns 201 for a valid event and rejects missing names', async () => {
  const mockEventModel = {
    create: async () => ({ id: 42, name: 'Launch' }),
  };

  await withMockedLoads(
    { '../models/eventModel': mockEventModel },
    async () => {
      delete require.cache[require.resolve(eventControllerPath)];
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
      assert.deepEqual(invalidRes.body, { error: 'name is required.' });
    }
  );
});

test('listEvents respects organiser, coordinator, and fallback access rules', async () => {
  const eventModel = {
    listForOrganiser: async () => [{ id: 1 }],
    listForCoordinator: async () => [{ id: 2 }],
    listAll: async () => [{ id: 3 }],
  };

  await withMockedLoads({ '../models/eventModel': eventModel }, async () => {
    delete require.cache[require.resolve(eventControllerPath)];
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
    assert.equal(otherRes.code, 200);
    assert.equal(otherRes.body.events[0].id, 3);
  });
});

test('updateEvent succeeds when the event exists and returns 404 otherwise', async () => {
  const eventModel = {
    findById: async (id) => (id === 11 ? { id: 11, name: 'Existing' } : null),
    update: async (_id, payload) => ({ id: 11, ...payload }),
  };

  await withMockedLoads({ '../models/eventModel': eventModel }, async () => {
    delete require.cache[require.resolve(eventControllerPath)];
    const { updateEvent } = require(eventControllerPath);

    const successRes = makeRes();
    updateEvent({ params: { id: 11 }, body: { name: 'Updated' } }, successRes, () => {});
    await tick();
    assert.equal(successRes.code, undefined);
    assert.equal(successRes.body.event.name, 'Updated');

    const missingRes = makeRes();
    updateEvent({ params: { id: 99 }, body: { name: 'Nope' } }, missingRes, () => {});
    await tick();
    assert.equal(missingRes.code, 404);
    assert.deepEqual(missingRes.body, { error: 'Event not found.' });
  });
});

test('submitEvent succeeds or returns 404 when the event cannot be updated', async () => {
  const eventModel = {
    updateStatus: async (id) => (id === 12 ? { id: 12 } : null),
  };

  await withMockedLoads({ '../models/eventModel': eventModel }, async () => {
    delete require.cache[require.resolve(eventControllerPath)];
    const { submitEvent } = require(eventControllerPath);

    const successRes = makeRes();
    submitEvent({ params: { id: 12 }, user: { id: 8 } }, successRes, () => {});
    await tick();
    assert.equal(successRes.code, undefined);
    assert.equal(successRes.body.event.id, 12);

    const missingRes = makeRes();
    submitEvent({ params: { id: 13 }, user: { id: 8 } }, missingRes, () => {});
    await tick();
    assert.equal(missingRes.code, 404);
    assert.deepEqual(missingRes.body, { error: 'Event not found.' });
  });
});

test('assignCoordinator validates coordinator input and assigns successfully', async () => {
  const eventModel = {
    assignCoordinator: async (eventId, coordinatorId) => ({ id: eventId, coordinatorId }),
  };

  global.userModel = {
    findById: async (id) => (id === 22 ? { id: 22, role: 'event_coordinator' } : null),
  };

  await withMockedLoads({ '../models/eventModel': eventModel }, async () => {
    delete require.cache[require.resolve(eventControllerPath)];
    const { assignCoordinator } = require(eventControllerPath);

    const missingRes = makeRes();
    assignCoordinator({ params: { id: 3 }, body: {} }, missingRes, () => {});
    await tick();
    assert.equal(missingRes.code, 400);
    assert.deepEqual(missingRes.body, { error: 'coordinatorId is required.' });

    const invalidRoleRes = makeRes();
    global.userModel = { findById: async () => ({ id: 99, role: 'attendee' }) };
    assignCoordinator({ params: { id: 3 }, body: { coordinatorId: 99 } }, invalidRoleRes, () => {});
    await tick();
    assert.equal(invalidRoleRes.code, 400);
    assert.deepEqual(invalidRoleRes.body, {
      error: 'coordinatorId must belong to an event_coordinator user.',
    });

    const notFoundRes = makeRes();
    global.userModel = { findById: async () => ({ id: 22, role: 'event_coordinator' }) };
    eventModel.assignCoordinator = async () => null;
    assignCoordinator({ params: { id: 3 }, body: { coordinatorId: 22 } }, notFoundRes, () => {});
    await tick();
    assert.equal(notFoundRes.code, 404);
    assert.deepEqual(notFoundRes.body, { error: 'Event not found.' });

    const successRes = makeRes();
    eventModel.assignCoordinator = async () => ({ id: 3, coordinatorId: 22 });
    assignCoordinator({ params: { id: 3 }, body: { coordinatorId: 22 } }, successRes, () => {});
    await tick();
    assert.equal(successRes.code, undefined);
    assert.equal(successRes.body.event.coordinatorId, 22);
  });
});

test('changeStatus validates input and updates the status when permitted', async () => {
  const eventModel = {
    updateStatus: async (id) => (id === 44 ? { id: 44, status: 'approved' } : null),
  };

  await withMockedLoads({ '../models/eventModel': eventModel }, async () => {
    delete require.cache[require.resolve(eventControllerPath)];
    const { changeStatus } = require(eventControllerPath);

    const missingRes = makeRes();
    changeStatus({ params: { id: 44 }, body: {}, user: { id: 8 } }, missingRes, () => {});
    await tick();
    assert.equal(missingRes.code, 400);
    assert.deepEqual(missingRes.body, { error: 'status is required.' });

    const notFoundRes = makeRes();
    changeStatus({ params: { id: 99 }, body: { status: 'approved' }, user: { id: 8 } }, notFoundRes, () => {});
    await tick();
    assert.equal(notFoundRes.code, 404);
    assert.deepEqual(notFoundRes.body, { error: 'Event not found.' });

    const successRes = makeRes();
    changeStatus({ params: { id: 44 }, body: { status: 'approved', notes: 'Ok' }, user: { id: 8 } }, successRes, () => {});
    await tick();
    assert.equal(successRes.code, undefined);
    assert.equal(successRes.body.event.status, 'approved');
  });
});
