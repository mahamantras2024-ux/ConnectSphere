import json
import subprocess
import textwrap
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def run_node(script):
    result = subprocess.run(
        ["node", "-e", script],
        cwd=str(ROOT),
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise AssertionError(
            f"Node script failed with exit code {result.returncode}\n"
            f"STDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}"
        )

    output = result.stdout.strip()
    if not output:
        return None
    try:
        return json.loads(output)
    except json.JSONDecodeError:
        return output


class EventCoordinatorEventDetailTests(unittest.TestCase):
    def test_get_event_returns_full_event_details_for_event_coordinator(self):
        script = textwrap.dedent(
            """
            const Module = require('module');
            const originalLoad = Module._load;
            Module._load = function(request, parent, isMain) {
              if (request === '../models/eventModel') {
                return {
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
                    coordinator_name: 'Chris Coordinator'
                  })
                };
              }
              return originalLoad.apply(this, arguments);
            };

            const { getEvent } = require('./backend/src/controllers/eventController.js');
            const res = {
              status(code) { this.code = code; return this; },
              json(payload) { this.body = payload; return this; }
            };

            getEvent({ params: { id: 18 } }, res).then(() => {
              console.log(JSON.stringify({ status: res.code, body: res.body }));
            }).catch((error) => {
              console.error(error);
              process.exit(1);
            });
            """
        )

        result = run_node(script)
        self.assertEqual(result["status"], 200)
        self.assertEqual(result["body"]["event"]["name"], "Leadership Summit")
        self.assertEqual(result["body"]["event"]["purpose"], "Annual strategy workshop")
        self.assertEqual(result["body"]["event"]["expected_attendance"], 220)
        self.assertEqual(result["body"]["event"]["room_layout_preference"], "theatre")
        self.assertIn("wheelchair access", result["body"]["event"]["accessibility_requirements"])

    def test_get_event_returns_404_when_event_does_not_exist(self):
        script = textwrap.dedent(
            """
            const Module = require('module');
            const originalLoad = Module._load;
            Module._load = function(request, parent, isMain) {
              if (request === '../models/eventModel') {
                return { findById: async () => null };
              }
              return originalLoad.apply(this, arguments);
            };

            const { getEvent } = require('./backend/src/controllers/eventController.js');
            const res = {
              status(code) { this.code = code; return this; },
              json(payload) { this.body = payload; return this; }
            };

            getEvent({ params: { id: 999 } }, res).then(() => {
              console.log(JSON.stringify({ status: res.code, body: res.body }));
            }).catch((error) => {
              console.error(error);
              process.exit(1);
            });
            """
        )

        result = run_node(script)
        self.assertEqual(result["status"], 404)
        self.assertEqual(result["body"]["message"], "Event not found.")

    def test_event_route_allows_event_coordinator_access(self):
        script = textwrap.dedent(
            """
            const { requireRole } = require('./backend/src/middleware/auth.js');
            let called = false;
            const req = { user: { role: 'event_coordinator' } };
            const res = {
              status(code) { this.code = code; return this; },
              json(payload) { this.body = payload; return this; }
            };

            requireRole('event_coordinator', 'event_organiser')(req, res, () => {
              called = true;
            });

            console.log(JSON.stringify({ nextCalled: called, code: res.code || 200, body: res.body || null }));
            """
        )

        result = run_node(script)
        self.assertTrue(result["nextCalled"])
        self.assertEqual(result["code"], 200)

    def test_event_route_blocks_non_coordinator_roles(self):
        script = textwrap.dedent(
            """
            const { requireRole } = require('./backend/src/middleware/auth.js');
            const req = { user: { role: 'attendee' } };
            const res = {
              status(code) { this.code = code; return this; },
              json(payload) { this.body = payload; return this; }
            };

            requireRole('event_coordinator', 'event_organiser')(req, res, () => {});
            console.log(JSON.stringify({ code: res.code, body: res.body }));
            """
        )

        result = run_node(script)
        self.assertEqual(result["code"], 403)
        self.assertEqual(result["body"]["message"], "Forbidden: You do not have permission to access this resource.")

    def test_event_detail_component_renders_fields_for_event_information(self):
        detail_source = (ROOT / 'frontend/src/pages/events/EventDetail.jsx').read_text()

        expected_fields = [
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
        ]

        for field in expected_fields:
            self.assertIn(field, detail_source)

    def test_event_detail_component_fetches_the_event_by_id(self):
        detail_source = (ROOT / 'frontend/src/pages/events/EventDetail.jsx').read_text()
        self.assertIn("const { id } = useParams();", detail_source)
        self.assertIn("api.get(`/events/${id}`, token);", detail_source)


if __name__ == "__main__":
    unittest.main()
