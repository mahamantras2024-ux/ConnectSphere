const { query } = require('../config/db');

async function create(data) {
  const { name, type, totalQuantity } = data;
  const { rows } = await query(
    `INSERT INTO equipment (name, type, total_quantity) VALUES ($1,$2,$3) RETURNING *`,
    [name, type, totalQuantity || 0]
  );
  return rows[0];
}

async function listAll() {
  const { rows } = await query('SELECT * FROM equipment ORDER BY name ASC');
  return rows;
}

async function findById(id) {
  const { rows } = await query('SELECT * FROM equipment WHERE id = $1', [id]);
  return rows[0];
}

// TODO: "Equipment Availability Checking" — naive placeholder that sums
// quantities already reserved for overlapping events and compares against
// total_quantity. Needs review once overlap semantics are agreed.
async function getReservedQuantity(equipmentId, startDatetime, endDatetime) {
  const { rows } = await query(
    `SELECT COALESCE(SUM(quantity), 0) AS reserved
     FROM equipment_reservations
     WHERE equipment_id = $1
       AND status IN ('pending', 'confirmed')
       AND start_datetime < $3
       AND end_datetime > $2`,
    [equipmentId, startDatetime, endDatetime]
  );
  return Number(rows[0].reserved);
}

module.exports = { create, listAll, findById, getReservedQuantity };
