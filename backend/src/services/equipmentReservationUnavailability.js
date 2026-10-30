// File: Records unavailable equipment and flags future reservations affected by the status change.
const { pool } = require('../config/db');
const { responsibilityScope } = require('./technicalEventStatus');
const notificationService = require('./notificationService');

const failure = (status, message) => Object.assign(new Error(message), { status });

async function markUnavailable(inventoryId, reason, staffId) {
  const client = await pool.connect();
  let result;
  try {
    await client.query('BEGIN');
    const equipment = (await client.query(`
      UPDATE equipments SET availability_status='Unavailable', updated_at=now()
      WHERE id=$1 AND availability_status='Available'
      RETURNING id, asset_code, name, specification, status, availability_status, quantity
    `, [inventoryId])).rows[0];
    if (!equipment) {
      throw failure(409, 'This equipment is no longer Available. Refresh the inventory before trying again.');
    }

    await client.query(`
      INSERT INTO equipment_status_history (inventory_id, status, note, changed_by)
      VALUES ($1, 'Unavailable', $2, $3)
    `, [inventoryId, reason, staffId]);
    const statusHistory = (await client.query(`
      SELECT history.id, history.status, history.note, history.changed_at,
        staff.full_name AS changed_by_name
      FROM equipment_status_history history
      LEFT JOIN users staff ON staff.id=history.changed_by
      WHERE history.inventory_id=$1
      ORDER BY history.changed_at, history.id
    `, [inventoryId])).rows;
    const updatedEquipment = { ...equipment, status_history: statusHistory };

    const affected = (await client.query(`
      SELECT reservation.id AS reservation_id, reservation.event_id, event.name AS event_name,
        event.coordinator_id, reservation.event_date::text AS event_date,
        reservation.start_time::text AS start_time, reservation.end_time::text AS end_time,
        reserved_item.quantity,
        ARRAY(SELECT assignment.staff_id FROM event_technical_support_assignments assignment
          WHERE assignment.event_id=event.id ORDER BY assignment.staff_id) AS support_ids
      FROM event_equipment_reservations reservation
      JOIN event_equipment_reservation_items reserved_item ON reserved_item.reservation_id=reservation.id
      JOIN events event ON event.id=reservation.event_id
      WHERE reserved_item.inventory_id=$1 AND reservation.status='reserved'
        AND (reservation.event_date > CURRENT_DATE OR
          (reservation.event_date=CURRENT_DATE AND reservation.end_time > LOCALTIME))
      ORDER BY reservation.id
      FOR UPDATE OF reservation
    `, [inventoryId])).rows;

    const affectedIssues = [];
    const notes = [];
    for (const reservation of affected) {
      const issue = (await client.query(`
        INSERT INTO equipment_reservation_unavailability (reservation_id, inventory_id, reason, created_by)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (reservation_id, inventory_id) WHERE status='open' DO NOTHING
        RETURNING id
      `, [reservation.reservation_id, inventoryId, reason, staffId])).rows[0];
      if (!issue) continue;

      const alternatives = await listAlternatives(client, {
        inventory_id: inventoryId,
        event_date: reservation.event_date,
        start_time: reservation.start_time,
        end_time: reservation.end_time,
        quantity: reservation.quantity,
      });
      if (alternatives.length === 0) {
        await client.query(`
          UPDATE equipment_reservation_unavailability
          SET suggestion_status='no_alternative'
          WHERE id=$1 AND status='open'
        `, [issue.id]);
      }
      affectedIssues.push({
        id: issue.id,
        reservationId: reservation.reservation_id,
        eventId: reservation.event_id,
        eventName: reservation.event_name,
        noAlternativeAvailable: alternatives.length === 0,
      });
      const details = {
        issueId: issue.id,
        reservationId: reservation.reservation_id,
        inventoryId,
        assetCode: equipment.asset_code,
      };
      for (const userId of reservation.support_ids) {
        notes.push({
          userId,
          eventId: reservation.event_id,
          changeRequestId: null,
          type: 'equipment_reservation_affected',
          title: `Reserved equipment unavailable: ${reservation.event_name}`,
          message: `${equipment.asset_code} (${equipment.name}) is unavailable for ${reservation.event_name}. Review the affected reservation.`,
          details,
        });
      }
      if (reservation.coordinator_id) {
        notes.push({
          userId: reservation.coordinator_id,
          eventId: reservation.event_id,
          changeRequestId: null,
          type: 'equipment_reservation_affected',
          title: `Reservation affected by unavailable equipment: ${reservation.event_name}`,
          message: `${equipment.asset_code} (${equipment.name}) is unavailable for the confirmed reservation on ${reservation.event_date}. Technical Support has been alerted.`,
          details,
        });
      }
    }

    const stored = notes.length ? await notificationService.insertNotifications(client, notes) : [];
    await client.query('COMMIT');
    result = { equipment: updatedEquipment, affectedIssues, stored };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  await notificationService.emailNotifications(result.stored);
  const { stored, ...response } = result;
  return response;
}

async function findIssue(client, issueId) {
  return (await client.query(`
    SELECT impact.id, impact.reservation_id, impact.inventory_id, impact.reason, impact.status,
      impact.suggestion_status, impact.suggested_inventory_id,
      reservation.event_id, reservation.event_date::text AS event_date,
      reservation.start_time::text AS start_time, reservation.end_time::text AS end_time,
      reserved_item.quantity, original.asset_code AS original_asset_code,
      original.name AS original_name, event.name AS event_name, event.coordinator_id,
      ARRAY(SELECT assignment.staff_id FROM event_technical_support_assignments assignment
        WHERE assignment.event_id=event.id ORDER BY assignment.staff_id) AS support_ids
    FROM equipment_reservation_unavailability impact
    JOIN event_equipment_reservations reservation ON reservation.id=impact.reservation_id
    JOIN event_equipment_reservation_items reserved_item
      ON reserved_item.reservation_id=reservation.id AND reserved_item.inventory_id=impact.inventory_id
    JOIN equipments original ON original.id=impact.inventory_id
    JOIN events event ON event.id=reservation.event_id
    WHERE impact.id=$1
    FOR UPDATE OF impact, reservation
  `, [issueId])).rows[0] || null;
}

async function listAlternatives(db, issue) {
  return (await db.query(`
    SELECT stock.id, stock.asset_code, stock.name, stock.specification, stock.quantity,
      GREATEST(stock.quantity - COALESCE(booked.quantity, 0), 0)::integer AS available_quantity
    FROM equipments stock
    LEFT JOIN LATERAL (
      SELECT schedule.id
      FROM technical_equipment_availability schedule
      WHERE schedule.inventory_id=stock.id AND schedule.available_date=$2::date
        AND schedule.start_time <= $3::time AND schedule.end_time >= $4::time
      ORDER BY schedule.start_time, schedule.end_time
      LIMIT 1
    ) availability ON true
    LEFT JOIN LATERAL (
      SELECT sum(reserved_item.quantity)::integer AS quantity
      FROM event_equipment_reservations reservation
      JOIN event_equipment_reservation_items reserved_item ON reserved_item.reservation_id=reservation.id
      WHERE reserved_item.inventory_id=stock.id AND reservation.status='reserved'
        AND reservation.event_date=$2::date
        AND reservation.start_time < $4::time AND reservation.end_time > $3::time
    ) booked ON true
    WHERE stock.id <> $1 AND stock.status='operational' AND stock.availability_status='Available'
      AND (availability.id IS NOT NULL OR NOT EXISTS (
        SELECT 1 FROM technical_equipment_availability schedule
        WHERE schedule.inventory_id=stock.id AND schedule.available_date=$2::date
      ))
      AND stock.quantity - COALESCE(booked.quantity, 0) >= $5
    ORDER BY stock.asset_code
  `, [issue.inventory_id, issue.event_date, issue.start_time, issue.end_time, issue.quantity])).rows;
}

/** Lists affected reservations and replacements only for the authenticated staff member's events (AC6). */
async function listOpenIssues(staffId) {
  const issues = (await pool.query(`
    SELECT impact.id, impact.reservation_id, impact.inventory_id, impact.reason,
      impact.suggestion_status, reservation.event_id, event.name AS event_name,
      reservation.event_date::text AS event_date, reservation.start_time::text AS start_time,
      reservation.end_time::text AS end_time, reserved_item.quantity,
      original.asset_code AS original_asset_code, original.name AS original_name
    FROM equipment_reservation_unavailability impact
    JOIN event_equipment_reservations reservation ON reservation.id=impact.reservation_id
    JOIN event_equipment_reservation_items reserved_item
      ON reserved_item.reservation_id=reservation.id AND reserved_item.inventory_id=impact.inventory_id
    JOIN equipments original ON original.id=impact.inventory_id
    JOIN events event ON event.id=reservation.event_id
    WHERE impact.status='open' AND ${responsibilityScope('event')}
    ORDER BY reservation.event_date, reservation.start_time, impact.id
  `, [staffId])).rows;
  return Promise.all(issues.map(async issue => ({
    ...issue,
    alternatives: await listAlternatives(pool, issue),
  })));
}

/** Lists replacement offers for an event; the caller must first verify assigned-coordinator access. */
async function listEventIssues(eventId) {
  return (await pool.query(`
    SELECT impact.id, impact.suggestion_status AS status, impact.reason,
      reservation.event_id, reservation.event_date::text AS event_date,
      reservation.start_time::text AS start_time, reservation.end_time::text AS end_time,
      reserved_item.quantity, original.asset_code AS original_asset_code,
      original.name AS original_name, replacement.asset_code AS replacement_asset_code,
      replacement.name AS replacement_name
    FROM equipment_reservation_unavailability impact
    JOIN event_equipment_reservations reservation ON reservation.id=impact.reservation_id
    JOIN event_equipment_reservation_items reserved_item
      ON reserved_item.reservation_id=reservation.id AND reserved_item.inventory_id=impact.inventory_id
    JOIN equipments original ON original.id=impact.inventory_id
    LEFT JOIN equipments replacement ON replacement.id=impact.suggested_inventory_id
    WHERE reservation.event_id=$1 AND impact.status='open'
    ORDER BY reservation.event_date, reservation.start_time, impact.id
  `, [eventId])).rows;
}

/** Saves a staff-selected alternative only after rechecking its exact event-slot availability. */
async function suggestAlternative(issueId, alternativeInventoryId, staffId) {
  const client = await pool.connect();
  let stored = [];
  let alternative;
  try {
    await client.query('BEGIN');
    const issue = await findIssue(client, issueId);
    if (!issue || issue.status !== 'open' || !['awaiting_staff', 'rejected', 'no_alternative'].includes(issue.suggestion_status)) {
      throw failure(409, 'This affected reservation is no longer awaiting an alternative suggestion.');
    }
    if (alternativeInventoryId === issue.inventory_id) {
      throw failure(400, 'Choose different equipment as the replacement.');
    }
    await client.query(`
      SELECT id FROM equipments WHERE id=ANY($1::integer[]) ORDER BY id FOR UPDATE
    `, [[issue.inventory_id, alternativeInventoryId]]);
    const alternatives = await listAlternatives(client, issue);
    alternative = alternatives.find(item => item.id === alternativeInventoryId);
    if (!alternative) throw failure(409, 'That alternative is no longer available for this event slot. Refresh and choose another.');

    await client.query(`
      UPDATE equipment_reservation_unavailability
      SET suggested_inventory_id=$2, suggested_by=$3, suggested_at=now(),
        suggestion_status='pending', decision_by=NULL, decision_at=NULL
      WHERE id=$1
    `, [issueId, alternativeInventoryId, staffId]);
    if (issue.coordinator_id) {
      stored = await notificationService.insertNotifications(client, [{
        userId: issue.coordinator_id,
        eventId: issue.event_id,
        changeRequestId: null,
        type: 'equipment_reservation_affected',
        title: `Replacement equipment suggested: ${issue.event_name}`,
        message: `Technical Support suggests ${alternative.asset_code} (${alternative.name}) to replace ${issue.original_asset_code} for ${issue.event_date}. Review and accept or reject the replacement.`,
        details: { issueId, reservationId: issue.reservation_id },
      }]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  await notificationService.emailNotifications(stored);
  return { issueId, alternative };
}

/** Applies or rejects a pending replacement offer on behalf of the event's assigned coordinator. */
async function decideAlternative(eventId, issueId, coordinatorId, outcome) {
  const client = await pool.connect();
  let result;
  try {
    await client.query('BEGIN');
    const issue = await findIssue(client, issueId);
    if (!issue || issue.event_id !== eventId || issue.coordinator_id !== coordinatorId) {
      throw failure(404, 'Replacement suggestion not found for this event.');
    }
    if (issue.status !== 'open' || issue.suggestion_status !== 'pending' || !issue.suggested_inventory_id) {
      throw failure(409, 'This replacement suggestion has already been handled or is not ready for a decision.');
    }

    if (outcome === 'accepted') {
      await client.query(`
        SELECT id FROM equipments WHERE id=ANY($1::integer[]) ORDER BY id FOR UPDATE
      `, [[issue.inventory_id, issue.suggested_inventory_id]]);
      const alternatives = await listAlternatives(client, issue);
      if (!alternatives.some(item => item.id === issue.suggested_inventory_id)) {
        throw failure(409, 'The suggested replacement is no longer available for this event slot.');
      }
      await client.query(`
        DELETE FROM event_equipment_reservation_items
        WHERE reservation_id=$1 AND inventory_id=$2
      `, [issue.reservation_id, issue.inventory_id]);
      await client.query(`
        INSERT INTO event_equipment_reservation_items (reservation_id, inventory_id, quantity)
        VALUES ($1, $2, $3)
        ON CONFLICT (reservation_id, inventory_id)
        DO UPDATE SET quantity=event_equipment_reservation_items.quantity + EXCLUDED.quantity
      `, [issue.reservation_id, issue.suggested_inventory_id, issue.quantity]);
      await client.query(`
        UPDATE equipment_reservation_unavailability
        SET status='resolved', suggestion_status='accepted', resolved_at=now(),
          decision_by=$2, decision_at=now()
        WHERE id=$1
      `, [issueId, coordinatorId]);
    } else {
      await client.query(`
        UPDATE equipment_reservation_unavailability
        SET suggestion_status='rejected', decision_by=$2, decision_at=now()
        WHERE id=$1
      `, [issueId, coordinatorId]);
    }

    const notes = issue.support_ids.map(userId => ({
      userId,
      eventId,
      changeRequestId: null,
      type: 'equipment_reservation_affected',
      title: outcome === 'accepted'
        ? `Replacement accepted: ${issue.event_name}`
        : `Replacement rejected: ${issue.event_name}`,
      message: outcome === 'accepted'
        ? `The coordinator accepted the replacement for ${issue.original_asset_code}. The reservation has been updated.`
        : `The coordinator rejected the replacement for ${issue.original_asset_code}. Follow up with the coordinator.`,
      details: { issueId, reservationId: issue.reservation_id, outcome },
    }));
    const stored = notes.length ? await notificationService.insertNotifications(client, notes) : [];
    await client.query('COMMIT');
    result = { issueId, outcome, stored };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  await notificationService.emailNotifications(result.stored);
  return { issueId, outcome };
}

module.exports = { markUnavailable, listOpenIssues, listEventIssues, suggestAlternative, decideAlternative };
