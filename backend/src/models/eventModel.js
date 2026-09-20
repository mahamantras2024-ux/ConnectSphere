const pool = require('../config/db');

async function listAll() {
  const result = await pool.query(`
    SELECT id, name, purpose, status, organiser_id, coordinator_id, created_at, updated_at
    FROM events
    ORDER BY created_at DESC
  `);

  return result.rows;
}

async function listForOrganiser(organiserId) {
  const result = await pool.query(`
    SELECT id, name, purpose, status, organiser_id, coordinator_id, created_at, updated_at
    FROM events
    WHERE organiser_id = $1
    ORDER BY created_at DESC
  `, [organiserId]);

  return result.rows;
}

async function listForCoordinator(coordinatorId) {
  const result = await pool.query(`
    SELECT id, name, purpose, status, organiser_id, coordinator_id, created_at, updated_at
    FROM events
    WHERE coordinator_id = $1
    ORDER BY created_at DESC
  `, [coordinatorId]);

  return result.rows;
}

async function findById(id) {
  const result = await pool.query(`
    SELECT *
    FROM events
    WHERE id = $1
  `, [id]);

  return result.rows[0] || null;
}

module.exports = {
  listAll,
  listForOrganiser,
  listForCoordinator,
  findById
};
