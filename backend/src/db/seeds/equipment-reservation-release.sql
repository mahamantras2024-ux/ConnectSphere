-- Creates isolated, repeatable demo reservations for cancelled and rescheduled events.
-- Run explicitly after migrations in a development/test database; seeded accounts cannot sign in.
BEGIN;
DO $$
DECLARE
  support_id INTEGER;
  demo_organiser_id INTEGER;
  cancelled_event_id INTEGER;
  postponed_event_id INTEGER;
  replacement_event_id INTEGER;
  projector_id INTEGER;
BEGIN
  INSERT INTO users (email, password_hash, full_name, role, roles)
  VALUES ('equipment-release-demo-support@connectsphere.invalid', 'not-a-login-account',
    'Equipment Release Demo Support', 'technical_support', ARRAY['technical_support'])
  ON CONFLICT (email) DO NOTHING;
  INSERT INTO users (email, password_hash, full_name, role, roles)
  VALUES ('equipment-release-demo-organiser@connectsphere.invalid', 'not-a-login-account',
    'Equipment Release Demo Organiser', 'event_organiser', ARRAY['event_organiser'])
  ON CONFLICT (email) DO NOTHING;

  SELECT id INTO support_id FROM users
  WHERE email='equipment-release-demo-support@connectsphere.invalid';
  SELECT id INTO demo_organiser_id FROM users
  WHERE email='equipment-release-demo-organiser@connectsphere.invalid';
  SELECT id INTO projector_id FROM equipments WHERE asset_code='PROJ-001';
  IF support_id IS NULL OR demo_organiser_id IS NULL OR projector_id IS NULL THEN
    RAISE EXCEPTION 'Run the event and equipment migrations before loading the reservation demo seed.';
  END IF;

  SELECT e.id INTO cancelled_event_id FROM events e
  WHERE e.organiser_id=demo_organiser_id AND e.name='[DEMO] Cancelled equipment event'
  ORDER BY e.id LIMIT 1;
  IF cancelled_event_id IS NULL THEN
    INSERT INTO events (organiser_id, name, proposed_date, proposed_start_time, proposed_end_time,
      equipment_items, is_draft, status)
    VALUES (demo_organiser_id, '[DEMO] Cancelled equipment event', CURRENT_DATE + 7,
      '09:00', '12:00', '[{"item":"Projector","quantity":1}]'::jsonb, false, 'cancelled')
    RETURNING id INTO cancelled_event_id;
  END IF;

  SELECT e.id INTO postponed_event_id FROM events e
  WHERE e.organiser_id=demo_organiser_id AND e.name='[DEMO] Postponed equipment event'
  ORDER BY e.id LIMIT 1;
  IF postponed_event_id IS NULL THEN
    INSERT INTO events (organiser_id, name, proposed_date, proposed_start_time, proposed_end_time,
      equipment_items, is_draft, status)
    VALUES (demo_organiser_id, '[DEMO] Postponed equipment event', CURRENT_DATE + 14,
      '09:00', '12:00', '[{"item":"Projector","quantity":1}]'::jsonb, false, 'planning')
    RETURNING id INTO postponed_event_id;
  END IF;

  SELECT e.id INTO replacement_event_id FROM events e
  WHERE e.organiser_id=demo_organiser_id AND e.name='[DEMO] Replacement equipment event'
  ORDER BY e.id LIMIT 1;
  IF replacement_event_id IS NULL THEN
    INSERT INTO events (organiser_id, name, proposed_date, proposed_start_time, proposed_end_time,
      equipment_items, is_draft, status)
    VALUES (demo_organiser_id, '[DEMO] Replacement equipment event', CURRENT_DATE + 7,
      '09:00', '12:00', '[{"item":"Projector","quantity":1}]'::jsonb, false, 'planning')
    RETURNING id INTO replacement_event_id;
  END IF;

  INSERT INTO event_equipment_reviews (event_id, request_version, outcome, reason, reviewed_by)
  VALUES (replacement_event_id, 1, 'fully_fulfillable', NULL, support_id)
  ON CONFLICT (event_id, request_version) DO NOTHING;

  INSERT INTO technical_equipment_availability (inventory_id, available_date, start_time, end_time)
  VALUES (projector_id, CURRENT_DATE + 7, '09:00', '12:00')
  ON CONFLICT (inventory_id, available_date, start_time, end_time) DO NOTHING;

  INSERT INTO event_equipment_reservations
    (event_id, request_version, event_date, start_time, end_time, reserved_by)
  SELECT event_id, 1, CURRENT_DATE + 7, '09:00', '12:00', support_id
  FROM (VALUES (cancelled_event_id), (postponed_event_id)) AS demo(event_id)
  ON CONFLICT (event_id, request_version) WHERE status='reserved' DO NOTHING;

  INSERT INTO event_equipment_reservation_items (reservation_id, inventory_id, quantity)
  SELECT reservation.id, projector_id, 1
  FROM event_equipment_reservations reservation
  WHERE reservation.event_id IN (cancelled_event_id, postponed_event_id)
  ON CONFLICT (reservation_id, inventory_id) DO NOTHING;
END $$;
COMMIT;
