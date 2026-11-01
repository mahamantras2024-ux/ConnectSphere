-- Safety repair AC1-AC3: release allocations invalidated by technical rework before the runtime fix existed.
-- Keep all reservation/item history. Attribute release to the officer whose decision invalidated the allocation;
-- released_at is the actual repair time. A later reservation belongs to the revised arrangement and must survive.
-- Equal timestamps cannot prove that an allocation predates the decision, so preserve those conservatively too.
BEGIN;

-- Match the runtime's event-first lock order so a concurrent safety decision or reservation cannot race this repair.
SELECT e.id FROM events e
WHERE EXISTS (
  SELECT 1 FROM event_equipment_reservations r
  JOIN event_safety_checks s ON s.event_id = r.event_id
  WHERE r.event_id = e.id AND r.status = 'reserved'
    AND s.outcome IN ('rejected', 'changes_requested')
    AND 'technical' = ANY(s.change_areas) AND r.reserved_at < s.checked_at
)
ORDER BY e.id FOR UPDATE OF e;

WITH invalidated AS (
  -- Use the first decision that invalidated each allocation, even if a later check passed.
  SELECT DISTINCT ON (r.id) r.id, s.safety_officer_id
  FROM event_equipment_reservations r
  JOIN event_safety_checks s ON s.event_id = r.event_id
  WHERE r.status = 'reserved' AND s.outcome IN ('rejected', 'changes_requested')
    AND 'technical' = ANY(s.change_areas) AND r.reserved_at < s.checked_at
  ORDER BY r.id, s.checked_at, s.id
), released AS (
  UPDATE event_equipment_reservations r
  SET status = 'cancelled', released_by = invalidated.safety_officer_id, released_at = now()
  FROM invalidated WHERE r.id = invalidated.id AND r.status = 'reserved'
  RETURNING r.id
)
UPDATE equipment_reservation_unavailability
SET status = 'resolved', resolved_at = now()
WHERE reservation_id IN (SELECT id FROM released) AND status = 'open';

COMMIT;
