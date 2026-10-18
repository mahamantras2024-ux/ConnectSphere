// File: Coordinates unavailable-equipment incidents, replacement proposals, and coordinator decisions.
const { pool } = require('../config/db');
const notificationService = require('./notificationService');

const failure = (status, message) => Object.assign(new Error(message), { status });

/** Commits notification rows with each workflow transition and sends email only after the transaction succeeds. */
async function inTransaction(work) {
  const client = await pool.connect();
  let result;
  try {
    await client.query('BEGIN');
    result = await work(client);
    await client.query('COMMIT');
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

async function storeNotifications(client, notes) {
  return notes.length ? notificationService.insertNotifications(client, notes) : [];
}

/** Marks an asset unavailable, records every affected future reservation, and alerts its assigned team. */
async function markUnavailable(inventoryId, reason, staffId) {
  return inTransaction(async (client) => {
    const equipment = (await client.query(`
      UPDATE equipments SET availability_status='Unavailable', updated_at=now()
      WHERE id=$1 AND availability_status='Available'
      RETURNING id, asset_code, name, specification, status, availability_status, quantity
    `, [inventoryId])).rows[0];
    if (!equipment) throw failure(409, 'This equipment is no longer Available. Refresh the inventory before trying again.');

    await client.query(`
      INSERT INTO equipment_status_history (inventory_id, status, note, changed_by)
      VALUES ($1, 'Unavailable', $2, $3)
    `, [inventoryId, reason, staffId]);
    const affected = (await client.query(`
      SELECT reservation.id AS reservation_id, reservation.event_id, event.name AS event_name,
        event.coordinator_id, reservation.event_date::text AS event_date,
        reservation.start_time, reservation.end_time, reserved_item.quantity,
        ARRAY(SELECT assignment.staff_id FROM event_technical_support_assignments assignment
          WHERE assignment.event_id=event.id ORDER BY assignment.staff_id) AS support_ids
      FROM event_equipment_reservations reservation
      JOIN event_equipment_reservation_items reserved_item ON reserved_item.reservation_id=reservation.id
      JOIN events event ON event.id=reservation.event_id
      WHERE reserved_item.inventory_id=$1 AND reservation.status='reserved'
        AND (reservation.event_date > CURRENT_DATE OR
          (reservation.event_date=CURRENT_DATE AND reservation.end_time > LOCALTIME))
      FOR UPDATE OF reservation
    `, [inventoryId])).rows;

    const affectedIssues = [];
    const notes = [];
    for (const row of affected) {
      const issue = (await client.query(`
        INSERT INTO equipment_reservation_unavailability (reservation_id, inventory_id, reason, created_by)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (reservation_id, inventory_id) WHERE status='open' DO NOTHING
        RETURNING id
      `, [row.reservation_id, inventoryId, reason, staffId])).rows[0];
      if (!issue) continue;
      affectedIssues.push({ id: issue.id, reservationId: row.reservation_id, eventId: row.event_id });
      const details = { issueId: issue.id, reservationId: row.reservation_id, inventoryId, assetCode: equipment.asset_code };
      for (const userId of row.support_ids) {
        notes.push({
          userId, eventId: row.event_id, changeRequestId: null, type: 'equipment_reservation_affected',
          title: `Reserved equipment unavailable: ${row.event_name}`,
          message: `${equipment.asset_code} (${equipment.name}) is unavailable for ${row.event_name}. Propose a replacement for the affected reservation.`,
          details,
        });
      }
      if (row.coordinator_id) {
        notes.push({
          userId: row.coordinator_id, eventId: row.event_id, changeRequestId: null, type: 'equipment_reservation_affected',
          title: `Reservation affected by unavailable equipment: ${row.event_name}`,
          message: `${equipment.asset_code} (${equipment.name}) is unavailable for the confirmed reservation on ${row.event_date}. Technical Support has been alerted.`,
          details,
        });
      }
    }
    const stored = await storeNotifications(client, notes);
    return { equipment, affectedIssues, stored };
  });
}

/** Lists open incidents only to staff assigned to each affected event, with valid same-type alternatives. */
async function listForSupport(staffId) {
  const result = await pool.query(`
    SELECT issue.id, issue.reservation_id, issue.reason, issue.created_at,
      reservation.event_id, event.name AS event_name, reservation.event_date::text AS event_date,
      reservation.start_time, reservation.end_time, reservation.venue_name, reservation.venue_location,
      unavailable.id AS unavailable_inventory_id, unavailable.asset_code AS unavailable_asset_code,
      unavailable.name AS equipment_name, unavailable.specification AS unavailable_specification,
      reserved_item.quantity,
      COALESCE(proposal_view.proposal, NULL) AS proposal,
      COALESCE(alternatives.assets, '[]'::jsonb) AS alternatives
    FROM equipment_reservation_unavailability issue
    JOIN event_equipment_reservations reservation ON reservation.id=issue.reservation_id
    JOIN events event ON event.id=reservation.event_id
    JOIN equipments unavailable ON unavailable.id=issue.inventory_id
    JOIN event_equipment_reservation_items reserved_item
      ON reserved_item.reservation_id=reservation.id AND reserved_item.inventory_id=issue.inventory_id
    JOIN event_technical_support_assignments assignment
      ON assignment.event_id=event.id AND assignment.staff_id=$1
    LEFT JOIN LATERAL (
      SELECT jsonb_build_object(
        'id', proposal.id, 'status', proposal.status,
        'assetCode', alternative.asset_code, 'name', alternative.name,
        'specification', alternative.specification, 'quantity', proposal.quantity
      ) AS proposal
      FROM equipment_reservation_alternative_proposals proposal
      JOIN equipments alternative ON alternative.id=proposal.inventory_id
      WHERE proposal.unavailability_id=issue.id
      ORDER BY proposal.proposed_at DESC, proposal.id DESC LIMIT 1
    ) proposal_view ON true
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(jsonb_build_object(
        'id', alternative.id, 'assetCode', alternative.asset_code,
        'name', alternative.name, 'specification', alternative.specification,
        'availableQuantity', capacity.available_quantity
      ) ORDER BY alternative.asset_code) AS assets
      FROM equipments alternative
      JOIN technical_equipment_availability availability ON availability.inventory_id=alternative.id
      CROSS JOIN LATERAL (
        SELECT GREATEST(alternative.quantity - COALESCE(sum(item.quantity), 0), 0)::integer AS available_quantity
        FROM event_equipment_reservations reserved
        JOIN event_equipment_reservation_items item ON item.reservation_id=reserved.id
        WHERE item.inventory_id=alternative.id AND reserved.status='reserved'
          AND reserved.event_date=reservation.event_date
          AND reserved.start_time < reservation.end_time AND reserved.end_time > reservation.start_time
      ) capacity
      WHERE lower(alternative.name)=lower(unavailable.name)
        AND alternative.id<>unavailable.id AND alternative.status='operational'
        AND alternative.availability_status='Available'
        AND availability.available_date=reservation.event_date
        AND availability.start_time<=reservation.start_time AND availability.end_time>=reservation.end_time
        AND capacity.available_quantity>=reserved_item.quantity
    ) alternatives ON true
    WHERE issue.status='open' AND reservation.status='reserved'
    ORDER BY reservation.event_date, event.name, issue.id
  `, [staffId]);
  return result.rows;
}

/** Returns open issues and their latest proposals only to the event's assigned Coordinator. */
async function listForCoordinator(eventId, coordinatorId) {
  const result = await pool.query(`
    SELECT issue.id, issue.reservation_id, issue.reason, issue.created_at,
      reservation.event_id, event.name AS event_name, reservation.event_date::text AS event_date,
      reservation.start_time, reservation.end_time, unavailable.asset_code AS unavailable_asset_code,
      unavailable.name AS equipment_name, reserved_item.quantity,
      COALESCE(jsonb_agg(jsonb_build_object(
        'id', proposal.id, 'status', proposal.status, 'assetCode', alternative.asset_code,
        'name', alternative.name, 'specification', alternative.specification, 'quantity', proposal.quantity,
        'proposedAt', proposal.proposed_at, 'proposedBy', support.full_name
      ) ORDER BY proposal.proposed_at DESC, proposal.id DESC)
        FILTER (WHERE proposal.id IS NOT NULL), '[]'::jsonb) AS proposals
    FROM equipment_reservation_unavailability issue
    JOIN event_equipment_reservations reservation ON reservation.id=issue.reservation_id
    JOIN events event ON event.id=reservation.event_id AND event.coordinator_id=$2
    JOIN equipments unavailable ON unavailable.id=issue.inventory_id
    JOIN event_equipment_reservation_items reserved_item
      ON reserved_item.reservation_id=reservation.id AND reserved_item.inventory_id=issue.inventory_id
    LEFT JOIN equipment_reservation_alternative_proposals proposal ON proposal.unavailability_id=issue.id
    LEFT JOIN equipments alternative ON alternative.id=proposal.inventory_id
    LEFT JOIN users support ON support.id=proposal.proposed_by
    WHERE issue.status='open' AND reservation.status='reserved' AND event.id=$1
    GROUP BY issue.id, reservation.id, event.id, unavailable.asset_code, unavailable.name, reserved_item.quantity
    ORDER BY reservation.event_date, issue.id
  `, [eventId, coordinatorId]);
  return result.rows;
}

async function checkAlternativeAvailability(client, inventoryId, reservation, quantity) {
  const result = await client.query(`
    SELECT stock.id, stock.name, stock.asset_code, stock.specification,
      GREATEST(stock.quantity-COALESCE(booked.quantity, 0), 0)::integer AS available_quantity
    FROM equipments stock
    JOIN technical_equipment_availability availability ON availability.inventory_id=stock.id
    LEFT JOIN LATERAL (
      SELECT sum(item.quantity)::integer AS quantity
      FROM event_equipment_reservations reserved
      JOIN event_equipment_reservation_items item ON item.reservation_id=reserved.id
      WHERE item.inventory_id=stock.id AND reserved.status='reserved'
        AND reserved.event_date=$2::date
        AND reserved.start_time<$4::time AND reserved.end_time>$3::time
    ) booked ON true
    WHERE stock.id=$1 AND stock.status='operational' AND stock.availability_status='Available'
      AND availability.available_date=$2::date
      AND availability.start_time<=$3::time AND availability.end_time>=$4::time
    FOR UPDATE OF stock
  `, [inventoryId, reservation.event_date, reservation.start_time, reservation.end_time]);
  const alternative = result.rows[0];
  if (!alternative || alternative.available_quantity < quantity) {
    throw failure(409, 'The proposed alternative is no longer available for the full reservation. Choose another asset.');
  }
  return alternative;
}

/** Saves a same-type available replacement proposal and notifies the assigned Coordinator. */
async function proposeAlternative(issueId, supportId, alternativeId) {
  return inTransaction(async (client) => {
    const issue = (await client.query(`
      SELECT issue.id, issue.status, issue.inventory_id, unavailable.name AS equipment_name,
        reservation.id AS reservation_id, reservation.event_id, reservation.event_date::text AS event_date,
        reservation.start_time, reservation.end_time, event.name AS event_name, event.coordinator_id,
        reserved_item.quantity
      FROM equipment_reservation_unavailability issue
      JOIN equipments unavailable ON unavailable.id=issue.inventory_id
      JOIN event_equipment_reservations reservation ON reservation.id=issue.reservation_id
      JOIN events event ON event.id=reservation.event_id
      JOIN event_equipment_reservation_items reserved_item
        ON reserved_item.reservation_id=reservation.id AND reserved_item.inventory_id=issue.inventory_id
      JOIN event_technical_support_assignments assignment
        ON assignment.event_id=event.id AND assignment.staff_id=$2
      WHERE issue.id=$1 AND issue.status='open' AND reservation.status='reserved'
      FOR UPDATE OF issue, reservation
    `, [issueId, supportId])).rows[0];
    if (!issue) throw failure(404, 'Affected reservation not found.');
    const pending = (await client.query(`
      SELECT id FROM equipment_reservation_alternative_proposals
      WHERE unavailability_id=$1 AND status='pending'
    `, [issueId])).rows[0];
    if (pending) throw failure(409, 'A replacement proposal is already awaiting the Coordinator.');

    const alternative = await checkAlternativeAvailability(client, alternativeId, issue, issue.quantity);
    if (alternative.name.trim().toLocaleLowerCase() !== issue.equipment_name.trim().toLocaleLowerCase()) {
      throw failure(400, 'Choose an available alternative of the same equipment type.');
    }
    const proposal = (await client.query(`
      INSERT INTO equipment_reservation_alternative_proposals (unavailability_id, inventory_id, quantity, proposed_by)
      VALUES ($1, $2, $3, $4)
      RETURNING id, status, quantity, proposed_at
    `, [issueId, alternativeId, issue.quantity, supportId])).rows[0];
    const stored = await storeNotifications(client, [{
      userId: issue.coordinator_id, eventId: issue.event_id, changeRequestId: null,
      type: 'equipment_alternative_proposed',
      title: `Replacement equipment proposed: ${issue.event_name}`,
      message: `Technical Support proposes ${alternative.asset_code} (${alternative.name}) × ${issue.quantity} for the affected reservation. Review and accept or reject the proposal.`,
      details: { issueId, proposalId: proposal.id, reservationId: issue.reservation_id, alternativeInventoryId: alternativeId },
    }]);
    return { proposal, alternative, stored };
  });
}

/** Accepts or rejects a pending proposal; acceptance swaps the reserved item atomically. */
async function decideProposal(proposalId, coordinatorId, decision) {
  return inTransaction(async (client) => {
    const proposal = (await client.query(`
      SELECT proposal.id, proposal.status, proposal.quantity, proposal.inventory_id AS alternative_id,
        issue.id AS issue_id, issue.inventory_id AS unavailable_id, issue.status AS issue_status,
        reservation.id AS reservation_id, reservation.event_id, reservation.event_date::text AS event_date,
        reservation.start_time, reservation.end_time, event.name AS event_name,
        unavailable.name AS equipment_name, alternative.asset_code AS alternative_asset_code,
        alternative.name AS alternative_name,
        ARRAY(SELECT assignment.staff_id FROM event_technical_support_assignments assignment
          WHERE assignment.event_id=event.id ORDER BY assignment.staff_id) AS support_ids
      FROM equipment_reservation_alternative_proposals proposal
      JOIN equipment_reservation_unavailability issue ON issue.id=proposal.unavailability_id
      JOIN event_equipment_reservations reservation ON reservation.id=issue.reservation_id
      JOIN events event ON event.id=reservation.event_id AND event.coordinator_id=$2
      JOIN equipments unavailable ON unavailable.id=issue.inventory_id
      JOIN equipments alternative ON alternative.id=proposal.inventory_id
      WHERE proposal.id=$1
      FOR UPDATE OF proposal, issue, reservation
    `, [proposalId, coordinatorId])).rows[0];
    if (!proposal) throw failure(404, 'Replacement proposal not found.');
    if (proposal.status !== 'pending' || proposal.issue_status !== 'open') {
      throw failure(409, 'This replacement proposal has already been decided.');
    }

    let replacement = null;
    if (decision === 'accepted') {
      replacement = await checkAlternativeAvailability(client, proposal.alternative_id, proposal, proposal.quantity);
      if (replacement.name.trim().toLocaleLowerCase() !== proposal.equipment_name.trim().toLocaleLowerCase()) {
        throw failure(409, 'The proposed alternative no longer matches the affected equipment type.');
      }
      await client.query('DELETE FROM event_equipment_reservation_items WHERE reservation_id=$1 AND inventory_id=$2',
        [proposal.reservation_id, proposal.unavailable_id]);
      await client.query(`
        INSERT INTO event_equipment_reservation_items (reservation_id, inventory_id, quantity)
        VALUES ($1, $2, $3)
        ON CONFLICT (reservation_id, inventory_id)
        DO UPDATE SET quantity=event_equipment_reservation_items.quantity+EXCLUDED.quantity
      `, [proposal.reservation_id, proposal.alternative_id, proposal.quantity]);
      await client.query(`
        UPDATE equipment_reservation_unavailability SET status='resolved', resolved_at=now()
        WHERE id=$1 AND status='open'
      `, [proposal.issue_id]);
    }
    await client.query(`
      UPDATE equipment_reservation_alternative_proposals
      SET status=$2, decided_by=$3, decided_at=now()
      WHERE id=$1 AND status='pending'
    `, [proposalId, decision, coordinatorId]);

    const responseLine = decision === 'accepted'
      ? `The Coordinator accepted ${replacement.asset_code} (${replacement.name}) × ${proposal.quantity}; the reservation is updated.`
      : `The Coordinator rejected ${proposal.alternative_asset_code} (${proposal.alternative_name}); the affected reservation remains open for another proposal.`;
    const stored = await storeNotifications(client, (proposal.support_ids || []).map(userId => ({
      userId, eventId: proposal.event_id, changeRequestId: null, type: 'equipment_alternative_decision',
      title: `Replacement proposal ${decision}: ${proposal.event_name}`,
      message: responseLine,
      details: { issueId: proposal.issue_id, proposalId, reservationId: proposal.reservation_id, decision },
    })));
    return { decision, reservationId: proposal.reservation_id, replacement, stored };
  });
}

module.exports = { markUnavailable, listForSupport, listForCoordinator, proposeAlternative, decideProposal };
