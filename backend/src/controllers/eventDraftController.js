const { pool } = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { submissionError } = require('../services/eventRequestValidation');

/** Deletes only the authenticated organiser's still-unsubmitted draft, atomically against concurrent submission. */
const remove = asyncHandler(async (req, res) => {
  if (!/^[1-9]\d*$/.test(req.params.id) || Number(req.params.id) > 2147483647) {
    return res.status(400).json({ message: 'Choose a valid draft.' });
  }
  const result = await pool.query(
    "DELETE FROM events WHERE id=$1 AND organiser_id=$2 AND is_draft=true AND status='draft' RETURNING id",
    [req.params.id, req.user.id],
  );
  if (!result.rows.length) return res.status(404).json({ message: 'Draft not found.' });
  return res.json({ message: 'Draft deleted.' });
});

/** Submits an owned draft under a lock, retaining its ID/files and entering the unassigned lead queue. */
const submit = asyncHandler(async (req, res) => {
  if (!/^[1-9]\d*$/.test(req.params.id) || Number(req.params.id) > 2147483647) {
    return res.status(400).json({ message: 'Choose a valid draft.' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // A concurrent submission/deletion must recheck the draft state after this transaction releases the row.
    const event = (await client.query(
      "SELECT * FROM events WHERE id=$1 AND organiser_id=$2 AND is_draft=true AND status='draft' FOR UPDATE",
      [req.params.id, req.user.id],
    )).rows[0];
    if (!event) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Draft not found.' });
    }
    const error = submissionError({
      name: event.name, proposedDate: event.proposed_date,
      proposedStartTime: event.proposed_start_time, proposedEndTime: event.proposed_end_time,
      expectedAttendance: event.expected_attendance,
    });
    if (error) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: error });
    }
    const updated = (await client.query(
      "UPDATE events SET is_draft=false,status='submitted',coordinator_id=NULL,updated_at=now() WHERE id=$1 RETURNING *",
      [event.id],
    )).rows[0];
    await client.query('COMMIT');
    return res.json({ event: updated, message: 'Event request submitted.' });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
});

module.exports = { remove, submit };
